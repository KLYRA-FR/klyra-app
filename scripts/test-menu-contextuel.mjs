/**
 * Le clic droit dans l'export Electron : agents de la barre (épingler, sourdine, masquer,
 * désactiver, aller à, clavier, bord de l'écran), conversations d'équipe (renommer, supprimer, rythme des lignes), messages
 * (citer) et tickets. Profil, HOME et `~/.claude/agents` jetables ; Claude inaccessible.
 * Prérequis : pnpm build && pnpm build:electron.
 *   xvfb-run -a node scripts/test-menu-contextuel.mjs   (en root : -- --no-sandbox)
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
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-menu-"));
const DONNEES = path.join(TMP, "userdata"), MAISON = path.join(TMP, "home"), AGENTS = path.join(MAISON, ".claude", "agents");
const PORT = 9351;
const q = JSON.stringify;
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lire = (fichier) => JSON.parse(readFileSync(path.join(DONNEES, fichier), "utf8"));
const echecs = [];
let controles = 0, app;
function verifier(ok, message) {
  controles++;
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
}

const maintenant = Date.now();
const date = (minutes) => new Date(maintenant - minutes * 60000).toISOString();
const fiche = (id, nom, role) => `---\nname: ${id}\ndisplayName: ${nom}\ndescription: "${role} — fiche fictive. Appelle ${nom} pour ${role.toLowerCase()}."\n---\n\n# ${nom} — ${role}\n\nFiche fictive du test.\n`;
for (const dossier of [DONNEES, AGENTS]) mkdirSync(dossier, { recursive: true });
writeFileSync(path.join(AGENTS, "hugo.md"), fiche("hugo", "Hugo", "Dev"));
writeFileSync(path.join(AGENTS, "iris.md"), fiche("iris", "Iris", "Design"));
const entree = { actif: true, ajouteLe: maintenant, origine: { type: "local" }, empreinte: null };
writeFileSync(path.join(DONNEES, "mes-agents.json"), q({ version: 1, depart: "reprise", assistant: { nom: "Principal", teinte: null }, agents: { hugo: entree, iris: entree } }));
writeFileSync(path.join(DONNEES, "conversations.json"), q({
  version: 1,
  chats: [
    { id: "equipe-A", kind: "equipe", projectId: "durand", title: "Refonte du site", roleIds: ["principal", "hugo"], updatedAt: date(10), sessions: {}, luJusqua: "m-A" },
    { id: "equipe-B", kind: "equipe", projectId: null, title: "Lancement", roleIds: ["principal", "iris"], updatedAt: date(30), sessions: {}, luJusqua: null },
    { id: "dm-hugo", kind: "direct", projectId: null, title: "Hugo", roleIds: ["hugo"], updatedAt: date(5), sessions: {}, luJusqua: "m-hugo" },
    { id: "fil-hugo", kind: "direct", projectId: null, title: "Corriger le menu", roleIds: ["hugo"], updatedAt: date(20), sessions: {}, luJusqua: null, fil: { roleId: "hugo", statut: "ouvert", creeLe: date(20), lancePar: null, retourAttendu: false } },
  ],
  messages: [
    { id: "m-A", chatId: "equipe-A", author: { kind: "role", roleId: "principal" }, createdAt: date(10), statut: "fait", parts: [{ type: "text", text: "Témoin de l’équipe." }] },
    { id: "m-hugo", chatId: "dm-hugo", author: { kind: "role", roleId: "hugo" }, createdAt: date(5), statut: "fait", parts: [{ type: "text", text: "Le menu est prêt à relire." }] },
  ],
  projects: [{ id: "durand", name: "Atelier Durand", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "Projet fictif", previewUrl: "", folder: path.join(TMP, "durand"), files: [], updatedAt: date(60) }],
  routines: [], taches: [], evenements: [], categories: [], artefacts: [], workflows: [], executions: [],
}));
mkdirSync(path.join(TMP, "durand"), { recursive: true });
const env = { ...process.env, HOME: MAISON, KLYRA_USER_DATA: DONNEES, PATH: "/usr/bin:/bin", TZ: "Europe/Paris", DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(TMP, "aucun-bus")}` };
for (const key of ["ELECTRON_RUN_AS_NODE", "KLYRA_DEV_URL", "KLYRA_SMOKE_TEST", "KLYRA_CLAUDE_PATH", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete env[key];

const NAV = 'nav[aria-label="Agents et conversations"]';
const ligne = (id) => `${NAV} a[href="/chat?id=${id}"]`;
const menu = (libelle) => `[data-menu-contextuel][aria-label=${q(libelle)}]`;
const element = (libelle, texte) => `(() => [...document.querySelectorAll(${q(`${menu(libelle)} [role^="menuitem"]`)})].find(e => e.textContent.trim().startsWith(${q(texte)})))()`;

async function attendreQue(fn, delai = 5000) {
  for (let i = 0; i < delai / 30; i++) { if (await fn().catch(() => false)) return true; await attendre(30); }
  return false;
}

async function lancer() {
  const processus = spawn(ELECTRON, [".", `--remote-debugging-port=${PORT}`, ...process.argv.slice(2)], { cwd: APP, env, stdio: "ignore" });
  let cible;
  for (let i = 0; i < 80 && !cible; i++) {
    await attendre(250);
    cible = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((xs) => xs.find((x) => x.type === "page" && x.url.startsWith("app://"))).catch(() => null);
  }
  if (!cible) { processus.kill(); throw new Error("Fenêtre Electron absente"); }
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let numero = 0;
  const enAttente = new Map(), erreurs = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === "Runtime.exceptionThrown") erreurs.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.id) { enAttente.get(m.id)?.(m); enAttente.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++numero, timer = setTimeout(() => { enAttente.delete(n); reject(new Error(`CDP sans réponse : ${method}`)); }, 15000);
    enAttente.set(n, (m) => { clearTimeout(timer); if (m.error) reject(new Error(q(m.error))); else resolve(m.result); });
    ws.send(q({ id: n, method, params }));
  });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const outils = {
    ev, send, erreurs,
    present: (sel) => ev(`!!document.querySelector(${q(sel)})`),
    async position(sel) {
      return ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) throw new Error('Élément absent : ' + ${q(sel)}); e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    },
    async clicEn(p, bouton = "left") {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, ...p, button: bouton, clickCount: 1 });
      await attendre(120);
    },
    async clic(sel) { await outils.clicEn(await outils.position(sel)); },
    async clicDroit(sel) { await outils.clicEn(await outils.position(sel), "right"); },
    /** Une ligne du menu, trouvée par le début de son texte. */
    async choisir(libelle, texte) {
      const p = await ev(`(() => { const e = ${element(libelle, texte)}; if (!e) throw new Error('Ligne absente : ' + ${q(texte)}); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await outils.clicEn(p);
    },
    async touche(key) {
      const codes = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, ArrowLeft: 37, End: 35 };
      const base = { key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key] };
      const text = key === "Enter" ? "\r" : undefined;
      await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text, unmodifiedText: text } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await attendre(120);
    },
    async aller(route) {
      await attendre(700);
      await send("Page.navigate", { url: `app://klyra${route}` });
      if (!(await attendreQue(() => ev(`!!document.querySelector('main') && !!document.querySelector(${q(NAV)})`), 10000))) throw new Error(`App non prête : ${route}`);
      await attendre(700);
    },
    async fermer() { ws.close(); processus.kill(); await attendreQue(async () => processus.exitCode !== null, 3000); },
  };
  await attendreQue(() => ev("!!window.klyra && !!document.querySelector('main')"), 15000);
  await attendre(800);
  return outils;
}

async function etape(nom, fn) {
  console.log(`\n${nom}`);
  try { await fn(); verifier(!app.erreurs.length, `${nom} : aucune exception renderer (${app.erreurs.join(" | ")})`); }
  catch (error) { verifier(false, `${nom} : ${error.stack ?? error}`); }
  app.erreurs.length = 0;
}
const ordreAgents = () => app.ev(`[...document.querySelectorAll(${q(`${NAV} a[href^="/chat?id=dm-"]`)})].map(a => a.getAttribute('href').replace('/chat?id=dm-', ''))`);
const meta = () => { try { return lire("agents-meta.json"); } catch { return {}; } };

try {
  app = await lancer();

  await etape("1 · Le menu d'un agent", async () => {
    await app.aller("/chats");
    verifier(JSON.stringify(await ordreAgents()) === q(["principal", "hugo", "iris"]), `départ : l'assistant puis l'ordre alphabétique (${await ordreAgents()})`);
    await app.clicDroit(ligne("dm-hugo"));
    verifier(await attendreQue(() => app.present(menu("Hugo"))), "clic droit sur Hugo : son menu s'ouvre");
    const textes = await app.ev(`[...document.querySelectorAll(${q(`${menu("Hugo")} [role^="menuitem"]`)})].map(e => e.textContent.trim())`);
    for (const attendu of ["Nouveau fil", "Épingler", "Sourdine", "Fiche", "Ouvrir la conversation", "Aller à", "Copier la mention @Hugo", "Masquer de la liste", "Désactiver…"]) {
      verifier(textes.some((t) => t.startsWith(attendu)), `ligne « ${attendu} »`);
    }
    const dedans = await app.ev(`(() => { const r = document.querySelector(${q(menu("Hugo"))}).getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`);
    verifier(dedans, "le menu tient dans la fenêtre");
    await app.touche("ArrowDown");
    verifier(await app.ev(`document.activeElement?.textContent.trim().startsWith('Nouveau fil')`), "↓ : la première action prend le focus");
    await app.touche("Escape");
    verifier(!(await app.present(menu("Hugo"))), "Échap ferme le menu");
    await app.clicDroit(ligne("dm-hugo"));
    await app.clicEn({ x: 900, y: 400 });
    verifier(!(await app.present(menu("Hugo"))), "un clic ailleurs ferme le menu");
  });

  await etape("2 · Au bord de la fenêtre, le menu se retourne", async () => {
    await app.ev(`(() => { const a = document.querySelector(${q(ligne("dm-iris"))}); a.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 4, clientY: innerHeight - 4 })); })()`);
    verifier(await attendreQue(() => app.present(menu("Iris"))), "menu d'Iris ouvert près du coin");
    await attendre(250);
    const r = await app.ev(`(() => { const r = document.querySelector(${q(menu("Iris"))}).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; })()`);
    verifier(r.r <= r.w && r.b <= r.h && r.l >= 0 && r.t >= 0, `retourné vers le haut et la gauche, dans la fenêtre (${q(r)})`);
    await app.touche("Escape");
  });

  await etape("3 · Épingler, sourdine", async () => {
    await app.clicDroit(ligne("dm-iris"));
    await app.choisir("Iris", "Épingler");
    verifier(await attendreQue(async () => !!meta().iris?.epingleLe), "épingler écrit la date dans agents-meta.json");
    verifier(await app.present(menu("Iris")), "une bascule laisse le menu ouvert");
    verifier(await attendreQue(async () => (await app.ev(`${element("Iris", "Désépingler")}?.getAttribute('aria-checked')`)) === "true"), "la case passe à « Désépingler », cochée");
    await app.touche("Escape");
    verifier(JSON.stringify(await ordreAgents()) === q(["principal", "iris", "hugo"]), `Iris épinglée juste après l'assistant (${await ordreAgents()})`);
    await app.clicDroit(ligne("dm-hugo"));
    await app.choisir("Hugo", "Sourdine");
    verifier(await attendreQue(async () => meta().hugo?.muet === true), "sourdine écrite pour Hugo");
    await app.choisir("Hugo", "En sourdine");
    verifier(await attendreQue(async () => meta().hugo?.muet === undefined), "rallumer efface la préférence");
    await app.touche("Escape");
  });

  await etape("4 · Masquer et afficher", async () => {
    await app.clicDroit(ligne("dm-hugo"));
    await app.choisir("Hugo", "Masquer de la liste");
    verifier(await attendreQue(async () => meta().hugo?.masque === true), "masqué dans agents-meta.json");
    verifier(await attendreQue(async () => !(await app.present(ligne("dm-hugo")))), "Hugo quitte la liste");
    verifier(lire("mes-agents.json").agents.hugo.actif === true, "il reste actif dans Mes agents");
    const bouton = `${NAV} button[aria-expanded]:not([aria-label])`;
    verifier(await app.ev(`[...document.querySelectorAll(${q(bouton)})].some(b => b.textContent.includes('1 agent masqué'))`), "« 1 agent masqué » sous la liste");
    await app.ev(`[...document.querySelectorAll(${q(bouton)})].find(b => b.textContent.includes('agent masqué')).click()`);
    verifier(await attendreQue(() => app.present(ligne("dm-hugo"))), "déplié : Hugo réapparaît, estompé");
    await app.clicDroit(ligne("dm-hugo"));
    await app.choisir("Hugo", "Afficher dans la liste");
    verifier(await attendreQue(async () => meta().hugo?.masque === undefined), "affiché de nouveau");
  });

  await etape("5 · Aller à, au clavier", async () => {
    await app.clicDroit(ligne("dm-hugo"));
    await app.ev(`${element("Hugo", "Aller à")}.focus()`);
    await app.touche("ArrowRight");
    verifier(await attendreQue(() => app.ev(`document.activeElement?.textContent.trim() === 'Ses tickets'`)), "→ ouvre le sous-menu sur « Ses tickets »");
    await app.touche("ArrowLeft");
    verifier(await app.ev(`document.activeElement?.textContent.trim().startsWith('Aller à')`), "← revient à « Aller à »");
    await app.touche("ArrowRight");
    await attendreQue(() => app.ev(`document.activeElement?.textContent.trim() === 'Ses tickets'`));
    await app.touche("Enter");
    verifier(await attendreQue(() => app.ev(`location.pathname === '/tickets' && location.search.includes('agent=hugo')`)), "Entrée : les tickets filtrés sur Hugo");
    verifier(await attendreQue(() => app.ev(`!!document.querySelector('[data-ticket="fil-hugo"]')`)), "son ticket est au tableau");
  });

  await etape("6 · Le menu d'un ticket", async () => {
    await app.clicDroit('[data-ticket="fil-hugo"]');
    verifier(await attendreQue(() => app.present(menu("Ticket Corriger le menu"))), "clic droit sur un ticket : son menu");
    await app.ev(`${element("Ticket Corriger le menu", "Priorité")}.focus()`);
    await app.touche("ArrowRight");
    await attendreQue(() => app.ev(`document.activeElement?.textContent.trim().startsWith('Aucune')`));
    await app.touche("End");
    await app.touche("Enter");
    verifier(await attendreQue(async () => lire("conversations.json").chats.find((c) => c.id === "fil-hugo")?.fil?.priorite === 3), "priorité haute enregistrée");
  });

  await etape("7 · Désactiver depuis le menu", async () => {
    await app.aller("/chats");
    await app.clicDroit(ligne("dm-iris"));
    await app.choisir("Iris", "Désactiver");
    verifier(await attendreQue(() => app.ev(`[...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')].some(d => d.textContent.includes('Désactiver Iris ?'))`)), "la même question que sur sa fiche");
    await app.ev(`[...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find(b => b.textContent.trim() === 'Désactiver').click()`);
    verifier(await attendreQue(async () => lire("mes-agents.json").agents.iris.actif === false), "Iris désactivée dans Mes agents");
    verifier(await attendreQue(async () => !(await app.present(ligne("dm-iris")))), "et retirée de la barre");
    verifier(existsSync(path.join(AGENTS, "iris.md")), "sa fiche reste sur le disque");
  });

  await etape("8 · Renommer une conversation d'équipe", async () => {
    await app.clicDroit(ligne("equipe-A"));
    verifier(await attendreQue(() => app.present(menu("Refonte du site"))), "menu de la conversation d'équipe");
    await app.choisir("Refonte du site", "Renommer");
    verifier(await attendreQue(() => app.ev(`document.activeElement?.tagName === 'INPUT'`)), "le champ prend le focus");
    await app.send("Input.insertText", { text: "Refonte v2" });
    await app.touche("Enter");
    verifier(await attendreQue(async () => lire("conversations.json").chats.find((c) => c.id === "equipe-A")?.title === "Refonte v2", 4000), "titre enregistré");
  });

  await etape("9 · Citer un message", async () => {
    await app.aller("/chat?id=dm-hugo");
    await app.clicDroit('[data-message="m-hugo"]');
    verifier(await attendreQue(() => app.present(menu("Message de Hugo"))), "clic droit sur une réponse : son menu");
    for (const attendu of ["Copier le message", "Citer dans ma réponse", "En faire un fil", "Créer une branche", "Réessayer"]) {
      verifier(!!(await app.ev(`!!${element("Message de Hugo", attendu)}`)), `ligne « ${attendu} »`);
    }
    await app.choisir("Message de Hugo", "Citer dans ma réponse");
    verifier(await attendreQue(() => app.ev(`[...document.querySelectorAll('textarea')].some(t => t.value.includes('> Le menu est prêt à relire.'))`)), "la citation attend dans le composeur");
    verifier(lire("conversations.json").messages.length === 2, "rien n'est envoyé");
  });

  await etape("10 · Supprimer une conversation d'équipe", async () => {
    const pas = await app.ev(`(() => { const [a, b] = [${q(ligne("equipe-A"))}, ${q(ligne("equipe-B"))}].map(s => document.querySelector(s).getBoundingClientRect()); return Math.round(Math.abs(b.top - a.top)); })()`);
    verifier(pas === 58, `lignes d'équipe au même rythme que les agents : 54 px + 4 px (${pas} px)`);
    await app.clicDroit(ligne("equipe-A"));
    verifier(await attendreQue(() => app.present(menu("Refonte v2"))), "menu de la conversation d'équipe");
    const lignes = await app.ev(`[...document.querySelectorAll(${q(`${menu("Refonte v2")} [role^="menuitem"]`)})].map(e => e.textContent.trim())`);
    verifier(lignes.at(-1) === "Supprimer…", `« Supprimer… » en dernier (${lignes.join(", ")})`);
    const bouton = (texte) => `(() => [...document.querySelectorAll('[role="alertdialog"] button')].find(b => b.textContent.trim() === ${q(texte)}))()`;
    const cliquerBouton = async (texte) => {
      const p = await app.ev(`(() => { const b = ${bouton(texte)}; if (!b) throw new Error('Bouton absent : ' + ${q(texte)}); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await app.clicEn(p);
    };
    await app.choisir("Refonte v2", "Supprimer");
    verifier(await attendreQue(() => app.ev(`document.querySelector('[role="alertdialog"]')?.textContent.includes('Supprimer « Refonte v2 » ?')`)), "une fenêtre demande confirmation");
    await cliquerBouton("Annuler");
    verifier(await attendreQue(async () => !(await app.present('[role="alertdialog"]'))), "Annuler ferme la fenêtre");
    verifier(await app.present(ligne("equipe-A")), "et la conversation reste");
    await app.clicDroit(ligne("equipe-A"));
    await app.choisir("Refonte v2", "Supprimer");
    await attendreQue(() => app.present('[role="alertdialog"]'));
    await cliquerBouton("Supprimer");
    verifier(await attendreQue(async () => !(await app.present(ligne("equipe-A")))), "la conversation quitte la barre");
    verifier(await attendreQue(async () => !lire("conversations.json").chats.some((c) => c.id === "equipe-A"), 4000), "supprimée du disque");
    verifier(!lire("conversations.json").messages.some((m) => m.chatId === "equipe-A"), "avec ses messages");
    verifier(await app.ev(`location.search === "?id=dm-hugo"`), "fermée, elle ne change pas l'écran ouvert");
    verifier(["equipe-B", "dm-hugo", "fil-hugo"].every((id) => lire("conversations.json").chats.some((c) => c.id === id)), "les autres conversations, directe et fil compris, restent");
  });

  await etape("11 · Pas de suppression dans le menu d'un agent", async () => {
    await app.clicDroit(ligne("dm-hugo"));
    verifier(await attendreQue(() => app.present(menu("Hugo"))), "menu de l'agent");
    verifier(!(await app.ev(`!!${element("Hugo", "Supprimer")}`)), "aucune ligne « Supprimer » : un agent se désactive");
    await app.touche("Escape");
  });
} catch (error) { verifier(false, error.stack ?? String(error)); }
finally { await app?.fermer(); rmSync(TMP, { recursive: true, force: true }); }
console.log(`\n${controles - echecs.length}/${controles} contrôles réussis${echecs.length ? ` ; ${echecs.length} échec(s)` : ""}.`);
process.exitCode = echecs.length ? 1 : 0;
