/**
 * Profil de cet ordinateur et compte d'équipe, dans l'app de bureau (export
 * statique), sur un profil temporaire déjà rempli (nom, rôle, photo, réglages) :
 * - sans compte : le profil local s'affiche, se modifie et survit au redémarrage ;
 * - avec un backend Convex local et jetable (`KLYRA_TEST_CONVEX_URL` et
 *   `KLYRA_TEST_CONVEX_ADMIN_KEY`, jamais un vrai déploiement) : première
 *   connexion à un profil d'équipe incomplet, écart proposé, modification,
 *   redémarrage, réseau coupé puis rétabli, déconnexion, changement de compte.
 * La photo et les réglages de l'ordinateur ne doivent jamais changer.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:profil          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const APP = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-profil-"));
const DONNEES = path.join(TMP, "userdata");
const PORT = 9338;
const CONVEX = process.env.KLYRA_TEST_CONVEX_URL;
const CLE_ADMIN = process.env.KLYRA_TEST_CONVEX_ADMIN_KEY;
/** La commande qui arrête (`… stop`) et relance (`… start`) ce backend local, pour couper le réseau. */
const SERVEUR = process.env.KLYRA_TEST_CONVEX_SERVEUR;
const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─── Le poste de départ : un profil rempli, une photo, des réglages ─── */

const PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const ICI = { id: "essai", name: "Pelin", title: "Design · KLYRA", initial: "P", photo: PHOTO };
const REGLAGES = {
  notifications: { actives: true, pastille: false, son: false, agentFini: true, agentErreur: true, workflow: false, majPrete: true },
  computerUse: { actif: false },
  sons: { finDeTache: false, theme: "clavier", volume: 0.3 },
};
mkdirSync(DONNEES, { recursive: true });
writeFileSync(path.join(DONNEES, "conversations.json"), JSON.stringify({ version: 1, chats: [], messages: [], projects: [], currentUser: ICI }));
writeFileSync(path.join(DONNEES, "reglages.json"), JSON.stringify(REGLAGES));
const profilSurDisque = () => JSON.parse(readFileSync(path.join(DONNEES, "conversations.json"), "utf8")).currentUser;
const reglagesSurDisque = () => JSON.parse(readFileSync(path.join(DONNEES, "reglages.json"), "utf8"));

/* ─── L'app et ses outils de pilotage ───────────────────────────── */

const env = { ...process.env, HOME: path.join(TMP, "home"), KLYRA_USER_DATA: DONNEES };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KLYRA_DEV_URL;
if (CONVEX) env.KLYRA_CONVEX_URL = CONVEX;

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
  await send("Network.enable");
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
  const pret = async () => {
    for (let i = 0; i < 40 && !(await ev("document.body?.innerText.length > 0 && !!window.klyra")); i++) await attendre(500);
  };
  await pret();
  const a = {
    erreurs,
    ev,
    async aller(chemin) {
      await ev(`window.next?.router ? window.next.router.push(${JSON.stringify(chemin)}) : (location.href = ${JSON.stringify(chemin)})`);
      await attendre(1500);
    },
    /** Attend qu'une expression soit vraie (au plus `ms`). */
    async quand(expression, ms = 20000) {
      for (let t = 0; t < ms; t += 300) {
        if (await ev(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return true;
        await attendre(300);
      }
      return false;
    },
    texte: () => ev("document.querySelector('main')?.innerText ?? ''"),
    cliquer: (libelle) =>
      ev(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(libelle)} && !b.disabled); if (!b) return false; b.click(); return true; })()`),
    saisir: (selecteur, valeur) =>
      ev(`(() => { const el = document.querySelector(${JSON.stringify(selecteur)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(valeur)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`),
    /** Ce que le rail et le Profil montrent de toi. */
    identite: () =>
      ev(`(() => {
        const rail = document.querySelector('a[href="/reglages"][aria-label]');
        return { rail: rail?.getAttribute('aria-label')?.split(' · ')[0] ?? null, photoRail: rail?.querySelector('img')?.getAttribute('src') ?? null };
      })()`),
    /**
     * Le serveur du compte d'équipe arrêté (plus de réseau : connexions refusées) ou
     * relancé, puis la page rechargée si demandé (l'app redémarre sans réseau).
     */
    async reseau(coupe, recharger) {
      execSync(`${SERVEUR} ${coupe ? "stop" : "start"}`, { stdio: "ignore" });
      if (recharger) {
        await send("Page.reload", {});
        await attendre(1500);
        await pret();
      }
    },
    fermer() {
      ws.close();
      processus.kill();
      return new Promise((r) => processus.once("exit", r));
    },
  };
  return a;
}

async function modifierProfil(a, prenom, role) {
  await a.aller("/reglages?section=profil");
  if (!(await a.ev("!!document.querySelector('#reglage-nom')"))) await a.cliquer("Modifier le profil");
  await a.quand("document.querySelector('#reglage-nom input')");
  await a.saisir("#reglage-nom input", prenom);
  if (role !== undefined) await a.ev(`(() => { const el = document.querySelectorAll('#reglage-nom input')[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(role)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await attendre(200);
  await a.ev(`[...document.querySelectorAll('#reglage-nom button')].find((b) => b.innerText.trim() === 'Enregistrer')?.click()`);
}

/* ─── Le compte d'équipe local : codes de connexion lus dans les e-mails simulés ─── */

const admin = CONVEX && CLE_ADMIN && SERVEUR ? new ConvexHttpClient(CONVEX) : null;
admin?.setAdminAuth(CLE_ADMIN);
const SUFFIXE = Math.random().toString(36).slice(2, 8);
const A = { email: `essai-a-${SUFFIXE}@example.test`, nom: "Alice Essai" };
const B = { email: `essai-b-${SUFFIXE}@example.test`, nom: "Bruno Essai" };

const courrielsRecus = (email) => admin.query(makeFunctionReference("courriels:nombreCourrielsSimules"), { a: email });

async function seConnecter(a, qui) {
  await a.aller("/reglages?section=equipe");
  // Une demande précédente encore affichée : on repart du formulaire.
  if (await a.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Changer d’adresse')", 3000)) await a.cliquer("Changer d’adresse");
  await a.quand(`document.querySelector('input[aria-label="Adresse e-mail"]')`);
  const avant = await courrielsRecus(qui.email);
  await a.saisir('input[aria-label="Adresse e-mail"]', qui.email);
  await attendre(200);
  await a.cliquer("Recevoir un lien");
  await a.quand(`document.querySelector('input[aria-label="Lien de connexion"]')`);
  // Même adresse redemandée dans la minute : pas de nouveau lien (délai du serveur). On attend la fin annoncée, puis « Renvoyer ».
  let nouveau = false;
  for (let i = 0; i < 10 && !nouveau; i++) {
    nouveau = (await courrielsRecus(qui.email)) > avant;
    if (!nouveau) await attendre(500);
  }
  if (!nouveau) {
    await a.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Renvoyer' && !b.disabled)", 70000);
    await a.cliquer("Renvoyer");
    for (let i = 0; i < 20 && !nouveau; i++) {
      nouveau = (await courrielsRecus(qui.email)) > avant;
      if (!nouveau) await attendre(500);
    }
  }
  const courriel = nouveau ? await admin.query(makeFunctionReference("courriels:dernierCourrielSimule"), { a: qui.email }) : null;
  const code = courriel?.texte.match(/\?code=([A-Za-z0-9]+)/)?.[1] ?? null;
  if (!code) throw new Error(`aucun lien simulé pour ${qui.email}`);
  await a.saisir('input[aria-label="Lien de connexion"]', `klyra://connexion?code=${code}`);
  await attendre(200);
  await a.cliquer("Se connecter");
  return a.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Se déconnecter')", 30000);
}

let app;
try {
  /* 1. Sans compte : le profil de cet ordinateur. */
  app = await lancer();
  let moi = await app.identite();
  verifier(moi.rail === "Pelin" && moi.photoRail === PHOTO, "sans compte : le rail montre le prénom et la photo de cet ordinateur");
  await app.aller("/reglages?section=profil");
  let texte = await app.texte();
  verifier(texte.includes("Pelin") && texte.includes("Design · KLYRA"), "sans compte : Profil affiche le prénom et le rôle de cet ordinateur");
  await modifierProfil(app, "Pelin K.");
  await app.quand("document.querySelector('a[href=\"/reglages\"]')?.getAttribute('aria-label')?.startsWith('Pelin K.')");
  await attendre(1200);
  verifier(JSON.stringify(profilSurDisque()) === JSON.stringify({ ...ICI, name: "Pelin K." }), "sans compte : seul le prénom change sur le disque (photo, rôle, identifiant gardés)");
  await app.fermer();
  app = await lancer();
  moi = await app.identite();
  verifier(moi.rail === "Pelin K." && moi.photoRail === PHOTO, "sans compte, après redémarrage : prénom modifié et photo intacts");
  await modifierProfil(app, "Pelin");
  await app.quand("document.querySelector('a[href=\"/reglages\"]')?.getAttribute('aria-label')?.startsWith('Pelin ·')");
  await attendre(1200);

  if (!admin) {
    console.log("\n(Compte d’équipe non testé : KLYRA_TEST_CONVEX_URL, KLYRA_TEST_CONVEX_ADMIN_KEY ou KLYRA_TEST_CONVEX_SERVEUR absent.)");
  } else {
    await admin.mutation(makeFunctionReference("equipe:initialiser"), { admins: [A, B] });

    /* 2. Première connexion, profil d'équipe incomplet (rôle vide) : le compte s'affiche, l'écart est proposé. */
    verifier(await seConnecter(app, A), "première connexion par le lien magique (e-mail simulé)");
    await app.aller("/reglages?section=profil");
    await app.quand("document.querySelector('main')?.innerText.includes('diffère de ton profil d’équipe')");
    moi = await app.identite();
    texte = await app.texte();
    verifier(moi.rail === A.nom && moi.photoRail === PHOTO, "connecté : le nom du compte, la photo de cet ordinateur");
    verifier(
      texte.includes("Ici : « Pelin · Design · KLYRA »") && texte.includes(`Équipe : « ${A.nom} · sans rôle »`),
      "écart proposé avec les deux versions, sans rien recopier",
    );
    verifier(JSON.stringify(profilSurDisque()) === JSON.stringify(ICI), "la connexion n’a rien écrit sur le profil de cet ordinateur");

    /* 3. Choisir celui de cet ordinateur : le compte est complété, l'équipe voit la même chose. */
    await app.cliquer("Utiliser celui de cet ordinateur");
    await app.quand("document.querySelector('main')?.innerText.includes('Ton profil d’équipe reprend celui de cet ordinateur')");
    moi = await app.identite();
    verifier(moi.rail === "Pelin", "le compte reprend le profil de cet ordinateur");
    await app.aller("/reglages?section=equipe");
    await app.quand(`document.querySelector('#reglage-membres')?.innerText.includes('Design · KLYRA · ${A.email}')`);
    verifier(
      (await app.ev("document.querySelector('#reglage-membres')?.innerText ?? ''")).includes(`Design · KLYRA · ${A.email}`),
      "la liste de l’équipe (lue sur le serveur) montre le même nom et le même rôle",
    );

    /* 4. Modifier connecté : le compte, puis cet ordinateur. Redémarrer. */
    await modifierProfil(app, "Pelin B.", "Direction artistique");
    await app.quand("document.querySelector('a[href=\"/reglages\"]')?.getAttribute('aria-label')?.startsWith('Pelin B.')");
    await attendre(1200);
    verifier(
      JSON.stringify(profilSurDisque()) === JSON.stringify({ ...ICI, name: "Pelin B.", title: "Direction artistique" }),
      "modifié connecté : l’ordinateur garde le même nom et le même rôle, photo intacte",
    );
    await app.fermer();
    app = await lancer();
    await app.aller("/reglages?section=equipe");
    const resteConnecte = await app.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Se déconnecter')", 15000);
    moi = await app.identite();
    verifier(moi.rail === "Pelin B." && moi.photoRail === PHOTO, `après redémarrage (${resteConnecte ? "session gardée" : "session non gardée : pas de trousseau"}) : même identité, photo intacte`);
    if (!resteConnecte) verifier(await seConnecter(app, A), "reconnexion");

    /* 5. Réseau coupé : l'app marche sur le profil de cet ordinateur ; rétabli, l'écart éventuel est proposé.
       Sans réseau, Convex Auth échoue à rafraîchir sa session (« Failed to fetch ») : attendu, il réessaie ensuite. */
    const erreursAvantCoupure = app.erreurs.length;
    await app.reseau(true, true);
    await app.aller("/reglages?section=equipe");
    await attendre(3000);
    texte = await app.texte();
    verifier(!texte.includes("Se déconnecter") && !texte.includes(A.email), "réseau coupé : rien du compte n’est affiché tant qu’il n’est pas vérifié");
    await modifierProfil(app, "Pelin hors ligne");
    await app.quand("document.querySelector('a[href=\"/reglages\"]')?.getAttribute('aria-label')?.startsWith('Pelin hors ligne')");
    await attendre(1200);
    verifier(profilSurDisque().name === "Pelin hors ligne" && profilSurDisque().photo === PHOTO, "réseau coupé : le profil se modifie sur cet ordinateur");
    await app.reseau(false, false);
    const retour = await app.quand("document.querySelector('a[href=\"/reglages\"]')?.getAttribute('aria-label')?.startsWith('Pelin B.')", 60000);
    verifier(retour, "réseau rétabli : le compte revient tout seul (nom du compte)");
    const pendantCoupure = app.erreurs.splice(erreursAvantCoupure);
    verifier(
      pendantCoupure.every((e) => /Failed to fetch/.test(e ?? "")),
      `pendant la coupure, seulement des échecs réseau attendus (${pendantCoupure.length})`,
    );
    await app.aller("/reglages?section=profil");
    await app.quand("document.querySelector('main')?.innerText.includes('diffère de ton profil d’équipe')");
    texte = await app.texte();
    verifier(texte.includes("Ici : « Pelin hors ligne · Direction artistique »"), "réseau rétabli : la modification faite hors ligne est proposée, pas perdue");
    await app.cliquer("Garder celui de l’équipe");
    await app.quand("document.querySelector('main')?.innerText.includes('Cet ordinateur reprend ton profil d’équipe')");
    await attendre(1200);
    verifier(profilSurDisque().name === "Pelin B." && profilSurDisque().photo === PHOTO, "« Garder celui de l’équipe » : l’ordinateur reprend le compte, photo intacte");
    await app.cliquer("Annuler");
    await attendre(1200);
    verifier(profilSurDisque().name === "Pelin hors ligne", "« Annuler » rend le profil d’avant à cet ordinateur");
    await app.cliquer("Garder celui de l’équipe");
    await attendre(1200);

    /* 6. Déconnexion : plus rien du compte. */
    await modifierProfil(app, "Pelin B.");
    await attendre(1500);
    await app.aller("/reglages?section=equipe");
    await app.cliquer("Se déconnecter");
    await app.quand(`document.querySelector('input[aria-label="Adresse e-mail"]')`);
    await modifierProfil(app, "Pelin");
    await app.quand("document.querySelector('a[href=\"/reglages\"]')?.getAttribute('aria-label')?.startsWith('Pelin ·')");
    await app.aller("/reglages?section=profil");
    texte = await app.texte();
    moi = await app.identite();
    verifier(moi.rail === "Pelin" && !texte.includes("Pelin B.") && !texte.includes(A.email) && !texte.includes("profil d’équipe"), "déconnecté : seul le profil de cet ordinateur, rien du compte");

    /* 7. Changement de compte : rien du compte précédent. */
    verifier(await seConnecter(app, B), "connexion avec un autre compte");
    await app.aller("/reglages?section=profil");
    await app.quand("document.querySelector('main')?.innerText.includes('diffère de ton profil d’équipe')");
    texte = await app.texte();
    moi = await app.identite();
    verifier(moi.rail === B.nom && moi.photoRail === PHOTO, "autre compte : son nom, la photo de cet ordinateur");
    verifier(!texte.includes("Pelin B.") && !texte.includes(A.email) && !texte.includes(A.nom), "autre compte : rien du compte précédent dans le Profil");
    await app.aller("/reglages?section=equipe");
    await app.cliquer("Se déconnecter");
    await app.quand(`document.querySelector('input[aria-label="Adresse e-mail"]')`);
  }

  verifier(JSON.stringify(reglagesSurDisque()) === JSON.stringify(REGLAGES), "les réglages de cet ordinateur n’ont pas changé");
  verifier(profilSurDisque().photo === PHOTO && profilSurDisque().id === ICI.id, "la photo et l’identifiant de cet ordinateur n’ont jamais changé");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` (${app.erreurs.join(" | ")})` : ""}`);
} catch (e) {
  verifier(false, `le test a planté : ${e instanceof Error ? e.message : e}`);
} finally {
  await app?.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout passe.");
process.exit(echecs.length ? 1 : 0);
