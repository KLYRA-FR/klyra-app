import { app, BrowserWindow, session, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findClaude } from "./claude";

/**
 * Les artefacts claude.ai de la personne connectée :
 * - la liste, lue par Claude Code (outil Artifact de son compte) ;
 * - une session claude.ai dans l'app (connexion une fois), pour voir les pages
 *   privées : vignettes et ouverture en grand dans une fenêtre de l'app.
 */

const PARTITION = "persist:claude-ai";
const LIEN = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+\/?$/;
const ATELIER = path.join(os.homedir(), ".klyra", "atelier");

export interface ArtefactClaude {
  titre: string;
  url: string;
  misAJour: string | null;
}

/** La liste des artefacts du compte, demandée à Claude Code (modèle léger, outil Artifact seul). */
export function listerArtefacts(): Promise<ArtefactClaude[]> {
  const bin = findClaude();
  if (!bin) return Promise.reject(new Error("Claude Code est introuvable sur ce poste."));
  mkdirSync(ATELIER, { recursive: true });
  const consigne =
    'Appelle l’outil Artifact avec action "list", scope "mine" et limit 200. Réponds UNIQUEMENT avec un tableau JSON, ' +
    'sans texte autour ni bloc de code : [{"titre": "...", "url": "...", "misAJour": "date ISO"}].';
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      ["-p", "--model", "haiku", "--output-format", "json", "--no-session-persistence", "--allowedTools", "Artifact", "--disallowedTools", "Bash", "Write", "Edit", "Read"],
      { cwd: ATELIER, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } },
    );
    let sortie = "";
    child.stdout.on("data", (d: Buffer) => (sortie += d.toString()));
    const timeout = setTimeout(() => child.kill("SIGTERM"), 180_000);
    child.on("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      try {
        const resultat = (JSON.parse(sortie) as { result?: string }).result ?? "";
        const json = resultat.slice(resultat.indexOf("["), resultat.lastIndexOf("]") + 1);
        const liste = (JSON.parse(json) as { titre?: unknown; url?: unknown; misAJour?: unknown }[])
          .filter((a) => typeof a.url === "string" && LIEN.test(a.url))
          .map((a) => ({
            titre: typeof a.titre === "string" && a.titre ? a.titre : "Sans titre",
            url: a.url as string,
            misAJour: typeof a.misAJour === "string" ? a.misAJour : null,
          }));
        resolve(liste);
      } catch {
        reject(new Error("La liste des artefacts n’a pas pu être lue. Réessaie dans un instant."));
      }
    });
    child.stdin.end(consigne);
  });
}

/* ─── Session claude.ai dans l'app ─────────────────────────────── */

/** Domaines de connexion qui doivent rester dans l'app (même session) : claude.ai, Google, Apple. */
const CONNEXION = /^https:\/\/([a-z0-9-]+\.)*(claude\.ai|anthropic\.com|google\.com|gstatic\.com|apple\.com)\//;

let sessionPrete = false;

function sessionClaude() {
  const s = session.fromPartition(PARTITION);
  if (!sessionPrete) {
    // Google refuse les connexions d'une app qui s'annonce « Electron » : on se présente comme Chrome.
    s.setUserAgent(s.getUserAgent().replace(/\s(Electron|klyra-app|KLYRA)\/\S+/g, ""));
    sessionPrete = true;
  }
  return s;
}

/** Connecté à claude.ai dans l'app ? (le cookie de session existe) */
export async function etatClaudeAi(): Promise<boolean> {
  const cookies = await sessionClaude().cookies.get({ domain: "claude.ai" });
  return cookies.some((c) => c.name === "sessionKey" || c.name.startsWith("__Secure-next-auth"));
}

function fenetreClaude(url: string, options: { titre: string; largeur: number; hauteur: number; parent?: BrowserWindow }) {
  const webPreferences = { session: sessionClaude(), contextIsolation: true, nodeIntegration: false, sandbox: true };
  const win = new BrowserWindow({
    width: options.largeur,
    height: options.hauteur,
    title: options.titre,
    parent: options.parent,
    webPreferences,
  });
  // Les fenêtres de connexion (Google, Apple…) s'ouvrent dans l'app, sur la même session ;
  // les autres liens, dans le navigateur.
  win.webContents.setWindowOpenHandler(({ url: lien }) => {
    if (CONNEXION.test(lien)) {
      return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 700, parent: win, webPreferences } };
    }
    void shell.openExternal(lien);
    return { action: "deny" };
  });
  void win.loadURL(url);
  return win;
}

/** Ouvre la connexion claude.ai ; se termine quand la connexion est faite ou la fenêtre fermée. */
export function connecterClaudeAi(parent?: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const win = fenetreClaude("https://claude.ai/login", { titre: "Connexion à claude.ai", largeur: 520, hauteur: 760, parent });
    let fini = false;
    const terminer = (ok: boolean) => {
      if (fini) return;
      fini = true;
      clearInterval(sonde);
      if (!win.isDestroyed()) win.close();
      resolve(ok);
    };
    // La connexion peut aboutir dans une fenêtre Google ou Apple : on vérifie aussi régulièrement.
    const sonde = setInterval(() => void etatClaudeAi().then((ok) => ok && terminer(true)), 2000);
    win.webContents.on("did-navigate", () => void etatClaudeAi().then((ok) => ok && terminer(true)));
    win.on("closed", () => {
      if (fini) return;
      clearInterval(sonde);
      fini = true;
      void etatClaudeAi().then(resolve);
    });
  });
}

export async function deconnecterClaudeAi(): Promise<void> {
  await sessionClaude().clearStorageData();
}

/** Ouvre un artefact en grand, dans une fenêtre de l'app (avec la session claude.ai). */
export function ouvrirArtefact(url: string, titre: string): void {
  if (!LIEN.test(url)) throw new Error("Lien d’artefact invalide.");
  fenetreClaude(url, { titre, largeur: 1280, hauteur: 860 });
}

/* ─── Vignettes ────────────────────────────────────────────────── */

const DOSSIER_VIGNETTES = () => path.join(app.getPath("userData"), "vignettes");
const VALIDITE_MS = 24 * 60 * 60 * 1000;
let enCours = 0;
const file: (() => void)[] = [];

/** Deux captures à la fois au plus. */
async function aTour<T>(fn: () => Promise<T>): Promise<T> {
  if (enCours >= 2) await new Promise<void>((r) => file.push(r));
  enCours++;
  try {
    return await fn();
  } finally {
    enCours--;
    file.shift()?.();
  }
}

/** La vignette d'un artefact (data URL PNG), gardée 24 h sur le poste. null si la page n'est pas visible. */
export async function vignetteArtefact(url: string, forcer = false): Promise<string | null> {
  if (!LIEN.test(url)) throw new Error("Lien d’artefact invalide.");
  const id = url.replace(/\/$/, "").split("/").pop() ?? "x";
  const fichier = path.join(DOSSIER_VIGNETTES(), `${id}.png`);
  if (!forcer && existsSync(fichier) && Date.now() - (await stat(fichier)).mtimeMs < VALIDITE_MS) {
    return `data:image/png;base64,${(await readFile(fichier)).toString("base64")}`;
  }
  if (!(await etatClaudeAi())) return null;

  return aTour(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: { session: sessionClaude(), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true },
    });
    try {
      await win.loadURL(url);
      // L'artefact se dessine dans la page après le chargement : on lui laisse le temps.
      await new Promise((r) => setTimeout(r, 3500));
      const image = (await win.webContents.capturePage()).resize({ width: 640 });
      mkdirSync(DOSSIER_VIGNETTES(), { recursive: true });
      const png = image.toPNG();
      await writeFile(fichier, png);
      return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      return null;
    } finally {
      win.destroy();
    }
  });
}
