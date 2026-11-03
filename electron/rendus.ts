import { app, BrowserWindow, dialog, nativeImage, shell } from "electron";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { aTour } from "./artefacts";

/**
 * Les rendus des agents (outil `publier_artefact`) : des fichiers de ce PC, montrés dans l'écran Artefacts.
 * - Publier copie le fichier (ou le dossier d'une page avec ses ressources) dans l'espace de l'agent,
 *   `~/.klyra/rendus/<agent>/` : le livrable ne casse pas si l'agent range son dossier, change de branche
 *   ou efface ses essais. L'app gère ces copies ; l'original reste où l'agent l'a mis.
 * - Vignette : l'image elle-même, ou la page (HTML, SVG, image que Node ne lit pas) dessinée hors écran,
 *   dans une fenêtre isolée qui ne navigue nulle part. Gardée tant que le fichier ne change pas.
 * - Ouverture : par l'app du système, seulement pour les types qu'on sait montrer ; le reste, dans le dossier.
 */

const DOSSIER_VIGNETTES = () => path.join(app.getPath("userData"), "vignettes-rendus");
export const RACINE_RENDUS = path.join(os.homedir(), ".klyra", "rendus");
const ATELIER = path.join(os.homedir(), ".klyra", "atelier");
const NOM_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Une page avec ses ressources, au plus : au-delà, ce n'est plus un livrable mais un projet. */
const TAILLE_MAX = 300 * 1024 * 1024;
/** Jamais copiés avec le dossier d'une page. */
const IGNORES = new Set(["node_modules", ".git", ".next", ".turbo", ".cache", "dist-electron"]);
const IMAGES = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const DESSINES = /\.(html?|svg|png|jpe?g|gif|webp|bmp|avif)$/i;
/** Ce que l'app du système peut ouvrir sans rien exécuter. */
const OUVRABLES = /\.(html?|svg|png|jpe?g|gif|webp|bmp|avif|mp4|webm|mov|m4v|pdf|md|txt|csv|docx?|xlsx?|pptx?|key|odt|ods|odp)$/i;

function absolu(chemin: unknown): string {
  if (typeof chemin !== "string" || !chemin) throw new Error("Chemin invalide.");
  const complet = chemin.startsWith("~") ? path.join(os.homedir(), chemin.slice(1)) : chemin;
  if (!path.isAbsolute(complet)) throw new Error("Chemin invalide.");
  return path.resolve(complet);
}

const dansLesRendus = (chemin: string) => {
  const rel = path.relative(RACINE_RENDUS, chemin);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Le fichier à montrer d'un rendu : le fichier lui-même, ou l'`index.html` d'un dossier. */
function fichierDuRendu(chemin: unknown): string {
  const complet = absolu(chemin);
  if (!existsSync(complet)) throw new Error("Ce fichier n’existe plus à cet endroit.");
  if (statSync(complet).isDirectory()) {
    const index = path.join(complet, "index.html");
    if (!existsSync(index)) throw new Error("Ce dossier n’a pas de page index.html.");
    return index;
  }
  return complet;
}

/** La taille d'un fichier ou d'un dossier (sans ce qu'on ne copie pas) ; s'arrête dès que `max` est dépassé. */
function taille(chemin: string, max = Infinity): number {
  const s = statSync(chemin);
  if (!s.isDirectory()) return s.size;
  let total = 0;
  for (const e of readdirSync(chemin, { withFileTypes: true })) {
    if (IGNORES.has(e.name) || e.isSymbolicLink()) continue;
    total += taille(path.join(chemin, e.name), max - total);
    if (total > max) return total;
  }
  return total;
}

/** Un nom libre dans `dossier` : « nom », sinon « nom (2) », « nom (3) »… */
function nomLibre(dossier: string, nom: string): string {
  const ext = path.extname(nom);
  const base = nom.slice(0, nom.length - ext.length);
  for (let i = 1; ; i++) {
    const essai = path.join(dossier, i === 1 ? nom : `${base} (${i})${ext}`);
    if (!existsSync(essai)) return essai;
  }
}

function copier(depuis: string, vers: string) {
  cpSync(depuis, vers, { recursive: true, dereference: false, filter: (src) => !IGNORES.has(path.basename(src)) });
}

export interface CopieRendu {
  chemin: string;
  taille: number;
  dossier: boolean;
}

/**
 * Copie un livrable dans l'espace de l'agent. `remplace` : la copie d'une publication précédente du même
 * original, remplacée (seulement si elle est bien dans l'espace des rendus).
 */
export function copierRendu(origine: unknown, agent: unknown, remplace: unknown): CopieRendu {
  const source = absolu(origine);
  if (typeof agent !== "string" || !NOM_AGENT.test(agent)) throw new Error("Agent invalide.");
  if (!existsSync(source)) throw new Error(`Aucun fichier à ${source} sur ce poste : vérifie le chemin complet.`);
  if (dansLesRendus(source)) throw new Error("Ce fichier est déjà une copie publiée : donne le chemin de l’original.");
  const dossier = statSync(source).isDirectory();
  if (dossier && !existsSync(path.join(source, "index.html"))) throw new Error("Un dossier se publie s’il contient une page index.html ; sinon, publie ses fichiers un par un.");
  const poids = taille(source, TAILLE_MAX);
  if (poids > TAILLE_MAX) throw new Error("Trop lourd pour un livrable (300 Mo au plus).");
  if (typeof remplace === "string" && remplace) {
    const ancienne = absolu(remplace);
    if (dansLesRendus(ancienne)) rmSync(ancienne, { recursive: true, force: true });
  }
  const espace = path.join(RACINE_RENDUS, agent);
  mkdirSync(espace, { recursive: true });
  const jour = new Date().toISOString().slice(0, 10);
  const vers = nomLibre(espace, `${jour} ${path.basename(source)}`);
  copier(source, vers);
  return { chemin: vers, taille: poids, dossier };
}

/** Supprime la copie d'un livrable retiré de la liste ; jamais hors de l'espace des rendus. */
export function supprimerCopieRendu(chemin: unknown): void {
  const complet = absolu(chemin);
  if (!dansLesRendus(complet)) throw new Error("Ce fichier n’est pas une copie de livrable.");
  rmSync(complet, { recursive: true, force: true });
}

/** « Enregistrer dans… » : copie le livrable dans un dossier choisi (celui d'un projet, souvent). null : annulé. */
export async function enregistrerRenduDans(chemin: unknown, dossierPropose: unknown): Promise<string | null> {
  const source = absolu(chemin);
  if (!existsSync(source)) throw new Error("Ce fichier n’existe plus à cet endroit.");
  // Tests seulement (jamais dans l'app installée) : le dossier « choisi » sans fenêtre du système.
  let dossier = process.env.KLYRA_TEST_DOSSIER && !app.isPackaged ? process.env.KLYRA_TEST_DOSSIER : null;
  if (!dossier) {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const defaut = typeof dossierPropose === "string" && dossierPropose && existsSync(absolu(dossierPropose)) ? absolu(dossierPropose) : undefined;
    const options = { properties: ["openDirectory" as const, "createDirectory" as const], title: "Enregistrer le livrable dans…", defaultPath: defaut };
    const choix = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    dossier = choix.canceled ? null : (choix.filePaths[0] ?? null);
  }
  if (!dossier) return null;
  const nom = path.basename(source).replace(/^\d{4}-\d{2}-\d{2} /, "");
  const vers = nomLibre(dossier, nom);
  copier(source, vers);
  return vers;
}

/** Ouvre l'espace des livrables d'un agent, ou son dossier de travail hors projet. */
export async function ouvrirDossierAgent(agent: unknown, quoi: unknown): Promise<void> {
  if (typeof agent !== "string" || !NOM_AGENT.test(agent)) throw new Error("Agent invalide.");
  const dossier = path.join(quoi === "atelier" ? ATELIER : RACINE_RENDUS, agent);
  mkdirSync(dossier, { recursive: true });
  const erreur = await shell.openPath(dossier);
  if (erreur) throw new Error(erreur);
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
