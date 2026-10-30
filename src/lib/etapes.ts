import type { IconName } from "@/components/icons/Icon";
import type { Role } from "@/types/domain";
import { nomFichier } from "@/lib/fichiers";

/**
 * Les étapes du travail d'un agent, en mots simples : ce qu'il fait avec
 * chaque outil de Claude Code (« Lit page.tsx », « Lance pnpm build »).
 */

/** Le nom du fichier, sans tout le chemin. */
function fichier(chemin: unknown): string {
  if (typeof chemin !== "string" || !chemin) return "un fichier";
  return nomFichier(chemin);
}

function court(texte: unknown, max = 60): string {
  if (typeof texte !== "string") return "";
  const propre = texte.replace(/\s+/g, " ").trim();
  return propre.length > max ? `${propre.slice(0, max - 1).trimEnd()}…` : propre;
}

export function libelleEtape(outil: string, entree: Record<string, unknown>, roles: Role[]): string {
  switch (outil) {
    case "Read":
      return `Lit ${fichier(entree.file_path)}`;
    case "Write":
      return `Crée ${fichier(entree.file_path)}`;
    case "Edit":
    case "MultiEdit":
      return `Modifie ${fichier(entree.file_path)}`;
    case "NotebookEdit":
      return `Modifie ${fichier(entree.notebook_path)}`;
    case "Glob":
      return `Cherche les fichiers ${court(entree.pattern, 40)}`;
    case "Grep":
      return `Cherche « ${court(entree.pattern, 40)} »`;
    case "Bash":
      return court(entree.description) || `Lance ${court(entree.command, 50)}`;
    case "WebFetch":
      return `Lit une page web${typeof entree.url === "string" ? ` (${court(new URL(entree.url, "https://x").hostname, 40)})` : ""}`;
    case "WebSearch":
      return `Cherche sur le web « ${court(entree.query, 40)} »`;
    case "TodoWrite":
      return "Met à jour sa liste de tâches";
    case "Agent":
    case "Task": {
      const role = roles.find((r) => r.id === entree.subagent_type);
      return role ? `Confie à ${role.name} : ${court(entree.description, 50)}` : `Lance un assistant : ${court(entree.description, 50)}`;
    }
    case "mcp__klyra__demander_ia":
      return `Demande à ${court(entree.ia, 20) || "une autre IA"} : ${court(entree.consigne, 50)}`;
    default:
      return outil.startsWith("mcp__") ? `Utilise ${outil.split("__").slice(1).join(" · ")}` : `Utilise ${outil}`;
  }
}

/** L'icône de chaque étape, dans le set officiel. */
export function iconeEtape(outil: string): IconName {
  switch (outil) {
    case "Read":
      return "file-01";
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "file-code";
    case "Glob":
    case "Grep":
    case "WebSearch":
      return "search-01";
    case "Bash":
      return "code-01";
    case "WebFetch":
      return "globe-01";
    case "Agent":
    case "Task":
      return "users-profiles-01";
    default:
      return "settings";
  }
}
