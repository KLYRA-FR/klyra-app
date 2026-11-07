/** Mode test public : vrai export et vrais IPC, profil et HOME jetables, aucun fournisseur réel. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { attendre, lancerApp } from "./pilote-app.mjs";

const tmp = mkdtempSync(path.join(os.tmpdir(), "klyra-mode-onboarding-"));
const home = path.join(tmp, "home"), donnees = path.join(tmp, "donnees"), journal = path.join(tmp, "ipc.txt");
mkdirSync(path.join(home, ".claude", "agents"), { recursive: true });
mkdirSync(donnees, { recursive: true });
writeFileSync(journal, "");
const verifier = (condition, texte) => { assert.ok(condition, texte); console.log(`OK ${texte}`); };
const surveilles = ["mes-agents.json", "agents-meta.json", "conversations.json", "prise-en-main.json", "reglages.json"];
const fichiers = () => Object.fromEntries(surveilles.map((f) => [f, existsSync(path.join(donnees, f)) ? readFileSync(path.join(donnees, f), "utf8") : null]));
let app;
const portLibre = createServer();
await new Promise((r) => portLibre.listen(0, "127.0.0.1", r));
const port = portLibre.address().port;
await new Promise((r) => portLibre.close(r));
const cliquer = async (libelle) => {
  const cible = JSON.stringify(libelle);
  assert.ok(await app.quand(`[...document.querySelectorAll('button, a')].some(b => b.innerText.trim() === ${cible} && !b.disabled)`), `bouton disponible : ${libelle}`);
  assert.ok(await app.cliquer(libelle), `clic sur ${libelle}`);
};
try {
  app = await lancerApp({ port, entree: "scripts/faux-mode-onboarding.cjs", env: {
    HOME: home, USERPROFILE: home, KLYRA_USER_DATA: donnees, CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CODEX_HOME: path.join(home, ".codex"), KLYRA_TEST_MODE_JOURNAL: journal,
  } });
  await app.aller("/reglages?section=general");
  verifier(await app.quand("document.getElementById('tester-prise-en-main')"), "le mode test est accessible depuis Réglages → Général");
  await attendre(1200);
  const avant = fichiers();
  writeFileSync(journal, "");
  await cliquer("Lancer le mode test");
  verifier(await app.quand("document.querySelector('[data-prise-test] [data-prise-etape=assistant]')"), "le test commence au nom de l’assistant");
  verifier(await app.ev("document.body.innerText.includes('Installation, connexion et réponse simulées')"), "la simulation est annoncée en permanence");
  await app.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  verifier(await app.ev("document.documentElement.scrollWidth <= innerWidth"), "le bandeau et le parcours tiennent à 390 px");
  await app.send("Emulation.clearDeviceMetricsOverride");
  await app.saisir(".prise-nommage input", "Assistant de test");
  await cliquer("Créer mon assistant");
  verifier(await app.quand("document.querySelector('[data-prise-etape=ia]')"), "nommer mène au choix d’IA");
  await app.ev("[...document.querySelectorAll('.prise-fournisseur')].find(b=>b.querySelector('strong')?.textContent==='Claude').click()");
  await cliquer("Installer Claude");
  verifier(await app.quand("document.body.innerText.includes('À connecter')"), "l’installation simulée mène à la connexion");
  await cliquer("Connecter mon compte");
  verifier(await app.quand("document.body.innerText.includes('Connecté')"), "la connexion simulée est visible sans authentification");
  await cliquer("Continuer");
  verifier(await app.quand("document.querySelector('[data-prise-etape=acces]')"), "le test atteint les accès");
  await app.ev("[...document.querySelectorAll('.prise-acces button')].find(b=>b.querySelector('strong')?.textContent==='Me demander avant d’agir').click()");
  await cliquer("Continuer");
  verifier(await app.quand("document.querySelector('[data-prise-etape=demande]')"), "les accès mènent à la demande");
  await cliquer("Retour");
  verifier(await app.quand("document.querySelector('[data-prise-etape=acces] button[aria-pressed=true]')?.innerText.includes('Me demander')"), "les choix restent dans le test quand on revient en arrière");
  await cliquer("Continuer");
  verifier(await app.quand("document.querySelector('.prise-demande textarea')"), "la demande est prête après le retour");
  await app.saisir(".prise-demande textarea", "Ceci est une demande locale de test.");
  await cliquer("Commencer la conversation");
  const conversation = await app.quand("document.querySelector('[data-prise-etape=conversation]')");
  if (!conversation) console.log(await app.ev("document.body.innerText"), app.erreurs);
  verifier(conversation, "la cinquième étape affiche la conversation simulée");
  verifier(await app.ev("document.querySelector('.prise-test-messages')?.innerText.includes('Ceci est une demande locale de test.')"), "la demande apparaît dans l’aperçu");
  verifier(await app.ev("document.querySelector('.prise-test-messages')?.innerText.includes('Réponse simulée')"), "la réponse est explicitement fictive");
  if (process.env.KLYRA_TEST_PREUVES) {
    mkdirSync(process.env.KLYRA_TEST_PREUVES, { recursive: true });
    const r = await app.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(process.env.KLYRA_TEST_PREUVES, "mode-test-conversation.png"), Buffer.from(r.data, "base64"));
  }
  await cliquer("Recommencer le test");
  verifier(await app.quand("document.querySelector('.prise-nommage input')?.value === ''"), "recommencer remet uniquement la simulation à zéro");
  const appelsPendantTest = readFileSync(journal, "utf8");
  await app.touche("Escape", "Escape", 27);
  verifier(await app.quand("!document.querySelector('[data-prise-test]') && document.getElementById('tester-prise-en-main')"), "Échap rend les réglages");
  verifier(await app.quand("document.activeElement?.id === 'tester-prise-en-main'"), "le focus revient au bouton de lancement");
  await cliquer("Lancer le mode test");
  await cliquer("Garder « Assistant »");
  await app.quand("document.querySelector('[data-prise-etape=ia]')");
  await app.ev("[...document.querySelectorAll('.prise-fournisseur')].find(b=>b.querySelector('strong')?.textContent==='ChatGPT').click()");
  await cliquer("Installer ChatGPT");
  await cliquer("Quitter le mode test");
  await attendre(700);
  verifier(await app.quand("!document.querySelector('[data-prise-test]')"), "Quitter fonctionne pendant une installation simulée et annule son attente");
  assert.deepEqual(fichiers(), avant, "conversations, assistant, préférences, accès et progression réelle inchangés");
  console.log("OK les fichiers du vrai profil sont identiques avant et après le test");
  const interdits = appelsPendantTest.split("\n").filter((c) => /^(prise-en-main:ecrire|agents:mes:assistant|agents:meta:write|claude:(stream|run)|moteurs:(installer|connecter|cle|compte))/.test(c));
  assert.deepEqual(interdits, [], "aucun appel aux comptes, installations, agents ou stockage du guide");
  verifier(!existsSync(path.join(home, ".klyra", "moteurs")), "aucun programme installé dans le HOME du test");
  verifier(app.erreurs.length === 0, `aucune erreur dans l’interface : ${app.erreurs.join('; ')}`);
} finally {
  if (app) await app.fermer();
  rmSync(tmp, { recursive: true, force: true });
}
