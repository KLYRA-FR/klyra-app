// Prépare cua-driver, le pilote de Computer Use (trycua, MIT), rangé dans
// vendor/cua-driver/<système>/ (hors git), que electron-builder copie dans
// l'app (extraResources). Version et empreintes : cua-driver.lock.json.
// On ne garde que les fichiers listés, chacun vérifié : une archive qui change
// fait échouer le build au lieu de livrer un fichier inattendu.
// Linux n'est pas une cible de l'app : le pilote y sert aux tests (xvfb).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { telecharger as telechargerAvecTentatives } from "./telecharger.mjs";

const racine = path.resolve(import.meta.dirname, "..");
const verrou = JSON.parse(readFileSync(path.join(racine, "cua-driver.lock.json"), "utf8"));
const cible = `${process.platform}-${process.arch}`;
const artefact = verrou.cibles[cible];
const sortie = path.join(racine, "vendor", "cua-driver", process.platform);
const empreinte = (octets) => createHash("sha256").update(octets).digest("hex");

if (!artefact) {
  console.log(`cua-driver : rien à préparer pour ${cible}.`);
  process.exit(0);
}

/** Déjà là et conforme : rien à télécharger. */
const conforme = () =>
  Object.entries(artefact.fichiers).every(([nom, sha]) => existsSync(path.join(sortie, nom)) && empreinte(readFileSync(path.join(sortie, nom))) === sha) &&
  existsSync(path.join(sortie, verrou.licence.fichier)) &&
  empreinte(readFileSync(path.join(sortie, verrou.licence.fichier))) === verrou.licence.sha256;

const telecharger = (url) => telechargerAvecTentatives(url, "cua-driver");

if (conforme()) {
  console.log(`cua-driver ${verrou.version} (${cible}) : déjà prêt.`);
} else {
  const base = `${verrou.repository}/releases/download/${encodeURIComponent(verrou.tag)}`;
  const archive = await telecharger(`${base}/${encodeURIComponent(artefact.archive)}`);
  if (empreinte(archive) !== artefact.sha256) throw new Error(`cua-driver : l'empreinte de ${artefact.archive} ne correspond pas au verrou.`);
  const licence = await telecharger(`${verrou.repository}/raw/${encodeURIComponent(verrou.tag)}/${verrou.licence.fichier}`);
  if (empreinte(licence) !== verrou.licence.sha256) throw new Error("cua-driver : l'empreinte de la licence ne correspond pas au verrou.");

  const tmp = mkdtempSync(path.join(os.tmpdir(), "klyra-cua-driver-"));
  try {
    const fichierArchive = path.join(tmp, artefact.archive);
    writeFileSync(fichierArchive, archive);
    const extrait = path.join(tmp, "extrait");
    mkdirSync(extrait);
    // tar lit aussi les .zip sous Windows 10 et 11 (bsdtar).
    execFileSync("tar", ["-xf", fichierArchive, "-C", extrait, ...Object.keys(artefact.fichiers)], { stdio: "inherit" });
    rmSync(sortie, { recursive: true, force: true });
    mkdirSync(sortie, { recursive: true });
    for (const [nom, sha] of Object.entries(artefact.fichiers)) {
      const source = path.join(extrait, nom);
      if (empreinte(readFileSync(source)) !== sha) throw new Error(`cua-driver : ${nom} ne correspond pas au verrou.`);
      copyFileSync(source, path.join(sortie, nom));
      chmodSync(path.join(sortie, nom), 0o755);
    }
    writeFileSync(path.join(sortie, verrou.licence.fichier), licence);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (!conforme()) throw new Error("cua-driver : les fichiers installés ne correspondent pas au verrou.");
  console.log(`cua-driver ${verrou.version} (${cible}) : prêt dans ${path.relative(racine, sortie)}.`);
}
