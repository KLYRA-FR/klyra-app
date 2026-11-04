/**
 * La session du compte d'équipe survit-elle à une mise à jour ? Dans l'app de bureau
 * (export statique), sur un profil temporaire, avec un backend Convex local et jetable
 * (`KLYRA_TEST_CONVEX_URL`, `KLYRA_TEST_CONVEX_ADMIN_KEY`, jamais un vrai déploiement)
 * et un faux dépôt de versions (`KLYRA_MAJ_URL`, servi ici) :
 *   1. connexion par le lien magique (e-mail simulé) ;
 *   2. mise à jour proposée, « Installer maintenant », l'app relancée : toujours connectée ;
 *   3. une seule écriture des jetons ratée pendant un rafraîchissement (fichier verrouillé un
 *      instant, comme un antivirus sous Windows), puis la mise à jour : toujours connectée.
 * Le trousseau du système doit être disponible : sans lui, l'app ne garde aucune session, par
 * conception. Sous Linux, un trousseau jetable (HOME temporaire) :
 *   HOME=$(mktemp -d) dbus-run-session -- sh -c 'eval "$(printf essai | gnome-keyring-daemon --daemonize --unlock --components=secrets)";
 *     xvfb-run -a pnpm test:session-maj -- --no-sandbox --password-store=gnome-libsecret'
 * Prérequis : `pnpm build && pnpm build:electron`, et le backend local (`source <dossier>/env`).
 * Sur le code d'avant le correctif (04/11/2026), le point 3 échoue : l'app relancée est déconnectée.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const APP = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-session-maj-"));
const DONNEES = path.join(TMP, "userdata");
const PORT_PAGE = 9342;
const PORT_MAIN = 9343;
const CONVEX = process.env.KLYRA_TEST_CONVEX_URL;
const CLE_ADMIN = process.env.KLYRA_TEST_CONVEX_ADMIN_KEY;
if (!CONVEX || !CLE_ADMIN) {
  console.error("KLYRA_TEST_CONVEX_URL et KLYRA_TEST_CONVEX_ADMIN_KEY : un backend Convex local (tools/convex-local).");
  process.exit(1);
}
const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(DONNEES, { recursive: true });
writeFileSync(path.join(DONNEES, "conversations.json"), JSON.stringify({ version: 1, chats: [], messages: [], projects: [], currentUser: { id: "essai", name: "Essai", title: "", initial: "E" } }));

/* ─── Le faux dépôt des versions : toujours une version plus récente que celle qui tourne ─── */

const INSTALLATEUR = Buffer.from("faux installateur KLYRA");
const EMPREINTE = createHash("sha512").update(INSTALLATEUR).digest("base64");
let numero = 0;
const depot = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${depot.address().port}`;
  if (req.url === "/latest") {
    numero++;
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({
        tag_name: `v9.0.${numero}`,
        assets: [
          { name: `KLYRA-9.0.${numero}-win-x64-setup.exe`, browser_download_url: `${base}/installateur` },
          { name: `KLYRA-9.0.${numero}-arm64-mac.zip`, browser_download_url: `${base}/installateur` },
          { name: "latest.yml", browser_download_url: `${base}/fiche` },
          { name: "latest-mac.yml", browser_download_url: `${base}/fiche` },
        ],
      }),
    );
  }
  if (req.url === "/fiche") return res.end(`version: 9.0.${numero}\nsha512: ${EMPREINTE}\n`);
  if (req.url === "/installateur") return res.end(INSTALLATEUR);
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => depot.listen(0, "127.0.0.1", r));

const env = {
  ...process.env,
  HOME: path.join(TMP, "home"),
  KLYRA_USER_DATA: DONNEES,
  KLYRA_CONVEX_URL: CONVEX,
  KLYRA_MAJ_URL: `http://127.0.0.1:${depot.address().port}/latest`,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.KLYRA_DEV_URL;

/* ─── L'app, sa page (protocole de débogage) et son process principal (inspecteur) ─── */

async function connecter(url) {
  const ws = new WebSocket(url);
  await new Promise((r, e) => ((ws.onopen = r), (ws.onerror = e)));
  let id = 0;
  const attente = {};
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    /* « Quitter la page ? » (Convex Auth pendant un rafraîchissement) : accepté, comme le ferait Electron en quittant. */
    if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    attente[m.id]?.(m.result);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      attente[++id] = r;
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => r(undefined), 20000);
    });
  const ev = async (x) => {
    const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) console.log(`       (évaluation : ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text})`);
    return r?.result?.value;
  };
  return { ws, send, ev };
}

async function cible(port, filtre) {
  for (let i = 0; i < 60; i++) {
    const trouvee = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((r) => r.json())
      .then((t) => t.find(filtre))
      .catch(() => undefined);
    if (trouvee) return trouvee.webSocketDebuggerUrl;
    await attendre(500);
  }
  throw new Error(`rien à déboguer sur le port ${port}`);
}

async function lancer() {
  // `KLYRA_JOURNAL_ESSAI=<fichier>` : la sortie du process principal, pour comprendre un échec.
  const journal = process.env.KLYRA_JOURNAL_ESSAI ? openSync(process.env.KLYRA_JOURNAL_ESSAI, "a") : "ignore";
  const processus = spawn(ELECTRON, [".", `--remote-debugging-port=${PORT_PAGE}`, `--inspect=${PORT_MAIN}`, ...process.argv.slice(2)], { cwd: APP, env, stdio: ["ignore", journal, journal] });
  const sortie = new Promise((r) => processus.once("exit", r));
  const page = await connecter(await cible(PORT_PAGE, (x) => x.type === "page" && x.url.startsWith("app://")));
  const main = await connecter(await cible(PORT_MAIN, () => true));
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  for (let i = 0; i < 40 && !(await page.ev("document.body?.innerText.length > 0 && !!window.klyra")); i++) await attendre(500);
  const a = {
    page,
    main,
    sortie,
    async aller(chemin) {
      await page.ev(`window.next?.router ? window.next.router.push(${JSON.stringify(chemin)}) : (location.href = ${JSON.stringify(chemin)})`);
      await attendre(1500);
    },
    async quand(expression, ms = 20000) {
      for (let t = 0; t < ms; t += 300) {
        if (await page.ev(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return true;
        await attendre(300);
      }
      return false;
    },
    cliquer: (libelle) =>
      page.ev(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(libelle)} && !b.disabled); if (!b) return false; b.click(); return true; })()`),
    saisir: (selecteur, valeur) =>
      page.ev(`(() => { const el = document.querySelector(${JSON.stringify(selecteur)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(valeur)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`),
    /** Réglages › Équipe : « Se déconnecter » (connecté) ou le formulaire d'adresse (déconnecté). */
    async etatCompte() {
      await a.aller("/reglages?section=equipe");
      for (let t = 0; t < 20000; t += 300) {
        const etat = await page.ev(`(() => {
          const boutons = [...document.querySelectorAll('button')].map((b) => b.innerText.trim());
          if (boutons.includes('Se déconnecter')) return 'connecte';
          if (document.querySelector('input[aria-label="Adresse e-mail"]')) return 'deconnecte';
          return null;
        })()`);
        if (etat) return etat;
        await attendre(300);
      }
      return "inconnu";
    },
    /** « Installer maintenant » d'une version proposée par le faux dépôt : l'app se ferme comme pour une vraie mise à jour. */
    async mettreAJour() {
      // La vérification du lancement (10 s après) peut être en cours : on attend qu'une version soit prête.
      // Le pont répond `{ ok, data }`.
      const lire = async (appel) => (await page.ev(`window.klyra.maj.${appel}().then((r) => r.data)`)) ?? null;
      let etat = await lire("verifier");
      for (let i = 0; i < 40 && etat?.statut !== "prete"; i++) {
        await attendre(500);
        etat = await lire("etat");
        if (etat?.statut === "a-jour" || etat?.statut === "erreur") etat = await lire("verifier");
      }
      if (etat?.statut !== "prete") throw new Error(`mise à jour pas prête : ${JSON.stringify(etat)}`);
      // Un inspecteur encore branché empêche le process de se terminer (« Waiting for the debugger to disconnect »).
      main.ws.close();
      let reponse = "(pas de réponse)";
      void page.ev("window.klyra.maj.installer().then((r) => JSON.stringify(r))").then((r) => (reponse = r ?? reponse));
      const fermee = await Promise.race([sortie.then(() => true), attendre(15000).then(() => false)]);
      if (!fermee) {
        console.log(`       (l'app ne s'est pas fermée en 15 s ; « Installer maintenant » a répondu ${reponse})`);
        // L'installateur Windows finit par tuer l'app (`taskkill /f`) : on fait pareil.
        processus.kill("SIGKILL");
        await sortie;
      }
      return fermee;
    },
    fermer() {
      processus.kill();
      return sortie;
    },
  };
  return a;
}

/* ─── Le compte d'équipe local : code de connexion lu dans l'e-mail simulé ─── */

const admin = new ConvexHttpClient(CONVEX);
admin.setAdminAuth(CLE_ADMIN);
const QUI = { email: `essai-maj-${Math.random().toString(36).slice(2, 8)}@example.test`, nom: "Essai Mise à jour" };
await admin.mutation(makeFunctionReference("equipe:initialiser"), { admins: [QUI] }).catch(() => {});

async function seConnecter(a) {
  await a.aller("/reglages?section=equipe");
  await a.quand(`document.querySelector('input[aria-label="Adresse e-mail"]')`);
  const avant = await admin.query(makeFunctionReference("courriels:nombreCourrielsSimules"), { a: QUI.email });
  await a.saisir('input[aria-label="Adresse e-mail"]', QUI.email);
  await attendre(200);
  await a.cliquer("Recevoir un lien");
  await a.quand(`document.querySelector('input[aria-label="Lien de connexion"]')`);
  for (let i = 0; i < 20 && (await admin.query(makeFunctionReference("courriels:nombreCourrielsSimules"), { a: QUI.email })) <= avant; i++) await attendre(500);
  const courriel = await admin.query(makeFunctionReference("courriels:dernierCourrielSimule"), { a: QUI.email });
  const code = courriel?.texte.match(/\?code=([A-Za-z0-9]+)/)?.[1];
  if (!code) throw new Error("aucun lien simulé");
  await a.saisir('input[aria-label="Lien de connexion"]', `klyra://connexion?code=${code}`);
  await attendre(200);
  await a.cliquer("Se connecter");
  return a.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Se déconnecter')", 30000);
}

/**
 * Le prochain renommage vers compte.json qui écrit le jeton de rafraîchissement échoue une fois
 * (EPERM, comme un fichier tenu par un antivirus sous Windows). Le jeton d'accès, écrit juste avant,
 * passe : c'est le cas où le disque garde un jeton de rafraîchissement déjà remplacé sur le serveur.
 */
const ARMER = `(() => {
  const fsp = process.mainModule.require("node:fs/promises");
  const path = process.mainModule.require("node:path");
  const cible = path.join(process.env.KLYRA_USER_DATA, "compte.json");
  const renommer = fsp.rename;
  let vus = 0;
  globalThis.__klyraRefus = 0;
  fsp.rename = async (de, vers) => {
    if (String(vers) === cible && ++vus === 2) {
      fsp.rename = renommer;
      globalThis.__klyraRefus++;
      throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
    }
    return renommer(de, vers);
  };
  return true;
})()`;

let app;
try {
  /* 1. Connexion. */
  app = await lancer();
  verifier(await seConnecter(app), "connexion par le lien magique (e-mail simulé)");
  await attendre(2000);

  /* 2. Mise à jour, l'app relancée. */
  verifier(await app.mettreAJour(), "mise à jour installée : l'app s'est fermée d'elle-même");
  app = await lancer();
  verifier((await app.etatCompte()) === "connecte", "après la mise à jour : toujours connectée");

  /* 3. Une écriture ratée pendant un rafraîchissement (rechargement de la page = nouveau client, qui rafraîchit sa session),
        puis un second rafraîchissement, puis la mise à jour. */
  verifier(await app.main.ev(ARMER), "écriture du jeton de rafraîchissement armée pour échouer une fois");
  await app.page.send("Page.reload", {});
  for (let i = 0; i < 40 && !(await app.main.ev("globalThis.__klyraRefus")); i++) await attendre(500);
  verifier((await app.main.ev("globalThis.__klyraRefus")) === 1, "un rafraîchissement a eu lieu et son écriture a échoué une fois");
  await attendre(3000);
  await app.page.send("Page.reload", {});
  await attendre(6000);
  verifier((await app.etatCompte()) === "connecte", "pendant la session : toujours connectée");
  verifier(await app.mettreAJour(), "seconde mise à jour : l'app s'est fermée d'elle-même");
  app = await lancer();
  const etat = await app.etatCompte();
  await attendre(5000); // le temps que le rafraîchissement du lancement aboutisse ou échoue
  const ensuite = await app.etatCompte();
  verifier(etat === "connecte" && ensuite === "connecte", `après une écriture ratée puis la mise à jour : toujours connectée (au lancement : ${etat}, 5 s après : ${ensuite})`);
} catch (e) {
  console.error(e);
  echecs.push(String(e));
} finally {
  await app?.fermer().catch(() => {});
  depot.close();
  rmSync(TMP, { recursive: true, force: true });
}
console.log(echecs.length ? `\n${echecs.length} échec(s)` : "\nTout passe.");
process.exit(echecs.length ? 1 : 0);
