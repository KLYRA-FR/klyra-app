/**
 * Test de bout en bout des agents dans l'app de bureau, sur un dossier
 * personnel temporaire : les vrais `~/.claude/agents` ne sont jamais touchés.
 * Prérequis : `pnpm dev` tourne (port 3100) et `pnpm build:electron` est fait.
 *   pnpm test:agents
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-agents-"));
const AGENTS = path.join(TMP, "home/.claude/agents");
const PORT = 9336;
const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* Trois conversations fictives : les cartes doivent compter les données du
   profil Electron, avec zéro pour les autres agents. Aucun message à envoyer. */
const conversations = ["dev", "dev", "qa"].map((roleId, i) => ({
  id: `compteur-${i}`, kind: "equipe", projectId: null, title: `Conversation fictive ${i}`,
  roleIds: [roleId], updatedAt: "2026-10-30T10:00:00.000Z", sessions: {}, luJusqua: null,
}));
mkdirSync(path.join(TMP, "userdata"), { recursive: true });
writeFileSync(path.join(TMP, "userdata/conversations.json"), JSON.stringify({ version: 1, chats: conversations, messages: [], routines: [], taches: [], evenements: [] }));

const env = {
  ...process.env,
  HOME: path.join(TMP, "home"),
  KLYRA_USER_DATA: path.join(TMP, "userdata"),
  KLYRA_DEV_URL: process.env.KLYRA_DEV_URL ?? "http://localhost:3100",
};
delete env.ELECTRON_RUN_AS_NODE;
const electron = spawn(path.join(APP, "node_modules/.bin/electron"), [".", `--remote-debugging-port=${PORT}`], {
  cwd: APP,
  env,
  stdio: "ignore",
});

try {
  await attendre(7000);
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const attente = {};
  const erreurs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") erreurs.push(m.params.exceptionDetails.exception?.description);
    attente[m.id]?.(m.result);
  };
  const send = (method, params = {}) => new Promise((r) => { attente[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  await send("Runtime.enable");
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
  const aller = async (p) => { await ev(`window.next.router.push(${JSON.stringify(p)})`); await attendre(2500); };
  const cliquer = (t) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(t)}); if (!b) return false; b.click(); return true; })()`);
  const saisir = (sel, i, v) => ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const titre = () => ev("document.querySelector('main h1')?.innerText.replace(/\\n/g, ' / ')");

  verifier((await ev("typeof window.klyra")) === "object", "le pont avec le système est exposé");

  await aller("/equipe");
  verifier((await titre())?.startsWith("Aucun agent"), "poste vierge : l’écran propose d’installer l’équipe");
  await cliquer("Installer l’équipe KLYRA");
  await attendre(2500);
  verifier(existsSync(AGENTS) && readdirSync(AGENTS).length === 11, "installation : 11 fiches écrites");
  verifier((await titre()) === "L’équipe" && (await ev("document.querySelectorAll('main a[href^=\"/equipe?agent=\"] h2').length")) === 11, "installation : la page liste les 11 agents");
  const modele = readFileSync(path.join(APP, "agents-equipe/dev.md"), "utf8");
  verifier(readFileSync(path.join(AGENTS, "dev.md"), "utf8") === modele, "installation : fiche identique au modèle");

  const cartes = await ev(`Array.from(document.querySelectorAll('main a[href^="/equipe?agent="]')).filter(a => a.querySelector('h2')).map(a => ({ id: new URL(a.href).searchParams.get('agent'), texte: a.innerText.replace(/\\s+/g, ' ').trim(), barre: !!a.querySelector('.klyra-barre-progres') }))`);
  verifier(cartes.length === 11 && cartes.every(c => c.texte.includes(c.id === "dev" ? "2 conversations" : c.id === "qa" ? "1 conversation" : "Aucune conversation")), "cartes : 0/1/2 conversations issues du profil Electron");
  verifier(cartes.every(c => !c.barre && !/\bsur \d/.test(c.texte) && c.texte.includes("Voir la fiche")), "cartes : ni total ni barre, Voir la fiche conservé");
  await ev(`document.querySelector('main a[href="/equipe?agent=dev"]').click()`);
  await attendre(2500);
  verifier((await ev("new URL(location.href).searchParams.get('agent')")) === "dev" && (await titre())?.startsWith("Hugo"), "cliquer la carte ouvre la fiche de Hugo");
  const intactes = await ev("window.klyra.conversations.read()");
  verifier(JSON.stringify(intactes.data.chats) === JSON.stringify(conversations) && intactes.data.messages.length === 0, "navigation : conversations conservées et aucun message envoyé");

  await aller("/equipe?agent=dev&mode=modifier");
  await ev(`(() => { const i = [...document.querySelectorAll('main input')].find((i) => i.value === 'Hugo'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Hugo B.'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await cliquer("Enregistrer");
  await attendre(2500);
  const dev = readFileSync(path.join(AGENTS, "dev.md"), "utf8");
  verifier(dev === modele.replace("displayName: Hugo\n", "displayName: Hugo B.\n"), "modification : seul le prénom change dans le fichier");
  verifier(readdirSync(path.join(TMP, "userdata/historique-agents/dev")).length === 1, "modification : l’ancienne version est dans l’historique");

  await aller("/equipe?agent=qa&mode=modifier");
  const qa = path.join(AGENTS, "qa.md");
  writeFileSync(qa, readFileSync(qa, "utf8").replace("# Agathe — QA", "# Agathe — QA (modifiée ailleurs)"));
  utimesSync(qa, new Date(), new Date(Date.now() + 5000));
  await attendre(800);
  await ev(`(() => { const i = [...document.querySelectorAll('main input')].find((i) => i.value === 'QA'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Qualité'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await cliquer("Enregistrer");
  await attendre(1500);
  verifier(readFileSync(qa, "utf8").includes("(modifiée ailleurs)"), "conflit : la modif faite ailleurs n’est pas écrasée");
  verifier(!!(await ev("document.querySelector('main [role=alert]')?.innerText.includes('a changé sur le disque')")), "conflit : l’écran le signale");

  await aller("/equipe?nouveau=1");
  await saisir("main input", 0, "juriste");
  await saisir("main input", 1, "Nina");
  await saisir("main input", 2, "Juridique");
  await saisir("main textarea", 0, "Juriste — contrats, CGV, RGPD. Appelle Nina dès qu’un texte engage juridiquement le studio.");
  await attendre(400);
  await cliquer("Créer l’agent");
  await attendre(3000);
  verifier(existsSync(path.join(AGENTS, "juriste.md")), "création : la fiche est écrite");
  const citent = readdirSync(AGENTS).filter((f) => readFileSync(path.join(AGENTS, f), "utf8").includes("Nina (juridique)"));
  verifier(citent.length === 11, "création : les 11 autres fiches la présentent");
  const reglages = JSON.parse(readFileSync(path.join(TMP, "userdata/agents-meta.json"), "utf8"));
  verifier(reglages.juriste?.tag === "Juridique", "création : rôle court gardé dans les réglages de l’app");

  verifier(erreurs.length === 0, `aucune erreur dans la page${erreurs.length ? ` (${erreurs.join(" | ")})` : ""}`);
  ws.close();
} catch (e) {
  verifier(false, `le test a planté : ${e instanceof Error ? e.message : e}`);
} finally {
  electron.kill();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout passe.");
process.exit(echecs.length ? 1 : 0);
