import { app, shell, systemPreferences } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Les réglages de l'app qui ne sont ni dans les conversations ni dans les
 * fiches des agents : les notifications, pour l'instant. Un fichier JSON dans
 * le dossier de l'app, lu par l'interface et par le process principal (qui
 * affiche les notifications). Le lancement au démarrage est un réglage du
 * système : il est lu et écrit chez lui, pas ici.
 */

export interface PreferencesNotifications {
  /** Notifications du système, toutes. */
  actives: boolean;
  /** Pastille sur l'icône du Dock (Mac) ou icône qui clignote (Windows). */
  pastille: boolean;
  son: boolean;
  /** Par événement. */
  agentFini: boolean;
  agentErreur: boolean;
  workflow: boolean;
  majPrete: boolean;
}

export interface Reglages {
  notifications: PreferencesNotifications;
  /** Les agents peuvent-ils piloter l'ordinateur ? Coupé par défaut ; rien ne pilote sans lui. */
  computerUse: { actif: boolean };
}

export type EvenementNotification = "agentFini" | "agentErreur" | "workflow" | "majPrete";

const PAR_DEFAUT: Reglages = {
  notifications: { actives: true, pastille: true, son: true, agentFini: true, agentErreur: true, workflow: true, majPrete: true },
  computerUse: { actif: false },
};

const fichier = () => path.join(app.getPath("userData"), "reglages.json");

let courants: Reglages | null = null;

/** Garde seulement les clés connues, en booléens ; le reste reprend la valeur par défaut. */
function valider(brut: unknown): Reglages {
  const b = brut as { notifications?: Record<string, unknown>; computerUse?: { actif?: unknown } } | null;
  const n = b?.notifications ?? {};
  const notifications = { ...PAR_DEFAUT.notifications };
  for (const cle of Object.keys(notifications) as (keyof PreferencesNotifications)[]) {
    if (typeof n[cle] === "boolean") notifications[cle] = n[cle] as boolean;
  }
  return { notifications, computerUse: { actif: b?.computerUse?.actif === true } };
}

export function lireReglages(): Reglages {
  if (courants) return courants;
  try {
    courants = existsSync(fichier()) ? valider(JSON.parse(readFileSync(fichier(), "utf8"))) : valider(null);
  } catch {
    courants = valider(null);
  }
  return courants;
}

export async function ecrireReglages(brut: unknown): Promise<Reglages> {
  const reglages = valider(brut);
  await mkdir(path.dirname(fichier()), { recursive: true });
  await writeFile(fichier(), JSON.stringify(reglages, null, 2));
  courants = reglages;
  return reglages;
}

/** Cette notification doit-elle s'afficher, d'après les réglages ? */
export function notificationPermise(evenement: EvenementNotification): boolean {
  const n = lireReglages().notifications;
  return n.actives && n[evenement];
}

/* ─── Lancement au démarrage ─────────────────────────────────────── */

/** Mac et Windows seulement : ailleurs, le système ne le propose pas à l'app. */
const LANCEMENT_POSSIBLE = process.platform === "darwin" || process.platform === "win32";

export function lancementAuDemarrage(): { possible: boolean; actif: boolean } {
  if (!LANCEMENT_POSSIBLE || !app.isPackaged) return { possible: false, actif: false };
  return { possible: true, actif: app.getLoginItemSettings().openAtLogin };
}

export function changerLancement(actif: boolean): { possible: boolean; actif: boolean } {
  if (typeof actif !== "boolean") throw new Error("Valeur invalide.");
  if (!LANCEMENT_POSSIBLE || !app.isPackaged) throw new Error("Le lancement au démarrage se règle dans l’app installée.");
  app.setLoginItemSettings({ openAtLogin: actif });
  return lancementAuDemarrage();
}

/* ─── Computer Use : les autorisations du système ────────────────── */

export type EtatAutorisation = "accordee" | "refusee" | "a-demander" | "sans-objet" | "inconnue";

/**
 * Ce que le système autorise à l'app pour piloter l'ordinateur. Sur Mac :
 * Accessibilité (clics, clavier) et Enregistrement de l'écran (captures).
 * Windows ne demande pas d'autorisation pour ça : « sans-objet ».
 */
export function autorisationsComputerUse(): { plateforme: string; accessibilite: EtatAutorisation; ecran: EtatAutorisation } {
  if (process.platform === "darwin") {
    const ecran = systemPreferences.getMediaAccessStatus("screen");
    return {
      plateforme: "darwin",
      accessibilite: systemPreferences.isTrustedAccessibilityClient(false) ? "accordee" : "refusee",
      ecran: ecran === "granted" ? "accordee" : ecran === "not-determined" ? "a-demander" : ecran === "unknown" ? "inconnue" : "refusee",
    };
  }
  if (process.platform === "win32") return { plateforme: "win32", accessibilite: "sans-objet", ecran: "sans-objet" };
  return { plateforme: process.platform, accessibilite: "inconnue", ecran: "inconnue" };
}

/** Ouvre la bonne page des réglages du système (Mac) ; pour l'Accessibilité, macOS propose aussi d'ajouter l'app. */
export async function ouvrirAutorisation(type: "accessibilite" | "ecran"): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Ce système ne demande pas cette autorisation.");
  if (type === "accessibilite") systemPreferences.isTrustedAccessibilityClient(true);
  const panneau = type === "accessibilite" ? "Privacy_Accessibility" : "Privacy_ScreenCapture";
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${panneau}`);
}

/* ─── Informations et dossiers ───────────────────────────────────── */

const DOSSIERS = {
  donnees: () => app.getPath("userData"),
  klyra: () => path.join(os.homedir(), ".klyra"),
  agents: () => path.join(os.homedir(), ".claude", "agents"),
} as const;

export type DossierApp = keyof typeof DOSSIERS;

/** Remplace le dossier personnel par « ~ » pour l'affichage. */
const court = (chemin: string) => chemin.replace(os.homedir(), "~");

export function infosApp() {
  return {
    version: app.getVersion(),
    installee: app.isPackaged,
    plateforme: process.platform,
    electron: process.versions.electron,
    dossiers: Object.fromEntries(Object.entries(DOSSIERS).map(([cle, f]) => [cle, court(f())])) as Record<DossierApp, string>,
  };
}

export async function ouvrirDossier(nom: DossierApp): Promise<void> {
  if (!(nom in DOSSIERS)) throw new Error("Dossier inconnu.");
  const chemin = DOSSIERS[nom]();
  await mkdir(chemin, { recursive: true });
  const erreur = await shell.openPath(chemin);
  if (erreur) throw new Error(erreur);
}
