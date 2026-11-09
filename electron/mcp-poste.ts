import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Ce qui est branché sur ce poste hors de la Marketplace : les serveurs MCP de
 * Claude Code (portée utilisateur, `claude mcp add`) et les outils en ligne de
 * commande connus, repérés par la skill qu'ils installent.
 *
 * En lecture seule : ces entrées se gèrent là où elles ont été ajoutées. Ni
 * arguments, ni en-têtes, ni variables d'environnement ne sont lus : ils
 * portent souvent des jetons.
 */
export interface ServeurPoste {
  id: string;
  nom: string;
  detail: string;
}

/** Les outils en ligne de commande connus : la skill que leur connexion dépose dans la configuration de Claude Code. */
const OUTILS_POSTE = [{ skill: "sunra", nom: "Sunra" }] as const;

function lireServeurs(fichier: string): Record<string, unknown> {
  try {
    const v = (JSON.parse(readFileSync(fichier, "utf8")) as { mcpServers?: unknown }).mcpServers;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Le serveur distant par son seul hôte (sans identifiants ni chemin), sinon une commande locale. */
function detailDe(serveur: object): string {
  const url = (serveur as { url?: unknown }).url;
  if (typeof url !== "string") return "Commande locale";
  try { return new URL(url).host; }
  catch { return "Serveur distant"; }
}

export function serveursDuPoste(home: string, dossierClaude = path.join(home, ".claude")): ServeurPoste[] {
  const mcp = Object.entries(lireServeurs(path.join(home, ".claude.json")))
    .filter(([nom, s]) => nom.trim() && s && typeof s === "object")
    .map(([nom, s]) => ({ id: `mcp:${nom}`, nom: nom.slice(0, 40), detail: detailDe(s as object) }));
  const outils = OUTILS_POSTE
    .filter((o) => existsSync(path.join(dossierClaude, "skills", o.skill, "SKILL.md")))
    .filter((o) => !mcp.some((m) => m.nom.toLowerCase() === o.nom.toLowerCase()))
    .map((o) => ({ id: `outil:${o.skill}`, nom: o.nom, detail: "Outil en ligne de commande" }));
  return [...mcp, ...outils];
}
