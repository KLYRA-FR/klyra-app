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
// Un second dépôt, ouvert depuis la puce « Dépôt » d'un chat.
const nuDoc = path.join(NUS, "demo", "doc.git");
g(TMP, "init", "--bare", "--initial-branch=main", nuDoc);
const auteurDoc = path.join(TMP, "auteur-doc");
g(TMP, "clone", nuDoc, auteurDoc);
writeFileSync(path.join(auteurDoc, "README.md"), "# Documentation\n");
g(auteurDoc, "add", "."); g(auteurDoc, "commit", "-m", "doc"); g(auteurDoc, "push", "origin", "main");
for (const home of [HOME, VPS]) writeFileSync(path.join(home, ".gitconfig"), `[url "${pathToFileURL(NUS).href}/"]\n insteadOf = https://github.com/\n`);
writeFileSync(path.join(BIN, "gh"), `#!${process.execPath}\nconst a=process.argv.slice(2);if(a.some(x=>x.startsWith('/user/repos'))) console.log(JSON.stringify([[{full_name:'demo/site',private:true,default_branch:'main',description:'Site de démonstration',homepage:'demo.example.com',language:'Astro',pushed_at:new Date().toISOString()},{full_name:'demo/inconnu',private:true,default_branch:'main',pushed_at:'2020-01-01T00:00:00Z'},{full_name:'demo/doc',private:false,default_branch:'main',description:'La documentation',pushed_at:'2019-01-01T00:00:00Z'}]]));else if(a.some(x=>x.includes('/branches'))) console.log(JSON.stringify([[{name:'main'},{name:'dev'}]]));else if(a.includes('/user')) console.log(JSON.stringify({login:'demo',id:42}));else if(a.some(x=>x.includes('/pulls?'))) console.log(JSON.stringify([{number:7,title:'Première PR',user:{login:'iris'},head:{ref:'feat/doc'},html_url:'https://github.com/demo/doc/pull/7'}]));else if(a.some(x=>x.includes('/check-runs'))) console.log(JSON.stringify({check_runs:[{name:'build',status:'completed',conclusion:'failure',html_url:'https://github.com/demo/doc/actions/runs/1'},{name:'lint',status:'completed',conclusion:'success'}]}));else if(a.some(x=>x.includes('/commits?'))) console.log(JSON.stringify([{sha:'abc1234def',commit:{message:'doc',author:{name:'Auteur',date:'2026-11-08T08:00:00Z'}},html_url:'https://github.com/demo/doc/commit/abc1234'}]));else process.exit(1);\n`, { mode: 0o700 });
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
  const SECTION = "document.querySelector('[data-source-github]')";
  const ligne = (nom) => `document.querySelector('[data-depot=${JSON.stringify(nom)}]')`;
  const texteSection = () => app.ev(`${SECTION}?.innerText ?? ''`);
  const lireProjets = () => { try { return JSON.parse(readFileSync(path.join(DONNEES, "conversations.json"), "utf8")).projects ?? []; } catch { return []; } };
  const nouveau = async () => {
    await app.aller("/projets?nouveau=1");
    await app.quand(`!!document.querySelector('[data-nouveau-projet]')`);
    verifier(await app.ev(`document.querySelector('[data-nouveau-projet] [role="tab"][aria-selected="true"]')?.innerText.includes('Dépôt GitHub')`), "l'ajout s'ouvre sur les dépôts GitHub");
    if (!verifier(await app.quand(`/GitHub · demo/.test(${SECTION}?.innerText ?? '') && !!document.querySelector('[data-depot]')`, 10000), "le compte et ses dépôts s'affichent tout de suite")) throw new Error("Compte de test inaccessible");
  };
  await nouveau();
  verifier(!await app.ev(`!!document.querySelector('[data-nouveau-projet] form, input[placeholder^="propriétaire/dépôt"]')`), "aucun formulaire ni URL de dépôt à remplir");
  verifier(await app.ev(`[...document.querySelectorAll('[data-depot]')].map(l=>l.dataset.depot).join()`) === "demo/site,demo/inconnu,demo/doc", "les dépôts récemment modifiés d'abord");
  const infos = await app.ev(`${ligne("demo/site")}?.innerText ?? ''`);
  verifier(/Site de démonstration/.test(infos) && /Privé · Astro · modifié aujourd’hui/.test(infos), `chaque dépôt montre sa description et ses détails (${infos.replace(/\n/g, " | ")})`);
  await app.saisir('input[aria-label="Rechercher un dépôt"]', "introuvable");
  verifier(await app.quand(`/Aucun dépôt ne correspond/.test(${SECTION}?.innerText ?? '')`), "la recherche vide est expliquée");
  await app.saisir('input[aria-label="Rechercher un dépôt"]', "démonstration");
  verifier(await app.quand(`document.querySelectorAll('[data-depot]').length === 1 && !!${ligne("demo/site")}`), "la recherche lit aussi la description");
  await app.saisir('input[aria-label="Rechercher un dépôt"]', "");
  await app.quand(`!!${ligne("demo/inconnu")}`);
  await app.cliquer("Ouvrir", ligne("demo/inconnu"));
  verifier(await app.quand(`/GitHub n’a pas confirmé/.test(${SECTION}?.innerText ?? '')`, 20000), "un échec de clonage reste affiché sans créer de projet");
  verifier(!lireProjets().some(p => p.depot === "demo/inconnu"), "aucun projet créé pour l'échec");
  verifier(await app.cliquer("Ouvrir", ligne("demo/site")), "un clic sur Ouvrir suffit");
  verifier(await app.quand(`location.pathname.startsWith('/projet') && new URLSearchParams(location.search).get('id') === 'site'`, 30000), "le dépôt s'ouvre comme projet sur le PC, sans formulaire");
  const suffixe = createHash("sha256").update("main").digest("hex").slice(0, 12);
  const clone = path.join(HOME, "KLYRA", "GitHub", "demo", `site-${suffixe}`);
  verifier(readFileSync(path.join(clone, "README.md"), "utf8").includes("Site de test"), "les vrais fichiers sont clonés dans un dossier automatique");
  verifier(await app.quand(`!!document.querySelector('[data-depot-projet]')`), "le dépôt et sa branche sont montrés dans le projet");
  verifier(await app.quand(`document.querySelector('main h1')?.innerText.includes('Site de démonstration')`), "la description GitHub sert de ligne au projet");
  writeFileSync(path.join(auteur, "README.md"), "# Nouveauté\n"); g(auteur, "add", "."); g(auteur, "commit", "-m", "suite"); g(auteur, "push", "origin", "main");
  await app.cliquer("Récupérer les nouveautés");
  verifier(await app.quand(`/Nouveautés récupérées/.test(document.querySelector('[data-depot-projet]')?.innerText ?? '')`, 20000), "les nouveautés sont récupérées");
  verifier(readFileSync(path.join(clone, "README.md"), "utf8").includes("Nouveauté"), "le nouveau commit est bien dans les fichiers");
  await attendre(1200);
  const projet = lireProjets().find(p => p.id === "site");
  verifier(projet?.githubConnecte === true && projet.depot === "demo/site" && projet.subtitle === "Site de démonstration" && projet.previewUrl === "demo.example.com", "le projet garde le dépôt, sa description et son site");

  await nouveau();
  verifier(/Déjà ouvert/.test(await app.ev(`${ligne("demo/site")}?.innerText ?? ''`)), "un dépôt déjà ouvert est signalé");
  verifier(await app.cliquer("Rouvrir", ligne("demo/site")), "« Rouvrir » sur un dépôt déjà ouvert");
  verifier(await app.quand(`new URLSearchParams(location.search).get('id') === 'site'`, 10000), "« Rouvrir » mène au projet existant, sans doublon");
  verifier(lireProjets().filter(p => p.depot === "demo/site").length === 1, "toujours un seul projet pour ce dépôt");

  await nouveau();
  await app.ev(`${ligne("demo/site")}?.querySelector('button[aria-label^="Ouvrir une autre branche"]')?.click()`);
  await app.quand(`!${ligne("demo/site")}?.querySelector('button[role="combobox"]')?.disabled`, 10000);
  await app.ev(`${ligne("demo/site")}?.querySelector('button[role="combobox"]')?.click()`);
  await app.quand(`!!document.querySelector('[role="option"]')`);
  verifier(await app.ev(`(() => {const b=[...document.querySelectorAll('[role="option"]')].find(x=>x.innerText.trim()==='dev');b?.click();return !!b;})()`), "une autre branche se choisit dans la ligne du dépôt");
  await attendre(300);
  await app.cliquer("Ouvrir cette branche", ligne("demo/site"));
  verifier(await app.quand(`new URLSearchParams(location.search).get('id') === 'site-dev'`, 30000), "l'autre branche s'ouvre comme un projet à part");
  const cloneDev = path.join(HOME, "KLYRA", "GitHub", "demo", `site-${createHash("sha256").update("dev").digest("hex").slice(0, 12)}`);
  verifier(g(cloneDev, "branch", "--show-current").trim() === "dev", "son clone est sur la branche choisie");
  await attendre(1200);
  verifier(lireProjets().find(p => p.id === "site-dev")?.name === "site (dev)", "la branche se lit dans le nom du projet");

  await app.aller("/projets");
  await app.quand(`!!document.querySelector('a[href="/projet?id=site-dev"]')`);
  const menu = async () => {
    await app.ev(`(() => { const a=[...document.querySelectorAll('main a[href="/projet?id=site-dev"]')].pop(); const r=a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+20})); })()`);
    return app.quand(`!!document.querySelector('[role="menu"]')`);
  };
  verifier(await menu(), "clic droit sur un projet : son menu");
  verifier(await app.cliquer("Épingler", "document.querySelector('[role=\"menu\"]')"), "« Épingler » dans le menu du projet");
  await attendre(1200);
  verifier(lireProjets().find(p => p.id === "site-dev")?.pinned === true, "le projet est épinglé depuis le clic droit");
  await menu();
  await app.cliquer("Retirer de l’app…", "document.querySelector('[role=\"menu\"]')");
  verifier(await app.quand(`!!document.querySelector('[role="alertdialog"]')`), "retirer demande confirmation");
  verifier(await app.cliquer("Retirer", "document.querySelector('[role=\"alertdialog\"]')"), "« Retirer » confirme");
  await attendre(1200);
  verifier(!lireProjets().some(p => p.id === "site-dev"), "le projet est retiré de l'app");
  verifier(g(cloneDev, "branch", "--show-current").trim() === "dev", "son dossier reste sur la machine");

  /* La puce « Dépôt » du chat d'un agent : un dépôt pas encore ouvert devient un projet, et le message y ouvre une conversation. */
  await app.aller("/chat?id=dm-principal");
  await app.quand(`!!document.querySelector('main button[role="combobox"][aria-label="Dépôt"]')`);
  verifier(await app.ev(`document.querySelector('main button[role="combobox"][aria-label="Dépôt"]')?.innerText.includes('Sans dépôt')`), "le chat d'un agent a une puce « Dépôt », vide au départ");
  await app.ev(`(() => { const b = document.querySelector('main button[role="combobox"][aria-label="Dépôt"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); })()`);
  verifier(await app.quand(`[...document.querySelectorAll('[role="option"]')].some((o) => o.innerText.includes('demo/doc · GitHub'))`, 15000), "la puce liste les projets ouverts et les dépôts GitHub à ouvrir");
  const options = await app.ev(`[...document.querySelectorAll('[role="option"]')].map((o) => o.innerText.trim())`);
  verifier(options.includes("site") && !options.some((o) => o.startsWith("demo/site")), `un dépôt déjà ouvert n'apparaît qu'une fois, comme projet (${options.join(" | ")})`);
  await app.ev(`[...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.includes('demo/doc · GitHub')).click()`);
  await app.quand(`document.querySelector('main textarea[aria-label="Message"]')?.placeholder.includes('dans doc')`);
  verifier(await app.ev(`document.querySelector('main textarea[aria-label="Message"]')?.placeholder.includes('Nouvelle conversation')`), "le champ dit qu'une nouvelle conversation s'ouvrira dans ce dépôt");
  await app.saisir('main textarea[aria-label="Message"]', "Que contient ce dépôt ?");
  await attendre(300);
  verifier(await app.ev(`(() => { const b = document.querySelector('main textarea[aria-label="Message"]').closest('form').querySelector('button[type="submit"]'); if (!b || b.disabled) return false; b.click(); return true; })()`), "le message part d'un clic sur Envoyer");
  verifier(await app.quand(`location.pathname === '/chat' && !location.search.includes('dm-principal')`, 30000), "l'envoi ouvre une conversation à part");
  await attendre(1500);
  const doc = lireProjets().find((p) => p.depot === "demo/doc");
  verifier(!!doc && doc.githubConnecte === true && doc.subtitle === "La documentation", "le dépôt est devenu un projet, sans formulaire");
  verifier(readFileSync(path.join(HOME, "KLYRA", "GitHub", "demo", `doc-${suffixe}`, "README.md"), "utf8").includes("Documentation"), "le dépôt est cloné sur la machine de la conversation");
  const donnees = JSON.parse(readFileSync(path.join(DONNEES, "conversations.json"), "utf8"));
  const conv = donnees.chats.find((c) => c.projectId === doc?.id);
  verifier(!!conv && conv.kind === "equipe" && JSON.stringify(conv.roleIds) === '["principal"]', "la conversation appartient au projet, avec l'agent du chat");
  verifier(donnees.messages.some((m) => m.chatId === conv?.id && m.author.kind === "user" && m.parts.some((p) => p.type === "text" && p.text === "Que contient ce dépôt ?")), "le message part dans la nouvelle conversation");
  verifier(!donnees.messages.some((m) => m.chatId === "dm-principal" && m.parts.some((p) => p.type === "text" && p.text === "Que contient ce dépôt ?")), "le chat de l'agent n'a pas reçu ce message");
  verifier(await app.quand(`!!document.querySelector('[data-panneau-projet] [data-conversation=${JSON.stringify(conv?.id ?? "")}]')`), "la conversation apparaît dans le panneau du projet");
  verifier(await app.quand(`document.querySelector('main header h1') && !!document.querySelector('main header button[aria-label^="Ouvrir le panneau de"]')`), "la conversation de projet a l'en-tête d'un chat d'agent");

  /* L'onglet Git du panneau : le dépôt, les changements et leurs différences, GitHub, publier. */
  const PANNEAU = 'aside[aria-label="Panneau de la conversation"]';
  if (!(await app.ev(`!!document.querySelector(${JSON.stringify(PANNEAU)})`))) await app.ev(`document.querySelector('main header button[aria-label^="Ouvrir le panneau ("]')?.click()`);
  await app.quand(`!!document.querySelector(${JSON.stringify(PANNEAU)})`);
  const cloneDoc = path.join(HOME, "KLYRA", "GitHub", "demo", `doc-${suffixe}`);
  writeFileSync(path.join(cloneDoc, "README.md"), "# Documentation\nUne ligne de plus\n");
  verifier(await app.ev(`(() => { const t = [...document.querySelectorAll(${JSON.stringify(PANNEAU + ' [role="tab"]')})].find((o) => o.innerText.trim() === 'Git'); t?.click(); return !!t; })()`), "le panneau d'une conversation de projet a un onglet Git");
  verifier(await app.quand(`document.querySelector('[data-vue-git]')?.innerText.includes('demo/doc')`), "onglet Git : le dépôt du projet");
  verifier(await app.quand(`document.querySelector('[data-changements]')?.innerText.includes('README.md')`, 10000), "le fichier modifié apparaît dans les changements");
  await app.ev(`[...document.querySelectorAll('[data-changements] button[aria-expanded]')].find((b) => b.innerText.includes('README.md'))?.click()`);
  verifier(await app.quand(`document.querySelector('[data-changements]')?.innerText.includes('Une ligne de plus')`), "ses différences s'affichent, ligne à ligne");
  verifier(await app.quand(`document.querySelector('[data-tests-github="echec"]')?.innerText.includes('1 en échec') && !!document.querySelector('[data-pull-requests]')?.innerText.includes('Première PR')`, 15000), "les tests et les pull requests sont lus sur GitHub");
  verifier(await app.cliquer("Publier", "document.querySelector('[data-vue-git]')"), "« Publier » depuis l'onglet Git");
  await app.quand(`!!document.querySelector(${JSON.stringify(PANNEAU + " textarea")})`);
  await app.saisir(`${PANNEAU} textarea`, "Complète la documentation");
  verifier(await app.cliquer("Commit et push", `document.querySelector(${JSON.stringify(PANNEAU)})`), "commit et envoi");
  verifier(await app.quand(`document.querySelector(${JSON.stringify(PANNEAU)})?.innerText.includes('C’est poussé sur main')`, 30000), "publier passe par la connexion GitHub de la machine");
  verifier(g(nuDoc, "log", "-1", "--format=%s|%ae", "main").trim() === "Complète la documentation|42+demo@users.noreply.github.com", "le commit est sur GitHub, signé du compte connecté");

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
  await nouveau();
  verifier((await texteSection()).includes('sur ce VPS'), "l'écran indique que le clone sera sur le VPS");
  verifier(!/Déjà ouvert/.test(await app.ev(`${ligne("demo/site")}?.innerText ?? ''`)), "le projet du PC ne compte pas comme déjà ouvert sur le VPS");
  verifier(await app.cliquer("Ouvrir", ligne("demo/site")), "un clic sur Ouvrir, sur le VPS aussi");
  verifier(await app.quand(`location.pathname.startsWith('/projet') && location.search.includes('id=site')`, 30000), "le projet GitHub s'ouvre sur le VPS");
  verifier(await app.quand(`/Sur VPS GitHub test/.test(document.querySelector('main')?.innerText ?? '')`), "le projet du VPS dit où il vit, sans son chemin brut");
  const cloneVps = path.join(VPS, "projets", "GitHub", "demo", `site-${suffixe}`);
  verifier(readFileSync(path.join(cloneVps, "README.md"), "utf8").includes("Nouveauté"), "le dépôt est réellement cloné sur le serveur choisi");
  /* Sur le VPS aussi : une conversation du projet, son onglet Git lit le clone du serveur. */
  writeFileSync(path.join(cloneVps, "README.md"), "# Nouveauté\nModifié sur le VPS\n");
  await app.saisir('main textarea[aria-label="Message"]', "Bonjour");
  await attendre(300);
  await app.ev(`document.querySelector('main textarea[aria-label="Message"]').closest('form').querySelector('button[type="submit"]').click()`);
  verifier(await app.quand(`location.pathname === '/chat'`, 15000), "VPS : le premier message crée la conversation du projet");
  await attendre(1500);
  const memeDepot = lireProjets().filter((p) => p.depot === "demo/site").map((p) => `${p.id}@${p.lieu ?? "pc"}`).sort().join(" ");
  verifier(memeDepot === `site-2@${adresse} site@pc`, `le même dépôt sur le PC et le VPS : deux projets, jamais l'un écrasé par l'autre (${memeDepot})`);
  const PANNEAU_VPS = 'aside[aria-label="Panneau de la conversation"]';
  if (!(await app.ev(`!!document.querySelector(${JSON.stringify(PANNEAU_VPS)})`))) await app.ev(`document.querySelector('main header button[aria-label^="Ouvrir le panneau ("]')?.click()`);
  await app.quand(`!!document.querySelector(${JSON.stringify(PANNEAU_VPS)})`);
  await app.ev(`[...document.querySelectorAll(${JSON.stringify(PANNEAU_VPS + ' [role="tab"]')})].find((o) => o.innerText.trim() === 'Git')?.click()`);
  verifier(await app.quand(`document.querySelector('[data-changements]')?.innerText.includes('README.md')`, 15000), "VPS : l'onglet Git montre le fichier modifié sur le serveur");
  await app.ev(`[...document.querySelectorAll('[data-changements] button[aria-expanded]')].find((b) => b.innerText.includes('README.md'))?.click()`);
  verifier(await app.quand(`document.querySelector('[data-changements]')?.innerText.includes('Modifié sur le VPS')`, 15000), "VPS : ses différences sont lues sur le serveur");
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
