/** Vraie interface Electron, profil jetable, aucune IA ni connexion réelle. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { attendre, lancerApp } from "./pilote-app.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "klyra-visite-"));
const maison = path.join(tmp, "home"), donnees = path.join(tmp, "donnees"), journal = path.join(tmp, "ipc.txt");
mkdirSync(path.join(maison, ".claude", "agents"), { recursive: true });
mkdirSync(donnees, { recursive: true });
writeFileSync(journal, "");
writeFileSync(path.join(donnees, "mes-agents.json"), JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Assistant de démonstration", teinte: null }, agents: {} }));
const onboarding = { version: 1, etape: "termine", mode: "guide", fournisseur: "codex", brouillon: "", conversation: { id: "dm-principal", debut: new Date().toISOString() } };
writeFileSync(path.join(donnees, "prise-en-main.json"), JSON.stringify(onboarding));
const serveur = createServer();
await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
const port = serveur.address().port;
await new Promise((r) => serveur.close(r));
let app;
const verifier = (ok, texte) => { assert.ok(ok, texte); console.log(`OK ${texte}`); };
const cliquer = async (texte) => {
  verifier(await app.quand(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === ${JSON.stringify(texte)} && !b.disabled)`), `bouton disponible : ${texte}`);
  assert.ok(await app.cliquer(texte));
};
const attendreEtape = async (id) => {
  const prete = await app.quand(`document.querySelector('[data-visite-etape="${id}"]') && [...document.querySelectorAll('.visite-actions button')].some(b => ['Suivant', 'Terminer'].includes(b.innerText) && !b.disabled)`);
  if (!prete) console.log("Diagnostic visite", await app.ev("({ url: location.pathname + location.search, etape: document.querySelector('.visite-dialogue')?.dataset.visiteEtape })"), app.erreurs);
  return prete;
};
const capture = async (nom) => {
  if (!process.env.KLYRA_TEST_PREUVES) return;
  mkdirSync(process.env.KLYRA_TEST_PREUVES, { recursive: true });
  await attendre(250);
  const r = await app.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(process.env.KLYRA_TEST_PREUVES, `${nom}.png`), Buffer.from(r.data, "base64"));
};
const surveilles = ["mes-agents.json", "agents-meta.json", "conversations.json", "prise-en-main.json", "reglages.json"];
const fichiers = () => Object.fromEntries(surveilles.map((f) => [f, existsSync(path.join(donnees, f)) ? readFileSync(path.join(donnees, f), "utf8") : null]));

try {
  app = await lancerApp({ port, entree: "scripts/faux-mode-onboarding.cjs", env: {
    HOME: maison, USERPROFILE: maison, KLYRA_USER_DATA: donnees, CLAUDE_CONFIG_DIR: path.join(maison, ".claude"), CODEX_HOME: path.join(maison, ".codex"), KLYRA_TEST_MODE_JOURNAL: journal,
  } });
  verifier(await app.quand("document.querySelector('[data-visite-etape=invitation][open]')"), "une fin d’onboarding propose la visite");
  await capture("01-invitation");
  await cliquer("Plus tard");
  await app.aller("/reglages?section=general");
  verifier(await app.quand("document.getElementById('revoir-visite-guidee')"), "l’aide permet de relancer le tutoriel");
  verifier(await app.ev("!document.querySelector('.visite-dialogue')"), "Plus tard ne relance pas automatiquement la visite");
  await attendre(600);
  const avant = fichiers();
  writeFileSync(journal, "");
  await cliquer("Revoir le tutoriel");
  verifier(await attendreEtape("accueil"), "la visite affiche la vraie page Accueil");
  verifier(await app.quand("document.querySelector('.visite-halo')?.getBoundingClientRect().width > 0"), "le repère de navigation est mis en lumière");
  await capture("02-accueil");
  verifier(await app.ev("document.querySelector('.visite-dialogue').contains(document.activeElement)"), "le focus entre dans la visite");
  for (let i = 0; i < 8; i++) await app.touche("Tab", "Tab", 9);
  verifier(await app.ev("document.querySelector('.visite-dialogue').contains(document.activeElement)"), "Tab reste dans la visite");
  await cliquer("Suivant");
  verifier(await attendreEtape("chats"), "Suivant ouvre les conversations");
  await cliquer("Précédent");
  verifier(await attendreEtape("accueil"), "Précédent retrouve l’accueil");
  await cliquer("Suivant");
  await attendreEtape("chats");
  await cliquer("Suivant");
  verifier(await attendreEtape("agents"), "la visite présente les agents");
  await app.touche("Escape", "Escape", 27);
  verifier(await app.quand("!document.querySelector('.visite-dialogue') && location.search === '?section=general'"), "Échap ferme et retrouve la page de départ");
  verifier(await app.quand("document.activeElement?.id === 'revoir-visite-guidee'"), "le focus revient au déclencheur");
  await app.send("Page.reload");
  verifier(await app.quand("document.getElementById('revoir-visite-guidee')?.innerText === 'Reprendre la visite'"), "la progression survit au rechargement");
  await cliquer("Reprendre la visite");
  verifier(await attendreEtape("agents"), "la reprise retrouve l’étape quittée");

  for (const id of ["tickets", "planning", "automatisations", "artefacts", "projets", "connexions", "serveurs", "reglages"]) {
    await cliquer("Suivant");
    verifier(await attendreEtape(id), `la vraie page ${id} est prête`);
    verifier(await app.quand("document.querySelector('.visite-halo')?.getBoundingClientRect().width > 0"), `la zone ${id} est mise en lumière`);
    if (["tickets", "artefacts", "connexions", "reglages"].includes(id)) await capture(`visite-${id}`);
  }
  for (const width of [1280, 768, 375]) {
    await app.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: false });
    await attendre(250);
    verifier(await app.ev("(() => { const c=document.querySelector('.visite-carte'), r=c.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && c.scrollWidth<=c.clientWidth; })()"), `carte lisible à ${width} px`);
    if (width === 375) await capture("visite-375px");
  }
  await app.send("Emulation.clearDeviceMetricsOverride");
  await app.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await cliquer("Terminer");
  verifier(await app.quand("!document.querySelector('.visite-dialogue') && document.getElementById('revoir-visite-guidee')?.innerText === 'Revoir le tutoriel'"), "Terminer rend l’aide disponible pour rejouer");
  await app.send("Page.reload");
  await app.quand("document.getElementById('revoir-visite-guidee')");
  verifier(await app.ev("!document.querySelector('.visite-dialogue')"), "une visite terminée ne réapparaît pas au prochain lancement");
  assert.deepEqual(fichiers(), avant, "visite sans modification des agents, conversations, accès ni onboarding");
  /* Lire l'état du compte (`moteurs:compte`) n'est ni une connexion ni une génération : à chaque lancement de l'app,
     les rechargements du test compris, le rail le lit pour ses anneaux d'utilisation dès qu'un moteur est installé. */
  const interdits = readFileSync(journal, "utf8").split("\n").filter((c) => /^(prise-en-main:ecrire|agents:mes:assistant|agents:meta:write|claude:(stream|run)|moteurs:(installer|connecter|cle))/.test(c));
  assert.deepEqual(interdits, [], "aucun appel de génération, installation ou connexion");
  console.log("OK aucun appel de génération, installation ou connexion");
  verifier(app.erreurs.length === 0, `aucune exception dans l’interface : ${app.erreurs.join('; ')}`);
  console.log("VISITE VÉRIFIÉE — onze pages, navigation, reprise, clavier, responsive et profil préservé.");
} finally {
  if (app) await app.fermer();
  rmSync(tmp, { recursive: true, force: true });
}
