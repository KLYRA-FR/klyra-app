import { ancreDe } from "./liens";

/**
 * Lecture d'un document Markdown (CommonMark et GFM : titres, listes et cases
 * à cocher, citations et alertes, code, liens, images, tableaux, barré, en-tête
 * YAML) en un arbre que la visionneuse rend en éléments React. Aucun HTML n'est
 * rendu : les balises sont retirées (`<br>` devient un saut de ligne, le contenu
 * des `<script>` et `<style>` disparaît), le texte reste.
 */

export type Inline =
  | { type: "texte"; texte: string }
  | { type: "code"; texte: string }
  | { type: "gras" | "italique" | "barre"; enfants: Inline[] }
  | { type: "lien"; href: string; titre: string | null; enfants: Inline[] }
  | { type: "image"; src: string; alt: string; titre: string | null }
  | { type: "saut" };

export type Alignement = "gauche" | "centre" | "droite" | null;
export type Alerte = "note" | "astuce" | "important" | "attention" | "prudence";

export interface ElementListe {
  /** Case à cocher (`- [x]`) : cochée ou non ; null pour un élément ordinaire. */
  coche: boolean | null;
  blocs: Bloc[];
}

export type Bloc =
  | { type: "titre"; niveau: number; id: string; contenu: Inline[] }
  | { type: "paragraphe"; contenu: Inline[] }
  | { type: "code"; langage: string; texte: string }
  | { type: "citation"; alerte: Alerte | null; blocs: Bloc[] }
  | { type: "liste"; ordonnee: boolean; debut: number; serree: boolean; elements: ElementListe[] }
  | { type: "tableau"; alignements: Alignement[]; entete: Inline[][]; lignes: Inline[][][] }
  | { type: "separateur" };

export interface DocumentMarkdown {
  /** L'en-tête YAML (`---` … `---`), clé par clé. */
  proprietes: [string, string][];
  blocs: Bloc[];
}

interface Contexte {
  references: Map<string, { href: string; titre: string | null }>;
  ids: Map<string, number>;
}

/* ─── Blocs ─────────────────────────────────────────────────────── */

const CLOTURE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const TITRE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const SEPARATEUR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const CITATION = /^ {0,3}> ?(.*)$/;
const ELEMENT = /^( {0,3})([-+*]|\d{1,9}[.)])(?=[ \t]|$)/;
const SOULIGNE = /^ {0,3}(=+|-+)[ \t]*$/;
const DELIMITEUR = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const REFERENCE = /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/;
const ALERTE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i;
const ALERTES: Record<string, Alerte> = { note: "note", tip: "astuce", important: "important", warning: "attention", caution: "prudence" };

const normaliserEtiquette = (e: string) => e.trim().replace(/\s+/g, " ").toLowerCase();

export function lireMarkdown(source: string): DocumentMarkdown {
  let lignes = source
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\t+/, (t) => "    ".repeat(t.length)));
  const proprietes = lireEnTete(lignes);
  if (proprietes) lignes = lignes.slice(proprietes.fin + 1);

  // Les définitions de liens (`[nom]: url`) servent partout, même plus haut dans le document.
  const ctx: Contexte = { references: new Map(), ids: new Map() };
  let cloture: string | null = null;
  lignes = lignes.filter((l) => {
    const c = CLOTURE.exec(l);
    if (c && (!cloture || c[2].startsWith(cloture))) cloture = cloture ? null : c[2][0].repeat(c[2].length);
    if (cloture) return true;
    const r = REFERENCE.exec(l);
    if (!r) return true;
    const etiquette = normaliserEtiquette(r[1]);
    if (!ctx.references.has(etiquette)) ctx.references.set(etiquette, { href: r[2], titre: r[3] ?? r[4] ?? r[5] ?? null });
    return false;
  });

  return { proprietes: proprietes?.valeurs ?? [], blocs: lireBlocs(lignes, ctx) };
}

/** L'en-tête YAML d'un document (Obsidian, fiches d'agents) : clés simples, listes jointes. */
function lireEnTete(lignes: string[]): { valeurs: [string, string][]; fin: number } | null {
  if (lignes[0]?.trim() !== "---") return null;
  const fin = lignes.findIndex((l, i) => i > 0 && i < 400 && (l.trim() === "---" || l.trim() === "..."));
  if (fin < 0) return null;
  const valeurs: [string, string][] = [];
  for (const l of lignes.slice(1, fin)) {
    const cle = /^([^\s:#-][^:]*):[ \t]*(.*)$/.exec(l);
    if (cle) valeurs.push([cle[1].trim(), sansGuillemets(cle[2])]);
    else if (valeurs.length && l.trim() && /^\s/.test(l)) {
      const derniere = valeurs[valeurs.length - 1];
      const suite = sansGuillemets(l.trim().replace(/^- /, ""));
      derniere[1] = derniere[1] && !/^[|>]-?$/.test(derniere[1]) ? `${derniere[1]}${l.trim().startsWith("- ") ? ", " : " "}${suite}` : suite;
    }
  }
  return valeurs.length ? { valeurs, fin } : null;
}

const sansGuillemets = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2");

/** Une ligne qui commence un nouveau bloc (et interrompt donc un paragraphe). */
function debutDeBloc(l: string): boolean {
  if (TITRE.test(l) || CLOTURE.test(l) || SEPARATEUR.test(l) || CITATION.test(l)) return true;
  const e = ELEMENT.exec(l);
  return !!e && l.slice(e[0].length).trim() !== "";
}

const indentation = (l: string) => /^ */.exec(l)![0].length;

function estTableau(lignes: string[], i: number): boolean {
  const entete = lignes[i];
  const delimiteur = lignes[i + 1];
  if (!entete?.includes("|") || !delimiteur || !DELIMITEUR.test(delimiteur) || !delimiteur.includes("-")) return false;
  if (!delimiteur.includes("|") && !entete.trim().startsWith("|")) return false;
  return cellules(entete).length === cellules(delimiteur).length;
}

/** Les cellules d'une rangée de tableau ; `\|` reste une barre dans le texte. */
function cellules(ligne: string): string[] {
  let l = ligne.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|") && !l.endsWith("\\|")) l = l.slice(0, -1);
  const resultat: string[] = [];
  let courant = "";
  for (let i = 0; i < l.length; i++) {
    if (l[i] === "\\" && l[i + 1] === "|") {
      courant += "|";
      i++;
    } else if (l[i] === "|") {
      resultat.push(courant.trim());
      courant = "";
    } else courant += l[i];
  }
  resultat.push(courant.trim());
  return resultat;
}

function lireBlocs(lignes: string[], ctx: Contexte): Bloc[] {
  const blocs: Bloc[] = [];
  let i = 0;
  while (i < lignes.length) {
    const l = lignes[i];
    if (!l.trim()) {
      i++;
      continue;
    }

    // Commentaire HTML : ignoré, même sur plusieurs lignes.
    if (/^ {0,3}<!--/.test(l)) {
      while (i < lignes.length && !lignes[i].includes("-->")) i++;
      i++;
      continue;
    }

    const cloture = CLOTURE.exec(l);
    if (cloture && !(cloture[2][0] === "`" && cloture[3].includes("`"))) {
      const marque = cloture[2];
      const retrait = cloture[1].length;
      const code: string[] = [];
      i++;
      while (i < lignes.length) {
        const fin = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lignes[i]);
        if (fin && fin[1][0] === marque[0] && fin[1].length >= marque.length) break;
        code.push(lignes[i].replace(new RegExp(`^ {0,${retrait}}`), ""));
        i++;
      }
      i++;
      blocs.push({ type: "code", langage: cloture[3].trim().split(/\s+/)[0] ?? "", texte: code.join("\n") });
      continue;
    }

    const titre = TITRE.exec(l);
    if (titre) {
      const texte = (titre[2] ?? "").replace(/(^|[ \t]+)#+$/, "").trim();
      blocs.push(titreDe(Number(titre[1].length), texte, ctx));
      i++;
      continue;
    }

    if (SEPARATEUR.test(l)) {
      blocs.push({ type: "separateur" });
      i++;
      continue;
    }

    if (CITATION.test(l)) {
      const contenu: string[] = [];
      while (i < lignes.length) {
        const c = CITATION.exec(lignes[i]);
        if (c) contenu.push(c[1]);
        // Suite paresseuse : une ligne de texte sans « > » prolonge le paragraphe cité.
        else if (lignes[i].trim() && contenu[contenu.length - 1]?.trim() && !debutDeBloc(lignes[i])) contenu.push(lignes[i]);
        else break;
        i++;
      }
      const alerte = ALERTE.exec(contenu[0] ?? "");
      blocs.push({ type: "citation", alerte: alerte ? ALERTES[alerte[1].toLowerCase()] : null, blocs: lireBlocs(alerte ? contenu.slice(1) : contenu, ctx) });
      continue;
    }

    if (ELEMENT.test(l)) {
      const [liste, suite] = lireListe(lignes, i, ctx);
      blocs.push(liste);
      i = suite;
      continue;
    }

    if (estTableau(lignes, i)) {
      const alignements = cellules(lignes[i + 1]).map((c): Alignement => {
        const g = c.startsWith(":");
        const d = c.endsWith(":");
        return g && d ? "centre" : d ? "droite" : g ? "gauche" : null;
      });
      const largeur = alignements.length;
      const rangee = (ligne: string) => {
        const c = cellules(ligne).slice(0, largeur);
        while (c.length < largeur) c.push("");
        return c.map((t) => lireInline(t, ctx));
      };
      const entete = rangee(lignes[i]);
      const corps: Inline[][][] = [];
      i += 2;
      while (i < lignes.length && lignes[i].trim() && !debutDeBloc(lignes[i])) corps.push(rangee(lignes[i++]));
      blocs.push({ type: "tableau", alignements, entete, lignes: corps });
      continue;
    }

    if (indentation(l) >= 4) {
      const code: string[] = [];
      while (i < lignes.length && (indentation(lignes[i]) >= 4 || !lignes[i].trim())) code.push(lignes[i++].slice(4));
      while (code.length && !code[code.length - 1].trim()) code.pop();
      blocs.push({ type: "code", langage: "", texte: code.join("\n") });
      continue;
    }

    // Paragraphe, jusqu'à une ligne vide ou un autre bloc ; « === » ou « --- » dessous en fait un titre.
    const paragraphe: string[] = [];
    while (i < lignes.length && lignes[i].trim()) {
      if (paragraphe.length) {
        const souligne = SOULIGNE.exec(lignes[i]);
        if (souligne) {
          blocs.push(titreDe(souligne[1][0] === "=" ? 1 : 2, paragraphe.join("\n").trim(), ctx));
          paragraphe.length = 0;
          i++;
          break;
        }
        if (debutDeBloc(lignes[i]) || estTableau(lignes, i)) break;
      }
      paragraphe.push(lignes[i++].replace(/^ +/, ""));
    }
    if (paragraphe.length) {
      const contenu = lireInline(paragraphe.join("\n").replace(/[ \t]+$/, ""), ctx);
      // Un paragraphe qui n'était que du HTML (balises seules) ne laisse rien.
      if (contenu.some((n) => n.type !== "texte" || n.texte.trim())) blocs.push({ type: "paragraphe", contenu });
    }
  }
  return blocs;
}

function titreDe(niveau: number, texte: string, ctx: Contexte): Bloc {
  const contenu = lireInline(texte, ctx);
  const base = ancreDe(texteBrut(contenu)) || "titre";
  const deja = ctx.ids.get(base) ?? 0;
  ctx.ids.set(base, deja + 1);
  return { type: "titre", niveau, id: deja ? `${base}-${deja}` : base, contenu };
}

function lireListe(lignes: string[], depart: number, ctx: Contexte): [Bloc, number] {
  const premier = ELEMENT.exec(lignes[depart])!;
  const ordonnee = /\d/.test(premier[2]);
  const elements: ElementListe[] = [];
  let serree = true;
  let i = depart;
  while (i < lignes.length) {
    const m = ELEMENT.exec(lignes[i]);
    if (!m || /\d/.test(m[2]) !== ordonnee || (i > depart && SEPARATEUR.test(lignes[i]))) break;
    const apres = lignes[i].slice(m[0].length);
    const espaces = /^[ \t]*/.exec(apres)![0].length;
    const retrait = m[0].length + (apres.trim() === "" || espaces > 4 ? 1 : espaces);
    const contenu = [lignes[i].slice(retrait)];
    i++;
    while (i < lignes.length) {
      const l = lignes[i];
      if (!l.trim()) contenu.push("");
      else if (indentation(l) >= retrait) contenu.push(l.slice(retrait));
      else if (contenu[contenu.length - 1].trim() && !debutDeBloc(l)) contenu.push(l.trim());
      else break;
      i++;
    }
    let blancFinal = false;
    while (contenu.length > 1 && !contenu[contenu.length - 1].trim()) {
      contenu.pop();
      blancFinal = true;
    }
    if (contenu.some((l, k) => !l.trim() && k > 0 && contenu[k + 1]?.trim())) serree = false;
    const suivant = ELEMENT.exec(lignes[i] ?? "");
    if (blancFinal && suivant && /\d/.test(suivant[2]) === ordonnee) serree = false;

    const tache = /^\[([ xX])\][ \t]+/.exec(contenu[0]);
    if (tache) contenu[0] = contenu[0].slice(tache[0].length);
    elements.push({ coche: tache ? tache[1] !== " " : null, blocs: lireBlocs(contenu, ctx) });
    if (blancFinal && !suivant) break;
  }
  return [{ type: "liste", ordonnee, debut: ordonnee ? Number.parseInt(premier[2], 10) : 1, serree, elements }, i];
}

/* ─── En ligne ──────────────────────────────────────────────────── */

interface Delimiteur {
  type: "delim";
  car: string;
  n: number;
  ouvre: boolean;
  ferme: boolean;
}

const PONCTUATION = /[\p{P}\p{S}]/u;
const ECHAPPABLE = /[!-/:-@[-`{-~]/;
const ENTITES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", laquo: "«", raquo: "»", euro: "€", deg: "°", times: "×", middot: "·", bull: "•",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç",
};

/** Une expression collée à la position `i` (drapeau `y`). */
function en(re: RegExp, texte: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(texte);
}

const AUTOLIEN = /<((?:https?|mailto):[^\s<>]*|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/iy;
const BALISE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?\/?>/y;
const ENTITE = /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});/iy;
const ADRESSE = /(?:https?:\/\/|www\.)[^\s<]+/iy;

function lireInline(texte: string, ctx: Contexte, dansLien = false): Inline[] {
  const noeuds: (Inline | Delimiteur)[] = [];
  let tampon = "";
  const vider = () => {
    if (tampon) noeuds.push({ type: "texte", texte: tampon });
    tampon = "";
  };
  let i = 0;
  while (i < texte.length) {
    const c = texte[i];

    if (c === "\\") {
      const s = texte[i + 1];
      if (s === "\n") {
        vider();
        noeuds.push({ type: "saut" });
        i += 2;
      } else if (s && ECHAPPABLE.test(s)) {
        tampon += s;
        i += 2;
      } else {
        tampon += c;
        i++;
      }
      continue;
    }

    if (c === "`") {
      let n = 0;
      while (texte[i + n] === "`") n++;
      const fin = finDeCode(texte, i + n, n);
      if (fin < 0) {
        tampon += "`".repeat(n);
        i += n;
        continue;
      }
      vider();
      let code = texte.slice(i + n, fin).replace(/\n/g, " ");
      if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
      noeuds.push({ type: "code", texte: code });
      i = fin + n;
      continue;
    }

    if ((c === "[" || (c === "!" && texte[i + 1] === "[")) && !(dansLien && c === "[")) {
      const image = c === "!";
      const lien = lireLien(texte, image ? i + 1 : i, ctx);
      if (lien) {
        vider();
        noeuds.push(
          image
            ? { type: "image", src: lien.href, alt: texteBrut(lien.enfants), titre: lien.titre }
            : { type: "lien", href: lien.href, titre: lien.titre, enfants: lien.enfants },
        );
        i = lien.fin;
        continue;
      }
    }

    if (c === "<") {
      const auto = dansLien ? null : en(AUTOLIEN, texte, i);
      if (auto) {
        vider();
        const href = /^(https?|mailto):/i.test(auto[1]) ? auto[1] : `mailto:${auto[1]}`;
        noeuds.push({ type: "lien", href, titre: null, enfants: [{ type: "texte", texte: auto[1] }] });
        i += auto[0].length;
        continue;
      }
      if (texte.startsWith("<!--", i)) {
        const fin = texte.indexOf("-->", i + 4);
        i = fin < 0 ? texte.length : fin + 3;
        continue;
      }
      const balise = en(BALISE, texte, i);
      if (balise) {
        const nom = balise[2].toLowerCase();
        i += balise[0].length;
        if (nom === "br") {
          vider();
          noeuds.push({ type: "saut" });
        } else if (!balise[1] && ["script", "style", "textarea", "iframe", "template"].includes(nom)) {
          const fin = texte.toLowerCase().indexOf(`</${nom}`, i);
          i = fin < 0 ? texte.length : texte.indexOf(">", fin) + 1 || texte.length;
        }
        continue;
      }
    }

    if (c === "&") {
      const e = en(ENTITE, texte, i);
      const decode = e ? entite(e[1]) : null;
      if (e && decode !== null) {
        tampon += decode;
        i += e[0].length;
        continue;
      }
    }

    if (c === "\n") {
      // Deux espaces en fin de ligne : saut de ligne ; sinon les lignes se suivent.
      if (/ {2,}$/.test(tampon)) {
        tampon = tampon.replace(/ +$/, "");
        vider();
        noeuds.push({ type: "saut" });
      } else tampon = `${tampon.replace(/ +$/, "")} `;
      i++;
      while (texte[i] === " ") i++;
      continue;
    }

    if (c === "*" || c === "_" || c === "~") {
      let n = 0;
      while (texte[i + n] === c) n++;
      const avant = i > 0 ? texte[i - 1] : " ";
      const apres = texte[i + n] ?? " ";
      const blancAvant = /\s/.test(avant);
      const blancApres = /\s/.test(apres);
      const pAvant = PONCTUATION.test(avant);
      const pApres = PONCTUATION.test(apres);
      const gauche = !blancApres && (!pApres || blancAvant || pAvant);
      const droite = !blancAvant && (!pAvant || blancApres || pApres);
      vider();
      noeuds.push({
        type: "delim",
        car: c,
        n,
        ouvre: c === "_" ? gauche && (!droite || pAvant) : gauche,
        ferme: c === "_" ? droite && (!gauche || pApres) : droite,
      });
      i += n;
      continue;
    }

    // Adresses nues (extension GFM) : https://… et www.…
    if (!dansLien && (c === "h" || c === "H" || c === "w" || c === "W") && (i === 0 || /[\s*_~(]/.test(texte[i - 1]))) {
      const adresse = en(ADRESSE, texte, i);
      if (adresse) {
        const brut = rognerAdresse(adresse[0]);
        if (brut.replace(/^(?:https?:\/\/|www\.)/i, "")) {
          vider();
          noeuds.push({ type: "lien", href: /^www\./i.test(brut) ? `https://${brut}` : brut, titre: null, enfants: [{ type: "texte", texte: brut }] });
          i += brut.length;
          continue;
        }
      }
    }

    tampon += c;
    i++;
  }
  vider();
  return emphases(noeuds);
}

/** La fin d'un code en ligne : une suite d'exactement `n` accents graves. */
function finDeCode(texte: string, depuis: number, n: number): number {
  let i = texte.indexOf("`".repeat(n), depuis);
  while (i >= 0) {
    let k = 0;
    while (texte[i + k] === "`") k++;
    if (k === n) return i;
    i = texte.indexOf("`".repeat(n), i + k);
  }
  return -1;
}

/** Sans la ponctuation de fin de phrase ni une parenthèse fermante orpheline. */
function rognerAdresse(adresse: string): string {
  let a = adresse;
  for (;;) {
    if (/[?!.,:*_~'";]$/.test(a)) a = a.slice(0, -1);
    else if (a.endsWith(")") && (a.match(/\)/g)?.length ?? 0) > (a.match(/\(/g)?.length ?? 0)) a = a.slice(0, -1);
    else return a;
  }
}

function entite(code: string): string | null {
  if (code[0] !== "#") return ENTITES[code.toLowerCase()] ?? null;
  const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "�";
}

/** `[texte](adresse "titre")`, `[texte][ref]`, `[ref][]` ou `[ref]`, à partir du crochet ouvrant. */
function lireLien(texte: string, debut: number, ctx: Contexte): { href: string; titre: string | null; enfants: Inline[]; fin: number } | null {
  let profondeur = 0;
  let j = debut;
  for (; j < texte.length; j++) {
    const c = texte[j];
    if (c === "\\") j++;
    else if (c === "`") {
      let n = 0;
      while (texte[j + n] === "`") n++;
      const fin = finDeCode(texte, j + n, n);
      j = fin < 0 ? j + n - 1 : fin + n - 1;
    } else if (c === "[") profondeur++;
    else if (c === "]" && --profondeur === 0) break;
  }
  if (j >= texte.length) return null;
  const etiquette = texte.slice(debut + 1, j);
  const enfants = () => lireInline(etiquette, ctx, true);

  if (texte[j + 1] === "(") {
    const cible = /\(\s*(?:<([^<>\n]*)>|((?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*))(?:\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\(((?:[^()\\]|\\.)*)\)))?\s*\)/y;
    const m = en(cible, texte, j + 1);
    if (m) {
      const href = (m[1] ?? m[2] ?? "").replace(/\\([!-/:-@[-`{-~])/g, "$1");
      const titre = m[3] ?? m[4] ?? m[5] ?? null;
      return { href, titre, enfants: enfants(), fin: j + 1 + m[0].length };
    }
  }
  const complete = en(/\[((?:[^\]\\]|\\.)*)\]/y, texte, j + 1);
  const cle = normaliserEtiquette(complete && complete[1] ? complete[1] : etiquette);
  const reference = ctx.references.get(cle);
  if (!reference) return null;
  return { ...reference, enfants: enfants(), fin: complete ? j + 1 + complete[0].length : j + 1 };
}

/** Gras, italique et barré : chaque délimiteur fermant cherche l'ouvrant le plus proche (CommonMark, simplifié). */
function emphases(noeuds: (Inline | Delimiteur)[]): Inline[] {
  for (let i = 0; i < noeuds.length; i++) {
    const fermant = noeuds[i];
    if (fermant.type !== "delim" || !fermant.ferme || (fermant.car === "~" && fermant.n > 2)) continue;
    while (fermant.n > 0) {
      let j = i - 1;
      for (; j >= 0; j--) {
        const o = noeuds[j];
        if (o.type === "delim" && o.car === fermant.car && o.ouvre && o.n > 0 && (o.car !== "~" || o.n === fermant.n)) break;
      }
      if (j < 0) break;
      const ouvrant = noeuds[j] as Delimiteur;
      const n = fermant.car === "~" ? fermant.n : ouvrant.n >= 2 && fermant.n >= 2 ? 2 : 1;
      const type = fermant.car === "~" ? "barre" : n === 2 ? "gras" : "italique";
      const interieur = enTexte(noeuds.slice(j + 1, i));
      ouvrant.n -= n;
      fermant.n -= n;
      noeuds.splice(j + 1, i - j - 1, { type, enfants: interieur });
      i = j + 2;
      if (ouvrant.n === 0) {
        noeuds.splice(j, 1);
        i--;
      }
    }
    if (fermant.n === 0) {
      noeuds.splice(i, 1);
      i--;
    }
  }
  return enTexte(noeuds);
}

/** Les délimiteurs restés seuls redeviennent du texte ; les textes voisins sont joints. */
function enTexte(noeuds: (Inline | Delimiteur)[]): Inline[] {
  const resultat: Inline[] = [];
  for (const n of noeuds) {
    const noeud: Inline = n.type === "delim" ? { type: "texte", texte: n.car.repeat(n.n) } : n;
    const dernier = resultat[resultat.length - 1];
    if (noeud.type === "texte" && dernier?.type === "texte") resultat[resultat.length - 1] = { type: "texte", texte: dernier.texte + noeud.texte };
    else if (noeud.type !== "texte" || noeud.texte) resultat.push(noeud);
  }
  return resultat;
}

/** Le texte seul d'une suite d'éléments en ligne (texte alternatif, ancre d'un titre). */
export function texteBrut(noeuds: Inline[]): string {
  return noeuds
    .map((n) => {
      if (n.type === "texte" || n.type === "code") return n.texte;
      if (n.type === "image") return n.alt;
      if (n.type === "saut") return " ";
      return texteBrut(n.enfants);
    })
    .join("");
}
