/**
 * Les fichiers du serveur du VPS compilés depuis l'app (le serveur est livré en .mjs par `curl`) :
 * - `serveur/horaires.mjs` : le calcul des échéances des routines (electron/routines/schedule.ts) ;
 * - `serveur/codex-protocole.mjs` : ce que l'app dit à Codex et lit de lui (electron/moteurs/codex-protocole.ts) ;
 * - `serveur/ia-catalogue.mjs` : les IA à consulter proposées (electron/ia-catalogue.ts) ;
 * - `serveur/atelier.mjs` : le dossier de chaque agent hors projet (electron/atelier.ts).
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
];

let perime = false;
for (const [depuis, vers] of FICHIERS) {
  const source = readFileSync(new URL(`../${depuis}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: false, verbatimModuleSyntax: false } });
  const contenu = `// Généré par scripts/serveur-genere.mjs depuis ${depuis} : ne pas modifier à la main.\n${outputText}`;
  const cible = new URL(`../${vers}`, import.meta.url);
  if (!process.argv.includes("--verifier")) writeFileSync(cible, contenu);
  else if (readFileSync(cible, "utf8") !== contenu) {
    console.error(`${vers} n’est plus à jour : node scripts/serveur-genere.mjs`);
    perime = true;
  }
}
if (perime) process.exit(1);
if (process.argv.includes("--verifier")) console.log("Fichiers générés du serveur à jour.");
