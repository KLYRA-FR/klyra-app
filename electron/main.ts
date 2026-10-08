import { app, BrowserWindow, net, protocol, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Process principal Electron.
 * - En dev (`pnpm desktop`) : charge le serveur Next sur KLYRA_DEV_URL.
 * - En version finale (`pnpm start:desktop`) : sert l'export statique `out/`
 *   via le protocole `app://`, sans serveur.
 * - `KLYRA_SMOKE_TEST=1` : fenêtre invisible, affiche le texte rendu puis quitte
 *   (vérifie que la version finale s'affiche, sans capture d'écran).
 */

const DEV_URL = process.env.KLYRA_DEV_URL;
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
    backgroundColor: "#FFFFFF",
    webPreferences: {
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

void app.whenReady().then(() => {
  if (!DEV_URL) protocol.handle("app", serveExport);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
