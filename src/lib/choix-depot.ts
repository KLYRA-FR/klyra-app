import type { DepotGithubProjet } from "../../electron/github-types";
import { depotsTrouves, projetDuDepot } from "@/lib/projet-depuis-depot";
import type { Project } from "@/types/domain";

/**
 * La puce « Dépôt » d'un composeur (`PuceDepot`) : choisir un projet déjà ouvert sur la machine de la
 * conversation, ou un dépôt GitHub pas encore ouvert. Une valeur par choix, lisible par la liste :
 * `""` (sans dépôt), `projet:<id>`, `depot:<propriétaire/dépôt>`. `CONNECTER_GITHUB` n'est pas un choix :
 * la puce ouvre la connexion GitHub de la machine à sa place.
 */
export const CONNECTER_GITHUB = "github:connecter";
export type ValeurDepot = "" | `projet:${string}` | `depot:${string}` | typeof CONNECTER_GITHUB;

export interface OptionDepot {
  value: ValeurDepot;
  label: string;
  type: "aucun" | "projet" | "depot" | "info" | "connecter";
  disabled?: boolean;
}

/**
 * Les choix de la puce : sans dépôt, les projets de cette machine (les plus récents d'abord), puis ses dépôts
 * GitHub qui ne sont pas encore un projet ici. `etatGithub` dit pourquoi la liste GitHub manque.
 */
export function optionsDepot(
  projets: Project[],
  depots: DepotGithubProjet[] | null,
  lieu: string | null,
  etatGithub: "charge" | "pret" | "deconnecte" | "erreur" | "absent",
): OptionDepot[] {
  const ici = projets.filter((p) => (p.lieu ?? null) === lieu).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const options: OptionDepot[] = [{ value: "", label: "Sans dépôt", type: "aucun" }];
  for (const p of ici) options.push({ value: `projet:${p.id}`, label: p.depot && p.depot.split("/").pop() !== p.name ? `${p.name} · ${p.depot}` : p.name, type: "projet" });
  if (etatGithub === "charge") options.push({ value: "depot:…", label: "Chargement de tes dépôts GitHub…", type: "info", disabled: true });
  // La connexion de KLYRA à GitHub, pas celle de Composio ni du terminal : elle se fait d'ici.
  if (etatGithub === "deconnecte") options.push({ value: CONNECTER_GITHUB, label: "Connecter GitHub pour voir tes dépôts…", type: "connecter" });
  if (etatGithub === "erreur") options.push({ value: "depot:…", label: "GitHub ne répond pas : rouvre la liste pour réessayer", type: "info", disabled: true });
  if (etatGithub === "pret" && depots) {
    for (const d of depotsTrouves(depots, "")) {
      if (d.archive || !d.branche || projetDuDepot(d.nom, lieu, ici)) continue;
      options.push({ value: `depot:${d.nom}`, label: `${d.nom} · GitHub`, type: "depot" });
    }
  }
  return options;
}

/** Ce que désigne une valeur de la puce. */
export function lireValeurDepot(valeur: string): { projet: string } | { depot: string } | null {
  if (valeur.startsWith("projet:")) return { projet: valeur.slice("projet:".length) };
  if (valeur.startsWith("depot:") && valeur !== "depot:…") return { depot: valeur.slice("depot:".length) };
  return null;
}
