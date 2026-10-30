/**
 * Point 9 : les dix gestes de SPEC-EPINGLAGE.md dans l'export Electron.
 * Profil, HOME, projets et conversations fictifs ; Claude inaccessible, aucun
 * agent ni notification réelle. CDP envoie les clics/touches dans cette seule
 * fenêtre. Date est contrôlée, les minuteurs de sauvegarde restent réels.
 * Prérequis : pnpm build && pnpm build:electron.
 *   xvfb-run -a node scripts/test-epinglage.mjs
 * KLYRA_TEST_APP permet de vérifier un autre checkout déjà construit.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const fixes = ["/usr/local/bin/claude", "/opt/homebrew/bin/claude", "/usr/bin/claude", "/bin/claude"].filter(existsSync);
if (fixes.length) throw new Error(`Test refusé : Claude reste accessible à ${fixes.join(", ")}`);
const APP = path.resolve(process.env.KLYRA_TEST_APP ?? path.resolve(import.meta.dirname, ".."));
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-epinglage-"));
const DONNEES = path.join(TMP, "userdata"), MAISON = path.join(TMP, "home");
const FICHIER = path.join(DONNEES, "conversations.json");
const PLANNING = path.join(MAISON, ".klyra", "planning", "planning.md");
const PORT = 9349;
const INSTANT = Date.parse("2026-10-30T22:36:00.000Z");
const q = JSON.stringify, memes = (a, b) => q(a) === q(b);
const attendre = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const echecs = [];
let controles = 0, app;
function verifier(ok, message) {
  controles++;
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
}
const date = (minutes) => new Date(INSTANT - minutes * 60000).toISOString();
const titres = { A: "A · Recherche devis", B: "B · Recherche maquette", C: "C · Recherche livraison", D: "D · Recherche ancienne", E: "E · Conversation au titre volontairement long pour contrôler son épingle ".padEnd(80, "x"), F: "F · Projet retiré" };
const id = (lettre) => `equipe-${lettre}`;
const projet = (p) => ({ id: p, name: p === "durand" ? "Atelier Durand" : "Cabinet Lemoine", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "Projet fictif", previewUrl: "", folder: path.join(TMP, p), files: [], updatedAt: date(60) });
const fixture = () => ({
  version: 1,
  chats: [
    ...Object.keys(titres).map((lettre, i) => ({ id: id(lettre), kind: "equipe", projectId: lettre === "F" ? "retire" : lettre === "E" ? "lemoine" : "durand", title: titres[lettre], roleIds: ["principal"], updatedAt: date((i + 1) * 10), sessions: { principal: `session-${lettre}` }, luJusqua: lettre === "D" ? null : `m-${lettre}` })),
    { id: "dm-principal", kind: "direct", projectId: null, title: "Principal", roleIds: ["principal"], updatedAt: date(5), sessions: {}, luJusqua: "m-direct" },
    { id: "fil-fictif", kind: "direct", projectId: null, title: "Fil fictif", roleIds: ["principal"], updatedAt: date(90), sessions: {}, luJusqua: "m-fil", fil: { roleId: "principal", statut: "ouvert", creeLe: date(90), lancePar: null, retourAttendu: false } },
  ],
  messages: [
    ...["A", "B", "C", "D", "E"].map((lettre, i) => ({ id: `m-${lettre}`, chatId: id(lettre), author: { kind: "role", roleId: "principal" }, createdAt: date((i + 1) * 10), statut: "fait", parts: [{ type: "text", text: `Recherche témoin ${lettre} : message conservé.` }] })),
    { id: "m-direct", chatId: "dm-principal", author: { kind: "user" }, createdAt: date(5), parts: [{ type: "text", text: "Message direct fictif intact." }] },
    { id: "m-fil", chatId: "fil-fictif", author: { kind: "role", roleId: "principal" }, createdAt: date(90), statut: "fait", parts: [{ type: "text", text: "Réponse du fil fictif intacte." }] },
  ],
  projects: [projet("durand"), projet("lemoine")], routines: [],
  taches: [{ id: "temoin", titre: "Rappel fictif sans date", notes: "À conserver", liste: "perso", date: null, heure: null, fin: null, priorite: 2, signalee: true, faite: false, faiteLe: null, projectId: null, creeLe: date(100), notifiee: true }],
  evenements: [], categories: [{ id: "perso", nom: "Perso", teinte: "bleu-k2", icone: "home-01" }], artefacts: [], workflows: [], executions: [],
});
for (const dossier of [DONNEES, MAISON, path.join(TMP, "durand"), path.join(TMP, "lemoine")]) mkdirSync(dossier, { recursive: true });
writeFileSync(path.join(DONNEES, "mes-agents.json"), q({ version: 1, depart: "reprise", assistant: { nom: "Principal", teinte: null }, agents: {} }));
writeFileSync(FICHIER, q(fixture()));
const donnees = () => JSON.parse(readFileSync(FICHIER, "utf8"));
const env = { ...process.env, HOME: MAISON, KLYRA_USER_DATA: DONNEES, PATH: "/usr/bin:/bin", TZ: "Europe/Paris", DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(TMP, "aucun-bus")}` };
for (const key of ["ELECTRON_RUN_AS_NODE", "KLYRA_DEV_URL", "KLYRA_SMOKE_TEST", "KLYRA_CLAUDE_PATH", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete env[key];

const INJECTION = `(() => {
  const NativeDate = Date; let maintenant = ${INSTANT}; const annonces = [], notifications = [];
  function DateControlee(...args) { if (!new.target) return new NativeDate(maintenant).toString(); return Reflect.construct(NativeDate, args.length ? args : [maintenant], new.target); }
  Object.setPrototypeOf(DateControlee, NativeDate); DateControlee.prototype = NativeDate.prototype; DateControlee.now = () => maintenant; window.Date = DateControlee;
  class FausseNotification extends EventTarget { constructor(titre) { super(); notifications.push(titre); } close() {} static get permission() { return 'denied'; } static requestPermission() { return Promise.resolve('denied'); } }
  Object.defineProperty(window, 'Notification', { configurable: true, value: FausseNotification });
  window.addEventListener('klyra:annonce-agents', e => annonces.push(e.detail));
  window.__epinglageTest = { annonces, notifications, tick: () => { maintenant += 1000; } };
})();`;
const NAV = 'nav[aria-label="Agents et conversations"]';
const liste = (zone = NAV) => `${zone} [data-conversation]`;
const lien = (lettre, zone = NAV) => `${zone} [data-conversation=${q(id(lettre))}]`;
const bouton = (lettre, zone = NAV) => `${zone} [data-epingle=${q(id(lettre))}]`;
const MENU = '[role="menu"][aria-label="Options de la conversation"]';
const OPTIONS = 'main header button[aria-label="Plus d’options"]';
const PROJET = 'main [data-liste-conversations]';
const present = (sel) => app.ev(`!!document.querySelector(${q(sel)})`);
const texte = (sel) => app.ev(`document.querySelector(${q(sel)})?.textContent.trim() ?? ''`);
const focus = (sel) => app.ev(`document.activeElement === document.querySelector(${q(sel)})`);
const ordre = (zone = NAV) => app.ev(`[...document.querySelectorAll(${q(liste(zone))})].map(e => e.dataset.conversation.replace('equipe-', ''))`);
const epinglee = (lettre, zone = NAV) => present(`${lien(lettre, zone)} [role="img"][aria-label="Épinglée"]`);
const stockage = () => app.ev(`Object.fromEntries(['klyra-brouillons', 'klyra-onglets-conversations'].map(k => [k, localStorage.getItem(k)]))`);
async function attendreQue(fn, delai = 5000) {
  for (let i = 0; i < delai / 30; i++) { if (await fn().catch(() => false)) return true; await attendre(30); }
  return false;
}
async function lancer() {
  const processus = spawn(ELECTRON, [".", `--remote-debugging-port=${PORT}`, ...process.argv.slice(2)], { cwd: APP, env, stdio: "ignore" });
  let cible;
  for (let i = 0; i < 70 && !cible; i++) {
    await attendre(250);
    cible = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json()).then(xs => xs.find(x => x.type === "page" && x.url.startsWith("app://"))).catch(() => null);
  }
  if (!cible) { processus.kill(); throw new Error("Fenêtre Electron absente"); }
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise(resolve => { ws.onopen = resolve; });
  let numero = 0;
  const enAttente = new Map(), erreurs = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === "Runtime.exceptionThrown") erreurs.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.id) { enAttente.get(m.id)?.(m); enAttente.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++numero, timer = setTimeout(() => { enAttente.delete(n); reject(new Error(`CDP sans réponse : ${method}`)); }, 15000);
    enAttente.set(n, m => { clearTimeout(timer); if (m.error) reject(new Error(q(m.error))); else resolve(m.result); });
    ws.send(q({ id: n, method, params }));
  });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: INJECTION });
  const outils = {
    ev, send, erreurs,
    async position(sel) {
      return ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) throw new Error('Élément absent : ' + ${q(sel)}); e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    },
    async clicEn(p, compte = 1, apres = 70) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: compte });
      if (apres) await attendre(apres);
    },
    async clic(sel, apres = 70) { await outils.clicEn(await outils.position(sel), 1, apres); },
    async survol(sel) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...await outils.position(sel) }); await attendre(180); },
    async parquer() { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4 }); await attendre(160); },
    async touche(key, modifiers = 0, apres = 60) {
      const codes = { Tab: 9, Enter: 13, Escape: 27, " ": 32, k: 75, a: 65, Backspace: 8, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35 };
      const base = { key, code: key === " " ? "Space" : key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key], modifiers };
      const text = key === "Enter" && !modifiers ? "\r" : key === " " && !modifiers ? " " : undefined;
      await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text, unmodifiedText: text } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      if (apres) await attendre(apres);
    },
    async tabVers(sel) {
      // Un focus souris préexistant n'est pas un geste Tab et ne vaut pas :focus-visible.
      if (await ev(`document.activeElement === document.querySelector(${q(sel)})`)) await outils.touche("Tab", 8);
      for (let i = 0; i < 130; i++) { if (await ev(`document.activeElement === document.querySelector(${q(sel)})`)) return true; await outils.touche("Tab", 0, 4); }
      return false;
    },
    async aller(route) {
      // CDP recharge la page entière, contrairement à Link. Le geste de fermeture
      // immédiate est testé séparément ; ici on laisse finir l'écriture regroupée.
      await attendre(650);
      await send("Page.navigate", { url: `app://klyra${route}` });
      if (!(await attendreQue(() => ev(`!!window.__epinglageTest && !!document.querySelector('main') && !!document.querySelector('a[href="/chats"]')`), 10000))) throw new Error(`App non prête : ${route}`);
      await attendre(650);
    },
    async charger(data = fixture(), route = "/chats") {
      await send("Page.navigate", { url: "about:blank" }); await attendre(500);
      writeFileSync(FICHIER, q(data));
      await outils.aller(route);
      await ev(`localStorage.setItem('klyra-brouillons', ${q(q({ [id("A")]: { text: "Brouillon fictif conservé", fichiers: [] } }))}); localStorage.setItem('klyra-onglets-conversations', '{}');`);
      await outils.parquer(); await attendre(1100); erreurs.length = 0;
    },
    async fermer(doucement = false) {
      if (processus.exitCode !== null) return true;
      if (doucement) {
        void ev("window.close()").catch(() => {});
        if (await attendreQue(async () => processus.exitCode !== null, 5000)) { ws.close(); return true; }
      }
      ws.close(); processus.kill(); await attendreQue(async () => processus.exitCode !== null, 3000);
      return !doucement;
    },
  };
  await attendreQue(() => ev("!!window.klyra && !!document.querySelector('main')"), 10000);
  await attendre(600);
  return outils;
}
async function basculer(lettre, zone = NAV) { await app.ev("window.__epinglageTest.tick()"); await app.clic(bouton(lettre, zone)); }
async function enregistrer() { await attendre(650); }
async function etape(nom, fn) {
  if (process.env.KLYRA_TEST_GESTE && !nom.startsWith(process.env.KLYRA_TEST_GESTE + " ·")) return;
  console.log(`\n${nom}`);
  try { await fn(); verifier(!app.erreurs.length, `${nom} : aucune exception renderer (${app.erreurs.join(" | ")})`); }
  catch (error) { verifier(false, `${nom} : ${error.stack ?? error}`); }
}
function sansEpingle(data) { return { ...data, chats: data.chats.map(c => { const copie = { ...c }; delete copie.epingleLe; return copie; }) }; }
async function menu() { await app.clic(OPTIONS); if (!(await attendreQue(() => present(MENU)))) throw new Error("Menu absent"); }
async function basculerMenu() { await app.ev("window.__epinglageTest.tick()"); await menu(); await app.clic(`${MENU} [role=menuitem]:nth-child(2)`); }
async function recherche() {
  await app.touche("k", 2);
  await attendreQue(() => present('[role="dialog"][aria-label="Rechercher dans les conversations"]'));
  await app.touche("a", 2); await app.send("Input.insertText", { text: "Recherche" }); await attendre(500);
  const resultat = await app.ev(`[...document.querySelectorAll('[role="listbox"] [role="option"]')].map(e=>e.textContent)`);
  await app.touche("Escape"); return resultat;
}

try {
  app = await lancer();
  await etape("1 · Ordre des deux listes", async () => {
    await app.charger();
    verifier(memes(await ordre(), ["A", "B", "C", "D", "E", "F"]), "départ : dates décroissantes");
    await basculer("D"); verifier(memes(await ordre(), ["D", "A", "B", "C", "E", "F"]), "D épinglée en tête");
    await basculer("B"); verifier(memes(await ordre(), ["B", "D", "A", "C", "E", "F"]), "B dernière épinglée avant D");
    await enregistrer(); await app.aller("/projet?id=durand");
    verifier(memes(await ordre(PROJET), ["B", "D", "A", "C"]), "projet : épingles communes avant les autres");
    await basculer("B", PROJET); await enregistrer();
    verifier(!Object.hasOwn(donnees().chats.find(c => c.id === id("B")), "epingleLe"), "retirer supprime réellement la clé");
    await app.aller("/chats"); verifier(memes(await ordre(), ["D", "A", "B", "C", "E", "F"]), "B reprend sa place par date dans le panneau");
  });
  await etape("2 · Préservation des données", async () => {
    await app.charger(); const avant = donnees(), preferences = await stockage(), planning = readFileSync(PLANNING, "utf8");
    await basculer("D"); await enregistrer();
    verifier(memes(sansEpingle(donnees()), avant), "pendant l’épinglage : seul epingleLe diffère dans tout le fichier");
    verifier(Number.isFinite(Date.parse(donnees().chats.find(c => c.id === id("D")).epingleLe)), "date d’épingle valide enregistrée");
    await basculer("D"); await attendre(1200);
    verifier(memes(donnees(), avant), "retirer rend exactement le fichier initial : conversations, messages, sessions, rappels et projets");
    verifier(memes(await stockage(), preferences), "brouillons et onglets locaux intacts");
    verifier(readFileSync(PLANNING, "utf8") === planning, "planning.md strictement identique, sans épingle");
    verifier((await app.ev("window.__epinglageTest.notifications.length")) === 0, "aucune notification demandée");
  });
  await etape("3 · Épingler sans ouvrir", async () => {
    await app.charger(); const url = await app.ev("location.href"), preferences = await stockage();
    verifier(await present(`${lien("D")} [aria-label="1 non lu"]`), "D a un message non lu avant le geste");
    await basculer("D"); await enregistrer();
    verifier((await app.ev("location.href")) === url, "l’URL n’a pas changé");
    verifier(await present(`${lien("D")} [aria-label="1 non lu"]`), "la pastille non lue reste");
    verifier(donnees().chats.find(c => c.id === id("D")).luJusqua === null, "le message n’est pas marqué lu sur disque");
    verifier(memes(await stockage(), preferences), "aucun onglet ajouté ni brouillon modifié");
  });
  await etape("4 · Fermeture avant l’écriture regroupée", async () => {
    await app.charger();
    const p = await app.position(bouton("D"));
    const debut = performance.now(); await app.clicEn(p, 1, 0);
    const delai = performance.now() - debut;
    verifier(delai < 100, `fermeture demandée ${delai.toFixed(0)} ms après le début du clic`);
    verifier(await app.fermer(true), "fermeture Electron réelle et propre");
    verifier(Number.isFinite(Date.parse(donnees().chats.find(c => c.id === id("D")).epingleLe)), "épingle déjà présente sur disque avant le redémarrage");
    app = await lancer(); await app.aller("/chats");
    verifier(await epinglee("D") && (await ordre())[0] === "D", "redémarrage : D reste épinglée en tête");
    const p2 = await app.position(bouton("D")); await app.clicEn(p2, 1, 0);
    verifier(await app.fermer(true), "retrait puis fermeture propre immédiate");
    verifier(!Object.hasOwn(donnees().chats.find(c => c.id === id("D")), "epingleLe"), "clé déjà retirée du disque avant le second redémarrage");
    app = await lancer(); await app.aller("/chats");
    verifier(!(await epinglee("D")) && memes(await ordre(), ["A", "B", "C", "D", "E", "F"]), "redémarrage : épingle retirée et ordre initial");
  });
  await etape("5 · Souris, stabilité et double clic", async () => {
    await app.charger();
    const mesure = () => app.ev(`(() => {const e=document.querySelector(${q(lien("D"))}).querySelector('strong'),r=e.parentElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
    const avant = await mesure(); await app.survol(bouton("D"));
    verifier(memes(await mesure(), avant), "première ligne du titre immobile au survol");
    verifier((await app.ev(`getComputedStyle(document.querySelector(${q(bouton("D"))})).opacity`)) === "1", "bouton révélé au survol");
    const scroll = await app.ev(`document.querySelector(${q(NAV)}).scrollTop`);
    await basculer("D"); await app.parquer();
    verifier(await present(`${lien("D")}[data-eclaire]`), "ligne éclairée à sa nouvelle place");
    verifier((await app.ev(`document.querySelector(${q(NAV)}).scrollTop`)) === scroll, "aucun défilement provoqué par le clic");
    await attendre(1900); verifier(!(await present(`${lien("D")}[data-eclaire]`)), "éclairage retiré après 1,8 s");
    await app.charger(); const p = await app.position(bouton("D"));
    await app.clicEn(p, 1, 25); await app.clicEn(p, 2, 100); await enregistrer();
    verifier(memes(donnees().chats.filter(c => c.epingleLe).map(c => c.id), [id("D")]), "double clic : D seule épinglée, pas la ligne passée sous le pointeur");
    await app.aller(`/chat?id=${id("D")}`); const url = await app.ev("location.href"), prefs = await stockage();
    await basculerMenu();
    verifier((await app.ev("location.href")) === url && memes(await stockage(), prefs), "sur la conversation active : pas de navigation ni fermeture d’onglet");
  });
  await etape("6 · Clavier, focus et annonce", async () => {
    await app.charger();
    verifier(await app.tabVers(lien("D")), "Tab atteint le lien de D");
    await attendre(160);
    verifier((await app.ev(`getComputedStyle(document.querySelector(${q(bouton("D"))})).opacity`)) === "1", "focus clavier du lien révèle le bouton");
    await app.touche("Tab"); verifier(await focus(bouton("D")), "Tab suivant vise le bouton d’épingle");
    await app.touche("Enter");
    verifier(await epinglee("D") && await focus(bouton("D")), "Entrée : épinglée et focus rendu au même bouton déplacé");
    verifier((await app.ev("window.__epinglageTest.annonces.at(-1)")) === `Conversation épinglée : ${titres.D}.`, "annonce exacte de l’épinglage");
    const style = await app.ev(`(() => {const e=document.querySelector(${q(bouton("D"))}),s=getComputedStyle(e);return {visible:e.matches(':focus-visible'),opacity:s.opacity,outline:s.outlineWidth,style:s.outlineStyle};})()`);
    verifier(style.visible && style.opacity === "1" && parseFloat(style.outline) >= 2 && style.style !== "none", `focus visible et contour au moins 2 px (${q(style)})`);
    await app.touche(" ");
    verifier(!(await epinglee("D")) && await focus(bouton("D")), "Espace : retrait et focus gardé sur sa ligne");
    verifier((await app.ev("window.__epinglageTest.annonces.at(-1)")) === `Épingle retirée : ${titres.D}.`, "annonce exacte du retrait");
    await app.clic(bouton("B")); await app.parquer(); await app.touche("Tab");
    verifier((await app.ev(`getComputedStyle(document.querySelector(${q(bouton("B"))})).opacity`)) === "0", "clic puis Tab ailleurs : aucun bouton figé sur la ligne quittée");
  });
  await etape("7 · Menu d’en-tête", async () => {
    await app.charger(fixture(), `/chat?id=${id("D")}`); await menu();
    verifier(memes(await app.ev(`[...document.querySelectorAll(${q(`${MENU} [role=menuitem]`)})].map(e=>e.textContent.trim())`), ["Renommer", "Épingler", "Ouvrir le projet"]), "menu à trois lignes dans l’ordre prévu");
    await app.touche("ArrowUp"); verifier((await app.ev("document.activeElement.textContent.trim()")) === "Ouvrir le projet", "flèche haut boucle sur la dernière ligne");
    await app.touche("Home"); await app.touche("ArrowDown"); await app.touche("Enter");
    verifier(!(await present(MENU)) && await focus(OPTIONS), "Entrée ferme le menu et rend le focus au « … »");
    verifier(await present('main header h1 [role="img"][aria-label="Épinglée"] svg[width="14"]'), "épingle 14 px dans l’en-tête");
    await menu(); verifier((await texte(`${MENU} [role=menuitem]:nth-child(2)`)) === "Retirer l'épingle", "le menu propose ensuite de retirer l’épingle");
    await app.touche("Escape");
    await enregistrer(); await app.aller("/chats"); verifier((await ordre())[0] === "D", "l’en-tête épingle aussi dans le panneau");
  });
  await etape("8 · Onglets, agents, fils et recherche inchangés", async () => {
    await app.charger();
    const agents = await app.ev(`[...document.querySelectorAll(${q(`${NAV} a[href^='/chat?id=dm-']`)})].map(e=>e.getAttribute('href'))`);
    for (const lettre of ["A", "B", "C"]) await app.aller(`/chat?id=${id(lettre)}`);
    const tabs = await app.ev(`[...document.querySelectorAll('[role=tablist][aria-label="Conversations ouvertes"] [role=tab]')].map(e=>e.textContent)`), prefs = await stockage();
    const resultats = await recherche();
    verifier(resultats.length > 0, "la recherche témoin a des résultats avant l’épingle");
    await basculerMenu();
    verifier(memes(await app.ev(`[...document.querySelectorAll('[role=tablist][aria-label="Conversations ouvertes"] [role=tab]')].map(e=>e.textContent)`), tabs) && memes(await stockage(), prefs), "onglets A, B, C gardés dans leur ordre d’ouverture et brouillon intact");
    verifier(memes(await recherche(), resultats), "mêmes résultats de recherche, dans le même ordre");
    await app.aller("/chat?id=dm-principal"); verifier(!(await present(OPTIONS)), "conversation directe sans menu d’épinglage");
    verifier(memes(await app.ev(`[...document.querySelectorAll(${q(`${NAV} a[href^='/chat?id=dm-']`)})].map(e=>e.getAttribute('href'))`), agents), "Mes agents garde son ordre");
    verifier(!(await present(`${NAV} [data-epingle^="dm-"]`)), "aucun bouton d’épingle de conversation directe dans le panneau, y compris à côté des liens d’agents");
    await app.aller("/chat?id=fil-fictif"); verifier(!(await present(OPTIONS)), "fil sans menu d’épinglage");
    await enregistrer(); verifier(!donnees().chats.filter(c=>c.kind === "direct").some(c=>Object.hasOwn(c,"epingleLe")), "directe et fil sans champ épingle");
  });
  await etape("9 · Cas limites et petite fenêtre", async () => {
    const data = fixture(); data.chats.find(c => c.id === id("C")).epingleLe = "abc";
    await app.charger(data); verifier(!(await epinglee("C")), "date abîmée traitée comme non épinglée");
    await basculer("C"); await enregistrer(); verifier(Number.isFinite(Date.parse(donnees().chats.find(c => c.id === id("C")).epingleLe)), "Épingler remplace la date abîmée");
    await basculer("F"); verifier(await epinglee("F") && (await ordre())[0] === "F", "conversation vide de projet retiré épinglable");
    verifier(!(await texte(lien("F"))).includes("retire"), "pas d’étiquette de projet retiré");
    await app.aller(`/chat?id=${id("C")}`); await menu(); await app.clic(`${MENU} [role=menuitem]:first-child`);
    await app.send("Input.insertText", { text: "C · Renommée" }); await app.touche("Enter");
    await enregistrer(); await app.aller("/chats");
    verifier(memes((await ordre()).slice(0, 2), ["F", "C"]), "renommer garde la place de l’épingle");
    await app.aller(`/chat?id=${id("C")}`);
    await app.clic('main button[aria-label="Plus d’actions"]');
    await app.clic('[role="menu"][aria-label="Actions sur la réponse"] button'); await enregistrer();
    const branche = donnees().chats.find(c => !data.chats.some(d => d.id === c.id));
    verifier(!!branche && !Object.hasOwn(branche, "epingleLe"), "branche nouvelle non épinglée");
    await app.aller("/chats"); verifier((await ordre())[2] === branche?.id.replace("equipe-", ""), "branche en tête des non épinglées");
    await app.aller(`/chat?id=${id("E")}`); await basculerMenu();
    await app.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
    if (await present('main header button[aria-label="Afficher l’aperçu"]')) await app.clic('main header button[aria-label="Afficher l’aperçu"]');
    const taille = await app.ev(`(() => { const e=document.querySelector('main header h1 [aria-label="Épinglée"]'),h=document.querySelector('main header h1');const r=e.getBoundingClientRect(),t=h.getBoundingClientRect();return {width:r.width,right:r.right,titleRight:t.right,screen:innerWidth};})()`);
    verifier(taille.width > 0 && taille.right <= taille.titleRight + 1 && taille.right <= taille.screen, "titre 80 caractères et aperçu : épingle d’en-tête visible à 1100 px");
    await enregistrer(); await app.aller("/chats"); verifier(await epinglee("E"), "épingle du long titre également visible dans la ligne");
    await app.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await basculer("E");
    const reduit = await app.ev(`(() => {const l=document.querySelector(${q(lien("E"))}),b=document.querySelector(${q(bouton("E"))});return {animation:getComputedStyle(l).animationName,transition:getComputedStyle(b).transitionDuration,eclaire:l.hasAttribute('data-eclaire')};})()`);
    verifier(reduit.eclaire && reduit.animation === "none" && reduit.transition.split(",").every(t=>parseFloat(t) <= 0.001), `mouvement réduit : éclairage fixe, pas de fondu (${q(reduit)})`);
    await attendre(1900); verifier(!(await present(`${lien("E")}[data-eclaire]`)), "éclairage fixe retiré aussi après 1,8 s");
    await app.send("Emulation.setEmulatedMedia", { features: [] }); await app.send("Emulation.clearDeviceMetricsOverride");
  });
  await etape("10 · Accessibilité des liens et boutons", async () => {
    await app.charger(); await basculer("D"); await app.parquer();
    const a11y = await app.ev(`(() => {const l=document.querySelector(${q(lien("D"))}),b=document.querySelector(${q(bouton("D"))});return {image:!!l.querySelector('[role="img"][aria-label="Épinglée"]'),name:b.getAttribute('aria-label'),title:b.title,pressed:b.hasAttribute('aria-pressed'),parent:b.closest('a'),width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height};})()`);
    verifier(a11y.image && a11y.name === `Retirer l'épingle de ${titres.D}` && a11y.title === "Retirer l'épingle", "indicateur accessible, nom de bouton avec titre et bulle courte");
    verifier(!a11y.pressed && !a11y.parent && a11y.width >= 24 && a11y.height >= 24, "bouton frère du lien, sans aria-pressed et cible au moins 24 × 24 px");
    await app.parquer(); verifier(await app.tabVers(bouton("D")), "bouton épinglé atteignable au clavier");
    await app.survol(bouton("D"));
    const contour = await app.ev(`(() => {const b=document.querySelector(${q(bouton("D"))}),s=getComputedStyle(b);return {focus:document.activeElement===b,visible:b.matches(':focus-visible'),largeur:s.outlineWidth,style:s.outlineStyle,actif:document.activeElement?.getAttribute('aria-label')};})()`);
    verifier(contour.focus && contour.visible && parseFloat(contour.largeur) >= 2 && contour.style !== "none", `contour clavier gardé sur la ligne épinglée survolée (${q(contour)})`);
    await enregistrer(); verifier(donnees().messages.length === fixture().messages.length, "aucun message envoyé par les gestes de vérification");
  });
} catch (error) { verifier(false, error.stack ?? String(error)); }
finally { await app?.fermer(); rmSync(TMP, { recursive: true, force: true }); }
console.log(`\n${controles - echecs.length}/${controles} contrôles réussis${echecs.length ? ` ; ${echecs.length} échec(s)` : ""}.`);
process.exitCode = echecs.length ? 1 : 0;
