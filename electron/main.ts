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
  actualiserUtilisation,
  cancelAgent,
  derniereUtilisation,
  dossierExiste,
  findClaude,
  restaurerUtilisation,
  runAgent,
  streamAgent,
  surUtilisation,
  type StreamOptions,
  type Utilisation,
} from "./claude";
import { readConversations, writeConversations } from "./conversations";

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

/* L'export Next injecte des scripts inline : 'unsafe-inline' reste nécessaire. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
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
  /* Réponse en direct : les événements arrivent sur `claude:event`, jusqu'à `fin`. */
  handle("claude:stream", (requestId: string, options: StreamOptions) => {
    const sender = BrowserWindow.getAllWindows()[0]?.webContents;
    streamAgent(requestId, options, (agentEvent) => {
      if (sender && !sender.isDestroyed()) sender.send("claude:event", requestId, agentEvent);
    });
    return null;
  });
  handle("projets:dossier-existe", (dossier: string) => dossierExiste(dossier));
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
  handle("claude:utilisation:actualiser", () => actualiserUtilisation());
}

void app.whenReady().then(() => {
  if (!DEV_URL) protocol.handle("app", serveExport);
  registerBridge();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
