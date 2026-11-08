import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { inflateSync, constants as zlib } from "node:zlib";

/**
 * Ce que le second cerveau peut lire d'un PDF, d'une image ou d'un son, sans dépendance ni service extérieur
 * (rien ne quitte la machine). PDF : le texte des pages (flux Flate, polices avec table ToUnicode, flux d'objets),
 * pas l'OCR d'un document scanné ni un PDF chiffré. Image : dimensions et ce que le fichier dit de lui (EXIF, XMP,
 * texte d'un PNG), jamais une description inventée de l'image. Son : étiquettes (titre, artiste, commentaire,
 * paroles) et durée quand le format la donne, pas de transcription. Module pur, généré pour le serveur.
 */

export type NatureExtraite = "pdf" | "image" | "audio";
export interface Extraction {
  nature: NatureExtraite;
  /** Texte cherchable ; vide quand rien n'a pu être lu (la note dit pourquoi). */
  texte: string;
  /** Faux quand une partie n'a pas pu être lue (pages illisibles, texte coupé). */
  complet: boolean;
  note?: string;
}

export const EXTENSIONS_EXTRAITES: Record<string, NatureExtraite> = {
  ".pdf": "pdf",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
  ".mp3": "audio", ".flac": "audio", ".ogg": "audio", ".opus": "audio", ".wav": "audio",
};
/** Au-delà, un fichier n'est pas ouvert (repère seulement). */
export const TAILLE_EXTRACTION_MAX = 40 * 1024 * 1024;
const TEXTE_MAX = 2_000_000;

export function natureDe(nom: string): NatureExtraite | null {
  const i = nom.lastIndexOf(".");
  return i >= 0 ? EXTENSIONS_EXTRAITES[nom.slice(i).toLowerCase()] ?? null : null;
}

/** Le contenu lisible d'un fichier reconnu, ou null pour un autre format. Ne lève jamais d'erreur. */
export function extraireContenu(nom: string, octets: Buffer): Extraction | null {
  const nature = natureDe(nom);
  if (!nature) return null;
  try {
    if (nature === "pdf") return textePdf(octets);
    if (nature === "image") return texteImage(nom, octets);
    return texteAudio(nom, octets);
  } catch {
    return { nature, texte: "", complet: false, note: "Fichier illisible ou abîmé." };
  }
}

const cache = new Map<string, { cle: string; e: Extraction | null }>();
/**
 * Lit et extrait un fichier du disque, relu seulement s'il a changé (date et taille ; cache en mémoire du
 * processus, rien sur le disque). Null : format non reconnu, absent ou trop lourd.
 */
export function extraireFichier(chemin: string): Extraction | null {
  if (!natureDe(chemin)) return null;
  let st;
  try { st = statSync(chemin); } catch { cache.delete(chemin); return null; }
  if (!st.isFile() || st.size === 0 || st.size > TAILLE_EXTRACTION_MAX) return null;
  const cle = `${st.mtimeMs}:${st.size}`, avant = cache.get(chemin);
  if (avant?.cle === cle) return avant.e;
  let e: Extraction | null;
  try { e = extraireContenu(path.basename(chemin), readFileSync(chemin)); } catch { e = null; }
  if (cache.size >= 500) cache.delete(cache.keys().next().value as string);
  cache.set(chemin, { cle, e });
  return e;
}

/** Le texte donné au second cerveau : une ligne d'en-tête qui dit ce qui a été lu, puis le contenu. */
export function texteIndexable(nom: string, e: Extraction): string {
  const tete = e.nature === "pdf" ? `PDF « ${nom} » : texte des pages${e.complet ? "" : " (en partie)"}.`
    : e.nature === "image" ? `Image « ${nom} » : ce que le fichier dit de lui, pas une description du contenu.`
    : `Son « ${nom} » : étiquettes du fichier, pas une transcription.`;
  const texte = `${tete}${e.note ? ` ${e.note}` : ""}\n\n${e.texte}`.trim();
  // Le second cerveau garde 2 Mo par note : un très long PDF est coupé, et le dit.
  if (Buffer.byteLength(texte, "utf8") <= OCTETS_NOTE_MAX) return texte;
  return `${Buffer.from(texte, "utf8").subarray(0, OCTETS_NOTE_MAX - 64).toString("utf8").replace(/\uFFFD+$/, "")}\n\n[Texte coupé : la suite n'est pas indexée.]`;
}
const OCTETS_NOTE_MAX = 1_990_000;

/* ─── PDF ──────────────────────────────────────────────────────────────── */

interface ObjetPdf { dict: string; flux: Buffer | null }
type CMap = { octets: number; table: Map<number, string> };

function inflate(b: Buffer): Buffer | null {
  try { return inflateSync(b); } catch { /* flux tronqué : on garde ce qui se lit */ }
  try { return inflateSync(b, { finishFlush: zlib.Z_SYNC_FLUSH }); } catch { return null; }
}
function ascii85(b: Buffer): Buffer {
  const s = b.toString("latin1").replace(/^\s*<~/, "").replace(/~>[\s\S]*$/, "").replace(/\s+/g, "");
  const out: number[] = [];
  let groupe: number[] = [];
  const vider = (n: number) => {
    let v = 0;
    for (let k = 0; k < 5; k++) v = v * 85 + (groupe[k] ?? 84);
    for (let k = 0; k < n; k++) out.push((v >>> (24 - 8 * k)) & 255);
    groupe = [];
  };
  for (const c of s) {
    if (c === "z" && !groupe.length) { out.push(0, 0, 0, 0); continue; }
    const v = c.charCodeAt(0) - 33;
    if (v < 0 || v > 84) continue;
    groupe.push(v);
    if (groupe.length === 5) vider(4);
  }
  if (groupe.length) vider(groupe.length - 1);
  return Buffer.from(out);
}
function decoderFlux(o: ObjetPdf): Buffer | null {
  if (!o.flux) return null;
  const filtre = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(o.dict)?.[1] ?? "";
  const filtres = filtre.match(/\/\w+/g) ?? [];
  let b: Buffer | null = o.flux;
  for (const f of filtres) {
    if (!b) return null;
    if (f === "/FlateDecode" || f === "/Fl") b = inflate(b);
    else if (f === "/ASCII85Decode" || f === "/A85") b = ascii85(b);
    else if (f === "/ASCIIHexDecode" || f === "/AHx") b = Buffer.from(b.toString("latin1").replace(/[^0-9a-fA-F]/g, "").replace(/^(.(..)*)$/, "$10"), "hex");
    else return null; // ASCII85, LZW, images… : pas du texte qu'on sait lire ici.
  }
  return b;
}

/** Tous les objets du fichier, y compris ceux rangés dans des flux d'objets (PDF 1.5+). */
function objetsPdf(octets: Buffer): Map<number, ObjetPdf> {
  const s = octets.toString("latin1"), objets = new Map<number, ObjetPdf>();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const debut = m.index + m[0].length, fin = s.indexOf("endobj", debut);
    if (fin < 0) break;
    const corps = s.slice(debut, fin);
    const st = /(?:>>|\s)stream\r?\n/.exec(corps);
    let dict = corps, flux: Buffer | null = null;
    if (st) {
      dict = corps.slice(0, st.index + (st[0].startsWith(">>") ? 2 : 0));
      const a = st.index + st[0].length, z = corps.lastIndexOf("endstream");
      if (z > a) flux = Buffer.from(corps.slice(a, z).replace(/\r?\n$/, ""), "latin1");
    }
    objets.set(Number(m[1]), { dict, flux });
    re.lastIndex = fin + 6;
  }
  for (const o of [...objets.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(o.dict)) continue;
    const d = decoderFlux(o), premier = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1]);
    if (!d || !Number.isFinite(premier)) continue;
    const tete = d.subarray(0, premier).toString("latin1").trim().split(/\s+/).map(Number);
    for (let i = 0; i + 1 < tete.length; i += 2) {
      const num = tete[i], debut = premier + tete[i + 1], fin = i + 3 < tete.length ? premier + tete[i + 3] : d.length;
      if (!objets.has(num)) objets.set(num, { dict: d.subarray(debut, fin).toString("latin1"), flux: null });
    }
  }
  return objets;
}

/** Le dictionnaire `<< … >>` qui commence à `i` (imbrications comprises). */
function dictionnaireA(s: string, i: number): string {
  let profondeur = 0;
  for (let j = i; j < s.length - 1; j++) {
    if (s[j] === "<" && s[j + 1] === "<") { profondeur++; j++; }
    else if (s[j] === ">" && s[j + 1] === ">") { profondeur--; j++; if (profondeur === 0) return s.slice(i, j + 1); }
  }
  return s.slice(i);
}
/** La valeur d'une clé : son dictionnaire, direct ou par référence. */
function valeurDict(objets: Map<number, ObjetPdf>, dict: string, cle: string): string | null {
  const m = new RegExp(`/${cle}\\s*(<<|(\\d+)\\s+\\d+\\s+R)`).exec(dict);
  if (!m) return null;
  if (m[1] === "<<") return dictionnaireA(dict, m.index + m[0].length - 2);
  return objets.get(Number(m[2]))?.dict ?? null;
}
function refs(texte: string): number[] {
  return [...texte.matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]));
}

function lireCMap(texte: string): CMap {
  const table = new Map<number, string>();
  const hex = (h: string) => parseInt(h, 16);
  const unicode = (h: string) => {
    const units: number[] = [];
    for (let i = 0; i + 3 < h.length + 1; i += 4) units.push(parseInt(h.slice(i, i + 4).padEnd(4, "0"), 16));
    return String.fromCharCode(...units);
  };
  let octets = 0;
  for (const b of texte.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const c of b[1].matchAll(/<([0-9a-fA-F]+)>/g)) octets = Math.max(octets, c[1].length / 2);
  }
  for (const b of texte.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const c of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      table.set(hex(c[1]), unicode(c[2]));
      if (!octets) octets = c[1].length / 2;
    }
  }
  for (const b of texte.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const c of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = hex(c[1]), hi = Math.min(hex(c[2]), lo + 65535);
      if (!octets) octets = c[1].length / 2;
      if (c[3].startsWith("[")) {
        const liste = [...c[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
        liste.forEach((d, k) => { if (lo + k <= hi) table.set(lo + k, unicode(d)); });
      } else {
        const base = unicode(c[3].slice(1, -1));
        for (let k = 0; k <= hi - lo; k++) table.set(lo + k, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + k));
      }
    }
  }
  return { octets: octets || 1, table };
}

/** WinAnsi pour 0x80–0x9F ; le reste suit Latin-1. */
const WIN_ANSI: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž",
  0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};
function decoder(octets: number[], police: CMap | null | undefined): string {
  if (police === undefined || police === null) return octets.map((b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join("");
  let out = "";
  for (let i = 0; i + police.octets <= octets.length; i += police.octets) {
    let code = 0;
    for (let k = 0; k < police.octets; k++) code = code * 256 + octets[i + k];
    out += police.table.get(code) ?? "";
  }
  return out;
}

type Jeton = { t: "nom" | "op"; v: string } | { t: "nb"; v: number } | { t: "ch"; v: number[] } | { t: "tab"; v: Jeton[] };

/** Le texte d'un flux de contenu de page : opérateurs Tf, Tj, TJ, ', ", Td, TD, T*, Tm. */
function texteFlux(flux: Buffer, polices: Map<string, CMap | null>): string {
  const s = flux.toString("latin1"), n = s.length;
  let out = "", police: CMap | null | undefined, yPrecedent: number | null = null;
  const pile: Jeton[] = [], tableaux: Jeton[][] = [];
  const pousser = (j: Jeton) => (tableaux.length ? tableaux[tableaux.length - 1].push(j) : pile.push(j));
  const fin = () => { if (out && !out.endsWith("\n")) out += "\n"; };
  const espace = () => { if (out && !/\s$/.test(out)) out += " "; };
  const montrer = (j: Jeton | undefined) => { if (j?.t === "ch") out += decoder(j.v, police); };
  let i = 0;
  while (i < n && out.length < TEXTE_MAX) {
    const c = s[i];
    if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0") { i++; continue; }
    if (c === "%") { while (i < n && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
    if (c === "(") {
      const octets: number[] = [];
      let profondeur = 1;
      i++;
      while (i < n && profondeur > 0) {
        const d = s[i];
        if (d === "\\") {
          const e = s[i + 1];
          if (/[0-7]/.test(e)) { const m = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))![0]; octets.push(parseInt(m, 8) & 255); i += 1 + m.length; continue; }
          const echap: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
          if (e === "\r" || e === "\n") { i += e === "\r" && s[i + 2] === "\n" ? 3 : 2; continue; }
          octets.push(echap[e] ?? e.charCodeAt(0)); i += 2; continue;
        }
        if (d === "(") profondeur++;
        if (d === ")" && --profondeur === 0) { i++; break; }
        octets.push(d.charCodeAt(0) & 255); i++;
      }
      pousser({ t: "ch", v: octets });
      continue;
    }
    if (c === "<" && s[i + 1] !== "<") {
      const z = s.indexOf(">", i);
      const h = s.slice(i + 1, z < 0 ? n : z).replace(/\s+/g, "");
      const octets: number[] = [];
      for (let k = 0; k < h.length; k += 2) octets.push(parseInt(h.slice(k, k + 2).padEnd(2, "0"), 16));
      pousser({ t: "ch", v: octets });
      i = z < 0 ? n : z + 1;
      continue;
    }
    if (c === "<" || c === ">") { i += 2; continue; }
    if (c === "[") { tableaux.push([]); i++; continue; }
    if (c === "]") { const t = tableaux.pop() ?? []; pousser({ t: "tab", v: t }); i++; continue; }
    if (c === "/") {
      let k = i + 1;
      while (k < n && !/[\s/[\]()<>{}%]/.test(s[k])) k++;
      pousser({ t: "nom", v: s.slice(i + 1, k) });
      i = k;
      continue;
    }
    if (/[0-9+\-.]/.test(c)) {
      let k = i + 1;
      while (k < n && /[0-9.]/.test(s[k])) k++;
      pousser({ t: "nb", v: Number(s.slice(i, k)) || 0 });
      i = k;
      continue;
    }
    let k = i;
    while (k < n && !/[\s/[\]()<>{}%]/.test(s[k])) k++;
    if (k === i) { i++; continue; }
    const op = s.slice(i, k);
    i = k;
    if (op === "BI") { const id = s.indexOf("ID", i), ei = s.indexOf("EI", id < 0 ? i : id + 2); i = ei < 0 ? n : ei + 2; pile.length = 0; continue; }
    const args = pile.splice(0);
    const nb = (j: Jeton | undefined) => (j?.t === "nb" ? j.v : 0);
    switch (op) {
      case "Tf": { const nom = args[0]?.t === "nom" ? args[0].v : ""; police = polices.has(nom) ? polices.get(nom) : undefined; break; }
      case "Tj": montrer(args[0]); break;
      case "'": fin(); montrer(args[0]); break;
      case "\"": fin(); montrer(args[2]); break;
      case "TJ": {
        const t = args[0]?.t === "tab" ? args[0].v : [];
        for (const j of t) { if (j.t === "ch") montrer(j); else if (j.t === "nb" && j.v < -180) espace(); }
        break;
      }
      // Un déplacement sur la même ligne n'ajoute pas d'espace : les générateurs courants écrivent les leurs
      // (un espace inventé couperait « Compte r endu ») ; un TJ très creusé en tient lieu (TeX).
      case "Td": case "TD": if (Math.abs(nb(args[1])) > 0.01) fin(); break;
      case "T*": fin(); break;
      case "Tm": { const y = nb(args[5]); if (yPrecedent !== null && Math.abs(y - yPrecedent) > 0.5) fin(); yPrecedent = y; break; }
      case "ET": espace(); break;
    }
  }
  return out;
}

/** Ressources d'une page, héritées au besoin de ses parents. */
function ressources(objets: Map<number, ObjetPdf>, page: string): string | null {
  let dict: string | null = page;
  for (let k = 0; dict && k < 12; k++) {
    const r = valeurDict(objets, dict, "Resources");
    if (r) return r;
    const parent = /\/Parent\s+(\d+)\s+\d+\s+R/.exec(dict);
    dict = parent ? objets.get(Number(parent[1]))?.dict ?? null : null;
  }
  return null;
}
function policesDe(objets: Map<number, ObjetPdf>, res: string | null, cache: Map<number, CMap | null>): Map<string, CMap | null> {
  const out = new Map<string, CMap | null>();
  const fontes = res ? valeurDict(objets, res, "Font") : null;
  if (!fontes) return out;
  for (const m of fontes.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const num = Number(m[2]);
    if (!cache.has(num)) {
      const f = objets.get(num)?.dict ?? "";
      const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(f);
      const flux = tu ? objets.get(Number(tu[1])) : undefined;
      const d = flux ? decoderFlux(flux) : null;
      // Sans table ToUnicode : une police simple se lit en WinAnsi (null), une police composite ne se lit pas.
      cache.set(num, d ? lireCMap(d.toString("latin1")) : /\/Subtype\s*\/Type0/.test(f) ? { octets: 2, table: new Map() } : null);
    }
    out.set(m[1], cache.get(num) ?? null);
  }
  return out;
}
/** Les pages dans l'ordre de l'arbre `/Pages`, sinon par numéro d'objet. */
function pagesPdf(objets: Map<number, ObjetPdf>, s: string): ObjetPdf[] {
  const racine = [...s.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)].pop();
  const catalogue = racine ? objets.get(Number(racine[1]))?.dict : undefined;
  const arbre = catalogue ? /\/Pages\s+(\d+)\s+\d+\s+R/.exec(catalogue) : null;
  const pages: ObjetPdf[] = [], vus = new Set<number>();
  const visiter = (num: number, profondeur: number) => {
    const o = objets.get(num);
    if (!o || vus.has(num) || profondeur > 30 || pages.length > 5000) return;
    vus.add(num);
    if (/\/Type\s*\/Page\b/.test(o.dict)) { pages.push(o); return; }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
    if (kids) for (const r of refs(kids[1])) visiter(r, profondeur + 1);
  };
  if (arbre) visiter(Number(arbre[1]), 0);
  if (pages.length) return pages;
  return [...objets.entries()].sort((a, b) => a[0] - b[0]).map(([, o]) => o).filter((o) => /\/Type\s*\/Page\b/.test(o.dict));
}

export function textePdf(octets: Buffer): Extraction {
  const s = octets.toString("latin1");
  if (!s.startsWith("%PDF")) return { nature: "pdf", texte: "", complet: false, note: "Ce n'est pas un PDF." };
  if (/\/Encrypt\s+(\d+\s+\d+\s+R|<<)/.test(s)) return { nature: "pdf", texte: "", complet: false, note: "PDF protégé : son texte n'est pas lu." };
  const objets = objetsPdf(octets), cache = new Map<number, CMap | null>();
  const pages = pagesPdf(objets, s);
  const morceaux: string[] = [];
  let complet = true, total = 0;
  for (const p of pages) {
    const polices = policesDe(objets, ressources(objets, p.dict), cache);
    const contenus = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(p.dict);
    let texte = "";
    for (const r of contenus ? refs(contenus[1]) : []) {
      const o = objets.get(r), d = o ? decoderFlux(o) : null;
      if (!d) { complet = false; continue; }
      texte += texteFlux(d, polices);
    }
    texte = texte.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    morceaux.push(texte);
    total += texte.length;
    if (total > TEXTE_MAX) { complet = false; break; }
  }
  const texte = morceaux.filter(Boolean).join("\n\n").slice(0, TEXTE_MAX);
  if (!texte.replace(/\s/g, "")) return { nature: "pdf", texte: "", complet: false, note: pages.length ? `PDF de ${pages.length} page${pages.length > 1 ? "s" : ""} sans texte lisible (document scanné ?).` : "Aucune page lisible." };
  return { nature: "pdf", texte, complet, note: `${pages.length} page${pages.length > 1 ? "s" : ""}.` };
}

/* ─── Images ───────────────────────────────────────────────────────────── */

function dimensions(b: Buffer): { l: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { l: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString("latin1", 0, 3) === "GIF") return { l: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const t = b.toString("latin1", 12, 16);
    if (t === "VP8X") return { l: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (t === "VP8 ") return { l: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (t === "VP8L") { const v = b.readUInt32LE(21); return { l: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], taille = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { l: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + taille;
    }
  }
  return null;
}
function nettoyerTexte(s: string): string {
  return s.replace(/\0+$/g, "").replace(/[\0-\x08\x0b\x0c\x0e-\x1f]/g, " ").replace(/\s+/g, " ").trim();
}
/** Champs EXIF utiles (IFD0 et EXIF) : description, auteur, titre et mots Windows, date de prise de vue. */
function exif(b: Buffer): string[] {
  const i = b.indexOf("Exif\0\0", 0, "latin1");
  if (i < 0 || i + 14 > b.length) return [];
  const t = i + 6, le = b.toString("latin1", t, t + 2) === "II";
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)), u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const out: string[] = [];
  const noms: Record<number, string> = { 0x010e: "Description", 0x013b: "Auteur", 0x8298: "Droits", 0x9003: "Prise le", 0x9c9b: "Titre", 0x9c9c: "Commentaire", 0x9c9d: "Auteur", 0x9c9e: "Mots-clés", 0x9c9f: "Sujet" };
  const lireIfd = (o: number, profondeur: number) => {
    if (profondeur > 2 || t + o + 2 > b.length) return;
    const n = u16(t + o);
    for (let k = 0; k < n && k < 200; k++) {
      const e = t + o + 2 + k * 12;
      if (e + 12 > b.length) return;
      const tag = u16(e), type = u16(e + 2), nb = u32(e + 4);
      if (tag === 0x8769) { lireIfd(u32(e + 8), profondeur + 1); continue; }
      const nom = noms[tag];
      if (!nom || nb > 4096) continue;
      const taille = type === 1 ? nb : type === 2 ? nb : 0;
      const debut = taille <= 4 ? e + 8 : t + u32(e + 8);
      if (debut + taille > b.length) continue;
      const brut = b.subarray(debut, debut + taille);
      const v = tag >= 0x9c9b ? nettoyerTexte(brut.toString("utf16le")) : nettoyerTexte(brut.toString("utf8"));
      if (v) out.push(`${nom} : ${tag === 0x9003 ? v.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") : v}`);
    }
  };
  lireIfd(u32(t + 4), 0);
  return out;
}
/** Titre, description, sujet, auteur d'un paquet XMP. */
function xmp(b: Buffer): string[] {
  const s = b.toString("utf8");
  const i = s.indexOf("<x:xmpmeta");
  if (i < 0) return [];
  const bloc = s.slice(i, s.indexOf("</x:xmpmeta>", i) + 12 || i + 200_000);
  const out: string[] = [];
  for (const [balise, nom] of [["dc:title", "Titre"], ["dc:description", "Description"], ["dc:subject", "Mots-clés"], ["dc:creator", "Auteur"], ["photoshop:Headline", "Titre"]] as const) {
    const m = new RegExp(`<${balise}[^>]*>([\\s\\S]*?)</${balise}>`).exec(bloc);
    if (!m) continue;
    const valeurs = [...m[1].matchAll(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g)].map((x) => x[1]);
    const v = nettoyerTexte((valeurs.length ? valeurs.join(", ") : m[1]).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\""));
    if (v) out.push(`${nom} : ${v}`);
  }
  return out;
}
/** Textes d'un PNG (tEXt, iTXt non compressé, zTXt). */
function textesPng(b: Buffer): string[] {
  const out: string[] = [];
  for (let i = 8; i + 12 <= b.length;) {
    const n = b.readUInt32BE(i), type = b.toString("latin1", i + 4, i + 8), d = b.subarray(i + 8, i + 8 + n);
    if (type === "IEND") break;
    const zero = d.indexOf(0);
    if (zero > 0 && (type === "tEXt" || type === "iTXt" || type === "zTXt")) {
      const cle = d.toString("latin1", 0, zero);
      let v = "";
      if (type === "tEXt") v = d.toString("latin1", zero + 1);
      else if (type === "zTXt") v = inflate(d.subarray(zero + 2))?.toString("latin1") ?? "";
      else if (d[zero + 1] === 0) { let k = zero + 3; for (let z = 0; z < 2; z++) k = d.indexOf(0, k) + 1; v = d.toString("utf8", k); }
      if (cle !== "XML:com.adobe.xmp" && /^(Title|Description|Comment|Author|Subject|Keywords|Source)$/i.test(cle)) { const t = nettoyerTexte(v); if (t) out.push(`${cle} : ${t}`); }
    }
    i += 12 + n;
  }
  return out;
}
export function texteImage(nom: string, b: Buffer): Extraction {
  const dim = dimensions(b);
  const champs = [...new Set([...exif(b), ...xmp(b), ...(b.readUInt32BE(0) === 0x89504e47 ? textesPng(b) : [])])];
  const lignes = [dim ? `Dimensions : ${dim.l} × ${dim.h} px` : null, ...champs].filter(Boolean) as string[];
  return { nature: "image", texte: lignes.join("\n"), complet: true, note: champs.length ? undefined : "Le fichier ne contient ni titre ni description." };
}

/* ─── Sons ─────────────────────────────────────────────────────────────── */

function duree(s: number): string {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m} min ${String(r).padStart(2, "0")} s` : `${r} s`;
}
/** Étiquettes ID3v2.3/2.4 (et 2.2) d'un MP3. */
function id3(b: Buffer): string[] {
  if (b.toString("latin1", 0, 3) !== "ID3") return [];
  const version = b[3], taille = ((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127);
  const noms: Record<string, string> = { TIT2: "Titre", TT2: "Titre", TPE1: "Artiste", TP1: "Artiste", TALB: "Album", TAL: "Album", TYER: "Année", TDRC: "Année", TYE: "Année", COMM: "Commentaire", COM: "Commentaire", USLT: "Paroles", ULT: "Paroles", TIT3: "Sous-titre", TCOM: "Compositeur" };
  const out: string[] = [];
  const texte = (d: Buffer) => {
    const enc = d[0], corps = d.subarray(1);
    return nettoyerTexte(enc === 1 || enc === 2 ? (enc === 2 ? Buffer.from(corps).swap16().toString("utf16le") : corps.toString("utf16le")) : enc === 3 ? corps.toString("utf8") : corps.toString("latin1"));
  };
  const v22 = version === 2, entete = v22 ? 6 : 10;
  for (let i = 10; i + entete < Math.min(b.length, 10 + taille);) {
    const id = b.toString("latin1", i, i + (v22 ? 3 : 4));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const n = v22 ? b.readUIntBE(i + 3, 3) : version === 4 ? ((b[i + 4] & 127) << 21) | ((b[i + 5] & 127) << 14) | ((b[i + 6] & 127) << 7) | (b[i + 7] & 127) : b.readUInt32BE(i + 4);
    const d = b.subarray(i + entete, i + entete + n);
    const nom = noms[id];
    if (nom && d.length > 1) {
      // COMM/USLT : encodage, langue sur 3 octets, description terminée par zéro, puis le texte.
      let v = "";
      if (id === "COMM" || id === "COM" || id === "USLT" || id === "ULT") {
        const enc = d[0], reste = d.subarray(4), large = enc === 1 || enc === 2;
        let k = 0;
        if (large) { while (k + 1 < reste.length && (reste[k] || reste[k + 1])) k += 2; k += 2; } else { k = reste.indexOf(0) + 1; }
        v = texte(Buffer.concat([Buffer.from([enc]), reste.subarray(k)]));
      } else v = texte(d);
      if (v) out.push(`${nom} : ${v.slice(0, nom === "Paroles" ? 20_000 : 500)}`);
    }
    i += entete + n;
  }
  return out;
}
/** Commentaires Vorbis (FLAC, Ogg Vorbis, Opus). */
function vorbis(b: Buffer, debut: number): string[] {
  const out: string[] = [];
  try {
    let i = debut + 4 + b.readUInt32LE(debut);
    const n = b.readUInt32LE(i); i += 4;
    const noms: Record<string, string> = { TITLE: "Titre", ARTIST: "Artiste", ALBUM: "Album", DATE: "Année", COMMENT: "Commentaire", DESCRIPTION: "Description", LYRICS: "Paroles" };
    for (let k = 0; k < n && k < 200 && i + 4 <= b.length; k++) {
      const l = b.readUInt32LE(i), v = b.toString("utf8", i + 4, i + 4 + l); i += 4 + l;
      const eg = v.indexOf("="), nom = noms[v.slice(0, eg).toUpperCase()];
      if (nom) out.push(`${nom} : ${nettoyerTexte(v.slice(eg + 1)).slice(0, 20_000)}`);
    }
  } catch { /* commentaire tronqué */ }
  return out;
}
export function texteAudio(nom: string, b: Buffer): Extraction {
  const lignes: string[] = [];
  const ext = nom.slice(nom.lastIndexOf(".")).toLowerCase();
  if (ext === ".mp3") lignes.push(...id3(b));
  if (ext === ".flac" && b.toString("latin1", 0, 4) === "fLaC") {
    for (let i = 4; i + 4 <= b.length;) {
      const type = b[i] & 127, n = b.readUIntBE(i + 1, 3), dernier = b[i] & 128;
      if (type === 0 && n >= 18) {
        const rate = (b.readUInt32BE(i + 14) >>> 12), total = (b[i + 17] & 15) * 2 ** 32 + b.readUInt32BE(i + 18);
        if (rate && total) lignes.push(`Durée : ${duree(total / rate)}`);
      }
      if (type === 4) lignes.push(...vorbis(b, i + 4));
      if (dernier) break;
      i += 4 + n;
    }
  }
  if (ext === ".ogg" || ext === ".opus") {
    for (const marque of ["\x03vorbis", "OpusTags"]) {
      const i = b.indexOf(marque, 0, "latin1");
      if (i >= 0) { lignes.push(...vorbis(b, i + marque.length)); break; }
    }
  }
  if (ext === ".wav" && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WAVE") {
    let octetsParSeconde = 0;
    for (let i = 12; i + 8 <= b.length;) {
      const id = b.toString("latin1", i, i + 4), n = b.readUInt32LE(i + 4);
      if (id === "fmt ") octetsParSeconde = b.readUInt32LE(i + 16);
      if (id === "data" && octetsParSeconde) lignes.push(`Durée : ${duree(n / octetsParSeconde)}`);
      if (id === "LIST" && b.toString("latin1", i + 8, i + 12) === "INFO") {
        const noms: Record<string, string> = { INAM: "Titre", IART: "Artiste", ICMT: "Commentaire", IPRD: "Album", ICRD: "Année", ISBJ: "Sujet" };
        for (let k = i + 12; k + 8 <= i + 8 + n;) {
          const sid = b.toString("latin1", k, k + 4), sn = b.readUInt32LE(k + 4);
          if (noms[sid]) { const v = nettoyerTexte(b.toString("utf8", k + 8, k + 8 + sn)); if (v) lignes.push(`${noms[sid]} : ${v}`); }
          k += 8 + sn + (sn & 1);
        }
      }
      i += 8 + n + (n & 1);
    }
  }
  return { nature: "audio", texte: lignes.join("\n"), complet: true, note: lignes.length ? undefined : "Le fichier ne porte aucune étiquette." };
}
