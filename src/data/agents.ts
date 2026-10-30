import type { Role, RoleTeinte, TeamCircuit } from "@/types/domain";

/**
 * Ce que l'app sait des agents en plus des fiches `~/.claude/agents/*.md`,
 * qui restent la seule source pour tout le reste :
 * - l'assistant, qui est la session elle-même (pas de fichier). Son identifiant
 *   reste « principal » ; son nom et sa couleur sont choisis par la personne
 *   (`mes-agents.json`), sans toucher aux conversations ;
 * - le rôle court et la couleur de départ des modèles KLYRA, que l'on peut changer ;
 * - les circuits de passation entre les modèles KLYRA.
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

/** Circuits de passation : qui passe la main à qui. `roleId: null` = un humain. */
export const CIRCUITS: TeamCircuit[] = [
  {
    id: "ecran",
    title: "Construire un écran",
    steps: [
      { roleId: "stratege", label: "Brief" },
      { roleId: "designer", label: "Spec" },
      { roleId: "dev", label: "Code" },
      { roleId: "qa", label: "Contrôle" },
      { roleId: "diego-discord-ops", label: "Déploiement" },
    ],
  },
  {
    id: "contenu",
    title: "Contenu",
    steps: [
      { roleId: "stratege", label: "Cible et angle" },
      { roleId: "redacteur", label: "Texte" },
      { roleId: "qa", label: "Note sur 100" },
      { roleId: null, label: "Publication" },
    ],
  },
  {
    id: "acquisition",
    title: "Acquisition",
    steps: [
      { roleId: "stratege", label: "Cible et message" },
      { roleId: "growth", label: "Leads qualifiés" },
      { roleId: "commercial", label: "Messages" },
      { roleId: "val", label: "Brouillon" },
      { roleId: null, label: "Corentin valide" },
    ],
  },
  {
    id: "video",
    title: "Vidéo",
    steps: [
      { roleId: "motion", label: "Storyboard et planche" },
      { roleId: null, label: "Corentin valide" },
      { roleId: "motion", label: "Animation" },
      { roleId: "qa", label: "Contrôle" },
      { roleId: "dev", label: "Intégration" },
    ],
  },
  {
    id: "mail",
    title: "Mail client",
    steps: [
      { roleId: "val", label: "Tri" },
      { roleId: null, label: "Agent concerné" },
      { roleId: "val", label: "Brouillon" },
      { roleId: null, label: "Validation" },
    ],
  },
  {
    id: "prompt",
    title: "Prompt ou fiche d’agent",
    steps: [
      { roleId: "prompty", label: "Prompt et critère" },
      { roleId: "redacteur", label: "Contenu" },
      { roleId: "dev", label: "Code" },
      { roleId: "qa", label: "Audit" },
    ],
  },
];
