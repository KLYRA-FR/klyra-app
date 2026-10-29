"use client";

import { useSyncExternalStore } from "react";
import { getBridge, type PreferencesNotifications, type PreferencesSons } from "@/lib/bridge";
import { reglagesActuels, surReglages } from "@/lib/reglages";
import { rendre } from "./synthese";
import { JEUX, type EvenementSonore, type ThemeSons } from "./themes";

/**
 * Le module de sons de l'app : un seul AudioContext, des sons rendus une fois
 * (cf. synthese.ts) puis rejoués tels quels, et un seul appel pour tout le
 * reste de l'app : `jouer("envoi")`, `jouer("fin-de-tache")`…
 *
 * Il se tait :
 * - quand le système demande moins d'animations ou de sons (Mac, Windows) ;
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
/** L'aperçu d'un thème : l'envoi, puis la fin de tâche. */
const APERCU: { evenement: EvenementSonore; apres: number }[] = [
  { evenement: "envoi", apres: 0 },
  { evenement: "fin-de-tache", apres: 0.42 },
];

let contexte: AudioContext | null = null;
const tampons = new Map<string, Promise<AudioBuffer | null>>();
let sons: PreferencesSons | null = null;
let notifications: PreferencesNotifications | null = null;
let micro = false;
const derniers = new Map<EvenementSonore, number>();

/* ─── Ce que le système demande ──────────────────────────────────── */

export interface SilenceSysteme {
  /** « Réduire les animations » (Mac) ou « Effets d'animation » coupés (Windows). */
  moinsDeMouvement: boolean;
  /** Effets sonores de l'interface coupés (Mac) ou modèle de sons « Aucun son » (Windows). */
  sonsCoupes: boolean;
}

let silence: SilenceSysteme = { moinsDeMouvement: false, sonsCoupes: false };
const abonnes = new Set<() => void>();

function changerSilence(patch: Partial<SilenceSysteme>) {
  const suite = { ...silence, ...patch };
  if (suite.moinsDeMouvement === silence.moinsDeMouvement && suite.sonsCoupes === silence.sonsCoupes) return;
  silence = suite;
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

const systemeSilencieux = () => silence.moinsDeMouvement || silence.sonsCoupes;

/* ─── Audio ──────────────────────────────────────────────────────── */

function audio(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  contexte ??= new AudioContext({ latencyHint: "interactive" });
  return contexte;
}

function tampon(theme: Theme, evenement: EvenementSonore): Promise<AudioBuffer | null> {
  const cle = `${theme}/${evenement}`;
  let rendu = tampons.get(cle);
  if (!rendu) {
    rendu = rendre(JEUX[theme][evenement], audio()?.sampleRate).catch(() => null);
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
  if (ctx.state === "suspended") void ctx.resume();
  const b = await tampon(theme, evenement);
  if (!b) return;
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
  const p = sons;
  if (!p || systemeSilencieux()) return;
  if (micro && evenement !== "dictee-debut" && evenement !== "dictee-fin") return;
  const theme = themeDe(evenement, p);
  if (!theme) return;
  const maintenant = performance.now();
  if (maintenant - (derniers.get(evenement) ?? -Infinity) < ECART_MIN_MS) return;
  derniers.set(evenement, maintenant);
  void lire(theme, evenement, p.volume);
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
 * système demande moins de sons.
 */
export function apercu(theme: ThemeSons, volume = sons?.volume ?? 0.7) {
  if (theme === "silence") return;
  precharger(theme);
  for (const { evenement, apres } of APERCU) void lire(theme, evenement, volume, apres);
}

/** Un son d'essai au volume donné (réglage du volume), dans le thème choisi. */
export function essai(evenement: EvenementSonore, volume = sons?.volume ?? 0.7) {
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

  const requete = window.matchMedia("(prefers-reduced-motion: reduce)");
  const surMouvement = () => changerSilence({ moinsDeMouvement: requete.matches });
  surMouvement();
  requete.addEventListener("change", surMouvement);

  // Le réglage des sons du système ne prévient pas quand il change : relu au retour dans l'app.
  const lireSysteme = () =>
    void getBridge()
      ?.systeme.sonsCoupes?.()
      .then((r) => r.ok && changerSilence({ sonsCoupes: r.data }));
  lireSysteme();
  window.addEventListener("focus", lireSysteme);

  return () => {
    demarre = false;
    arreterReglages();
    requete.removeEventListener("change", surMouvement);
    window.removeEventListener("focus", lireSysteme);
  };
}
