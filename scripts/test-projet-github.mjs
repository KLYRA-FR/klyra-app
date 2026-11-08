/**
 * Un projet depuis un dépôt GitHub (electron/git.ts, ProjetsScreen, DepotProjet) dans l'app de bureau,
 * sans réseau : le git du poste réécrit https://github.com/ vers des dépôts nus locaux (`insteadOf` dans
 * le .gitconfig du HOME temporaire), exactement le chemin d'un vrai clone.
 * - « Ajouter un projet » propose « Dossier de ce PC » et « Dépôt GitHub » ;
 * - champ vide refusé ; dépôt inexistant : le message d'échec, aucun projet ajouté ;
 * - « Cloner et ajouter » clone dans ~/KLYRA/<dépôt> et ouvre le projet, nom tiré du dépôt ;
 * - la page du projet montre le dépôt, sa branche, et récupère un commit poussé ensuite ;
 * - le projet garde `depot`, et le texte « Rien n'est déplacé ni copié » ne vaut plus que pour un dossier.
 * Aucun agent n'est lancé. Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:projet-github          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-projet-github-"));
const DONNEES = path.join(TMP, "userdata");
const HOME = path.join(TMP, "home");
const GH = path.join(TMP, "gh");
mkdirSync(DONNEES, { recursive: true });
mkdirSync(HOME, { recursive: true });

const g = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@klyra.local", "-c", "init.defaultBranch=main", ...args], { cwd, stdio: "pipe", env: { ...process.env, HOME } }).toString();
// « GitHub » : demo/site.git, un dépôt nu avec un commit sur main.
mkdirSync(path.join(GH, "demo"), { recursive: true });
g(GH, "init", "--bare", path.join(GH, "demo", "site.git"));
const AUTEUR = path.join(TMP, "auteur");
g(TMP, "clone", path.join(GH, "demo", "site.git"), AUTEUR);
writeFileSync(path.join(AUTEUR, "README.md"), "# Site\n");
g(AUTEUR, "add", "-A");
g(AUTEUR, "commit", "-m", "premier");
g(AUTEUR, "push", "-u", "origin", "HEAD:main");
writeFileSync(path.join(HOME, ".gitconfig"), `[url "${pathToFileURL(GH).href}/"]\n\tinsteadOf = https://github.com/\n`);
writeFileSync(path.join(DONNEES, "conversations.json"), JSON.stringify({ version: 1, chats: [], messages: [], projects: [] }));

const CLONE = path.join(HOME, "KLYRA", "site");
const app = await lancerApp({ port: 9391, env: { HOME, KLYRA_USER_DATA: DONNEES } });
const champ = 'input[placeholder^="propriétaire/dépôt"]';
const formulaire = () => app.ev(`document.querySelector("form")?.innerText ?? ""`);

try {
  await app.aller("/projets");
  await app.quand(`/Ajoute ton premier projet/.test(document.body.innerText)`);
  const vide = await app.texte();
  verifier(/rien n’est déplacé ni copié\. Un dépôt GitHub est cloné/.test(vide), "page vide : le texte distingue un dossier (rien de copié) d’un dépôt GitHub (cloné)");

  await app.aller("/projets?nouveau=1");
  await app.quand(`!!document.querySelector("form")`);
  verifier(/Dossier de (ce PC|ce Mac|cet ordinateur)/.test(await formulaire()) && /Dépôt GitHub/.test(await formulaire()), "« Ajouter un projet » propose un dossier ou un dépôt GitHub");
  verifier(await app.cliquer("Dépôt GitHub"), "onglet « Dépôt GitHub »");
  await app.quand(`!!document.querySelector(${JSON.stringify(champ)})`);
  await app.quand(`/KLYRA/.test(document.querySelector("[data-source-github]")?.innerText ?? "")`, 5000);
  verifier((await formulaire()).includes(path.join(HOME, "KLYRA")), "le dossier par défaut est ~/KLYRA");

  await app.cliquer("Cloner et ajouter");
  await app.quand(`/Écris le dépôt/.test(document.querySelector("form")?.innerText ?? "")`, 3000);
  verifier(/Écris le dépôt/.test(await formulaire()), "champ vide : refusé, avec la consigne");

  await app.saisir(champ, "demo/inconnu");
  await app.cliquer("Cloner et ajouter");
  await app.quand(`/clonage a échoué|refuse l’accès/.test(document.querySelector("form")?.innerText ?? "")`, 20000);
  verifier(/clonage a échoué|refuse l’accès/.test(await formulaire()), "dépôt introuvable : le message d’échec est affiché");
  verifier(!existsSync(path.join(HOME, "KLYRA", "inconnu", "README.md")), "dépôt introuvable : rien de cloné");

  await app.saisir(champ, "https://github.com/demo/site");
  await app.cliquer("Cloner et ajouter");
  const ouvert = await app.quand(`location.search.includes("id=site")`, 30000);
  verifier(ouvert, "« Cloner et ajouter » ouvre le projet (nom tiré du dépôt)");
  verifier(readFileSync(path.join(CLONE, "README.md"), "utf8") === "# Site\n", "le dépôt est cloné dans ~/KLYRA/site");

  await app.quand(`!!document.querySelector("[data-depot-projet]")`);
  const depot = () => app.ev(`document.querySelector("[data-depot-projet]")?.innerText ?? ""`);
  verifier(/demo\/site/.test(await depot()) && /Branche main/.test(await depot()) && /à jour/.test(await depot()), `la page du projet montre le dépôt et sa branche (${(await depot()).replace(/\n/g, " ")})`);

  writeFileSync(path.join(AUTEUR, "README.md"), "# Site\nNouveauté\n");
  g(AUTEUR, "commit", "-am", "second");
  g(AUTEUR, "push");
  verifier(await app.cliquer("Récupérer les nouveautés", `document.querySelector("[data-depot-projet]")`), "bouton « Récupérer les nouveautés »");
  await app.quand(`/Nouveautés récupérées/.test(document.querySelector("[data-depot-projet]")?.innerText ?? "")`, 20000);
  verifier(/Nouveautés récupérées/.test(await depot()), "la récupération est dite");
  verifier(readFileSync(path.join(CLONE, "README.md"), "utf8").includes("Nouveauté"), "le commit poussé ensuite est dans le clone");

  await attendre(1500);
  const enregistre = JSON.parse(readFileSync(path.join(DONNEES, "conversations.json"), "utf8")).projects?.find((p) => p.id === "site");
  verifier(enregistre?.depot === "demo/site" && enregistre?.folder === CLONE && enregistre?.name === "site", "le projet est enregistré avec son dépôt et son dossier");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page (${app.erreurs.join(" | ") || "aucune"})`);
} catch (erreur) {
  verifier(false, `parcours interrompu : ${erreur instanceof Error ? erreur.message : erreur}`);
} finally {
  await app.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`);
  process.exit(1);
}
console.log("\nTout est bon.");
