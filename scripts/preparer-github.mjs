// GitHub CLI officiel, embarqué pour la connexion aux dépôts. Aucun compte n'est lu au build.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { telecharger } from "./telecharger.mjs";

const racine = path.resolve(import.meta.dirname, "..");
const verrou = JSON.parse(readFileSync(path.join(racine, "github-cli.lock.json"), "utf8"));
const cible = `${process.platform}-${process.arch}`;
const artefact = verrou.cibles[cible];
if (!artefact) throw new Error(`GitHub CLI : plateforme non prise en charge (${cible}).`);
const sortie = path.join(racine, "vendor", "github", process.platform);
const binaire = process.platform === "win32" ? "gh.exe" : "gh";
const marque = path.join(sortie, "archive.sha256");
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
let conforme = false;
try {
  const m = JSON.parse(readFileSync(marque, "utf8"));
  conforme = m.archive === artefact.sha256 && m.binaire === sha(path.join(sortie, binaire)) && m.licence === sha(path.join(sortie, "LICENSE"));
} catch { /* Cache absent ou incomplet : le reconstruire depuis l'archive vérifiée. */ }
if (conforme) {
  console.log(`GitHub CLI ${verrou.version} : déjà prêt.`);
} else {
  const archive = await telecharger(`https://github.com/cli/cli/releases/download/v${verrou.version}/${artefact.archive}`, "GitHub CLI");
  if (createHash("sha256").update(archive).digest("hex") !== artefact.sha256) throw new Error("GitHub CLI : l’archive ne correspond pas au verrou.");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "klyra-gh-build-"));
  try {
    const fichier = path.join(tmp, artefact.archive);
    writeFileSync(fichier, archive);
    const entrees = execFileSync("tar", ["-tf", fichier], { encoding: "utf8" }).split(/\r?\n/);
    const exe = entrees.find((n) => n === `bin/${binaire}` || n.endsWith(`/bin/${binaire}`));
    const licence = entrees.find((n) => n === "LICENSE" || n.endsWith("/LICENSE"));
    if (!exe || !licence) throw new Error("GitHub CLI : fichiers absents de l’archive.");
    execFileSync("tar", ["-xf", fichier, "-C", tmp, exe, licence]);
    mkdirSync(sortie, { recursive: true });
    copyFileSync(path.join(tmp, exe), path.join(sortie, binaire));
    copyFileSync(path.join(tmp, licence), path.join(sortie, "LICENSE"));
    chmodSync(path.join(sortie, binaire), 0o755);
    writeFileSync(marque, JSON.stringify({ archive: artefact.sha256, binaire: sha(path.join(sortie, binaire)), licence: sha(path.join(sortie, "LICENSE")) }));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  console.log(`GitHub CLI ${verrou.version} : prêt.`);
}
