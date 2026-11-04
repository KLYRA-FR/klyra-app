import { app, BrowserWindow, session, type Session } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { aTour } from "./artefacts";
import { fichierSous, PAGE_ISOLEE, PARTITION_PREFIXE, POLITIQUE, relatifDemande, SCHEMA, typeMime } from "./document-isole";

/**
 * Ouvre un document KLYRA dans une fenêtre de l'app, hors de la session de l'app.
 * Le document ne reçoit ni précharge, ni jeton, ni adresse Convex : seulement ses octets.
 * Une page HTML ou SVG locale passe par ici. Les autres types restent à l'app du système.
 */

const ICONE = path.join(__dirname, "..", "resources", "icon.png");
const DOSSIER_VIGNETTES = () => path.join(app.getPath("userData"), "vignettes-documents");
const ATTENTE_MS = 20_000;
const PAUSE_DESSIN_MS = 1_500;

type Page =
  | { genre: "html"; html: string }
  | { genre: "fichier"; chemin: string }
  | { genre: "dossier"; racine: string };

const pages = new Map<string, Page>();
const sessionsPretes = new Set<string>();

function nouvelId(): string {
  return randomBytes(16).toString("hex");
}

function introuvable(): Response {
  return new Response("Introuvable", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Copie dans un ArrayBuffer : le Uint8Array de Node n'est pas un corps de Response. */
function enBlob(octets: Uint8Array): Blob {
  const tampon = new ArrayBuffer(octets.byteLength);
  new Uint8Array(tampon).set(octets);
  return new Blob([tampon]);
}

function reponse(corps: Uint8Array | string, type: string): Response {
  return new Response(typeof corps === "string" ? corps : enBlob(corps), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Security-Policy": POLITIQUE,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function servir(page: Page, pathname: string): Response {
  const relatif = relatifDemande(pathname);
  if (!relatif) return introuvable();
  if (page.genre === "html") {
    if (relatif !== "index.html") return introuvable();
    return reponse(page.html, "text/html; charset=utf-8");
  }
  if (page.genre === "fichier") {
    if (relatif !== "index.html") return introuvable();
    return reponse(new Uint8Array(readFileSync(page.chemin)), typeMime(page.chemin));
  }
  const fichier = fichierSous(page.racine, relatif === "index.html" ? "index.html" : relatif);
  if (!fichier) return introuvable();
  return reponse(new Uint8Array(readFileSync(fichier)), typeMime(fichier));
}

function sessionDe(id: string): Session {
  const partition = `${PARTITION_PREFIXE}${id}`;
  const ses = session.fromPartition(partition);
  if (!sessionsPretes.has(partition)) {
    ses.protocol.handle(SCHEMA, (request) => {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return introuvable();
      }
      if (url.hostname !== id) return introuvable();
      const page = pages.get(id);
      if (!page) return introuvable();
      return servir(page, url.pathname);
    });
    ses.webRequest.onBeforeRequest((details, callback) => {
      try {
        const url = new URL(details.url);
        callback(url.protocol === `${SCHEMA}:` && url.hostname === id ? {} : { cancel: true });
      } catch {
        callback({ cancel: true });
      }
    });
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    sessionsPretes.add(partition);
  }
  return ses;
}

function htmlValide(html: unknown): string {
  if (typeof html !== "string" || html.length === 0) throw new Error("Ce document est vide.");
  return html;
}

function titreFenetre(titre: unknown): string {
  const propre = (typeof titre === "string" ? titre : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (propre || "Document").slice(0, 120);
}

function nomCache(cle: unknown): string {
  if (typeof cle !== "string" || !cle || cle.length > 300 || cle.includes("\0")) throw new Error("Document invalide.");
  return createHash("sha256").update(cle).digest("hex").slice(0, 32);
}

function adresse(id: string): string {
  return `${SCHEMA}://${id}/index.html`;
}

function creerFenetre(id: string, titre: string, horsEcran: boolean): BrowserWindow {
  const win = new BrowserWindow({
    show: !horsEcran,
    width: 1280,
    height: horsEcran ? 800 : 860,
    title: titre,
    autoHideMenuBar: true,
    icon: ICONE,
    backgroundColor: "#f7f6f3",
    webPreferences: {
      session: sessionDe(id),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      offscreen: horsEcran,
    },
  });
  const rester = (vers: string) => {
    try {
      const url = new URL(vers);
      return url.protocol === `${SCHEMA}:` && url.hostname === id;
    } catch {
      return false;
    }
  };
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, vers) => {
    if (!rester(vers)) event.preventDefault();
  });
  win.webContents.on("will-redirect", (event, vers) => {
    if (!rester(vers)) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.on("closed", () => pages.delete(id));
  return win;
}

function charger(win: BrowserWindow, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let regle = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fin = (erreur?: Error) => {
      if (regle) return;
      regle = true;
      if (timer) clearTimeout(timer);
      if (erreur) reject(erreur);
      else resolve();
    };
    timer = setTimeout(() => fin(new Error("Le document ne s’affiche pas.")), ATTENTE_MS);
    /* Une image ou une police refusée ne fait pas échouer la page. Seul le cadre principal compte. */
    win.webContents.on("did-finish-load", () => fin());
    win.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      fin(new Error(description || "Le document ne s’ouvre pas."));
    });
    void win.loadURL(adresse(id)).catch((e: unknown) => fin(e instanceof Error ? e : new Error("Le document ne s’ouvre pas.")));
  });
}

async function dessiner(page: Page): Promise<Electron.NativeImage> {
  const id = nouvelId();
  pages.set(id, page);
  const win = creerFenetre(id, "Aperçu", true);
  try {
    await charger(win, id);
    await new Promise((r) => setTimeout(r, PAUSE_DESSIN_MS));
    return await win.webContents.capturePage();
  } finally {
    if (!win.isDestroyed()) win.destroy();
    pages.delete(id);
  }
}

async function montrer(page: Page, titre: string): Promise<void> {
  const id = nouvelId();
  pages.set(id, page);
  const win = creerFenetre(id, titre, false);
  try {
    await charger(win, id);
  } catch (e) {
    if (!win.isDestroyed()) win.destroy();
    pages.delete(id);
    throw e;
  }
}

/** Ouvre le HTML reçu du compte. L'adresse de stockage n'est pas un argument. */
export async function ouvrirHtml(html: unknown, titre: unknown): Promise<void> {
  await montrer({ genre: "html", html: htmlValide(html) }, titreFenetre(titre));
}

/** Ouvre une page locale : un fichier seul, ou un dossier et son `index.html` (ses fichiers, pas le disque). */
export async function ouvrirChemin(chemin: string): Promise<void> {
  if (!existsSync(chemin)) throw new Error("Ce fichier n’existe plus à cet endroit.");
  const dossier = statSync(chemin).isDirectory();
  if (dossier && !existsSync(path.join(chemin, "index.html"))) throw new Error("Ce dossier n’a pas de page index.html.");
  const page: Page = dossier ? { genre: "dossier", racine: chemin } : { genre: "fichier", chemin };
  if (!dossier && !PAGE_ISOLEE.test(chemin)) throw new Error("Ce fichier ne s’ouvre pas dans l’app.");
  await montrer(page, titreFenetre(path.basename(chemin)));
}

/** Dessine une page locale pour sa vignette. Le fichier n'est pas servi en `file://`. */
export function imageDeChemin(chemin: string): Promise<Electron.NativeImage> {
  if (statSync(chemin).isDirectory()) return dessiner({ genre: "dossier", racine: chemin });
  return dessiner({ genre: "fichier", chemin });
}

/** Vignette PNG (data URL) d'un HTML déjà lu. `cle` est l'identifiant et la date, pas une adresse. */
export async function vignetteHtml(cle: unknown, html: unknown, forcer = false): Promise<string | null> {
  const fichier = path.join(DOSSIER_VIGNETTES(), `${nomCache(cle)}.png`);
  if (!forcer && existsSync(fichier)) return `data:image/png;base64,${(await readFile(fichier)).toString("base64")}`;
  const corps = htmlValide(html);
  return aTour(async () => {
    try {
      const image = await dessiner({ genre: "html", html: corps });
      if (image.isEmpty()) return null;
      const png = (image.getSize().width > 640 ? image.resize({ width: 640 }) : image).toPNG();
      mkdirSync(DOSSIER_VIGNETTES(), { recursive: true });
      await writeFile(fichier, png);
      return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      return null;
    }
  });
}
