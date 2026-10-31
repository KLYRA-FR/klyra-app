/**
 * Le menu « Plus d’options » d'une conversation d'équipe, dans l'app de bureau
 * (export statique), avec de vrais gestes clavier et souris : ouvrir, parcourir,
 * fermer (Échap, Tab, clic ailleurs), renommer (Entrée, clic ailleurs, Échap,
 * titre vide), ouvrir le projet. Le nouveau titre doit survivre à un
 * redémarrage, sans toucher aux messages, sessions, brouillon ni à la
 * conversation directe. Dossier personnel et données de l'app temporaires.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:conversation          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const APP = path.resolve(process.env.KLYRA_TEST_APP ?? path.resolve(import.meta.dirname, ".."));
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-conversation-"));
const DONNEES = path.join(TMP, "userdata");
const PORT = 9337;
const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─── Les données de départ ─────────────────────────────────────── */

const ID = "equipe-essai";
const TITRE = "Refonte de l’accueil";
const BROUILLON = "Brouillon à garder : vérifier la page d’accueil";
const il_y_a = (min) => new Date(Date.now() - min * 60_000).toISOString();
const DOSSIER_PROJET = path.join(TMP, "projet-essai");
mkdirSync(DOSSIER_PROJET, { recursive: true });
mkdirSync(DONNEES, { recursive: true });
const depart = {
  version: 1,
  chats: [
    { id: ID, kind: "equipe", projectId: "projet-essai", title: TITRE, roleIds: ["principal"], updatedAt: il_y_a(5), sessions: { principal: "session-equipe" }, luJusqua: "m2" },
    { id: "dm-principal", kind: "direct", projectId: null, title: "Principal", roleIds: ["principal"], updatedAt: il_y_a(30), sessions: { principal: "session-directe" }, luJusqua: "m3" },
    // Son projet a été retiré de l'app : la conversation reste.
    { id: "equipe-sans-projet", kind: "equipe", projectId: "projet-retire", title: "Ancienne conversation", roleIds: ["principal"], updatedAt: il_y_a(90), sessions: {}, luJusqua: null },
  ],
  messages: [
    { id: "m1", chatId: ID, author: { kind: "user" }, createdAt: il_y_a(6), parts: [{ type: "text", text: "Bonjour l’équipe, on refait l’accueil." }] },
    { id: "m2", chatId: ID, author: { kind: "role", roleId: "principal" }, createdAt: il_y_a(5), statut: "fait", parts: [{ type: "text", text: "C’est noté, je répartis." }] },
    { id: "m3", chatId: "dm-principal", author: { kind: "user" }, createdAt: il_y_a(30), parts: [{ type: "text", text: "Message direct à garder." }] },
  ],
  projects: [
    { id: "projet-essai", name: "Projet d’essai", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "", previewUrl: "", folder: DOSSIER_PROJET, files: [], updatedAt: il_y_a(60) },
  ],
};
const CONVERSATIONS = path.join(DONNEES, "conversations.json");
writeFileSync(CONVERSATIONS, JSON.stringify(depart));
const surDisque = () => JSON.parse(readFileSync(CONVERSATIONS, "utf8"));

/* ─── L'app et ses outils de pilotage ───────────────────────────── */

const env = { ...process.env, HOME: path.join(TMP, "home"), KLYRA_USER_DATA: DONNEES };
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
  // La fenêtre se comporte comme si elle avait le focus, même sous un écran virtuel.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
  for (let i = 0; i < 40 && !(await ev("document.body?.innerText.length > 0 && !!window.klyra")); i++) await attendre(500);
  return {
    erreurs,
    ev,
    async aller(chemin) {
      await ev(`window.next?.router ? window.next.router.push(${JSON.stringify(chemin)}) : (location.href = ${JSON.stringify(chemin)})`);
      await attendre(1500);
    },
    async touche(key, { code = key, vk = 0, texte } = {}) {
      await send("Input.dispatchKeyEvent", { type: texte ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: vk, text: texte });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
      await attendre(250);
    },
    async ecrire(texte) {
      await send("Input.insertText", { text: texte });
      await attendre(150);
    },
    async cliquerEn(x, y) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      await attendre(300);
    },
    async cliquer(selecteur) {
      const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(selecteur)})?.getBoundingClientRect(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      if (!r) throw new Error(`introuvable : ${selecteur}`);
      await this.cliquerEn(r.x, r.y);
    },
    fermer() {
      ws.close();
      processus.kill();
      return new Promise((r) => processus.once("exit", r));
    },
  };
}

const BOUTON = 'main header button[aria-label="Plus d’options"]';
const etat = (a) =>
  a.ev(`(() => {
    const b = document.querySelector(${JSON.stringify(BOUTON)});
    const menu = document.querySelector('[role="menu"][aria-label="Options de la conversation"]');
    const focus = document.activeElement;
    return {
      bouton: !!b,
      ouvert: b?.getAttribute("aria-expanded") === "true",
      haspopup: b?.getAttribute("aria-haspopup"),
      menu: !!menu,
      lignes: menu ? [...menu.querySelectorAll('[role="menuitem"]')].map((l) => l.innerText.trim().split("\\n")[0]) : [],
      focus: focus?.getAttribute("aria-label") ?? focus?.innerText?.trim() ?? focus?.tagName,
      titre: document.querySelector("main header h1")?.innerText ?? null,
      champ: document.querySelector('main header input[aria-label="Nom de la conversation"]') ? { valeur: document.activeElement?.value, selection: document.activeElement?.selectionEnd - document.activeElement?.selectionStart, focus: document.activeElement?.getAttribute("aria-label") } : null,
      brouillon: document.querySelector("main textarea")?.value ?? null,
      messages: document.querySelector("main")?.innerText.includes("Bonjour l’équipe, on refait l’accueil.") && document.querySelector("main")?.innerText.includes("C’est noté, je répartis."),
      onglet: document.querySelector('[role="tablist"][aria-label="Conversations ouvertes"] [aria-selected="true"]')?.innerText ?? null,
      page: location.pathname + location.search,
    };
  })()`);
/** La place et la typo du titre (ou du champ qui le remplace), et la hauteur de l'en-tête. */
const mesure = (a) =>
  a.ev(`(() => {
    const t = document.querySelector('main header input[aria-label="Nom de la conversation"]') ?? document.querySelector("main header h1");
    const r = t.getBoundingClientRect();
    const s = getComputedStyle(t);
    return { x: r.x, y: r.y, l: r.width, h: r.height, police: s.fontSize + " " + s.fontWeight + " " + s.fontFamily, entete: document.querySelector("main header").getBoundingClientRect().height };
  })()`);
const ENTREE = { code: "Enter", vk: 13, texte: "\r" };

let app;
try {
  app = await lancer();
  verifier((await app.ev("typeof window.klyra")) === "object", "l’app de bureau démarre sur le profil d’essai");
  await app.ev(`localStorage.setItem("klyra-brouillons", ${JSON.stringify(JSON.stringify({ [ID]: { text: BROUILLON, fichiers: [] } }))})`);
  await app.aller(`/chat?id=${ID}`);

  let e = await etat(app);
  verifier(e.bouton && e.haspopup === "menu" && !e.ouvert && !e.menu, "le « … » de l’en-tête est un bouton de menu, fermé au départ");
  verifier(e.titre === TITRE && e.brouillon === BROUILLON && e.messages, "titre, messages et brouillon de la conversation affichés");
  // En-tête et fil : l'avatar de l'agent est le visuel de sa fiche (formes), jamais une initiale.
  const avatars = await app.ev(
    `[...document.querySelectorAll('main header [data-avatar-agent], main section [data-avatar-agent]')].map((a) => ({ id: a.dataset.avatarAgent, formes: !!a.querySelector('svg'), texte: a.innerText.trim() }))`,
  );
  verifier(
    avatars.length >= 2 && avatars.every((a) => a.id === "principal" && a.formes && !a.texte),
    `avatars de l’assistant (en-tête, fil) : le visuel de sa fiche, sans initiale (${avatars.length})`,
  );

  /* Clavier : Entrée ouvre, les flèches parcourent en boucle, Début / Fin, Échap rend le focus. */
  await app.ev(`document.querySelector(${JSON.stringify(BOUTON)}).focus()`);
  await app.touche("Enter", ENTREE);
  e = await etat(app);
  verifier(e.ouvert && e.menu && e.focus === "Renommer", "Entrée ouvre le menu, focus sur sa première ligne");
  verifier(JSON.stringify(e.lignes) === JSON.stringify(["Renommer", "Épingler", "Exporter en Markdown…", "Ouvrir le projet"]), `menu de conversation : ${e.lignes.join(", ")}`);
  await app.touche("ArrowDown", { vk: 40 });
  const bas = (await etat(app)).focus;
  await app.touche("ArrowDown", { vk: 40 });
  const exporter = (await etat(app)).focus;
  await app.touche("ArrowDown", { vk: 40 });
  const projet = (await etat(app)).focus;
  await app.touche("ArrowDown", { vk: 40 });
  const boucle = (await etat(app)).focus;
  await app.touche("End", { vk: 35 });
  const fin = (await etat(app)).focus;
  await app.touche("Home", { vk: 36 });
  const debut = (await etat(app)).focus;
  verifier(bas === "Épingler" && exporter === "Exporter en Markdown…" && projet === "Ouvrir le projet" && boucle === "Renommer" && fin === "Ouvrir le projet" && debut === "Renommer", "quatre lignes, flèches en boucle, Début et Fin");
  await app.touche("Escape", { vk: 27 });
  e = await etat(app);
  verifier(!e.menu && !e.ouvert && e.focus === "Plus d’options", "Échap ferme le menu et rend le focus au bouton");

  await app.touche("ArrowDown", { vk: 40 });
  e = await etat(app);
  verifier(e.menu && e.focus === "Renommer", "flèche bas sur le bouton : le menu s’ouvre");
  await app.touche("Tab", { vk: 9 });
  e = await etat(app);
  verifier(!e.menu && e.focus === "Plus d’options", "Tab ferme le menu et rend le focus au bouton");

  /* Souris : clic sur le bouton, puis clic ailleurs ; un second clic sur le bouton referme. */
  await app.cliquer(BOUTON);
  verifier((await etat(app)).menu, "un clic ouvre le menu");
  await app.cliquer("main header h1");
  verifier(!(await etat(app)).menu, "un clic ailleurs ferme le menu");
  await app.cliquer(BOUTON);
  await app.cliquer(BOUTON);
  verifier(!(await etat(app)).menu, "un second clic sur le bouton referme le menu");

  /* Renommer au clavier : Échap n'enregistre rien, Entrée enregistre et rend le focus. */
  await app.ev(`document.querySelector(${JSON.stringify(BOUTON)}).focus()`);
  const avant = await mesure(app);
  await app.touche("Enter", ENTREE);
  await app.touche("Enter", ENTREE);
  e = await etat(app);
  verifier(!e.menu && e.champ?.focus === "Nom de la conversation" && e.champ.valeur === TITRE && e.champ.selection === TITRE.length, "« Renommer » : champ en place, titre sélectionné");
  const pendant = await mesure(app);
  const immobile = ["x", "y", "l", "h", "entete"].every((k) => Math.abs(pendant[k] - avant[k]) < 0.5) && pendant.police === avant.police;
  verifier(immobile, `le champ garde la place et la typo du titre, l’en-tête ne bouge pas${immobile ? "" : ` (${JSON.stringify(avant)} → ${JSON.stringify(pendant)})`}`);
  await app.ecrire("Titre abandonné");
  await app.touche("Escape", { vk: 27 });
  e = await etat(app);
  verifier(e.titre === TITRE && !e.champ && e.focus === "Plus d’options", "Échap annule le renommage et rend le focus au bouton");

  await app.touche("Enter", ENTREE);
  await app.touche("Enter", ENTREE);
  await app.ecrire("Accueil, version 2");
  await app.touche("Enter", ENTREE);
  e = await etat(app);
  verifier(
    e.titre === "Accueil, version 2" && !e.champ && e.focus === "Plus d’options",
    `Entrée enregistre le nouveau titre et rend le focus au bouton (titre : ${e.titre}, focus : ${e.focus})`,
  );
  verifier(e.onglet === "Accueil, version 2", "l’onglet de la conversation suit le nouveau titre");

  /* Un titre vide ne remplace rien. */
  await app.touche("Enter", ENTREE);
  await app.touche("Enter", ENTREE);
  await app.touche("Backspace", { vk: 8 });
  await app.touche("Enter", ENTREE);
  e = await etat(app);
  verifier(e.titre === "Accueil, version 2" && !e.champ, `un titre vide garde l’ancien titre (titre : ${e.titre})`);

  /* Renommer à la souris : un clic ailleurs enregistre (espaces nettoyés). */
  await app.cliquer(BOUTON);
  await app.cliquer('[role="menu"] [role="menuitem"]');
  await app.ecrire("  Accueil   final  ");
  await app.cliquer("main textarea");
  e = await etat(app);
  const TITRE_FINAL = "Accueil final";
  verifier(e.titre === TITRE_FINAL && !e.champ, "clic ailleurs : le titre est gardé, espaces nettoyés");
  verifier(e.brouillon === BROUILLON && e.messages, "brouillon et messages intacts après les renommages");

  /* Sur le disque : seul le titre a changé. */
  await attendre(1500);
  const apres = surDisque();
  const conv = apres.chats.find((c) => c.id === ID);
  verifier(conv?.title === TITRE_FINAL, "le titre est enregistré dans conversations.json");
  verifier(
    JSON.stringify({ ...conv, title: TITRE }) === JSON.stringify(depart.chats[0]),
    "le reste de la conversation (sessions, date, lecture, projet) est inchangé",
  );
  verifier(JSON.stringify(apres.chats.find((c) => c.id === "dm-principal")) === JSON.stringify(depart.chats[1]), "la conversation directe est intacte");
  verifier(JSON.stringify(apres.messages) === JSON.stringify(depart.messages), "les messages sont intacts");

  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` (${app.erreurs.join(" | ")})` : ""}`);
  await app.fermer();

  /* Après un redémarrage. */
  app = await lancer();
  await app.aller(`/chat?id=${ID}`);
  e = await etat(app);
  verifier(e.titre === TITRE_FINAL && e.brouillon === BROUILLON && e.messages, "après redémarrage : nouveau titre, brouillon et messages");

  await app.cliquer(BOUTON);
  await app.cliquer('[role="menu"] [role="menuitem"]:last-child');
  await attendre(1000);
  verifier((await etat(app)).page === "/projet?id=projet-essai", "« Ouvrir le projet » mène à la page du projet");

  /* Projet retiré : renommage et épingle restent disponibles, sans ligne projet grisée. */
  await app.aller("/chat?id=equipe-sans-projet");
  await app.cliquer(BOUTON);
  e = await etat(app);
  const enfants = await app.ev(`document.querySelector('[role="menu"][aria-label="Options de la conversation"]')?.children.length`);
  verifier(JSON.stringify(e.lignes) === JSON.stringify(["Renommer", "Épingler", "Exporter en Markdown…"]) && enfants === 3, `sans projet : renommage, épingle et export (${e.lignes.join(", ")})`);
  await app.touche("Escape", { vk: 27 });

  await app.aller("/chat?id=dm-principal");
  await app.cliquer(BOUTON);
  e = await etat(app);
  verifier(e.bouton && JSON.stringify(e.lignes) === JSON.stringify(["Exporter en Markdown…"]), "la conversation directe propose seulement l’export dans son menu");
  await app.touche("Escape", { vk: 27 });
  verifier(app.erreurs.length === 0, `aucune erreur dans la page après redémarrage${app.erreurs.length ? ` (${app.erreurs.join(" | ")})` : ""}`);
} catch (e) {
  verifier(false, `le test a planté : ${e instanceof Error ? e.message : e}`);
} finally {
  await app?.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout passe.");
process.exit(echecs.length ? 1 : 0);
