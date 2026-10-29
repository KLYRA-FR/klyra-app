import { app, shell } from "electron";
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
}

export type EvenementNotification = "agentFini" | "agentErreur" | "workflow" | "majPrete";

const PAR_DEFAUT: Reglages = {
  notifications: { actives: true, pastille: true, son: true, agentFini: true, agentErreur: true, workflow: true, majPrete: true },
};

const fichier = () => path.join(app.getPath("userData"), "reglages.json");

let courants: Reglages | null = null;

/** Garde seulement les clés connues, en booléens ; le reste reprend la valeur par défaut. */
function valider(brut: unknown): Reglages {
  const n = (brut as { notifications?: Record<string, unknown> } | null)?.notifications ?? {};
  const notifications = { ...PAR_DEFAUT.notifications };
  for (const cle of Object.keys(notifications) as (keyof PreferencesNotifications)[]) {
    if (typeof n[cle] === "boolean") notifications[cle] = n[cle] as boolean;
  }
  return { notifications };
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
