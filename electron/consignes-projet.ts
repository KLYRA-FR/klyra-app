import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Les consignes d'un projet pour ses agents, en un clic : un AGENTS.md court à remplir (lu par Codex,
 * et par Claude Code quand il n'y a pas de CLAUDE.md), et un CLAUDE.md qui l'importe (`@AGENTS.md`)
 * pour que Claude Code le lise à toutes les versions, une seule fois (vérifié le 03/11/2026 :
 * +59 jetons, pas de double lecture). Un fichier existant n'est jamais écrasé : un CLAUDE.md sans
 * import reçoit seulement la ligne `@AGENTS.md` en tête, et la personne voit tout avant d'écrire.
 */

export const IMPORT_AGENTS = "@AGENTS.md";

export interface FichierPropose {
  nom: "AGENTS.md" | "CLAUDE.md";
  /** `creer` : le fichier n'existe pas ; `ajouter-import` : la ligne `@AGENTS.md` en tête d'un CLAUDE.md. */
  action: "creer" | "ajouter-import";
  /** Le contenu écrit (création) ou ajouté (import). */
  contenu: string;
}

export interface EtatConsignesProjet {
  agentsMd: boolean;
  /** Le CLAUDE.md du projet : absent, présent avec l'import, ou présent sans. */
  claudeMd: "absent" | "importe" | "sans-import";
  /** Ce que l'app écrirait ; vide quand tout est en place. */
  propositions: FichierPropose[];
}

const lire = (fichier: string) => {
  try {
    return readFileSync(fichier, "utf8");
  } catch {
    return null;
  }
};

/** Les commandes de vérification devinées d'après le package.json (gestionnaire d'après le verrou). */
export function commandesVerification(dossier: string): string | null {
  const brut = lire(path.join(dossier, "package.json"));
  if (!brut) return null;
  let scripts: Record<string, unknown> = {};
  try {
    scripts = (JSON.parse(brut) as { scripts?: Record<string, unknown> }).scripts ?? {};
  } catch {
    return null;
  }
  const outil = existsSync(path.join(dossier, "pnpm-lock.yaml")) ? "pnpm" : existsSync(path.join(dossier, "yarn.lock")) ? "yarn" : "npm run";
  const presents = ["typecheck", "lint", "test", "build"].filter((s) => typeof scripts[s] === "string");
  return presents.length ? presents.map((s) => `${outil} ${s}`).join(" && ") : null;
}

/** Le modèle d'AGENTS.md : court, à remplir ; chaque ligne est relue à chaque appel des agents. */
export function modeleAgentsMd(nomProjet: string, dossier: string): string {
  const verifier = commandesVerification(dossier);
  return [
    `# ${nomProjet}`,
    "",
    "<!-- Consignes de ce projet pour ses agents (Claude Code, Codex…). Garde-les courtes : chaque ligne est relue à chaque appel. -->",
    "",
    "## But",
    "À compléter : ce que fait ce projet, et pour qui, en une ou deux phrases.",
    "",
    "## Vérifier avant de dire que c'est fini",
    verifier ? `${verifier}` : "À compléter : les commandes qui vérifient le travail (tests, lint, build).",
    "",
    "## Où sont les choses",
    "À compléter : les dossiers et fichiers clés, une ligne chacun.",
    "",
    "## Règles du projet",
    "À compléter : ce qui est propre à ce projet (conventions, ce qu'on ne touche pas, à qui demander).",
    "",
  ].join("\n");
}

const importeAgents = (contenu: string) => contenu.split(/\r?\n/).some((l) => l.trim() === IMPORT_AGENTS);

/** Où en sont les consignes du projet, et ce que l'app propose d'écrire. */
export function etatConsignesProjet(dossier: string, nomProjet: string): EtatConsignesProjet {
  if (!statSync(dossier, { throwIfNoEntry: false })?.isDirectory()) throw new Error("Le dossier du projet est introuvable sur ce poste.");
  const agentsMd = existsSync(path.join(dossier, "AGENTS.md"));
  const contenuClaude = lire(path.join(dossier, "CLAUDE.md"));
  const claudeMd = contenuClaude === null ? "absent" : importeAgents(contenuClaude) ? "importe" : "sans-import";
  const propositions: FichierPropose[] = [];
  if (!agentsMd) propositions.push({ nom: "AGENTS.md", action: "creer", contenu: modeleAgentsMd(nomProjet, dossier) });
  if (claudeMd === "absent") propositions.push({ nom: "CLAUDE.md", action: "creer", contenu: `${IMPORT_AGENTS}\n` });
  else if (claudeMd === "sans-import") propositions.push({ nom: "CLAUDE.md", action: "ajouter-import", contenu: `${IMPORT_AGENTS}\n\n` });
  return { agentsMd, claudeMd, propositions };
}

/**
 * Écrit ce que l'état propose, sans rien écraser : une création échoue si le fichier est apparu
 * entre-temps (`wx`), l'import n'est ajouté qu'une fois. Rend l'état après écriture.
 */
export function appliquerConsignesProjet(dossier: string, nomProjet: string): EtatConsignesProjet {
  const { propositions } = etatConsignesProjet(dossier, nomProjet);
  for (const p of propositions) {
    const fichier = path.join(dossier, p.nom);
    if (p.action === "creer") {
      writeFileSync(fichier, p.contenu, { flag: "wx" });
      continue;
    }
    const actuel = lire(fichier);
    if (actuel === null || importeAgents(actuel)) continue;
    writeFileSync(fichier, p.contenu + actuel);
  }
  return etatConsignesProjet(dossier, nomProjet);
}
