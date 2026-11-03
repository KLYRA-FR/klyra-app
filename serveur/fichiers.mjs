/**
 * Les projets sur le VPS : un dossier sous le dossier de klyra, lu un niveau à la fois, comme
 * `arbreDossier` de l'app (electron/projets.ts). La visionneuse reçoit les octets bruts et fait
 * l'aperçu elle-même, sur le PC (`contenuFichier`).
 * Rien hors du dossier de klyra : ni l'arbre, ni la lecture, ni la création.
 */
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { appliquerConsignesProjet, etatConsignesProjet } from "./consignes-projet.mjs";

const IGNORES = new Set(["node_modules", ".git", ".next", "dist", "dist-electron", "out", "build", ".turbo", ".vercel", ".cache", "coverage", ".DS_Store"]);
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp"]);
/** Les mêmes que dans electron/projets.ts. */
const IMAGE_MAX = 15 * 1024 * 1024;
const TEXTE_MAX = 1.5 * 1024 * 1024;

export class ErreurFichier extends Error {}

/** @param {string} home */
export function creerFichiers(home) {
  const racineKlyra = path.resolve(home);

  /** Un dossier de projet : absolu, sous le dossier de klyra. */
  function dossierProjet(dossier) {
    if (typeof dossier !== "string" || !path.isAbsolute(dossier)) throw new ErreurFichier("Chemin de projet invalide.");
    const resolu = path.resolve(dossier);
    const rel = path.relative(racineKlyra, resolu);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new ErreurFichier(`Un projet du VPS doit être sous ${racineKlyra}.`);
    return resolu;
  }

  function dansProjet(dossier, relatif) {
    const racine = dossierProjet(dossier);
    const cible = path.resolve(racine, String(relatif ?? ""));
    const rel = path.relative(racine, cible);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new ErreurFichier("Ce fichier n’est pas dans le projet.");
    return { racine, cible };
  }

  async function arbre(dossier, relatif = "") {
    const { racine, cible } = relatif ? dansProjet(dossier, relatif) : { racine: dossierProjet(dossier), cible: dossierProjet(dossier) };
    const base = relatif ? path.relative(racine, cible).split(path.sep).join("/") : "";
    const entrees = await readdir(cible, { withFileTypes: true }).catch(() => {
      throw new ErreurFichier("Ce dossier n’existe pas sur le VPS.");
    });
    return entrees
      .filter((e) => !IGNORES.has(e.name) && !e.name.startsWith("node_modules") && (e.isDirectory() || e.isFile()))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, "fr"))
      .map((e) => ({ name: e.name, path: base ? `${base}/${e.name}` : e.name, kind: e.isDirectory() ? "dossier" : "fichier" }));
  }

  async function lire(dossier, relatif) {
    const { cible } = dansProjet(dossier, relatif);
    if (cible === dossierProjet(dossier)) throw new ErreurFichier("Ce lien mène à un dossier, pas à un fichier.");
    const infos = await stat(cible).catch(() => null);
    if (!infos) throw new ErreurFichier("Ce fichier n’existe pas (ou plus) dans le projet.");
    if (!infos.isFile()) throw new ErreurFichier("Ce lien mène à un dossier, pas à un fichier.");
    const ext = path.extname(cible).slice(1).toLowerCase();
    const max = IMAGES.has(ext) ? IMAGE_MAX : ext === "pdf" ? 0 : TEXTE_MAX;
    const lu = infos.size <= max ? await readFile(cible) : null;
    return { nom: path.basename(cible), taille: infos.size, base64: lu ? lu.toString("base64") : null };
  }

  async function creerDossier(dossier) {
    const resolu = dossierProjet(dossier);
    await mkdir(resolu, { recursive: true, mode: 0o750 });
    return resolu;
  }

  /**
   * Les consignes KLYRA d'un projet du VPS (cf. electron/consignes-projet.ts, le même module) : ce qui
   * serait écrit, puis l'écriture, sans jamais écraser un fichier.
   */
  function consignes(dossier, nom) {
    return etatConsignesProjet(dossierProjet(dossier), String(nom ?? "").slice(0, 120));
  }
  function ecrireConsignes(dossier, nom) {
    try {
      return appliquerConsignesProjet(dossierProjet(dossier), String(nom ?? "").slice(0, 120));
    } catch (erreur) {
      if (erreur instanceof ErreurFichier) throw erreur;
      throw new ErreurFichier(erreur instanceof Error ? erreur.message : "Écriture impossible sur le VPS.");
    }
  }

  return { arbre, lire, creerDossier, consignes, ecrireConsignes, racine: racineKlyra };
}
