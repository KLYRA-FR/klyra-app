import { app, BrowserWindow, nativeImage, shell } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { aTour } from "./artefacts";

/**
 * Les rendus des agents (outil `publier_artefact`) : des fichiers de ce PC, montrés dans l'écran Artefacts.
 * - Vignette : l'image elle-même, ou la page (HTML, SVG, image que Node ne lit pas) dessinée hors écran,
 *   dans une fenêtre isolée qui ne navigue nulle part. Gardée tant que le fichier ne change pas.
 * - Ouverture : par l'app du système, seulement pour les types qu'on sait montrer ; le reste, dans le dossier.
 */

const DOSSIER_VIGNETTES = () => path.join(app.getPath("userData"), "vignettes-rendus");
const IMAGES = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const DESSINES = /\.(html?|svg|png|jpe?g|gif|webp|bmp|avif)$/i;
/** Ce que l'app du système peut ouvrir sans rien exécuter. */
const OUVRABLES = /\.(html?|svg|png|jpe?g|gif|webp|bmp|avif|mp4|webm|mov|m4v|pdf|md|txt|csv|docx?|xlsx?|pptx?|key|odt|ods|odp)$/i;

/** Le fichier d'un rendu : un chemin complet vers un fichier qui existe. */
function fichierDuRendu(chemin: unknown): string {
  if (typeof chemin !== "string" || !chemin) throw new Error("Chemin invalide.");
  const absolu = chemin.startsWith("~") ? path.join(os.homedir(), chemin.slice(1)) : chemin;
  if (!path.isAbsolute(absolu)) throw new Error("Chemin invalide.");
  if (!existsSync(absolu) || !statSync(absolu).isFile()) throw new Error("Ce fichier n’existe plus à cet endroit.");
  return absolu;
}

/** Dessine le fichier dans une fenêtre hors écran, isolée, sans navigation ni nouvelle fenêtre. */
async function dessiner(fichier: string): Promise<Electron.NativeImage> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, partition: "rendus" },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  try {
    await win.loadFile(fichier);
    // Une petite app se dessine après le chargement : on lui laisse le temps.
    await new Promise((r) => setTimeout(r, 1500));
    return await win.webContents.capturePage();
  } finally {
    win.destroy();
  }
}

/** La vignette d'un rendu (data URL PNG), ou null pour une vidéo, un PDF, un document. */
export async function vignetteRendu(chemin: unknown, forcer = false): Promise<string | null> {
  const fichier = fichierDuRendu(chemin);
  if (!DESSINES.test(fichier)) return null;
  const { mtimeMs, size } = statSync(fichier);
  const cle = createHash("sha256").update(`${fichier}\0${mtimeMs}\0${size}`).digest("hex").slice(0, 32);
  const cache = path.join(DOSSIER_VIGNETTES(), `${cle}.png`);
  if (!forcer && existsSync(cache)) return `data:image/png;base64,${(await readFile(cache)).toString("base64")}`;

  return aTour(async () => {
    try {
      const lue = IMAGES.test(fichier) ? nativeImage.createFromPath(fichier) : null;
      const image = lue && !lue.isEmpty() ? lue : await dessiner(fichier);
      if (image.isEmpty()) return null;
      const png = (image.getSize().width > 640 ? image.resize({ width: 640 }) : image).toPNG();
      mkdirSync(DOSSIER_VIGNETTES(), { recursive: true });
      await writeFile(cache, png);
      return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      return null;
    }
  });
}

/** Ouvre le rendu avec l'app du système ; un type qu'on ne sait pas montrer est montré dans son dossier. */
export async function ouvrirRendu(chemin: unknown): Promise<void> {
  const fichier = fichierDuRendu(chemin);
  if (!OUVRABLES.test(fichier)) return shell.showItemInFolder(fichier);
  const erreur = await shell.openPath(fichier);
  if (erreur) throw new Error(erreur);
}

export function montrerRendu(chemin: unknown): void {
  shell.showItemInFolder(fichierDuRendu(chemin));
}
