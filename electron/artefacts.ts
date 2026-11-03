import { app, BrowserWindow, session, shell } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { artefactsDuJson, fusionnerGalerie, LIEN_ARTEFACT as LIEN, type ArtefactClaude } from "./artefacts-liste";

export type { ArtefactClaude };

/**
 * Les artefacts claude.ai de la personne, par la session claude.ai de l'app (connexion une fois) :
 * - la liste, lue dans sa galerie claude.ai (Claude Code ne le peut pas : l'outil Artifact n'existe pas
 *   dans le Claude Code installé sur un poste) ;
 * - les pages privées : vignettes et ouverture en grand dans une fenêtre de l'app.
 */

const PARTITION = "persist:claude-ai";
const GALERIE = "https://claude.ai/code/artifacts";
const DELAI_GALERIE_MS = 25_000;

/** Les liens d'artefacts de la page, après avoir fait défiler tout ce qui défile (listes chargées au fil du défilement). */
const RELEVER_LIENS = `(() => {
  for (const el of [document.scrollingElement, ...document.querySelectorAll("*")]) {
    if (el && el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight;
  }
  return [...document.querySelectorAll('a[href*="/artifact/"]')].map((a) => ({
    url: a.href,
    titre: (a.getAttribute("aria-label") || a.getAttribute("title") || a.innerText || "").trim().slice(0, 300),
  }));
})()`;

/**
 * Ouvre la galerie claude.ai hors écran, avec la session de l'app, et relève ses artefacts : les liens de la
 * page et les réponses JSON de claude.ai qui parlent d'artefacts (cf. `fusionnerGalerie`).
 */
export async function listerArtefacts(): Promise<ArtefactClaude[]> {
  // Tests seulement (jamais dans l'app installée) : une fausse galerie, sans compte claude.ai.
  const galerieTest = process.env.KLYRA_TEST_GALERIE && !app.isPackaged ? process.env.KLYRA_TEST_GALERIE : null;
  if (!galerieTest && !(await etatClaudeAi())) {
    throw new Error("Connecte claude.ai dans l’app (bouton « Connecter claude.ai ») : la liste se lit dans ta galerie claude.ai.");
  }
  return aTour(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { session: sessionClaude(), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const depuisJson: ArtefactClaude[] = [];
    const reponses = new Map<string, string>();
    const outil = win.webContents.debugger;
    // L'écoute du réseau ne démarre que sur une page chargée : une page vide d'abord, puis la galerie.
    await win.loadURL("about:blank");
    try {
      outil.attach("1.3");
      outil.on("message", (_e, methode: string, params: Record<string, unknown>) => {
        if (methode === "Network.responseReceived") {
          const r = params.response as { url: string; mimeType: string };
          if (/json/i.test(r.mimeType) && /^https:\/\/claude\.ai\/.*artifact/i.test(r.url)) reponses.set(params.requestId as string, r.url);
        } else if (methode === "Network.loadingFinished" && reponses.has(params.requestId as string)) {
          const adresse = reponses.get(params.requestId as string)!;
          void outil
            .sendCommand("Network.getResponseBody", { requestId: params.requestId })
            .then((corps: { body: string; base64Encoded: boolean }) => {
              const brut = corps.base64Encoded ? Buffer.from(corps.body, "base64").toString("utf8") : corps.body;
              depuisJson.push(...artefactsDuJson(adresse, JSON.parse(brut)));
            })
            .catch(() => {});
        }
      });
      await Promise.race([
        outil.sendCommand("Network.enable"),
        new Promise((_, refus) => setTimeout(() => refus(new Error("délai")), 3000)),
      ]);
    } catch {
      // Sans les réponses JSON, les liens de la page suffisent.
    }
    try {
      await win.loadURL(galerieTest ?? GALERIE);
      if (/\/login|\/logout/.test(win.webContents.getURL())) {
        throw new Error("La session claude.ai de l’app a expiré : reconnecte claude.ai, puis relis la liste.");
      }
      // La galerie se remplit après le chargement, et au fil du défilement : on relève jusqu'à ce que ça ne bouge plus.
      let liens: { url: string; titre: string }[] = [];
      let stable = 0;
      const fin = Date.now() + DELAI_GALERIE_MS;
      while (Date.now() < fin && stable < 4) {
        await new Promise((r) => setTimeout(r, 1000));
        const releves = (await win.webContents.executeJavaScript(RELEVER_LIENS)) as { url: string; titre: string }[];
        const avant = liens.length + depuisJson.length;
        liens = releves;
        stable = liens.length + depuisJson.length === avant && avant > 0 ? stable + 1 : 0;
      }
      const liste = fusionnerGalerie(liens, depuisJson);
      if (!liste.length) {
        throw new Error("Aucun artefact trouvé dans ta galerie claude.ai (claude.ai/code/artifacts). Si tu en vois là-bas, la page a sans doute changé : signale-le.");
      }
      return liste;
    } finally {
      try {
        outil.detach();
      } catch {
        // déjà détaché
      }
      win.destroy();
    }
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
export async function aTour<T>(fn: () => Promise<T>): Promise<T> {
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
