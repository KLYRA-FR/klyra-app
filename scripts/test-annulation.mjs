/**
 * Annuler une suppression de rappel (point 8), dans l'export Electron.
 * Rejoue les dix gestes de SPEC-ANNULATION.md §11 sur un profil jetable.
 * Clics/touches CDP réels ; Date, timers >= 100 ms, focus/visibilité système
 * et Notification simulés dans la page avant de charger les données fictives.
 * Les petits timers et requestAnimationFrame restent réels pour React/Chromium.
 * Aucun agent, aucune notification système, aucun accès au profil utilisateur.
 * Prérequis : npm run build && npm run build:electron.
 *   xvfb-run -a node scripts/test-annulation.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const fixes = ["/usr/local/bin/claude", "/opt/homebrew/bin/claude", "/usr/bin/claude", "/bin/claude"].filter(existsSync);
if (fixes.length) throw new Error(`Test refusé : Claude Code reste accessible à ${fixes.join(", ")}`);
const APP = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-annulation-"));
const DONNEES = path.join(TMP, "userdata");
const MAISON = path.join(TMP, "home");
const FICHIER = path.join(DONNEES, "conversations.json");
const PORTE = 9345;
const INSTANT = Date.parse("2026-10-30T14:42:50+01:00");
const q = JSON.stringify;
const memes = (a, b) => q(a) === q(b);
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const echecs = [];
let controles = 0;
function verifier(ok, message) {
  controles++;
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
}
const donnees = () => JSON.parse(readFileSync(FICHIER, "utf8"));
const taches = () => donnees().taches;
const horsTaches = (donnees) => {
  const reste = { ...donnees };
  delete reste.taches;
  return reste;
};

const CATEGORIES = [
  { id: "clients", nom: "Clients", teinte: "bleu-k2", icone: "users-profiles-01" },
  { id: "perso", nom: "Perso", teinte: "violet", icone: "home-01" },
];
const rappel = (id, plus = {}) => ({
  id, titre: `Rappel fictif ${id}`, notes: "Notes du profil de test", liste: "clients",
  date: "2026-10-31", heure: "09:00", fin: null, priorite: 0, signalee: false,
  faite: false, faiteLe: null, projectId: null, creeLe: "2026-10-20T08:00:00.000Z", notifiee: false, ...plus,
});
const R = {
  a: rappel("r-a", { titre: "Préparer la présentation fictive", notes: "Notes à garder\nDeuxième ligne", fin: "2026-11-02", priorite: 2, signalee: true, projectId: "projet-fictif" }),
  b: rappel("r-b", { titre: "Appeler le client fictif", date: "2026-11-03", heure: "10:00" }),
  c: rappel("r-c", { titre: "Dossier fictif terminé", faite: true, faiteLe: "2026-10-30T10:00:00.000Z", notifiee: true }),
  d: rappel("r-d", { titre: "Deuxième dossier terminé", faite: true, faiteLe: "2026-10-30T11:00:00.000Z" }),
  retard: rappel("r-retard", { titre: "Rappel fictif déjà notifié", date: "2026-10-29", notifiee: true }),
  sansDate: rappel("r-sans-date", { titre: "Idée fictive sans date", date: null, heure: null }),
  long: rappel("r-long", { titre: "Un long rappel fictif ".repeat(10).slice(0, 200), liste: "perso" }),
  due: rappel("r-echeance", { titre: "Échéance fictive pendant la suppression", date: "2026-10-30", heure: "14:43", liste: "perso" }),
};
const BASE = [R.a, R.c, R.b, R.d, R.retard, R.sansDate, R.long];
const fixture = (liste = BASE) => ({
  version: 1,
  chats: [{ id: "chat-fictif", kind: "equipe", projectId: null, title: "Conversation témoin", roleIds: ["principal"], updatedAt: "2026-10-30T10:00:00.000Z", sessions: {}, luJusqua: null }],
  messages: [], projects: [], routines: [], categories: CATEGORIES,
  evenements: [{ id: "rdv-fictif", titre: "Rendez-vous témoin", date: "2026-11-10", debut: "16:00", fin: "17:00", notes: "Intact", projectId: null, notifie: false }],
  taches: liste,
});
mkdirSync(DONNEES, { recursive: true });
mkdirSync(MAISON, { recursive: true });
writeFileSync(path.join(DONNEES, "mes-agents.json"), q({ version: 1, depart: "reprise", assistant: { nom: "Principal", teinte: null }, agents: {} }));
const env = { ...process.env, HOME: MAISON, KLYRA_USER_DATA: DONNEES, PATH: "/usr/bin:/bin", TZ: "Europe/Paris", DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(TMP, "aucun-bus")}` };
for (const key of ["ELECTRON_RUN_AS_NODE", "KLYRA_DEV_URL", "KLYRA_SMOKE_TEST", "KLYRA_CLAUDE_PATH", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete env[key];

/** Les pauses système sont simulées explicitement, sans prétendre piloter un vrai bureau. */
const scriptHorloge = (instant) => `(() => {
  const NativeDate = Date, nativeTimeout = setTimeout.bind(window), nativeClear = clearTimeout.bind(window);
  let maintenant = ${instant}, monotone = 0, compteur = 1000000, focus = true, cachee = false;
  const minuteurs = new Map(), notifications = [], annonces = [];
  function DateControlee(...args) {
    if (!new.target) return new NativeDate(maintenant).toString();
    return Reflect.construct(NativeDate, args.length ? args : [maintenant], new.target);
  }
  Object.setPrototypeOf(DateControlee, NativeDate); DateControlee.prototype = NativeDate.prototype;
  DateControlee.now = () => maintenant; window.Date = DateControlee;
  Object.defineProperty(performance, "now", { configurable: true, value: () => monotone });
  const programmer = (fn, ms, intervalle, args) => {
    ms = Math.max(0, Number(ms) || 0);
    if (ms < 100) return intervalle ? originalInterval(fn, ms, ...args) : nativeTimeout(fn, ms, ...args);
    const id = ++compteur; minuteurs.set(id, { fn, args, a: monotone + ms, intervalle: intervalle ? ms : 0 }); return id;
  };
  const originalInterval = setInterval.bind(window), originalClearInterval = clearInterval.bind(window);
  window.setTimeout = (fn, ms, ...args) => programmer(fn, ms, false, args);
  window.setInterval = (fn, ms, ...args) => programmer(fn, ms, true, args);
  window.clearTimeout = (id) => { minuteurs.delete(id); nativeClear(id); };
  window.clearInterval = (id) => { minuteurs.delete(id); originalClearInterval(id); };
  class FausseNotification extends EventTarget {
    constructor(titre, options = {}) { super(); this.title = titre; notifications.push({ titre, corps: options.body, a: maintenant }); }
    close() {}
    static get permission() { return "granted"; }
    static requestPermission(cb) { cb?.("granted"); return Promise.resolve("granted"); }
  }
  Object.defineProperty(window, "Notification", { configurable: true, writable: true, value: FausseNotification });
  if (window.ServiceWorkerRegistration) ServiceWorkerRegistration.prototype.showNotification = function (titre, options = {}) { notifications.push({ titre, corps: options.body, a: maintenant }); return Promise.resolve(); };
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => focus });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => cachee });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => cachee ? "hidden" : "visible" });
  window.addEventListener("klyra:annonce-agents", (e) => annonces.push(e.detail));
  window.__annulationTest = {
    notifications, annonces, Notification: FausseNotification,
    maintenant: () => maintenant,
    async avancer(ms) {
      const fin = monotone + ms;
      for (let i = 0; i < 20000; i++) {
        const suite = [...minuteurs].filter(([, m]) => m.a <= fin).sort((a, b) => a[1].a - b[1].a)[0];
        if (!suite) { maintenant += fin - monotone; monotone = fin; await new Promise(r => nativeTimeout(r, 15)); return; }
        const [id, m] = suite; maintenant += m.a - monotone; monotone = m.a;
        if (m.intervalle) m.a += m.intervalle; else minuteurs.delete(id);
        if (typeof m.fn !== "function") throw new Error("Timer texte inattendu dans le test");
        m.fn(...m.args); await new Promise(r => nativeTimeout(r, 15));
      }
      throw new Error("Boucle de minuteurs dans l'app");
    },
    focus(v) { focus = v; window.dispatchEvent(new Event(v ? "focus" : "blur")); },
    visibilite(v) { cachee = !v; document.dispatchEvent(new Event("visibilitychange")); },
  };
})();`;

let app;
const ligne = (id) => `[data-rappel=${q(id)}]`;
const poubelle = (id) => `${ligne(id)} [data-supprimer-rappel]`;
const MESSAGE = "[data-annulation-rappels]";
const ANNULER = `${MESSAGE} button[aria-label^="Annuler la suppression"]`;
const FERMER = `${MESSAGE} button[aria-label="Fermer"]`;
const nouveau = 'section[aria-label="Clients"] textarea[placeholder="Nouveau rappel"]';
const lire = (source) => app.ev(source);
const present = (selecteur) => lire(`!!document.querySelector(${q(selecteur)})`);
const texte = (selecteur) => lire(`document.querySelector(${q(selecteur)})?.textContent.replace(/\\s+/gu, ' ').trim() ?? ''`);
const avance = async (ms) => { await lire(`window.__annulationTest.avancer(${ms})`); await attendre(40); };
const annonces = () => lire("window.__annulationTest.annonces");
const notifications = () => lire("window.__annulationTest.notifications");
const focusSur = (selecteur) => lire(`document.activeElement === document.querySelector(${q(selecteur)})`);
async function attendreQue(fn, delai = 5000) {
  for (let i = 0; i < delai / 40; i++) { if (await fn().catch(() => false)) return true; await attendre(40); }
  return false;
}
async function lancer() {
  /* Ne jamais charger les rappels avant l'injection de l'enregistreur. */
  const attente = path.join(TMP, "conversations-attente.json");
  if (existsSync(FICHIER)) renameSync(FICHIER, attente);
  const processus = spawn(ELECTRON, [".", `--remote-debugging-port=${PORTE}`, ...process.argv.slice(2)], { cwd: APP, env, stdio: "ignore" });
  let cible;
  for (let i = 0; i < 60 && !cible; i++) {
    await attendre(300);
    cible = await fetch(`http://127.0.0.1:${PORTE}/json`).then(r => r.json()).then(xs => xs.find(x => x.type === "page" && x.url.startsWith("app://"))).catch(() => null);
  }
  if (!cible) { processus.kill(); throw new Error("Fenêtre Electron absente"); }
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise(resolve => { ws.onopen = resolve; });
  let id = 0, script;
  const attenteCdp = new Map(), erreurs = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === "Runtime.exceptionThrown") erreurs.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.id) { attenteCdp.get(m.id)?.(m); attenteCdp.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { attenteCdp.delete(n); reject(new Error(`CDP sans réponse : ${method}`)); }, 15000);
    attenteCdp.set(n, m => {
      clearTimeout(timer);
      if (m.error) reject(new Error(`${method}: ${q(m.error)}`));
      else resolve(m.result);
    });
    ws.send(q({ id: n, method, params }));
  });
  const ev = async (source) => {
    const r = await send("Runtime.evaluate", { expression: source, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setTimezoneOverride", { timezoneId: "Europe/Paris" });
  const outils = {
    ev, send, erreurs, processus,
    async position(sel) {
      return ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) throw new Error('Élément absent : '+${q(sel)}); e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    },
    async survol(sel) { const p = await outils.position(sel); await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p }); await attendre(50); },
    async parquer() { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4 }); await attendre(40); },
    async clicEn(p, compte = 1, apres = 60) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: compte });
      if (apres) await attendre(apres);
    },
    async clic(sel, apres = 80) { const p = await outils.position(sel); await outils.clicEn(p, 1, apres); },
    async touche(key, modifiers = 0, apres = 40) {
      const codes = { Tab: 9, Enter: 13, Escape: 27, z: 90, k: 75, a: 65, Backspace: 8 };
      const vk = codes[key];
      const base = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
      const text = key === "Enter" && !modifiers ? "\r" : undefined;
      await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text, unmodifiedText: text } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      if (apres) await attendre(apres);
    },
    async tabVers(sel) {
      for (let i = 0; i < 160; i++) {
        if (await ev(`document.activeElement === document.querySelector(${q(sel)})`)) return true;
        await ev(`document.querySelector('[data-test-avant-tab]')?.removeAttribute('data-test-avant-tab'); document.activeElement?.setAttribute('data-test-avant-tab', '')`);
        await outils.touche("Tab", 0, 5);
      }
      return false;
    },
    async aller(route) {
      if ((await ev("location.pathname.replace(/\\/$/, '') || '/'")) === route) return;
      await outils.clic(`a[href=${q(route)}]`);
      if (!(await attendreQue(() => ev(`(location.pathname.replace(/\\/$/, '') || '/') === ${q(route)}`)))) throw new Error(`Navigation impossible vers ${route}`);
      await attendre(100);
      // React peut différer la sortie de Suspense ; les délais contrôlés doivent aussi avancer.
      await ev("window.__annulationTest.avancer(500)");
    },
    async charger(data, instant = INSTANT) {
      await send("Page.navigate", { url: "about:blank" }); await attendre(200);
      writeFileSync(FICHIER, q(data));
      if (script) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script });
      script = (await send("Page.addScriptToEvaluateOnNewDocument", { source: scriptHorloge(instant) })).identifier;
      await send("Page.navigate", { url: "app://klyra/" });
      if (!(await attendreQue(() => ev("!!window.__annulationTest && !!document.querySelector('a[href=\"/planning\"]')"), 10000))) throw new Error("App non prête");
      await outils.aller("/planning");
      if (!(await attendreQue(() => ev("document.querySelectorAll('[data-rappel]').length > 0"), 6000))) {
        throw new Error("Rappels de test absents : " + q(await ev("(async () => ({url: location.href, texte: document.body.innerText, donnees: window.klyra ? await window.klyra.conversations.read() : null}))()")));
      }
      await outils.parquer();
      await ev("window.__annulationTest.avancer(500)"); await attendre(100);
      erreurs.length = 0;
    },
    async fermer(doucement = false) {
      if (processus.exitCode !== null) return true;
      if (doucement) {
        /* Le menu Édition n'est pas requis : window.close demande réellement la fermeture Electron. */
        void ev("window.close()").catch(() => {});
        if (await attendreQue(async () => processus.exitCode !== null, 5000)) { ws.close(); return true; }
      }
      ws.close(); processus.kill();
      await attendreQue(async () => processus.exitCode !== null, 3000);
      return !doucement;
    },
  };
  // Le preload seul ne signifie pas que la première lecture du workspace est terminée.
  await attendreQue(() => ev("!!window.klyra && !!document.querySelector('main')"), 10000);
  await attendre(1000);
  await send("Page.navigate", { url: "about:blank" }); await attendre(700);
  if (existsSync(attente)) { renameSync(attente, FICHIER); }
  return outils;
}

async function depart(liste = BASE, instant = INSTANT) {
  await app.charger(fixture(liste), instant);
  verifier(await lire("window.Notification === window.__annulationTest.Notification"), "notifications remplacées avant les données");
  return donnees();
}
async function supprimer(id, apres = 80) {
  await app.clic(poubelle(id), apres);
  if (apres && !(await attendreQue(() => present(MESSAGE)))) throw new Error(`Message absent après suppression de ${id}`);
}
async function annuler() {
  await app.clic(ANNULER);
  await app.parquer();
  await attendre(80);
}
async function sauver() { await avance(450); await attendre(80); }
async function identique(avant, titre) {
  await sauver();
  const d = donnees();
  verifier(memes(d.taches, avant.taches), `${titre} : rappels identiques, même ordre et mêmes champs`);
  verifier(memes(horsTaches(d), horsTaches(avant)), `${titre} : autres données inchangées`);
  verifier(new Set(d.taches.map(t => t.id)).size === d.taches.length, `${titre} : aucun id en double`);
  verifier(!Object.keys(d).some(k => /supprim|annul/i.test(k)), `${titre} : aucun ticket d'annulation sur le disque`);
}
async function etape(titre, action) {
  if (process.env.KLYRA_TEST_GESTE && !titre.startsWith(process.env.KLYRA_TEST_GESTE + " ·")) return;
  console.log(`\n${titre}`);
  try { await action(); verifier(app.erreurs.length === 0, `${titre} : aucune exception page (${app.erreurs.join(" | ")})`); }
  catch (e) { verifier(false, `${titre} : ${e.stack ?? e}`); }
}

try {
  app = await lancer();
  await etape("1 · Le même rappel et tous ses champs", async () => {
    const avant = await depart();
    const compte = await texte('section[aria-label="Rappels"] > header');
    await supprimer(R.a.id);
    verifier(!(await present(ligne(R.a.id))), "ligne supprimée immédiatement");
    verifier((await texte(MESSAGE)).includes("Rappel supprimé"), "message singulier");
    verifier((await texte('section[aria-label="Rappels"] > header')) !== compte, "compteur à faire diminué");
    await sauver();
    verifier(!taches().some(t => t.id === R.a.id), "suppression écrite après regroupement");
    await annuler();
    verifier(await present(`${ligne(R.a.id)}[data-eclaire]`), "rappel restauré éclairé");
    verifier(await focusSur(`${ligne(R.a.id)} [role="checkbox"]`), "focus sur le rond restauré");
    verifier(!(await present(MESSAGE)), "message retiré après Annuler");
    verifier((await annonces()).at(-1) === `Rappel restauré : ${R.a.titre}.`, "annonce de restauration");
    await identique(avant, "Annuler");
    await avance(1250); verifier(await present(`${ligne(R.a.id)}[data-eclaire]`), "éclairage encore présent avant 1800 ms");
    await avance(150); verifier(!(await present(`${ligne(R.a.id)}[data-eclaire]`)), "éclairage éteint à 1800 ms");

    await app.clic(`${ligne(R.a.id)} textarea`);
    await app.touche("a", 2); await app.send("Input.insertText", { text: "Titre modifié avant la poubelle" });
    await supprimer(R.a.id); await annuler(); await sauver();
    verifier(taches().find(t => t.id === R.a.id)?.titre === "Titre modifié avant la poubelle", "le blur est conservé dans la copie supprimée");
  });

  await etape("2 · Huit secondes et pauses cumulées", async () => {
    await depart(); await supprimer(R.a.id); await app.parquer();
    await avance(7900); verifier(await present(MESSAGE), "message présent à 7,9 s");
    await avance(200); verifier(!(await present(MESSAGE)), "message expiré à 8,1 s");
    verifier(!taches().some(t => t.id === R.a.id), "expiration laisse la suppression sur le disque");

    await depart(); await supprimer(R.a.id); await app.parquer(); await avance(6000);
    await app.survol(MESSAGE); await avance(15000);
    verifier(await present(MESSAGE), "survol 15 s : message conservé");
    await app.parquer(); await avance(2900); verifier(await present(MESSAGE), "reprise conserve au moins 3 s");
    await avance(200); verifier(!(await present(MESSAGE)), "expiration à 3,1 s après une pause avec 2 s restantes");

    await depart(); await supprimer(R.a.id); await app.parquer(); await avance(1000);
    await app.survol(MESSAGE); await avance(15000); await app.parquer();
    await avance(6100); verifier(await present(MESSAGE), "7 s restantes : reprise ne réduit pas le délai à 3 s");
    await avance(1000); verifier(!(await present(MESSAGE)), "expiration après le reste réel de 7 s");

    for (const mode of ["focus", "visibilite"]) {
      await depart(); await supprimer(R.b.id); await app.parquer(); await avance(6200);
      await lire(`window.__annulationTest.${mode}(false)`); await avance(20000);
      verifier(await present(MESSAGE), `${mode} système simulé absent 20 s : pause`);
      await lire(`window.__annulationTest.${mode}(true)`); await avance(2900);
      verifier(await present(MESSAGE), `${mode} revenu : au moins 3 s`);
      await avance(200); verifier(!(await present(MESSAGE)), `${mode} : reprise du compte`);
    }
    await depart(); await supprimer(R.a.id); await app.parquer(); await avance(6000);
    verifier(await app.tabVers(ANNULER), "Tab atteint Annuler"); await avance(15000);
    verifier(await present(MESSAGE), "focus dans le message : pause");
    await app.touche("Escape"); verifier(!(await present(MESSAGE)), "Échap dans le message le ferme");
  });

  await etape("3 · Groupes et ordre original", async () => {
    const avant = await depart();
    for (const [i, r] of [R.a, R.b, R.c].entries()) {
      await supprimer(r.id); await app.parquer(); if (i < 2) await avance(2000);
    }
    verifier((await texte(MESSAGE)).includes("3 rappels supprimés"), "trois suppressions regroupées");
    verifier((await lire(`document.querySelectorAll(${q(MESSAGE)}).length`)) === 1, "un seul message");
    await avance(7900); verifier(await present(MESSAGE), "8 s repartent de la troisième suppression");
    await avance(200); verifier(!(await present(MESSAGE)), "expiration du groupe");
    verifier(taches().length === avant.taches.length - 3, "trois suppressions persistées");

    await depart();
    for (const r of [R.b, R.c, R.a]) { await supprimer(r.id); await app.parquer(); await avance(2000); }
    await annuler();
    verifier(await focusSur(`${ligne(R.a.id)} [role="checkbox"]`), "groupe : focus sur le dernier supprimé");
    verifier((await annonces()).at(-1) === "3 rappels restaurés.", "annonce de groupe");
    await identique(avant, "Restaurer le groupe");

    await supprimer(R.a.id); await app.parquer(); await avance(9000); await supprimer(R.b.id);
    verifier((await texte(MESSAGE)).includes("Rappel supprimé") && !(await texte(MESSAGE)).includes("2 rappels"), "nouveau groupe après expiration");
    await annuler(); await sauver();
    verifier(!taches().some(t => t.id === R.a.id) && taches().some(t => t.id === R.b.id), "Annuler rend B seul, A reste supprimé");
  });

  await etape("4 · Double clic et restauration idempotente", async () => {
    const avant = await depart();
    const p = await app.position(poubelle(R.a.id));
    await app.clicEn(p, 1, 30); await app.clicEn(p, 2, 80); await app.parquer(); await sauver();
    verifier(taches().length === avant.taches.length - 1, "double clic poubelle : une seule suppression");
    const a = await app.position(ANNULER);
    await app.clicEn(a, 1, 30); await app.clicEn(a, 2, 50); await app.touche("z", 2);
    await identique(avant, "Double Annuler puis Ctrl+Z");
    await supprimer(R.a.id); await annuler(); await identique(avant, "Nouveau cycle supprimer/annuler");
  });

  await etape("5 · Notification déjà partie", async () => {
    const avant = await depart([R.retard, R.a]);
    await supprimer(R.retard.id); await annuler(); await avance(90000); await sauver();
    verifier((await notifications()).length === 0, "rappel déjà notifié : aucune nouvelle notification");
    verifier(taches().find(t => t.id === R.retard.id)?.notifiee === true, "notifiee reste vrai");
    await identique(avant, "Notification déjà partie");
  });

  await etape("6 · Échéance pendant la suppression", async () => {
    await depart([R.due, R.a]);
    await supprimer(R.due.id); await app.survol(MESSAGE); await avance(90000);
    verifier((await notifications()).length === 0, "aucune notification pendant la suppression");
    verifier(!taches().some(t => t.id === R.due.id), "la boucle ne recrée pas le rappel supprimé");
    await annuler(); await avance(30000); await sauver();
    const ns = await notifications();
    verifier(ns.length === 1 && ns[0].titre === R.due.titre, "restauré échu : exactement une notification en 30 s");
    verifier(taches().find(t => t.id === R.due.id)?.notifiee === true, "rappel restauré marqué notifié");
    await avance(90000); verifier((await notifications()).length === 1, "aucune deuxième notification après 90 s");
    await supprimer(R.due.id); await app.parquer(); await avance(90000); await sauver();
    verifier(!taches().some(t => t.id === R.due.id), "notification tardive : aucune recréation après suppression définitive");
  });

  await etape("7 · Navigation et portée de Ctrl+Z", async () => {
    const avant = await depart(); await supprimer(R.a.id); await app.parquer(); await avance(2000);
    await app.aller("/"); verifier(await present(MESSAGE), "le message suit la navigation");
    await app.touche("z", 2); verifier(await present(MESSAGE), "Ctrl+Z hors Planning ne touche pas au groupe");
    await annuler(); verifier((await lire("location.pathname")) === "/", "Annuler ne change pas de page");
    verifier((await annonces()).at(-1) === `Rappel restauré : ${R.a.titre}.`, "annonce de restauration sur l'Accueil");
    await app.aller("/planning"); await identique(avant, "Navigation");
    verifier((await lire(`document.querySelectorAll(${q(ligne(R.a.id))}).length`)) === 1, "un seul rappel revenu sur Planning");
  });

  await etape("8 · Clavier, saisie, focus et modale", async () => {
    await depart();
    verifier(await app.tabVers(poubelle(R.a.id)), "Tab atteint la poubelle");
    const suivant = await lire(`(() => { const l = document.querySelector(${q(ligne(R.a.id))}); return l.nextElementSibling?.querySelector('[data-supprimer-rappel]')?.closest('[data-rappel]')?.dataset.rappel ?? null; })()`);
    await app.touche("Enter");
    verifier(suivant && await focusSur(poubelle(suivant)), "Entrée : focus sur la poubelle suivante");
    verifier((await annonces()).at(-1) === `Rappel supprimé : ${R.a.titre}. Ctrl+Z pour annuler.`, "annonce suppression et raccourci");
    await app.touche("z", 2); await attendre(60);
    verifier(await present(ligne(R.a.id)) && await focusSur(`${ligne(R.a.id)} [role="checkbox"]`), "Ctrl+Z rend le rappel et vise son rond");

    await supprimer(R.a.id); await app.clic(nouveau); await app.send("Input.insertText", { text: "ab" });
    await app.touche("z", 2);
    verifier(await present(MESSAGE) && !(await present(ligne(R.a.id))), "après saisie, Ctrl+Z garde la suppression");
    verifier((await lire(`document.querySelector(${q(nouveau)}).value`)) === "", "Ctrl+Z annule la saisie normale du champ");
    verifier(await app.tabVers(ANNULER), "Tab rejoint le message après saisie");
    verifier(await lire("getComputedStyle(document.activeElement).outlineColor === 'rgb(255, 255, 255)'"), "focus Annuler blanc sur le fond sombre");
    await app.touche("Tab");
    verifier(await focusSur(FERMER) && await lire("getComputedStyle(document.activeElement).outlineColor === 'rgb(255, 255, 255)'"), "focus Fermer blanc sur le fond sombre");
    await app.touche("Escape");
    verifier(!(await present(MESSAGE)) && await focusSur('[data-test-avant-tab]'), "Échap ferme et restaure le focus précédent à l'entrée du message");

    await depart(); await supprimer(R.a.id); await app.touche("k", 2); await attendre(100);
    verifier(await present('[aria-modal="true"]'), "recherche ouverte en modale");
    await app.touche("z", 2); verifier(await present(MESSAGE) && !(await present(ligne(R.a.id))), "Ctrl+Z en modale préserve la suppression");
    await app.touche("Escape"); await app.clic(FERMER); await sauver();
    verifier(!(await present(MESSAGE)) && !taches().some(t => t.id === R.a.id), "× rend la suppression définitive");
  });

  await etape("9 · Écriture immédiate et redémarrage", async () => {
    const avant = await depart(); await supprimer(R.a.id); await sauver();
    const a = await app.position(ANNULER);
    await app.clicEn(a, 1, 0);
    const clicFini = Date.now();
    while (Date.now() - clicFini < 90 && !memes(donnees().taches, avant.taches)) await attendre(5);
    verifier(memes(donnees().taches, avant.taches), "Annuler écrit immédiatement, sans avancer le timer de 400 ms");
    const fermeture = app.fermer(true);
    verifier(Date.now() - clicFini < 100, "fermeture demandée dans les 100 ms après Annuler");
    verifier(await fermeture, "fermeture Electron obtenue sans tuer le processus");
    verifier(memes(donnees().taches, avant.taches), "fermeture juste après Annuler : restauration écrite");
    app = await lancer(); await app.charger(donnees());
    verifier(await present(ligne(R.a.id)), "redémarrage : rappel restauré présent");
    await identique(avant, "Après redémarrage");
    await supprimer(R.b.id); await sauver(); verifier(await app.fermer(true), "fermeture pendant le message obtenue sans forcer");
    const supprime = donnees();
    app = await lancer(); await app.charger(supprime);
    verifier(!(await present(ligne(R.b.id))) && !(await present(MESSAGE)), "redémarrage après suppression : aucune annulation ni rappel recréé");
    verifier(memes(horsTaches(donnees()), horsTaches(avant)), "redémarrage : autres données intactes");
  });

  await etape("10 · États affichés, petite fenêtre et mouvement réduit", async () => {
    await depart(); await supprimer(R.retard.id); await annuler();
    verifier(await present(`${ligne(R.retard.id)} [data-echeance].text-texte-erreur`), "retard restauré en rouge");
    await supprimer(R.sansDate.id); await annuler();
    verifier(await lire(`(() => { const ls = [...document.querySelectorAll('section[aria-label="Clients"] [data-rappel]')].filter(l=>l.querySelector('[role=checkbox]').getAttribute('aria-checked')==='false'); return ls.at(-1)?.dataset.rappel === ${q(R.sansDate.id)}; })()`), "sans date restauré en bas des rappels à faire");
    await supprimer(R.c.id);
    await lire(`(() => { const b=[...document.querySelectorAll('section[aria-label="Rappels"] > header button')].find(b=>b.textContent.includes('Masquer')); if(!b) throw new Error('Filtre absente'); b.dataset.testFiltre='oui'; })()`);
    await app.clic('[data-test-filtre="oui"]'); await annuler(); await sauver();
    verifier(!(await present(ligne(R.c.id))) && taches().some(t => t.id === R.c.id && t.faite), "rappel coché restauré sans changer le filtre");
    verifier((await texte('section[aria-label="Rappels"] > header')).includes("Afficher les terminés (2)"), "compteur des terminés restauré");

    await app.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
    await app.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await depart(); await supprimer(R.long.id); await app.parquer();
    const rect = await lire(`(() => { const e=document.querySelector(${q(MESSAGE)}), r=e.getBoundingClientRect(); return {left:r.left,right:r.right,bottom:r.bottom,width:r.width,w:innerWidth,h:innerHeight,animation:getComputedStyle(e).animationName,animations:e.getAnimations().length,live:e.hasAttribute('aria-live')||e.hasAttribute('role')}; })()`);
    verifier(rect.left >= 24 && rect.right <= rect.w - 24 && Math.abs((rect.left + rect.right) / 2 - rect.w / 2) < 2, "1100 × 700 : message entier et centré");
    verifier(Math.abs(rect.h - rect.bottom - 24) < 2, "message à 24 px du bas");
    verifier(rect.animations === 0 && !rect.live, "mouvement réduit : aucune animation et pas de deuxième région live");
    const annonce = (await annonces()).at(-1);
    verifier(annonce.includes("…") && !annonce.includes(R.long.titre) && annonce.length < 130, "titre long coupé dans l'annonce");
    await annuler();
    const style = await lire(`(() => { const e=document.querySelector(${q(ligne(R.long.id))}), s=getComputedStyle(e); return {eclaire:e.hasAttribute('data-eclaire'),animation:s.animationName,fond:s.backgroundColor,halo:s.boxShadow}; })()`);
    verifier(style.eclaire && style.animation === "none" && style.halo !== "none", "mouvement réduit : éclairage et halo fixes");
    await avance(1700); verifier(await present(`${ligne(R.long.id)}[data-eclaire]`), "éclairage fixe présent à 1,7 s");
    await avance(200); verifier(!(await present(`${ligne(R.long.id)}[data-eclaire]`)), "éclairage fixe retiré après 1,8 s");
    await sauver();
    verifier(donnees().messages.length === 0 && donnees().chats.length === 1, "aucun message envoyé ni conversation créée");
  });
} catch (e) { verifier(false, `Le parcours a planté : ${e.stack ?? e}`); }
finally { await app?.fermer(); rmSync(TMP, { recursive: true, force: true }); }
console.log(`\n${controles - echecs.length}/${controles} contrôles réussis ; ${echecs.length} échec(s).`);
console.log("Limites : Linux/Electron, focus/visibilité système simulés, annonces DOM vérifiées sans lecture vocale ; aucun poste Mac/Windows réel.");
process.exit(echecs.length ? 1 : 0);
