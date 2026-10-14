/**
 * Embarque les fiches de `agents-equipe/*.md` dans l'app
 * (`src/data/agent-templates.generated.ts`), pour installer l'équipe sur un
 * poste qui ne l'a pas encore. À relancer après chaque modif de ces fiches :
 *   pnpm agents:equipe
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const racine = path.resolve(import.meta.dirname, "..");
const dossier = path.join(racine, "agents-equipe");
const sortie = path.join(racine, "src/data/agent-templates.generated.ts");

const fiches = readdirSync(dossier)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => ({ name: f.slice(0, -3), content: readFileSync(path.join(dossier, f), "utf8") }));

writeFileSync(
  sortie,
  `/* GÉNÉRÉ par scripts/agents-equipe.mjs depuis agents-equipe/*.md — ne pas éditer à la main. */

/** Fiches de l'équipe KLYRA, texte intégral, pour les installer dans ~/.claude/agents/. */
export const AGENT_TEMPLATES: { name: string; content: string }[] = ${JSON.stringify(fiches, null, 2)};
`,
);
console.log(`${fiches.length} fiches → ${path.relative(racine, sortie)}`);
