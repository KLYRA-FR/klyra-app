/**
 * Les fichiers du serveur du VPS compilés depuis l'app (le serveur est livré en .mjs par `curl`) :
 * - `serveur/horaires.mjs` : le calcul des échéances des routines (electron/routines/schedule.ts) ;
 * - `serveur/codex-protocole.mjs` : ce que l'app dit à Codex et lit de lui (electron/moteurs/codex-protocole.ts) ;
 * - `serveur/ia-catalogue.mjs` : les IA à consulter proposées (electron/ia-catalogue.ts) ;
 * - `serveur/atelier.mjs` : le dossier de chaque agent hors projet (electron/atelier.ts) ;
 * - `serveur/connaissances-agent.mjs` : les skills et la mémoire d'un agent (electron/connaissances-agent.ts) ;
 * - `serveur/skills-par-agent.mjs` : quelles skills chaque agent reçoit (electron/skills-par-agent.ts) ;
 * - `serveur/preparation-fournisseur.mjs` : le dossier que Claude Code lit à la place de ~/.claude (electron/preparation-fournisseur.ts) ;
 * - `serveur/consommation-ecart.mjs` : ce qu'un tour de Claude Code a consommé (electron/consommation-ecart.ts) ;
 * - `serveur/acp.mjs` : le client ACP de Grok Build (electron/moteurs/acp.ts) ;
 * - `serveur/utilisation.mjs` : les limites de l'abonnement de Claude et de ChatGPT (electron/utilisation.ts) ;
 * - `serveur/comptes-claude.mjs` : les comptes Claude supplémentaires et leurs limites (electron/comptes-claude.ts) ;
 * - `serveur/diagnostic-poste.mjs` : ce que la configuration de Claude Code ajoute à chaque appel (electron/diagnostic-poste.ts) ;
 * - `serveur/consignes-projet.mjs` : les consignes KLYRA d'un projet, AGENTS.md et CLAUDE.md (electron/consignes-projet.ts) ;
 * - `serveur/navigateur-definitions.mjs` : les outils du navigateur de KLYRA et leur consigne (electron/navigateur/definitions.ts) ;
 * - `serveur/coffre-regles.mjs`, `serveur/coffre-definitions.mjs` et `serveur/coffre-fichier.mjs` : le Coffre
 *   (règles, outils et leurs textes, écriture d'un secret dans un fichier hors de Git) ;
 * - `serveur/workflows-outils.mjs` : les outils des workflows pour les agents (electron/workflows-outils.ts) ;
 * - `serveur/composio-connect.mjs` : la connexion Composio d'un serveur (electron/composio-connect.ts) ;
 * - `serveur/fils-outils.mjs` et `serveur/tickets.mjs` : les fils pour les agents (outils, consigne, textes) et les
 *   règles de leurs tickets (electron/fils-outils.ts, src/lib/tickets.ts) ;
 * - `serveur/workflows-moteur-coeur.mjs`, `serveur/workflows-types.mjs` et `serveur/planning-passages.mjs` : le moteur
 *   des workflows, le même que dans l'app (src/lib/workflows/moteur.ts, src/types/workflows.ts, src/lib/planning.ts) ;
 * - `serveur/epreuve.mjs`, `serveur/json-partiel.mjs` et `serveur/atelier-agent.mjs` : l'atelier d'un agent
 *   (outils de l'assistant, carte, épreuve, entrée d'un outil en cours d'écriture) ; `serveur/atelier-equipe.mjs` :
 *   l'atelier d'une équipe (electron/atelier-equipe.ts) ; `serveur/cartes-interactives.mjs` : les cartes que
 *   chaque agent pose dans le fil (electron/cartes-interactives.ts).
 * - `serveur/joints-vps.mjs` : les pièces jointes envoyées par le PC pour une conversation du VPS (electron/joints-vps.ts).
 * - `serveur/taches-fond.mjs` : ce qu'un agent a encore en arrière-plan, réponse rendue (electron/taches-fond.ts).
 * - `serveur/version-code.mjs` : la version du code du serveur (electron/version-serveur.ts), montée ici dès que
 *   `empreinteCodeServeur` change. Le VPS ne se met pas à jour seul : c'est ce numéro qui révèle un serveur en retard.
 *   Conflit de fusion sur ce fichier : relancer ce script, il repart de la plus haute version et écrit un fichier propre.
 * Un import entre fichiers générés (`./epreuve` ou `./epreuve.ts`) devient `./epreuve.mjs` ; tout autre import relatif est refusé.
 *   node scripts/serveur-genere.mjs           → écrit les fichiers
 *   node scripts/serveur-genere.mjs --verifier → échoue si l'un n'est plus à jour (test:serveur)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { empreinteCodeServeur } from "./empreinte-serveur.mjs";

const FICHIERS = [
  ["electron/github-projets.ts", "serveur/github-projets.mjs"],
  ["electron/github-stockage.ts", "serveur/github-stockage.mjs"],
  ["electron/git.ts", "serveur/git.mjs"],
  ["electron/composio-relais.ts", "serveur/composio-relais.mjs"],
  ["electron/routines/schedule.ts", "serveur/horaires.mjs"],
  ["electron/moteurs/codex-protocole.ts", "serveur/codex-protocole.mjs"],
  ["electron/ia-catalogue.ts", "serveur/ia-catalogue.mjs"],
  ["electron/atelier.ts", "serveur/atelier.mjs"],
  ["electron/connaissances-agent.ts", "serveur/connaissances-agent.mjs"],
  ["electron/extraction-fichiers.ts", "serveur/extraction-fichiers.mjs"],
  ["electron/cerveau-types.ts", "serveur/cerveau-types.mjs"],
  ["electron/cerveau-sens.ts", "serveur/cerveau-sens.mjs"],
  ["electron/cerveau-liens.ts", "serveur/cerveau-liens.mjs"],
  ["electron/cerveau.ts", "serveur/cerveau.mjs"],
  ["electron/cerveau-ingest.ts", "serveur/cerveau-ingest.mjs"],
  ["electron/cerveau-veille.ts", "serveur/cerveau-veille.mjs"],
  ["electron/cerveau-service.ts", "serveur/cerveau-service.mjs"],
  ["electron/cerveau-dossiers.ts", "serveur/cerveau-dossiers.mjs"],
  ["electron/cerveau-outils.ts", "serveur/cerveau-outils.mjs"],
  ["electron/graphe-souvenirs.ts", "serveur/graphe-souvenirs.mjs"],
  ["electron/graphe-entretien.ts", "serveur/graphe-entretien.mjs"],
  ["electron/graphe-regles.ts", "serveur/graphe-regles.mjs"],
  ["electron/graphe-agent.ts", "serveur/graphe-agent.mjs"],
  ["electron/skills-par-agent.ts", "serveur/skills-par-agent.mjs"],
  ["electron/preparation-fournisseur.ts", "serveur/preparation-fournisseur.mjs"],
  ["electron/consommation-ecart.ts", "serveur/consommation-ecart.mjs"],
  ["electron/utilisation.ts", "serveur/utilisation.mjs"],
  ["electron/comptes-claude.ts", "serveur/comptes-claude.mjs"],
  ["electron/moteurs/acp.ts", "serveur/acp.mjs"],
  ["electron/diagnostic-poste.ts", "serveur/diagnostic-poste.mjs"],
  ["electron/consignes-projet.ts", "serveur/consignes-projet.mjs"],
  ["electron/epreuve.ts", "serveur/epreuve.mjs"],
  ["electron/json-partiel.ts", "serveur/json-partiel.mjs"],
  ["electron/taches-fond.ts", "serveur/taches-fond.mjs"],
  ["electron/atelier-agent.ts", "serveur/atelier-agent.mjs"],
  ["electron/atelier-equipe.ts", "serveur/atelier-equipe.mjs"],
  ["electron/cartes-interactives.ts", "serveur/cartes-interactives.mjs"],
  ["electron/joints-vps.ts", "serveur/joints-vps.mjs"],
  ["electron/navigateur/definitions.ts", "serveur/navigateur-definitions.mjs"],
  ["electron/coffre-regles.ts", "serveur/coffre-regles.mjs"],
  ["electron/coffre-definitions.ts", "serveur/coffre-definitions.mjs"],
  ["electron/coffre-fichier.ts", "serveur/coffre-fichier.mjs"],
  ["electron/workflows-outils.ts", "serveur/workflows-outils.mjs"],
  ["electron/composio-connect.ts", "serveur/composio-connect.mjs"],
  ["src/types/workflows.ts", "serveur/workflows-types.mjs"],
  ["src/lib/workflows/moteur.ts", "serveur/workflows-moteur-coeur.mjs"],
  ["src/lib/planning.ts", "serveur/planning-passages.mjs"],
  ["src/lib/fournisseurs.ts", "serveur/fournisseurs.mjs"],
  ["electron/fils-outils.ts", "serveur/fils-outils.mjs"],
  ["src/lib/tickets.ts", "serveur/tickets.mjs"],
];
const VERSION = ["electron/version-serveur.ts", "serveur/version-code.mjs"];

/** Le nom d'un fichier généré, sans dossier ni extension (`epreuve`). */
const GENERES = new Set([...FICHIERS, VERSION].map(([, vers]) => vers.replace(/^serveur\//, "").replace(/\.mjs$/, "")));

const verifier = process.argv.includes("--verifier");
let perime = false;
function generer(depuis, vers) {
  const source = readFileSync(new URL(`../${depuis}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: false, verbatimModuleSyntax: false } });
  const code = outputText.replace(/from\s+"@\/types\/workflows"/g, 'from "./workflows-types.mjs"').replace(/(from\s+")\.\/([^"]+?)(\.mjs)?(")/g, (_, avant, nom, _mjs, apres) => {
    const base = nom.replace(/\.(ts|js)$/, "");
    if (!GENERES.has(base)) throw new Error(`${depuis} importe ./${nom}, qui n’est pas généré pour le serveur.`);
    return `${avant}./${base}.mjs${apres}`;
  });
  const contenu = `// Généré par scripts/serveur-genere.mjs depuis ${depuis} : ne pas modifier à la main.\n${code}`;
  const cible = new URL(`../${vers}`, import.meta.url);
  if (!verifier) writeFileSync(cible, contenu);
  else if (readFileSync(cible, "utf8") !== contenu) {
    console.error(`${vers} n’est plus à jour : node scripts/serveur-genere.mjs`);
    perime = true;
  }
}
for (const [depuis, vers] of FICHIERS) generer(depuis, vers);

/* Après les autres : l'empreinte couvre ce qui vient d'être généré. */
const cheminVersion = new URL(`../${VERSION[0]}`, import.meta.url);
const sourceVersion = readFileSync(cheminVersion, "utf8");
const empreinte = empreinteCodeServeur(fileURLToPath(new URL("../serveur", import.meta.url)));
const conflit = /^(<{7}|={7}|>{7})/m.test(sourceVersion);
if (conflit || sourceVersion.match(/EMPREINTE_CODE_SERVEUR = "([^"]*)"/)?.[1] !== empreinte) {
  if (verifier) {
    console.error("Le code de serveur/ a changé sans monter sa version : node scripts/serveur-genere.mjs");
    perime = true;
  } else {
    const version = Math.max(0, ...[...sourceVersion.matchAll(/VERSION_CODE_SERVEUR = (\d+)/g)].map((m) => Number(m[1]))) + 1;
    writeFileSync(cheminVersion, `/**
 * La version du code du serveur de VPS (\`serveur/*.mjs\` et \`lancer.sh\`), distincte du protocole : un VPS ne se met
 * pas à jour seul, et son protocole peut rester le même alors que son code a du retard.
 * L'app compare celle que le serveur annonce à celle-ci (\`serveurEnRetard\`, src/lib/serveur-vps.ts).
 * Écrit par \`node scripts/serveur-genere.mjs\`, qui la monte quand l'empreinte change ; \`pnpm lint\` et \`test:serveur\`
 * échouent si elle n'a pas suivi. Ne pas modifier à la main.
 */
export const VERSION_CODE_SERVEUR = ${version};
export const EMPREINTE_CODE_SERVEUR = "${empreinte}";
`);
    console.log(`Code du serveur : version ${version}.`);
  }
}
generer(...VERSION);

if (perime) process.exit(1);
if (verifier) console.log("Fichiers générés du serveur à jour.");
