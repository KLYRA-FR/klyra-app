/**
 * Ce que le panneau Navigateur peut montrer d'un Computer Use local :
 * une fenêtre, jamais l'écran entier. Pur, sans Electron : le relais et les
 * tests s'en servent. L'image, le rythme et l'arrêt sont dans apercu.ts.
 *
 * Rien ici ne lit le profil d'un navigateur. Une cible « bureau »
 * (`get_desktop_state`, ou `target.kind === "desktop"`) ne donne pas de pixels.
 */

export interface RequeteLegere {
  name: string;
  windowId: number | null;
  pid: number | null;
  bureau: boolean;
}

export interface ExtraitImage {
  name: string;
  windowId: number | null;
  pid: number | null;
  titre: string | null;
  /** Base64 brut, sans préfixe. Null : ne rien afficher. */
  base64: string | null;
  mime: string | null;
  masquee: boolean;
  absente: boolean;
  bureau: boolean;
}

export interface EtatApercu {
  chatId: string;
  windowId: number | null;
  pid: number | null;
  titre: string;
  image: string | null;
  masquee: boolean;
  absente: boolean;
  bureau: boolean;
  actif: boolean;
}

type Objet = Record<string, unknown>;

const PREFIXE = "mcp__ordinateur__";
const MASQUEE = /minimi|hidden|masqu|off-?screen|not visible|no backing|has_screenshot/i;
const ABSENTE = /not found|introuvable|no such|unknown window|does not exist|invalid window/i;
/** Au-delà, ce n'est plus une fenêtre : on jette les pixels. */
const MAX_IMAGE = 12_000_000;

const estObjet = (v: unknown): v is Objet => typeof v === "object" && v !== null && !Array.isArray(v);

function nombre(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function chaine(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;
}

export type Cible = { kind: "fenetre"; windowId: number | null; pid: number | null; titre: string | null } | { kind: "bureau" };

/** La fenêtre visée par un outil. `bureau` : l'écran entier, qu'on ne montre pas. Null : pas un outil de pilotage. */
export function cibleDepuis(nom: string, entree: Record<string, unknown> | null | undefined): Cible | null {
  const court = nom.startsWith(PREFIXE) ? nom.slice(PREFIXE.length) : nom;
  if (!nom.startsWith(PREFIXE) && court === nom) return null;
  const e = entree ?? {};
  const target = estObjet(e.target) ? e.target : null;
  const windowId = nombre(e.window_id) ?? (target?.kind === "window" ? nombre(target.window_id) : null);
  const pid = nombre(e.pid) ?? (target ? nombre(target.pid) : null);
  const titre = chaine(e.title) ?? chaine(e.app);
  if (windowId != null || (pid != null && target?.kind !== "desktop" && court !== "get_desktop_state")) {
    return { kind: "fenetre", windowId, pid, titre };
  }
  if (court === "get_desktop_state" || target?.kind === "desktop") return { kind: "bureau" };
  return null;
}

/** Une ligne de requête du démon (`{"method":"call",…}`). Null si ce n'est pas un appel. */
export function lireRequete(ligne: string): RequeteLegere | null {
  let lu: unknown;
  try {
    lu = JSON.parse(ligne);
  } catch {
    return null;
  }
  if (!estObjet(lu) || lu.method !== "call" || typeof lu.name !== "string") return null;
  const args = estObjet(lu.args) ? lu.args : {};
  const cible = cibleDepuis(`${PREFIXE}${lu.name}`, args);
  return {
    name: lu.name,
    windowId: cible?.kind === "fenetre" ? cible.windowId : null,
    pid: cible?.kind === "fenetre" ? cible.pid : null,
    bureau: cible?.kind === "bureau",
  };
}

function vide(name: string, partiel: Partial<ExtraitImage>): ExtraitImage {
  return {
    name,
    windowId: null,
    pid: null,
    titre: null,
    base64: null,
    mime: null,
    masquee: false,
    absente: false,
    bureau: false,
    ...partiel,
  };
}

/**
 * Ce qu'on peut montrer d'une réponse du démon. L'écran entier ne rend pas de
 * pixels. Une fenêtre masquée ou réduite non plus : pas de repli sur le bureau.
 */
export function extraitDeResultat(lu: unknown, requete: { name: string; bureau: boolean }): ExtraitImage | null {
  if (requete.bureau || requete.name === "get_desktop_state") return vide(requete.name, { bureau: true });
  if (!estObjet(lu)) return null;
  if (lu.ok === false) {
    const err = String(lu.error ?? lu.message ?? "");
    return vide(requete.name, { masquee: MASQUEE.test(err), absente: !MASQUEE.test(err) && ABSENTE.test(err) });
  }
  const resultat = estObjet(lu.result) ? lu.result : lu;
  const sc = estObjet(resultat.structuredContent) ? resultat.structuredContent : {};
  const windowId = nombre(sc.window_id);
  const pid = nombre(sc.pid);
  const titre = chaine(sc.title) ?? chaine(sc.window_title) ?? chaine(sc.app_name) ?? chaine(sc.app);
  const marqueMasquee = sc.minimized === true || sc.is_minimized === true || sc.has_screenshot === false;
  const contenu = Array.isArray(resultat.content) ? resultat.content : [];
  const image = contenu.find((c) => estObjet(c) && c.type === "image" && typeof c.data === "string" && c.data.length > 0);
  const data = image && typeof (image as Objet).data === "string" ? ((image as Objet).data as string) : chaine(sc.screenshot);
  const mime = image && typeof (image as Objet).mimeType === "string" ? ((image as Objet).mimeType as string) : data ? "image/png" : null;
  if (marqueMasquee) return { name: requete.name, windowId, pid, titre, base64: null, mime: null, masquee: true, absente: false, bureau: false };
  if (!data) {
    if (sc.is_on_screen === false) return { name: requete.name, windowId, pid, titre, base64: null, mime: null, masquee: true, absente: false, bureau: false };
    return null;
  }
  if (data.length > MAX_IMAGE) return vide(requete.name, { windowId, pid, titre, bureau: true });
  return { name: requete.name, windowId, pid, titre, base64: data, mime, masquee: false, absente: false, bureau: false };
}

export function etatInitial(chatId: string): EtatApercu {
  return { chatId, windowId: null, pid: null, titre: "Fenêtre pilotée", image: null, masquee: false, absente: false, bureau: false, actif: false };
}

/** Un outil d'un agent. Null : ce n'est pas du Computer Use, l'état ne change pas. */
export function apresOutil(etat: EtatApercu | null, chatId: string, nom: string, entree: Record<string, unknown> | null | undefined): EtatApercu | null {
  if (!chatId) return etat;
  const cible = cibleDepuis(nom, entree);
  if (!cible) return etat;
  const suivant: EtatApercu = { ...(etat ?? etatInitial(chatId)), chatId, actif: true, absente: false };
  if (cible.kind === "bureau") {
    if (suivant.windowId == null && suivant.pid == null) {
      suivant.bureau = true;
      suivant.image = null;
    }
    return suivant;
  }
  suivant.bureau = false;
  suivant.masquee = false;
  if (cible.windowId != null) suivant.windowId = cible.windowId;
  if (cible.pid != null) suivant.pid = cible.pid;
  if (cible.titre) suivant.titre = cible.titre;
  return suivant;
}

/** Une réponse du relais ou une lecture. L'image réduite est posée par l'appelant quand `base64` est là. */
export function apresExtrait(etat: EtatApercu, e: ExtraitImage): EtatApercu {
  const s: EtatApercu = { ...etat, actif: etat.actif };
  if (e.bureau && s.windowId == null && s.pid == null) return { ...s, bureau: true, image: null, masquee: false, absente: false };
  if (e.windowId != null) s.windowId = e.windowId;
  if (e.pid != null) s.pid = e.pid;
  if (e.titre) s.titre = e.titre;
  if (e.masquee) return { ...s, masquee: true, image: null, bureau: false, absente: false };
  if (e.absente) return { ...s, absente: true, image: null, masquee: false, bureau: false, actif: false };
  if (e.base64) return { ...s, bureau: false, masquee: false, absente: false };
  return s;
}

export function apresFin(etat: EtatApercu): EtatApercu {
  return { ...etat, actif: false };
}

/** Une lecture de plus : seulement une fenêtre connue, pendant que l'agent s'en sert. Jamais le bureau. */
export function lectureVoulue(etat: EtatApercu): boolean {
  return etat.actif && (etat.windowId != null || etat.pid != null) && !(etat.bureau && etat.windowId == null && etat.pid == null);
}
