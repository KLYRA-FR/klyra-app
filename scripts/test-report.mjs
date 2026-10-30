/**
 * Reporter un rappel en un clic (point 7), dans l'app de bureau (export
 * statique), avec de vrais gestes clavier et souris : les huit gestes de
 * validation de la spec (SPEC-REPORT.md §11), plus la notification réarmée à la
 * nouvelle heure, la garde (rappel supprimé ou coché menu ouvert), des reports
 * rapides répétés, une cible identique, le mouvement réduit, la fenêtre
 * minimale (1100 × 700) et un redémarrage.
 *
 * Horloge fixée : l'app se croit à Paris (TZ=Europe/Paris), le vendredi
 * 30 oct. 2026 à 14:42, puis à 23:30, le samedi à 00:40, le dimanche et le
 * lundi. Une horloge décalée est posée dans la page avant tout script de l'app
 * (CDP Page.addScriptToEvaluateOnNewDocument) : `Date.now()` et `new Date()`
 * partent de l'instant choisi et avancent. Pour les cibles « Dans 1 h » (à la
 * minute supérieure), l'horloge est figée le temps d'un report, sinon une
 * seconde de plus changerait la minute visée. `Notification` y est remplacée
 * par un enregistreur (titre, texte) : aucune notification n'est affichée, et
 * le bus de session D-Bus est coupé pour l'app par précaution.
 * Le tout premier chargement de chaque lancement, avant que l'horloge soit
 * posée, se fait sans données : les rappels attendent à côté et ne reviennent
 * qu'une fois l'horloge en place.
 *
 * Dossier personnel et données de l'app temporaires, rappels fictifs.
 * Aucun agent ne tourne : Claude Code est rendu introuvable pour l'app, et rien n'est envoyé.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   xvfb-run -a node scripts/test-report.mjs        (sous Linux sans bac à sable : ajouter --no-sandbox)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/* Claude Code doit rester introuvable : hors du PATH, l'app le cherche aussi à ces endroits fixes. */
const CLAUDE_FIXE = ["/usr/local/bin/claude", "/opt/homebrew/bin/claude", "/usr/bin/claude", "/bin/claude"].filter((c) => existsSync(c));
if (CLAUDE_FIXE.length) {
  console.log(`Claude Code est installé là où l'app le trouve toujours (${CLAUDE_FIXE.join(", ")}) : test refusé, aucun agent ne doit tourner.`);
  process.exit(1);
}

const APP = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-report-"));
const DONNEES = path.join(TMP, "userdata");
const MAISON = path.join(TMP, "home");
const PORT = 9343;
const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const note = (message) => console.log(`NOTE   ${message}`);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const q = JSON.stringify;
const memes = (a, b) => q(a) === q(b);
/** Espaces (insécables compris) réduits à un seul : les textes de l'interface se comparent ainsi. */
const esp = (t) => String(t ?? "").replace(/\s+/gu, " ").trim();

/* ─── L'horloge : les instants joués, en heure de Paris ─────────── */

/* Heure d'hiver depuis le 25 oct. 2026 : UTC+1. */
const VENDREDI = Date.parse("2026-10-30T14:42:00+01:00");
const VENDREDI_SOIR = Date.parse("2026-10-30T23:30:00+01:00");
const SAMEDI_NUIT = Date.parse("2026-10-31T00:40:00+01:00");
const DIMANCHE = Date.parse("2026-11-01T10:00:00+01:00");
const LUNDI = Date.parse("2026-11-02T10:00:00+01:00");
/** Une minute après « Dans 1 h » de 14:42 (15:42) : la notification réarmée doit partir. */
const APRES_NOUVELLE_HEURE = Date.parse("2026-10-30T15:43:00+01:00");

/**
 * Posée dans chaque nouvelle page avant les scripts de l'app : `Date.now()` et
 * `new Date()` partent de `instant` et avancent ; `Notification` enregistre au
 * lieu d'afficher. `window.__horloge` pilote l'horloge depuis le test.
 */
const horloge = (instant) => `(() => {
  if (window.__horloge) return;
  const VraieDate = Date;
  const vrai = () => VraieDate.now();
  let decalage = ${instant} - vrai();
  let figee = null;
  const maintenant = () => (figee ?? vrai() + decalage);
  function DateReglee(...args) {
    if (!new.target) return new VraieDate(maintenant()).toString();
    return Reflect.construct(VraieDate, args.length ? args : [maintenant()], new.target);
  }
  Object.setPrototypeOf(DateReglee, VraieDate);
  DateReglee.prototype = VraieDate.prototype;
  DateReglee.now = maintenant;
  Object.defineProperty(DateReglee, "name", { value: "Date" });
  Object.defineProperty(DateReglee, "length", { value: 7 });
  Object.defineProperty(VraieDate.prototype, "constructor", { value: DateReglee, writable: true, configurable: true });
  window.Date = DateReglee;

  const journal = [];
  class NotificationEnregistree extends EventTarget {
    constructor(titre, options = {}) {
      super();
      this.title = String(titre);
      this.body = String(options?.body ?? "");
      this.silent = !!options?.silent;
      this.onclick = this.onshow = this.onclose = this.onerror = null;
      journal.push({ titre: this.title, corps: this.body, a: maintenant() });
    }
    close() {}
    static get permission() { return "granted"; }
    static requestPermission(rappel) { rappel?.("granted"); return Promise.resolve("granted"); }
  }
  Object.defineProperty(window, "Notification", { value: NotificationEnregistree, writable: true, configurable: true });
  if (window.ServiceWorkerRegistration) {
    ServiceWorkerRegistration.prototype.showNotification = function (titre, options = {}) {
      journal.push({ titre: String(titre), corps: String(options?.body ?? ""), a: maintenant() });
      return Promise.resolve();
    };
  }
  Object.defineProperty(window, "__horloge", {
    value: {
      maintenant,
      notifications: journal,
      Notification: NotificationEnregistree,
      avancer(ms) { if (figee !== null) figee += ms; else decalage += ms; },
      aller(t) { if (figee !== null) figee = t; else decalage = t - vrai(); },
      figer(t) { figee = t ?? maintenant(); },
      reprendre() { if (figee !== null) { decalage = figee - vrai(); figee = null; } },
    },
  });
})();`;

/* ─── Les rappels de départ (fictifs) ───────────────────────────── */

const NOMS = { perso: "Perso", clients: "Clients", ecole: "École" };
const CATEGORIES = [
  { id: "perso", nom: "Perso", teinte: "violet", icone: "home-01" },
  { id: "clients", nom: "Clients", teinte: "bleu-k2", icone: "users-profiles-01" },
  { id: "ecole", nom: "École", teinte: "jaune", icone: "file-01" },
];
let ordreCreation = 0;
const rappel = (id, titre, liste, date, heure, plus = {}) => ({
  id,
  titre,
  notes: "",
  liste,
  date,
  heure,
  priorite: 0,
  signalee: false,
  faite: false,
  faiteLe: null,
  projectId: null,
  creeLe: new Date(Date.UTC(2026, 9, 15, 8, ordreCreation++)).toISOString(),
  notifiee: false,
  ...plus,
});
/** Vendredi 30 oct. 2026 : « Aujourd'hui » au premier lancement. */
const AUJ = "2026-10-30";
const R = {
  /* Geste 1 : en retard (rouge), avec des notes, « !! », signalé, colonne Clients. */
  retard: rappel("rappel-retard", "Relancer le devis Approvhalles", "clients", "2026-10-29", "14:00", { notes: "Rappeler Marc avant de relancer par mail.", priorite: 2, signalee: true, notifiee: true }),
  /* Geste 2 et notification : notifié au premier chargement (14:30 < 14:42), puis « Dans 1 h ». */
  arroser: rappel("rappel-arroser", "Arroser les plantes du studio", "perso", AUJ, "14:30", { notes: "Les deux ficus près de la fenêtre." }),
  /* Geste 4 : Accueil › À faire, en retard, part à demain. */
  aFaire: rappel("rappel-a-faire", "Renvoyer le contrat signé", "clients", "2026-10-28", null, { priorite: 1, notes: "Version signée par les deux parties." }),
  /* Geste 4 : Accueil › Au programme, 10:00 passé (grisé), « Dans 1 h ». */
  programme: rappel("rappel-programme", "Point téléphone avec Approvhalles", "clients", AUJ, "10:00", { notifiee: true }),
  /* Geste 4 : Au programme, « Lundi » : la ligne part après l'éclairage. */
  midi: rappel("rappel-midi", "Réserver le déjeuner d’équipe", "perso", AUJ, "12:30", { notifiee: true }),
  /* Geste 5 : sans date, « Planifier ». */
  sansDate: rappel("rappel-sans-date", "Trier les photos du shooting", "perso", null, null),
  /* Geste 5 : cochés aujourd'hui (À faire et Au programme) : pas de bouton. */
  fait: rappel("rappel-fait", "Imprimer les badges", "ecole", AUJ, null, { faite: true, faiteLe: "2026-10-30T08:15:00.000Z" }),
  faitHeure: rappel("rappel-fait-heure", "Réserver la salle de réunion", "perso", AUJ, "11:00", { faite: true, faiteLe: "2026-10-30T09:05:00.000Z", notifiee: true }),
  /* Geste 6 : au clavier, « Lundi » : la ligne change de place dans la colonne. */
  clavier: rappel("rappel-clavier", "Préparer la démo client", "clients", AUJ, "17:00"),
  /* Geste 8 : du 22 au 25 oct., en retard, « Lundi ». */
  periode: rappel("rappel-periode", "Préparer le salon Maison&Objet", "ecole", "2026-10-22", null, { fin: "2026-10-25", priorite: 1 }),
  /* Garde : supprimé, puis coché, menu ouvert. */
  suppression: rappel("rappel-suppression", "Commander des cartes de visite", "perso", "2026-11-05", null),
  coche: rappel("rappel-coche", "Répondre à Lina pour le logo", "clients", "2026-11-04", "10:00"),
  /* Reports rapides répétés, puis cible identique. */
  rapide: rappel("rappel-rapide", "Mettre à jour le portfolio", "ecole", "2026-11-03", null),
  /* Mouvement réduit. */
  reduit: rappel("rappel-reduit", "Sauvegarder le disque externe", "perso", "2026-11-07", null),
  /* Geste 2 : à 23:30, « Dans 1 h » → Demain, 00:30. */
  minuit: rappel("rappel-minuit", "Relire le brief de Pelin", "ecole", "2026-11-06", "18:00"),
  /* Geste 3 : à 00:40 le samedi, « Demain matin » → Dim. 1 nov. */
  nuit: rappel("rappel-nuit", "Payer la cotisation", "perso", AUJ, null),
  /* Geste 3 : le lundi, « Lundi » → le lundi suivant. */
  lundi: rappel("rappel-lundi", "Faire le point de la semaine", "ecole", "2026-11-02", "08:00"),
  facture: rappel("rappel-facture", "Envoyer la facture n° 12", "clients", "2026-10-31", "09:00"),
};
/* De quoi faire de Clients la colonne la plus haute (geste 7) : des relances à venir, hors de l'Accueil. */
const RELANCES = ["Atelier Brique", "Studio Ocre", "Maison Lin", "Café Sève", "Galerie Nord", "Fonderie Est"].map((nom, i) =>
  rappel(`rappel-relance-${i + 1}`, `Relancer ${nom}`, "clients", `2026-11-${String(9 + i).padStart(2, "0")}`, null),
);
const TACHES = [...Object.values(R), ...RELANCES];
/* Un rendez-vous dans « Au programme » : sa ligne n'a pas de bouton Reporter. */
const RDV = { id: "rdv-visite", titre: "Visite du studio", date: AUJ, debut: "16:00", fin: "17:00", notes: "", projectId: null, notifie: true };

mkdirSync(DONNEES, { recursive: true });
mkdirSync(MAISON, { recursive: true });
/* Un profil déjà ouvert, assistant nommé : l'Accueil montre les rappels, pas l'écran du premier lancement. */
writeFileSync(
  path.join(DONNEES, "mes-agents.json"),
  JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Principal", teinte: null }, agents: {} }),
);
const CONVERSATIONS = path.join(DONNEES, "conversations.json");
/** Les données attendent ici pendant le premier chargement de chaque lancement (sans horloge). */
const EN_ATTENTE = path.join(TMP, "conversations-en-attente.json");
writeFileSync(
  EN_ATTENTE,
  JSON.stringify({ version: 1, chats: [], messages: [], projects: [], routines: [], evenements: [RDV], taches: TACHES, categories: CATEGORIES }),
);
const lireDisque = () => JSON.parse(readFileSync(CONVERSATIONS, "utf8"));
const tachesDisque = () => lireDisque().taches ?? [];
const sansNotif = (t) => (t ? { ...t, notifiee: null } : t);

/** Ce que chaque rappel doit être devenu : comparé au disque en fin de session et après le redémarrage. */
const attendus = new Map(TACHES.map((t) => [t.id, { date: t.date, heure: t.heure, fin: t.fin ?? null, faite: t.faite }]));

/** Le décalage d'une période, en jours de calendrier. */
const joursEntre = (de, a) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
const decaler = (cle, jours) => new Date(Date.parse(`${cle}T00:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);

/* ─── L'app et ses outils de pilotage ───────────────────────────── */

/* Aucun agent ne doit tourner : Claude Code introuvable, aucune clé. Aucune notification du système : pas de bus de session. */
const env = {
  ...process.env,
  HOME: MAISON,
  KLYRA_USER_DATA: DONNEES,
  PATH: "/usr/bin:/bin",
  TZ: "Europe/Paris",
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(TMP, "aucun-bus")}`,
};
for (const v of ["ELECTRON_RUN_AS_NODE", "KLYRA_DEV_URL", "KLYRA_SMOKE_TEST", "KLYRA_CLAUDE_PATH", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete env[v];

const TOUCHES = {
  Enter: { key: "Enter", code: "Enter", vk: 13, texte: "\r" },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Space: { key: " ", code: "Space", vk: 32, texte: " " },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  Home: { key: "Home", code: "Home", vk: 36 },
  End: { key: "End", code: "End", vk: 35 },
};

async function lancer(instant) {
  /* Les rappels attendent à côté : le premier chargement, encore sans horloge, ne doit pas les voir (ni les notifier). */
  if (existsSync(CONVERSATIONS)) renameSync(CONVERSATIONS, EN_ATTENTE);
  const processus = spawn(ELECTRON, [".", `--remote-debugging-port=${PORT}`, ...process.argv.slice(2)], { cwd: APP, env, stdio: "ignore" });
  let cible;
  for (let i = 0; i < 60 && !cible; i++) {
    await attendre(500);
    cible = await fetch(`http://127.0.0.1:${PORT}/json`)
      .then((r) => r.json())
      .then((t) => t.find((x) => x.type === "page" && x.url.startsWith("app://")))
      .catch(() => undefined);
  }
  if (!cible) {
    processus.kill();
    throw new Error("la fenêtre de l’app n’apparaît pas");
  }
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const attente = {};
  const erreurs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") erreurs.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    attente[m.id]?.(m);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      attente[++id] = r;
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  // La fenêtre se comporte comme si elle avait le focus, même sous un écran virtuel.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const ev = async (x) => {
    const m = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? "erreur dans la page");
    return m.result?.result?.value;
  };
  const pretSansDonnees = async () => {
    for (let i = 0; i < 40 && !(await ev("document.body?.innerText.length > 0 && !!window.klyra").catch(() => false)); i++) await attendre(500);
  };
  /** Une vraie touche, envoyée à Chromium comme par le clavier. */
  const cle = async (key, code, vk, { modifiers = 0, texte } = {}) => {
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
    await send("Input.dispatchKeyEvent", { type: texte ? "keyDown" : "rawKeyDown", ...base, ...(texte ? { text: texte, unmodifiedText: texte } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  const souris = async (type, x, y, clickCount = 1) =>
    send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : clickCount });

  const outils = {
    erreurs,
    ev,
    send,
    async aller(chemin) {
      await ev(`window.next?.router ? window.next.router.push(${q(chemin)}) : (location.href = ${q(chemin)})`);
      await attendre(1500);
    },
    async touche(nom, { modifiers = 0, apres = 150 } = {}) {
      const t = TOUCHES[nom];
      await cle(t.key, t.code, t.vk, { modifiers, texte: modifiers ? undefined : t.texte });
      await attendre(apres);
    },
    survoler: (x, y) => souris("mouseMoved", x, y),
    async cliquerEn(x, y, { apres = 300 } = {}) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await souris(type, x, y);
      await attendre(apres);
    },
    /** Une vraie molette, au-dessus du point donné. */
    molette: (x, y, dy) => send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy }),
    /** La souris dans le coin haut droit, hors des lignes : aucun survol ne montre les boutons. */
    async parquer() {
      const f = await ev("({ l: innerWidth, h: innerHeight })");
      await souris("mouseMoved", f.l - 4, 4);
      await attendre(200);
    },
    fermer() {
      ws.close();
      processus.kill();
      return new Promise((r) => (processus.exitCode !== null ? r() : processus.once("exit", r)));
    },
  };

  /* 1. Premier chargement, sans données ni horloge : on attend qu'il soit prêt, puis on le quitte. */
  await pretSansDonnees();
  await send("Page.navigate", { url: "about:blank" });
  await attendre(1200);
  /* 2. Les rappels reviennent ; l'horloge et l'enregistreur de notifications passent avant tout script de l'app. */
  if (existsSync(EN_ATTENTE)) {
    writeFileSync(`${CONVERSATIONS}.essai`, readFileSync(EN_ATTENTE));
    renameSync(`${CONVERSATIONS}.essai`, CONVERSATIONS);
    rmSync(EN_ATTENTE);
  }
  // En plus de TZ=Europe/Paris passé à Electron.
  await send("Emulation.setTimezoneOverride", { timezoneId: "Europe/Paris" });
  let script = null;
  const poser = async (t) => {
    if (script) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script });
    script = (await send("Page.addScriptToEvaluateOnNewDocument", { source: horloge(t) })).result.identifier;
  };
  /** Ouvre l'app sur ses données et le Planning, une fois les rappels chargés. */
  const ouvrirApp = async () => {
    await send("Page.navigate", { url: "app://klyra/" });
    for (let i = 0; i < 40 && !(await ev("document.body?.innerText.length > 0 && !!window.klyra && !!window.__horloge").catch(() => false)); i++) await attendre(500);
    await outils.aller("/planning");
    for (let i = 0; i < 60 && !(await ev(`document.querySelectorAll('section[aria-label="Rappels"] [role="checkbox"]').length > 0`).catch(() => false)); i++) await attendre(250);
    await attendre(600);
  };
  await poser(instant);
  await ouvrirApp();
  /** Une autre heure : la page est rechargée avec l'horloge à ce nouvel instant (les écritures en attente partent d'abord). */
  outils.regler = async (t) => {
    await attendre(1200);
    await poser(t);
    await ouvrirApp();
  };
  return outils;
}

/* ─── Lire la page ──────────────────────────────────────────────── */

const RAPPELS = 'section[aria-label="Rappels"]';
const ZONES = { planning: RAPPELS, afaire: 'section[aria-label="À faire"]', programme: 'section[aria-label="Au programme"]' };
/** Outils communs aux lectures dans la page (règles de la spec, réécrites ici sans le code de l'app). */
const OUTILS = `
  const esp = (t) => String(t ?? "").replace(/\\s+/gu, " ").trim();
  const RAPPELS = ${q(RAPPELS)};
  const ZONES = ${q(ZONES)};
  const deux = (n) => String(n).padStart(2, "0");
  const cleDe = (d) => d.getFullYear() + "-" + deux(d.getMonth() + 1) + "-" + deux(d.getDate());
  const heureDe = (d) => deux(d.getHours()) + ":" + deux(d.getMinutes());
  const jourDe = (c) => { const [a, m, j] = c.split("-").map(Number); return new Date(a, m - 1, j); };
  const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const enClair = (c) => majuscule(new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(jourDe(c)));
  /* « Aujourd’hui, 15:42 », « Demain, 09:00 », « Hier », sinon « Lun. 2 nov., 09:00 » (jours de calendrier). */
  const libelle = (c, h) => {
    const n = Math.round((jourDe(c) - jourDe(cleDe(new Date()))) / 86400000);
    const j = n === 0 ? "Aujourd’hui" : n === 1 ? "Demain" : n === -1 ? "Hier" : enClair(c);
    return h ? j + ", " + h : j;
  };
  const periode = (c, h, f) => (f && f > c ? libelle(c, h) + " → " + libelle(f, null) : libelle(c, h));
  /* La cible d'un choix (§4) : Dans 1 h à la minute supérieure ; Demain matin et Lundi à 09:00. */
  const cible = (choix) => {
    const m = new Date();
    if (choix === "Dans 1 h") {
      const c = new Date(Math.ceil((m.getTime() + 3600000) / 60000) * 60000);
      return { date: cleDe(c), heure: heureDe(c), menu: libelle(cleDe(c), heureDe(c)) };
    }
    const j = jourDe(cleDe(m));
    j.setDate(j.getDate() + (choix === "Demain matin" ? 1 : (8 - j.getDay()) % 7 || 7));
    return { date: cleDe(j), heure: "09:00", menu: enClair(cleDe(j)) + ", 09:00" };
  };
  /* Le dimanche, « Lundi » viserait la même chose que « Demain matin » : deux lignes. */
  const choixDuJour = () => (new Date().getDay() === 0 ? ["Dans 1 h", "Demain matin"] : ["Dans 1 h", "Demain matin", "Lundi"]);
  const titreDe = (li) => esp(li.querySelector('[role="checkbox"]')?.getAttribute("aria-label")).replace(/^(Terminer|Rouvrir) /, "");
  const lignes = (z) => [...(z?.querySelectorAll("li") ?? [])].filter((li) => li.querySelector('[role="checkbox"]'));
  const ligne = (z, titre) => lignes(z).find((li) => titreDe(li) === esp(titre)) ?? null;
  const LIBELLES = (titre) => ["Reporter « " + titre + " »", "Planifier « " + titre + " »"].map(esp);
  const bouton = (z, titre) => [...(z?.querySelectorAll('button[aria-haspopup="menu"]') ?? [])].find((b) => LIBELLES(titre).includes(esp(b.getAttribute("aria-label")))) ?? null;
  const menuReport = () => [...document.querySelectorAll('[role="menu"]')].find((m) => /^(Reporter|Planifier) « /.test(esp(m.getAttribute("aria-label")))) ?? null;
  const itemsMenu = () => [...(menuReport()?.querySelectorAll('[role="menuitem"]') ?? [])];
  const itemMenu = (choix) => itemsMenu().find((i) => esp(i.getAttribute("aria-label")).startsWith(choix + ",")) ?? null;
  const echeanceDe = (racine, id) => racine?.querySelector('[data-echeance="' + id + '"]') ?? null;
  /* La date d'une ligne : [data-echeance], ou à défaut le petit libellé de date d'avant le report. */
  const dateDe = (li) => li?.querySelector("[data-echeance]:not(li > span:has(> [role=checkbox]))") ?? li?.querySelector("span.text-ui-xs, span.text-texte-erreur") ?? null;
  const annonceReport = () => [...document.querySelectorAll('p[aria-live="polite"]')].map((n) => esp(n.textContent)).find((t) => /^Rappel (reporté|planifié)/.test(t)) ?? null;
  const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  /* La zone qui défile verticalement autour d'un élément (pas la rangée des colonnes, qui ne défile qu'en largeur). */
  const defileur = (el) => {
    for (let p = el?.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
    return null;
  };
  const colonne = (nom) => [...document.querySelectorAll(RAPPELS + " section[aria-label]")].find((s) => s.getAttribute("aria-label") === nom) ?? null;
  /* Le tri de la colonne : datés par échéance, puis l'urgence, puis l'ordre d'écriture ; les cochés à la fin. */
  const trier = (ts) => [...ts].sort((a, b) => {
    const da = a.date ? a.date + "T" + (a.heure ?? "23:59") : "~";
    const db = b.date ? b.date + "T" + (b.heure ?? "23:59") : "~";
    return da.localeCompare(db) || b.priorite - a.priorite || a.creeLe.localeCompare(b.creeLe);
  });
  const attenduColonne = (ts, liste) => { const de = ts.filter((t) => t.liste === liste); return [...trier(de.filter((t) => !t.faite)), ...de.filter((t) => t.faite)]; };
`;
let app;
const page = (corps) => app.ev(`(() => { ${OUTILS}\n return (() => { ${corps} })(); })()`);
/** Attend qu'une expression (évaluée avec les outils) soit vraie. */
async function attendreQue(expression, ms = 3000) {
  for (let t = 0; t < ms; t += 50) {
    if (await page(`try { return !!(${expression}); } catch { return false; }`).catch(() => false)) return true;
    await attendre(50);
  }
  return false;
}
async function attendreDisque(predicat, ms = 5000) {
  for (let t = 0; t < ms; t += 100) {
    try {
      if (predicat(tachesDisque())) return true;
    } catch {
      /* fichier en cours de remplacement */
    }
    await attendre(100);
  }
  return false;
}
/** Chaque étape part de son écran, que la précédente ait fini ou non : le Planning ou l'Accueil, rappels affichés. */
async function surPage(chemin) {
  const ici = String(await app.ev("location.pathname")).replace(/(.)\/$/, "$1");
  if (ici !== chemin) await app.aller(chemin);
  const pret = chemin === "/planning" ? `lignes(document.querySelector(RAPPELS)).length > 0` : `lignes(document.querySelector(ZONES.afaire)).length + lignes(document.querySelector(ZONES.programme)).length > 0`;
  if (!(await attendreQue(pret, 6000))) throw new Error(`${chemin} : les rappels ne s’affichent pas`);
}
const horlogePage = (action) => page(`window.__horloge.${action}; return window.__horloge.maintenant();`);
const notificationsDe = (titre) => page(`return window.__horloge.notifications.filter((n) => n.titre === ${q(titre)}).length;`);

/** Les colonnes du Planning : titres dans l'ordre, date, rouge, urgence, bouton. */
const lirePlanning = () =>
  page(`
    const r = document.querySelector(RAPPELS);
    if (!r) return null;
    return {
      aFaire: esp(r.querySelector(":scope > header span")?.textContent),
      colonnes: [...r.querySelectorAll("section[aria-label]")].map((col) => ({
        nom: col.getAttribute("aria-label"),
        compteur: esp(col.querySelector("header h3 + span")?.textContent),
        lignes: lignes(col).map((li) => {
          const c = li.querySelector('[role="checkbox"]');
          const d = dateDe(li);
          const b = li.querySelector('button[aria-haspopup="menu"]');
          return {
            titre: titreDe(li),
            faite: c.getAttribute("aria-checked") === "true",
            date: d ? esp(d.textContent) : null,
            rouge: !!d?.classList.contains("text-texte-erreur"),
            urgence: [...li.querySelectorAll("span")].map((s) => esp(s.textContent)).find((t) => /^!+$/.test(t)) ?? "",
            bouton: b ? esp(b.getAttribute("aria-label")) : null,
          };
        }),
      })),
    };
  `);
const lignePlanning = async (t) => (await lirePlanning())?.colonnes.flatMap((c) => c.lignes.map((l) => ({ ...l, colonne: c.nom }))).filter((l) => l.titre === esp(t.titre)) ?? [];
const compteurs = async () => {
  const p = await lirePlanning();
  return { aFaire: p?.aFaire, colonnes: Object.fromEntries((p?.colonnes ?? []).map((c) => [c.nom, c.compteur])) };
};

/** L'Accueil : les lignes de « À faire » et « Au programme ». */
const lireAccueil = () =>
  page(`
    const lire = (nom) => {
      const z = document.querySelector(ZONES[nom]);
      return z
        ? lignes(z).map((li) => {
            const c = li.querySelector('[role="checkbox"]');
            const b = li.querySelector('button[aria-haspopup="menu"]');
            return {
              titre: titreDe(li),
              faite: c.getAttribute("aria-checked") === "true",
              texte: esp(li.innerText),
              heure: esp(li.querySelector(".klyra-mono")?.textContent) || null,
              opacite: Number(getComputedStyle(nom === "programme" ? c.parentElement : li).opacity),
              bouton: b ? esp(b.getAttribute("aria-label")) : null,
            };
          })
        : null;
    };
    const p = document.querySelector(ZONES.programme);
    return {
      afaire: lire("afaire"),
      programme: lire("programme"),
      autresLignesProgramme: p ? [...p.querySelectorAll("li")].filter((li) => !li.querySelector('[role="checkbox"]') && esp(li.innerText)).map((li) => ({ texte: esp(li.innerText), bouton: !!li.querySelector('button[aria-haspopup="menu"]') })) : [],
      repere: p?.querySelector('[aria-label^="Il est "]')?.getAttribute("aria-label") ?? null,
      regions: document.querySelectorAll('p[aria-live="polite"]').length,
    };
  `);

const etatBouton = (titre, zone = "planning") =>
  page(`
    const b = bouton(document.querySelector(ZONES[${q(zone)}]), ${q(titre)});
    return b ? { label: esp(b.getAttribute("aria-label")), title: b.getAttribute("title"), haspopup: b.getAttribute("aria-haspopup"), expanded: b.getAttribute("aria-expanded"), controls: b.getAttribute("aria-controls"), opacite: Number(getComputedStyle(b).opacity), focus: document.activeElement === b } : null;
  `);

/** Le menu ouvert : lignes, focus, liens ARIA avec le bouton, placement. */
const etatMenu = (titre) =>
  page(`
    const m = menuReport();
    if (!m) return null;
    const items = itemsMenu();
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) => LIBELLES(${q(titre)}).includes(esp(x.getAttribute("aria-label"))));
    let rogne = false;
    for (let p = m.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX + " " + s.overflowY)) rogne = true;
    }
    const r = m.getBoundingClientRect();
    const rb = b?.getBoundingClientRect();
    return {
      label: esp(m.getAttribute("aria-label")),
      id: m.id || null,
      items: items.map((i) => esp(i.getAttribute("aria-label"))),
      attendus: choixDuJour().map((c) => esp(c + ", " + cible(c).menu)),
      focus: items.indexOf(document.activeElement),
      tabindex: items.map((i) => i.getAttribute("tabindex")),
      portail: !m.closest("section, li, main") && !rogne,
      bouton: b ? { label: esp(b.getAttribute("aria-label")), expanded: b.getAttribute("aria-expanded"), controls: b.getAttribute("aria-controls"), opacite: Number(getComputedStyle(b).opacity) } : null,
      rect: { haut: r.top, bas: r.bottom, gauche: r.left, droite: r.right },
      rectBouton: rb ? { haut: rb.top, bas: rb.bottom, gauche: rb.left, droite: rb.right } : null,
      fenetre: { l: innerWidth, h: innerHeight },
    };
  `);
const focusMenu = () => page(`const m = menuReport(); return m ? itemsMenu().indexOf(document.activeElement) : null;`);
const menuPret = () => attendreQue(`menuReport() && getComputedStyle(menuReport()).visibility !== "hidden" && document.activeElement?.getAttribute("role") === "menuitem"`, 2500);

/** Survole la ligne, puis clique son bouton Reporter (ou Planifier) : le menu doit s'ouvrir. */
async function ouvrirMenu(titre, zone = "planning", { rapide = false } = {}) {
  /* Deux essais : juste après un report, la ligne peut encore glisser vers sa nouvelle place (scrollIntoView doux). */
  for (let essai = 0; essai < 2; essai++) {
    const p = await page(`
      const b = bouton(document.querySelector(ZONES[${q(zone)}]), ${q(titre)});
      if (!b) return null;
      const li = b.closest("li");
      const r0 = li.getBoundingClientRect();
      const c = centre(b);
      const accessible = b.contains(document.elementFromPoint(c.x, c.y));
      if (!accessible || r0.top < 0 || r0.bottom > innerHeight || r0.left < 0 || r0.right > innerWidth) li.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      const rl = li.getBoundingClientRect();
      return { ligne: { x: rl.x + 30, y: rl.y + Math.min(rl.height / 2, 14) }, bouton: centre(b) };
    `);
    if (!p) throw new Error(`aucun bouton Reporter ni Planifier pour « ${titre} » (${zone})`);
    await app.survoler(p.ligne.x, p.ligne.y);
    if (!rapide || essai) await attendre(180);
    /* Le défilement peut finir après la mesure initiale : viser le bouton à sa place actuelle. */
    const cible = await page(`const b = bouton(document.querySelector(ZONES[${q(zone)}]), ${q(titre)}); const c = centre(b); return { ...c, accessible: b.contains(document.elementFromPoint(c.x, c.y)) };`);
    if (!cible.accessible) { await attendre(300); continue; }
    await app.cliquerEn(cible.x, cible.y, { apres: rapide ? 0 : 150 });
    if (await menuPret()) return;
    if (await page(`return !!menuReport();`)) throw new Error(`le menu de « ${titre} » est ouvert mais ne reçoit pas le focus clavier`);
    await attendre(500);
  }
  throw new Error(`le menu de « ${titre} » ne s’ouvre pas`);
}

async function choisirSouris(choix, { apres = 150 } = {}) {
  const p = await page(`const i = itemMenu(${q(choix)}); return i ? centre(i) : null;`);
  if (!p) throw new Error(`« ${choix} » absent du menu`);
  await app.cliquerEn(p.x, p.y, { apres });
}

/** Un point de l'écran sans rien de cliquable dessous, hors du menu. */
const pointNeutre = () =>
  page(`
    const m = menuReport();
    const candidats = [...document.querySelectorAll("h1, h2")].map((h) => { const r = h.getBoundingClientRect(); return [r.right + 40, r.top + r.height / 2]; });
    candidats.push([innerWidth - 12, innerHeight / 2], [innerWidth / 2, 12]);
    for (const [x, y] of candidats) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const el = document.elementFromPoint(x, y);
      if (el && !m?.contains(el) && !el.closest("a, button, input, textarea, select, [role=button], [role=checkbox], [role=menuitem], [tabindex], [contenteditable], li")) return { x, y };
    }
    return { x: innerWidth - 12, y: innerHeight - 12 };
  `);

/**
 * Espion posé juste avant un choix : l'éclairage de [data-echeance="<id>"]
 * (début, fin, style à ce moment-là), la présence de la ligne dans sa liste
 * et l'annonce polie.
 */
const espion = (t, zone) =>
  page(`
    clearInterval(window.__espion?.minuteur);
    const z = () => document.querySelector(ZONES[${q(zone)}]);
    const e = { t0: performance.now(), eclaire: null, presences: [], annonce: null };
    e.noter = () => {
      const t = Math.round(performance.now() - e.t0);
      const allumes = [...document.querySelectorAll('[data-echeance="' + ${q(t.id)} + '"][data-eclaire]')];
      if (allumes.length) {
        if (!e.eclaire) {
          const s = getComputedStyle(allumes[0]);
          e.eclaire = { de: t, a: null, nb: 0, texte: esp(allumes[0].textContent), animation: s.animationName, fond: s.backgroundColor, accent: !!allumes[0].closest(".text-texte-accent") };
        }
        e.eclaire.a = null;
        e.eclaire.nb = Math.max(e.eclaire.nb, allumes.length);
      } else if (e.eclaire && e.eclaire.a === null) e.eclaire.a = t;
      const present = !!ligne(z(), ${q(t.titre)});
      if (e.presences.at(-1)?.present !== present) e.presences.push({ t, present });
      const a = annonceReport();
      if (a) e.annonce = a;
    };
    e.noter();
    e.minuteur = setInterval(e.noter, 10);
    window.__espion = e;
    return true;
  `);
const lireEspion = () => page(`const e = window.__espion; return e ? { eclaire: e.eclaire, presences: e.presences, annonce: e.annonce } : null;`);
const arreterEspion = () => page(`clearInterval(window.__espion?.minuteur); return true;`);

/**
 * Ce que la spec attend juste après un choix (§6.3, §7) : menu fermé, nouvelle
 * date écrite et éclairée environ 1,8 s, focus rendu au bouton du même rappel,
 * annonce ; sur l'Accueil, la ligne qui quitte sa liste y reste le temps de
 * l'éclairage, puis le focus passe à la ligne suivante.
 */
async function suivreApres(nom, t, attendu, { zone, verbe, quitte = false, rang = -1, mouvement = null }) {
  verifier(await attendreQue(`!menuReport()`, 1500), `${nom} : le menu se ferme après le choix`);
  await attendreQue(`window.__espion?.eclaire`, 1500);
  await attendre(350);
  const p = await page(`
    const z = document.querySelector(ZONES[${q(zone)}]);
    const li = ligne(z, ${q(t.titre)});
    const f = document.activeElement;
    const lib = periode(${q(attendu.date)}, ${q(attendu.heure)}, ${q(attendu.fin)});
    return {
      ligne: !!li,
      date: esp(dateDe(li)?.textContent) || null,
      heure: esp(li?.querySelector(".klyra-mono")?.textContent) || null,
      texte: esp(li?.innerText),
      libelle: esp(lib),
      annonces: [esp("Rappel " + ${q(verbe)} + " : " + lib + "."), esp("Rappel " + ${q(verbe)} + " : " + libelle(${q(attendu.date)}, ${q(attendu.heure)}) + ".")],
      annonce: annonceReport(),
      focus: esp(f?.getAttribute("aria-label")) || f?.tagName || null,
      focusMemeRappel: !!f && (!!f.closest('[data-echeance="' + ${q(t.id)} + '"]') || !!echeanceDe(f.closest("li"), ${q(t.id)})),
    };
  `);
  verifier(p.ligne, `${nom} : la ligne est toujours là juste après le choix`);
  if (zone === "programme" && !quitte) verifier(p.heure === attendu.heure, `${nom} : la ligne passe à sa nouvelle heure, ${attendu.heure} (vu ${p.heure})`);
  else if (zone === "programme") verifier(p.texte.includes(p.libelle), `${nom} : la ligne montre sa nouvelle date, « ${p.libelle} » (vu « ${p.texte} »)`);
  else verifier(p.date === p.libelle, `${nom} : la ligne écrit « ${p.libelle} » (vu « ${p.date} »)`);
  verifier(p.focus === esp(`Reporter « ${t.titre} »`) && p.focusMemeRappel, `${nom} : le focus revient au bouton Reporter du même rappel (focus : ${p.focus})`);
  verifier(p.annonces.includes(p.annonce), `${nom} : la région polie annonce « ${p.annonce ?? "rien"} » (attendu « ${p.annonces[0]} »)`);

  await attendreQue(`window.__espion?.eclaire && window.__espion.eclaire.a !== null`, 4500);
  const e = await lireEspion();
  const duree = e?.eclaire && e.eclaire.a !== null ? e.eclaire.a - e.eclaire.de : null;
  verifier(!!e?.eclaire, `${nom} : la date s’éclaire (data-eclaire sur [data-echeance="${t.id}"])`);
  verifier(duree !== null && duree >= 1300 && duree <= 2800, `${nom} : éclairée environ 1,8 s, puis data-eclaire est retiré (${duree !== null ? `${duree} ms` : "jamais retiré"})`);
  if (mouvement === "normal") verifier(e?.eclaire?.animation === "klyra-eclaire", `${nom} : animation klyra-eclaire (vu ${e?.eclaire?.animation})`);
  if (mouvement === "reduit") {
    verifier(e?.eclaire?.animation === "none", `${nom} : mouvement réduit, aucune animation (animation-name ${e?.eclaire?.animation})`);
    verifier(!!e?.eclaire?.fond && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(e.eclaire.fond), `${nom} : mouvement réduit, le fond reste éclairé tant que l’attribut est là (${e?.eclaire?.fond})`);
  }

  if (quitte) {
    if (zone === "afaire") verifier(!!e?.eclaire?.accent, `${nom} : pendant ce temps, la nouvelle date est en bleu (text-texte-accent)`);
    const parti = await attendreQue(`!ligne(document.querySelector(ZONES[${q(zone)}]), ${q(t.titre)})`, 4000);
    const e2 = await lireEspion();
    const depart = e2?.presences.find((x) => !x.present)?.t ?? null;
    verifier(parti && depart !== null && depart >= 1300 && depart <= 2900, `${nom} : la ligne reste environ 1,8 s avec sa nouvelle date, puis quitte la liste (partie après ${depart ?? "jamais"} ms)`);
    await attendre(300);
    const f = await page(`
      const z = document.querySelector(ZONES[${q(zone)}]);
      const ls = lignes(z);
      const suivante = ls[Math.min(${rang}, ls.length - 1)];
      const visee = suivante?.querySelector('button[aria-haspopup="menu"]') ?? z.querySelector('input[placeholder^="Nouveau rappel"]');
      const a = document.activeElement;
      const nommer = (el) => esp(el?.getAttribute("aria-label") ?? el?.getAttribute("placeholder")) || el?.tagName || "rien";
      return { ok: !!visee && a === visee, dansLaCarte: !!z?.contains(a) && a?.getAttribute("aria-haspopup") === "menu", visee: visee ? nommer(visee) : null, vu: nommer(a) };
    `);
    if (zone === "afaire") verifier(f.ok, `${nom} : le focus passe à la ligne qui prend sa place, sinon au champ « Nouveau rappel » (attendu ${f.visee}, focus : ${f.vu})`);
    else if (f.visee) verifier(f.dansLaCarte, `${nom} : le focus passe à un bouton Reporter de la carte (focus : ${f.vu})`);
    else note(`${nom} : plus de ligne à reporter dans la carte ; focus : ${f.vu}.`);
  }
  await arreterEspion();
  return { ...p, eclaire: e?.eclaire ?? null };
}

/**
 * Sur le disque (écritures regroupées, 400 ms) : le même rappel, seules sa
 * date, son heure et sa fin changent ; non coché, notification réarmée ; aucun
 * doublon ; les autres rappels intacts.
 */
async function controlerDisque(nom, avant, id, attendu) {
  const ok = await attendreDisque((ts) => {
    const x = ts.find((y) => y.id === id);
    return !!x && x.date === attendu.date && x.heure === attendu.heure;
  });
  await attendre(200);
  const apres = tachesDisque();
  const t0 = avant.find((x) => x.id === id);
  const siens = apres.filter((x) => x.id === id);
  const t1 = siens[0];
  const vu = t1 ? `${t1.date} ${t1.heure}${t1.fin ? ` → ${t1.fin}` : ""}` : "absent";
  verifier(ok && siens.length === 1, `${nom} : sur le disque, ${attendu.date} ${attendu.heure}${attendu.fin ? ` → ${attendu.fin}` : ""} (vu ${vu})`);
  verifier((t1?.fin ?? null) === (attendu.fin ?? null), `${nom} : fin ${attendu.fin ?? "absente"} (vu ${t1?.fin ?? "absente"})`);
  verifier(
    apres.length === avant.length && new Set(apres.map((x) => x.id)).size === apres.length && apres.filter((x) => x.titre === t0.titre).length === 1,
    `${nom} : pas de doublon (${apres.length} rappels pour ${avant.length}, un seul « ${t0.titre} »)`,
  );
  verifier(t1?.faite === false && t1?.faiteLe === null && t1?.notifiee === false, `${nom} : toujours non coché, notification réarmée (faite ${t1?.faite}, notifiee ${t1?.notifiee})`);
  const cles = [...new Set([...Object.keys(t0), ...Object.keys(t1 ?? {})])].filter((k) => !["date", "heure", "fin", "notifiee"].includes(k));
  const changes = cles.filter((k) => q(t0[k]) !== q(t1?.[k]));
  verifier(!changes.length, `${nom} : même id, titre, notes, catégorie, urgence, drapeau, projet et création${changes.length ? ` (changé : ${changes.join(", ")})` : ""}`);
  const autres = avant.filter((x) => x.id !== id && q(sansNotif(apres.find((y) => y.id === x.id))) !== q(sansNotif(x))).map((x) => x.id);
  verifier(!autres.length, `${nom} : aucun autre rappel modifié${autres.length ? ` (${autres.join(", ")})` : ""}`);
}

/** Rien n'a été écrit (hors `notifiee`, que la boucle des notifications peut poser) : mêmes rappels, mêmes valeurs. */
async function controlerInchange(nom, avant) {
  await attendre(900);
  const apres = tachesDisque();
  const changes = avant.filter((x) => q(sansNotif(apres.find((y) => y.id === x.id))) !== q(sansNotif(x))).map((x) => x.id);
  verifier(apres.length === avant.length && !changes.length, `${nom} : rien n’est écrit${changes.length ? ` (changés : ${changes.join(", ")})` : ""}`);
}

/** La colonne du rappel suit le tri de l'app (par échéance) : la ligne reportée a repris sa place. */
async function controlerOrdre(nom, liste) {
  const r = await page(`
    const ts = ${q(tachesDisque())};
    return { vu: lignes(colonne(${q(NOMS[liste])})).map(titreDe), attendu: attenduColonne(ts, ${q(liste)}).map((t) => esp(t.titre)) };
  `);
  verifier(memes(r.vu, r.attendu), `${nom} : la colonne ${NOMS[liste]} suit le tri par échéance${memes(r.vu, r.attendu) ? "" : ` (vu ${q(r.vu)}, attendu ${q(r.attendu)})`}`);
  return r.vu;
}

/** Le Planning entier d'après le disque : chaque colonne, ses lignes dans l'ordre, leurs dates relatives à « maintenant », les compteurs. */
async function controlerPlanning(nom) {
  const r = await page(`
    const ts = ${q(tachesDisque())};
    const cols = ${q(CATEGORIES.map((c) => ({ id: c.id, nom: c.nom })))};
    return {
      aFaire: esp(document.querySelector(RAPPELS + " > header span")?.textContent),
      aFaireAttendu: ts.filter((t) => !t.faite).length + " à faire",
      colonnes: cols.map(({ id, nom }) => {
        const col = colonne(nom);
        const att = attenduColonne(ts, id);
        return {
          nom,
          vues: col ? lignes(col).map((li) => ({ titre: titreDe(li), date: dateDe(li) ? esp(dateDe(li).textContent) : null })) : null,
          attendues: att.map((t) => ({ titre: esp(t.titre), date: t.date ? esp(periode(t.date, t.heure, t.fin)) : null })),
          compteur: esp(col?.querySelector("header h3 + span")?.textContent),
          compteurAttendu: String(att.filter((t) => !t.faite).length),
        };
      }),
    };
  `);
  for (const c of r.colonnes) {
    const ecarts = c.vues ? c.attendues.filter((a, i) => !memes(a, c.vues[i])).map((a) => `${a.titre} : ${a.date ?? "sans date"}`) : ["colonne absente"];
    verifier(
      !!c.vues && c.vues.length === c.attendues.length && !ecarts.length,
      `${nom} : colonne ${c.nom}, ${c.vues?.length ?? 0} lignes dans l’ordre, dates relatives à maintenant${ecarts.length ? ` (écarts : ${ecarts.join(" ; ")} — vu ${q(c.vues)})` : ""}`,
    );
    verifier(c.compteur === c.compteurAttendu, `${nom} : compteur de ${c.nom} à ${c.compteur} (attendu ${c.compteurAttendu})`);
  }
  verifier(r.aFaire === r.aFaireAttendu, `${nom} : « ${r.aFaire} » (attendu « ${r.aFaireAttendu} »)`);
}

/** Le disque comparé à ce que chaque rappel doit être devenu ; un seul rappel par titre. */
function controlerAttendus(nom) {
  const ts = tachesDisque();
  const ecarts = [];
  for (const [id, a] of attendus) {
    const x = ts.filter((t) => t.id === id);
    if (x.length !== 1) ecarts.push(`${id} ×${x.length}`);
    else if (x[0].date !== a.date || x[0].heure !== a.heure || (x[0].fin ?? null) !== a.fin || x[0].faite !== a.faite)
      ecarts.push(`${id} : ${x[0].date} ${x[0].heure} ${x[0].fin ?? "-"} faite=${x[0].faite} (attendu ${a.date} ${a.heure} ${a.fin ?? "-"} faite=${a.faite})`);
  }
  const inconnus = ts.filter((t) => !attendus.has(t.id)).map((t) => t.id);
  verifier(
    !ecarts.length && !inconnus.length && ts.length === attendus.size,
    `${nom} : ${ts.length} rappels sur le disque pour ${attendus.size} attendus, chacun à sa date${ecarts.length ? ` (écarts : ${ecarts.join(" ; ")})` : ""}${inconnus.length ? ` (inconnus : ${inconnus.join(", ")})` : ""}`,
  );
  const titres = ts.map((t) => t.titre);
  verifier(new Set(titres).size === titres.length, `${nom} : un seul rappel par titre`);
}

/**
 * Un report à la souris, de bout en bout : survol, bouton, menu (cibles
 * écrites), choix ; puis tout ce que la spec attend après. L'horloge est figée
 * le temps du report (à `figer`, sinon à maintenant), puis repart.
 */
async function reporterRappel(nom, t, choix, { zone = "planning", quitte = false, litteraux = null, figer = null, mouvement = null, repeter = false } = {}) {
  const avant = tachesDisque();
  const t0 = avant.find((x) => x.id === t.id);
  if (!t0) throw new Error(`« ${t.titre} » n’est pas sur le disque`);
  const verbe = t0.date ? "reporté" : "planifié";
  const avantCompteurs = zone === "planning" ? await compteurs() : null;
  const rang = zone === "planning" ? -1 : await page(`return lignes(document.querySelector(ZONES[${q(zone)}])).map(titreDe).indexOf(${q(esp(t.titre))});`);
  await horlogePage(`figer(${figer ?? ""})`);
  try {
    await ouvrirMenu(t.titre, zone);
    const m = await etatMenu(t.titre);
    verifier(memes(m?.items, m?.attendus), `${nom} : le menu propose ${q(m?.items)} (attendu ${q(m?.attendus)})`);
    if (litteraux) {
      const ecarts = litteraux.map((l, i) => (l === null || esp(l) === m?.items[i] ? null : `« ${l} »`)).filter(Boolean);
      verifier(!ecarts.length, `${nom} : cibles écrites comme la spec (${litteraux.filter(Boolean).join(" | ")})${ecarts.length ? ` ; manquent ${ecarts.join(", ")}` : ""}`);
    }
    const c = await page(`return cible(${q(choix)});`);
    const fin = t0.fin && t0.date && t0.fin > t0.date ? decaler(c.date, joursEntre(t0.date, t0.fin)) : null;
    const attendu = { date: c.date, heure: c.heure, fin };
    if (repeter) {
      await choisirSouris(choix, { apres: 700 });
      await ouvrirMenu(t.titre, zone, { rapide: true });
    }
    await espion(t, zone);
    await choisirSouris(choix, { apres: 0 });
    const vu = await suivreApres(nom, t, attendu, { zone, verbe, quitte, rang, mouvement });
    await controlerDisque(nom, avant, t.id, attendu);
    attendus.set(t.id, { ...attendu, faite: false });
    if (zone === "planning") {
      const apres = await compteurs();
      verifier(memes(apres, avantCompteurs), `${nom} : compteurs inchangés (${apres.aFaire} ; ${Object.entries(apres.colonnes).map(([k, v]) => `${k} ${v}`).join(", ")})`);
      const l = await lignePlanning(t);
      verifier(l.length === 1 && !l[0].rouge && !l[0].faite && l[0].colonne === NOMS[t0.liste] && l[0].urgence === "!".repeat(t0.priorite), `${nom} : une seule ligne, dans ${NOMS[t0.liste]}, non cochée, pas en rouge, urgence « ${"!".repeat(t0.priorite) || "aucune"} » (vu ${q(l)})`);
      await controlerOrdre(nom, t0.liste);
    }
    return { menu: m, cible: c, attendu, vu };
  } finally {
    await horlogePage("reprendre()");
  }
}

/** Une étape : un échec la termine sans arrêter les suivantes ; le menu, l'horloge et le mouvement sont remis en état. */
async function etape(nom, corps) {
  if (process.env.KLYRA_REPORT_ETAPE && !nom.startsWith(process.env.KLYRA_REPORT_ETAPE)) return;
  console.log(`\n— ${nom}`);
  try {
    await corps();
  } catch (err) {
    verifier(false, `${nom} : ${err instanceof Error ? err.message : err}`);
  } finally {
    try {
      await arreterEspion();
      await page(`window.__horloge?.reprendre(); return true;`);
      if (await page(`return !!menuReport();`)) {
        await app.touche("Escape");
        await attendreQue(`!menuReport()`, 1500);
      }
    } catch {
      /* l'app ne répond plus : l'étape suivante le dira */
    }
  }
}

/* ─── Le parcours ───────────────────────────────────────────────── */

try {
  app = await lancer(VENDREDI);

  await etape("Préparation : horloge à vendredi 14:42 (Paris), notifications enregistrées, rappels affichés", async () => {
    verifier((await app.ev("typeof window.klyra")) === "object", "l’app de bureau démarre sur le profil d’essai");
    const h = await page(`
      const d = new Date();
      return {
        ecart: Date.now() - ${VENDREDI},
        heure: heureDe(d),
        jour: cleDe(d),
        fuseau: Intl.DateTimeFormat().resolvedOptions().timeZone,
        decalage: d.getTimezoneOffset(),
        instance: d instanceof Date && typeof Date.UTC === "function" && new Date(0).getTime() === 0 && typeof Date() === "string",
        minuit: new Date(2026, 9, 30).getTime() === Date.parse("2026-10-29T23:00:00Z"),
        enregistreur: window.Notification === window.__horloge.Notification,
      };
    `);
    verifier(h.ecart >= 0 && h.ecart < 180_000 && h.jour === AUJ && /^14:4[2-4]$/.test(h.heure), `l’app croit être le ${h.jour} à ${h.heure} (horloge décalée, ${Math.round(h.ecart / 1000)} s écoulées)`);
    verifier(h.fuseau === "Europe/Paris" && h.decalage === -60 && h.minuit, `fuseau ${h.fuseau}, UTC+1 (heure d’hiver), minuit local juste`);
    verifier(h.instance, "Date reste une vraie Date (instanceof, UTC, new Date(0), Date())");
    verifier(h.enregistreur, "window.Notification est l’enregistreur du test : aucune notification ne s’affiche");

    /* La boucle des notifications tourne au chargement : seul « Arroser… » (14:30, pas encore notifié) part. */
    await attendre(500);
    const n = await page(`return window.__horloge.notifications;`);
    verifier(
      n.length === 1 && n[0].titre === R.arroser.titre && n[0].corps === R.arroser.notes,
      `au chargement, une notification enregistrée : « ${R.arroser.titre} » (vu ${q(n.map((x) => x.titre))})`,
    );
    verifier(
      await attendreDisque((ts) => ts.find((t) => t.id === R.arroser.id)?.notifiee === true),
      "puis, sur le disque, ce rappel est marqué notifié",
    );

    await controlerPlanning("Planning au départ");
    const l = Object.fromEntries((await lirePlanning()).colonnes.flatMap((c) => c.lignes).map((x) => [x.titre, x]));
    verifier(l[esp(R.retard.titre)]?.date === "Hier, 14:00" && l[esp(R.retard.titre)]?.rouge, `« ${R.retard.titre} » : « Hier, 14:00 », en rouge`);
    verifier(l[esp(R.facture.titre)]?.date === "Demain, 09:00" && !l[esp(R.facture.titre)]?.rouge, `« ${R.facture.titre} » : « Demain, 09:00 »`);
    verifier(l[esp(R.periode.titre)]?.date === "Jeu. 22 oct. → Dim. 25 oct." && l[esp(R.periode.titre)]?.rouge, `« ${R.periode.titre} » : « Jeu. 22 oct. → Dim. 25 oct. », en rouge (vu « ${l[esp(R.periode.titre)]?.date} »)`);
    verifier(l[esp(R.lundi.titre)]?.date === "Lun. 2 nov., 08:00", `« ${R.lundi.titre} » : « Lun. 2 nov., 08:00 » (vu « ${l[esp(R.lundi.titre)]?.date} »)`);

    await app.aller("/");
    await attendreQue(`lignes(document.querySelector(ZONES.afaire)).length > 0`, 5000);
    const a = await lireAccueil();
    const aFaire = [R.periode, R.aFaire, R.retard, R.nuit, R.fait].map((t) => esp(t.titre));
    const programme = [R.programme, R.faitHeure, R.midi, R.arroser, R.clavier].map((t) => esp(t.titre));
    verifier(memes(a.afaire?.map((x) => x.titre), aFaire), `Accueil › À faire : ${q(a.afaire?.map((x) => x.titre))} (attendu ${q(aFaire)})`);
    verifier(memes(a.programme?.map((x) => x.titre), programme), `Accueil › Au programme : ${q(a.programme?.map((x) => x.titre))} (attendu ${q(programme)})`);
    verifier(/^Il est 14:4[2-4]$/.test(a.repere ?? ""), `Au programme : repère « ${a.repere} »`);
    const p = Object.fromEntries((a.programme ?? []).map((x) => [x.titre, x]));
    verifier(p[esp(R.programme.titre)]?.opacite < 0.9 && p[esp(R.clavier.titre)]?.opacite === 1, `Au programme : 10:00 passé est grisé (${p[esp(R.programme.titre)]?.opacite}), 17:00 ne l’est pas (${p[esp(R.clavier.titre)]?.opacite})`);
    verifier(a.autresLignesProgramme.some((x) => x.texte.includes(RDV.titre)), `Au programme : le rendez-vous « ${RDV.titre} » est là`);
    await app.aller("/planning");
  });

  await etape("Geste 5 (coché) · Pas de bouton sur un rappel coché ; décoché, il revient", async () => {
    await surPage("/planning");
    let [f] = await lignePlanning(R.fait);
    let [fh] = await lignePlanning(R.faitHeure);
    verifier(f?.faite && f.bouton === null && fh?.faite && fh.bouton === null, `Planning : « ${R.fait.titre} » et « ${R.faitHeure.titre} », cochés, n’ont pas de bouton`);
    const p = await lirePlanning();
    const sans = p.colonnes.flatMap((c) => c.lignes).filter((l) => !l.faite && l.bouton !== esp(`Reporter « ${l.titre} »`) && l.bouton !== esp(`Planifier « ${l.titre} »`));
    verifier(!sans.length, `Planning : chaque rappel non coché a son bouton Reporter (ou Planifier)${sans.length ? ` (sans : ${sans.map((l) => l.titre).join(", ")})` : ""}`);
    const b = await etatBouton(R.sansDate.titre);
    verifier(b?.label === esp(`Planifier « ${R.sansDate.titre} »`) && b.title === "Planifier", `un rappel sans date propose « Planifier » (${b?.label}, title « ${b?.title} »)`);

    const cliquer = async (selecteur) => {
      const c = await page(`const el = document.querySelector(${q(selecteur)}); if (!el) return null; el.scrollIntoView({ block: "center", behavior: "instant" }); return centre(el);`);
      if (!c) throw new Error(`introuvable : ${selecteur}`);
      await app.cliquerEn(c.x, c.y);
    };
    await cliquer(`${RAPPELS} [role="checkbox"][aria-label="Rouvrir ${R.fait.titre}"]`);
    await attendreQue(`!!bouton(document.querySelector(RAPPELS), ${q(R.fait.titre)})`, 2000);
    [f] = await lignePlanning(R.fait);
    verifier(!f?.faite && f?.bouton === esp(`Reporter « ${R.fait.titre} »`), `décoché dans le Planning, le bouton Reporter revient (${f?.bouton})`);
    await cliquer(`${RAPPELS} [role="checkbox"][aria-label="Terminer ${R.fait.titre}"]`);
    await attendreQue(`!bouton(document.querySelector(RAPPELS), ${q(R.fait.titre)})`, 2000);
    [f] = await lignePlanning(R.fait);
    verifier(f?.faite && f.bouton === null, "recoché : le bouton repart");

    await app.aller("/");
    let a = await lireAccueil();
    const af = a.afaire?.find((x) => x.titre === esp(R.fait.titre));
    const pr = a.programme?.find((x) => x.titre === esp(R.faitHeure.titre));
    verifier(af?.faite && af.bouton === null, `Accueil › À faire : « ${R.fait.titre} », fait aujourd’hui, sans bouton`);
    verifier(pr?.faite && pr.bouton === null, `Accueil › Au programme : « ${R.faitHeure.titre} », fait, sans bouton`);
    const manquants = [...(a.afaire ?? []), ...(a.programme ?? [])].filter((x) => !x.faite && x.bouton !== esp(`Reporter « ${x.titre} »`) && x.bouton !== esp(`Planifier « ${x.titre} »`));
    verifier(!manquants.length, `Accueil : chaque rappel non coché a son bouton${manquants.length ? ` (sans : ${manquants.map((x) => x.titre).join(", ")})` : ""}`);
    verifier(a.autresLignesProgramme.length > 0 && a.autresLignesProgramme.every((x) => !x.bouton), "Au programme : le rendez-vous n’a pas de bouton Reporter");
    await cliquer(`${ZONES.programme} [role="checkbox"][aria-label="Rouvrir ${R.faitHeure.titre}"]`);
    await attendreQue(`!!bouton(document.querySelector(ZONES.programme), ${q(R.faitHeure.titre)})`, 2000);
    a = await lireAccueil();
    verifier(a.programme?.find((x) => x.titre === esp(R.faitHeure.titre))?.bouton === esp(`Reporter « ${R.faitHeure.titre} »`), "décoché dans Au programme, le bouton Reporter revient");
    await cliquer(`${ZONES.programme} [role="checkbox"][aria-label="Terminer ${R.faitHeure.titre}"]`);
    await attendreQue(`!bouton(document.querySelector(ZONES.programme), ${q(R.faitHeure.titre)})`, 2000);
    a = await lireAccueil();
    verifier(a.programme?.find((x) => x.titre === esp(R.faitHeure.titre))?.bouton === null, "recoché : le bouton repart");
    await app.aller("/planning");
  });

  await etape("Geste 1 · Retard → demain, même rappel (Planning, souris)", async () => {
    await surPage("/planning");
    const t = R.retard;
    await page(`document.activeElement?.blur(); return true;`);
    await app.parquer();
    let b = await etatBouton(t.titre);
    verifier(
      b?.label === esp(`Reporter « ${t.titre} »`) && b.title === "Reporter" && b.haspopup === "menu" && b.expanded === "false",
      `bouton présent : aria-label « ${b?.label} », title « ${b?.title} », aria-haspopup="${b?.haspopup}", aria-expanded="${b?.expanded}"`,
    );
    verifier(b?.opacite === 0, `caché tant qu’on ne survole pas la ligne (opacité ${b?.opacite})`);
    verifier(await page(`return !!document.querySelector(RAPPELS + ' p[aria-live="polite"]');`), "la région polie des Rappels est déjà là avant le premier report");
    const [avantLigne] = await lignePlanning(t);
    verifier(avantLigne?.date === "Hier, 14:00" && avantLigne.rouge && avantLigne.urgence === "!!", `avant : « ${avantLigne?.date} », en rouge, « ${avantLigne?.urgence} »`);
    const rangAvant = (await controlerOrdre("avant", t.liste)).indexOf(esp(t.titre));

    const pl = await page(`const li = ligne(document.querySelector(RAPPELS), ${q(t.titre)}); li.scrollIntoView({ block: "center", behavior: "instant" }); const r = li.getBoundingClientRect(); return { x: r.x + 30, y: r.y + 12 };`);
    await app.survoler(pl.x, pl.y);
    await attendre(300);
    b = await etatBouton(t.titre);
    verifier(b?.opacite === 1, `il apparaît au survol de la ligne (opacité ${b?.opacite})`);

    /* Un clic ailleurs ferme sans rien écrire. */
    const avant = tachesDisque();
    await ouvrirMenu(t.titre);
    const m = await etatMenu(t.titre);
    verifier(memes(m?.items, m?.attendus), `menu : ${q(m?.items)} (attendu ${q(m?.attendus)})`);
    verifier(m?.items[1] === esp("Demain matin, Sam. 31 oct., 09:00") && m?.items[2] === esp("Lundi, Lun. 2 nov., 09:00"), "cibles écrites en clair : « Demain matin, Sam. 31 oct., 09:00 », « Lundi, Lun. 2 nov., 09:00 »");
    verifier(m?.focus === 0, `le focus est sur la première ligne (« ${m?.items[0]} »)`);
    verifier(m?.label === b?.label && m?.tabindex.every((x) => x === "-1"), `role="menu", aria-label = celui du bouton (« ${m?.label} »), lignes role="menuitem" en tabindex -1`);
    verifier(m?.bouton?.expanded === "true" && !!m?.id && m?.bouton?.controls === m.id, `aria-expanded="true" et aria-controls = id du menu (${m?.bouton?.controls} / ${m?.id})`);
    verifier(m?.portail, "le menu est rendu à part (portail dans le body), hors de toute zone qui défile ou rogne");
    const premier = await page(`return centre(itemsMenu()[0]);`);
    await app.survoler(premier.x, premier.y);
    await attendre(250);
    b = await etatBouton(t.titre);
    verifier(b?.opacite === 1, `la souris dans le menu : le bouton reste visible (aria-expanded, opacité ${b?.opacite})`);
    const ailleurs = await pointNeutre();
    await app.cliquerEn(ailleurs.x, ailleurs.y);
    b = await etatBouton(t.titre);
    verifier(!(await page(`return !!menuReport();`)) && b?.expanded === "false", "un clic ailleurs ferme le menu (aria-expanded=\"false\")");
    await controlerInchange("clic ailleurs", avant);

    const r = await reporterRappel("Geste 1", t, "Demain matin", { mouvement: "normal" });
    verifier(r.vu.date === "Demain, 09:00", `la ligne écrit « Demain, 09:00 » (vu « ${r.vu.date} »)`);
    verifier(r.vu.annonce === "Rappel reporté : Demain, 09:00.", `annonce « ${r.vu.annonce} »`);
    const rangApres = (await page(`return lignes(colonne("Clients")).map(titreDe);`)).indexOf(esp(t.titre));
    verifier(rangApres !== rangAvant, `la ligne a changé de place dans la colonne (rang ${rangAvant} → ${rangApres})`);
    const d = tachesDisque().find((x) => x.id === t.id);
    verifier(d?.notes === t.notes && d?.priorite === 2 && d?.signalee === true && d?.liste === "clients", "mêmes notes, même « !! », même drapeau, même colonne");
  });

  await etape("Geste 2 · Dans 1 h à 14:42 → Aujourd’hui, 15:42 ; la notification repart à la nouvelle heure, pas à l’ancienne", async () => {
    await app.regler(VENDREDI);
    const t = R.arroser;
    verifier((await tachesDisque()).find((x) => x.id === t.id)?.notifiee === true, "le rappel a déjà été notifié (notifiee à vrai)");
    const r = await reporterRappel("Geste 2 (14:42)", t, "Dans 1 h", {
      figer: VENDREDI,
      litteraux: ["Dans 1 h, Aujourd’hui, 15:42", "Demain matin, Sam. 31 oct., 09:00", "Lundi, Lun. 2 nov., 09:00"],
    });
    verifier(r.vu.date === "Aujourd’hui, 15:42", `la ligne écrit « Aujourd’hui, 15:42 » (vu « ${r.vu.date} »)`);

    /* L'horloge repart de 14:42 : l'ancienne heure (14:30) est passée, la nouvelle (15:42) pas encore. */
    await horlogePage(`aller(${VENDREDI})`);
    const n0 = await notificationsDe(t.titre);
    note("attente d’un tour de la boucle des notifications (30 s)…");
    await attendre(31_000);
    verifier((await notificationsDe(t.titre)) === n0, `aucune notification à l’ancienne heure (${n0} enregistrée(s), aucune de plus après 31 s)`);
    await horlogePage(`aller(${APRES_NOUVELLE_HEURE})`);
    note("horloge avancée à 15:43 ; attente du tour suivant de la boucle…");
    const partie = await attendreQue(`window.__horloge.notifications.filter((n) => n.titre === ${q(t.titre)}).length > ${n0}`, 32_000);
    await attendre(1500);
    const n = await page(`return window.__horloge.notifications.filter((n) => n.titre === ${q(t.titre)});`);
    verifier(partie && n.length === n0 + 1 && n.at(-1).corps === t.notes, `à 15:43, une seule nouvelle notification « ${t.titre} » (${n.length - n0}), avec ses notes`);
    verifier(await attendreDisque((ts) => ts.find((x) => x.id === t.id)?.notifiee === true), "puis le rappel est de nouveau marqué notifié sur le disque");
    await app.regler(VENDREDI);
  });

  await etape("Geste 4 · Accueil : le rappel qui part, et celui qui reste", async () => {
    await surPage("/");
    verifier((await lireAccueil()).regions >= 1, "la région polie de l’Accueil est déjà là");
    let r = await reporterRappel("Geste 4 (À faire, deux reports successifs)", R.aFaire, "Demain matin", { zone: "afaire", quitte: true, repeter: true });
    verifier(r.vu.date === "Demain, 09:00", `pendant 1,8 s, la ligne écrit « Demain, 09:00 » (vu « ${r.vu.date} »)`);

    let a = await lireAccueil();
    const avantProg = a.programme?.find((x) => x.titre === esp(R.programme.titre));
    verifier(avantProg?.opacite < 0.9, `« ${R.programme.titre} » (10:00) est grisé avant (opacité ${avantProg?.opacite})`);
    r = await reporterRappel("Geste 4 (Au programme, Dans 1 h)", R.programme, "Dans 1 h", { zone: "programme" });
    await attendre(300);
    a = await lireAccueil();
    const apresProg = a.programme?.find((x) => x.titre === esp(R.programme.titre));
    verifier(!!apresProg && apresProg.heure === r.attendu.heure && apresProg.opacite === 1, `il reste dans Au programme, à ${apresProg?.heure}, non grisé (opacité ${apresProg?.opacite})`);
    verifier(!a.afaire?.some((x) => x.titre === esp(R.programme.titre)), "et n’apparaît pas dans À faire");

    await reporterRappel("Geste 4 (Au programme, Lundi)", R.midi, "Lundi", { zone: "programme", quitte: true });

    await app.aller("/planning");
    const [p] = await lignePlanning(R.aFaire);
    verifier(p?.date === "Demain, 09:00", `dans le Planning, « ${R.aFaire.titre} » est à « Demain, 09:00 » (vu « ${p?.date} »)`);
    const [mi] = await lignePlanning(R.midi);
    verifier(mi?.date === "Lun. 2 nov., 09:00", `et « ${R.midi.titre} » à « Lun. 2 nov., 09:00 » (vu « ${mi?.date} »)`);
  });

  await etape("Geste 5 · Sans date : Planifier, et l’annonce « Rappel planifié »", async () => {
    await surPage("/planning");
    const t = R.sansDate;
    const [avant] = await lignePlanning(t);
    verifier(avant?.date === null && avant?.bouton === esp(`Planifier « ${t.titre} »`), "le rappel n’a pas de date, son bouton dit « Planifier »");
    const r = await reporterRappel("Geste 5", t, "Demain matin");
    verifier(r.vu.annonce === "Rappel planifié : Demain, 09:00.", `annonce « ${r.vu.annonce} »`);
    const b = await etatBouton(t.titre);
    verifier(b?.label === esp(`Reporter « ${t.titre} »`) && b.title === "Reporter" && b.focus, `daté, son bouton devient « Reporter » et garde le focus (${b?.label})`);
  });

  await etape("Geste 6 · Clavier seul et lecteur d’écran", async () => {
    await surPage("/planning");
    const t = R.clavier;
    const rangAvant = (await page(`return lignes(colonne("Clients")).map(titreDe);`)).indexOf(esp(t.titre));
    const avant = tachesDisque();
    await app.parquer();
    await page(`ligne(document.querySelector(RAPPELS), ${q(t.titre)}).querySelector("textarea").focus(); return true;`);
    await app.touche("Tab", { apres: 300 });
    let b = await etatBouton(t.titre);
    verifier(b?.focus && b.opacite === 1, `Tab depuis le texte du rappel mène au bouton Reporter, qui apparaît au focus (focus ${b?.focus}, opacité ${b?.opacite})`);
    await app.touche("ArrowDown");
    verifier((await menuPret()) && (await focusMenu()) === 0, "↓ ouvre le menu, focus sur « Dans 1 h »");
    const n = (await etatMenu(t.titre))?.items.length ?? 0;
    await app.touche("ArrowUp");
    verifier((await focusMenu()) === n - 1, "↑ sur la première ligne va à la dernière (en boucle)");
    await app.touche("ArrowDown");
    verifier((await focusMenu()) === 0, "↓ sur la dernière revient à la première");
    await app.touche("End");
    verifier((await focusMenu()) === n - 1, "Fin : la dernière ligne");
    await app.touche("Home");
    verifier((await focusMenu()) === 0, "Début : la première ligne");
    await app.touche("Escape");
    b = await etatBouton(t.titre);
    verifier(!(await page(`return !!menuReport();`)) && b?.focus && b.expanded === "false", "Échap ferme et rend le focus au bouton");
    await app.touche("Enter");
    verifier((await menuPret()) && (await focusMenu()) === 0, "Entrée sur le bouton ouvre le menu");
    await app.touche("Tab");
    b = await etatBouton(t.titre);
    verifier(!(await page(`return !!menuReport();`)) && b?.focus, "Tab ferme et rend le focus au bouton");
    await app.touche("Space");
    verifier((await menuPret()) && (await focusMenu()) === 0, "Espace sur le bouton ouvre le menu");
    await controlerInchange("Échap, Tab", avant);

    await horlogePage("figer()");
    await app.touche("ArrowDown");
    await app.touche("ArrowDown");
    const item = await page(`return esp(document.activeElement?.getAttribute("aria-label"));`);
    verifier(item === esp("Lundi, Lun. 2 nov., 09:00"), `↓↓ : « ${item} »`);
    const c = await page(`return cible("Lundi");`);
    const attendu = { date: c.date, heure: c.heure, fin: null };
    await espion(t, "planning");
    await app.touche("Enter", { apres: 0 });
    const vu = await suivreApres("Geste 6", t, attendu, { zone: "planning", verbe: "reporté" });
    verifier(vu.annonce === "Rappel reporté : Lun. 2 nov., 09:00.", `annonce « ${vu.annonce} »`);
    await controlerDisque("Geste 6", avant, t.id, attendu);
    attendus.set(t.id, { ...attendu, faite: false });
    const ordre = await controlerOrdre("Geste 6", t.liste);
    const rangApres = ordre.indexOf(esp(t.titre));
    b = await etatBouton(t.titre);
    verifier(rangApres !== rangAvant && b?.focus, `la ligne a bougé (rang ${rangAvant} → ${rangApres}) et le focus l’a suivie`);
  });

  await etape("Geste 8 · Période du 22 au 25 oct., en retard → Lundi", async () => {
    await surPage("/planning");
    const t = R.periode;
    const r = await reporterRappel("Geste 8", t, "Lundi");
    verifier(r.vu.date === esp("Lun. 2 nov., 09:00 → Jeu. 5 nov."), `la ligne écrit « Lun. 2 nov., 09:00 → Jeu. 5 nov. » (vu « ${r.vu.date} »)`);
    const d = tachesDisque().find((x) => x.id === t.id);
    verifier(d?.date === "2026-11-02" && d?.heure === "09:00" && d?.fin === "2026-11-05", `sur le disque : ${d?.date} ${d?.heure} → ${d?.fin} (durée gardée)`);
  });

  await etape("Garde · Rappel supprimé ou coché pendant que le menu est ouvert : rien n’est écrit", async () => {
    await surPage("/planning");
    /* Supprimé : la poubelle de la ligne est actionnée sans souris (un vrai clic ailleurs fermerait d'abord le menu). */
    let avant = tachesDisque();
    await ouvrirMenu(R.suppression.titre);
    await page(`window.__ligneGardee = itemMenu("Dans 1 h"); return true;`);
    await page(`document.querySelector(${q(`${RAPPELS} button[aria-label="Supprimer ${R.suppression.titre}"]`)}).click(); return true;`);
    await attendre(300);
    if (await page(`return !!menuReport();`)) {
      note("supprimé : le menu reste ouvert, on choisit « Dans 1 h » à la souris.");
      await choisirSouris("Dans 1 h");
    } else {
      note("supprimé : le menu disparaît avec la ligne ; un clic sur sa ligne gardée « Dans 1 h » ne doit rien faire.");
      await page(`window.__ligneGardee?.click(); return true;`);
    }
    await attendre(1500);
    let apres = tachesDisque();
    verifier(!apres.some((x) => x.id === R.suppression.id) && apres.length === avant.length - 1, `supprimé : le rappel n’est pas recréé (${apres.length} rappels pour ${avant.length - 1} attendus)`);
    verifier((await lignePlanning(R.suppression)).length === 0 && !(await page(`return !!menuReport();`)), "ni ligne ni menu à l’écran");
    const autres = avant.filter((x) => x.id !== R.suppression.id && q(sansNotif(apres.find((y) => y.id === x.id))) !== q(sansNotif(x)));
    verifier(!autres.length, "les autres rappels sont intacts");
    attendus.delete(R.suppression.id);

    /* Coché : la case de la ligne, sans souris, menu ouvert. */
    avant = tachesDisque();
    await ouvrirMenu(R.coche.titre);
    await page(`window.__ligneGardee = itemMenu("Lundi"); return true;`);
    await page(`document.querySelector(${q(`${RAPPELS} [role="checkbox"][aria-label="Terminer ${R.coche.titre}"]`)}).click(); return true;`);
    await attendre(300);
    if (await page(`return !!menuReport();`)) {
      note("coché : le menu reste ouvert, on choisit « Lundi » à la souris.");
      await choisirSouris("Lundi");
    } else {
      note("coché : le menu disparaît avec le bouton ; un clic sur sa ligne gardée « Lundi » ne doit rien faire.");
      await page(`window.__ligneGardee?.click(); return true;`);
    }
    await attendre(1500);
    apres = tachesDisque();
    const c = apres.find((x) => x.id === R.coche.id);
    verifier(c?.faite === true && c.date === R.coche.date && c.heure === R.coche.heure && apres.length === avant.length, `coché : il reste coché, à sa date (${c?.date} ${c?.heure}, faite ${c?.faite})`);
    const [l] = await lignePlanning(R.coche);
    verifier(l?.faite && l.bouton === null && !(await page(`return !!menuReport();`)), "la ligne est cochée, sans bouton, et aucun menu ne reste");
    attendus.set(R.coche.id, { ...attendus.get(R.coche.id), faite: true });
  });

  await etape("Reports rapides répétés, puis cible identique : un seul rappel", async () => {
    await surPage("/planning");
    const t = R.rapide;
    const avant = tachesDisque();
    const c0 = await compteurs();
    const cibles = () => page(`return ["Dans 1 h", "Demain matin", "Lundi"].map((c) => cible(c));`);
    const possibles = await cibles();
    for (const choix of ["Demain matin", "Lundi", "Dans 1 h", "Demain matin"]) {
      await ouvrirMenu(t.titre, "planning", { rapide: true });
      await choisirSouris(choix, { apres: 0 });
    }
    await page(`bouton(document.querySelector(RAPPELS), ${q(t.titre)})?.focus(); return true;`);
    for (const k of ["Enter", "Enter", "Enter", "ArrowDown", "Enter", "Enter"]) await app.touche(k, { apres: 25 });
    await attendre(600);
    if (await page(`return !!menuReport();`)) await app.touche("Escape");
    possibles.push(...(await cibles())); // « Dans 1 h » a pu changer de minute pendant la rafale
    await attendre(1500);
    const apres = tachesDisque();
    const siens = apres.filter((x) => x.id === t.id || x.titre === t.titre);
    const d = siens[0];
    verifier(siens.length === 1 && apres.length === avant.length && new Set(apres.map((x) => x.id)).size === apres.length, `un seul « ${t.titre} » sur le disque (${siens.length}), ${apres.length} rappels pour ${avant.length}`);
    verifier(!!d && possibles.some((p) => p.date === d.date && p.heure === d.heure) && d.faite === false && d.notifiee === false, `il est à l’une des cibles choisies (${d?.date} ${d?.heure}), non coché`);
    const autres = avant.filter((x) => x.id !== t.id && q(sansNotif(apres.find((y) => y.id === x.id))) !== q(sansNotif(x))).map((x) => x.id);
    verifier(!autres.length, `aucun autre rappel touché${autres.length ? ` (${autres.join(", ")})` : ""}`);
    verifier((await lignePlanning(t)).length === 1 && memes(await compteurs(), c0), "une seule ligne à l’écran, compteurs inchangés");
    if (d) attendus.set(t.id, { date: d.date, heure: d.heure, fin: null, faite: false });

    /* Deux fois la même cible (horloge figée) : réécrit sans effet, la date s'éclaire quand même. */
    const fige = await page(`return Date.now();`);
    await reporterRappel("Cible nouvelle", t, "Dans 1 h", { figer: fige });
    await reporterRappel("Cible identique", t, "Dans 1 h", { figer: fige });
  });

  await etape("Mouvement réduit : la date s’éclaire quand même", async () => {
    await surPage("/planning");
    await app.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    try {
      verifier(await app.ev(`matchMedia("(prefers-reduced-motion: reduce)").matches`), "mouvement réduit émulé (CDP Emulation.setEmulatedMedia)");
      await reporterRappel("Mouvement réduit", R.reduit, "Demain matin", { mouvement: "reduit" });
    } finally {
      await app.send("Emulation.setEmulatedMedia", { features: [] });
    }
  });

  await etape("Geste 7 · Fenêtre 1100 × 700 : la dernière ligne de la colonne la plus haute, en bas de l’écran", async () => {
    await surPage("/planning");
    await app.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
    try {
      await attendre(800);
      const avant = tachesDisque();
      const visee = await page(`
        const cols = [...document.querySelectorAll(RAPPELS + " section[aria-label]")];
        const col = cols.reduce((a, b) => (b.getBoundingClientRect().height > a.getBoundingClientRect().height ? b : a));
        const avecBouton = lignes(col).filter((li) => li.querySelector('button[aria-haspopup="menu"]'));
        const li = avecBouton[avecBouton.length - 1];
        li.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        const z = defileur(col);
        /* Le bas de page contient aussi le champ de saisie : placer le bouton
           près du bord, au lieu de supposer que scrollHeight y amène la ligne. */
        const b = li.querySelector('button[aria-haspopup="menu"]');
        if (z) z.scrollTop += b.getBoundingClientRect().bottom - (innerHeight - 65);
        return { colonne: col.getAttribute("aria-label"), titre: titreDe(li), hauteur: Math.round(col.getBoundingClientRect().height) };
      `);
      await attendre(300);
      const avantMesures = await page(`
        const rangee = document.querySelector(RAPPELS + " > div");
        const b = bouton(document.querySelector(RAPPELS), ${q(visee.titre)}).getBoundingClientRect();
        const z = defileur(document.querySelector(RAPPELS));
        return { fenetre: { l: innerWidth, h: innerHeight }, bouton: { haut: b.top, bas: b.bottom, gauche: b.left, droite: b.right }, rangee: { sw: rangee.scrollWidth, sh: rangee.scrollHeight, ch: rangee.clientHeight }, page: z ? { sh: z.scrollHeight, haut: z.scrollTop } : null };
      `);
      verifier(avantMesures.fenetre.l === 1100 && avantMesures.fenetre.h === 700, `zone d’affichage à ${avantMesures.fenetre.l} × ${avantMesures.fenetre.h} (CDP)`);
      verifier(
        avantMesures.bouton.bas <= 700 && avantMesures.bouton.bas > 700 - 160 && avantMesures.bouton.gauche >= 0 && avantMesures.bouton.droite <= 1100,
        `« ${visee.titre} », dernière ligne de ${visee.colonne} (${visee.hauteur} px, la plus haute), est en bas de l’écran (bouton à ${Math.round(avantMesures.bouton.haut)}–${Math.round(avantMesures.bouton.bas)} px)`,
      );
      await ouvrirMenu(visee.titre);
      await attendre(350); // fin de l'entrée du menu
      let m = await etatMenu(visee.titre);
      const dedans = (x) => x.rect.haut >= 7.5 && x.rect.bas <= x.fenetre.h - 7.5 && x.rect.gauche >= 7.5 && x.rect.droite <= x.fenetre.l - 7.5;
      verifier(m?.rect.bas <= m?.rectBouton.haut - 4, `le menu s’ouvre vers le haut (bas du menu ${Math.round(m?.rect.bas)} px, haut du bouton ${Math.round(m?.rectBouton.haut)} px)`);
      verifier(!!m && dedans(m), `il tient entier dans la fenêtre, à 8 px des bords (${q(m?.rect)})`);
      verifier(!!m && (Math.abs(m.rect.droite - m.rectBouton.droite) <= 1.5 || m.rect.droite >= m.fenetre.l - 8.5), `bord droit aligné sur le bouton : il s’ouvre vers la gauche (${Math.round(m?.rect.droite)} / ${Math.round(m?.rectBouton.droite)})`);
      verifier(m?.portail && memes(m?.items, m?.attendus), "rendu à part (portail), avec ses trois cibles");
      const pendant = await page(`
        const rangee = document.querySelector(RAPPELS + " > div");
        const z = defileur(document.querySelector(RAPPELS));
        return { rangee: { sw: rangee.scrollWidth, sh: rangee.scrollHeight, ch: rangee.clientHeight }, page: z ? { sh: z.scrollHeight, haut: z.scrollTop } : null };
      `);
      verifier(
        memes(pendant.rangee, avantMesures.rangee) && pendant.rangee.sh <= pendant.rangee.ch && pendant.page?.sh === avantMesures.page?.sh,
        `aucune barre de défilement en plus dans la rangée des colonnes ni dans la page (${q(pendant.rangee)})`,
      );

      /* Défiler la page le replace contre son bouton. */
      const point = await page(`
        const m = menuReport();
        const z = defileur(document.querySelector(RAPPELS));
        for (const [x, y] of [[innerWidth / 2, 60], [innerWidth - 20, 120], [innerWidth / 2, innerHeight / 3]]) {
          const el = document.elementFromPoint(x, y);
          if (el && z?.contains(el) && !m?.contains(el)) return { x, y };
        }
        return null;
      `);
      if (point) {
        await app.molette(point.x, point.y, -60);
        await attendre(600);
      }
      let deplace = await page(`const z = defileur(document.querySelector(RAPPELS)); return z?.scrollTop;`);
      if (!point || deplace === avantMesures.page?.haut) {
        note("la molette n’a pas fait défiler la page : défilement par scrollTop.");
        await page(`const z = defileur(document.querySelector(RAPPELS)); z.scrollTop -= 60; return true;`);
        await attendre(400);
        deplace = await page(`const z = defileur(document.querySelector(RAPPELS)); return z?.scrollTop;`);
      }
      m = await etatMenu(visee.titre);
      const contre = !!m && (Math.abs(m.rect.bas - (m.rectBouton.haut - 6)) <= 1.5 || Math.abs(m.rect.haut - (m.rectBouton.bas + 6)) <= 1.5);
      verifier(
        deplace !== avantMesures.page?.haut && Math.abs(m?.rectBouton.haut - avantMesures.bouton.haut) >= 20 && contre && dedans(m),
        `la page défile (${avantMesures.page?.haut} → ${deplace}) : le menu suit son bouton, à 6 px, toujours entier`,
      );

      /* L'app quitte le premier plan : le menu se ferme. */
      await page(`window.dispatchEvent(new Event("blur")); return true;`);
      await attendre(300);
      const b = await etatBouton(visee.titre);
      verifier(!(await page(`return !!menuReport();`)) && b?.expanded === "false", "la fenêtre perd le focus (blur) : le menu se ferme");
      await controlerInchange("fenêtre minimale", avant);
    } finally {
      await app.send("Emulation.clearDeviceMetricsOverride");
      await attendre(400);
    }
  });

  await etape("Fin de la première session : rien d’envoyé, tout est à sa date", async () => {
    await attendre(1200);
    controlerAttendus("fin de session");
    const d = lireDisque();
    verifier((d.messages ?? []).length === 0 && (d.chats ?? []).length === 0, "aucun message ni conversation : rien n’est envoyé");
    verifier(await page(`return window.Notification === window.__horloge.Notification;`), "toutes les notifications sont passées par l’enregistreur");
    verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` (${app.erreurs.join(" | ")})` : ""}`);
  });
  await app.fermer();

  /* ─── Après un redémarrage ─────────────────────────────────────── */
  app = await lancer(VENDREDI);

  await etape("Geste 8 (suite) · Après redémarrage : les dates sont gardées, un seul rappel", async () => {
    await surPage("/planning");
    controlerAttendus("après redémarrage");
    await controlerPlanning("après redémarrage");
    const p = await lignePlanning(R.periode);
    verifier(p.length === 1 && p[0].date === esp("Lun. 2 nov., 09:00 → Jeu. 5 nov."), `« ${R.periode.titre} » : une seule ligne, « ${p[0]?.date} »`);
    verifier((await lignePlanning(R.suppression)).length === 0, "le rappel supprimé n’est pas revenu");
  });

  await etape("Geste 2 (minuit) · À 23:30, Dans 1 h → Demain, 00:30", async () => {
    await app.regler(VENDREDI_SOIR);
    const r = await reporterRappel("Geste 2 (23:30)", R.minuit, "Dans 1 h", {
      figer: VENDREDI_SOIR,
      litteraux: ["Dans 1 h, Demain, 00:30", "Demain matin, Sam. 31 oct., 09:00", "Lundi, Lun. 2 nov., 09:00"],
    });
    verifier(r.vu.date === "Demain, 00:30", `la ligne écrit « Demain, 00:30 » (vu « ${r.vu.date} »)`);
    const d = tachesDisque().find((x) => x.id === R.minuit.id);
    verifier(d?.date === "2026-10-31" && d?.heure === "00:30", `sur le disque : ${d?.date} ${d?.heure}`);
  });

  await etape("Geste 3 · Samedi 00:40 : Demain matin → Dim. 1 nov., 09:00", async () => {
    await app.regler(SAMEDI_NUIT);
    const n = await notificationsDe(R.minuit.titre);
    verifier(n === 1, `le rappel reporté à 00:30 a sonné à sa nouvelle heure (notification enregistrée au chargement de 00:40 : ${n})`);
    const [avant] = await lignePlanning(R.nuit);
    verifier(avant?.date === "Hier" && avant.rouge, `« ${R.nuit.titre} » : « ${avant?.date} », en rouge`);
    const r = await reporterRappel("Geste 3 (samedi 00:40)", R.nuit, "Demain matin", {
      figer: SAMEDI_NUIT,
      litteraux: ["Dans 1 h, Aujourd’hui, 01:40", "Demain matin, Dim. 1 nov., 09:00", "Lundi, Lun. 2 nov., 09:00"],
    });
    verifier(r.vu.date === "Demain, 09:00", `la ligne écrit « Demain, 09:00 » (vu « ${r.vu.date} »)`);
    const d = tachesDisque().find((x) => x.id === R.nuit.id);
    verifier(d?.date === "2026-11-01" && d?.heure === "09:00", `sur le disque : ${d?.date} ${d?.heure} (dimanche)`);
  });

  await etape("Geste 3 · Dimanche : deux lignes, pas de « Lundi »", async () => {
    await app.regler(DIMANCHE);
    const avant = tachesDisque();
    await horlogePage(`figer(${DIMANCHE})`);
    await ouvrirMenu(R.rapide.titre);
    const m = await etatMenu(R.rapide.titre);
    verifier(
      memes(m?.items, [esp("Dans 1 h, Aujourd’hui, 11:00"), esp("Demain matin, Lun. 2 nov., 09:00")]),
      `deux lignes : ${q(m?.items)}`,
    );
    await app.touche("Escape");
    verifier(!(await page(`return !!menuReport();`)), "Échap ferme");
    await horlogePage("reprendre()");
    await controlerInchange("dimanche", avant);
  });

  await etape("Geste 3 · Lundi : « Lundi » vise le lundi suivant", async () => {
    await app.regler(LUNDI);
    const r = await reporterRappel("Geste 3 (lundi)", R.lundi, "Lundi", {
      figer: LUNDI,
      litteraux: ["Dans 1 h, Aujourd’hui, 11:00", "Demain matin, Mar. 3 nov., 09:00", "Lundi, Lun. 9 nov., 09:00"],
    });
    verifier(r.vu.date === "Lun. 9 nov., 09:00", `la ligne écrit « Lun. 9 nov., 09:00 » (vu « ${r.vu.date} »)`);
    const d = tachesDisque().find((x) => x.id === R.lundi.id);
    verifier(d?.date === "2026-11-09" && d?.heure === "09:00", `sur le disque : ${d?.date} ${d?.heure}`);
  });

  await etape("Fin : un seul rappel par titre, rien d’envoyé, aucune erreur", async () => {
    await attendre(1200);
    controlerAttendus("fin");
    const d = lireDisque();
    verifier((d.messages ?? []).length === 0 && (d.chats ?? []).length === 0, "aucun message ni conversation : rien n’est envoyé");
    verifier(await page(`return window.Notification === window.__horloge.Notification;`), "toutes les notifications sont passées par l’enregistreur");
    verifier(app.erreurs.length === 0, `aucune erreur dans la page après redémarrage${app.erreurs.length ? ` (${app.erreurs.join(" | ")})` : ""}`);
  });
} catch (err) {
  verifier(false, `le test a planté : ${err instanceof Error ? err.message : err}`);
} finally {
  await app?.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout passe.");
process.exit(echecs.length ? 1 : 0);
