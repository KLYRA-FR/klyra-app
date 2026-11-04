import { nativeImage } from "electron";
import { apresExtrait, apresFin, apresOutil, etatInitial, extraitDeResultat, lectureVoulue, type EtatApercu, type ExtraitImage } from "./apercu-cible";
import { definirObservateurRelais } from "./relais";

/**
 * L'aperçu, dans le panneau Navigateur, de la fenêtre qu'un agent pilote sur
 * cet ordinateur. Une lecture par seconde au plus, et seulement pendant qu'un
 * tour s'en sert : la capture déjà renvoyée par le pilote est réutilisée, et
 * on ne demande jamais l'écran entier. L'arrêt du pilote ou la fin du tour
 * coupe la lecture. Le profil du navigateur de la personne n'est pas lu.
 *
 * La conversation vient de l'outil (claude.ts, codex.ts). Le relais n'a pas de
 * conversation : on rattache sa réponse à l'outil récent qui vise la même fenêtre.
 */

export interface ApercuPublic {
  chatId: string;
  titre: string;
  image: string | null;
  masquee: boolean;
  absente: boolean;
  bureau: boolean;
  actif: boolean;
}

const INTERVALLE_MS = 1_000;
const REUSE_MS = 1_000;
const SILENCE_MS = 45_000;
const ASSOCIATION_MS = 180_000;
const ECHECS_MAX = 3;
const LARGEUR_MAX = 960;

interface Session extends EtatApercu {
  echecs: number;
  derniereImage: number;
  dernierOutil: number;
}

let lecture: ((pid: number | null, windowId: number | null) => Promise<unknown>) | null = null;
let minuteur: ReturnType<typeof setInterval> | null = null;
let enVol = false;
/** Incrémenté à l'arrêt : une lecture déjà partie ne recrée pas l'aperçu. */
let generation = 0;
const sessions = new Map<string, Session>();
const file: { chatId: string; windowId: number | null; pid: number | null; at: number }[] = [];
const abonnes = new Set<(etat: ApercuPublic[]) => void>();

const versPublic = (s: Session): ApercuPublic => ({
  chatId: s.chatId,
  titre: s.titre,
  image: s.image,
  masquee: s.masquee,
  absente: s.absente,
  bureau: s.bureau,
  actif: s.actif,
});

const visible = (s: Session) => s.actif || s.image !== null || s.masquee || s.bureau || s.absente;

function publier(): void {
  const etat = [...sessions.values()].filter(visible).map(versPublic);
  for (const f of abonnes) f(etat);
}

function assurer(chatId: string): Session {
  const deja = sessions.get(chatId);
  if (deja) return deja;
  const s: Session = { ...etatInitial(chatId), echecs: 0, derniereImage: 0, dernierOutil: 0 };
  sessions.set(chatId, s);
  return s;
}

function poser(chatId: string, suivant: EtatApercu): Session {
  const s = assurer(chatId);
  Object.assign(s, suivant);
  return s;
}

function assurerBoucle(): void {
  if (minuteur || !lecture) return;
  if (![...sessions.values()].some(lectureVoulue)) return;
  minuteur = setInterval(() => void tick(), INTERVALLE_MS);
}

function arreterBoucle(): void {
  if (!minuteur) return;
  clearInterval(minuteur);
  minuteur = null;
}

/** Branche la lecture sur le démon. Sans elle, seules les images déjà dans les réponses sont montrées. */
export function brancherApercu(lire: (pid: number | null, windowId: number | null) => Promise<unknown>): void {
  lecture = lire;
  definirObservateurRelais((e) => recevoirRelais(e));
}

/** Le pilote s'arrête : plus aucune lecture, plus aucune image. */
export function couperApercu(): void {
  generation += 1;
  definirObservateurRelais(null);
  lecture = null;
  arreterBoucle();
  sessions.clear();
  file.length = 0;
  publier();
}

export function surApercu(f: (etat: ApercuPublic[]) => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

export function etatApercu(): ApercuPublic[] {
  return [...sessions.values()].filter(visible).map(versPublic);
}

/** Un outil Computer Use part dans cette conversation. */
export function voirOutil(chatId: string, nom: string, entree: Record<string, unknown>): void {
  if (!lecture) return;
  const deja = sessions.get(chatId) ?? null;
  const suivant = apresOutil(deja, chatId, nom, entree);
  if (!suivant || suivant === deja) return;
  const s = poser(chatId, suivant);
  s.echecs = 0;
  s.dernierOutil = Date.now();
  file.push({ chatId, windowId: s.windowId, pid: s.pid, at: s.dernierOutil });
  while (file.length > 20) file.shift();
  assurerBoucle();
  publier();
}

/** Le tour est fini : on garde la dernière image, on ne lit plus. */
export function voirFin(chatId: string): void {
  const s = sessions.get(chatId);
  if (!s) return;
  poser(chatId, apresFin(s));
  if (!visible(s)) sessions.delete(chatId);
  if (![...sessions.values()].some((x) => x.actif)) arreterBoucle();
  publier();
}

function chatPour(e: ExtraitImage): string | null {
  const frais = file.filter((a) => Date.now() - a.at < ASSOCIATION_MS);
  if (e.windowId != null) {
    const m = frais.filter((a) => a.windowId === e.windowId);
    if (m.length) return m[m.length - 1].chatId;
  }
  if (e.pid != null) {
    const m = frais.filter((a) => a.pid === e.pid);
    if (m.length && m.every((a) => a.chatId === m[0].chatId)) return m[m.length - 1].chatId;
  }
  const ids = [...new Set(frais.map((a) => a.chatId))];
  return ids.length === 1 ? ids[0] : null;
}

function reduire(base64: string): string | null {
  const brut = Buffer.from(base64, "base64");
  if (brut.length < 32) return null;
  const img = nativeImage.createFromBuffer(brut);
  if (img.isEmpty()) return null;
  const { width } = img.getSize();
  const cadre = width > LARGEUR_MAX ? img.resize({ width: LARGEUR_MAX, quality: "good" }) : img;
  return `data:image/jpeg;base64,${cadre.toJPEG(60).toString("base64")}`;
}

function appliquer(s: Session, e: ExtraitImage): void {
  const suivant = apresExtrait(s, e);
  poser(s.chatId, suivant);
  if (e.base64 && !e.masquee && !e.absente && !e.bureau) {
    const jpeg = reduire(e.base64);
    if (jpeg) {
      s.image = jpeg;
      s.derniereImage = Date.now();
      s.echecs = 0;
    }
  }
}

function recevoirRelais(e: ExtraitImage): void {
  const chatId = chatPour(e);
  if (!chatId) return;
  const s = sessions.get(chatId);
  if (!s) return;
  s.dernierOutil = Date.now();
  appliquer(s, e);
  assurerBoucle();
  publier();
}

async function tick(): Promise<void> {
  if (enVol || !lecture) return;
  const maintenant = Date.now();
  for (const s of sessions.values()) {
    if (s.actif && maintenant - s.dernierOutil > SILENCE_MS) poser(s.chatId, apresFin(s));
  }
  const dues = [...sessions.values()].filter((s) => lectureVoulue(s) && maintenant - s.derniereImage >= REUSE_MS);
  const due = dues[0];
  if (!due || !lecture) {
    if (![...sessions.values()].some((s) => s.actif)) arreterBoucle();
    publier();
    return;
  }
  const gen = generation;
  const lire = lecture;
  enVol = true;
  try {
    const brut = await lire(due.pid, due.windowId);
    if (gen !== generation) return;
    const extrait = extraitDeResultat(brut, { name: "get_window_state", bureau: false });
    if (!extrait || (!extrait.base64 && !extrait.masquee && !extrait.absente && !extrait.bureau)) {
      due.echecs += 1;
      if (due.echecs >= ECHECS_MAX) poser(due.chatId, apresExtrait(due, { name: "get_window_state", windowId: due.windowId, pid: due.pid, titre: null, base64: null, mime: null, masquee: false, absente: true, bureau: false }));
    } else {
      due.echecs = 0;
      appliquer(due, extrait);
    }
  } catch {
    if (gen !== generation) return;
    due.echecs += 1;
    if (due.echecs >= ECHECS_MAX) poser(due.chatId, apresExtrait(due, { name: "get_window_state", windowId: due.windowId, pid: due.pid, titre: null, base64: null, mime: null, masquee: false, absente: true, bureau: false }));
  } finally {
    enVol = false;
  }
  if (gen !== generation) return;
  if (![...sessions.values()].some(lectureVoulue)) arreterBoucle();
  publier();
}

const MODES = new Set(["image", "masquee", "bureau", "fin", "oubli"]);

/** Le test d'écran injecte un aperçu. Ailleurs : rien. */
export function poserApercuTest(chatId: string, mode: string): boolean {
  if (process.env.KLYRA_NAVIGATEUR_TEST !== "1" || !chatId || !MODES.has(mode)) return false;
  if (mode === "oubli") {
    sessions.delete(chatId);
    publier();
    return true;
  }
  if (mode === "fin") {
    const s = sessions.get(chatId);
    if (s) poser(chatId, apresFin(s));
    publier();
    return true;
  }
  const s = assurer(chatId);
  s.titre = "Fenêtre d’essai";
  s.actif = true;
  s.echecs = 0;
  s.windowId = null;
  s.pid = null;
  if (mode === "image") {
    const w = 320;
    const h = 180;
    const buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      buf[i * 4] = 0xe0;
      buf[i * 4 + 1] = 0x6b;
      buf[i * 4 + 2] = 0x3b;
      buf[i * 4 + 3] = 255;
    }
    const jpeg = nativeImage.createFromBitmap(buf, { width: w, height: h }).toJPEG(80);
    s.image = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    s.masquee = false;
    s.bureau = false;
    s.absente = false;
  } else if (mode === "masquee") {
    s.image = null;
    s.masquee = true;
    s.bureau = false;
    s.absente = false;
  } else {
    s.image = null;
    s.masquee = false;
    s.bureau = true;
    s.absente = false;
  }
  publier();
  return true;
}
