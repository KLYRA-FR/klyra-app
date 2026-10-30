import type { Role, RoleTeinte } from "@/types/domain";

/**
 * Ce que l'app sait des agents en plus des fiches `~/.claude/agents/*.md`,
 * qui restent la seule source pour tout le reste :
 * - l'assistant, qui est la session elle-même (pas de fichier). Son identifiant
 *   reste « principal » ; son nom et sa couleur sont choisis par la personne
 *   (`mes-agents.json`), sans toucher aux conversations ;
 * - le rôle court et la couleur de départ des modèles KLYRA, que l'on peut changer.
 */

export const PRINCIPAL: Role = {
  id: "principal",
  name: "Assistant",
  tag: "Assistant",
  title: "Ton assistant",
  initial: "A",
  teinte: "bleu-k1",
  description: "Ton interlocuteur par défaut : il répond, travaille dans tes projets et confie une partie du travail à tes agents quand tu en as.",
  whenToCall: "Ton interlocuteur par défaut : il répond, travaille dans tes projets et confie une partie du travail à tes agents quand tu en as.",
  skills: ["Répondre et faire", "Créer un agent", "Répartir entre tes agents"],
  heading: "Assistant — Ton assistant",
  pitch: "Je réponds à tes demandes et je travaille avec toi. Quand un besoin revient, je t’aide à créer l’agent qui s’en chargera.",
  sections: [],
  model: "",
  memory: "",
  file: null,
};

/** Rôle court et couleur de départ des agents de l'équipe KLYRA. */
export const DEFAULT_META: Record<string, { tag: string; teinte: RoleTeinte }> = {
  dev: { tag: "Dev", teinte: "bleu-k2" },
  designer: { tag: "Design", teinte: "violet" },
  motion: { tag: "Motion", teinte: "rose" },
  qa: { tag: "QA", teinte: "vert" },
  commercial: { tag: "Ventes", teinte: "orange" },
  stratege: { tag: "Stratégie", teinte: "ocre" },
  growth: { tag: "Growth", teinte: "jaune" },
  redacteur: { tag: "Plume", teinte: "rouge" },
  val: { tag: "Mails", teinte: "bleu-k3" },
  "diego-discord-ops": { tag: "Ops", teinte: "vert-k2" },
  prompty: { tag: "Prompts", teinte: "orange-k2" },
};
