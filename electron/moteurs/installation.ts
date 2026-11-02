import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Les moteurs que l'app installe elle-même, rangés par version : `~/.klyra/moteurs/<moteur>/<version>/`. */
export const dossierMoteurs = () => path.join(os.homedir(), ".klyra", "moteurs");

/** Compare deux versions « 0.164.0 » ; négatif si a est plus ancienne. */
export function comparerVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Les versions installées par l'app, la plus récente d'abord. */
export function versionsGerees(moteur: string): string[] {
  const dossier = path.join(dossierMoteurs(), moteur);
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((v) => /^\d+\.\d+\.\d+/.test(v))
    .sort((a, b) => comparerVersions(b, a));
}

/** Le programme installé par l'app pour ce moteur (sa version la plus récente), ou null. */
export function binaireGere(moteur: string, executable: string): string | null {
  for (const version of versionsGerees(moteur)) {
    const chemin = path.join(dossierMoteurs(), moteur, version, "bin", executable);
    if (existsSync(chemin)) return chemin;
  }
  return null;
}
