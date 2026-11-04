import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Ce que le poste de la personne ajoute à chaque appel des sessions de l'app, en plus de l'app
 * elle-même : son CLAUDE.md personnel, ses skills, ses plugins, ses serveurs MCP, et la présentation de
 * ses agents actifs. Lecture seule. Les tailles sont estimées d'après les fichiers : une mesure exacte
 * demanderait un appel au modèle. Calibré le 03/11/2026 : un CLAUDE.md de 6 164 octets ajoute 2 391 jetons
 * réels (Claude Code l'entoure d'un peu de texte) ; 2,75 caractères par jeton, comme `pnpm mesure:socle --reel`.
 * Une skill personnelle se retire d'un agent sans retirer ses agents ni son CLAUDE.md :
 * `skillOverrides` à `off` dans le `--settings` de la session (prouvé le 04/11/2026).
 * `--setting-sources project,local` retire aussi les agents du poste : on ne l'utilise pas.
 * Les interrupteurs sont dans Réglages › Agents. Le diagnostic reste une lecture.
 */

export const CARACTERES_PAR_JETON = 2.75;
const jetons = (caracteres: number) => Math.round(caracteres / CARACTERES_PAR_JETON);

export interface ElementPoste {
  cle: "claude-md" | "skills" | "agents" | "plugins" | "mcp";
  libelle: string;
  /** Ce qu'on a trouvé, en une phrase. */
  detail: string;
  /** Jetons estimés à chaque appel ; null : non mesurable d'après les fichiers. */
  jetons: number | null;
  /** Ce qu'on conseille, ou null si rien à signaler. */
  conseil: string | null;
  /** Le fichier ou le dossier à ouvrir pour agir. */
  chemin: string | null;
}

export interface DiagnosticPoste {
  elements: ElementPoste[];
  /** La somme des jetons estimés. */
  total: number;
}

const lire = (fichier: string) => {
  try {
    return readFileSync(fichier, "utf8");
  } catch {
    return null;
  }
};
const lireJson = (fichier: string): Record<string, unknown> | null => {
  const brut = lire(fichier);
  if (!brut) return null;
  try {
    return JSON.parse(brut) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const lister = (dossier: string) => {
  try {
    return readdirSync(dossier);
  } catch {
    return [];
  }
};

/** Le champ `description` d'un en-tête YAML simple (entre guillemets ou non). */
export function description(contenu: string): string {
  const entete = /^---\n([\s\S]*?)\n---/.exec(contenu)?.[1] ?? "";
  const ligne = /^description:\s*(.*)$/m.exec(entete)?.[1]?.trim() ?? "";
  return ligne.replace(/^(["'])([\s\S]*)\1$/, "$2");
}

/** Le CLAUDE.md personnel et ses imports `@chemin` (un niveau), tels que Claude Code les charge. */
function claudeMd(dossierClaude: string): ElementPoste {
  const fichier = path.join(dossierClaude, "CLAUDE.md");
  const contenu = lire(fichier);
  if (contenu === null) return { cle: "claude-md", libelle: "CLAUDE.md personnel", detail: "Aucun.", jetons: 0, conseil: null, chemin: null };
  let caracteres = contenu.length;
  let imports = 0;
  for (const [, cible] of contenu.matchAll(/^@(\S+)\s*$/gm)) {
    const chemin = cible.startsWith("~/") ? path.join(path.dirname(dossierClaude), cible.slice(2)) : path.resolve(path.dirname(fichier), cible);
    const importe = lire(chemin);
    if (importe !== null) {
      caracteres += importe.length;
      imports += 1;
    }
  }
  const n = jetons(caracteres);
  return {
    cle: "claude-md",
    libelle: "CLAUDE.md personnel",
    detail: `${caracteres.toLocaleString("fr-FR")} caractères${imports ? `, avec ${imports} fichier${imports > 1 ? "s" : ""} importé${imports > 1 ? "s" : ""}` : ""}, relus à chaque appel de tous tes agents, dans KLYRA comme ailleurs.`,
    jetons: n,
    conseil: n > 1500 ? "Garde-y seulement ce qui vaut partout. Ce qui concerne un projet va dans son AGENTS.md : il ne sera lu que là." : null,
    chemin: fichier,
  };
}

/** Les skills personnelles : leur nom et leur description sont listés à chaque appel. */
function skills(dossierClaude: string): ElementPoste {
  const dossier = path.join(dossierClaude, "skills");
  const noms: string[] = [];
  let caracteres = 0;
  for (const nom of lister(dossier)) {
    const contenu = lire(path.join(dossier, nom, "SKILL.md"));
    if (contenu === null) continue;
    noms.push(nom);
    caracteres += nom.length + description(contenu).length + 4;
  }
  const n = jetons(caracteres);
  return {
    cle: "skills",
    libelle: "Skills personnelles",
    detail: noms.length ? `${noms.length} skill${noms.length > 1 ? "s" : ""} (${noms.slice(0, 6).join(", ")}${noms.length > 6 ? "…" : ""}) : présentée${noms.length > 1 ? "s" : ""} à un agent tant qu’on ne la coupe pas dans Réglages › Agents.` : "Aucune.",
    jetons: n,
    conseil: n > 400 ? "Coupe, dans Réglages › Agents, celles qui ne servent pas à un agent : une skill coupée ne part plus dans ses appels. Rien n’est supprimé du poste." : null,
    chemin: noms.length ? dossier : null,
  };
}

/** Les agents actifs : l'assistant reçoit le nom et la description de chacun à chaque appel. */
function agents(dossierClaude: string, actifs: string[]): ElementPoste {
  let caracteres = 0;
  let longues = 0;
  for (const id of actifs) {
    const d = description(lire(path.join(dossierClaude, "agents", `${id}.md`)) ?? "");
    caracteres += id.length + d.length + 4;
    if (d.length > 300) longues += 1;
  }
  return {
    cle: "agents",
    libelle: "Présentation de tes agents actifs",
    detail: actifs.length ? `${actifs.length} agent${actifs.length > 1 ? "s" : ""} actif${actifs.length > 1 ? "s" : ""}, présenté${actifs.length > 1 ? "s" : ""} à l’assistant à chaque appel. Les agents désactivés ne coûtent rien.` : "Aucun agent actif : l’assistant travaille seul.",
    jetons: jetons(caracteres),
    conseil: longues ? `${longues} description${longues > 1 ? "s" : ""} dépasse${longues > 1 ? "nt" : ""} 300 caractères : quelques phrases suffisent pour que l’assistant sache quand appeler l’agent.` : null,
    chemin: actifs.length ? path.join(dossierClaude, "agents") : null,
  };
}

/** Les plugins activés dans les réglages de Claude Code : leur contenu n'est pas mesuré ici. */
function plugins(dossierClaude: string): ElementPoste {
  const actives = Object.entries(((lireJson(path.join(dossierClaude, "settings.json"))?.enabledPlugins ?? {}) as Record<string, unknown>))
    .filter(([, actif]) => actif === true)
    .map(([nom]) => nom.split("@")[0]);
  return {
    cle: "plugins",
    libelle: "Plugins de Claude Code",
    detail: actives.length ? `${actives.length} activé${actives.length > 1 ? "s" : ""} : ${actives.slice(0, 6).join(", ")}${actives.length > 6 ? "…" : ""}.` : "Aucun.",
    jetons: null,
    conseil: actives.length ? "Chaque plugin peut ajouter des skills, des agents et des serveurs MCP à chaque session. Désactive ceux qui ne servent pas à tes agents (/plugin dans Claude Code)." : null,
    chemin: actives.length ? path.join(dossierClaude, "settings.json") : null,
  };
}

/** Les serveurs MCP du poste (portée utilisateur) : leurs outils sont chargés à la demande. */
function mcp(fichierClaudeJson: string): ElementPoste {
  const serveurs = Object.keys((lireJson(fichierClaudeJson)?.mcpServers ?? {}) as Record<string, unknown>);
  return {
    cle: "mcp",
    libelle: "Serveurs MCP du poste",
    detail: serveurs.length ? `${serveurs.length} : ${serveurs.slice(0, 6).join(", ")}${serveurs.length > 6 ? "…" : ""}. Leurs outils sont chargés à la demande : ils coûtent peu tant qu’ils ne servent pas.` : "Aucun.",
    jetons: null,
    conseil: null,
    chemin: serveurs.length ? fichierClaudeJson : null,
  };
}

/**
 * Le diagnostic du poste. `home` : le dossier personnel ; `dossierClaude` : celui de Claude Code
 * (`CLAUDE_CONFIG_DIR`, sinon ~/.claude) ; `actifs` : les agents actifs de Mes agents.
 */
export function diagnostiquerPoste(home: string, actifs: string[], dossierClaude = path.join(home, ".claude")): DiagnosticPoste {
  const elements = [claudeMd(dossierClaude), skills(dossierClaude), agents(dossierClaude, actifs), plugins(dossierClaude), mcp(path.join(home, ".claude.json"))];
  return { elements, total: elements.reduce((s, e) => s + (e.jetons ?? 0), 0) };
}

/** Le chemin existe-t-il encore (avant de l'ouvrir) ? */
export const existe = (chemin: string) => existsSync(chemin);
