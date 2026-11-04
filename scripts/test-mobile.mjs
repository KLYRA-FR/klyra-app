/**
 * Réglages › Mobile, de bout en bout, sur un backend Convex local et jetable
 * (`KLYRA_TEST_CONVEX_URL`, `KLYRA_TEST_CONVEX_ADMIN_KEY`, `KLYRA_TEST_CONVEX_SERVEUR`, jamais un vrai
 * déploiement) et des comptes fictifs `@example.test` dont les e-mails sont simulés (aucun envoi) :
 * - l'app de bureau (export statique, profil temporaire) : états déconnecté, connecté, hors ligne,
 *   retiré ; poste vu « Ouvert » en moins de 25 s ; recherche ; QR lu et relu ; groupe VPS ;
 * - une vraie page web de téléphone (export servi en local, userAgent d'iPhone, sans app de bureau)
 *   et une seconde session web : elles apparaissent sans recharger, « Déconnecter » les ferme tout
 *   de suite, le téléphone montre MO-T14 et pas « retiré de l'équipe » ; le bureau reste connecté.
 * Prérequis : `pnpm build && pnpm build:electron`, puis
 *   xvfb-run -a pnpm test:reglages-mobile   (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { execFileSync, execSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { lireQr } from "../serveur/qr.mjs";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const APP = path.resolve(import.meta.dirname, "..");
const OUT = path.join(APP, "out");
const ELECTRON = createRequire(import.meta.url)("electron");
const CONVEX = process.env.KLYRA_TEST_CONVEX_URL;
const CLE_ADMIN = process.env.KLYRA_TEST_CONVEX_ADMIN_KEY;
const SERVEUR = process.env.KLYRA_TEST_CONVEX_SERVEUR;
if (!CONVEX || !CLE_ADMIN || !SERVEUR || !/^http:\/\/127\.0\.0\.1:\d+$/.test(CONVEX)) {
  console.error("Backend Convex local requis : KLYRA_TEST_CONVEX_URL (http://127.0.0.1:…), KLYRA_TEST_CONVEX_ADMIN_KEY, KLYRA_TEST_CONVEX_SERVEUR.");
  process.exit(2);
}
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-mobile-"));
const PORT_BUREAU = 9351;
const PORT_TELEPHONE = 9352;
const PORT_WEB = 3480;
const ADRESSE_ESSAI = "https://app.exemple.test";
const { echecs, verifier } = verificateur();

const fn = (nom) => makeFunctionReference(nom);
const admin = new ConvexHttpClient(CONVEX);
admin.setAdminAuth(CLE_ADMIN);
const SUFFIXE = Math.random().toString(36).slice(2, 8);
const MOI = { email: `essai-mobile-${SUFFIXE}@example.test`, nom: "Essai Mobile" };
const ADMIN = { email: `essai-admin-${SUFFIXE}@example.test`, nom: "Admin Essai" };

/* ─── E-mails simulés et sessions fictives ───────────────────────── */

async function dernierCode(email, avant) {
  for (let i = 0; i < 40; i++) {
    if ((await admin.query(fn("courriels:nombreCourrielsSimules"), { a: email })) > avant) break;
    await attendre(500);
  }
  const courriel = await admin.query(fn("courriels:dernierCourrielSimule"), { a: email });
  return courriel?.texte.match(/\?code=([A-Za-z0-9]+)/)?.[1] ?? null;
}

/** Une demande de lien acceptée (le serveur impose une minute entre deux liens d'une même adresse). */
async function demanderLien(client, email, cible) {
  for (;;) {
    const r = await client.mutation(fn("connexion:demanderLien"), { email, cible });
    if (r.acceptee) return;
    await attendre(r.attenteMs + 500);
  }
}

/** Une session web fictive, ouverte par un client HTTP (comme un navigateur sans fenêtre). */
async function sessionHttp(email) {
  const client = new ConvexHttpClient(CONVEX);
  const avant = await admin.query(fn("courriels:nombreCourrielsSimules"), { a: email });
  await demanderLien(client, email, "web");
  const code = await dernierCode(email, avant);
  const { tokens } = await client.action(fn("auth:signIn"), { provider: "postshiba", params: { email, code } });
  client.setAuth(tokens.token);
  return client;
}

/* ─── L'export servi comme une app web, et une fenêtre de téléphone ─── */

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const serveurWeb = http.createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const candidats = chemin.endsWith("/") ? [`${chemin}index.html`] : [chemin, `${chemin}.html`, `${chemin}/index.html`];
  for (const c of candidats) {
    const fichier = path.join(OUT, path.normalize(c));
    if (!fichier.startsWith(OUT)) break;
    try {
      if (!statSync(fichier).isFile()) continue;
      res.writeHead(200, { "Content-Type": TYPES[path.extname(fichier)] ?? "application/octet-stream" });
      return res.end(readFileSync(fichier));
    } catch {
      /* suivant */
    }
  }
  res.writeHead(404).end();
});

async function piloter(port, filtre) {
  let cible;
  for (let i = 0; i < 60 && !cible; i++) {
    await attendre(500);
    cible = await fetch(`http://127.0.0.1:${port}/json`)
      .then((r) => r.json())
      .then((t) => t.find((x) => x.type === "page" && filtre(x.url)))
      .catch(() => undefined);
  }
  if (!cible) throw new Error(`aucune page sur le port ${port}`);
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const attente = {};
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    attente[m.id]?.(m.result);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      attente[++id] = r;
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
  return {
    ev,
    send,
    texte: () => ev("document.body?.innerText ?? ''"),
    async quand(expression, ms = 20000) {
      for (let t = 0; t < ms; t += 250) {
        if (await ev(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return true;
        await attendre(250);
      }
      return false;
    },
    cliquer: (libelle) =>
      ev(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(libelle)} && !b.disabled); if (!b) return false; b.click(); return true; })()`),
    saisir: (selecteur, valeur) =>
      ev(`(() => { const el = document.querySelector(${JSON.stringify(selecteur)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(valeur)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`),
    fermer: () => ws.close(),
  };
}

/* ─── Lecture de la section Mobile ───────────────────────────────── */

const SECTION = "document.querySelector('main')";
const texteSection = (a) => a.ev(`${SECTION}?.innerText ?? ''`);
/** La ligne (bouton « Déconnecter ») dont le titre est `nom`. */
const deconnecterLigne = (a, nom) =>
  a.ev(`(() => {
    const ligne = [...document.querySelectorAll('.klyra-reglage')].find((l) => l.querySelector('span')?.innerText.trim() === ${JSON.stringify(nom)});
    const b = ligne && [...ligne.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Déconnecter');
    if (!b || b.disabled) return false; b.click(); return true;
  })()`);
const lignesTelephones = (a) =>
  a.ev(`[...document.querySelectorAll('.klyra-reglage')].filter((l) => [...l.querySelectorAll('button')].some((b) => /^D(é)connect/.test(b.innerText.trim()))).map((l) => l.querySelector('span')?.innerText.trim())`);

/** Relit le QR affiché à partir de ses carrés SVG, sans rien savoir de l'adresse. */
const lireQrAffiche = (a) =>
  a.ev(`(() => {
    const svg = document.querySelector('svg[aria-label="QR de l’adresse de KLYRA"]');
    if (!svg) return null;
    const cote = Number(svg.getAttribute('viewBox').split(' ')[2]);
    const n = cote - 8;
    const m = Array.from({ length: n }, () => Array(n).fill(0));
    for (const r of svg.querySelectorAll('rect')) m[Number(r.getAttribute('y')) - 4][Number(r.getAttribute('x')) - 4] = 1;
    return m;
  })()`);

async function chercher(a, requete) {
  await a.ev(`(() => { const el = document.querySelector('input[type=search]'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(requete)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await attendre(300);
  await a.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await a.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

const convexEnv = (args) =>
  execFileSync("pnpm", ["exec", "convex", "env", ...args], { cwd: APP, env: { ...process.env, CONVEX_SELF_HOSTED_URL: CONVEX, CONVEX_SELF_HOSTED_ADMIN_KEY: CLE_ADMIN }, stdio: "ignore" });

let bureau;
let telephone;
let processusTelephone;
try {
  await new Promise((r) => serveurWeb.listen(PORT_WEB, "127.0.0.1", r));
  /* L'équipe fictive : un admin (session HTTP) qui invite la personne du bureau comme membre. */
  await admin.mutation(fn("equipe:initialiser"), { admins: [ADMIN] });
  const sessionAdmin = await sessionHttp(ADMIN.email);
  await sessionAdmin.mutation(fn("equipe:inviter"), { email: MOI.email, nom: MOI.nom, role: "membre" });

  /* 1. Bureau, déconnecté : seulement MO-T2 et le bouton vers Équipe. */
  bureau = await lancerApp({ env: { HOME: path.join(TMP, "home"), KLYRA_USER_DATA: path.join(TMP, "bureau"), KLYRA_CONVEX_URL: CONVEX }, port: PORT_BUREAU });
  await bureau.aller("/reglages?section=mobile");
  await bureau.quand(`${SECTION}?.innerText.includes('à ton compte d’équipe')`);
  let texte = await texteSection(bureau);
  verifier(texte.includes("Connecte d’abord cet ordinateur à ton compte d’équipe") && texte.includes("Se connecter dans Équipe"), "déconnecté : MO-T2 et « Se connecter dans Équipe »");
  verifier(!texte.includes("Téléphones connectés") && !texte.includes("Relier un téléphone"), "déconnecté : aucun autre groupe");
  const navMobile = await bureau.ev(`[...document.querySelectorAll('#reglages-navigation button')].map((b) => b.innerText.trim())`);
  verifier(navMobile.indexOf("Mobile") === navMobile.indexOf("Équipe") + 1, "la section Mobile suit Équipe dans la barre latérale");

  /* 2. Connexion du bureau par le lien simulé, puis « Ouvert » en moins de 25 s. */
  await bureau.cliquer("Se connecter dans Équipe");
  await bureau.quand(`document.querySelector('input[aria-label="Adresse e-mail"]')`);
  let avant = await admin.query(fn("courriels:nombreCourrielsSimules"), { a: MOI.email });
  await bureau.saisir('input[aria-label="Adresse e-mail"]', MOI.email);
  await attendre(200);
  await bureau.cliquer("Recevoir un lien");
  await bureau.quand(`document.querySelector('input[aria-label="Lien de connexion"]')`);
  const codeBureau = await dernierCode(MOI.email, avant);
  await bureau.saisir('input[aria-label="Lien de connexion"]', `klyra://connexion?code=${codeBureau}`);
  await attendre(200);
  await bureau.cliquer("Se connecter");
  verifier(await bureau.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Se déconnecter')", 30000), "bureau connecté au compte fictif");
  const connecteA = Date.now();
  await bureau.aller("/reglages?section=mobile");
  const ouvert = await bureau.quand(`${SECTION}?.innerText.includes('Ton téléphone voit cet ordinateur') && [...document.querySelectorAll('#reglage-mobile-chemin span')].some((s) => s.innerText.trim() === 'Ouvert')`, 25000);
  verifier(ouvert && Date.now() - connecteA <= 25000, `connecté : « Ton téléphone voit cet ordinateur » passe à « Ouvert » (${Math.round((Date.now() - connecteA) / 1000)} s)`);
  texte = await texteSection(bureau);
  verifier(texte.includes("Téléphone") && texte.includes("Ton compte KLYRA") && texte.includes("Cet ordinateur") && texte.includes("L’agent, sur cet ordinateur"), "chemin : téléphone › compte › cet ordinateur › agent");
  verifier(texte.includes("Aucun téléphone connecté à ton compte"), "aucun téléphone : MO-T6 (la session du bureau n'est pas listée)");
  verifier(texte.includes("L’adresse de KLYRA pour le téléphone n’est pas encore en ligne.") && !(await bureau.ev(`!!document.querySelector('svg[aria-label="QR de l’adresse de KLYRA"]')`)), "KLYRA_APP_URL absente : MO-T7, aucun QR");
  verifier(!texte.includes("Pose-la sur l’écran d’accueil"), "adresse absente : étapes 2 et 3 masquées");
  verifier(texte.includes("Aucun VPS relié à cet ordinateur"), "sans VPS : « Aucun VPS relié à cet ordinateur »");
  verifier(!/\bMac\b/.test(texte), "aucun « Mac » dans la section (poste Linux : « cet ordinateur »)");

  /* 3. Recherche : chaque mot mène à sa ligne et l'éclaire. */
  for (const [mot, ancre] of [["iphone", "mobile-chemin"], ["qr", "mobile-relier"], ["deconnecter", "mobile-telephones"], ["vps", "mobile-vps"]]) {
    await bureau.aller("/reglages?section=general");
    await chercher(bureau, mot);
    verifier(await bureau.quand(`document.querySelector('#reglage-${ancre}')?.hasAttribute('data-eclaire')`, 5000), `recherche « ${mot} » : la ligne ${ancre} s'éclaire`);
  }
  await bureau.aller("/reglages?section=mobile");

  /* 4. Le téléphone : une vraie page web (sans app de bureau), userAgent d'iPhone. */
  processusTelephone = spawn(ELECTRON, ["scripts/fenetre-web.cjs", `--remote-debugging-port=${PORT_TELEPHONE}`, ...process.argv.slice(2), `http://127.0.0.1:${PORT_WEB}/chats`, path.join(TMP, "telephone")], {
    cwd: APP,
    env: Object.fromEntries(Object.entries({ ...process.env, HOME: path.join(TMP, "home-tel") }).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE")),
    stdio: "ignore",
  });
  telephone = await piloter(PORT_TELEPHONE, (url) => url.startsWith(`http://127.0.0.1:${PORT_WEB}`));
  await telephone.ev(`localStorage.setItem('klyra:convex-local', ${JSON.stringify(CONVEX)}); localStorage.setItem('klyra:installer', 'navigateur'); location.reload()`);
  verifier(await telephone.quand("document.body.innerText.includes('Connecte-toi à KLYRA') && !window.klyra"), "téléphone : écran de connexion, sans app de bureau");
  avant = await admin.query(fn("courriels:nombreCourrielsSimules"), { a: MOI.email });
  /* Une minute entre deux liens pour la même adresse (délai du serveur). */
  for (;;) {
    await telephone.saisir('input[aria-label="Adresse e-mail"]', MOI.email);
    await attendre(200);
    await telephone.ev(`document.querySelector('form button[type=submit]').click()`);
    await attendre(1500);
    if ((await admin.query(fn("courriels:nombreCourrielsSimules"), { a: MOI.email })) > avant) break;
    await attendre(5000);
  }
  const codeTel = await dernierCode(MOI.email, avant);
  await telephone.ev(`location.href = ${JSON.stringify(`http://127.0.0.1:${PORT_WEB}/?code=${codeTel}`)}`);
  verifier(await telephone.quand("!document.body.innerText.includes('Connecte-toi à KLYRA') && document.body.innerText.includes('Chats')", 30000), "téléphone connecté par le lien simulé");

  /* 4 bis. « Ce téléphone » et les écrans du téléphone : le vrai poste, jamais « ton Mac » en dur. */
  /* La page change dans une transition de vue (socle mobile § 2.6) : dans cette fenêtre cachée, qui
     dessine peu, elle peut prendre plus d'une seconde. On attend la nouvelle adresse, puis son rendu. */
  const allerTel = async (chemin) => {
    await telephone.ev(`window.next.router.push(${JSON.stringify(chemin)})`);
    await telephone.quand(`location.pathname + location.search === ${JSON.stringify(chemin)}`, 10000);
    await attendre(1200);
  };
  /* `/reglages` liste les sections (T-22) ; « Ce téléphone » est la section Mobile. */
  await allerTel("/reglages?section=mobile");
  verifier(await telephone.quand("document.body.innerText.includes('Ce téléphone') && document.body.innerText.includes('Passe par ton compte, puis par')", 15000), "Ce téléphone : MO-T15");
  texte = await telephone.texte();
  verifier(texte.includes(MOI.email) && texte.includes("Se déconnecter de ce téléphone") && texte.includes("Ordinateurs") && texte.includes("KLYRA est ouverte sur"), "Ce téléphone : adresse, sortie, ordinateurs et leur état");
  const textesTel = [texte];
  for (const chemin of ["/plus", "/routines", "/equipe", "/projets", "/artefacts"]) {
    await allerTel(chemin);
    textesTel.push(await telephone.texte());
  }
  /* MO-T17 est la ligne Automatisations de Plus (`texteRoutines`). */
  verifier(textesTel[1].includes("Les routines se gèrent sur") && textesTel[1].includes("Celles d’un VPS y tournent même"), "Automatisations : MO-T17");
  verifier(textesTel.every((t) => !/ton Mac|Sur ton Mac/.test(t)), "téléphone : aucun « ton Mac » écrit en dur (poste Linux)");
  await allerTel("/chats");
  /* La pastille (socle mobile § 2.3) : « Ordinateur » sous Linux, son nom accessible finit par « État des ordinateurs ». */
  await telephone.ev(`[...document.querySelectorAll('header button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('État des ordinateurs'))?.click()`);
  verifier(await telephone.quand("[...document.querySelectorAll('[role=dialog]')].some((d) => d.innerText.includes('Ordinateurs'))", 5000), "feuille des ordinateurs (T-23) ouverte");
  verifier(!(await telephone.texte()).includes("Me prévenir"), "feuille du poste : plus de « Me prévenir à l’ouverture »");
  /* La feuille du socle se ferme par son ✕ (« Fermer », nom accessible). */
  await telephone.ev(`document.querySelector('[role=dialog] button[aria-label="Fermer"]')?.click()`);
  verifier(await telephone.quand("!document.querySelector('[role=dialog]')", 3000), "feuille des ordinateurs refermée par ✕");

  /* 5. Il apparaît sur le bureau sans recharger. */
  verifier(await bureau.quand(`${SECTION}?.innerText.includes('iPhone')`, 20000), "bureau : l'iPhone apparaît sans recharger");
  const ligneIphone = await bureau.ev(`[...document.querySelectorAll('.klyra-reglage')].find((l) => l.querySelector('span')?.innerText.trim() === 'iPhone')?.innerText ?? ''`);
  verifier(/Connecté le \d\d\/\d\d · vu à \d\d:\d\d/.test(ligneIphone), `ligne : « Connecté le … · vu à … » (${ligneIphone.split("\n")[1] ?? ""})`);

  /* 6. Seconde session web (client HTTP, navigateur), visible elle aussi. */
  const sessionB = await sessionHttp(MOI.email);
  await sessionB.mutation(fn("telephones:signaler"), { modele: "navigateur" });
  verifier(await bureau.quand(`${SECTION}?.innerText.includes('Navigateur web')`, 20000), "bureau : la seconde session web apparaît sans recharger");
  verifier(JSON.stringify(await lignesTelephones(bureau)) === JSON.stringify(["Navigateur web", "iPhone"]), "deux téléphones listés, le plus récent d'abord");

  /* 7. « Déconnecter » l'iPhone : confirmation, ligne retirée, téléphone sorti tout de suite. */
  await deconnecterLigne(bureau, "iPhone");
  verifier(await bureau.quand("document.querySelector('[role=alertdialog]')?.innerText.includes('Déconnecter cet iPhone ?')", 5000), "confirmation : « Déconnecter cet iPhone ? » (MO-T9)");
  await bureau.ev(`[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.innerText.trim() === 'Déconnecter').click()`);
  for (let i = 0; i < 40 && (await lignesTelephones(bureau)).includes("iPhone"); i++) await attendre(250);
  verifier(JSON.stringify(await lignesTelephones(bureau)) === JSON.stringify(["Navigateur web"]), "bureau : la ligne de l'iPhone disparaît");
  verifier(await bureau.quand("document.querySelector('main [aria-live=polite]')?.textContent === 'iPhone déconnecté'", 5000), "annonce : « iPhone déconnecté »");
  verifier(await telephone.quand("document.body.innerText.includes('Ce téléphone a été déconnecté depuis')", 15000), "téléphone : MO-T14 au-dessus du formulaire de connexion");
  texte = await telephone.texte();
  verifier(!texte.includes("ne fait plus partie de l’équipe") && texte.includes("Connecte-toi à KLYRA"), "téléphone : pas « Ce compte ne fait plus partie de l’équipe »");
  verifier(await telephone.ev("Object.keys(localStorage).filter((k) => k.startsWith('__convexAuth') && localStorage.getItem(k)).length === 0"), "téléphone : jetons de session effacés de la page");
  verifier(Array.isArray(await sessionB.query(fn("conversationsCompte:liste"), {})), "la seconde session reste ouverte");

  /* 8. Hors ligne : la page le dit, « Déconnecter » est désactivé. */
  execSync(`${SERVEUR} stop`, { stdio: "ignore" });
  verifier(await bureau.quand(`[...document.querySelectorAll('#reglage-mobile-chemin span')].some((s) => s.innerText.trim() === 'Hors ligne')`, 20000), "hors ligne : pastille « Hors ligne »");
  texte = await texteSection(bureau);
  verifier(texte.includes("Cet ordinateur n’est pas en ligne : ton téléphone le voit fermé.") && texte.includes("Possible quand cet ordinateur est en ligne") && texte.includes("Navigateur web"), "hors ligne : MO-T4, MO-T5, la liste garde ses valeurs");
  verifier(!(await deconnecterLigne(bureau, "Navigateur web")), "hors ligne : « Déconnecter » désactivé");
  execSync(`${SERVEUR} start`, { stdio: "ignore" });
  verifier(await bureau.quand(`[...document.querySelectorAll('#reglage-mobile-chemin span')].some((s) => s.innerText.trim() === 'Ouvert')`, 40000), "de retour en ligne : « Ouvert »");

  /* 9. Seconde session déconnectée : refusée tout de suite côté serveur. */
  await deconnecterLigne(bureau, "Navigateur web");
  await bureau.quand("document.querySelector('[role=alertdialog]')", 5000);
  await bureau.ev(`[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.innerText.trim() === 'Déconnecter').click()`);
  verifier(await bureau.quand(`${SECTION}?.innerText.includes('Aucun téléphone connecté à ton compte')`, 10000), "bureau : liste vide après la seconde déconnexion");
  const refus = await sessionB.query(fn("conversationsCompte:liste"), {}).then(() => "acceptée", (e) => String(e.message));
  verifier(refus.includes("non_connecte"), "seconde session : son jeton d'accès encore valable est refusé (non_connecte) sans attendre");
  verifier((await sessionB.query(fn("equipe:statutSession"), {})) === "session_fermee", "seconde session : statut « session_fermee »");
  await bureau.aller("/reglages?section=equipe");
  verifier(await bureau.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Se déconnecter')"), "le bureau reste connecté (sessions desktop intactes)");
  await bureau.aller("/reglages?section=mobile");

  /* 10. KLYRA_APP_URL d'essai : le QR se relit et donne l'adresse. */
  convexEnv(["set", "KLYRA_APP_URL", ADRESSE_ESSAI]);
  await bureau.aller("/reglages?section=general");
  await bureau.aller("/reglages?section=mobile");
  verifier(await bureau.quand(`!!document.querySelector('svg[aria-label="QR de l’adresse de KLYRA"]')`, 20000), "KLYRA_APP_URL d'essai : le QR s'affiche");
  const matrice = await lireQrAffiche(bureau);
  let relu = null;
  try {
    relu = lireQr(matrice);
  } catch {
    relu = null;
  }
  verifier(relu === ADRESSE_ESSAI, `le QR affiché se relit : ${relu}`);
  texte = await texteSection(bureau);
  verifier(texte.includes(ADRESSE_ESSAI) && texte.includes("Copier l’adresse") && texte.includes("Pose-la sur l’écran d’accueil") && texte.includes(`Connecte-toi avec ${MOI.email}`), "étapes 1 à 3, adresse écrite et copiable");
  convexEnv(["remove", "KLYRA_APP_URL"]);

  /* 11. Un VPS d'essai (adresse injoignable) : la chaîne le nomme, le groupe dit sa sonde et MO-T11. */
  await bureau.ev(`localStorage.setItem('klyra:serveurs', JSON.stringify({ actif: null, liste: [{ id: 'https://vps-essai.invalid', adresse: 'https://vps-essai.invalid', nom: 'VPS-essai', version: '0', etat: 'joint' }] })); window.dispatchEvent(new Event('klyra:carnet'))`);
  verifier(await bureau.quand(`${SECTION}?.innerText.includes('L’agent, sur cet ordinateur ou sur VPS-essai')`, 10000), "VPS relié : la chaîne nomme le VPS");
  verifier(await bureau.quand(`/Ne répond pas|Plus relié|Autre version/.test(${SECTION}?.innerText)`, 20000), "VPS : la sonde est affichée");
  texte = await texteSection(bureau);
  verifier(texte.includes("VPS-essai et ton téléphone") && texte.includes("Ses routines tournent même cet ordinateur fermé") && texte.includes("Ton téléphone ne lui écrit pas encore en direct."), "VPS : MO-T11");
  verifier(texte.includes("lance revoquer-tout sur le VPS"), "VPS : MO-T12 sous la liste");
  await bureau.ev(`localStorage.removeItem('klyra:serveurs'); window.dispatchEvent(new Event('klyra:carnet'))`);

  /* 12. Navigateur large, sans app de bureau : la coque composée à la tablette (rail), jamais le bureau et ses données d'exemple. */
  await telephone.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await telephone.ev(`location.href = ${JSON.stringify(`http://127.0.0.1:${PORT_WEB}/reglages?section=mobile`)}`);
  /* Le téléphone a été déconnecté à l'étape 7 : la connexion de la coque, pas MO-T1 du bureau. */
  verifier(
    await telephone.quand("document.documentElement.dataset.composition === 'tablette' && document.body.innerText.includes('Connecte-toi à KLYRA') && !document.body.innerText.includes('La page Mobile se règle')", 20000),
    "navigateur large : la coque à la tablette, jamais le bureau",
  );

  /* 13. Retiré de l'équipe par l'admin : le texte d'Équipe, rien d'autre. */
  const membres = await sessionAdmin.query(fn("equipe:membres"), {});
  await sessionAdmin.mutation(fn("equipe:retirer"), { membreId: membres.find((m) => m.email === MOI.email)._id });
  verifier(await bureau.quand(`${SECTION}?.innerText.includes('Ce compte ne fait plus partie de l’équipe')`, 15000), "retiré : « Ce compte ne fait plus partie de l’équipe »");
  verifier(!(await texteSection(bureau)).includes("Téléphones connectés"), "retiré : aucun autre groupe");
  verifier(bureau.erreurs.length === 0, `aucune exception dans la fenêtre du bureau${bureau.erreurs.length ? ` : ${bureau.erreurs[0]}` : ""}`);
} catch (e) {
  verifier(false, `le scénario s'est arrêté : ${e instanceof Error ? e.message : e}`);
} finally {
  telephone?.fermer();
  processusTelephone?.kill();
  await bureau?.fermer();
  serveurWeb.close();
  try {
    convexEnv(["remove", "KLYRA_APP_URL"]);
  } catch {
    /* déjà retirée */
  }
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s)` : "\nTout est bon.");
process.exit(echecs.length ? 1 : 0);
