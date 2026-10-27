import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AgentError,
  agentsDir,
  createAgent,
  installTeam,
  listAgents,
  listHistory,
  readMeta,
  readVersion,
  watchAgents,
  writeAgent,
  writeMeta,
  type AgentsMeta,
} from "./agents";
import { readFile, writeFile } from "node:fs/promises";
import {
  autoriser,
  actualiserUtilisation,
  cancelAgent,
  compteClaude,
  connecterClaude,
  deconnecterClaude,
  derniereUtilisation,
  dossierExiste,
  findClaude,
  restaurerUtilisation,
  runAgent,
  streamAgent,
  surUtilisation,
  type Decision,
  type StreamOptions,
  type Utilisation,
} from "./claude";
import { ecrituresTerminees, readConversations, writeConversations } from "./conversations";
import { arbreDossier, cheminDansProjet, lireFichier, utilisateurSysteme } from "./projets";
import { etatGit, publier } from "./git";
import { adresseWebhook, demarrerWebhooks, ecrireFichierTexte } from "./workflows";
import {
  connecterClaudeAi,
  deconnecterClaudeAi,
  etatClaudeAi,
  listerArtefacts,
  ouvrirArtefact,
  vignetteArtefact,
} from "./artefacts";

/**
 * Process principal Electron.
 * - En dev (`pnpm desktop`) : charge le serveur Next sur KLYRA_DEV_URL.
 * - En version finale (`pnpm start:desktop`) : sert l'export statique `out/`
 *   via le protocole `app://`, sans serveur.
 * - `KLYRA_SMOKE_TEST=1` : fenêtre invisible, affiche le texte rendu puis quitte
 *   (vérifie que la version finale s'affiche, sans capture d'écran).
 */

const DEV_URL = process.env.KLYRA_DEV_URL;
/* Tests : données de l'app (historique, réglages) dans un dossier à part. */
if (process.env.KLYRA_USER_DATA) app.setPath("userData", process.env.KLYRA_USER_DATA);
const SMOKE_TEST = process.env.KLYRA_SMOKE_TEST === "1";
const OUT_DIR = path.join(__dirname, "..", "out");
/** Icône de l'app : le logo-icône KLYRA (signe blanc sur K1), cf. resources/icon.png. */
const ICONE = path.join(__dirname, "..", "resources", "icon.png");

/* Le nom de l'app dans le Dock, le menu et « À propos ». */
app.setName("KLYRA");
/* Les données de la personne (conversations, projets, réglages) restent
   toujours dans le même dossier, quel que soit le nom affiché de l'app. */
if (!process.env.KLYRA_USER_DATA) app.setPath("userData", path.join(app.getPath("appData"), "klyra-app"));

/* L'export Next injecte des scripts inline : 'unsafe-inline' reste nécessaire. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  // L'aperçu d'un projet : son serveur de dev, sur ce Mac.
  "frame-src http://localhost:* http://127.0.0.1:*",
].join("; ");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** `/chat` → `out/chat.html`, `/` → `out/index.html`, assets tels quels. */
function resolveExportedFile(pathname: string): string | null {
  let relative = decodeURIComponent(pathname);
  if (relative.endsWith("/")) relative += "index.html";
  if (!path.extname(relative)) relative += ".html";
  const file = path.normalize(path.join(OUT_DIR, relative));
  // Refuse tout chemin qui sortirait du dossier exporté.
  return file.startsWith(OUT_DIR) ? file : null;
}

async function serveExport(request: Request): Promise<Response> {
  const file = resolveExportedFile(new URL(request.url).pathname);
  if (!file) return new Response("Introuvable", { status: 404 });
  const response = await net.fetch(pathToFileURL(file).toString());
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  return new Response(response.body, { status: response.status, headers });
}

async function runSmokeTest(win: BrowserWindow) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const text: string = await win.webContents.executeJavaScript(
    "document.querySelector('main')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? ''",
  );
  console.log(text ? `OK — ${text}` : "ÉCHEC — rien n'est affiché");
  app.exit(text ? 0 : 1);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: !SMOKE_TEST,
    title: "KLYRA",
    icon: ICONE,
    titleBarStyle: "hiddenInset",
    // Boutons de la fenêtre dans la bande de titre de 28 px, au-dessus du logo.
    trafficLightPosition: { x: 14, y: 8 },
    // fond-page, le fond de l'app sous le panneau blanc.
    backgroundColor: "#F9F9F9",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Les liens externes s'ouvrent dans le navigateur, pas dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const url = DEV_URL ?? "app://klyra/";
  void win.loadURL(SMOKE_TEST ? `${url.replace(/\/$/, "")}/chat?id=hero-home` : url).then(() => {
    if (SMOKE_TEST) void runSmokeTest(win);
  });
}

/* ─── Pont avec l'interface (cf. preload.ts) ───────────────────── */

type Reponse<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** Chaque appel renvoie un résultat explicite : l'interface affiche l'erreur exacte. */
function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Reponse<T>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) };
    } catch (error) {
      if (error instanceof AgentError) return { ok: false, code: error.code, message: error.message };
      return { ok: false, code: "erreur", message: error instanceof Error ? error.message : String(error) };
    }
  });
}

function registerBridge() {
  handle("agents:list", async () => {
    const listing = await listAgents();
    watchAgents();
    return listing;
  });
  handle("agents:write", (name: string, content: string, expected: number | null) => writeAgent(name, content, expected));
  handle("agents:create", async (name: string, content: string) => {
    const file = await createAgent(name, content);
    watchAgents();
    return file;
  });
  handle("agents:install", async (templates: { name: string; content: string }[]) => {
    const installed = await installTeam(templates);
    watchAgents();
    return installed;
  });
  handle("agents:history", (name: string) => listHistory(name));
  handle("agents:version", (name: string, id: string) => readVersion(name, id));
  handle("agents:meta:read", () => readMeta());
  handle("agents:meta:write", (meta: AgentsMeta) => writeMeta(meta));
  handle("agents:reveal", (name: string) => {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new AgentError("nom-invalide", "Nom d’agent invalide.");
    shell.showItemInFolder(path.join(agentsDir(), `${name}.md`));
  });
  handle("claude:status", () => ({ path: findClaude() }));
  handle("claude:run", (requestId: string, agent: string, prompt: string) => runAgent(requestId, agent, prompt));
  handle("claude:cancel", (requestId: string) => cancelAgent(requestId));
  handle("claude:autoriser", (requestId: string, demandeId: string, decision: Decision) => {
    if (!["oui", "toujours", "non"].includes(decision)) throw new Error("Réponse invalide.");
    return autoriser(requestId, demandeId, decision);
  });
  /* Réponse en direct : les événements arrivent sur `claude:event`, jusqu'à `fin`. */
  handle("claude:stream", (requestId: string, options: StreamOptions) => {
    const sender = BrowserWindow.getAllWindows()[0]?.webContents;
    streamAgent(requestId, options, (agentEvent) => {
      if (sender && !sender.isDestroyed()) sender.send("claude:event", requestId, agentEvent);
    });
    return null;
  });
  handle("projets:dossier-existe", (dossier: string) => dossierExiste(dossier));
  handle("projets:choisir-dossier", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = { properties: ["openDirectory" as const], title: "Choisir le dossier du projet" };
    const choix = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return choix.canceled ? null : (choix.filePaths[0] ?? null);
  });
  handle("projets:arbre", (dossier: string) => {
    if (typeof dossier !== "string" || !dossier) throw new Error("Dossier invalide.");
    return arbreDossier(dossier);
  });
  handle("systeme:utilisateur", () => utilisateurSysteme());
  handle("projets:lire-fichier", (dossier: string, relatif: string) => lireFichier(dossier, relatif));
  handle("projets:ouvrir-fichier", async (dossier: string, relatif: string) => {
    const erreur = await shell.openPath(cheminDansProjet(dossier, relatif));
    if (erreur) throw new Error(erreur);
  });
  handle("projets:montrer-fichier", (dossier: string, relatif: string) => shell.showItemInFolder(cheminDansProjet(dossier, relatif)));
  handle("git:etat", (dossier: string) => etatGit(dossier));
  /* Un lien local (serveur de dev d'un projet) cliqué dans une conversation : une fenêtre de l'app. */
  handle("fenetres:ouvrir", (url: string) => {
    if (typeof url !== "string" || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) {
      throw new Error("Seules les adresses locales s’ouvrent dans l’app.");
    }
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: url,
      icon: ICONE,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setWindowOpenHandler(({ url: lien }) => {
      void shell.openExternal(lien);
      return { action: "deny" };
    });
    void win.loadURL(url);
  });
  handle("artefacts:lister", () => listerArtefacts());
  handle("artefacts:vignette", (url: string, forcer: boolean) => vignetteArtefact(url, !!forcer));
  handle("artefacts:ouvrir", (url: string, titre: string) => ouvrirArtefact(url, String(titre ?? "Artefact")));
  handle("claude-ai:etat", () => etatClaudeAi());
  handle("claude-ai:connexion", () => connecterClaudeAi(BrowserWindow.getFocusedWindow() ?? undefined));
  handle("claude-ai:deconnexion", () => deconnecterClaudeAi());
  handle("git:publier", (dossier: string, message: string) => publier(dossier, message));
  handle("fichiers:choisir", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const choix = win
      ? await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], title: "Joindre des fichiers" })
      : await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], title: "Joindre des fichiers" });
    return choix.canceled ? [] : choix.filePaths;
  });
  handle("fichiers:montrer", (chemin: string) => {
    if (typeof chemin !== "string" || !path.isAbsolute(chemin)) throw new Error("Chemin invalide.");
    shell.showItemInFolder(chemin);
  });
  handle("fichiers:ecrire", (chemin: string, texte: string) => ecrireFichierTexte(chemin, texte));
  handle("webhooks:adresse", (secret: string) => adresseWebhook(secret));
  demarrerWebhooks();
  handle("conversations:read", () => readConversations());
  handle("conversations:write", (data: unknown) => writeConversations(data));

  /* Utilisation de Claude : la dernière connue, gardée sur le disque et
     envoyée à l'interface dès qu'une réponse d'agent la met à jour. */
  const fichierUtilisation = path.join(app.getPath("userData"), "utilisation.json");
  void readFile(fichierUtilisation, "utf8")
    .then((brut) => restaurerUtilisation(JSON.parse(brut) as Utilisation))
    .catch(() => {});
  surUtilisation((u) => {
    void writeFile(fichierUtilisation, JSON.stringify(u), "utf8").catch(() => {});
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("claude:utilisation", u);
  });
  handle("claude:utilisation", () => derniereUtilisation());
  handle("claude:compte", () => compteClaude());
  handle("claude:connexion", () => connecterClaude());
  handle("claude:deconnexion", () => deconnecterClaude());
  handle("claude:utilisation:actualiser", () => actualiserUtilisation());
}

void app.whenReady().then(() => {
  // Sans version installée, macOS prend l'icône d'Electron : on la remplace dans le Dock.
  if (process.platform === "darwin") app.dock?.setIcon(ICONE);
  app.setAboutPanelOptions({ applicationName: "KLYRA", iconPath: ICONE });
  if (!DEV_URL) protocol.handle("app", serveExport);
  registerBridge();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* Avant de quitter : l'interface envoie son dernier état, et on attend qu'il soit écrit. */
let quitteApresEcriture = false;
app.on("before-quit", (event) => {
  if (quitteApresEcriture) return;
  event.preventDefault();
  quitteApresEcriture = true;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("app:avant-fermeture");
  // Le temps que l'interface envoie son état, puis que le fichier soit écrit (2 s au plus).
  setTimeout(() => {
    void Promise.race([ecrituresTerminees(), new Promise((r) => setTimeout(r, 1500))]).then(() => app.quit());
  }, 300);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
