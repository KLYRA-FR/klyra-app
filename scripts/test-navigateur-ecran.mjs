/**
 * L'onglet « Navigateur » du panneau d'une conversation, dans l'app de bureau
 * (export statique), sur un profil temporaire et une page servie en local :
 * ouvrir un onglet, taper une adresse, voir la page posée exactement sur la zone
 * du panneau, la voir s'effacer sous une fenêtre de l'app, prendre et rendre la
 * main, revenir aux vignettes, retrouver l'onglet après un redémarrage.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:navigateur-ecran      (Linux : xvfb-run -a … -- --no-sandbox)
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-navigateur-ecran-"));
const DONNEES = path.join(TMP, "userdata");
const PORT = 9341;
const echecs = [];
const verifier = (ok, message, detail) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}${!ok && detail !== undefined ? `\n       ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const serveur = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>Page d’essai</title><body style="margin:0"><h1>Bonjour</h1></body>`);
});
await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
const SITE = `http://127.0.0.1:${serveur.address().port}/`;

mkdirSync(DONNEES, { recursive: true });
const il_y_a = (min) => new Date(Date.now() - min * 60_000).toISOString();
writeFileSync(
  path.join(DONNEES, "conversations.json"),
  JSON.stringify({
    version: 1,
    chats: [{ id: "dm-principal", kind: "direct", projectId: null, title: "Principal", roleIds: ["principal"], updatedAt: il_y_a(5), sessions: {}, luJusqua: "m1" }],
    messages: [{ id: "m1", chatId: "dm-principal", author: { kind: "user" }, createdAt: il_y_a(5), parts: [{ type: "text", text: "Bonjour" }] }],
    projects: [],
  }),
);

const env = { ...process.env, HOME: path.join(TMP, "home"), KLYRA_USER_DATA: DONNEES };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KLYRA_DEV_URL;

/** Un client du protocole de débogage sur une cible (la fenêtre de l'app, ou la page d'un onglet). */
async function client(cible) {
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
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
  return { send, ev, fermer: () => ws.close() };
}

const cibles = () => fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => []);

async function lancer() {
  const processus = spawn(ELECTRON, [".", `--remote-debugging-port=${PORT}`, ...process.argv.slice(2)], { cwd: APP, env, stdio: "ignore" });
  let cible;
  for (let i = 0; i < 60 && !cible; i++) {
    await attendre(500);
    cible = (await cibles()).find((x) => x.type === "page" && x.url.startsWith("app://"));
  }
  if (!cible) throw new Error("la fenêtre de l’app n’apparaît pas");
  const c = await client(cible);
  await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  for (let i = 0; i < 40 && !(await c.ev("document.body?.innerText.length > 0 && !!window.klyra")); i++) await attendre(500);
  const cliquerEn = async (x, y) => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    await attendre(300);
  };
  return {
    ...c,
    async aller(chemin) {
      await c.ev(`window.next?.router ? window.next.router.push(${JSON.stringify(chemin)}) : (location.href = ${JSON.stringify(chemin)})`);
      await attendre(1500);
    },
    async cliquer(selecteur) {
      const r = await c.ev(`(() => { const b = document.querySelector(${JSON.stringify(selecteur)})?.getBoundingClientRect(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      if (!r) throw new Error(`introuvable : ${selecteur}`);
      await cliquerEn(r.x, r.y);
    },
    async cliquerTexte(texte) {
      const r = await c.ev(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim().startsWith(${JSON.stringify(texte)}))?.getBoundingClientRect(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      if (!r) throw new Error(`bouton introuvable : ${texte}`);
      await cliquerEn(r.x, r.y);
    },
    async ecrire(texte) {
      await c.send("Input.insertText", { text: texte });
      await attendre(150);
    },
    async entree() {
      await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
      await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await attendre(300);
    },
    fermer() {
      c.fermer();
      processus.kill();
      return new Promise((r) => processus.once("exit", r));
    },
  };
}

const ongletsApp = (a) => a.ev("window.klyra.navigateur.etat().then((r) => r.ok ? r.data : [])");
const zone = (a) => a.ev(`(() => { const z = document.querySelector('[data-zone-navigateur]'); if (!z) return null; const r = z.getBoundingClientRect(); return { l: Math.round(r.width), h: Math.round(r.height) }; })()`);
async function pageDuSite() {
  for (let i = 0; i < 30; i++) {
    const t = (await cibles()).find((x) => x.type === "page" && x.url.startsWith(SITE));
    if (t) return client(t);
    await attendre(300);
  }
  return null;
}

let app;
try {
  app = await lancer();
  await app.aller("/chat?id=dm-principal");
  verifier(!!(await app.ev(`document.querySelector('[role="tab"]') && [...document.querySelectorAll('[role="tab"]')].some((t) => t.innerText.trim() === "Navigateur")`)), "le panneau de la conversation a un onglet Navigateur");
  await app.ev(`[...document.querySelectorAll('[role="tab"]')].find((t) => t.innerText.trim() === "Navigateur").click()`);
  await attendre(400);
  verifier(/Aucun onglet dans cette conversation/.test(await app.ev("document.body.innerText")), "sans onglet : l’état vide l’explique");

  await app.cliquerTexte("Nouvel onglet");
  await attendre(600);
  const focus = await app.ev("document.activeElement?.getAttribute('aria-label')");
  verifier(focus === "Adresse de la page", "un nouvel onglet donne le focus à la barre d’adresse", focus);
  await app.ecrire(SITE.replace("http://", ""));
  await app.entree();
  await attendre(1500);
  const onglets = await ongletsApp(app);
  verifier(onglets.length === 1 && onglets[0].chatId === "dm-principal" && onglets[0].titre === "Page d’essai", "la page s’ouvre dans un onglet de cette conversation", onglets);

  const page = await pageDuSite();
  verifier(!!page, "la page est une vraie page Chromium");
  const z = await zone(app);
  const vue = page && (await page.ev("({ l: innerWidth, h: innerHeight })"));
  verifier(!!z && vue && Math.abs(vue.l - z.l) <= 1 && Math.abs(vue.h - z.h) <= 1 && (await ongletsApp(app))[0].affiche, "la page est posée exactement sur la zone du panneau", { z, vue });

  /* Une fenêtre de l'app par-dessus : la page s'efface, puis revient. */
  await app.ev(`window.dispatchEvent(new CustomEvent("klyra:recherche"))`);
  await attendre(600);
  const ouverte = await app.ev(`!!document.querySelector('[role="dialog"]')`);
  const cachee = !(await ongletsApp(app))[0].affiche;
  verifier(ouverte && cachee, "une fenêtre de l’app par-dessus : la page s’efface", { ouverte, cachee });
  await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await attendre(600);
  verifier((await ongletsApp(app))[0].affiche, "fenêtre fermée : la page revient");

  /* Prendre et rendre la main. */
  await app.cliquer('button[aria-label="Prendre la main sur cet onglet"]');
  await attendre(400);
  verifier(/Tu as la main/.test(await app.ev("document.body.innerText")) && (await ongletsApp(app))[0].main?.type === "personne", "prendre la main : le bandeau le dit, les agents n’agissent plus");
  await app.cliquerTexte("Rendre la main");
  await attendre(400);
  verifier((await ongletsApp(app))[0].main === null, "rendre la main");

  /* Retour aux vignettes : la page native n'est plus à l'écran. */
  await app.cliquerTexte("Onglets");
  await attendre(1800);
  const texte = await app.ev("document.body.innerText");
  verifier(/1 onglet/.test(texte) && /Page d’essai/.test(texte) && !(await ongletsApp(app))[0].affiche, "retour aux onglets : une carte par onglet, la page s’efface", texte.slice(0, 300));
  verifier(!!(await ongletsApp(app))[0].vignette, "la carte a sa vignette");
  page?.fermer();
  await app.fermer();

  /* Après un redémarrage : l'onglet est là, endormi, et se réveille à l'ouverture. */
  app = await lancer();
  await app.aller("/chat?id=dm-principal");
  const apres = await ongletsApp(app);
  verifier(apres.length === 1 && apres[0].endormi && apres[0].url === SITE, "l’onglet est retrouvé au redémarrage, sans page chargée", apres);
} catch (e) {
  verifier(false, `le test s’est déroulé sans exception : ${e instanceof Error ? e.message : e}`);
} finally {
  await app?.fermer().catch(() => undefined);
  serveur.close();
  try {
    console.log(`navigateur.json : ${readFileSync(path.join(DONNEES, "navigateur.json"), "utf8").length} octets`);
  } catch {
    /* pas écrit */
  }
  rmSync(TMP, { recursive: true, force: true });
}
console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nNAVIGATEUR (ÉCRAN) : TOUT PASSE");
process.exit(echecs.length ? 1 : 0);
