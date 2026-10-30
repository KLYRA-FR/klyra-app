/**
 * Le délai entre deux liens de connexion, vu de l'écran Réglages › Équipe de l'app
 * de bureau (export statique), sur un profil temporaire et un backend Convex local
 * et jetable (jamais un vrai déploiement, jamais un vrai e-mail : adresses en
 * example.test, e-mails simulés). Double clic, rechargement, heure de l'ordinateur
 * avancée, redémarrage, adresse inconnue, autre adresse, réseau coupé.
 * Le délai lui-même (fin, quota horaire, appels directs) est testé côté serveur,
 * horloge simulée : `pnpm test:convex` (convex/limites.test.ts).
 * Prérequis : `pnpm build && pnpm build:electron`, et
 *   KLYRA_TEST_CONVEX_URL, KLYRA_TEST_CONVEX_ADMIN_KEY, KLYRA_TEST_CONVEX_SERVEUR (cf. scripts/test-profil.mjs).
 *   pnpm test:liens          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const APP = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-liens-"));
const DONNEES = path.join(TMP, "userdata");
const PORT = 9339;
const CONVEX = process.env.KLYRA_TEST_CONVEX_URL;
const CLE_ADMIN = process.env.KLYRA_TEST_CONVEX_ADMIN_KEY;
const SERVEUR = process.env.KLYRA_TEST_CONVEX_SERVEUR;
if (!CONVEX || !CLE_ADMIN || !SERVEUR) {
  console.log("Backend Convex local absent (KLYRA_TEST_CONVEX_URL, _ADMIN_KEY, _SERVEUR) : rien à tester.");
  process.exit(0);
}
const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = new ConvexHttpClient(CONVEX);
admin.setAdminAuth(CLE_ADMIN);
const recus = (email) => admin.query(makeFunctionReference("courriels:nombreCourrielsSimules"), { a: email });
const SUFFIXE = Math.random().toString(36).slice(2, 8);
const A = { email: `essai-liens-a-${SUFFIXE}@example.test`, nom: "Alice Liens" };
const B = { email: `essai-liens-b-${SUFFIXE}@example.test`, nom: "Bruno Liens" };
const C = { email: `essai-liens-c-${SUFFIXE}@example.test`, nom: "Chloé Liens" };
const INCONNUE = `inconnue-${SUFFIXE}@example.test`;

mkdirSync(DONNEES, { recursive: true });
const env = { ...process.env, HOME: path.join(TMP, "home"), KLYRA_USER_DATA: DONNEES, KLYRA_CONVEX_URL: CONVEX };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KLYRA_DEV_URL;

async function lancer() {
  const processus = spawn(ELECTRON, [".", `--remote-debugging-port=${PORT}`, ...process.argv.slice(2)], { cwd: APP, env, stdio: "ignore" });
  let cible;
  for (let i = 0; i < 60 && !cible; i++) {
    await attendre(500);
    cible = await fetch(`http://127.0.0.1:${PORT}/json`)
      .then((r) => r.json())
      .then((t) => t.find((x) => x.type === "page" && x.url.startsWith("app://")))
      .catch(() => undefined);
  }
  if (!cible) throw new Error("la fenêtre de l’app n’apparaît pas");
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const attente = {};
  const erreurs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") erreurs.push(m.params.exceptionDetails.exception?.description);
    attente[m.id]?.(m.result);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      attente[++id] = r;
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
  const pret = async () => {
    for (let i = 0; i < 40 && !(await ev("document.body?.innerText.length > 0 && !!window.klyra")); i++) await attendre(500);
  };
  await pret();
  return {
    erreurs,
    ev,
    async aller(chemin) {
      await ev(`window.next?.router ? window.next.router.push(${JSON.stringify(chemin)}) : (location.href = ${JSON.stringify(chemin)})`);
      await attendre(1500);
    },
    async recharger() {
      await send("Page.reload", {});
      await attendre(1500);
      await pret();
    },
    async quand(expression, ms = 20000) {
      for (let t = 0; t < ms; t += 250) {
        if (await ev(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return true;
        await attendre(250);
      }
      return false;
    },
    saisir: (selecteur, valeur) =>
      ev(`(() => { const el = document.querySelector(${JSON.stringify(selecteur)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(valeur)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`),
    /** La ligne de connexion : son titre, son explication, le bouton de renvoi. */
    connexion: () =>
      ev(`(() => {
        const ligne = document.querySelector('#reglage-compte-equipe');
        const renvoi = [...(ligne?.querySelectorAll('button') ?? [])].find((b) => b.innerText.startsWith('Renvoyer'));
        return { texte: ligne?.innerText ?? '', renvoi: renvoi?.innerText ?? null, actif: renvoi ? !renvoi.disabled : null };
      })()`),
    fermer() {
      ws.close();
      processus.kill();
      return new Promise((r) => processus.once("exit", r));
    },
  };
}

const ENTREE_EMAIL = 'input[aria-label="Adresse e-mail"]';
/** Le bouton « Recevoir un lien » cliqué `fois` fois de suite, sans attendre (double clic). */
const recevoir = (a, fois = 1) =>
  a.ev(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Recevoir un lien'); for (let i = 0; i < ${fois}; i++) b?.click(); return !!b; })()`);
const cliquerTexte = (a, texte) =>
  a.ev(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith(${JSON.stringify(texte)}) && !b.disabled); b?.click(); return !!b; })()`);
const secondes = (renvoi) => Number(renvoi?.match(/dans (\d+) s/)?.[1] ?? NaN);
/** Le texte de la ligne, l'adresse et le compte à rebours remplacés : pour comparer deux adresses. */
const neutre = (texte, email) => texte.replaceAll(email, "<adresse>").replace(/\d+ s\b/g, "<n> s");

let app;
try {
  await admin.mutation(makeFunctionReference("equipe:initialiser"), { admins: [A, B, C] });
  app = await lancer();
  await app.aller("/reglages?section=equipe");
  await app.quand(`document.querySelector('${ENTREE_EMAIL}')`);

  /* 1. Double clic : une seule demande, un seul e-mail, et le compte à rebours. */
  await app.saisir(ENTREE_EMAIL, A.email);
  await attendre(200);
  await recevoir(app, 2);
  await app.quand("document.querySelector('#reglage-compte-equipe')?.innerText.includes('un lien vient de partir')");
  await attendre(1500);
  let ligne = await app.connexion();
  verifier((await recus(A.email)) === 1, "double clic sur « Recevoir un lien » : un seul e-mail");
  verifier(ligne.actif === false && secondes(ligne.renvoi) > 50 && secondes(ligne.renvoi) <= 60, `le renvoi attend : « ${ligne.renvoi} », désactivé`);
  verifier(ligne.texte.includes("Tu pourras en demander un autre dans") && ligne.texte.includes("un par minute, cinq par heure au plus"), "l’écran dit quand redemander, et la règle");
  const texteA = ligne.texte;

  /* 2. Rechargement : le délai reste affiché. */
  await app.recharger();
  await app.aller("/reglages?section=equipe");
  await app.quand("document.querySelector('#reglage-compte-equipe')?.innerText.includes('un lien vient de partir')");
  ligne = await app.connexion();
  verifier(ligne.actif === false && secondes(ligne.renvoi) > 40, `après rechargement : « ${ligne.renvoi} », toujours désactivé`);

  /* 3. L'heure de l'ordinateur avancée de 2 minutes : l'écran se croit libre, le serveur refuse. */
  await app.ev("(() => { const vrai = Date.now.bind(Date); Date.now = () => vrai() + 120000; })()");
  await app.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Renvoyer' && !b.disabled)", 5000);
  await cliquerTexte(app, "Renvoyer");
  await app.quand("document.querySelector('#reglage-compte-equipe')?.innerText.includes('il y a peu')");
  ligne = await app.connexion();
  verifier((await recus(A.email)) === 1, "heure de l’ordinateur avancée : le serveur refuse, aucun nouvel e-mail");
  verifier(ligne.actif === false && /Renvoyer dans \d+ s/.test(ligne.renvoi ?? ""), `l’attente revient de la réponse du serveur : « ${ligne.renvoi} »`);

  /* 4. Redémarrage : la demande et son attente sont gardées. */
  await app.fermer();
  app = await lancer();
  await app.aller("/reglages?section=equipe");
  await app.quand("document.querySelector('#reglage-compte-equipe')?.innerText.includes(" + JSON.stringify(A.email) + ")");
  ligne = await app.connexion();
  verifier(ligne.texte.includes(A.email) && ligne.actif === false, `après redémarrage : demande gardée, « ${ligne.renvoi} »`);

  /* 5. Adresse inconnue : le même écran, le même délai, aucun e-mail. */
  await cliquerTexte(app, "Changer d’adresse");
  await app.quand(`document.querySelector('${ENTREE_EMAIL}')`);
  await app.saisir(ENTREE_EMAIL, INCONNUE);
  await attendre(200);
  await recevoir(app);
  await app.quand("document.querySelector('#reglage-compte-equipe')?.innerText.includes('un lien vient de partir')");
  await attendre(1200);
  ligne = await app.connexion();
  verifier((await recus(INCONNUE)) === 0, "adresse inconnue : aucun e-mail");
  verifier(neutre(ligne.texte, INCONNUE) === neutre(texteA, A.email), "adresse inconnue : exactement le même écran qu’une adresse invitée");
  verifier(ligne.actif === false && secondes(ligne.renvoi) > 50, `adresse inconnue : le même délai (« ${ligne.renvoi} »)`);

  /* 6. Une autre adresse n'est pas freinée par celle d'avant. */
  await cliquerTexte(app, "Changer d’adresse");
  await app.quand(`document.querySelector('${ENTREE_EMAIL}')`);
  await app.saisir(ENTREE_EMAIL, B.email);
  await attendre(200);
  await recevoir(app);
  await app.quand("document.querySelector('#reglage-compte-equipe')?.innerText.includes('un lien vient de partir')");
  await attendre(1200);
  verifier((await recus(B.email)) === 1, "une autre adresse reçoit son lien tout de suite");

  /* 7. Réseau coupé pendant la demande : elle attend, puis part une seule fois au retour. */
  await cliquerTexte(app, "Changer d’adresse");
  await app.quand(`document.querySelector('${ENTREE_EMAIL}')`);
  await app.saisir(ENTREE_EMAIL, C.email);
  await attendre(200);
  execSync(`${SERVEUR} stop`, { stdio: "ignore" });
  await recevoir(app, 2);
  await attendre(2500);
  const pendant = await app.ev("document.querySelector('main')?.innerText ?? ''");
  verifier(pendant.includes("Envoi…") && !pendant.includes(`Si ${C.email}`), "réseau coupé : la demande attend (« Envoi… »), rien n’est annoncé");
  execSync(`${SERVEUR} start`, { stdio: "ignore" });
  const partie = await app.quand(`document.querySelector('#reglage-compte-equipe')?.innerText.includes(${JSON.stringify(`Si ${C.email}`)})`, 60000);
  await attendre(1500);
  verifier(partie && (await recus(C.email)) === 1, "réseau rétabli : la demande part, un seul e-mail");

  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` (${app.erreurs.join(" | ")})` : ""}`);
} catch (e) {
  verifier(false, `le test a planté : ${e instanceof Error ? e.message : e}`);
} finally {
  await app?.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout passe.");
process.exit(echecs.length ? 1 : 0);
