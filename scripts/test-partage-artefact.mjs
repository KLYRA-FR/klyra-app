/**
 * « Partager avec l'équipe » d'un artefact claude.ai (#127, critères de la spec d'Iris §10), entre deux
 * comptes fictifs, chacun sur son ordinateur (deux profils jetables ouverts en même temps), avec un
 * backend Convex local et jetable (jamais un vrai déploiement) et des e-mails simulés :
 * - la fenêtre s'ouvre au centre, focus sur Annuler, la carte ne bouge pas ; titre de 80 caractères
 *   sans mot coupé ; Échap, Annuler et le voile ferment sans rien partager, focus rendu à l'icône ;
 * - hors ligne : bouton inactif et sa raison, qui partent avec le retour du réseau ;
 * - envoi : « Partage… », Annuler inactif, Échap et le voile sans effet ; puis fenêtre fermée,
 *   annonce, puce « Équipe », focus sur l'aperçu, une seule ligne Convex ;
 * - erreur du serveur (titre trop long) : bloc d'alerte, « Réessayer » focalisé, rien de partagé ;
 * - Bruno partage le même lien pendant que la fenêtre d'Alice est ouverte : « Déjà partagé avec
 *   l'équipe », son nom, un seul bouton « Fermer », puis focus sur l'aperçu.
 * Prérequis : `pnpm build && pnpm build:electron`, puis les variables du backend local
 * (KLYRA_TEST_CONVEX_URL, KLYRA_TEST_CONVEX_ADMIN_KEY, KLYRA_TEST_CONVEX_SERVEUR, cf. test-profil).
 * `KLYRA_CAPTURES=<dossier>` garde une capture de chaque état.
 *   pnpm test:partage-artefact          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const CONVEX = process.env.KLYRA_TEST_CONVEX_URL;
const CLE_ADMIN = process.env.KLYRA_TEST_CONVEX_ADMIN_KEY;
const SERVEUR = process.env.KLYRA_TEST_CONVEX_SERVEUR;
if (!CONVEX || !CLE_ADMIN || !SERVEUR) {
  console.log("Backend Convex local absent (KLYRA_TEST_CONVEX_URL, KLYRA_TEST_CONVEX_ADMIN_KEY, KLYRA_TEST_CONVEX_SERVEUR) : test sauté.");
  process.exit(0);
}

const APP = path.resolve(import.meta.dirname, "..");
const CAPTURES = process.env.KLYRA_CAPTURES;
const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-partage-artefact-"));
const q = JSON.stringify;
const SUFFIXE = Math.random().toString(36).slice(2, 8);

/* ─── Les artefacts de départ ───────────────────────────────────── */

const lien = (cle) => `https://claude.ai/artifact/essai-${SUFFIXE}-${cle}`;
/** 80 caractères : le plus long titre que le serveur accepte (`nettoyerNom`). */
const LONG = { id: "a-long", titre: "Bouchon des Pentes à l’aveugle : carte des menus, des vins et des dîners de jazz", url: lien("long") };
/** 85 caractères : le serveur refuse (`nom_invalide`), ce qui donne une vraie erreur. */
const TROP_LONG = { id: "a-trop-long", titre: "Bouchon des Pentes à l’aveugle : la carte des menus, des vins et des soirées du jeudi", url: lien("trop-long") };
const MARIAGE = { id: "a-mariage", titre: "Plan de table du mariage Durand", url: lien("mariage") };
if (LONG.titre.length !== 80 || TROP_LONG.titre.length <= 80) throw new Error("titres d’essai mal mesurés");

function profil(nom, artefacts) {
  const racine = path.join(TMP, nom);
  const home = path.join(racine, "home");
  const donnees = path.join(racine, "userdata");
  for (const d of [path.join(home, ".claude", "agents"), donnees]) mkdirSync(d, { recursive: true });
  const ajouteLe = new Date().toISOString();
  writeFileSync(
    path.join(donnees, "conversations.json"),
    q({
      version: 1,
      chats: [], messages: [], projects: [], routines: [], taches: [], evenements: [], categories: [], workflows: [], executions: [], rendus: [],
      artefacts: artefacts.map((a) => ({ ...a, description: "", projectId: null, ajouteLe, source: "manuel" })),
      artefactsClaude: true,
    }),
  );
  return {
    // Une galerie claude.ai vide : la relecture de l'écran ne sort pas vers claude.ai.
    env: { HOME: home, KLYRA_USER_DATA: donnees, KLYRA_CONVEX_URL: CONVEX, KLYRA_TEST_TROUSSEAU: "1", KLYRA_TEST_GALERIE: "data:text/html,<p>Galerie vide</p>" },
  };
}

/* ─── Le compte d'équipe local ──────────────────────────────────── */

const admin = new ConvexHttpClient(CONVEX);
admin.setAdminAuth(CLE_ADMIN);
const ALICE = { email: `alice-${SUFFIXE}@exemple.test`, nom: "Alice Test" };
const BRUNO = { email: `bruno-${SUFFIXE}@exemple.test`, nom: "Bruno Test" };
const courrielsRecus = (email) => admin.query(makeFunctionReference("courriels:nombreCourrielsSimules"), { a: email });

async function demarrer(a) {
  if (await a.quand("document.querySelector('main')?.innerText.includes('donne un nom')", 4000)) await a.cliquer("Garder « Assistant »");
  await attendre(800);
}
async function seConnecter(a, qui) {
  await a.aller("/reglages?section=equipe");
  await a.quand(`document.querySelector('input[aria-label="Adresse e-mail"]')`);
  const avant = await courrielsRecus(qui.email);
  await a.saisir('input[aria-label="Adresse e-mail"]', qui.email);
  await attendre(200);
  await a.cliquer("Recevoir un lien");
  await a.quand(`document.querySelector('input[aria-label="Lien de connexion"]')`);
  let nouveau = false;
  for (let i = 0; i < 20 && !nouveau; i++) {
    nouveau = (await courrielsRecus(qui.email)) > avant;
    if (!nouveau) await attendre(500);
  }
  const courriel = nouveau ? await admin.query(makeFunctionReference("courriels:dernierCourrielSimule"), { a: qui.email }) : null;
  const code = courriel?.texte.match(/\?code=([A-Za-z0-9]+)/)?.[1] ?? null;
  if (!code) throw new Error(`aucun lien simulé pour ${qui.email}`);
  await a.saisir('input[aria-label="Lien de connexion"]', `klyra://connexion?code=${code}`);
  await attendre(200);
  await a.cliquer("Se connecter");
  return a.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Se déconnecter')", 30000);
}
function lignesConvex() {
  const env = { ...process.env, CONVEX_SELF_HOSTED_URL: CONVEX, CONVEX_SELF_HOSTED_ADMIN_KEY: CLE_ADMIN };
  const sortie = execFileSync("corepack", ["pnpm", "exec", "convex", "data", "artefactsEquipe", "--format", "jsonArray", "--limit", "200"], { cwd: APP, env, encoding: "utf8" });
  const debut = sortie.indexOf("[");
  return debut < 0 ? [] : JSON.parse(sortie.slice(debut));
}
const partagesDe = (url) => lignesConvex().filter((l) => l.url === url && l.retireLe === null);

/* ─── Gestes dans l'app ─────────────────────────────────────────── */

const carte = (a) => `[...document.querySelectorAll('main li')].find((li) => li.querySelector(${q(`button[aria-label="Ouvrir ${a.titre}"]`)}))`;
const iconePartage = (a) => `${carte(a)}?.querySelector('button[aria-label="Partager avec l’équipe"]')`;
const FENETRE = "document.querySelector('[role=alertdialog]')";
const boutons = (a) => a.ev(`[...(${FENETRE}?.querySelectorAll('button') ?? [])].map((b) => ({ texte: b.innerText.trim(), inactif: b.disabled, focus: b === document.activeElement }))`);
const focus = (a) => a.ev("document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.innerText?.trim() ?? null");

/** Un vrai clic de souris au centre de l'élément (survol compris). */
async function clicReel(a, expression) {
  const p = await a.ev(`(() => { const el = ${expression}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) return false;
  await a.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await a.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await a.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  return true;
}
async function ouvrir(a, artefact) {
  await a.ev(`${carte(artefact)}?.scrollIntoView({ block: "center" }); 0`);
  await attendre(200);
  if (!(await clicReel(a, iconePartage(artefact))) || !(await a.quand(FENETRE, 5000))) return false;
  // La fenêtre entre en 220 ms (échelle 0,98 → 1) : on la mesure une fois posée.
  return a.quand(`!${FENETRE}.getAnimations().some((x) => x.playState === 'running')`, 3000);
}
/** Le texte rendu, un saut de ligne entre deux blocs (`innerText` en met deux autour d'un `<p>`). */
const lignes = (expression) => `(${expression})?.innerText.replace(/\\n+/g, "\\n")`;
async function capturer(a, nom) {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  const { data } = await a.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(CAPTURES, `${nom}.png`), Buffer.from(data, "base64"));
}
const serveur = (action) => execSync(`${SERVEUR} ${action}`, { stdio: "ignore" });

/* ─── Le scénario ───────────────────────────────────────────────── */

await admin.mutation(makeFunctionReference("equipe:initialiser"), { admins: [ALICE, BRUNO] });
const alice = await lancerApp({ port: 9371, env: profil("alice", [LONG, TROP_LONG, MARIAGE]).env });
/* Bruno n'est ouvert que le temps de son partage : sa fenêtre recouvrirait celle d'Alice, dont la page
   cesserait de dessiner (plus d'images, donc plus de requestAnimationFrame). */
let bruno = null;

try {
  await demarrer(alice);
  verifier(await seConnecter(alice, ALICE), "Alice se connecte au compte d’équipe local");
  await alice.aller("/artefacts");
  await alice.quand(iconePartage(MARIAGE), 20000);

  /* 1-3 : la fenêtre, ses textes, la carte qui ne bouge pas. */
  verifier(await alice.quand(iconePartage(LONG)), "l’icône de partage est sur la carte (équipe prête, lien claude.ai)");
  verifier((await alice.ev(`${iconePartage(LONG)}?.getAttribute('aria-haspopup')`)) === "dialog", "l’icône annonce une fenêtre (aria-haspopup=\"dialog\")");
  const avant = await alice.ev(`(() => { const li = ${carte(LONG)}; return { hauteur: li.getBoundingClientRect().height, texte: li.innerText }; })()`);
  verifier(await ouvrir(alice, LONG), "un clic sur l’icône ouvre une fenêtre role=\"alertdialog\"");
  const fenetre = await alice.ev(`(() => {
    const d = ${FENETRE};
    const r = d.getBoundingClientRect();
    const titre = document.getElementById(d.getAttribute('aria-labelledby'));
    const texte = document.getElementById(d.getAttribute('aria-describedby'));
    return { largeur: r.width, centre: Math.abs(r.x + r.width / 2 - innerWidth / 2) < 2 && Math.abs(r.y + r.height / 2 - innerHeight / 2) < 2,
      modal: d.getAttribute('aria-modal'), titre: titre?.innerText, texte: ${lignes("texte")}, boutonDansTexte: !!texte?.querySelector('button') };
  })()`);
  verifier(fenetre.largeur === 400 && fenetre.centre && fenetre.modal === "true", `fenêtre de 400 px, centrée, aria-modal (${fenetre.largeur} px)`);
  verifier(fenetre.titre === `Partager « ${LONG.titre} » avec l’équipe ?`, "titre : Partager « {titre} » avec l’équipe ?");
  verifier(
    fenetre.texte === "Chacun verra ce lien dans l’onglet Équipe.\nPour l’ouvrir, il faut aussi que l’artefact soit partagé sur claude.ai.",
    `texte : la phrase puis la note claude.ai (${q(fenetre.texte)})`,
  );
  const motsCoupes = await alice.ev(`(() => {
    const d = ${FENETRE};
    const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    const coupes = [];
    while (w.nextNode()) {
      const t = w.currentNode;
      for (const m of t.data.matchAll(/\\S+/g)) {
        r.setStart(t, m.index);
        r.setEnd(t, m.index + m[0].length);
        if (new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1) coupes.push(m[0]);
      }
    }
    return coupes;
  })()`);
  verifier(motsCoupes.length === 0 && !fenetre.boutonDansTexte, `titre de 80 caractères : aucun mot coupé, aucun bouton dans le texte (${motsCoupes.join(", ")})`);
  verifier((await focus(alice)) === "Annuler", "focus sur Annuler à l’ouverture");
  const apres = await alice.ev(`(() => { const li = ${carte(LONG)}; return { hauteur: li.getBoundingClientRect().height, texte: li.innerText }; })()`);
  verifier(apres.hauteur === avant.hauteur && apres.texte === avant.texte, "la carte ne bouge pas et ne reçoit aucun bloc de confirmation");
  await capturer(alice, "1-confirmation");

  /* 7 : Échap, Annuler, voile : rien n'est appelé, focus rendu à l'icône. */
  await alice.touche("Escape", "Escape", 27);
  verifier((await alice.quand(`!${FENETRE}`, 3000)) && (await alice.quand(`document.activeElement === ${iconePartage(LONG)}`, 2000)), "Échap ferme, focus rendu à l’icône");
  await ouvrir(alice, LONG);
  await clicReel(alice, `[...${FENETRE}.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Annuler')`);
  verifier((await alice.quand(`!${FENETRE}`, 3000)) && (await alice.quand(`document.activeElement === ${iconePartage(LONG)}`, 2000)), "Annuler ferme, focus rendu à l’icône");
  await ouvrir(alice, LONG);
  // Un coin du voile, loin de la fenêtre.
  const coin = { x: 24, y: (await alice.ev("innerHeight")) - 24 };
  await alice.send("Input.dispatchMouseEvent", { type: "mousePressed", ...coin, button: "left", clickCount: 1 });
  await alice.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...coin, button: "left", clickCount: 1 });
  verifier((await alice.quand(`!${FENETRE}`, 3000)) && (await alice.quand(`document.activeElement === ${iconePartage(LONG)}`, 2000)), "un clic sur le voile ferme, focus rendu à l’icône");
  verifier(partagesDe(LONG.url).length === 0, "après Échap, Annuler et voile : rien de partagé");

  /* 5.6 : hors ligne, le bouton attend le réseau. */
  await ouvrir(alice, LONG);
  serveur("stop");
  const horsLigne = await alice.quand(`${FENETRE}?.innerText.includes('Hors ligne : tu pourras partager quand le réseau reviendra.')`, 10000);
  const pendantCoupure = await boutons(alice);
  verifier(horsLigne && pendantCoupure.find((b) => b.texte === "Partager")?.inactif === true, "hors ligne : « Partager » inactif, avec sa raison");
  await capturer(alice, "2-hors-ligne");
  serveur("start");
  verifier(
    await alice.quand(`!${FENETRE}?.innerText.includes('Hors ligne') && [...${FENETRE}.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Partager' && !b.disabled)`, 30000),
    "réseau revenu : la raison disparaît, le bouton revient",
  );

  /* 4 : l'envoi, puis le succès. Les gestes pendant l'envoi partent avant toute réponse du serveur. */
  const envoi = await alice.ev(`(async () => {
    const d = ${FENETRE};
    const b = [...d.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Partager');
    b.focus();
    b.click();
    for (let i = 0; i < 50 && b.innerText.trim() !== 'Partage…'; i++) await Promise.resolve();
    const annuler = [...d.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Annuler');
    const etat = { texte: b.innerText.trim(), aria: b.getAttribute('aria-disabled'), disabled: b.disabled, annulerInactif: !!annuler?.disabled, focus: document.activeElement === b };
    d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    d.parentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    b.click();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    etat.ouverte = document.contains(d);
    return etat;
  })()`);
  verifier(envoi.texte === "Partage…" && envoi.aria === "true" && !envoi.disabled && envoi.focus, `envoi : « Partage… », aria-disabled, focus gardé (${q(envoi)})`);
  verifier(envoi.annulerInactif && envoi.ouverte, "envoi : Annuler inactif, Échap et le voile ne ferment pas");
  verifier(await alice.quand(`!${FENETRE}`, 15000), "partage abouti : la fenêtre se ferme");
  verifier(
    await alice.quand(`document.querySelector('[data-annonces-agents]')?.textContent === ${q(`« ${LONG.titre} » partagé avec l’équipe.`)}`, 3000),
    `annonce pour le lecteur d’écran (${q(await alice.ev("document.querySelector('[data-annonces-agents]')?.textContent"))})`,
  );
  verifier(await alice.quand(`!!${carte(LONG)}?.querySelector('span[title="Tu l’as partagé avec l’équipe"]') && !${iconePartage(LONG)}`, 5000), "la puce « Équipe » arrive, l’icône de partage part");
  verifier(await alice.quand(`document.activeElement?.getAttribute('aria-label') === ${q(`Ouvrir ${LONG.titre}`)}`, 2000), "focus sur l’aperçu de la carte");
  verifier(partagesDe(LONG.url).length === 1, "une seule ligne partagée malgré le second clic pendant l’envoi");
  await capturer(alice, "3-partage");

  /* 5 : une erreur du serveur. */
  verifier(await ouvrir(alice, TROP_LONG), "fenêtre ouverte sur un artefact au titre trop long");
  await alice.cliquer("Partager", FENETRE);
  verifier(await alice.quand(`${FENETRE}?.querySelector('[role=alert]')`, 10000), "erreur : un bloc role=\"alert\"");
  const alerte = await alice.ev(lignes(`${FENETRE}.querySelector('[role=alert]')`));
  verifier(alerte === "Le partage n’a pas abouti. Rien n’a été partagé.\nLe nom doit faire entre 1 et 80 caractères, le rôle 80 au plus.", `erreur : la phrase puis le message du serveur (${q(alerte)})`);
  const enErreur = await boutons(alice);
  verifier(enErreur.some((b) => b.texte === "Réessayer" && b.focus) && enErreur.some((b) => b.texte === "Annuler" && !b.inactif), "erreur : « Réessayer » focalisé, Annuler actif");
  verifier(partagesDe(TROP_LONG.url).length === 0, "erreur : rien de partagé");
  await capturer(alice, "4-erreur");
  await alice.cliquer("Réessayer", FENETRE);
  verifier(await alice.quand(`${FENETRE}?.querySelector('[role=alert]') && [...${FENETRE}.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Réessayer' && b === document.activeElement)`, 10000), "Réessayer relance l’envoi et revient à l’erreur");
  await alice.cliquer("Annuler", FENETRE);
  verifier(await alice.quand(`!${FENETRE}`, 3000), "Annuler ferme après l’erreur");

  /* 6 : Bruno partage le même lien pendant que la fenêtre d'Alice est ouverte. */
  verifier(await ouvrir(alice, MARIAGE), "Alice ouvre la fenêtre sur le plan de table");
  bruno = await lancerApp({ port: 9372, env: profil("bruno", [MARIAGE]).env });
  await demarrer(bruno);
  verifier(await seConnecter(bruno, BRUNO), "Bruno se connecte au compte d’équipe local");
  await bruno.aller("/artefacts");
  await bruno.quand(iconePartage(MARIAGE), 20000);
  verifier(await ouvrir(bruno, MARIAGE), "Bruno ouvre la sienne sur le même lien");
  await bruno.cliquer("Partager", FENETRE);
  verifier(await bruno.quand(`!${FENETRE}`, 15000), "Bruno l’a partagé");
  verifier(bruno.erreurs.length === 0, `aucune exception chez Bruno (${bruno.erreurs.join(" | ")})`);
  await bruno.fermer();
  bruno = null;
  verifier(await alice.quand(`${FENETRE}?.innerText.includes('Déjà partagé avec l’équipe')`, 15000), "fenêtre d’Alice : « Déjà partagé avec l’équipe »");
  const deja = await alice.ev(`(() => { const d = ${FENETRE}; return document.getElementById(d.getAttribute('aria-describedby'))?.innerText; })()`);
  verifier(deja === "Bruno Test l’a déjà partagé : il est dans l’onglet Équipe.", `texte : qui l’a partagé (${q(deja)})`);
  const dejaBoutons = await boutons(alice);
  verifier(dejaBoutons.length === 1 && dejaBoutons[0].texte === "Fermer" && dejaBoutons[0].focus, "un seul bouton, « Fermer », focalisé");
  await capturer(alice, "5-deja-partage");
  await clicReel(alice, `${FENETRE}.querySelector('button')`);
  verifier(await alice.quand(`!${FENETRE}`, 3000), "Fermer ferme la fenêtre");
  verifier(await alice.quand(`document.activeElement?.getAttribute('aria-label') === ${q(`Ouvrir ${MARIAGE.titre}`)}`, 2000), "l’icône n’est plus là : focus sur l’aperçu");
  verifier(partagesDe(MARIAGE.url).length === 1, "une seule ligne pour ce lien, celle de Bruno");

  verifier(alice.erreurs.length === 0, `aucune exception chez Alice (${alice.erreurs.join(" | ")})`);
} finally {
  await alice.fermer();
  await bruno?.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout est bon.");
process.exit(echecs.length ? 1 : 0);
