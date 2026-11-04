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

/** Ce que fait un agent dans une page du navigateur de KLYRA. */
const ACTIONS_NAVIGATEUR: Record<string, string> = {
  cliquer: "clique dans la page",
  double_clic: "double-clique dans la page",
  clic_droit: "clic droit dans la page",
  survoler: "survole un élément",
  taper: "écrit dans la page",
  touche: "appuie sur",
  defiler: "fait défiler la page",
  choisir: "choisit",
  passer_la_main: "te passe la main",
};

/** Le site d'une adresse, ou les mots cherchés. */
function siteOuMots(saisie: string): string {
  try {
    return new URL(/^[a-z]+:\/\//i.test(saisie) ? saisie : `https://${saisie}`).host.replace(/^www\./, "") || saisie;
  } catch {
    return saisie;
  }
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
    case "Skill":
      return `Suit la compétence « ${court(entree.skill, 40) || "sans nom"} »`;
    case "Agent":
    case "Task": {
      const role = roles.find((r) => r.id === entree.subagent_type);
      return role ? `Confie à ${role.name} : ${court(entree.description, 50)}` : `Lance un assistant : ${court(entree.description, 50)}`;
    }
    case "mcp__klyra__demander_ia":
      return `Demande à ${court(entree.ia, 20) || "une autre IA"} : ${court(entree.consigne, 50)}`;
    case "mcp__klyra__proposer_agent":
      return entree.nom ? `Complète la carte de ${court(entree.nom, 40)}` : "Complète la carte d’un agent";
    case "mcp__klyra__proposer_choix":
      return "Propose des réponses";
    case "mcp__klyra__publier_artefact":
      return `Publie dans Artefacts : ${court(entree.titre, 50) || "un rendu"}`;
    case "mcp__klyra__navigateur_aller":
      if (typeof entree.url === "string" && entree.url.trim()) return `Navigateur : ouvre ${court(siteOuMots(entree.url), 50)}`;
      return entree.historique === "retour" ? "Navigateur : page précédente" : entree.historique === "suivant" ? "Navigateur : page suivante" : "Navigateur : recharge la page";
    case "mcp__klyra__navigateur_lire":
      return entree.attendre_texte ? `Navigateur : attend « ${court(entree.attendre_texte, 40)} »` : entree.requete ? `Navigateur : cherche « ${court(entree.requete, 40)} »` : "Navigateur : lit la page";
    case "mcp__klyra__navigateur_capture":
      return "Navigateur : regarde la page";
    case "mcp__klyra__navigateur_onglets":
      return entree.fermer ? "Navigateur : ferme un onglet" : "Navigateur : regarde ses onglets";
    case "mcp__klyra__navigateur_agir":
      return `Navigateur : ${ACTIONS_NAVIGATEUR[String(entree.action)] ?? "agit dans la page"}${entree.action === "choisir" && entree.valeur ? ` « ${court(entree.valeur, 30)} »` : ""}${entree.action === "touche" && entree.touche ? ` ${court(entree.touche, 20)}` : ""}`;
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
    case "mcp__klyra__proposer_agent":
      return "users-profiles-plus";
    case "mcp__klyra__proposer_choix":
      return "list";
    case "mcp__klyra__publier_artefact":
    case "Skill":
      return "layers-01";
    case "mcp__klyra__navigateur_agir":
      return "cursor-01";
    case "mcp__klyra__navigateur_aller":
    case "mcp__klyra__navigateur_lire":
    case "mcp__klyra__navigateur_capture":
    case "mcp__klyra__navigateur_onglets":
      return "computer";
    default:
      return "settings";
  }
}
