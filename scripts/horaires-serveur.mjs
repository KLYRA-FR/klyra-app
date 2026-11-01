/**
 * Le calcul des échéances des routines, pour le serveur du VPS : `electron/routines/schedule.ts`
 * compilé tel quel dans `serveur/horaires.mjs` (le serveur est livré en .mjs par `curl`).
 *   node scripts/horaires-serveur.mjs           → écrit le fichier
 *   node scripts/horaires-serveur.mjs --verifier → échoue s'il n'est plus à jour (test:serveur)
 */
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../electron/routines/schedule.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: false } });
const contenu = `// Généré par scripts/horaires-serveur.mjs depuis electron/routines/schedule.ts : ne pas modifier à la main.\n${outputText}`;
const cible = new URL("../serveur/horaires.mjs", import.meta.url);
if (process.argv.includes("--verifier")) {
  if (readFileSync(cible, "utf8") !== contenu) {
    console.error("serveur/horaires.mjs n’est plus à jour : node scripts/horaires-serveur.mjs");
    process.exit(1);
  }
  console.log("serveur/horaires.mjs à jour.");
} else writeFileSync(cible, contenu);
