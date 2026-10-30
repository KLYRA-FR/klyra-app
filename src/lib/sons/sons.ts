"use client";

import { useSyncExternalStore } from "react";
import { getBridge, type PreferencesNotifications, type PreferencesSons } from "@/lib/bridge";
import { reglagesActuels, surReglages } from "@/lib/reglages";
import { rendre } from "./synthese";
import { JEUX, type EvenementSonore, type ThemeSons } from "./themes";

/**
 * Le module de sons de l'app : un seul AudioContext, des sons rendus une fois
 * (cf. synthese.ts) puis rejoués tels quels, et un seul appel pour tout le
 * reste de l'app : `jouer("envoi")`, `jouer("fin-de-tache")`… Les
 * microinteractions (clic, ouvrir, fermer, sélection) y passent aussi, depuis
 * interactions.ts.
 *
 * Il se tait :
 * - quand le système a coupé les sons de l'interface (Mac, Windows) ;
 * - pendant que le micro écoute (dictée), sauf ses sons de début et de fin ;
 * - quand la notification du système sonne déjà pour le même événement
 *   (`notificationSonore`, à vérifier par l'appelant).
 */

type Theme = Exclude<ThemeSons, "silence">;
type EvenementNotification = keyof Pick<PreferencesNotifications, "agentFini" | "agentErreur" | "workflow" | "majPrete">;

/** La fin de tâche, quand les sons des actions sont désactivés : elle a son propre interrupteur. */
const THEME_FIN_PAR_DEFAUT: Theme = "chaleureux";
/** Deux fois le même son en moins de temps : le second est de trop. */
const ECART_MIN_MS = 120;
/** L'audio qui ne repart pas dans ce délai (sortie perdue) : le son est abandonné plutôt que joué en retard. */
const REPRISE_MAX_MS = 400;
/** L'aperçu d'un thème : sa panoplie, des microinteractions à la fin de tâche. */
const APERCU: { evenement: EvenementSonore; apres: number }[] = [
  { evenement: "clic", apres: 0 },
  { evenement: "ouvrir", apres: 0.16 },
  { evenement: "selection", apres: 0.34 },
  { evenement: "envoi", apres: 0.54 },
  { evenement: "fin-de-tache", apres: 0.9 },
];

let contexte: AudioContext | null = null;
const tampons = new Map<string, Promise<AudioBuffer | null>>();
let sons: PreferencesSons | null = null;
let notifications: PreferencesNotifications | null = null;
let micro = false;
const derniers = new Map<EvenementSonore, number>();
/** L'instant du dernier son demandé (performance.now()), quel qu'il soit. */
let dernierSon = -Infinity;

/* ─── Ce que le système demande ──────────────────────────────────── */

export interface SilenceSysteme {
  /** Effets sonores de l'interface coupés (Mac) ou modèle de sons « Aucun son » (Windows). */
  sonsCoupes: boolean;
}

let silence: SilenceSysteme = { sonsCoupes: false };
const abonnes = new Set<() => void>();

function changerSilence(patch: SilenceSysteme) {
  if (patch.sonsCoupes === silence.sonsCoupes) return;
  silence = patch;
  abonnes.forEach((f) => f());
}

/** Ce que le système demande, pour les Réglages. */
export function useSilenceSysteme(): SilenceSysteme {
  return useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => silence,
    () => silence,
  );
}

/* ─── Audio ──────────────────────────────────────────────────────── */

/** Le contexte audio, recréé s'il a été fermé (sortie du système perdue). */
function audio(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!contexte || contexte.state === "closed") contexte = new AudioContext({ latencyHint: "interactive" });
  return contexte;
}

/**
 * Le contexte prêt à jouer. Un contexte neuf, ou suspendu (veille, sortie
 * changée), repart d'abord : un son lancé avant attendrait et sortirait en
 * retard, ou jamais.
 */
async function pret(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === "running") return true;
  await Promise.race([ctx.resume().catch(() => undefined), new Promise((ok) => setTimeout(ok, REPRISE_MAX_MS))]);
  return (ctx.state as AudioContextState) === "running";
}

function tampon(theme: Theme, evenement: EvenementSonore): Promise<AudioBuffer | null> {
  const cle = `${theme}/${evenement}`;
  let rendu = tampons.get(cle);
  if (!rendu) {
    // Un rendu raté n'est pas gardé : le son sera rendu de nouveau la prochaine fois.
    rendu = rendre(JEUX[theme][evenement], audio()?.sampleRate).catch(() => {
      tampons.delete(cle);
      return null;
    });
    tampons.set(cle, rendu);
  }
  return rendu;
}

/** Rend tous les sons d'un thème à l'avance : au moment de jouer, il n'y a plus qu'à lire. */
export function precharger(theme: ThemeSons) {
  if (theme === "silence") return;
  for (const evenement of Object.keys(JEUX[theme]) as EvenementSonore[]) void tampon(theme, evenement);
}

/** Le volume réglé (0 à 1) en gain : la loudness suit à peu près le carré. */
const gainDe = (volume: number) => Math.max(0, Math.min(1, volume)) ** 2;

async function lire(theme: Theme, evenement: EvenementSonore, volume: number, dans = 0) {
  const ctx = audio();
  if (!ctx) return;
  const [b, ok] = await Promise.all([tampon(theme, evenement), pret(ctx)]);
  if (!b || !ok) return;
  const source = ctx.createBufferSource();
  source.buffer = b;
  const gain = ctx.createGain();
  gain.gain.value = gainDe(volume);
  source.connect(gain).connect(ctx.destination);
  source.start(ctx.currentTime + dans);
}

const themeDe = (evenement: EvenementSonore, p: PreferencesSons): Theme | null => {
  if (evenement === "fin-de-tache") return p.finDeTache ? (p.theme === "silence" ? THEME_FIN_PAR_DEFAUT : p.theme) : null;
  return p.theme === "silence" ? null : p.theme;
};

/* ─── L'API de l'app ─────────────────────────────────────────────── */

/** Joue le son d'un événement, d'après les Réglages, s'il n'y a pas de raison de se taire. */
export function jouer(evenement: EvenementSonore): void {
  dernierSon = performance.now();
  const p = sons;
  if (!p || silence.sonsCoupes) return;
  if (micro && evenement !== "dictee-debut" && evenement !== "dictee-fin") return;
  const theme = themeDe(evenement, p);
  if (!theme) return;
  const maintenant = performance.now();
  if (maintenant - (derniers.get(evenement) ?? -Infinity) < ECART_MIN_MS) return;
  derniers.set(evenement, maintenant);
  void lire(theme, evenement, p.volume);
}

/** Un son a-t-il été demandé depuis cet instant (performance.now()) ? Le geste en cours a alors déjà le sien. */
export function sonDepuis(instant: number): boolean {
  return dernierSon >= instant;
}

/**
 * La notification du système sonnera-t-elle déjà pour cet événement ? Alors
 * l'app ne joue pas le sien par-dessus. Même règle que le process principal
 * (electron/reglages.ts, `notificationPermise`).
 */
export function notificationSonore(evenement: EvenementNotification): boolean {
  const n = notifications;
  return !!n && n.actives && n[evenement] && n.son;
}

/**
 * L'aperçu d'un thème, au clic sur sa carte : demandé, il sonne même si le
 * système a coupé les sons de l'interface.
 */
export function apercu(theme: ThemeSons, volume = sons?.volume ?? 0.7) {
  dernierSon = performance.now();
  if (theme === "silence") return;
  precharger(theme);
  for (const { evenement, apres } of APERCU) void lire(theme, evenement, volume, apres);
}

/** Un son d'essai au volume donné (réglage du volume), dans le thème choisi. */
export function essai(evenement: EvenementSonore, volume = sons?.volume ?? 0.7) {
  dernierSon = performance.now();
  const p = sons;
  if (!p) return;
  const theme = p.theme === "silence" ? THEME_FIN_PAR_DEFAUT : p.theme;
  void lire(theme, evenement, volume);
}

/** Le micro s'ouvre pour la dictée : son de début, puis plus rien jusqu'à sa fermeture. */
export function debutEcoute() {
  jouer("dictee-debut");
  micro = true;
}

/** Le micro se ferme. `sonner` : le son de fin (pas après une erreur, qui a le sien). */
export function finEcoute(sonner: boolean) {
  if (!micro) return;
  micro = false;
  if (sonner) jouer("dictee-fin");
}

/* ─── Démarrage ──────────────────────────────────────────────────── */

let demarre = false;

/**
 * Lit les Réglages et ce que demande le système, et le suit. Une fois, au
 * démarrage de l'app (SonsApp) ; renvoie de quoi tout arrêter.
 */
export function demarrerSons(): () => void {
  if (demarre) return () => {};
  demarre = true;
  const appliquer = (r: { sons: PreferencesSons; notifications: PreferencesNotifications }) => {
    const theme = sons?.theme;
    sons = r.sons;
    notifications = r.notifications;
    if (r.sons.theme !== theme) precharger(r.sons.theme);
    if (r.sons.finDeTache && r.sons.theme === "silence") void tampon(THEME_FIN_PAR_DEFAUT, "fin-de-tache");
  };
  void reglagesActuels().then(appliquer);
  const arreterReglages = surReglages(appliquer);

  // Le réglage des sons du système ne prévient pas quand il change : relu au retour dans l'app.
  const lireSysteme = () =>
    void getBridge()
      ?.systeme.sonsCoupes?.()
      .then((r) => r.ok && changerSilence({ sonsCoupes: r.data }));
  lireSysteme();
  window.addEventListener("focus", lireSysteme);

  // Un contexte suspendu (veille, règle de lecture automatique) repart au premier geste, avant le son qu'il déclenche.
  const reveiller = () => {
    if (contexte?.state === "suspended") void contexte.resume();
  };
  window.addEventListener("pointerdown", reveiller, true);
  window.addEventListener("keydown", reveiller, true);

  return () => {
    demarre = false;
    arreterReglages();
    window.removeEventListener("focus", lireSysteme);
    window.removeEventListener("pointerdown", reveiller, true);
    window.removeEventListener("keydown", reveiller, true);
  };
}
