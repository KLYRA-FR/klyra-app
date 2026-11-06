import { app } from "electron";
import { cpSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dansLesRendus } from "./rendus";
import { nomTelechargeable, nomUnique, suiviProgression } from "./telechargement-regles";

/**
 * « Télécharger » un livrable (clic droit dans l'onglet Fichiers du panneau) : une copie dans le dossier
 * Téléchargements de ce PC. Le fichier passe en flux (jamais entier en mémoire), sous un nom temporaire caché,
 * puis prend son nom : « film.mov », ou « film (1).mov » si le nom est pris. Jamais d'écrasement.
 * Livrable de ce PC : seulement une copie de `~/.klyra/rendus`. Livrable d'un VPS : `telechargerRenduVps`.
 */

/** Octets reçus et taille annoncée, pour la progression à l'écran. */
export type ProgressionTelechargement = (recu: number, total: number) => void;

/** Rien reçu pendant ce temps : le transfert s'arrête avec une erreur, plutôt que de rester pendu. */
const SILENCE_MS = 60_000;

/** Écrit un flux dans `vers` (nouveau fichier) en comptant les octets. */
export async function ecrireFlux(source: Readable, vers: string, compter: (octets: number) => void): Promise<void> {
  let minuteur: NodeJS.Timeout | undefined;
  const compteur = new Transform({
    transform(morceau: Buffer, _encodage, suite) {
      compter(morceau.length);
      reveiller();
      suite(null, morceau);
    },
  });
  const reveiller = () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => compteur.destroy(new Error("Le transfert s’est arrêté : plus rien n’arrive depuis une minute.")), SILENCE_MS);
  };
  reveiller();
  try {
    await pipeline(source, compteur, createWriteStream(vers, { flags: "wx" }));
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Pose le résultat de `ecrire` dans Téléchargements sous un nom libre. `ecrire` reçoit un chemin temporaire
 * (fichier ou dossier à créer) ; en cas d'échec, il est retiré et rien ne reste.
 */
export async function deposerDansTelechargements(nom: unknown, ecrire: (temporaire: string) => Promise<void>): Promise<string> {
  const propre = nomTelechargeable(nom);
  const dossier = app.getPath("downloads");
  mkdirSync(dossier, { recursive: true });
  const temporaire = path.join(dossier, `.${propre.slice(0, 120)}.${process.pid}-${Date.now()}.klyra-partiel`);
  try {
    await ecrire(temporaire);
    const final = path.join(dossier, nomUnique(propre, (n) => existsSync(path.join(dossier, n))));
    renameSync(temporaire, final);
    return final;
  } catch (e) {
    rmSync(temporaire, { recursive: true, force: true });
    throw e;
  }
}

/** Un livrable de ce PC : seulement une copie gardée par l'app dans `~/.klyra/rendus`, jamais un autre chemin. */
export async function telechargerRendu(chemin: unknown, progression: ProgressionTelechargement): Promise<string> {
  if (typeof chemin !== "string" || !path.isAbsolute(chemin)) throw new Error("Chemin invalide.");
  const source = path.resolve(chemin);
  if (!dansLesRendus(source)) throw new Error("Seul un livrable publié se télécharge.");
  if (!existsSync(source)) throw new Error("Ce livrable n’est plus sur ce PC.");
  if (!dansLesRendus(realpathSync(source)) || lstatSync(source).isSymbolicLink()) throw new Error("Seul un livrable publié se télécharge.");
  const infos = lstatSync(source);
  /* La copie porte la date de publication devant son nom : le fichier téléchargé reprend le nom d'origine. */
  const nom = path.basename(source).replace(/^\d{4}-\d{2}-\d{2} /, "");
  if (infos.isDirectory()) {
    const final = await deposerDansTelechargements(nom, async (t) => cpSync(source, t, { recursive: true, dereference: false, errorOnExist: true }));
    progression(1, 1);
    return final;
  }
  const suivi = suiviProgression((recu) => progression(recu, infos.size));
  const final = await deposerDansTelechargements(nom, (t) => ecrireFlux(createReadStream(source), t, (n) => suivi.ajouter(n)));
  suivi.finir();
  return final;
}
