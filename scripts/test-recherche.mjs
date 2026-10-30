/**
 * Rechercher dans les conversations (Ctrl+K, ⌘K sur Mac), dans l'app de bureau
 * (export statique), avec de vrais gestes clavier et souris : les huit gestes de
 * validation de la spec (SPEC-RECHERCHE.md §11), plus la frappe rapide, une
 * requête qui ressemble à du HTML ou à une expression régulière, une réponse en
 * cours, les fils archivé et supprimé, le premier message d'une conversation de
 * 300 messages, le mouvement réduit, la fenêtre minimale (1100 × 700) et un
 * redémarrage. Ni le brouillon ni les messages ne doivent bouger.
 * Dossier personnel et données de l'app temporaires, données fictives.
 * Aucun agent ne tourne : Claude Code est rendu introuvable pour l'app, et rien n'est envoyé.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   xvfb-run -a node scripts/test-recherche.mjs        (sous Linux sans bac à sable : ajouter --no-sandbox)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-recherche-"));
const DONNEES = path.join(TMP, "userdata");
const MAISON = path.join(TMP, "home");
const PORT = 9341;
const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const q = JSON.stringify;
const memes = (a, b) => q(a) === q(b);
/** Espaces (insécables compris) réduits à un seul : les textes de l'interface se comparent ainsi. */
const esp = (t) => String(t ?? "").replace(/\s+/gu, " ").trim();
const contient = (texte, morceau) => esp(texte).includes(esp(morceau));

/* ─── Les données de départ (fictives) ──────────────────────────── */

const MAINTENANT = Date.now();
const il_y_a = (min) => new Date(MAINTENANT - min * 60_000).toISOString();
const toi = (id, chatId, min, text, autres = []) => ({ id, chatId, author: { kind: "user" }, createdAt: il_y_a(min), parts: [{ type: "text", text }, ...autres] });
const agent = (id, chatId, roleId, min, text, statut = "fait") => ({ id, chatId, author: { kind: "role", roleId }, createdAt: il_y_a(min), statut, parts: [{ type: "text", text }] });

const PROJET = "projet-recherche";
const REFONTE = "equipe-refonte";
const TITRE_REFONTE = "Refonte de la page d’accueil";
const JOURNAL = "equipe-journal";
const HUGO = "dm-dev"; // l'agent « dev », prénom Hugo (fiche fictive posée dans le dossier personnel temporaire)
const PRINCIPAL = "dm-principal"; // vidée par « Nouvelle conversation » (geste 7)
const FIL_ARCHIVE = "klyra-fil-arch0001";
const FIL_SUPPRIME = "klyra-fil-supp0001";
const DEVIS = path.join(TMP, "pieces", "devis-v2.pdf");
const BROUILLON = "Brouillon pour Hugo : relire le thème sombre avant vendredi";
const CURSEUR = BROUILLON.length - "vendredi".length;
const AIDE = "Cherche un mot, une décision ou un lien dans tes conversations avec les agents et dans les conversations de projet.";

/* Plus de deux écrans ; le seul terme cherché, « Orchidée-finale », est tout à la fin. */
const LONG = [
  ...Array.from({ length: 90 }, (_, i) => `Paragraphe ${i + 1} : on vérifie les marges, les grilles et les contrastes de la section ${i + 1}, sans rien changer d’autre.`),
  "Dernier point : la palette Orchidée-finale est validée pour les boutons.",
].join("\n\n");

const messagesRefonte = [
  toi("r-accueil", REFONTE, 4100, "Bonjour l’équipe, on lance la refonte de la page d’accueil (dossier Mirabelle)."),
  agent("r-long", REFONTE, "dev", 4090, LONG),
  agent("r-glycine", REFONTE, "dev", 4080, "Je pars sur la palette Glycine pour les fonds, avec un contraste AA partout."),
  toi("r-decision", REFONTE, 4070, "Notre décision : on garde l’aperçu en pleine largeur pour la version 2 du site."),
  agent("r-lien", REFONTE, "principal", 4060, "Voici [la maquette](https://figma.example/file/zq7Recherche) de l’accueil, à relire avant jeudi."),
  toi("r-logo", REFONTE, 4050, "La version du logo passe en 2 couleurs, sans dégradé."),
  toi("r-balise", REFONTE, 4040, "Pour le titre, la balise <b> suffit ; le motif `.*` attrape tout en regex, on l’évite."),
  toi("r-devis", REFONTE, 4030, "Voici le devis mis à jour.", [{ type: "fichiers", chemins: [DEVIS] }]),
  /* De quoi centrer les messages ci-dessus : il faut de la conversation en dessous. */
  ...Array.from({ length: 8 }, (_, k) =>
    k % 2
      ? agent(`r-fin-${k + 1}`, REFONTE, "principal", 4020 - 2 * k, `Point d’étape ${k + 1} : la relecture continue, rien de bloquant.`)
      : toi(`r-fin-${k + 1}`, REFONTE, 4020 - 2 * k, `Point d’étape ${k + 1} : la relecture continue, rien de bloquant.`),
  ),
  agent("r-en-cours", REFONTE, "dev", 4000, "Je regarde la piste Kaléidovent et je reviens vers toi…", "en-cours"),
];
const messagesJournal = Array.from({ length: 300 }, (_, i) => {
  const id = `j${String(i).padStart(3, "0")}`;
  const t = i === 0 ? "Premier relevé : l’ammonite fossile ouvre le journal de chantier." : `Relevé n°${i} : rien à signaler sur le chantier.`;
  return i % 2 ? agent(id, JOURNAL, "principal", 20000 - i, t) : toi(id, JOURNAL, 20000 - i, t);
});
const messagesHugo = [
  toi("h-1", HUGO, 1500, "Salut Hugo, tu peux reprendre la palette Glycine dans le thème sombre ?"),
  agent("h-2", HUGO, "dev", 1495, "Oui, la palette Glycine est prête dans le thème sombre."),
];
const messagesPrincipal = [
  toi("p-1", PRINCIPAL, 1200, "Peux-tu préparer le récapitulatif Mirabelle pour lundi ?"),
  agent("p-2", PRINCIPAL, "principal", 1195, "Le récapitulatif Mirabelle est prêt, je le joins ici."),
];
const messagesArchive = [
  toi("a-0", FIL_ARCHIVE, 2000, "Fais l’audit des polices de la page d’accueil."),
  agent("a-1", FIL_ARCHIVE, "dev", 1990, "Conclusion de l’audit : la fonte Tamarillo reste la plus lisible."),
];
const messagesSupprime = [toi("s-1", FIL_SUPPRIME, 2500, "Note perdue : le mot Zanzibarre ne doit jamais ressortir.")];

const conversation = (id, kind, projectId, title, roleIds, messages, plus = {}) => ({
  id,
  kind,
  projectId,
  title,
  roleIds,
  updatedAt: messages.at(-1).createdAt,
  sessions: {},
  luJusqua: messages.at(-1).id,
  ...plus,
});
const DOSSIER_PROJET = path.join(TMP, "projet-recherche");
mkdirSync(DOSSIER_PROJET, { recursive: true });
mkdirSync(path.dirname(DEVIS), { recursive: true });
writeFileSync(DEVIS, "%PDF-1.4\n% devis fictif pour le test de la recherche\n");
mkdirSync(DONNEES, { recursive: true });
const depart = {
  version: 1,
  chats: [
    conversation(REFONTE, "equipe", PROJET, TITRE_REFONTE, ["principal", "dev"], messagesRefonte),
    conversation(JOURNAL, "equipe", PROJET, "Journal de chantier", ["principal", "dev"], messagesJournal),
    conversation(HUGO, "direct", null, "Hugo", ["dev"], messagesHugo),
    conversation(PRINCIPAL, "direct", null, "Principal", ["principal"], messagesPrincipal),
    conversation(FIL_ARCHIVE, "direct", null, "Audit des polices", ["dev"], messagesArchive, {
      fil: { roleId: "dev", statut: "archive", creeLe: il_y_a(2000), lancePar: null },
    }),
    conversation(FIL_SUPPRIME, "direct", null, "Essai abandonné", ["dev"], messagesSupprime, {
      fil: { roleId: "dev", statut: "archive", supprime: true, creeLe: il_y_a(2500), lancePar: null },
    }),
  ],
  messages: [...messagesRefonte, ...messagesJournal, ...messagesHugo, ...messagesPrincipal, ...messagesArchive, ...messagesSupprime],
  projects: [
    { id: PROJET, name: "Atelier Bellevue", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal", "dev"], brief: "", previewUrl: "", folder: DOSSIER_PROJET, files: [], updatedAt: il_y_a(4000) },
  ],
};
const CONVERSATIONS = path.join(DONNEES, "conversations.json");
writeFileSync(CONVERSATIONS, JSON.stringify(depart));
const surDisque = () => JSON.parse(readFileSync(CONVERSATIONS, "utf8"));

/* Hugo : une fiche d'agent fictive dans le dossier personnel temporaire (jamais le vrai ~/.claude). */
mkdirSync(path.join(MAISON, ".claude", "agents"), { recursive: true });
writeFileSync(
  path.join(MAISON, ".claude", "agents", "dev.md"),
  `---\nname: dev\ndisplayName: Hugo\ndescription: "Développeur — fiche fictive pour le test de la recherche."\n---\n\n# Hugo — Dev\n\nFiche fictive : aucun agent ne tourne pendant ce test.\n`,
);

/** Les conversations vidées par le test : leurs messages doivent avoir disparu du disque, et seulement eux. */
const vides = new Set();
/** r-en-cours relu comme une réponse interrompue au chargement (vu dans le fil, à la préparation). */
let enCoursInterrompu = false;

/* ─── L'app et ses outils de pilotage ───────────────────────────── */

/* Aucun agent ne doit tourner : Claude Code introuvable, aucune clé. */
const env = { ...process.env, HOME: MAISON, KLYRA_USER_DATA: DONNEES, PATH: "/usr/bin:/bin" };
for (const v of ["ELECTRON_RUN_AS_NODE", "KLYRA_DEV_URL", "KLYRA_SMOKE_TEST", "KLYRA_CLAUDE_PATH", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete env[v];

/** Ctrl sous Linux et Windows, ⌘ sur Mac (modificateurs CDP : 2 = Ctrl, 4 = Meta, 8 = Maj). */
const MOD = process.platform === "darwin" ? 4 : 2;
const MAJ = 8;
const TOUCHES = {
  Enter: { key: "Enter", code: "Enter", vk: 13, texte: "\r" },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
};

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
  // La fenêtre se comporte comme si elle avait le focus, même sous un écran virtuel.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const ev = async (x) => {
    const m = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? "erreur dans la page");
    return m.result?.result?.value;
  };
  for (let i = 0; i < 40 && !(await ev("document.body?.innerText.length > 0 && !!window.klyra")); i++) await attendre(500);
  /** Une vraie touche, envoyée à Chromium comme par le clavier. */
  const cle = async (key, code, vk, { modifiers = 0, texte, commandes } = {}) => {
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
    await send("Input.dispatchKeyEvent", { type: texte ? "keyDown" : "rawKeyDown", ...base, ...(texte ? { text: texte, unmodifiedText: texte } : {}), ...(commandes ? { commands: commandes } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  const souris = async (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
  return {
    erreurs,
    ev,
    send,
    async aller(chemin) {
      await ev(`window.next?.router ? window.next.router.push(${q(chemin)}) : (location.href = ${q(chemin)})`);
      await attendre(1500);
    },
    async quand(expression, ms = 15000) {
      for (let t = 0; t < ms; t += 100) {
        if (await ev(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return true;
        await attendre(100);
      }
      return false;
    },
    async touche(nom, { modifiers = 0, apres = 150 } = {}) {
      const t = TOUCHES[nom];
      await cle(t.key, t.code, t.vk, { modifiers, texte: modifiers ? undefined : t.texte });
      await attendre(apres);
    },
    /** Ctrl+K (⌘K sur Mac). */
    async raccourci() {
      await cle("k", "KeyK", 75, { modifiers: MOD });
      await attendre(250);
    },
    /** Ctrl+A dans le champ. */
    toutSelectionner: () => cle("a", "KeyA", 65, { modifiers: MOD, commandes: ["selectAll"] }),
    /** Frappe lettre à lettre, avec `ecart` ms entre deux touches. */
    async taper(texte, ecart = 0) {
      for (const c of texte) {
        if (/^[\x20-\x7e]$/.test(c)) await cle(c, c === " " ? "Space" : "", c === " " ? 32 : 0, { texte: c });
        else await send("Input.insertText", { text: c });
        if (ecart) await attendre(ecart);
      }
    },
    async cliquerEn(x, y) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await souris(type, x, y);
      await attendre(300);
    },
    async cliquer(selecteur) {
      const r = await ev(`(() => { const b = document.querySelector(${q(selecteur)})?.getBoundingClientRect(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      if (!r) throw new Error(`introuvable : ${selecteur}`);
      await this.cliquerEn(r.x, r.y);
    },
    /** La souris au bord droit, hors de la carte : son survol ne doit pas choisir de ligne. */
    async parquer() {
      const f = await ev("({ l: innerWidth, h: innerHeight })");
      await souris("mouseMoved", f.l - 10, f.h - 10);
    },
    /** La vraie fenêtre si le protocole le permet, sinon la zone d'affichage émulée. */
    async redimensionner(largeur, hauteur) {
      const fenetre = await send("Browser.getWindowForTarget", { targetId: cible.id });
      if (fenetre.result?.windowId !== undefined) {
        const r = await send("Browser.setWindowBounds", { windowId: fenetre.result.windowId, bounds: { width: largeur, height: hauteur, windowState: "normal" } });
        if (!r.error) {
          await attendre(800);
          return "fenêtre redimensionnée";
        }
      }
      await send("Emulation.setDeviceMetricsOverride", { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile: false });
      await attendre(800);
      return "zone d’affichage émulée par CDP";
    },
    async retablirTaille() {
      await send("Emulation.clearDeviceMetricsOverride");
      const fenetre = await send("Browser.getWindowForTarget", { targetId: cible.id });
      if (fenetre.result?.windowId !== undefined) await send("Browser.setWindowBounds", { windowId: fenetre.result.windowId, bounds: { width: 1440, height: 900 } });
      await attendre(600);
    },
    fermer() {
      ws.close();
      processus.kill();
      return new Promise((r) => processus.once("exit", r));
    },
  };
}

/* ─── Lire la fenêtre de recherche et le fil ────────────────────── */

const FENETRE = '[role="dialog"][aria-label="Rechercher dans les conversations"]';
const CHAMP = `${FENETRE} input[role="combobox"]`;
const COMPOSEUR = 'textarea[aria-label="Message"]';
/** Outils communs aux lectures dans la page. */
const OUTILS = `
  const FENETRE = ${q(FENETRE)};
  /* La zone qui défile autour d'un message : le fil (même trop court pour défiler). */
  const zoneDe = (el) => {
    for (let p = el?.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
    return null;
  };
  const esp = (t) => String(t ?? "").replace(/\\s+/gu, " ").trim();
`;
let app;
const page = (corps) => app.ev(`(() => { ${OUTILS} ${corps} })()`);

const etat = () =>
  page(`
    const d = document.querySelector(FENETRE);
    const champ = d?.querySelector('input[role="combobox"]');
    const liste = d?.querySelector('[role="listbox"][aria-label="Résultats"]');
    const lb = liste?.getBoundingClientRect();
    const f = document.activeElement;
    const rail = document.querySelector('button[aria-label="Rechercher"]');
    const lignes = liste
      ? [...liste.querySelectorAll('[role="option"]')].map((o) => {
          const r = o.getBoundingClientRect();
          return {
            id: o.id,
            chat: o.getAttribute("data-chat"),
            message: o.getAttribute("data-message"),
            active: o.getAttribute("aria-selected") === "true",
            texte: esp(o.innerText),
            marques: [...o.querySelectorAll("mark")].map((m) => m.textContent),
            visible: !!lb && r.top >= lb.top - 1 && r.bottom <= lb.bottom + 1,
          };
        })
      : [];
    const puces = d
      ? [...d.querySelectorAll('[role="radiogroup"][aria-label="Où chercher"] [role="radio"]')].map((p) => {
          const n = [...p.querySelectorAll("span")].map((s) => esp(s.innerText)).find((s) => /^\\d+$/.test(s));
          return { nom: esp(p.innerText).replace(/[\\s\\d]+$/, ""), coche: p.getAttribute("aria-checked") === "true", nombre: n === undefined ? null : Number(n) };
        })
      : [];
    const statuts = d ? [...d.querySelectorAll('[role="status"]')].map((s) => esp(s.innerText)) : [];
    const carte = d?.getBoundingClientRect();
    return {
      ouverte: !!d,
      modale: d?.getAttribute("aria-modal") ?? null,
      valeur: champ?.value ?? null,
      invite: champ?.getAttribute("placeholder") ?? null,
      selection: champ ? [champ.selectionStart, champ.selectionEnd] : null,
      descendant: champ?.getAttribute("aria-activedescendant") ?? null,
      surChamp: !!champ && f === champ,
      dansFenetre: !!d && d.contains(f),
      focus: f?.getAttribute("aria-label") ?? (esp(f?.innerText).slice(0, 40) || f?.tagName) ?? null,
      rail: rail ? { haspopup: rail.getAttribute("aria-haspopup"), expanded: rail.getAttribute("aria-expanded") } : null,
      puces,
      lignes,
      messages: lignes.filter((l) => l.message).map((l) => l.message),
      active: lignes.find((l) => l.active) ?? null,
      compteur: statuts.find((s) => /résultat/.test(s)) ?? "",
      texte: esp(d?.innerText),
      carte: carte ? { l: Math.round(carte.width), haut: Math.round(carte.top), bas: Math.round(carte.bottom) } : null,
      defile: !!liste && liste.scrollHeight > liste.clientHeight,
      page: location.pathname + location.search,
    };
  `);
const puceCochee = (e) => e.puces.find((p) => p.coche)?.nom ?? null;

const composeur = () =>
  page(`
    const c = document.querySelector(${q(COMPOSEUR)});
    let brouillons = null;
    try { brouillons = JSON.parse(localStorage.getItem("klyra-brouillons") ?? "null"); } catch {}
    return { valeur: c?.value ?? null, focus: !!c && document.activeElement === c, debut: c?.selectionStart ?? null, fin: c?.selectionEnd ?? null, temoin: c?.__temoin ?? null, brouillons, page: location.pathname + location.search };
  `);
const BROUILLONS_ATTENDUS = { [HUGO]: { text: BROUILLON, fichiers: [] } };

async function ouvrir(par = "raccourci") {
  if (par === "rail") await app.cliquer('button[aria-label="Rechercher"]');
  else await app.raccourci();
  if (!(await app.quand(`!!document.querySelector(${q(FENETRE)})`, 2500))) throw new Error(`la fenêtre de recherche ne s’ouvre pas (${par === "rail" ? "bouton Rechercher du rail" : "Ctrl+K"})`);
  await attendre(150);
}

/** Remplace la requête par `requete`, tapée au clavier, puis laisse passer le délai de frappe (120 ms). */
async function chercher(requete, { ecart = 0, delai = 400 } = {}) {
  if (!(await etat()).surChamp) await app.cliquer(CHAMP);
  await app.toutSelectionner();
  await app.touche("Backspace", { apres: 50 });
  await app.taper(requete, ecart);
  await attendre(delai);
  return etat();
}

async function puce(nom) {
  const r = await page(`
    const p = [...document.querySelectorAll(FENETRE + ' [role="radiogroup"][aria-label="Où chercher"] [role="radio"]')].find((p) => esp(p.innerText).startsWith(${q(nom)}));
    const b = p?.getBoundingClientRect();
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  `);
  if (!r) throw new Error(`puce introuvable : ${nom}`);
  await app.cliquerEn(r.x, r.y);
  await app.parquer();
  await attendre(250);
}

async function boutonDeLaFenetre(texte) {
  const r = await page(`
    const b = [...document.querySelectorAll(FENETRE + " button")].find((b) => esp(b.innerText) === ${q(texte)});
    const r = b?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  `);
  if (!r) throw new Error(`bouton introuvable dans la fenêtre : ${texte}`);
  await app.cliquerEn(r.x, r.y);
  await app.parquer();
  await attendre(250);
}

/** Un point de l'écran sans rien de cliquable dessous : le clic sur le voile ne doit rien déclencher derrière. */
const pointNeutre = () =>
  page(`
    for (const [x, y] of [[innerWidth - 12, innerHeight - 12], [innerWidth - 12, innerHeight / 2], [innerWidth / 2, innerHeight - 12]]) {
      const el = document.elementFromPoint(x, y);
      if (el && !el.closest("a, button, input, textarea, select, [role=button], [role=tab], [tabindex], [contenteditable]")) return { x, y };
    }
    return { x: innerWidth - 12, y: innerHeight - 12 };
  `);

/**
 * Espion posé juste avant d'ouvrir un résultat : l'adresse à chaque changement
 * (y compris le passage par `&message=`, aussitôt retiré), l'éclairage du message
 * (début, fin, position du fil à ce moment-là), son focus et l'annonce polie.
 */
const espion = (cible) =>
  page(`
    clearInterval(window.__espion?.minuteur);
    const sel = ${q(cible ? `[data-message="${cible}"]` : "[data-message]")};
    const e = { urls: [], eclaire: null, focus: false, annonce: null, t0: performance.now() };
    e.noter = () => {
      const u = location.pathname + location.search;
      if (e.urls[e.urls.length - 1] !== u) e.urls.push(u);
      const t = Math.round(performance.now() - e.t0);
      const el = document.querySelector(sel + "[data-eclaire]");
      if (el) {
        if (!e.eclaire) e.eclaire = { id: el.getAttribute("data-message"), de: t, a: null, hautDebut: zoneDe(el)?.scrollTop ?? null };
        e.eclaire.a = null;
      } else if (e.eclaire && e.eclaire.a === null) e.eclaire.a = t;
      if (document.activeElement?.matches?.(sel)) e.focus = true;
      if (!e.annonce) {
        const n = [...document.querySelectorAll('[aria-live="polite"]')].find((n) => !n.closest(FENETRE) && esp(n.textContent).startsWith("Message de "));
        if (n) e.annonce = esp(n.textContent);
      }
    };
    if (!window.__historiqueEspionne) {
      window.__historiqueEspionne = true;
      for (const nom of ["pushState", "replaceState"]) {
        const avant = history[nom];
        history[nom] = function (...args) {
          const r = avant.apply(this, args);
          window.__espion?.noter();
          return r;
        };
      }
    }
    e.noter();
    e.minuteur = setInterval(e.noter, 10);
    window.__espion = e;
    return true;
  `);

/** Où en est le message visé : surlignage, centrage, focus, annonce. */
const mesurer = (cible) =>
  page(`
    const el = document.querySelector(${q(`[data-message="${cible}"]`)});
    const zone = zoneDe(el);
    const h = window.CSS?.highlights?.get("klyra-recherche");
    const plages = h ? [...h] : [];
    plages.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
    const r = plages[0]?.getBoundingClientRect();
    const z = zone?.getBoundingClientRect();
    const b = el?.getBoundingClientRect();
    const annonce = [...document.querySelectorAll('[aria-live="polite"]')].map((n) => esp(n.textContent)).find((t) => t.startsWith("Message de ")) ?? null;
    return {
      existe: !!el,
      focus: !!el && document.activeElement === el,
      eclaire: !!el?.hasAttribute("data-eclaire"),
      textes: plages.map((p) => p.toString()),
      dansMessage: plages.length > 0 && plages.every((p) => !!el?.contains(p.commonAncestorContainer)),
      ecart: r && z ? Math.round(r.top + r.height / 2 - (z.top + z.height / 2)) : null,
      visible: !!r && !!z && r.top >= z.top - 1 && r.bottom <= z.bottom + 1,
      hautBloc: b && z ? Math.round(b.top - z.top) : null,
      haut: zone ? Math.round(zone.scrollTop) : null,
      max: zone ? Math.round(zone.scrollHeight - zone.clientHeight) : null,
      hauteurZone: zone?.clientHeight ?? null,
      annonce,
      page: location.pathname + location.search,
      fenetre: !!document.querySelector(FENETRE),
      espion: window.__espion ? { urls: window.__espion.urls, eclaire: window.__espion.eclaire, focus: window.__espion.focus, annonce: window.__espion.annonce } : null,
    };
  `);

/** Attend la fin du défilement : la position du fil ne bouge plus pendant 300 ms. */
async function stable(cible, ms = 3000) {
  let avant = null;
  let calme = 0;
  for (let t = 0; t < ms && calme < 3; t += 100) {
    const h = await page(`return zoneDe(document.querySelector(${q(`[data-message="${cible}"]`)}))?.scrollTop ?? null;`);
    calme = h !== null && h === avant ? calme + 1 : 0;
    avant = h;
    await attendre(100);
  }
}

/**
 * Ouvre la ligne active (Entrée) ou la ligne visée (clic), puis vérifie l'arrivée au passage (§6) :
 * adresse, éclairage, focus, surlignage, centrage, annonce ; en option la durée de l'éclairage
 * et le défilement instantané (mouvement réduit).
 */
async function arriver(nom, { chat, message, attendus, geste = "entree", centrage = "strict", duree = false, reduit = false }) {
  await espion(message);
  if (geste === "clic") {
    await app.cliquer(`${FENETRE} [role="option"][data-message="${message}"]`);
    await app.parquer();
  } else await app.touche("Enter");
  const finale = `/chat?id=${chat}`;
  await app.quand(`window.__espion?.urls.some((u) => u.includes("message="))`, 3000);
  const arrive = await app.quand(`!document.querySelector(${q(FENETRE)}) && location.pathname + location.search === ${q(finale)}`, 5000);
  await app.quand(`window.__espion?.eclaire`, 3000);
  await stable(message);
  const m = await mesurer(message);
  const e = m.espion ?? { urls: [], eclaire: null };
  verifier(arrive && !m.fenetre, `${nom} : ${geste === "clic" ? "le clic" : "Entrée"} ferme la fenêtre et ouvre ${finale} (adresse : ${m.page})`);
  verifier(e.urls.includes(`/chat?id=${chat}&message=${message}`) && m.page === finale, `${nom} : l’adresse passe par &message=${message}, puis le paramètre est retiré (${e.urls.join(" → ")})`);
  verifier(e.eclaire?.id === message, `${nom} : le message ${message} s’éclaire (data-eclaire)`);
  verifier(m.focus || e.focus, `${nom} : le message reçoit le focus`);
  verifier(attendus.every((t) => m.textes.includes(t)) && m.dansMessage, `${nom} : surligné dans le message : ${q(m.textes)} (attendu ${q(attendus)})`);
  const tolerance = Math.round(Math.max(48, (m.hauteurZone ?? 0) * 0.08));
  if (centrage === "strict") {
    verifier(m.ecart !== null && Math.abs(m.ecart) <= tolerance, `${nom} : la première occurrence est centrée dans le fil (écart ${m.ecart} px, tolérance ${tolerance})`);
  } else {
    /* En haut (ou en bas) du fil, le centrage bute sur le bord : l'occurrence doit au moins être visible. */
    const bord = m.haut !== null && (m.haut <= 1 || m.haut >= m.max - 1);
    verifier(m.visible && (bord || Math.abs(m.ecart) <= tolerance), `${nom} : l’occurrence est visible, centrée ou au bord du fil (écart ${m.ecart} px, position ${m.haut}/${m.max})`);
  }
  const annonce = e.annonce ?? m.annonce;
  verifier(!!annonce?.startsWith("Message de "), `${nom} : la région polie annonce « ${annonce ?? "rien"} »`);
  if (reduit) {
    const debut = e.eclaire?.hautDebut;
    verifier(debut !== null && debut !== undefined && Math.abs(debut - m.haut) <= 2, `${nom} : défilement instantané, le fil est déjà à sa place quand le message s’éclaire (${debut} → ${m.haut})`);
    verifier(m.eclaire || (e.eclaire && e.eclaire.a === null), `${nom} : l’éclairage est encore là juste après l’arrivée`);
  }
  if (duree) {
    await app.quand(`window.__espion?.eclaire?.a !== null`, 4500);
    const fin = await page(`return window.__espion?.eclaire ? { ...window.__espion.eclaire, maintenant: Math.round(performance.now() - window.__espion.t0) } : null;`);
    const d = fin?.a !== null && fin?.a !== undefined ? fin.a - fin.de : null;
    verifier(
      d !== null && d >= 1300 && d <= 2800,
      `${nom} : l’éclairage dure environ 1,8 s, puis data-eclaire est retiré (${d !== null ? `${d} ms` : fin ? `encore là ${fin.maintenant - fin.de} ms après` : "jamais vu"})`,
    );
  }
  return m;
}

/** Les ids des messages trouvés, dans l'ordre (les plus récents d'abord), et le compteur du pied. */
function resultats(nom, e, attendus, { compteur = true } = {}) {
  verifier(memes(e.messages, attendus), `${nom} : ${attendus.length ? attendus.join(", ") : "aucun résultat"} (vu : ${e.messages.join(", ") || "aucun"})`);
  if (compteur && attendus.length) {
    const texte = `${attendus.length} résultat${attendus.length > 1 ? "s" : ""}`;
    verifier(e.compteur === texte, `${nom} : le pied annonce « ${e.compteur} » (attendu « ${texte} »)`);
  }
}

const sansAccents = (t) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Les messages sur le disque : ceux du départ, intacts, moins ceux des conversations vidées ; aucun nouveau. */
function controlerMessages(quand) {
  const disque = surDisque();
  const attendus = depart.messages.filter((m) => !vides.has(m.chatId));
  const parId = new Map(disque.messages.map((m) => [m.id, m]));
  const changes = attendus.filter((m) => !parId.has(m.id) || q(parId.get(m.id).parts) !== q(m.parts) || q(parId.get(m.id).author) !== q(m.author)).map((m) => m.id);
  const nouveaux = disque.messages.filter((m) => !depart.messages.some((d) => d.id === m.id)).map((m) => m.id);
  const restes = disque.messages.filter((m) => vides.has(m.chatId)).map((m) => m.id);
  verifier(
    !changes.length && !nouveaux.length && !restes.length && disque.messages.length === attendus.length,
    `${quand} : ${disque.messages.length} messages sur le disque pour ${attendus.length} attendus, aucun envoyé ni modifié` +
      `${changes.length ? ` (changés ou perdus : ${changes.slice(0, 5).join(", ")})` : ""}${nouveaux.length ? ` (nouveaux : ${nouveaux.join(", ")})` : ""}${restes.length ? ` (pas effacés : ${restes.join(", ")})` : ""}`,
  );
}

/** Les fichiers dont le nom parle de recherche, dans les données de l'app ou le dossier personnel : il ne doit y en avoir aucun. */
function fichiersDeRecherche(dossier) {
  const trouves = [];
  const parcourir = (d) => {
    for (const f of existsSync(d) ? readdirSync(d, { withFileTypes: true }) : []) {
      const chemin = path.join(d, f.name);
      if (/recherche/i.test(f.name)) trouves.push(path.relative(TMP, chemin));
      if (f.isDirectory()) parcourir(chemin);
    }
  };
  parcourir(dossier);
  return trouves;
}

/** Une étape : un échec (ou une fenêtre absente) la termine sans arrêter les suivantes. */
async function etape(nom, corps) {
  console.log(`\n— ${nom}`);
  try {
    await corps();
  } catch (err) {
    verifier(false, `${nom} : ${err instanceof Error ? err.message : err}`);
  } finally {
    try {
      if (await page(`return !!document.querySelector(FENETRE);`)) {
        await app.touche("Escape");
        await app.quand(`!document.querySelector(${q(FENETRE)})`, 1500);
      }
    } catch {
      /* l'app ne répond plus : l'étape suivante le dira */
    }
  }
}

/* ─── Le parcours ───────────────────────────────────────────────── */

try {
  app = await lancer();

  await etape("Préparation : profil d’essai, conversations, agent Hugo, brouillon", async () => {
    verifier((await app.ev("typeof window.klyra")) === "object", "l’app de bureau démarre sur le profil d’essai");
    await app.aller("/");
    verifier(!(await app.ev(`!!document.querySelector('[aria-modal="true"]')`)), "aucune fenêtre modale ouverte au démarrage (Ctrl+K serait ignoré)");

    await app.aller(`/chat?id=${REFONTE}`);
    await app.quand(`document.querySelectorAll("[data-message]").length > 0`, 10000);
    const refonte = await page(`
      const long = document.querySelector('[data-message="r-long"]');
      return {
        n: document.querySelectorAll("[data-message]").length,
        section: !!document.querySelector(${q(`section[aria-label="${TITRE_REFONTE}"]`)}),
        long: long ? Math.round(long.getBoundingClientRect().height) : 0,
        zone: zoneDe(long)?.clientHeight ?? 0,
        interrompu: esp(document.querySelector('[data-message="r-en-cours"]')?.innerText).includes("Interrompu"),
      };
    `);
    verifier(refonte.section && refonte.n === messagesRefonte.length, `conversation de projet affichée : ${refonte.n}/${messagesRefonte.length} messages [data-message]`);
    verifier(refonte.long > 2 * refonte.zone && refonte.zone > 0, `le message long fait plus de deux écrans (${refonte.long} px pour un fil de ${refonte.zone} px)`);
    enCoursInterrompu = refonte.interrompu;
    console.log(`NOTE   r-en-cours (statut « en-cours » dans le fichier) : ${refonte.interrompu ? "l’app le lit comme interrompu (statut « erreur ») au chargement" : "affiché tel quel"}.`);

    await app.aller(`/chat?id=${JOURNAL}`);
    await app.quand(`document.querySelectorAll("[data-message]").length >= 300`, 10000);
    const n = await app.ev(`document.querySelectorAll("[data-message]").length`);
    verifier(n === 300, `conversation de 300 messages affichée (${n})`);

    await app.aller(`/chat?id=${HUGO}`);
    await app.quand(`!!document.querySelector(${q(COMPOSEUR)})`, 5000);
    const hugo = await page(`return { hugo: esp(document.querySelector('[data-message="h-2"]')?.innerText).includes("Hugo"), composeur: !!document.querySelector(${q(COMPOSEUR)}) };`);
    verifier(hugo.hugo, "l’agent Hugo (fiche fictive « dev ») existe : sa réponse porte son prénom");
    verifier(hugo.composeur, `le composeur ${COMPOSEUR} est là`);

    /* Le brouillon, tapé dans le composeur ; curseur avant « vendredi ». */
    await page(`document.querySelector(${q(COMPOSEUR)}).focus(); return true;`);
    await app.send("Input.insertText", { text: BROUILLON });
    await attendre(300);
    await page(`const c = document.querySelector(${q(COMPOSEUR)}); c.setSelectionRange(${CURSEUR}, ${CURSEUR}); return true;`);
    await attendre(500);
    const c = await composeur();
    verifier(c.valeur === BROUILLON && memes(c.brouillons, BROUILLONS_ATTENDUS), `brouillon chez Hugo, gardé dans localStorage["klyra-brouillons"] (${q(c.brouillons)})`);
  });

  await etape("Geste 6 · États vides, bouton du rail, fermeture", async () => {
    await app.aller("/");
    let e = await etat();
    verifier(e.rail?.haspopup === "dialog" && e.rail?.expanded === "false", `bouton « Rechercher » du rail : aria-haspopup="dialog", aria-expanded="false" (${q(e.rail)})`);
    await ouvrir("rail");
    e = await etat();
    verifier(e.modale === "true" && e.rail?.expanded === "true", "un clic sur Rechercher ouvre la fenêtre modale ; aria-expanded passe à true");
    verifier(e.surChamp && e.invite === "Rechercher dans les conversations…", `le focus est dans le champ, invite « ${e.invite} »`);
    verifier(e.valeur === "" && contient(e.texte, AIDE) && !e.compteur && e.lignes.length === 0, "requête vide : l’aide s’affiche, sans compteur ni ligne");
    verifier(e.puces.length > 0 && e.puces.every((p) => p.nombre === null) && puceCochee(e) === "Tout", `puces sans nombre tant qu’on n’a pas cherché, Tout choisie (${q(e.puces)})`);
    e = await chercher("z");
    verifier(contient(e.texte, "Tape au moins 2 caractères.") && e.lignes.length === 0, "1 caractère : « Tape au moins 2 caractères. »");
    e = await chercher("qwxyzzy");
    verifier(contient(e.texte, "Aucun message ne correspond à « qwxyzzy ».") && e.lignes.length === 0, "mot absent : « Aucun message ne correspond à « qwxyzzy ». »");
    verifier(!contient(e.texte, "Chercher partout"), "portée Tout : pas de bouton « Chercher partout »");
    e = await chercher("decision");
    verifier(e.compteur === "1 résultat", `le compteur (role="status") annonce « ${e.compteur} »`);
    e = await chercher("glycine");
    verifier(e.compteur === "3 résultats" && e.puces.every((p) => typeof p.nombre === "number"), `puis « ${e.compteur} », avec un nombre sur chaque puce`);

    await app.cliquer('button[aria-label="Fermer la recherche"]');
    e = await etat();
    verifier(!e.ouverte && e.rail?.expanded === "false" && e.focus === "Rechercher", `le × ferme la fenêtre et rend le focus au bouton du rail (focus : ${e.focus})`);

    const point = await pointNeutre();
    const avant = (await etat()).page;
    await ouvrir();
    await app.cliquerEn(point.x, point.y);
    e = await etat();
    verifier(!e.ouverte && e.page === avant, "un clic sur le voile ferme la fenêtre, sans rien ouvrir derrière");

    await ouvrir();
    await app.raccourci();
    verifier(!(await etat()).ouverte, "Ctrl+K dans la fenêtre la ferme");
  });

  await etape("Geste 1 · Aller-retour sans perte (brouillon chez Hugo)", async () => {
    await app.aller(`/chat?id=${HUGO}`);
    await page(`const c = document.querySelector(${q(COMPOSEUR)}); c.focus(); c.setSelectionRange(${CURSEUR}, ${CURSEUR}); return true;`);
    await ouvrir();
    let e = await chercher("glycine");
    resultats("« glycine » depuis Hugo", e, ["h-2", "h-1", "r-glycine"]);

    /* Échap : rien ne change, le focus revient au composeur, curseur compris. */
    await app.touche("Escape");
    let c = await composeur();
    verifier(
      !(await etat()).ouverte && c.focus && c.debut === CURSEUR && c.fin === CURSEUR && c.valeur === BROUILLON && c.page === `/chat?id=${HUGO}`,
      `Échap ferme sans rien changer : focus au composeur, curseur à ${c.debut} (attendu ${CURSEUR}), brouillon et adresse intacts`,
    );

    await ouvrir();
    e = await etat();
    verifier(e.valeur === "glycine", `Ctrl+K depuis le composeur rouvre la même requête (« ${e.valeur} »)`);
    for (let i = 0; i < 5 && (await etat()).active?.message !== "r-glycine"; i++) await app.touche("ArrowDown");
    e = await etat();
    verifier(e.active?.message === "r-glycine" && e.descendant === e.active?.id && e.surChamp, "↓ rend active la ligne du projet (aria-activedescendant), le focus reste dans le champ");
    const liste = e.messages;
    await arriver("Geste 1", { chat: REFONTE, message: "r-glycine", attendus: ["Glycine"], duree: true });
    verifier(await app.ev(`!!document.querySelector(${q(`section[aria-label="${TITRE_REFONTE}"]`)})`), "la bonne conversation est affichée");

    await ouvrir();
    e = await etat();
    verifier(e.valeur === "glycine" && memes(e.messages, liste), `Ctrl+K : même requête, même liste (${e.messages.join(", ")})`);
    verifier(e.active?.message === "r-glycine" && e.descendant === e.active?.id, `la ligne ouverte est la ligne active (${e.active?.message ?? "aucune"})`);
    verifier(memes(e.selection, [0, "glycine".length]), `la requête est présélectionnée, prête à être retapée (sélection ${q(e.selection)})`);
    await app.touche("Escape");
    e = await etat();
    verifier(!e.ouverte && e.page === `/chat?id=${REFONTE}`, `Échap ferme seulement la fenêtre : on reste dans la conversation du projet (${e.page})`);

    /* Retour chez Hugo : une navigation explicite, jamais un effet d'Échap. */
    await app.aller(`/chat?id=${HUGO}`);
    c = await composeur();
    verifier(c.valeur === BROUILLON && memes(c.brouillons, BROUILLONS_ATTENDUS), "retour chez Hugo : le brouillon est intact");
  });

  await etape("Geste 2 · Une même règle pour la liste et l’arrivée", async () => {
    await app.aller("/");
    for (const [requete, message, mot] of [
      ["decision", "r-decision", "décision"],
      ["l'aperçu", "r-decision", "l’aperçu"],
      ['"version 2"', "r-decision", "version 2"],
    ]) {
      await ouvrir();
      const e = await chercher(requete);
      resultats(`« ${requete} »`, e, [message]);
      const ligne = e.lignes.find((l) => l.message === message);
      verifier(!!ligne?.marques.includes(mot), `« ${requete} » : la liste surligne « ${mot} » (${q(ligne?.marques)})`);
      const m = await arriver(`« ${requete} »`, { chat: REFONTE, message, attendus: [mot] });
      verifier(!!ligne && ligne.marques.length > 0 && ligne.marques.every((t) => m.textes.includes(t)), `« ${requete} » : mêmes mots surlignés dans la liste et dans le message (${q(ligne?.marques)} / ${q(m.textes)})`);
    }
    await ouvrir();
    const e = await chercher("version 2");
    resultats("« version 2 » sans guillemets (les deux mots, dans n’importe quel ordre)", e, ["r-logo", "r-decision"]);
  });

  await etape("Geste 3 · Un mot qui n’est que dans l’adresse d’un lien", async () => {
    await app.aller(`/chat?id=${JOURNAL}`);
    await ouvrir();
    const e = await chercher("zq7recherche");
    resultats("« zq7recherche »", e, ["r-lien"]);
    const ligne = e.lignes.find((l) => l.message === "r-lien");
    verifier(
      !!ligne && ligne.texte.includes("https://figma.example/file/zq7Recherche") && ligne.marques.includes("zq7Recherche"),
      `l’extrait montre l’adresse, le morceau cherché surligné (« ${ligne?.texte} »)`,
    );
    verifier(!ligne?.texte.includes("]("), `l’extrait n’affiche pas la syntaxe Markdown du lien (§5 : on garde le libellé, et l’adresse quand c’est elle qui correspond)`);
    await arriver("Lien, au clic", { chat: REFONTE, message: "r-lien", attendus: ["la maquette"], geste: "clic" });
  });

  await etape("Geste 4 · Un terme à la fin d’un message de plus de deux écrans", async () => {
    await app.aller(`/chat?id=${HUGO}`);
    await ouvrir();
    const e = await chercher("orchidee-finale");
    resultats("« orchidee-finale »", e, ["r-long"]);
    const ligne = e.lignes.find((l) => l.message === "r-long");
    verifier(!!ligne?.marques.includes("Orchidée-finale") && !ligne.texte.includes("Paragraphe 1 :"), `l’extrait montre la fin du message, pas son début (« ${ligne?.texte} »)`);
    const m = await arriver("Message long", { chat: REFONTE, message: "r-long", attendus: ["Orchidée-finale"] });
    verifier(m.hautBloc !== null && m.hautBloc < 0, `l’arrivée centre l’occurrence, pas le haut du message (haut du bloc à ${m.hautBloc} px du haut du fil)`);
    await app.aller(`/chat?id=${HUGO}`);
    verifier((await composeur()).valeur === BROUILLON, "retour chez Hugo (navigation explicite) : le brouillon n’a pas bougé");
  });

  await etape("Geste 5 · Portée", async () => {
    await app.aller("/");
    await ouvrir();
    let e = await chercher("glycine");
    verifier(memes(e.puces.map((p) => p.nom), ["Tout", "Agents", "Projets"]), `hors d’une conversation : pas de « Cette conversation » (${e.puces.map((p) => p.nom).join(", ")})`);
    await app.touche("Escape");

    await app.aller(`/chat?id=${HUGO}`);
    await ouvrir();
    e = await chercher("glycine");
    verifier(memes(e.puces.map((p) => p.nom), ["Tout", "Agents", "Projets", "Cette conversation"]) && puceCochee(e) === "Tout", `depuis un chat : ${e.puces.map((p) => p.nom).join(", ")} ; Tout choisie`);
    verifier(memes(e.puces.map((p) => p.nombre), [3, 2, 1, 2]), `nombres des puces pour « glycine » : ${q(e.puces.map((p) => p.nombre))} (attendu [3,2,1,2])`);

    await puce("Projets");
    e = await etat();
    verifier(puceCochee(e) === "Projets" && memes(e.messages, ["r-glycine"]) && e.lignes.every((l) => l.chat?.startsWith("equipe-")), `« Projets » : aucune conversation directe (${e.lignes.map((l) => l.chat).join(", ")})`);
    await puce("Agents");
    e = await etat();
    verifier(puceCochee(e) === "Agents" && memes(e.messages, ["h-2", "h-1"]) && e.lignes.every((l) => !l.chat?.startsWith("equipe-")), `« Agents » : seulement les conversations directes et les fils (${e.lignes.map((l) => l.chat).join(", ")})`);
    await puce("Cette conversation");
    e = await etat();
    verifier(puceCochee(e) === "Cette conversation" && memes(e.messages, ["h-2", "h-1"]) && e.lignes.every((l) => l.chat === HUGO), `« Cette conversation » : seulement ${HUGO} (${e.lignes.map((l) => l.chat).join(", ")})`);

    await puce("Agents");
    e = await chercher("zq7recherche");
    verifier(
      e.lignes.length === 0 && contient(e.texte, "Aucun message ne correspond à « zq7recherche ».") && contient(e.texte, "Chercher partout"),
      "rien dans « Agents » : « Aucun message ne correspond… » et le bouton « Chercher partout »",
    );
    await boutonDeLaFenetre("Chercher partout");
    e = await etat();
    verifier(puceCochee(e) === "Tout" && memes(e.messages, ["r-lien"]), `« Chercher partout » passe à Tout (${puceCochee(e)}, ${e.messages.join(", ") || "aucun"})`);

    /* « Cette conversation » en mémoire, puis on quitte le chat : retour à Tout. */
    await puce("Cette conversation");
    await app.touche("Escape");
    await app.aller("/");
    await ouvrir();
    e = await etat();
    verifier(puceCochee(e) === "Tout" && !e.puces.some((p) => p.nom === "Cette conversation"), `hors d’un chat, la portée « Cette conversation » en mémoire revient à Tout (${puceCochee(e)})`);
  });

  await etape("Frappe rapide (10 ms entre deux touches)", async () => {
    await app.aller("/");
    await ouvrir();
    await chercher("", { delai: 300 });
    await page(`
      const d = document.querySelector(FENETRE);
      window.__compteurs = [];
      const lire = () => {
        const t = [...d.querySelectorAll('[role="status"]')].map((s) => esp(s.innerText)).join(" | ");
        if (window.__compteurs[window.__compteurs.length - 1] !== t) window.__compteurs.push(t);
      };
      lire();
      window.__observateur?.disconnect();
      window.__observateur = new MutationObserver(lire);
      window.__observateur.observe(d, { subtree: true, childList: true, characterData: true });
      return true;
    `);
    await app.taper("palette", 10);
    await attendre(500);
    const e = await etat();
    const vus = await page(`window.__observateur?.disconnect(); return window.__compteurs ?? [];`);
    resultats("« palette » tapé vite", e, ["h-2", "h-1", "r-glycine", "r-long"]);
    verifier(e.lignes.length > 0 && e.lignes.every((l) => l.marques.length > 0 && l.marques.every((m) => sansAccents(m) === "palette")), "chaque ligne surligne « palette » : rien d’une requête intermédiaire (« pa », « pal »…)");
    verifier(vus.filter((v) => /résultat/.test(v)).every((v) => v.includes(e.compteur)), `le compteur n’annonce que la requête finale (vu : ${vus.filter(Boolean).join(" ‖ ") || "rien"})`);
  });

  await etape("Requête qui ressemble à du HTML ou à une expression régulière", async () => {
    const erreurs = app.erreurs.length;
    await ouvrir();
    let e = await chercher("<b>");
    resultats("« <b> »", e, ["r-balise"]);
    let ligne = e.lignes.find((l) => l.message === "r-balise");
    verifier(!!ligne?.marques.includes("<b>") && ligne.texte.includes("la balise <b> suffit"), `« <b> » : surligné tel quel, en texte (« ${ligne?.texte} »)`);
    e = await chercher(".*");
    verifier(e.messages.every((m) => m === "r-balise"), `« .* » n’est pas une expression régulière : il ne trouve pas tout (vu : ${e.messages.join(", ") || "aucun"})`);
    /* Le message l'écrit en code (`.*`), affiché tel quel dans le fil : il doit se retrouver. */
    resultats("« .* », écrit en code dans le message", e, ["r-balise"]);
    ligne = e.lignes.find((l) => l.message === "r-balise");
    verifier(!!ligne?.marques.includes(".*"), `« .* » : surligné tel quel (${q(ligne?.marques)})`);
    verifier(e.ouverte && app.erreurs.length === erreurs, `aucune erreur, la fenêtre reste ouverte${app.erreurs.length > erreurs ? ` (${app.erreurs.slice(erreurs).join(" | ")})` : ""}`);
  });

  await etape("Pièce jointe et réponse en cours", async () => {
    await ouvrir();
    /* Le nom d'une pièce jointe n'est pas cherché ; le texte du même message, si. */
    let e = await chercher("devis-v2");
    verifier(e.lignes.length === 0 && contient(e.texte, "Aucun message ne correspond à « devis-v2 »."), `« devis-v2 » (nom de la pièce jointe seulement) : aucun résultat (vu : ${e.messages.join(", ") || "aucun"})`);
    e = await chercher("devis mis");
    resultats("« devis mis » (texte du message qui porte la pièce jointe)", e, ["r-devis"]);
    /*
     * r-en-cours est écrit « en-cours » dans le fichier, mais l'app le relit comme une réponse
     * interrompue (statut « erreur », workspace.tsx, au chargement) : sans agent, une réponse en
     * cours d'écriture ne peut pas être reproduite. On vérifie donc la règle qui s'applique à ce
     * que l'app affiche : interrompue, elle se cherche comme une autre ; encore en cours, non.
     */
    e = await chercher("kaleidovent");
    if (enCoursInterrompu) {
      console.log("NOTE   r-en-cours est relu comme interrompu au chargement : le cas « réponse en cours » n’est pas jouable sans agent.");
      resultats("réponse interrompue (r-en-cours, « en-cours » dans le fichier) : cherchable comme une autre", e, ["r-en-cours"], { compteur: false });
    } else {
      verifier(e.lignes.length === 0 && contient(e.texte, "Aucun message ne correspond à « kaleidovent »."), `réponse en cours (r-en-cours) : introuvable (vu : ${e.messages.join(", ") || "aucun"})`);
    }
  });

  await etape("Fils : supprimé introuvable, archivé trouvé et rouvert", async () => {
    await app.aller(`/chat?id=${HUGO}`);
    await ouvrir();
    let e = await chercher("zanzibarre");
    verifier(e.lignes.length === 0 && contient(e.texte, "Aucun message ne correspond à « zanzibarre »."), "fil supprimé : son message est introuvable");
    e = await chercher("tamarillo");
    resultats("fil archivé « tamarillo »", e, ["a-1"]);
    verifier(e.lignes.find((l) => l.message === "a-1")?.chat === FIL_ARCHIVE, `la ligne vient du fil archivé (${FIL_ARCHIVE})`);
    await arriver("Fil archivé", { chat: FIL_ARCHIVE, message: "a-1", attendus: ["Tamarillo"], centrage: "bord" });
    const onglets = await app.ev(`[...document.querySelectorAll('[role="tablist"][aria-label="Chat et fils"] [role="tab"]')].map((t) => t.innerText.trim())`);
    verifier(onglets.some((t) => t.includes("Audit des polices")), `le fil est rouvert : son onglet est là (${onglets.join(", ")})`);
    await attendre(1200);
    const chats = surDisque().chats;
    verifier(chats.find((c) => c.id === FIL_ARCHIVE)?.fil?.statut === "ouvert", "le fil rouvert est enregistré (statut « ouvert »)");
    verifier(chats.find((c) => c.id === FIL_SUPPRIME)?.fil?.supprime === true, "le fil supprimé reste supprimé");
  });

  await etape("Le premier message d’une conversation de 300 messages", async () => {
    await app.aller(`/chat?id=${REFONTE}`);
    await ouvrir();
    let e = await chercher("releve");
    verifier(e.messages.length === 100 && e.compteur === "100 premiers résultats sur 300", `« releve » : ${e.messages.length} lignes, « ${e.compteur} » (attendu 100, « 100 premiers résultats sur 300 »)`);
    verifier(memes(e.messages.slice(0, 3), ["j299", "j298", "j297"]), `les plus récents d’abord (${e.messages.slice(0, 3).join(", ")})`);
    e = await chercher("ammonite");
    resultats("« ammonite »", e, ["j000"]);
    const m = await arriver("Premier message", { chat: JOURNAL, message: "j000", attendus: ["ammonite"], centrage: "bord" });
    verifier(m.max !== null && m.max - m.haut > m.hauteurZone, `le fil a quitté le bas pour remonter au premier message (position ${m.haut} sur ${m.max})`);
  });

  await etape("Geste 7 · Conversation vidée, message disparu", async () => {
    await app.aller("/");
    await app.aller(`/chat?id=${PRINCIPAL}`);
    const bouton = await app.quand(`[...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Nouvelle conversation")`, 3000);
    verifier(bouton, "le panneau de l’agent propose « Nouvelle conversation »");
    await ouvrir();
    let e = await chercher("mirabelle");
    resultats("« mirabelle »", e, ["p-2", "p-1", "r-accueil"]);
    verifier(e.active?.message === "p-2", "la première ligne est active");
    /* La fenêtre est modale : le bouton du panneau, derrière elle, est actionné par son propre click(). */
    await app.ev(`[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Nouvelle conversation")?.click()`);
    await attendre(300);
    const vide = await app.ev(`(() => { const b = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Effacer et repartir"); b?.click(); return !!b; })()`);
    if (vide) vides.add(PRINCIPAL);
    await attendre(600);
    e = await etat();
    verifier(vide && e.ouverte && memes(e.messages, ["r-accueil"]) && !e.lignes.some((l) => l.chat === PRINCIPAL), `« Nouvelle conversation » sur ${PRINCIPAL}, fenêtre ouverte : ses lignes disparaissent (reste : ${e.messages.join(", ") || "aucune"})`);
    verifier(e.active?.message === "r-accueil" && e.descendant === e.active?.id, `la ligne suivante devient active (${e.active?.message ?? "aucune"})`);
    await app.touche("Escape");

    /* Une adresse qui vise un message disparu : la conversation s'ouvre en bas, sans erreur ni éclairage. */
    const erreurs = app.erreurs.length;
    await app.aller("/");
    await espion(null);
    await app.aller(`/chat?id=${REFONTE}&message=p-1`);
    await attendre(1500);
    const r = await page(`
      const zone = zoneDe(document.querySelector("[data-message]"));
      return {
        section: !!document.querySelector(${q(`section[aria-label="${TITRE_REFONTE}"]`)}),
        n: document.querySelectorAll("[data-message]").length,
        enBas: !!zone && zone.scrollHeight - zone.scrollTop - zone.clientHeight < 80,
        eclaire: window.__espion?.eclaire ?? null,
      };
    `);
    verifier(r.section && r.n === messagesRefonte.length && !r.eclaire && app.erreurs.length === erreurs, `/chat?id=${REFONTE}&message=p-1 (disparu) : la conversation s’ouvre, sans éclairage ni erreur`);
    verifier(r.enBas, "elle s’ouvre en bas, comme d’habitude");
  });

  await etape("Mouvement réduit", async () => {
    await app.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    try {
      verifier(await app.ev(`matchMedia("(prefers-reduced-motion: reduce)").matches`), "mouvement réduit émulé (CDP Emulation.setEmulatedMedia)");
      await app.aller(`/chat?id=${JOURNAL}`);
      await ouvrir();
      const e = await chercher("orchidee-finale");
      resultats("« orchidee-finale »", e, ["r-long"], { compteur: false });
      await arriver("Mouvement réduit", { chat: REFONTE, message: "r-long", attendus: ["Orchidée-finale"], duree: true, reduit: true });
    } finally {
      await app.send("Emulation.setEmulatedMedia", { features: [] });
    }
  });

  await etape("Geste 8 · Fenêtre 1100 × 700, clavier seul", async () => {
    const mode = await app.redimensionner(1100, 700);
    try {
      await app.aller("/");
      await app.aller(`/chat?id=${JOURNAL}`);
      const taille = await app.ev(`({ l: innerWidth, h: innerHeight })`);
      verifier(taille.l <= 1100 && taille.h <= 700, `fenêtre à ${taille.l} × ${taille.h} (${mode})`);
      await page(`document.querySelector(${q(COMPOSEUR)}).focus(); return true;`);
      await ouvrir();
      let e = await chercher("releve");
      verifier(!!e.carte && Math.abs(e.carte.l - 640) <= 1 && e.carte.bas <= taille.h, `la carte garde 640 px et tient dans la fenêtre (${q(e.carte)})`);
      verifier(e.defile && e.messages.length === 100, `la liste défile (${e.messages.length} lignes)`);

      const perdues = [];
      for (let i = 0; i < 20; i++) {
        await app.touche("ArrowDown", { apres: 80 });
        const s = await etat();
        if (!s.active?.visible || s.descendant !== s.active?.id || !s.surChamp) perdues.push(`↓${i + 1}`);
      }
      e = await etat();
      verifier(!perdues.length && e.active?.message === e.messages[20], `↓ ×20 : la ligne active reste visible, focus dans le champ (active : ${e.active?.message}${perdues.length ? ` ; perdue à ${perdues.join(", ")}` : ""})`);
      for (let i = 0; i < 25; i++) {
        await app.touche("ArrowUp", { apres: 80 });
        const s = await etat();
        if (!s.active?.visible || s.descendant !== s.active?.id) perdues.push(`↑${i + 1}`);
      }
      e = await etat();
      verifier(!perdues.length && e.active?.message === e.messages[0], `↑ ×25 : visible à chaque pas, et s’arrête sur la première ligne sans boucler (active : ${e.active?.message})`);

      const parcours = [];
      for (let i = 0; i < 12; i++) {
        await app.touche("Tab", { apres: 80 });
        const s = await etat();
        parcours.push(s.dansFenetre ? (s.surChamp ? "champ" : s.focus) : `HORS(${s.focus})`);
      }
      verifier(parcours.every((p) => !p.startsWith("HORS")) && parcours.includes("champ"), `Tab tourne dans la fenêtre (${parcours.join(" → ")})`);
      await app.touche("Tab", { modifiers: MAJ });
      verifier((await etat()).dansFenetre, "Maj+Tab reste dans la fenêtre");

      await app.touche("Escape");
      const c = await composeur();
      verifier(!(await etat()).ouverte && c.focus, "Échap rend le focus au composeur");
    } finally {
      await app.retablirTaille();
    }
  });

  await etape("Fin de la première session : rien d’envoyé, brouillon intact", async () => {
    await attendre(1200);
    const c = await composeur();
    verifier(memes(c.brouillons, BROUILLONS_ATTENDUS), `localStorage["klyra-brouillons"] : seul le brouillon de Hugo, intact (${q(c.brouillons)})`);
    controlerMessages("fin de session");
    verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` (${app.erreurs.join(" | ")})` : ""}`);
  });
  await app.fermer();

  /* ─── Après un redémarrage ─────────────────────────────────────── */
  app = await lancer();

  await etape("Après redémarrage : la requête est oubliée, la recherche marche sur les données gardées", async () => {
    await app.aller(`/chat?id=${HUGO}`);
    await app.quand(`!!document.querySelector(${q(COMPOSEUR)})`, 5000);
    let c = await composeur();
    verifier(c.valeur === BROUILLON, "le brouillon de Hugo est toujours là");
    await page(`const c = document.querySelector(${q(COMPOSEUR)}); c.__temoin = 1; c.focus(); c.setSelectionRange(${CURSEUR}, ${CURSEUR}); return true;`);
    await ouvrir();
    let e = await etat();
    verifier(e.valeur === "" && contient(e.texte, AIDE) && puceCochee(e) === "Tout", `la requête mémorisée est oubliée (champ « ${e.valeur} », portée ${puceCochee(e)})`);
    e = await chercher("glycine");
    resultats("après redémarrage, « glycine »", e, ["h-2", "h-1", "r-glycine"]);
    await arriver("Après redémarrage, même conversation", { chat: HUGO, message: "h-2", attendus: ["Glycine"], centrage: "bord" });
    c = await composeur();
    verifier(c.valeur === BROUILLON && c.temoin === 1, "même conversation : le composeur n’est pas remonté, le brouillon reste");
    await ouvrir();
    e = await chercher("tamarillo");
    resultats("après redémarrage, le fil rouvert « tamarillo »", e, ["a-1"]);
    await app.touche("Escape");
    const index = [...fichiersDeRecherche(DONNEES), ...fichiersDeRecherche(MAISON)];
    verifier(index.length === 0, `aucun index de recherche écrit sur le disque${index.length ? ` (${index.join(", ")})` : ""}`);
    await attendre(1200);
    c = await composeur();
    verifier(memes(c.brouillons, BROUILLONS_ATTENDUS), "brouillons inchangés après redémarrage");
    controlerMessages("après redémarrage");
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
