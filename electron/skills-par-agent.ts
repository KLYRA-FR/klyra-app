/**
 * Quelles skills un agent lancé par KLYRA reçoit.
 *
 * Liste d'exclusion figée, pas un déplacement de fichiers : rien n'est retiré du poste.
 * Tant que `fige` est faux (réglage absent, ancienne installation) chaque agent reçoit tout,
 * comme avant. Le premier lancement fige le choix : les skills personnelles alors présentes
 * restent reçues par les agents alors présents. Ensuite, une skill personnelle nouvelle,
 * ou un agent nouveau, ne la reçoit pas tant qu'on ne l'allume pas. Une skill de projet
 * reste reçue tant qu'on ne la coupe pas.
 *
 * Claude Code lit, au lancement, un dossier préparé par l'app (`CLAUDE_CONFIG_DIR`,
 * electron/preparation-fournisseur.ts) : les fiches actives du dossier de l'app
 * (`userData/equipe`, copiées une fois depuis le poste) et seulement les skills
 * personnelles allumées, lues dans `userData/bibliotheque-skills` (la même copie).
 * Le poste n'est pas modifié. `skillOverrides` retire encore
 * ce qui resterait listé (skills de projet, skills livrées avec l'outil). Cette valeur
 * reste celle de l'agent de la session. La fiche copiée d'un agent appelé retire l'outil
 * Skill (le catalogue du lanceur) et reçoit les skills allumées pour lui.
 * Codex a un processus par agent : son dossier préparé ne reçoit
 * que les skills que ce filtre laisse allumées.
 */

export interface SkillsParAgent {
  /** Vrai une fois le choix figé. Faux : tout est reçu. */
  fige: boolean;
  /** Noms des skills personnelles au moment du gel. */
  personnellesConnues: string[];
  /** Identifiants d'agents au moment du gel, y compris `principal`. */
  agentsConnus: string[];
  /** Agent → skills coupées (personnelles connues, ou de projet). */
  coupees: Record<string, string[]>;
  /** Agent → skills allumées en plus (skill nouvelle, ou agent nouveau). */
  activees: Record<string, string[]>;
}

export const SKILLS_PAR_DEFAUT: SkillsParAgent = {
  fige: false,
  personnellesConnues: [],
  agentsConnus: [],
  coupees: {},
  activees: {},
};

const ID_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NOM_SKILL = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,80}$/;

const tri = (noms: readonly string[], motif: RegExp) =>
  [...new Set(noms.filter((n) => motif.test(n)))].sort((a, b) => a.localeCompare(b, "fr"));

function carte(brut: unknown): Record<string, string[]> {
  if (!brut || typeof brut !== "object") return {};
  const sortie: Record<string, string[]> = {};
  for (const [id, noms] of Object.entries(brut as Record<string, unknown>)) {
    if (!ID_AGENT.test(id) || !Array.isArray(noms)) continue;
    const liste = tri(noms.filter((n): n is string => typeof n === "string"), NOM_SKILL);
    if (liste.length) sortie[id] = liste;
  }
  return sortie;
}

/** Garde seulement les clés connues. Un réglage absent ou pas encore figé reçoit tout. */
export function validerSkillsParAgent(brut: unknown): SkillsParAgent {
  const b = (brut ?? {}) as Partial<SkillsParAgent>;
  const fige = b.fige === true;
  return {
    fige,
    personnellesConnues: tri(Array.isArray(b.personnellesConnues) ? b.personnellesConnues.filter((n): n is string => typeof n === "string") : [], NOM_SKILL),
    agentsConnus: tri(Array.isArray(b.agentsConnus) ? b.agentsConnus.filter((n): n is string => typeof n === "string") : [], ID_AGENT),
    coupees: fige ? carte(b.coupees) : {},
    activees: fige ? carte(b.activees) : {},
  };
}

export type OrigineSkill = "poste" | "projet";

/** Cet agent reçoit-il cette skill ? `agent` null : l'assistant (`principal`). */
export function skillRecue(choix: SkillsParAgent, agent: string | null, nom: string, origine: OrigineSkill): boolean {
  if (!choix.fige) return true;
  const id = agent && ID_AGENT.test(agent) ? agent : "principal";
  if (choix.activees[id]?.includes(nom)) return true;
  if (choix.coupees[id]?.includes(nom)) return false;
  if (origine === "projet") return true;
  return choix.agentsConnus.includes(id) && choix.personnellesConnues.includes(nom);
}

/**
 * Fige le choix actuel : les skills personnelles données sont reçues par les agents donnés.
 * Un choix déjà figé n'est pas recalculé (les coupures et les allumages restent).
 */
export function figerChoix(choix: SkillsParAgent, agents: readonly string[], personnelles: readonly string[]): SkillsParAgent {
  if (choix.fige) return choix;
  return validerSkillsParAgent({
    fige: true,
    personnellesConnues: [...personnelles],
    agentsConnus: [...agents],
    coupees: {},
    activees: {},
  });
}

const sansNom = (carte: Record<string, string[]>, agent: string, nom: string): Record<string, string[]> => {
  const suivant = { ...carte };
  const liste = (suivant[agent] ?? []).filter((n) => n !== nom);
  if (liste.length) suivant[agent] = liste;
  else delete suivant[agent];
  return suivant;
};

/**
 * Allume ou coupe une skill pour un agent. Le choix doit déjà être figé
 * (`figerChoix`, avec la liste complète des agents et des skills personnelles).
 */
export function definirSkill(choix: SkillsParAgent, agent: string, nom: string, origine: OrigineSkill, recue: boolean): SkillsParAgent {
  if (!choix.fige) throw new Error("Le choix des skills n’est pas encore figé.");
  if (!ID_AGENT.test(agent) || !NOM_SKILL.test(nom)) throw new Error("Agent ou skill invalide.");
  const nu: SkillsParAgent = { ...choix, coupees: sansNom(choix.coupees, agent, nom), activees: sansNom(choix.activees, agent, nom) };
  if (recue === skillRecue(nu, agent, nom, origine)) return validerSkillsParAgent(nu);
  const cible = recue ? "activees" : "coupees";
  return validerSkillsParAgent({ ...nu, [cible]: { ...nu[cible], [agent]: [...(nu[cible][agent] ?? []), nom] } });
}

/** Les noms à retirer de la session de cet agent, parmi les skills du poste et du projet. */
export function nomsCoupes(choix: SkillsParAgent, agent: string | null, poste: readonly string[], projet: readonly string[]): string[] {
  const vus = new Set<string>();
  const coupes: string[] = [];
  for (const nom of poste) {
    if (vus.has(nom)) continue;
    vus.add(nom);
    if (!skillRecue(choix, agent, nom, "poste")) coupes.push(nom);
  }
  for (const nom of projet) {
    if (vus.has(nom)) continue;
    vus.add(nom);
    if (!skillRecue(choix, agent, nom, "projet")) coupes.push(nom);
  }
  return coupes.sort((a, b) => a.localeCompare(b, "fr"));
}

/**
 * Le JSON de `--settings`. Sans skill coupée, la clé `skillOverrides` est absente :
 * la requête reste celle d'avant. `base` est l'objet déjà passé (permissions).
 */
export function reglagesSession(base: Record<string, unknown>, coupes: readonly string[]): string {
  if (!coupes.length) return JSON.stringify(base);
  const skillOverrides: Record<string, "off"> = {};
  for (const nom of [...coupes].sort((a, b) => a.localeCompare(b, "fr"))) skillOverrides[nom] = "off";
  return JSON.stringify({ ...base, skillOverrides });
}
