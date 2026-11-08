/** Parcours GitHub dans la vraie app, sur PC puis sur un vrai serveur KLYRA jetable.
 * API GitHub simulée (comptes et jetons fictifs), vrais clones Git et stockage chiffré.
 * Aucun accès à un compte réel, aucun agent lancé. Prérequis : build et build:electron. */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { creerCoffreServeur } from "../serveur/coffre-serveur.mjs";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const { echecs, verifier } = verificateur();
const ROOT = path.resolve(import.meta.dirname, "..");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-projet-github-"));
const HOME = path.join(TMP, "pc");
const VPS = path.join(TMP, "vps");
const DONNEES = path.join(TMP, "profil");
const DATA_VPS = path.join(TMP, "data-vps");
const BIN = path.join(TMP, "bin");
const NUS = path.join(TMP, "nus");
for (const d of [HOME, VPS, DONNEES, DATA_VPS, BIN, path.join(NUS, "demo")]) mkdirSync(d, { recursive: true });
const env = { HOME, PATH: `${BIN}${path.delimiter}${process.env.PATH}`, KLYRA_USER_DATA: DONNEES };
const g = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args], { cwd, env: { ...process.env, HOME }, stdio: "pipe" }).toString();
const nu = path.join(NUS, "demo", "site.git");
g(TMP, "init", "--bare", "--initial-branch=main", nu);
const auteur = path.join(TMP, "auteur");
g(TMP, "clone", nu, auteur);
writeFileSync(path.join(auteur, "README.md"), "# Site de test\n");
g(auteur, "add", "."); g(auteur, "commit", "-m", "premier"); g(auteur, "push", "origin", "main");
g(auteur, "branch", "dev"); g(auteur, "push", "origin", "dev");
for (const home of [HOME, VPS]) writeFileSync(path.join(home, ".gitconfig"), `[url "${pathToFileURL(NUS).href}/"]\n insteadOf = https://github.com/\n`);
writeFileSync(path.join(BIN, "gh"), `#!${process.execPath}\nconst a=process.argv.slice(2);if(a.some(x=>x.startsWith('/user/repos'))) console.log(JSON.stringify([[{full_name:'demo/site',private:true,default_branch:'main'},{full_name:'demo/inconnu',private:true,default_branch:'main'}]]));else if(a.some(x=>x.includes('/branches'))) console.log(JSON.stringify([[{name:'main'},{name:'dev'}]]));else process.exit(1);\n`, { mode: 0o700 });
// Le harnais chiffre lui-même le compte fictif. Aucun contournement du coffre dans le code livré.
const entree = path.join(TMP, "fixture.cjs");
writeFileSync(entree, `const {app,safeStorage}=require('electron'); const fs=require('node:fs');app.setPath('userData',${JSON.stringify(DONNEES)});app.whenReady().then(()=>{safeStorage.setUsePlainTextEncryption(true);fs.writeFileSync(${JSON.stringify(path.join(DONNEES, "github-projets.json"))},JSON.stringify({version:1,contenu:safeStorage.encryptString(JSON.stringify({compte:'demo',jeton:'jeton-fictif-du-test'})).toString('base64')}));});require(${JSON.stringify(path.join(ROOT, "dist-electron", "main.js"))});`);
const coffre = creerCoffreServeur({ donnees: DATA_VPS });
writeFileSync(path.join(DATA_VPS, "github-projets.json"), JSON.stringify({ version: 1, contenu: coffre.chiffrerTexte(JSON.stringify({ compte: "demo-vps", jeton: "jeton-fictif-vps" })) }));
const port = 21000 + Math.floor(Math.random() * 15000);
const adresse = `http://127.0.0.1:${port}`;
const envServeur = { ...process.env, HOME: VPS, PATH: env.PATH, KLYRA_SERVEUR_DONNEES: DATA_VPS, KLYRA_SERVEUR_PORT: String(port), KLYRA_SERVEUR_HOTE: "127.0.0.1", KLYRA_SERVEUR_NOM: "VPS GitHub test" };
const fichierServeur = path.join(ROOT, "serveur", "klyra-serveur.mjs");
const serveur = spawn(process.execPath, [fichierServeur], { env: envServeur, stdio: "ignore" });
let app;
try {
  app = await lancerApp({ env, port: 9391, entree });
  const choisirDepot = async (nom) => {
    const bouton = await app.ev(`(() => { const l=[...document.querySelectorAll('[data-source-github] button[role="combobox"]')];return l[0]?.getAttribute('aria-expanded'); })()`);
    if (bouton !== "true") await app.ev(`document.querySelector('[data-source-github] button[role="combobox"]')?.click()`);
    await app.quand(`!!document.querySelector('[role="option"]')`);
    return app.ev(`(() => {const b=[...document.querySelectorAll('[role="option"]')].find(x=>x.textContent.includes(${JSON.stringify(nom)}));if(!b)return false;b.click();return true;})()`);
  };
  const formulaire = async () => {
    await app.aller("/projets?nouveau=1");
    await app.quand(`!!document.querySelector('form')`);
    verifier(await app.cliquer("Dépôt GitHub"), "le choix Dépôt GitHub est accessible");
    if (!verifier(await app.quand(`/GitHub · demo/.test(document.querySelector('form')?.innerText ?? '') && !/Chargement des dépôts/.test(document.querySelector('form')?.innerText ?? '')`, 10000), "le compte et ses dépôts sont chargés")) throw new Error("Compte de test inaccessible");
    verifier(!await app.ev(`!!document.querySelector('input[placeholder^="propriétaire/dépôt"]')`), "aucune URL de dépôt n'est demandée");
  };
  await formulaire();
  await app.cliquer("Ouvrir le dépôt");
  verifier(await app.quand(`/Choisis un dépôt GitHub et une branche/.test(document.querySelector('form')?.innerText ?? '')`), "sans choix, la validation demande un dépôt et une branche");
  await app.saisir('input[placeholder="Nom du dépôt ou de l’organisation"]', "introuvable");
  verifier(await app.quand(`/Aucun dépôt ne correspond/.test(document.querySelector('form')?.innerText ?? '')`), "la recherche vide est expliquée");
  await app.saisir('input[placeholder="Nom du dépôt ou de l’organisation"]', "");
  verifier(await choisirDepot("demo/inconnu"), "un dépôt est choisi dans la liste");
  await app.quand(`document.querySelectorAll('[data-source-github] button[role="combobox"]').length===2`);
  await app.cliquer("Ouvrir le dépôt");
  verifier(await app.quand(`/GitHub n’a pas confirmé/.test(document.querySelector('form')?.innerText ?? '')`, 20000), "un échec de clonage reste affiché sans créer de projet");
  verifier(await choisirDepot("demo/site"), "le dépôt privé est sélectionnable");
  await app.quand(`!document.querySelector('[data-source-github]')?.innerText.includes('Chargement des branches')`);
  await app.cliquer("Ouvrir le dépôt");
  verifier(await app.quand(`location.search.includes('id=site')`, 30000), "le dépôt s'ouvre comme projet sur le PC");
  const suffixe = createHash("sha256").update("main").digest("hex").slice(0, 12);
  const clone = path.join(HOME, "KLYRA", "GitHub", "demo", `site-${suffixe}`);
  verifier(readFileSync(path.join(clone, "README.md"), "utf8").includes("Site de test"), "les vrais fichiers sont clonés dans un dossier automatique");
  verifier(await app.quand(`!!document.querySelector('[data-depot-projet]')`), "le dépôt et sa branche sont montrés dans le projet");
  writeFileSync(path.join(auteur, "README.md"), "# Nouveauté\n"); g(auteur, "add", "."); g(auteur, "commit", "-m", "suite"); g(auteur, "push", "origin", "main");
  await app.cliquer("Récupérer les nouveautés");
  verifier(await app.quand(`/Nouveautés récupérées/.test(document.querySelector('[data-depot-projet]')?.innerText ?? '')`, 20000), "les nouveautés sont récupérées");
  verifier(readFileSync(path.join(clone, "README.md"), "utf8").includes("Nouveauté"), "le nouveau commit est bien dans les fichiers");
  await attendre(1200);
  const projet = JSON.parse(readFileSync(path.join(DONNEES, "conversations.json"), "utf8")).projects.find(p => p.id === "site");
  verifier(projet?.githubConnecte === true && projet.depot === "demo/site", "le lien GitHub est conservé avec le projet");

  for (let i=0;i<50 && !(await fetch(adresse).then(()=>true,()=>false));i++) await attendre(200);
  const code = execFileSync(process.execPath, [fichierServeur, "appairer"], { env: envServeur }).toString().trim();
  await app.aller("/serveurs");
  await app.quand(`!!document.querySelector('input[aria-label="Lien d’invitation"]')`);
  await app.saisir('input[aria-label="Lien d’invitation"]', `klyra://rejoindre?adresse=${encodeURIComponent(adresse)}&code=${encodeURIComponent(code)}`);
  await app.cliquer("Rejoindre");
  verifier(await app.quand(`document.querySelector('main')?.innerText.includes('VPS GitHub test')`), "le serveur jetable est relié");
  // Même choix de machine que le menu Serveurs ; le reload recharge son espace.
  await app.ev(`localStorage.setItem('klyra:lieu-actif',${JSON.stringify(adresse)});location.reload()`);
  await app.quand(`!!document.querySelector('main')`);
  await formulaire();
  verifier(await app.ev(`document.querySelector('form').innerText.includes('sur ce VPS')`), "le formulaire indique que le clone sera sur le VPS");
  verifier(await choisirDepot("demo/site"), "le dépôt est sélectionnable sur le VPS");
  await app.quand(`!document.querySelector('[data-source-github]')?.innerText.includes('Chargement des branches')`);
  await app.cliquer("Ouvrir le dépôt");
  verifier(await app.quand(`location.pathname.startsWith('/projet') && location.search.includes('id=site')`, 30000), "le projet GitHub s'ouvre sur le VPS");
  const cloneVps = path.join(VPS, "projets", "GitHub", "demo", `site-${suffixe}`);
  verifier(readFileSync(path.join(cloneVps, "README.md"), "utf8").includes("Nouveauté"), "le dépôt est réellement cloné sur le serveur choisi");
  verifier(app.erreurs.length === 0, "aucune exception JavaScript pendant le parcours");
} catch (e) { verifier(false, `parcours interrompu : ${e instanceof Error ? e.message : e}`); }
finally {
  if (app) await app.fermer();
  serveur.kill();
  await new Promise(r=>serveur.exitCode!==null?r():serveur.once('exit',r));
  rmSync(TMP, { recursive: true, force: true });
}
console.log(`${echecs.length} échec(s).`);
if(echecs.length) process.exit(1);
