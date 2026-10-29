import { app, shell, systemPreferences } from "electron";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Les réglages de l'app qui ne sont ni dans les conversations ni dans les
 * fiches des agents : notifications, sons, Computer Use. Un fichier JSON dans
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

/** Les thèmes des sons de l'app (src/lib/sons/themes.ts). */
const THEMES_SONS = ["silence", "chaleureux", "mecanique", "petillant", "clavier"] as const;

/** Les sons joués par l'app elle-même (src/lib/sons/). */
export interface PreferencesSons {
  /** Un son court quand un agent a fini, même si les sons des actions sont désactivés. */
  finDeTache: boolean;
  /** Le jeu de sons des actions ; « silence » les coupe. */
  theme: (typeof THEMES_SONS)[number];
  /** De 0 à 1. */
  volume: number;
}

export interface Reglages {
  notifications: PreferencesNotifications;
  /** Les agents peuvent-ils piloter l'ordinateur ? Coupé par défaut ; rien ne pilote sans lui. */
  computerUse: { actif: boolean };
  sons: PreferencesSons;
}

export type EvenementNotification = "agentFini" | "agentErreur" | "workflow" | "majPrete";

const PAR_DEFAUT: Reglages = {
  notifications: { actives: true, pastille: true, son: true, agentFini: true, agentErreur: true, workflow: true, majPrete: true },
  computerUse: { actif: false },
  sons: { finDeTache: true, theme: "chaleureux", volume: 0.7 },
};

const fichier = () => path.join(app.getPath("userData"), "reglages.json");

let courants: Reglages | null = null;

/** Garde seulement les clés connues, de bon type ; le reste reprend la valeur par défaut. */
function valider(brut: unknown): Reglages {
  const b = brut as { notifications?: Record<string, unknown>; computerUse?: { actif?: unknown }; sons?: Record<string, unknown> } | null;
  const n = b?.notifications ?? {};
  const notifications = { ...PAR_DEFAUT.notifications };
  for (const cle of Object.keys(notifications) as (keyof PreferencesNotifications)[]) {
    if (typeof n[cle] === "boolean") notifications[cle] = n[cle] as boolean;
  }
  const s = b?.sons ?? {};
  const sons: PreferencesSons = {
    finDeTache: typeof s.finDeTache === "boolean" ? s.finDeTache : PAR_DEFAUT.sons.finDeTache,
    theme: THEMES_SONS.find((t) => t === s.theme) ?? PAR_DEFAUT.sons.theme,
    volume: typeof s.volume === "number" && Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : PAR_DEFAUT.sons.volume,
  };
  return { notifications, computerUse: { actif: b?.computerUse?.actif === true }, sons };
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

/* ─── Sons : ce que le système demande ───────────────────────────── */

const lire = (commande: string, args: string[]) =>
  new Promise<string>((ok, ko) =>
    execFile(commande, args, { timeout: 3000, windowsHide: true }, (erreur, sortie) => (erreur ? ko(erreur) : ok(String(sortie)))),
  );

/**
 * L'utilisateur a-t-il coupé les sons de l'interface dans le système ? Mac :
 * « Émettre des effets sonores de l'interface » décoché (absent : coché).
 * Windows : modèle de sons « Aucun son ». Ailleurs, ou illisible : non.
 */
export async function sonsCoupesParLeSysteme(): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      const valeur = await lire("/usr/bin/defaults", ["read", "-g", "com.apple.sound.uiaudio.enabled"]).catch(() =>
        lire("/usr/bin/defaults", ["read", "com.apple.systemsound", "com.apple.sound.uiaudio.enabled"]),
      );
      return valeur.trim() === "0";
    }
    if (process.platform === "win32") {
      const sortie = await lire("reg", ["query", "HKCU\\AppEvents\\Schemes", "/ve"]);
      return /\.None\s*$/im.test(sortie);
    }
  } catch {
    /* clé absente : le réglage par défaut du système, les sons */
  }
  return false;
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
