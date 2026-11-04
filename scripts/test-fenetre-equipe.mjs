/**
 * La carte Équipe ouvre le HTML partagé dans la fenêtre isolée.
 * L'écran ne reçoit pas l'adresse de stockage. Captures si KLYRA_CAPTURES est un dossier.
 * Prérequis : `pnpm build && pnpm build:electron`, et un Convex local jetable
 * (KLYRA_TEST_CONVEX_URL, KLYRA_TEST_CONVEX_ADMIN_KEY). Jamais un vrai déploiement.
 *   KLYRA_CAPTURES=/tmp/captures xvfb-run -a node scripts/test-fenetre-equipe.mjs --no-sandbox
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const CONVEX = process.env.KLYRA_TEST_CONVEX_URL;
const CLE_ADMIN = process.env.KLYRA_TEST_CONVEX_ADMIN_KEY;
if (!CONVEX || !CLE_ADMIN) {
  console.log("Backend Convex local absent (KLYRA_TEST_CONVEX_URL, KLYRA_TEST_CONVEX_ADMIN_KEY) : test sauté.");
  process.exit(0);
}

const CAPTURES = process.env.KLYRA_CAPTURES;
const PORT = 9348;
const TITRE = "Page isolée";
const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-fenetre-equipe-"));
const home = path.join(TMP, "home");
const donnees = path.join(TMP, "userdata");
const page = path.join(home, ".klyra", "rendus", "iris", "page.html");
mkdirSync(path.dirname(page), { recursive: true });
mkdirSync(donnees, { recursive: true });
writeFileSync(
  page,
  `<!doctype html><html><head><meta charset="utf-8"><title>${TITRE}</title>
<style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;background:#1c3d32;color:#f6f1e7;font:600 42px Georgia,serif}</style>
</head><body>${TITRE}<script>window.__reseau=fetch("https://example.invalid/x").then(()=>"ouvert",()=>"bloque");</script></body></html>`,
);
const maintenant = new Date().toISOString();
writeFileSync(
  path.join(donnees, "conversations.json"),
  JSON.stringify({
    version: 1,
    chats: [],
    messages: [],
    projects: [],
    routines: [],
    taches: [],
    evenements: [],
    categories: [],
    workflows: [],
    executions: [],
    rendus: [
      {
        id: "page-isolee",
        chemin: page,
        origine: page,
        taille: 400,
        titre: TITRE,
        description: "Une page pour l’équipe",
        type: "page",
        roleId: "iris",
        chatId: null,
        projectId: null,
        ajouteLe: maintenant,
        misAJour: maintenant,
      },
    ],
    artefacts: [],
    artefactsClaude: false,
  }),
);

const admin = new ConvexHttpClient(CONVEX);
admin.setAdminAuth(CLE_ADMIN);
const ALICE = { email: `alice-fenetre-${Date.now().toString(36)}@exemple.test`, nom: "Alice Fenêtre" };
const courrielsRecus = (email) => admin.query(makeFunctionReference("courriels:nombreCourrielsSimules"), { a: email });

async function seConnecter(a) {
  if (await a.quand("document.querySelector('main')?.innerText.includes('donne un nom')", 4000)) await a.cliquer("Garder « Assistant »");
  await a.aller("/reglages?section=equipe");
  const champ = await a.quand(`document.querySelector('input[aria-label="Adresse e-mail"]')`);
  if (!champ) throw new Error(`pas de champ e-mail (${String(await a.texte()).replace(/\s+/g, " ").slice(0, 180)})`);
  const avant = await courrielsRecus(ALICE.email);
  await a.saisir('input[aria-label="Adresse e-mail"]', ALICE.email);
  await attendre(200);
  await a.cliquer("Recevoir un lien");
  const lien = await a.quand(`document.querySelector('input[aria-label="Lien de connexion"]')`);
  if (!lien) throw new Error(`pas de champ lien (${String(await a.texte()).replace(/\s+/g, " ").slice(0, 180)})`);
  let courriel = null;
  for (let i = 0; i < 20 && !courriel; i++) {
    if ((await courrielsRecus(ALICE.email)) > avant) {
      courriel = await admin.query(makeFunctionReference("courriels:dernierCourrielSimule"), { a: ALICE.email });
    } else await attendre(500);
  }
  const code = courriel?.texte.match(/\?code=([A-Za-z0-9]+)/)?.[1] ?? null;
  if (!code) throw new Error("aucun lien simulé");
  await a.saisir('input[aria-label="Lien de connexion"]', `klyra://connexion?code=${code}`);
  await attendre(200);
  await a.cliquer("Se connecter");
  return a.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Se déconnecter')", 30000);
}

async function capturer(cible, nom) {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  const { data } = await cible.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(CAPTURES, `${nom}.png`), Buffer.from(data, "base64"));
}

/** Deuxième fenêtre (le document), sur le même port de débogage. */
async function cibleDocument() {
  for (let i = 0; i < 40; i++) {
    const liste = await fetch(`http://127.0.0.1:${PORT}/json`)
      .then((r) => r.json())
      .catch(() => []);
    const cible = liste.find((x) => x.type === "page" && String(x.url).startsWith("klyra-document://"));
    if (cible) return cible;
    await attendre(250);
  }
  return null;
}

function connecter(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let id = 0;
  const attente = {};
  const ouvert = new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    attente[m.id]?.(m.result);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      attente[++id] = r;
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    pret: ouvert.then(() => send("Runtime.enable")),
    send,
    ev: async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.value,
    fermer: () => ws.close(),
  };
}

await admin.mutation(makeFunctionReference("equipe:initialiser"), { admins: [ALICE] });
const app = await lancerApp({
  port: PORT,
  env: {
    HOME: home,
    KLYRA_USER_DATA: donnees,
    KLYRA_CONVEX_URL: CONVEX,
    KLYRA_TEST_TROUSSEAU: "1",
  },
});

try {
  verifier(await seConnecter(app), "Alice se connecte au compte local");
  await app.aller("/artefacts");
  const bouton = `document.querySelector('button[aria-label="Partager à l’équipe"]')`;
  verifier(await app.quand(bouton, 20000), "la page HTML a « Partager à l’équipe »");
  await app.ev(`${bouton}?.click()`);
  const partage = await app.quand(`[...document.querySelectorAll('main li')].some((li) => li.innerText.includes(${JSON.stringify(TITRE)}) && li.innerText.includes('Équipe'))`, 20000);
  const erreurCarte = await app.ev(`[...document.querySelectorAll('main li')].find((li) => li.innerText.includes(${JSON.stringify(TITRE)}))?.innerText ?? ''`);
  verifier(partage, `le partage est sur la carte (${String(erreurCarte).replace(/\s+/g, " ").slice(0, 180)})`);

  await app.ev(`[...document.querySelectorAll('[role=tab]')].find((t) => t.innerText.trim().startsWith('Équipe'))?.click()`);
  const ouvrir = `document.querySelector('button[aria-label="Ouvrir ${TITRE}"]')`;
  verifier(await app.quand(ouvrir, 10000), "l’onglet Équipe montre la page");
  await app.ev(`${ouvrir}?.scrollIntoView({ block: 'center' })`);
  const image = await app.quand(`${ouvrir}?.querySelector('img')?.src?.startsWith('data:image/png')`, 25000);
  verifier(image, "la vignette est un PNG dessiné dans l’app, pas une adresse");
  const fuite = await app.ev(`(() => {
    const html = document.documentElement.innerHTML;
    return { stockage: html.includes('/api/storage'), nuage: html.includes('convex.cloud'), src: ${ouvrir}?.querySelector('img')?.src?.slice(0, 30) ?? null };
  })()`);
  verifier(fuite && fuite.stockage === false && fuite.nuage === false && String(fuite.src).startsWith("data:image/png"), `l’écran n’a pas l’adresse de stockage (${JSON.stringify(fuite)})`);
  await capturer(app, "equipe-carte");

  await app.ev(`${ouvrir}?.click()`);
  const cible = await cibleDocument();
  verifier(!!cible && !String(cible.url).includes("convex") && !String(cible.url).includes("http"), `la fenêtre est sur klyra-document (${cible?.url ?? "absente"})`);
  if (cible) {
    const doc = connecter(cible.webSocketDebuggerUrl);
    await doc.pret;
    const lu = await doc.ev(`(async () => ({
      protocole: location.protocol,
      texte: document.body.innerText,
      pont: typeof window.klyra,
      node: typeof process,
      reseau: await window.__reseau,
    }))()`);
    verifier(lu?.protocole === "klyra-document:" && String(lu.texte).includes(TITRE), "la page s’affiche dans sa fenêtre");
    verifier(lu?.pont === "undefined" && lu?.node === "undefined", "pas de pont vers l’app, pas de Node");
    verifier(lu?.reseau === "bloque", "le document ne joint pas le réseau");
    await capturer(doc, "equipe-fenetre");
    doc.fermer();
  }
  if (app.erreurs.length) console.log(app.erreurs.slice(0, 5).join("\n"));
} catch (e) {
  console.error(e);
  echecs.push(e instanceof Error ? e.message : String(e));
} finally {
  await app.fermer();
}

console.log(echecs.length ? `\n${echecs.length} échec(s)` : "\nCarte Équipe : tout passe.");
process.exit(echecs.length ? 1 : 0);
