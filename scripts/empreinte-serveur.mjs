/**
 * L'empreinte du code qu'un VPS reçoit par `serveur/lancer.sh` : ce qui, en changeant, le met en retard.
 * Sans les tests, et sans `version-code.mjs`, qui en dépend. Fins de ligne ramenées à LF : même empreinte sous Windows.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const estCodeServeur = (nom) => nom === "lancer.sh" || (nom.endsWith(".mjs") && !nom.endsWith(".test.mjs") && nom !== "version-code.mjs");

export function empreinteCodeServeur(dossier) {
  const somme = createHash("sha256");
  for (const nom of readdirSync(dossier).filter(estCodeServeur).sort()) {
    somme.update(`${nom}\0${readFileSync(path.join(dossier, nom), "utf8").replace(/\r\n/g, "\n")}\0`);
  }
  return somme.digest("hex");
}
