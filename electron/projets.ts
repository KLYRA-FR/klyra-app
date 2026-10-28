import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Les projets sur le disque de chacun : le contenu réel d'un dossier, et le
 * nom de la personne qui utilise ce Mac (pour son profil dans l'app).
 */

export interface Noeud {
  name: string;
  /** Chemin relatif à la racine du projet. */
  path: string;
  kind: "dossier" | "fichier";
  children?: Noeud[];
}

/** Dossiers qu'on ne parcourt pas : dépendances, builds, caches. */
const IGNORES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "dist-electron",
  "out",
  "build",
  ".turbo",
  ".vercel",
  ".cache",
  "coverage",
  ".DS_Store",
]);
const PROFONDEUR_MAX = 6;
const NOEUDS_MAX = 4000;

function absolu(dossier: string): string {
  return dossier.startsWith("~") ? path.join(os.homedir(), dossier.slice(1)) : dossier;
}

/** L'arborescence d'un dossier, dossiers d'abord, sans les dossiers lourds. */
export async function arbreDossier(dossier: string): Promise<Noeud[]> {
  const racine = absolu(dossier);
  if (!path.isAbsolute(racine)) throw new Error("Chemin de projet invalide.");
  let compte = 0;

  const lire = async (relatif: string, profondeur: number): Promise<Noeud[]> => {
    if (profondeur > PROFONDEUR_MAX || compte > NOEUDS_MAX) return [];
    const entrees = await readdir(path.join(racine, relatif), { withFileTypes: true }).catch(() => []);
    const triees = entrees
      .filter((e) => !IGNORES.has(e.name) && !e.name.startsWith("node_modules") && (e.isDirectory() || e.isFile()))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, "fr"));
    const noeuds: Noeud[] = [];
    for (const e of triees) {
      if (++compte > NOEUDS_MAX) break;
      const chemin = relatif ? `${relatif}/${e.name}` : e.name;
      noeuds.push(
        e.isDirectory()
          ? { name: e.name, path: chemin, kind: "dossier", children: await lire(chemin, profondeur + 1) }
          : { name: e.name, path: chemin, kind: "fichier" },
      );
    }
    return noeuds;
  };

  return lire("", 0);
}

/**
 * Les pages d'un site Next (dossier `app/` ou `src/app/`), pour les suggestions de la barre
 * d'adresse de l'aperçu : « /secteurs/logistique-transport »… Les groupes « (marketing) »
 * ne comptent pas dans l'adresse ; les routes dynamiques « [slug] » sont sautées.
 */
export async function pagesDuSite(dossier: string): Promise<string[]> {
  const racine = absolu(dossier);
  if (!path.isAbsolute(racine)) throw new Error("Chemin de projet invalide.");
  const pages = new Set<string>();
  const parcourir = async (dir: string, segments: string[], profondeur: number): Promise<void> => {
    if (profondeur > 10 || pages.size > 500) return;
    const entrees = await readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entrees.some((e) => e.isFile() && /^page\.(tsx|jsx|ts|js|mdx)$/.test(e.name))) pages.add(`/${segments.join("/")}`);
    for (const e of entrees) {
      if (!e.isDirectory() || /^[_@[]/.test(e.name) || IGNORES.has(e.name)) continue;
      const groupe = /^\(.*\)$/.test(e.name);
      await parcourir(path.join(dir, e.name), groupe ? segments : [...segments, e.name], profondeur + 1);
    }
  };
  for (const base of ["src/app", "app"]) await parcourir(path.join(racine, base), [], 0);
  return [...pages].sort((a, b) => a.localeCompare(b, "fr"));
}

/** Le nom complet de la session Mac (« Pelin Dupont »), sinon l'identifiant. */
export function utilisateurSysteme(): Promise<{ nom: string; identifiant: string }> {
  const identifiant = os.userInfo().username;
  return new Promise((resolve) => {
    if (process.platform !== "darwin") return resolve({ nom: identifiant, identifiant });
    execFile("id", ["-F"], (erreur, sortie) => {
      const nom = erreur ? "" : sortie.trim();
      resolve({ nom: nom || identifiant, identifiant });
    });
  });
}

/* ─── Lire un fichier du projet (visionneuse) ──────────────────── */

const IMAGES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
};
const IMAGE_MAX = 15 * 1024 * 1024;
const TEXTE_MAX = 1.5 * 1024 * 1024;

export type ContenuFichier =
  | { type: "image"; dataUrl: string; taille: number }
  | { type: "texte"; texte: string; taille: number }
  | { type: "autre"; taille: number; raison: string };

/** Le chemin complet d'un fichier du projet ; refuse tout chemin qui sortirait du dossier. */
export function cheminDansProjet(dossier: string, relatif: string): string {
  const racine = path.resolve(absolu(dossier));
  const cible = path.resolve(racine, relatif);
  const rel = path.relative(racine, cible);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Ce fichier n’est pas dans le projet.");
  return cible;
}

export async function lireFichier(dossier: string, relatif: string): Promise<ContenuFichier> {
  const chemin = cheminDansProjet(dossier, relatif);
  const infos = await stat(chemin);
  const ext = path.extname(chemin).slice(1).toLowerCase();
  if (IMAGES[ext]) {
    if (infos.size > IMAGE_MAX) return { type: "autre", taille: infos.size, raison: "Image trop lourde pour l’aperçu." };
    const contenu = await readFile(chemin);
    return { type: "image", dataUrl: `data:${IMAGES[ext]};base64,${contenu.toString("base64")}`, taille: infos.size };
  }
  if (infos.size > TEXTE_MAX) return { type: "autre", taille: infos.size, raison: "Fichier trop lourd pour l’aperçu." };
  const contenu = await readFile(chemin);
  // Un octet nul dans le début du fichier : c'est du binaire (police, vidéo, archive…).
  if (contenu.subarray(0, 8000).includes(0)) return { type: "autre", taille: infos.size, raison: "Pas d’aperçu pour ce type de fichier." };
  return { type: "texte", texte: contenu.toString("utf8"), taille: infos.size };
}
