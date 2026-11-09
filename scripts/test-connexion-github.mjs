/** La connexion de KLYRA à GitHub dans la vraie app, depuis les trois endroits où on la demande : Projets,
 * la puce « Dépôt » d'un chat et la carte GitHub de la Marketplace. GitHub CLI simulé (code et compte fictifs),
 * aucun compte réel, aucun navigateur ouvert (l'ouverture de la page est notée par le harnais).
 * Prérequis : build et build:electron. Linux : xvfb-run -a node scripts/test-connexion-github.mjs --no-sandbox */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const { echecs, verifier } = verificateur();
const ROOT = path.resolve(import.meta.dirname, "..");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-connexion-github-"));
const HOME = path.join(TMP, "pc");
const DONNEES = path.join(TMP, "profil");
const BIN = path.join(TMP, "bin");
for (const d of [HOME, DONNEES, BIN]) mkdirSync(d, { recursive: true });
const AUTORISE = path.join(TMP, "autorise");
const REFUS = path.join(TMP, "refus");
const PAGES = path.join(TMP, "pages-ouvertes");
const CODES = ["WDJB-MJHT", "KQPX-7Z2M", "HTRB-4PLC", "ZMCN-8RVA"];
const COMPTEUR = path.join(TMP, "logins");

/* GitHub CLI fictif : chaque `auth login` donne le code suivant puis attend l'autorisation (ou le refus) du test. */
writeFileSync(path.join(BIN, "gh"), `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
if (a[0] === '--version') console.log('gh version test');
else if (a[0] === 'auth' && a[1] === 'login') {
  const n = fs.existsSync(${JSON.stringify(COMPTEUR)}) ? Number(fs.readFileSync(${JSON.stringify(COMPTEUR)}, 'utf8')) : 0;
  fs.writeFileSync(${JSON.stringify(COMPTEUR)}, String(n + 1));
  const codes = ${JSON.stringify(CODES)};
  process.stderr.write('\\n! First copy your one-time code: ' + codes[n % codes.length] + '\\nOpen this URL to continue in your web browser: https://github.com/login/device\\n');
  const t = setInterval(() => {
    if (fs.existsSync(${JSON.stringify(REFUS)})) { fs.rmSync(${JSON.stringify(REFUS)}); clearInterval(t); process.stderr.write('failed to authenticate via web browser: access_denied\\n'); process.exit(1); }
    if (fs.existsSync(${JSON.stringify(AUTORISE)})) { fs.rmSync(${JSON.stringify(AUTORISE)}); clearInterval(t); process.stderr.write('✓ Authentication complete.\\n'); process.exit(0); }
  }, 100);
} else if (a[0] === 'auth' && a[1] === 'token') console.log('jeton-fictif-du-test');
else if (a.some((x) => x.startsWith('/user/repos'))) console.log(JSON.stringify([[{ full_name: 'demo/site', private: true, default_branch: 'main', description: 'Site de démonstration', pushed_at: new Date().toISOString() }]]));
else if (a.includes('/user')) console.log(JSON.stringify({ login: 'demo' }));
else process.exit(1);
`, { mode: 0o700 });

/* Le harnais seul : un coffre en clair (pas de trousseau sous xvfb) et l'ouverture du navigateur notée au lieu d'être faite. */
const entree = path.join(TMP, "fixture.cjs");
writeFileSync(entree, `const { app, safeStorage, shell } = require('electron');
const fs = require('node:fs');
app.setPath('userData', ${JSON.stringify(DONNEES)});
shell.openExternal = async (url) => { fs.appendFileSync(${JSON.stringify(PAGES)}, url + '\\n'); };
app.whenReady().then(() => {
  safeStorage.setUsePlainTextEncryption(true);
  safeStorage.isEncryptionAvailable = () => true;
  safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret';
});
require(${JSON.stringify(path.join(ROOT, "dist-electron", "main.js"))});`);

const pages = () => (existsSync(PAGES) ? readFileSync(PAGES, "utf8").trim().split("\n").filter(Boolean) : []);
const compte = () => existsSync(path.join(DONNEES, "github-projets.json"));

let app;
try {
  app = await lancerApp({ env: { HOME, PATH: `${BIN}${path.delimiter}${process.env.PATH}`, KLYRA_USER_DATA: DONNEES }, port: 9393, entree });
  const DIALOGUE = `document.querySelector('[role="dialog"]')`;
  const texteDialogue = () => app.ev(`${DIALOGUE}?.innerText ?? ''`);

  /* 1. La puce « Dépôt » d'un chat : GitHub manque, la liste propose de le connecter, sur place. */
  await app.aller("/chat?id=dm-principal");
  const PUCE = `document.querySelector('main button[role="combobox"][aria-label="Dépôt"]')`;
  await app.quand(`!!${PUCE}`);
  const ouvrirPuce = () => app.ev(`(() => { const b = ${PUCE}; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); })()`);
  await ouvrirPuce();
  const LIGNE = `[...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.includes('Connecter GitHub'))`;
  verifier(await app.quand(`!!${LIGNE} && ${LIGNE}.getAttribute('aria-disabled') !== 'true'`, 15000), "sans connexion, la puce propose « Connecter GitHub… », choisissable (plus de ligne grisée)");
  await app.ev(`${LIGNE}.click()`);
  verifier(await app.quand(`/Connecter GitHub/.test(${DIALOGUE}?.innerText ?? '')`), "la connexion s'ouvre sur place, dans une fenêtre");
  verifier(await app.quand(`${DIALOGUE}?.querySelector('[data-code-github]')?.innerText.trim() === '${CODES[0]}'`, 15000), "le code donné par GitHub s'affiche");
  for (let i = 0; i < 20 && !pages().length; i++) await attendre(250);
  await attendre(500);
  verifier(pages().join() === "https://github.com/login/device", `la page GitHub s'ouvre d'elle-même, une fois (${pages().join(" ")})`);
  verifier(/Composio et le terminal ont la leur/.test(await texteDialogue()), "la fenêtre dit que ce n'est ni Composio ni le terminal");
  verifier(await app.cliquer("Rouvrir la page GitHub", DIALOGUE), "la page se rouvre d'un clic");
  await attendre(400);
  verifier(pages().length === 2, "« Rouvrir la page GitHub » rouvre la même page");

  /* Refus sur GitHub : la raison s'affiche, on peut réessayer avec un nouveau code. */
  writeFileSync(REFUS, "");
  verifier(await app.quand(`/refusée sur GitHub/.test(${DIALOGUE}?.innerText ?? '')`, 15000), "un refus sur GitHub est dit en clair");
  verifier(!compte(), "rien n'est enregistré après un refus");
  verifier(await app.cliquer("Réessayer", DIALOGUE), "« Réessayer » relance la connexion");
  verifier(await app.quand(`${DIALOGUE}?.querySelector('[data-code-github]')?.innerText.trim() === '${CODES[1]}'`, 15000), "un nouveau code s'affiche");
  for (let i = 0; i < 20 && pages().length < 3; i++) await attendre(250);
  verifier(pages().length === 3, "la page s'ouvre aussi pour le nouveau code");

  /* Autorisé : la fenêtre se ferme, la puce montre les dépôts. */
  writeFileSync(AUTORISE, "");
  verifier(await app.quand(`!${DIALOGUE}`, 15000), "une fois autorisé, la fenêtre se ferme d'elle-même");
  verifier(compte(), "la connexion est enregistrée (chiffrée) dans le profil");
  await ouvrirPuce();
  verifier(await app.quand(`[...document.querySelectorAll('[role="option"]')].some((o) => o.innerText.includes('demo/site · GitHub'))`, 15000), "la puce montre maintenant les dépôts du compte");
  await app.touche("Escape", "Escape", 27);

  /* 2. La Marketplace : la carte GitHub montre la connexion de KLYRA, et Composio à part pour les outils des agents. */
  await app.aller("/marketplace");
  const CARTE = `document.querySelector('[data-app-mcp="github"]')`;
  await app.quand(`!!${CARTE}`);
  verifier(await app.quand(`/Connecté/.test(${CARTE}?.innerText ?? '') && /demo/.test(${CARTE}?.innerText ?? '')`, 15000), "la carte GitHub dit le compte connecté à KLYRA");
  verifier(/Outils des agents/.test(await app.ev(`${CARTE}?.innerText ?? ''`)), "les outils des agents (Composio) sont une ligne à part");
  verifier(await app.cliquer("Détails", CARTE), "« Détails » ouvre la connexion");
  verifier(await app.quand(`/GitHub est connecté · demo/.test(${DIALOGUE}?.innerText ?? '')`), "la fenêtre montre le compte, sans relancer d'autorisation");
  verifier(await app.cliquer("Changer de compte", DIALOGUE), "« Changer de compte » depuis la Marketplace");
  verifier(await app.quand(`${DIALOGUE}?.querySelector('[data-code-github]')?.innerText.trim() === '${CODES[2]}'`, 15000), "un nouveau code pour l'autre compte");
  verifier(!compte(), "l'ancien compte est retiré");
  verifier(await app.cliquer("Annuler", `${DIALOGUE}.querySelector('[data-connexion-github]')`), "« Annuler » sous le code");
  verifier(await app.quand(`/GitHub n’est pas connecté/.test(${DIALOGUE}?.innerText ?? '') && !${DIALOGUE}.querySelector('[data-code-github]')`, 10000), "annuler arrête l'autorisation, la fenêtre propose de reconnecter");
  await app.touche("Escape", "Escape", 27);
  verifier(await app.quand(`!${DIALOGUE} && [...${CARTE}.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Connecter')`, 10000), "la carte propose de nouveau « Connecter »");

  /* 3. Projets › Nouveau projet : le même code, la page ouverte d'elle-même. */
  await app.aller("/projets?nouveau=1");
  const SECTION = `document.querySelector('[data-source-github]')`;
  await app.quand(`!!${SECTION}`);
  const avant = pages().length;
  verifier(await app.cliquer("Connecter GitHub", SECTION), "« Connecter GitHub » dans Projets");
  verifier(await app.quand(`!!${SECTION}?.querySelector('[data-code-github]')`, 15000), "le code s'affiche dans Projets");
  for (let i = 0; i < 20 && pages().length === avant; i++) await attendre(250);
  verifier(pages().length === avant + 1, "la page GitHub s'ouvre d'elle-même depuis Projets");
  writeFileSync(AUTORISE, "");
  verifier(await app.quand(`/GitHub · demo/.test(${SECTION}?.innerText ?? '') && !!document.querySelector('[data-depot="demo/site"]')`, 15000), "autorisé : le compte et ses dépôts s'affichent");
  verifier(!app.erreurs.length, `aucune erreur dans la page (${app.erreurs.join(" | ")})`);
} catch (e) {
  verifier(false, e instanceof Error ? e.message : String(e));
} finally {
  await app?.fermer();
  rmSync(TMP, { recursive: true, force: true });
}
if (echecs.length) process.exit(1);
console.log("Tout passe.");
