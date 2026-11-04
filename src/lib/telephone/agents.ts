import { PRINCIPAL } from "@/data/agents";
import { texteErreurPoste } from "@/lib/poste-texte";
import { ROLE_TEINTES, type RoleTeinte } from "@/types/domain";

/**
 * Les agents sur le téléphone (spec mobile T-08, M-4) : leurs cartes d'identité, copiées dans le
 * compte par l'ordinateur. La fiche, elle, reste sur l'ordinateur et se demande au poste.
 */

/** Une carte d'agent, telle que le compte la rend (`conversationsCompte:agents`). */
export interface CarteAgent {
  origine: string;
  nom: string;
  teinte: string;
  roleCourt: string;
  actif: boolean;
}

export interface LigneAgent {
  id: string;
  nom: string;
  teinte: RoleTeinte;
  roleCourt: string;
  actif: boolean;
  conversations: number;
}

/** Ce que l'ordinateur dit de chaque fiche (`agents.etats`) : de quoi nommer le bon geste. */
export interface EtatAgentPoste {
  id: string;
  statut: "actif" | "desactive" | "disponible";
  desactiveLe: number | null;
  /** La définition de la bibliothèque d'où il vient (reçu, copie ou publié). */
  definitionId: string | null;
  /** Le modèle KLYRA d'où il vient. */
  modele: string | null;
}

export interface EtatsAgentsPoste {
  assistant: { nom: string; teinte: string };
  agents: EtatAgentPoste[];
}

export const ID_ASSISTANT = PRINCIPAL.id;

/** Les modèles qu'une fiche peut demander (champ `model`), comme l'éditeur du bureau. */
export const MODELES_FICHE = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
  { value: "inherit", label: "Celui de la session" },
];

/** La mémoire d'un agent (champ `memory`), comme l'éditeur du bureau. */
export const MEMOIRES_FICHE = [
  { value: "project", label: "Par projet" },
  { value: "user", label: "Partagée entre projets" },
  { value: "local", label: "Locale, non versionnée" },
  { value: "", label: "Aucune" },
];

/** Une teinte venue du compte : connue, sinon celle de repli (le visuel ne casse jamais). */
export function teinteSure(teinte: string | null | undefined, repli: RoleTeinte = "bleu-k2"): RoleTeinte {
  return (ROLE_TEINTES as string[]).includes(teinte ?? "") ? (teinte as RoleTeinte) : repli;
}

/**
 * Le rôle court affichable (socle § 8, C-2a) : jamais l'id de l'agent, que l'ordinateur prenait en
 * repli (« redaction », « dev »). Vide plutôt qu'un identifiant.
 */
export function roleLisible(roleCourt: string | null | undefined, id: string): string {
  const role = roleCourt?.trim() ?? "";
  return role && role !== id ? role : "";
}

/** « 1 conversation », « 4 conversations », « Aucune conversation ». */
export function texteConversations(n: number): string {
  if (n <= 0) return "Aucune conversation";
  return n === 1 ? "1 conversation" : `${n} conversations`;
}

/**
 * Mes agents sur le téléphone : l'assistant en premier, puis les agents actifs, puis « Hors de Mes
 * agents ». Chaque ligne compte les conversations du compte où l'agent parle.
 */
export function listeMesAgents(
  cartes: CarteAgent[],
  conversations: { roleIds: string[] }[],
): { assistant: LigneAgent; actifs: LigneAgent[]; hors: LigneAgent[] } {
  const compter = (id: string) => conversations.filter((c) => c.roleIds.includes(id)).length;
  const ligne = (c: CarteAgent): LigneAgent => ({
    id: c.origine,
    nom: c.nom,
    teinte: teinteSure(c.teinte),
    roleCourt: roleLisible(c.roleCourt, c.origine),
    actif: c.actif,
    conversations: compter(c.origine),
  });
  const carteAssistant = cartes.find((c) => c.origine === ID_ASSISTANT);
  /* Sans sa carte (ordinateur pas encore passé par cette version) : le nom par défaut. */
  const assistant = carteAssistant
    ? { ...ligne(carteAssistant), actif: true, teinte: teinteSure(carteAssistant.teinte, PRINCIPAL.teinte) }
    : { id: ID_ASSISTANT, nom: PRINCIPAL.name, teinte: PRINCIPAL.teinte, roleCourt: PRINCIPAL.tag, actif: true, conversations: compter(ID_ASSISTANT) };
  const autres = cartes.filter((c) => c.origine !== ID_ASSISTANT).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  return {
    assistant,
    actifs: autres.filter((c) => c.actif).map(ligne),
    hors: autres.filter((c) => !c.actif).map(ligne),
  };
}

/** Le geste qui remet un agent dans Mes agents : « Réactiver » s'il a été désactivé, sinon « Ajouter à mes agents ». */
export function libelleRetour(etat: EtatAgentPoste | undefined): string {
  return etat?.statut === "desactive" ? "Réactiver" : "Ajouter à mes agents";
}

/** L'agent de l'ordinateur qui vient de cette définition (reçu ou copie), ou de ce modèle KLYRA. */
export function agentDeLaBibliotheque(etats: EtatAgentPoste[] | undefined, source: { definitionId: string } | { modele: string }): EtatAgentPoste | null {
  if (!etats) return null;
  if ("definitionId" in source) return etats.find((e) => e.definitionId === source.definitionId) ?? null;
  return etats.find((e) => e.modele === source.modele || e.id === source.modele) ?? null;
}

/** Les erreurs des gestes sur la fiche, dites au téléphone avec le nom du poste (spec § 5, T-09). */
export function texteErreurFiche(code: string, message: string, sur: string): string {
  if (code === "conflit") return `La fiche a changé sur ${sur} depuis son ouverture`;
  if (code === "introuvable") return `Cette fiche n’existe plus sur ${sur}.`;
  return texteErreurPoste({ code, message }, sur);
}
