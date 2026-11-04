/**
 * Les fichiers du serveur du VPS compilés depuis l'app (le serveur est livré en .mjs par `curl`) :
 * - `serveur/horaires.mjs` : le calcul des échéances des routines (electron/routines/schedule.ts) ;
 * - `serveur/codex-protocole.mjs` : ce que l'app dit à Codex et lit de lui (electron/moteurs/codex-protocole.ts) ;
 * - `serveur/ia-catalogue.mjs` : les IA à consulter proposées (electron/ia-catalogue.ts) ;
 * - `serveur/atelier.mjs` : le dossier de chaque agent hors projet (electron/atelier.ts) ;
 * - `serveur/connaissances-agent.mjs` : les skills et la mémoire d'un agent (electron/connaissances-agent.ts) ;
 * - `serveur/skills-par-agent.mjs` : quelles skills chaque agent reçoit (electron/skills-par-agent.ts) ;
 * - `serveur/consommation-ecart.mjs` : ce qu'un tour de Claude Code a consommé (electron/consommation-ecart.ts) ;
 * - `serveur/diagnostic-poste.mjs` : ce que la configuration de Claude Code ajoute à chaque appel (electron/diagnostic-poste.ts) ;
 * - `serveur/consignes-projet.mjs` : les consignes KLYRA d'un projet, AGENTS.md et CLAUDE.md (electron/consignes-projet.ts) ;
 * - `serveur/epreuve.mjs`, `serveur/json-partiel.mjs` et `serveur/atelier-agent.mjs` : l'atelier d'un agent
 *   (outils de l'assistant, carte, épreuve, entrée d'un outil en cours d'écriture).
 * Un import entre fichiers générés (`./epreuve` ou `./epreuve.ts`) devient `./epreuve.mjs` ; tout autre import relatif est refusé.
 *   node scripts/serveur-genere.mjs           → écrit les fichiers
 *   node scripts/serveur-genere.mjs --verifier → échoue si l'un n'est plus à jour (test:serveur)
 */
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const FICHIERS = [
  ["electron/routines/schedule.ts", "serveur/horaires.mjs"],
  ["electron/moteurs/codex-protocole.ts", "serveur/codex-protocole.mjs"],
  ["electron/ia-catalogue.ts", "serveur/ia-catalogue.mjs"],
  ["electron/atelier.ts", "serveur/atelier.mjs"],
  ["electron/connaissances-agent.ts", "serveur/connaissances-agent.mjs"],
  ["electron/skills-par-agent.ts", "serveur/skills-par-agent.mjs"],
  ["electron/consommation-ecart.ts", "serveur/consommation-ecart.mjs"],
  ["electron/diagnostic-poste.ts", "serveur/diagnostic-poste.mjs"],
  ["electron/consignes-projet.ts", "serveur/consignes-projet.mjs"],
  ["electron/epreuve.ts", "serveur/epreuve.mjs"],
  ["electron/json-partiel.ts", "serveur/json-partiel.mjs"],
  ["electron/atelier-agent.ts", "serveur/atelier-agent.mjs"],
];

/** Le nom d'un fichier généré, sans dossier ni extension (`epreuve`). */
const GENERES = new Set(FICHIERS.map(([, vers]) => vers.replace(/^serveur\//, "").replace(/\.mjs$/, "")));

let perime = false;
for (const [depuis, vers] of FICHIERS) {
  const source = readFileSync(new URL(`../${depuis}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: false, verbatimModuleSyntax: false } });
  const code = outputText.replace(/(from\s+")\.\/([^"]+)(")/g, (_, avant, nom, apres) => {
    const base = nom.replace(/\.(ts|js)$/, "");
    if (!GENERES.has(base)) throw new Error(`${depuis} importe ./${nom}, qui n’est pas généré pour le serveur.`);
    return `${avant}./${base}.mjs${apres}`;
  });
  const contenu = `// Généré par scripts/serveur-genere.mjs depuis ${depuis} : ne pas modifier à la main.\n${code}`;
  const cible = new URL(`../${vers}`, import.meta.url);
  if (!process.argv.includes("--verifier")) writeFileSync(cible, contenu);
  else if (readFileSync(cible, "utf8") !== contenu) {
    console.error(`${vers} n’est plus à jour : node scripts/serveur-genere.mjs`);
    perime = true;
  }
}
if (perime) process.exit(1);
if (process.argv.includes("--verifier")) console.log("Fichiers générés du serveur à jour.");
