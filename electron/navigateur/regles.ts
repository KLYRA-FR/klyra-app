/**
 * Le navigateur de KLYRA : les règles pures, sans Electron (testées par
 * `regles.test.mts`). Ce que la barre d'adresse accepte, les touches envoyées
 * à une page, et la lecture d'une page telle qu'un agent la reçoit.
 *
 * Les scripts lus dans la page (`SCRIPT_*`) tournent dans un monde isolé : ils
 * voient le DOM de la page, pas ses variables, et la page ne voit pas les leurs
 * (les références `eN` vivent là, jusqu'à la navigation suivante).
 */

/** Le moteur de recherche d'une saisie qui n'est pas une adresse. */
export const RECHERCHE = "https://www.google.com/search?q=";
export const LONGUEUR_ADRESSE_MAX = 4_096;

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

/** Seules les pages web : http(s), et la page vide. Ni fichier, ni javascript:, ni protocole d'une app. */
export function adresseAutorisee(url: string): boolean {
  if (url === "about:blank") return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Ce que la personne (ou un agent) tape dans la barre d'adresse : une adresse
 * complète, un domaine (« klyra.fr » → https), un serveur local (« localhost:3000 » → http)
 * ou des mots, cherchés. Lève une erreur pour un protocole refusé.
 */
export function normaliserAdresse(saisie: string): string {
  const valeur = String(saisie ?? "").trim();
  if (!valeur) throw new Error("L’adresse est vide.");
  if (valeur.length > LONGUEUR_ADRESSE_MAX) throw new Error("L’adresse est trop longue.");
  if (valeur === "about:blank") return valeur;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(valeur) || /^(javascript|data|file|blob|mailto|about|chrome|devtools|view-source):/i.test(valeur)) {
    let u: URL;
    try {
      u = new URL(valeur);
    } catch {
      throw new Error("Adresse illisible.");
    }
    if (!adresseAutorisee(u.toString())) throw new Error("Le navigateur de KLYRA n’ouvre que des pages web (http ou https).");
    return u.toString();
  }
  if (/\s/.test(valeur)) return RECHERCHE + encodeURIComponent(valeur);
  const hote = valeur.split(/[/?#]/)[0];
  const sansPort = hote.replace(/:\d+$/, "");
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(sansPort);
  if (LOCAL.test(sansPort) || ip) {
    try {
      return new URL(`http://${valeur}`).toString();
    } catch {
      throw new Error("Adresse illisible.");
    }
  }
  if (/^[^.\s]+(\.[^.\s]+)+$/.test(sansPort) && /[a-z]{2,}$/i.test(sansPort)) {
    try {
      return new URL(`https://${valeur}`).toString();
    } catch {
      /* des mots, en fin de compte */
    }
  }
  return RECHERCHE + encodeURIComponent(valeur);
}

/** Le site d'une adresse, pour un titre court. */
export function hoteDe(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

/* ─── Touches ──────────────────────────────────────────────────── */

/** Un événement clavier du protocole de débogage (Input.dispatchKeyEvent). */
export interface EvenementTouche {
  type: "rawKeyDown" | "char" | "keyUp";
  key: string;
  code: string;
  windowsVirtualKeyCode?: number;
  text?: string;
  modifiers: number;
}

/**
 * `text` : le caractère que la touche produit. Chromium soumet un formulaire et
 * ajoute une ligne sur l'événement « char » : Entrée sans `\r` ne ferait rien
 * (repris d'OpenBot). Tab n'en a pas : le focus change sur la touche.
 */
const TOUCHES: Record<string, [string, string, number, string?]> = {
  enter: ["Enter", "Enter", 13, "\r"],
  entree: ["Enter", "Enter", 13, "\r"],
  return: ["Enter", "Enter", 13, "\r"],
  tab: ["Tab", "Tab", 9],
  escape: ["Escape", "Escape", 27],
  esc: ["Escape", "Escape", 27],
  echap: ["Escape", "Escape", 27],
  backspace: ["Backspace", "Backspace", 8],
  delete: ["Delete", "Delete", 46],
  suppr: ["Delete", "Delete", 46],
  space: [" ", "Space", 32, " "],
  espace: [" ", "Space", 32, " "],
  arrowup: ["ArrowUp", "ArrowUp", 38],
  arrowdown: ["ArrowDown", "ArrowDown", 40],
  arrowleft: ["ArrowLeft", "ArrowLeft", 37],
  arrowright: ["ArrowRight", "ArrowRight", 39],
  home: ["Home", "Home", 36],
  end: ["End", "End", 35],
  pageup: ["PageUp", "PageUp", 33],
  pagedown: ["PageDown", "PageDown", 34],
};

const MODIFICATEURS: Record<string, [string, number]> = {
  alt: ["Alt", 1],
  option: ["Alt", 1],
  ctrl: ["Control", 2],
  control: ["Control", 2],
  meta: ["Meta", 4],
  cmd: ["Meta", 4],
  command: ["Meta", 4],
  shift: ["Shift", 8],
  maj: ["Shift", 8],
};

/**
 * Les événements d'une touche ou d'un raccourci (« Enter », « Control+A »,
 * « Shift+Tab ») : modificateurs enfoncés, la touche, son caractère s'il y en a
 * un et qu'aucune commande n'est tenue, puis tout relâché dans l'ordre inverse.
 */
export function evenementsTouche(combinaison: string): EvenementTouche[] {
  const parts = String(combinaison ?? "")
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length || parts.length > 5) throw new Error(`Touche illisible : « ${combinaison} ».`);
  const nomTouche = parts.pop()!;
  const mods: [string, number][] = parts.map((p) => {
    const m = MODIFICATEURS[p.toLowerCase()];
    if (!m) throw new Error(`Modificateur inconnu : « ${p} » (Alt, Control, Meta, Shift).`);
    return m;
  });
  const masque = mods.reduce((n, [, bit]) => n | bit, 0);
  const alias = TOUCHES[nomTouche.toLowerCase()];
  let touche: Omit<EvenementTouche, "type" | "modifiers">;
  if (alias) {
    touche = { key: alias[0], code: alias[1], windowsVirtualKeyCode: alias[2], ...(alias[3] ? { text: alias[3] } : {}) };
  } else if ([...nomTouche].length === 1) {
    const lettre = /^[a-z]$/i.test(nomTouche);
    const majuscule = masque === 8 && lettre ? nomTouche.toUpperCase() : nomTouche;
    touche = {
      key: majuscule,
      code: lettre ? `Key${nomTouche.toUpperCase()}` : /^\d$/.test(nomTouche) ? `Digit${nomTouche}` : "Unidentified",
      ...(lettre ? { windowsVirtualKeyCode: nomTouche.toUpperCase().charCodeAt(0) } : /^\d$/.test(nomTouche) ? { windowsVirtualKeyCode: nomTouche.charCodeAt(0) } : {}),
      text: majuscule,
    };
  } else if (/^F([1-9]|1[0-2])$/i.test(nomTouche)) {
    const n = Number(nomTouche.slice(1));
    touche = { key: `F${n}`, code: `F${n}`, windowsVirtualKeyCode: 111 + n };
  } else throw new Error(`Touche inconnue : « ${nomTouche} ».`);

  /* Une commande (Control+S) n'écrit pas de « s » ; Shift seul garde son caractère. */
  const avecCaractere = touche.text !== undefined && (masque === 0 || masque === 8);
  const { text, ...sansTexte } = touche;
  const evenements: EvenementTouche[] = [];
  let tenus = 0;
  for (const [nom, bit] of mods) {
    tenus |= bit;
    evenements.push({ type: "rawKeyDown", key: nom, code: `${nom}Left`, modifiers: tenus });
  }
  evenements.push({ type: "rawKeyDown", ...sansTexte, modifiers: masque });
  if (avecCaractere) evenements.push({ type: "char", ...sansTexte, text, modifiers: masque });
  evenements.push({ type: "keyUp", ...sansTexte, modifiers: masque });
  for (const [nom, bit] of [...mods].reverse()) {
    tenus &= ~bit;
    evenements.push({ type: "keyUp", key: nom, code: `${nom}Left`, modifiers: tenus });
  }
  return evenements;
}

/* ─── Lecture d'une page ───────────────────────────────────────── */

export interface ElementPage {
  ref?: string;
  role: string;
  nom: string;
  valeur?: string;
  etats?: string[];
  /** Visible dans la fenêtre de la page sans défiler. */
  vu: boolean;
  /** Un titre de la page (niveau 1 à 3), sans référence. */
  niveau?: number;
}

export interface InstantanePage {
  titre: string;
  url: string;
  vue: { largeur: number; hauteur: number };
  defilement: { y: number; max: number };
  elements: ElementPage[];
  /** Cadres (iframes) que la lecture ne traverse pas. */
  cadres: number;
  texte: string;
  /** La longueur totale du texte de la page. */
  texteTotal: number;
  /** Les cadres de la page (leur élément iframe a une référence, pour les situer). */
  iframes?: { ref: string; nom: string; src: string; visible: boolean }[];
  /** Les cadres lus, à la suite de la page : leurs éléments ont des références préfixées (c1e4). */
  cadresLus?: CadreLu[];
}

export interface CadreLu {
  prefixe: string;
  origine: string;
  elements: ElementPage[];
  texte: string;
}

/** Le nombre d'éléments listés au plus, et de caractères de texte avec eux. */
export const ELEMENTS_MAX = 150;
export const EXTRAIT_TEXTE = 1_500;
export const TEXTE_MAX = 12_000;

const court = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

/** Garde au plus `max` éléments : ceux qu'on voit d'abord, puis la suite de la page, dans l'ordre du document. */
export function choisirElements(elements: ElementPage[], max: number): { gardes: ElementPage[]; omis: number } {
  const avecRef = elements.filter((e) => e.ref);
  if (avecRef.length <= max) return { gardes: elements, omis: 0 };
  const choisis = new Set<ElementPage>(avecRef.filter((e) => e.vu).slice(0, max));
  for (const e of avecRef) {
    if (choisis.size >= max) break;
    choisis.add(e);
  }
  return { gardes: elements.filter((e) => !e.ref || choisis.has(e)), omis: avecRef.length - choisis.size };
}

/** Une ligne par élément : `[e3] bouton « Envoyer »`, `[e4] champ (email) « E-mail » = "…"`. */
export function ligneElement(e: ElementPage): string {
  if (e.niveau) return `${"#".repeat(e.niveau)} ${court(e.nom, 120)}`;
  const nom = e.nom ? ` « ${court(e.nom, 100)} »` : "";
  const valeur = e.valeur !== undefined && e.valeur !== "" ? ` = "${court(e.valeur, 80)}"` : "";
  const etats = [...(e.etats ?? []), ...(e.vu ? [] : ["hors écran"])];
  return `[${e.ref}] ${e.role}${nom}${valeur}${etats.length ? ` · ${etats.join(", ")}` : ""}`;
}

/**
 * La page telle qu'un agent la lit : son adresse, ses éléments avec leur
 * référence, puis un extrait du texte. `requete` ne garde que ce qui la contient.
 */
export function formaterInstantane(i: InstantanePage, options: { requete?: string; max?: number } = {}): string {
  const requete = options.requete?.trim().toLowerCase();
  const correspond = (t: string) => !requete || t.toLowerCase().includes(requete);
  const filtres = requete ? i.elements.filter((e) => correspond(`${e.role} ${e.nom} ${e.valeur ?? ""}`)) : i.elements;
  const { gardes, omis } = choisirElements(filtres, options.max ?? ELEMENTS_MAX);
  const lignes = [
    `Page : ${i.titre || "(sans titre)"} — ${i.url}`,
    `Fenêtre ${i.vue.largeur}×${i.vue.hauteur} px, défilée à ${Math.round(i.defilement.y)} sur ${Math.max(0, Math.round(i.defilement.max))} px.`,
  ];
  if (requete) lignes.push(`Seulement ce qui contient « ${options.requete!.trim()} ».`);
  lignes.push("", gardes.length ? "Éléments (vise-les par leur référence [eN]) :" : "Aucun élément interactif" + (requete ? " qui corresponde." : " trouvé."));
  for (const e of gardes) lignes.push(ligneElement(e));
  if (omis) lignes.push(`… ${omis} autres éléments non listés : précise « requete », ou fais défiler.`);
  for (const c of i.cadresLus ?? []) {
    const dedans = requete ? c.elements.filter((e) => correspond(`${e.role} ${e.nom} ${e.valeur ?? ""}`)) : c.elements;
    const { gardes: gc, omis: oc } = choisirElements(dedans, Math.max(20, Math.floor((options.max ?? ELEMENTS_MAX) / 3)));
    if (!gc.length && requete) continue;
    lignes.push("", `Cadre ${c.prefixe} (${c.origine}) :`);
    for (const e of gc) lignes.push(ligneElement(e));
    if (!gc.length) lignes.push(c.texte.trim() ? `(texte seul) ${court(c.texte.trim(), 300)}` : "(vide)");
    if (oc) lignes.push(`… ${oc} autres éléments dans ce cadre.`);
  }
  const nonLus = i.cadres - (i.cadresLus?.length ?? 0);
  if (nonLus > 0) lignes.push(`La page contient ${nonLus} cadre${nonLus > 1 ? "s" : ""} (iframe) non lu${nonLus > 1 ? "s" : ""} (vide, caché ou imbriqué) : utilise navigateur_capture et des coordonnées.`);
  const texte = requete
    ? i.texte
        .split("\n")
        .filter((l) => correspond(l))
        .join("\n")
    : i.texte;
  if (texte.trim()) {
    lignes.push("", requete ? "Texte qui la contient :" : "Début du texte :", court(texte.trim(), EXTRAIT_TEXTE));
    if (!requete && i.texteTotal > EXTRAIT_TEXTE) lignes.push(`[${i.texteTotal} caractères en tout : navigateur_lire avec mode « texte » pour la suite.]`);
  }
  return lignes.join("\n");
}

/** Le texte de la page, par tranches : `depuis` donne la suite. */
export function trancheTexte(texte: string, depuis = 0, max = TEXTE_MAX): string {
  const debut = Math.max(0, Math.floor(depuis) || 0);
  const tranche = texte.slice(debut, debut + max);
  const fin = debut + tranche.length;
  return `${tranche}${fin < texte.length ? `\n\n[Caractères ${debut} à ${fin} sur ${texte.length} : demande la suite avec depuis = ${fin}.]` : ""}`;
}

/* ─── Scripts lus dans la page (monde isolé) ───────────────────── */

/** L'identifiant du monde isolé de KLYRA dans chaque page. */
export const MONDE_ISOLE = 1_207;

/**
 * Commun à tous les scripts : l'état des références (`eN` ↔ élément, faible),
 * la visibilité, le nom accessible et les champs qu'un agent ne remplit jamais.
 */
const commun = (prefixe = "") => String.raw`
const K = window.__klyra || (window.__klyra = { n: 0, refs: new Map(), ids: new WeakMap() });
const propre = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const refDe = (el) => {
  let id = K.ids.get(el);
  if (!id) { id = ${JSON.stringify(prefixe)} + "e" + (++K.n); K.ids.set(el, id); K.refs.set(id, new WeakRef(el)); }
  return id;
};
const elementDe = (ref) => { const w = K.refs.get(String(ref)); const el = w && w.deref(); return el && el.isConnected ? el : null; };
const boite = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return null;
  return r;
};
const protege = (el) => {
  if (!el || el.tagName !== "INPUT") return false;
  const type = (el.getAttribute("type") || "").toLowerCase();
  const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
  return type === "password" || /one-time-code|cc-number|cc-csc|cc-exp|current-password|new-password/.test(auto);
};
const nomDe = (el) => {
  const aria = el.getAttribute("aria-label");
  if (aria && propre(aria)) return propre(aria);
  const par = el.getAttribute("aria-labelledby");
  if (par) {
    const t = par.split(/\s+/).map((id) => { const c = document.getElementById(id); return c ? c.innerText || c.textContent : ""; }).join(" ");
    if (propre(t)) return propre(t);
  }
  if (el.labels && el.labels.length) {
    // Le texte du label seul, sans celui du champ qu'il contient (les options d'une liste).
    const t = [...el.labels].map((l) => { const c = l.cloneNode(true); c.querySelectorAll("input,select,textarea,button").forEach((x) => x.remove()); return c.textContent; }).join(" ");
    if (propre(t)) return propre(t);
  }
  const tag = el.tagName;
  if (tag === "INPUT" && /^(submit|button|reset)$/i.test(el.type)) return propre(el.value);
  if (tag === "IMG") return propre(el.alt);
  const interieur = propre(el.innerText || el.textContent);
  if (interieur && tag !== "SELECT" && tag !== "TEXTAREA" && tag !== "INPUT") return interieur.slice(0, 200);
  const img = el.querySelector && el.querySelector("img[alt]");
  if (img && propre(img.alt)) return propre(img.alt);
  return propre(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "");
};
`;
const COMMUN = commun();

/**
 * La page : éléments interactifs (avec référence) et titres, dans l'ordre du document, et le texte visible.
 * `prefixe` : celui des références d'un cadre (« c1 » → c1e4) ; la page principale n'en a pas.
 */
export const scriptInstantane = (prefixe = "") => String.raw`(() => {
${commun(prefixe)}
const SEL = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[contenteditable=""],[contenteditable=true],[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=option],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[role=slider],[tabindex]:not([tabindex="-1"]),h1,h2,h3';
const racines = [document];
for (let i = 0; i < racines.length && i < 200; i++) {
  for (const el of racines[i].querySelectorAll("*")) if (el.shadowRoot) racines.push(el.shadowRoot);
}
const vus = new Set();
const liste = [];
for (const r of racines) for (const el of r.querySelectorAll(SEL)) if (!vus.has(el)) { vus.add(el); liste.push(el); }
if (racines.length > 1) liste.sort((a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1));
const vw = innerWidth, vh = innerHeight;
const ROLES = { tab: "onglet", menuitem: "élément de menu", menuitemcheckbox: "élément de menu", option: "option", switch: "interrupteur", combobox: "liste", slider: "curseur", searchbox: "champ (recherche)", textbox: "zone de texte", checkbox: "case", radio: "bouton radio", button: "bouton", link: "lien" };
const elements = [];
for (const el of liste) {
  if (elements.length >= 1500) break;
  const r = boite(el);
  if (!r) continue;
  const tag = el.tagName;
  const vu = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
  if (/^H[1-3]$/.test(tag)) { const t = propre(el.innerText); if (t) elements.push({ role: "titre", nom: t.slice(0, 160), niveau: Number(tag[1]), vu }); continue; }
  const roleAria = (el.getAttribute("role") || "").toLowerCase();
  const type = (el.getAttribute("type") || "text").toLowerCase();
  let role = ROLES[roleAria] || "élément";
  let valeur;
  const etats = [];
  if (tag === "A") role = roleAria && ROLES[roleAria] ? ROLES[roleAria] : "lien";
  else if (tag === "BUTTON" || (tag === "INPUT" && /^(submit|button|reset|image)$/.test(type))) role = "bouton";
  else if (tag === "INPUT" && type === "checkbox") role = "case";
  else if (tag === "INPUT" && type === "radio") role = "bouton radio";
  else if (tag === "INPUT" && type === "file") role = "fichier";
  else if (tag === "INPUT" && type === "range") { role = "curseur"; valeur = el.value; }
  else if (tag === "INPUT") {
    if (protege(el)) { role = type === "password" ? "champ mot de passe" : "champ protégé"; if (el.value) valeur = "••• (rempli)"; }
    else { role = type === "text" ? "champ" : "champ (" + type + ")"; valeur = el.value; }
  } else if (tag === "TEXTAREA") { role = "zone de texte"; valeur = el.value; }
  else if (tag === "SELECT") {
    role = "liste";
    const opts = [...el.options];
    valeur = opts.filter((o) => o.selected).map((o) => propre(o.text)).join(", ");
    const choix = opts.slice(0, 12).map((o) => propre(o.text)).filter(Boolean);
    if (choix.length) etats.push("choix : " + choix.join(" | ") + (opts.length > 12 ? " | …" : ""));
  } else if (tag === "SUMMARY") role = "dépliant";
  else if (el.isContentEditable && !roleAria) { role = "zone de texte"; valeur = propre(el.innerText).slice(0, 120); }
  if (el.disabled || el.getAttribute("aria-disabled") === "true") etats.push("désactivé");
  if (el.checked || el.getAttribute("aria-checked") === "true") etats.push("coché");
  if (el.required || el.getAttribute("aria-required") === "true") etats.push("requis");
  const ex = el.getAttribute("aria-expanded");
  if (ex === "true") etats.push("ouvert"); else if (ex === "false") etats.push("fermé");
  if (el.getAttribute("aria-selected") === "true") etats.push("sélectionné");
  if (el === document.activeElement) etats.push("focus");
  let nom = nomDe(el);
  if (!nom && tag === "A") { try { const u = new URL(el.href); nom = u.host === location.host ? u.pathname : u.host + u.pathname; } catch {} }
  if (!nom && valeur === undefined && role === "élément") continue;
  elements.push({ ref: refDe(el), role, nom, ...(valeur !== undefined ? { valeur: String(valeur) } : {}), ...(etats.length ? { etats } : {}), vu });
}
const corps = document.body ? document.body.innerText || "" : "";
const texte = corps.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const max = Math.max(0, (document.scrollingElement || document.documentElement).scrollHeight - vh);
const iframes = [...document.querySelectorAll("iframe,frame")].map((f) => ({ ref: refDe(f), nom: f.name || "", src: f.src || "", visible: !!boite(f) }));
return { titre: document.title, url: location.href, vue: { largeur: vw, hauteur: vh }, defilement: { y: scrollY, max }, elements, cadres: iframes.length, iframes, texte, texteTotal: texte.length };
})()`;
export const SCRIPT_INSTANTANE = scriptInstantane();

/** Où viser un élément : il est amené au centre de la fenêtre, puis on rend le centre de sa boîte. */
export function scriptCible(ref: string): string {
  return String.raw`(() => {
${COMMUN}
const el = elementDe(${JSON.stringify(ref)});
if (!el) return { ok: false, raison: "La référence ${ref.replace(/[^\w-]/g, "")} n’existe plus (la page a changé) : relis la page avec navigateur_lire." };
el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
const r = boite(el);
if (!r) return { ok: false, raison: "Cet élément n’est pas visible." };
const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
const dessus = document.elementFromPoint(x, y);
const recouvert = !!dessus && dessus !== el && !el.contains(dessus) && !dessus.contains(el);
return { ok: true, x, y, protege: protege(el), desactive: !!el.disabled, nom: nomDe(el).slice(0, 80), recouvert: recouvert ? propre(dessus.innerText || dessus.tagName).slice(0, 60) : null };
})()`;
}

/** Met le focus sur un élément (ou garde celui de la page) et, au besoin, sélectionne son contenu pour le remplacer. */
export function scriptFocus(ref: string | null, effacer: boolean): string {
  return String.raw`(() => {
${COMMUN}
let el = ${ref ? `elementDe(${JSON.stringify(ref)})` : "document.activeElement"};
${ref ? `if (!el) return { ok: false, raison: "La référence n’existe plus (la page a changé) : relis la page avec navigateur_lire." };` : ""}
while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
if (!el || el === document.body) return { ok: true, editable: false, protege: false };
if (protege(el)) return { ok: true, editable: true, protege: true };
${ref ? `el.focus({ preventScroll: false });` : ""}
const editable = el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(checkbox|radio|submit|button|reset|file|image|range|color)$/i.test(el.type));
if (${effacer ? "true" : "false"} && editable) {
  if (el.isContentEditable) { const s = getSelection(); const r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); }
  else if (typeof el.select === "function") el.select();
}
return { ok: true, editable, protege: false, avant: el.isContentEditable ? el.innerText : (el.value ?? "") };
})()`;
}

/** Après une frappe : la valeur de l'élément qui a le focus, pour vérifier qu'elle est arrivée. */
export const SCRIPT_VALEUR_FOCUS = String.raw`(() => {
let el = document.activeElement;
while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
if (!el) return null;
return el.isContentEditable ? el.innerText : (el.value ?? null);
})()`;

/** Choisit une option d'une liste (select natif), par son texte ou sa valeur. */
export function scriptChoisir(ref: string, choix: string): string {
  return String.raw`(() => {
${COMMUN}
const el = elementDe(${JSON.stringify(ref)});
if (!el) return { ok: false, raison: "La référence n’existe plus (la page a changé) : relis la page avec navigateur_lire." };
if (el.tagName !== "SELECT") return { ok: false, raison: "Cet élément n’est pas une liste : clique dessus, puis sur l’option." };
const voulu = propre(${JSON.stringify(choix)}).toLowerCase();
const opts = [...el.options];
const o = opts.find((x) => propre(x.text).toLowerCase() === voulu || x.value.toLowerCase() === voulu) || opts.find((x) => propre(x.text).toLowerCase().includes(voulu));
if (!o) return { ok: false, raison: "Aucune option « " + ${JSON.stringify(choix)} + " ». Choix : " + opts.slice(0, 20).map((x) => propre(x.text)).join(" | ") };
el.focus();
el.value = o.value;
el.dispatchEvent(new Event("input", { bubbles: true }));
el.dispatchEvent(new Event("change", { bubbles: true }));
return { ok: true, choisi: propre(o.text) };
})()`;
}

/** Fait défiler la page, ou le bloc qui contient un élément. */
export function scriptDefiler(ref: string | null, dx: number, dy: number): string {
  return String.raw`(() => {
${COMMUN}
let cible = document.scrollingElement || document.documentElement;
${ref ? `const el = elementDe(${JSON.stringify(ref)}); if (!el) return { ok: false, raison: "La référence n’existe plus : relis la page." };
let p = el; while (p && p !== document.body) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)) { cible = p; break; } p = p.parentElement; }` : ""}
const avant = cible.scrollTop;
cible.scrollBy({ left: ${Number(dx) || 0}, top: ${Number(dy) || 0}, behavior: "instant" });
return { ok: true, y: cible.scrollTop, bouge: cible.scrollTop !== avant, max: cible.scrollHeight - cible.clientHeight };
})()`;
}

/** Le texte seul de la page, pour une lecture longue. */
export const SCRIPT_TEXTE = String.raw`(() => {
const corps = document.body ? document.body.innerText || "" : "";
return corps.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
})()`;

/** Le texte est-il dans la page ? (attente d'un résultat) */
export function scriptContient(texte: string): string {
  return `(() => !!document.body && (document.body.innerText || "").toLowerCase().includes(${JSON.stringify(texte.toLowerCase())}))()`;
}

/**
 * Le curseur de l'agent : un rond bleu là où il clique, qui s'efface. Un
 * élément hors du flux, sans événement, dans une racine fermée.
 */
export function scriptCurseur(x: number, y: number): string {
  return String.raw`(() => {
const hote = document.createElement("klyra-curseur");
hote.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
const r = hote.attachShadow({ mode: "closed" });
r.innerHTML = '<div style="position:fixed;left:${Math.round(x) - 14}px;top:${Math.round(y) - 14}px;width:28px;height:28px;border-radius:50%;border:2px solid #003FE4;background:rgba(0,63,228,.18);box-shadow:0 0 0 4px rgba(0,63,228,.12);transition:transform .5s ease-out,opacity .5s ease-out"></div>';
(document.body || document.documentElement).appendChild(hote);
const rond = r.firstChild;
requestAnimationFrame(() => { rond.style.transform = "scale(1.6)"; rond.style.opacity = "0"; });
setTimeout(() => hote.remove(), 700);
return true;
})()`;
}

/** Une référence d'un cadre (c2e14) : le cadre (c2) et l'élément. Une référence de la page : sans cadre. */
export function decouperRef(ref: string): { cadre: string | null; ref: string } {
  const m = /^(c\d{1,3})(e\d{1,7})$/.exec(String(ref ?? "").trim());
  return m ? { cadre: m[1], ref: m[0] } : { cadre: null, ref: String(ref ?? "").trim() };
}

/** Où est le contenu d'un cadre dans la page : l'élément iframe amené à l'écran, puis le coin de son contenu. */
export function scriptPlaceCadre(ref: string, decalageY = 0): string {
  return String.raw`(() => {
${COMMUN}
const el = elementDe(${JSON.stringify(ref)});
if (!el) return null;
if (${Number(decalageY) || 0}) scrollBy({ top: ${Number(decalageY) || 0}, behavior: "instant" });
else el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
const r = el.getBoundingClientRect();
return { x: r.left + el.clientLeft, y: r.top + el.clientTop, hauteurVue: innerHeight, largeurVue: innerWidth };
})()`;
}

/**
 * Un champ pour envoyer des fichiers : s'il en est un (input type=file), il est marqué le temps
 * de lui donner les fichiers (`DOM.setFileInputFiles`), sinon c'est un bouton qui ouvre le choix.
 */
export function scriptFichier(ref: string, marque: string): string {
  return String.raw`(() => {
${COMMUN}
const el = elementDe(${JSON.stringify(ref)});
if (!el) return { ok: false, raison: "La référence n’existe plus (la page a changé) : relis la page avec navigateur_lire." };
if (el.tagName === "INPUT" && (el.type || "").toLowerCase() === "file") {
  el.setAttribute("data-klyra-fichier", ${JSON.stringify(marque)});
  return { ok: true, champ: true, multiple: !!el.multiple };
}
return { ok: true, champ: false, multiple: true };
})()`;
}

export function scriptDemarquerFichier(marque: string): string {
  return `(() => { document.querySelectorAll('[data-klyra-fichier=${JSON.stringify(marque)}]').forEach((e) => e.removeAttribute("data-klyra-fichier")); return true; })()`;
}

/**
 * Remplit une connexion avec ce que le coffre garde : le champ du mot de passe (sa référence, sinon
 * le premier visible) et celui de l'identifiant (sa référence, sinon le champ texte ou e-mail qui le
 * précède dans le formulaire). Le mot de passe n'est jamais rendu.
 */
export function scriptRemplirConnexion(entree: { refIdentifiant?: string | null; refMotDePasse?: string | null; identifiant: string; motDePasse: string }): string {
  return String.raw`(() => {
${COMMUN}
const visibles = (sel, racine = document) => [...racine.querySelectorAll(sel)].filter((x) => boite(x) && !x.disabled && !x.readOnly);
const mdp = ${entree.refMotDePasse ? `elementDe(${JSON.stringify(entree.refMotDePasse)})` : `visibles('input[type="password"]')[0]`};
if (!mdp || mdp.tagName !== "INPUT" || (mdp.type || "").toLowerCase() !== "password") return { ok: false, raison: "Aucun champ de mot de passe visible : la page n’est peut-être pas encore à l’étape du mot de passe." };
const TEXTE = 'input[type="email"],input[type="text"],input[type="tel"],input:not([type]),input[autocomplete="username"]';
let id = ${entree.refIdentifiant ? `elementDe(${JSON.stringify(entree.refIdentifiant)})` : "null"};
if (!id) {
  const dans = mdp.form ? visibles(TEXTE, mdp.form) : visibles(TEXTE);
  const avant = dans.filter((x) => x.compareDocumentPosition(mdp) & 4);
  id = avant[avant.length - 1] || null;
}
const poser = (el, valeur) => {
  el.focus();
  const proto = Object.getPrototypeOf(el);
  const d = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  d.set.call(el, valeur);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const identifiant = ${JSON.stringify(entree.identifiant)};
if (id && identifiant) poser(id, identifiant);
poser(mdp, ${JSON.stringify(entree.motDePasse)});
mdp.focus();
return { ok: true, identifiant: !!(id && identifiant) };
})()`;
}

/* ─── Coffre : à quel site va une connexion ────────────────────── */

/** Le site d'une connexion, tel que la personne le tape (« klyra.fr », « https://app.klyra.fr/login ») : son hôte, sans www. */
export function hoteDeSaisie(saisie: string): string {
  const texte = String(saisie ?? "").trim().toLowerCase();
  if (!texte) throw new Error("Indique le site (ex. klyra.fr).");
  let hote: string;
  try {
    hote = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(texte) ? texte : `https://${texte}`).hostname;
  } catch {
    throw new Error("Site illisible.");
  }
  hote = hote.replace(/^www\./, "");
  if (!/^[a-z0-9.-]+$/.test(hote) || (!hote.includes(".") && hote !== "localhost")) throw new Error("Site illisible.");
  return hote;
}

/**
 * Une connexion du coffre vaut-elle pour cette page ? Le même site ou l'un de ses sous-domaines
 * (« klyra.fr » vaut pour app.klyra.fr), et seulement en https (ou un serveur local).
 */
export function connexionPourPage(hoteConnexion: string, urlPage: string): boolean {
  let u: URL;
  try {
    u = new URL(urlPage);
  } catch {
    return false;
  }
  const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return false;
  const hote = u.hostname.replace(/^www\./, "");
  return hote === hoteConnexion || hote.endsWith(`.${hoteConnexion}`);
}
