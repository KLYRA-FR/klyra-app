/**
 * La Marketplace (Composio et MCP directs) : vraie UI exportée, faux bridge
 * exclusif au test, fenêtre Electron cachée.
 * Aucun import du main productif, compte, coffre, clé ou réseau extérieur.
 *   pnpm build
 *   xvfb-run -a env -u ELECTRON_RUN_AS_NODE pnpm exec electron scripts/test-composio-interface.cjs
 * KLYRA_TEST_RUNTIME_ROOT : dépôt contenant out/ (sinon ..).
 * KLYRA_TEST_PREUVES : dossier facultatif des captures PNG marquées « Données simulées ».
 * Les résultats vérifient l'UI et ses appels au pont, pas l'OAuth, le stockage natif
 * ni les vrais serveurs MCP.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Harnais Electron CommonJS. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("node:http");
const { app, BrowserWindow, ipcMain, session } = require("electron");
const ROOT = path.resolve(process.env.KLYRA_TEST_RUNTIME_ROOT || path.join(__dirname, ".."));
const OUT = path.join(ROOT, "out");
const PREUVES = process.env.KLYRA_TEST_PREUVES ? path.resolve(process.env.KLYRA_TEST_PREUVES) : null;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-composio-interface-"));
app.setPath("userData", path.join(TMP, "userdata"));
app.setPath("sessionData", path.join(TMP, "session"));
const CLE_MAIN_SEULEMENT = "cle-sentinelle-interdite-dans-le-renderer";
const CLE_SAISIE = "ak_cle-collee-par-la-personne-0123";
let importAnnule = true;
const clone = (v) => structuredClone(v);
let revision = 1;
let fixture = { contexte: "fixture-1", profil: { nom: "Profil simulé", type: "local" }, configure: false, coffreDisponible: true, services: [], comptes: [], selections: {}, enAttente: [], verifieLe: null, erreur: null };
const service = { slug: "gmail", nom: "Gmail", description: "Courriels de démonstration", configurations: [{ id: "auth_test", nom: "Configuration de test", methode: "OAUTH2", active: true }] };
const account = (id, statut = "ACTIVE") => ({ id, service: "gmail", nom: `${id.toLowerCase()}@example.test`, alias: id, statut, desactive: false });
const journal = [];
const verifications = [];
const erreurs = [];
const exterieurs = [];
let win, server, base;
let lectureBloquee = true;
let libererLecture;
let pending = null;
let sequence = 0;
let total = 0;
let echecDeconnexion = null;
let libererDeconnexion;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function changer(patch) { fixture = { ...fixture, ...patch, contexte: `fixture-${++revision}` }; }
function verifier(ok, nom) { assert.ok(ok, nom); total++; verifications.push(nom); console.log(`OK ${nom}`); }
const limiter = setTimeout(() => { console.error("ÉCHEC délai interface (150 s)"); terminer(1); }, 150_000);
function terminer(code) {
  clearTimeout(limiter);
  win?.destroy(); server?.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); }
  catch { console.log("Profil de test temporaire encore verrouillé ; nettoyage différé au système."); }
  app.exit(code);
}

ipcMain.handle("fixture:composio", async (_event, nom, contexte, ...args) => {
  journal.push({ nom, contexte, args: clone(args) });
  if (nom === "etat") {
    if (lectureBloquee) await new Promise((r) => { libererLecture = r; });
    return { ok: true, data: clone(fixture) };
  }
  if (nom === "console") return { ok: true, data: null };
  if (contexte !== fixture.contexte) return { ok: false, code: "contexte", message: "Contexte de test périmé." };
  if (nom === "importer" && importAnnule) return { ok: true, data: false };
  if (nom === "saisir" && args[0] !== CLE_SAISIE) return { ok: false, code: "acces", message: "Composio refuse cette clé (simulation)." };
  if (nom === "importer" || nom === "saisir") {
    assert.ok(CLE_MAIN_SEULEMENT.length > 0);
    changer({ configure: true, services: [service], verifieLe: Date.now(), erreur: null });
    return { ok: true, data: true };
  }
  if (nom === "selectionner") {
    const [slug, id] = args;
    const selections = { ...fixture.selections };
    if (id === null) delete selections[slug];
    else {
      const compte = fixture.comptes.find((c) => c.id === id && c.service === slug && c.statut === "ACTIVE" && !c.desactive);
      if (!compte) return { ok: false, code: "absent", message: "Compte de test absent ou expiré." };
      selections[slug] = id;
    }
    changer({ selections });
  } else if (nom === "connecter") {
    pending = { compteId: `nouveau_${++sequence}`, service: args[0], expireLe: new Date(Date.now() + 600_000).toISOString() };
    changer({ comptes: [...fixture.comptes, account(pending.compteId, "INITIATED")], enAttente: [...fixture.enAttente, pending] });
    return { ok: true, data: clone(pending) };
  } else if (nom === "deconnecter") {
    const [id] = args;
    changer({ selections: Object.fromEntries(Object.entries(fixture.selections).filter(([, choisi]) => choisi !== id)), enAttente: fixture.enAttente.filter((a) => a.compteId !== id) });
    if (echecDeconnexion) {
      await new Promise((r) => { libererDeconnexion = r; });
      if (echecDeconnexion === "horsligne") changer({ comptes: [], erreur: { code: "reseau", message: "Composio reste hors ligne (simulation)." }, verifieLe: null });
      return { ok: false, code: "erreur", message: "Ce compte n’est plus choisi par les agents, mais sa déconnexion chez Composio n’a pas été confirmée. Actualise puis réessaie." };
    }
    changer({ comptes: fixture.comptes.filter((c) => c.id !== id) });
  } else if (nom === "retirer") changer({ configure: false, comptes: [], selections: {}, services: [], enAttente: [] });
  else throw new Error(`Action test inconnue : ${nom}`);
  return { ok: true, data: undefined };
});

/* Les MCP directs : la liste vit ici ; aucun jeton n'est renvoyé à l'écran. L'autorisation OAuth se termine quand le test le décide. */
const JETON_MCP = "jeton-mcp-sentinelle-du-test";
const APPS_MCP = { github: "https://api.githubcopilot.com/mcp/", linear: "https://mcp.linear.app/mcp", neon: "https://mcp.neon.tech/mcp" };
const NOMS_MCP = { github: "GitHub", linear: "Linear", neon: "Neon" };
/* Un Linear branché avant cette version, par jeton collé : il doit rester connecté. */
let mcpListe = [{ id: "mcp_ancien", app: "linear", nom: "Linear", url: APPS_MCP.linear, avecJeton: true, connexion: "jeton", aReconnecter: false }];
const mcpJournal = [];
let terminerMcp = null;
ipcMain.handle("fixture:mcp", async (_event, nom, arg) => {
  mcpJournal.push({ nom, entree: clone(arg ?? null) });
  if (nom === "lister") return { ok: true, data: clone(mcpListe) };
  if (nom === "connecter") {
    const ancien = arg.remplace ? mcpListe.find((m) => m.id === arg.remplace) : null;
    const url = ancien?.url ?? APPS_MCP[arg.app] ?? arg.url;
    if (!url.startsWith("https://")) return { ok: false, code: "erreur", message: "L’adresse doit commencer par https://." };
    if (url.includes("sans-oauth")) return { ok: true, data: { statut: "sans-oauth", liste: clone(mcpListe) } };
    const fini = await new Promise((r) => { terminerMcp = r; });
    terminerMcp = null;
    if (!fini) return { ok: true, data: { statut: "annule", liste: clone(mcpListe) } };
    const entree = { id: ancien?.id ?? `mcp_${++sequence}`, app: ancien?.app ?? arg.app ?? null, nom: ancien?.nom ?? NOMS_MCP[arg.app] ?? arg.nom, url, avecJeton: false, connexion: "oauth", aReconnecter: false };
    mcpListe = ancien ? mcpListe.map((m) => (m.id === ancien.id ? entree : m)) : [...mcpListe, entree];
    return { ok: true, data: { statut: "connecte", liste: clone(mcpListe) } };
  }
  if (nom === "annuler") { terminerMcp?.(false); return { ok: true, data: undefined }; }
  if (nom === "ajouter") {
    if (arg.app) return { ok: false, code: "erreur", message: "Cette app se connecte par autorisation dans le navigateur." };
    mcpListe = [...mcpListe, { id: `mcp_${++sequence}`, app: null, nom: arg.nom, url: arg.url, avecJeton: !!arg.jeton, connexion: arg.jeton ? "jeton" : "aucune", aReconnecter: false }];
    return { ok: true, data: clone(mcpListe) };
  }
  if (nom === "retirer") { mcpListe = mcpListe.filter((m) => m.id !== arg); return { ok: true, data: clone(mcpListe) }; }
  throw new Error(`Action MCP test inconnue : ${nom}`);
});

/* Composio Connect : main ouvre le navigateur ; ici, le test décide quand la connexion aboutit. */
let connectEtat = { connecte: false, compte: null, enCours: false, erreur: null };
let terminerConnect = null;
const connectJournal = [];
ipcMain.handle("fixture:connect", async (_event, nom) => {
  connectJournal.push(nom);
  if (nom === "etat") return { ok: true, data: clone(connectEtat) };
  if (nom === "connecter") {
    connectEtat = { ...connectEtat, enCours: true };
    const fini = await new Promise((r) => { terminerConnect = r; });
    terminerConnect = null;
    connectEtat = { connecte: fini, compte: fini ? "corentin@example.test" : null, enCours: false, erreur: null };
    return { ok: true, data: fini };
  }
  if (nom === "annuler") { terminerConnect?.(false); return { ok: true, data: null }; }
  if (nom === "deconnecter") { connectEtat = { connecte: false, compte: null, enCours: false, erreur: null }; return { ok: true, data: null }; }
  throw new Error(`Action Connect test inconnue : ${nom}`);
});
const boutonPret = (texte) => `[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === ${JSON.stringify(texte)} && !b.disabled)`;

const ev = (code) => win.webContents.executeJavaScript(code, true);
const rendu = () => ev("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
async function attendre(expression, nom = expression, max = 10_000) {
  for (let i = 0; i < max / 50; i++) {
    if (await ev(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return;
    await pause(50);
  }
  throw new Error(`Attente UI : ${nom}; erreurs: ${erreurs.join(" | ")}`);
}
async function cliquer(texte, selecteur = "button", prefixe = false) {
  const expression = `[...document.querySelectorAll(${JSON.stringify(selecteur)})].find((b) => ${prefixe ? `b.innerText.trim().startsWith(${JSON.stringify(texte)})` : `b.innerText.trim() === ${JSON.stringify(texte)}`} && !b.disabled)`;
  await attendre(expression, `bouton ${texte}`);
  await ev(`(() => { const b = ${expression}; b.scrollIntoView({block:'center'}); b.focus(); b.click(); })()`);
  await rendu();
}
async function cible(selecteur) {
  await attendre(`document.querySelector(${JSON.stringify(selecteur)}) && !document.querySelector(${JSON.stringify(selecteur)}).disabled`, selecteur);
  await ev(`(() => { const b = document.querySelector(${JSON.stringify(selecteur)}); b.scrollIntoView({block:'center'}); b.focus(); b.click(); })()`);
  await rendu();
}
async function touche(key) {
  await rendu();
  const attendu = { Space: " ", Down: "ArrowDown", Up: "ArrowUp" }[key] ?? key;
  // Observe une vraie touche Electron ; aucune création de KeyboardEvent côté page.
  await ev("window.__klyraTestTouche = null; document.addEventListener('keydown', (e) => { window.__klyraTestTouche = e.key; }, {once:true, capture:true})");
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
  await attendre(`window.__klyraTestTouche === ${JSON.stringify(attendu)}`, `réception clavier ${key}`);
  await rendu();
}
/** Connecté : « Actualiser » est dans le menu de la carte ; en erreur, « Réessayer » est visible. */
async function actualiser() {
  const lectures = journal.filter((j) => j.nom === "etat").length;
  if (await ev("!!document.querySelector('button[aria-label=\"Plus d’options pour la clé de projet\"]')")) {
    await cible('button[aria-label="Plus d’options pour la clé de projet"]');
    await cliquer("Actualiser", '[role="menuitem"]');
  } else await cliquer("Réessayer");
  for (let i = 0; i < 200 && journal.filter((j) => j.nom === "etat").length === lectures; i++) await pause(20);
  await pause(100); await rendu();
}
const carteComposio = () => ev("document.querySelector('section[aria-labelledby=titre-composio]')?.innerText ?? ''");
/** Saisie réelle (insertText) dans le champ ciblé, comme au clavier. */
async function saisir(selecteur, valeur) {
  await attendre(`document.querySelector(${JSON.stringify(selecteur)})`, selecteur);
  await ev(`document.querySelector(${JSON.stringify(selecteur)}).focus()`);
  await win.webContents.insertText(valeur);
  await rendu();
}
const texte = () => ev("document.body.innerText");
async function capture(nom) {
  if (!PREUVES) return;
  fs.mkdirSync(PREUVES, { recursive: true });
  await ev(`(() => { let b = document.getElementById('preuve-fixture'); if (!b) { b = document.createElement('div'); b.id='preuve-fixture'; document.body.append(b); } b.textContent = ${JSON.stringify(`Données simulées · test Composio · ${nom}`)}; b.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#111;color:#fff;padding:4px 8px;font:11px sans-serif;text-align:center;pointer-events:none'; })()`);
  await rendu();
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(PREUVES, `ui-${nom}-simulation.png`), image.toPNG());
}
async function ouvrirConnexion() {
  await cliquer("Ajouter une app");
  await attendre("document.querySelector('[role=dialog] input[type=search]')");
  await cible('[role="dialog"] [role="option"]');
}
async function confirmerCompteAttendu() {
  changer({ comptes: fixture.comptes.map((c) => c.id === pending.compteId ? { ...c, statut: "ACTIVE" } : c), enAttente: [] });
  await cliquer("Actualiser", '[role="dialog"] button');
  await attendre("!document.querySelector('[role=dialog]')", "fermeture après connexion source confirmée");
}

app.whenReady().then(async () => {
  try {
    assert.ok(fs.existsSync(path.join(OUT, "marketplace.html")), "build Next absent");
    const mime = { ".html": "text/html", ".txt": "text/plain", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
    server = createServer((req, res) => {
      try {
        let pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
        if (pathname.endsWith("/")) pathname += "index.html";
        if (!path.extname(pathname)) pathname += ".html";
        const file = path.resolve(OUT, `.${pathname}`);
        if (!file.startsWith(`${OUT}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
        res.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
      } catch { res.writeHead(400).end(); }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    session.defaultSession.webRequest.onBeforeRequest((details, done) => {
      const permis = details.url.startsWith(`${base}/`) || details.url.startsWith("data:");
      if (!permis) exterieurs.push(new URL(details.url).origin);
      done({ cancel: !permis });
    });
    // offscreen maintient les frames et le focus React actifs même sans fenêtre visible.
    win = new BrowserWindow({ show: false, width: 1100, height: 700, useContentSize: true, webPreferences: { preload: path.join(__dirname, "faux-composio-interface-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.on("console-message", ({ level, message }) => { if (level === "error" && !message.includes("favicon")) erreurs.push(message); });
    win.webContents.setWindowOpenHandler(({ url }) => { exterieurs.push(new URL(url).origin); return { action: "deny" }; });
    await win.loadURL(`${base}/marketplace`);
    await attendre(boutonPret("Se connecter à Composio"), "connexion Composio prête");
    verifier(!(await carteComposio()).includes("Connecté") && !(await ev("document.querySelector('[data-service-composio]') !== null")), "profil vierge : un seul bouton de connexion, aucun compte fictif");
    await capture("00-vierge");

    await cliquer("Se connecter à Composio");
    await attendre("document.body.innerText.includes('Termine dans le navigateur…')");
    verifier(connectJournal.includes("connecter") && await ev("document.querySelectorAll('input[type=password]').length === 0"), "Composio Connect : le navigateur est ouvert par main, aucune clé demandée");
    await cliquer("Annuler");
    await attendre(boutonPret("Se connecter à Composio"));
    verifier(connectJournal.includes("annuler") && !(await carteComposio()).includes("Connecté"), "annulation : rien n’est annoncé connecté");
    await cliquer("Se connecter à Composio");
    await attendre("document.body.innerText.includes('Termine dans le navigateur…')");
    for (let i = 0; i < 100 && !terminerConnect; i++) await pause(20);
    terminerConnect(true);
    await attendre("document.body.innerText.includes('Connecté en tant que corentin@example.test')", "compte Composio affiché");
    verifier((await carteComposio()).includes("Composio te donne un lien à valider"), "connexion terminée : compte affiché, apps branchées au premier besoin");
    await capture("01-connect");
    await cible('button[aria-label="Plus d’options pour Composio"]'); await cliquer("Se déconnecter…", '[role="menuitem"]');
    await attendre("document.querySelector('[role=alertdialog]')");
    verifier(!connectJournal.includes("deconnecter"), "déconnexion Composio : rien avant confirmation");
    await cliquer("Se déconnecter", '[role="alertdialog"] button');
    await attendre(boutonPret("Se connecter à Composio"));
    verifier(connectJournal.includes("deconnecter") && !(await carteComposio()).includes("Connecté en tant que"), "déconnexion Composio confirmée : jetons effacés par main");

    await ev("document.querySelector('section[aria-labelledby=titre-composio] details > summary').click()");
    await attendre("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Coller une clé…')", "mode développeur ouvert");
    verifier(await ev("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Coller une clé…' && b.disabled)"), "mode développeur : clé désactivée tant que l’état n’est pas lu");
    lectureBloquee = false; libererLecture?.();
    await attendre(boutonPret("Coller une clé…"));

    await cliquer("Coller une clé…");
    await attendre("document.querySelector('[role=dialog] input[type=password]')");
    verifier(await ev("document.activeElement === document.querySelector('[role=dialog] input[type=password]')"), "fenêtre de connexion : focus dans le champ de la clé");
    verifier(await ev("[...document.querySelectorAll('[role=dialog] button')].some((b) => b.innerText.trim() === 'Connecter' && b.disabled)"), "Connecter désactivé tant qu’aucune clé n’est collée");
    await cliquer("Ouvrir la console", '[role="dialog"] button');
    verifier(journal.some((j) => j.nom === "console"), "console Composio ouverte par le pont, sans URL dans le renderer");
    await cliquer("Ou importer un fichier de clé…", '[role="dialog"] button');
    for (let i = 0; i < 100 && !journal.some((j) => j.nom === "importer"); i++) await pause(20);
    await rendu();
    verifier(await ev("document.querySelector('[role=dialog]') !== null") && !(await texte()).includes("La clé de projet est enregistrée."), "fichier non choisi : fenêtre gardée, aucun faux succès");
    await saisir('[role="dialog"] input[type=password]', "ak_mauvaise-cle-000000");
    await cliquer("Connecter", '[role="dialog"] button');
    await attendre("document.querySelector('[role=dialog] [role=alert]')?.innerText.includes('refuse cette clé')", "clé refusée affichée dans la fenêtre");
    verifier(!(await carteComposio()).includes("Connecté"), "clé refusée : Composio n’est pas annoncé connecté");
    await ev("document.querySelector('[role=dialog] input[type=password]').select()");
    await saisir('[role="dialog"] input[type=password]', CLE_SAISIE);
    await capture("01b-cle-saisie");
    await cliquer("Connecter", '[role="dialog"] button');
    await attendre("!document.querySelector('[role=dialog]') && document.body.innerText.includes('Aucune app connectée pour l’instant.')");
    verifier(journal.some((j) => j.nom === "saisir" && j.args[0] === CLE_SAISIE) && (await carteComposio()).includes("Connecté") && (await texte()).includes("La clé de projet est enregistrée."), "clé collée : transmise une fois au pont, Composio connecté");
    verifier(!(await ev(`document.documentElement.outerHTML.includes(${JSON.stringify(CLE_SAISIE)})`)), "clé collée : elle ne reste pas dans la page");

    await ouvrirConnexion();
    verifier(await ev("document.querySelectorAll('[role=dialog] input[type=radio]').length === 0"), "ajout d’app : aucune autorisation anticipée dans la fenêtre");
    await capture("02-ajout-app");
    await cliquer("Continuer dans le navigateur");
    await attendre("document.body.innerText.includes('Termine la connexion dans le navigateur')");
    verifier(!fixture.selections.gmail && !journal.some((j) => j.nom === "selectionner"), "ouverture du navigateur : rien n’est choisi avant la confirmation de Composio");
    const premier = pending.compteId;
    await confirmerCompteAttendu();
    await attendre(`document.querySelector('[data-service-composio="gmail"]')?.innerText.includes('${premier.toLowerCase()}@example.test')`, "Gmail listé avec son compte");
    verifier(fixture.selections.gmail === premier && journal.filter((j) => j.nom === "selectionner").length === 1, "première connexion confirmée : le compte est choisi d’office pour les agents");

    await ouvrirConnexion(); await cliquer("Continuer dans le navigateur");
    await attendre("document.body.innerText.includes('Termine la connexion dans le navigateur')");
    const second = pending.compteId;
    await confirmerCompteAttendu();
    await attendre("document.querySelector('[data-service-composio=\"gmail\"] [role=combobox]')", "choix du compte quand Gmail en a deux");
    verifier(fixture.selections.gmail === premier && journal.filter((j) => j.nom === "selectionner").length === 1, "connexion suivante : le compte déjà choisi n’est pas remplacé");
    await capture("03-deux-comptes");

    const liste = '[data-service-composio="gmail"] [role=combobox]';
    await ev(`document.querySelector('${liste}').focus()`);
    await attendre(`document.activeElement === document.querySelector('${liste}')`, "focus du choix de compte");
    await touche("Space");
    await attendre(`document.querySelector('${liste}')?.getAttribute('aria-expanded') === 'true'`, "liste ouverte au clavier");
    await touche("Home");
    await touche("Down");
    await attendre(`document.getElementById(document.querySelector('${liste}')?.getAttribute('aria-activedescendant'))?.innerText.includes('${second.toLowerCase()}@example.test')`, "second compte actif au clavier");
    await touche("Enter");
    await attendre(`document.querySelector('${liste}')?.innerText.includes('${second.toLowerCase()}@example.test')`);
    verifier(fixture.selections.gmail === second, "choix du second compte au clavier transmis au pont");
    await cible(liste); await touche("End"); await touche("Enter");
    await attendre(`document.querySelector('${liste}')?.innerText.includes('Aucun')`);
    verifier(!fixture.selections.gmail && (await ev("document.querySelector('[data-service-composio=\"gmail\"]').innerText.includes('Aucun compte choisi')")), "Aucun efface le choix et l’annonce sur la ligne");

    changer({ comptes: fixture.comptes.map((c) => c.id === premier ? { ...c, statut: "EXPIRED" } : c), selections: { gmail: premier } }); await actualiser();
    verifier(await ev("document.querySelector('[data-service-composio=\"gmail\"]').innerText.includes('Expiré')"), "compte choisi expiré : état visible, jamais présenté comme connecté");
    await cible(liste);
    verifier(await ev(`[...document.querySelectorAll('[role=option]')].some((e) => e.innerText.includes('${premier.toLowerCase()}@example.test') && e.getAttribute('aria-disabled') === 'true')`), "compte expiré non sélectionnable");
    await touche("Escape");

    changer({ erreur: { code: "reseau", message: "Erreur réseau simulée" }, comptes: [], verifieLe: null }); await actualiser();
    verifier((await carteComposio()).includes("Hors ligne") && !(await ev("document.querySelector('[data-service-composio]') !== null")), "échec API : apps masquées et état hors ligne");
    changer({ erreur: { code: "acces", message: "Clé refusée simulée" } }); await actualiser();
    verifier((await carteComposio()).includes("À vérifier") && (await carteComposio()).includes("Clé refusée simulée"), "clé refusée : état et motif affichés");
    await capture("04-cle-refusee");
    changer({ erreur: null, comptes: [account(premier), account(second)], selections: { gmail: second }, verifieLe: Date.now() }); await actualiser();
    await attendre("document.querySelector('[data-service-composio=\"gmail\"]')");

    const menuGmail = 'button[aria-label="Plus d’options pour Gmail"]';
    await cible(menuGmail); await cliquer(`Déconnecter ${second.toLowerCase()}@example.test…`, '[role="menuitem"]');
    await attendre("document.querySelector('[role=alertdialog]')");
    verifier(!journal.some((j) => j.nom === "deconnecter"), "déconnexion : aucune mutation avant confirmation");
    verifier(await ev("document.activeElement?.closest('[role=alertdialog]') !== null"), "confirmation : focus dans la fenêtre avant Échap");
    await touche("Escape");
    await attendre("!document.querySelector('[role=alertdialog]')");
    verifier(fixture.comptes.some((c) => c.id === second), "Échap annule la déconnexion");
    echecDeconnexion = "distante";
    await cible(menuGmail); await cliquer(`Déconnecter ${second.toLowerCase()}@example.test…`, '[role="menuitem"]'); await cliquer("Déconnecter", '[role="alertdialog"] button');
    for (let i = 0; i < 250 && !libererDeconnexion; i++) await pause(20);
    libererDeconnexion(); libererDeconnexion = null;
    await attendre("document.body.innerText.includes('n’a pas été confirmée')", "erreur de déconnexion affichée");
    verifier(!(await texte()).includes("Gmail est déconnecté."), "suppression refusée : erreur visible, aucun faux succès");
    echecDeconnexion = null;
    await cible(menuGmail); await cliquer(`Déconnecter ${second.toLowerCase()}@example.test…`, '[role="menuitem"]'); await cliquer("Déconnecter", '[role="alertdialog"] button');
    await attendre(`document.body.innerText.includes('Gmail est déconnecté.') && !document.querySelector('[data-service-composio="gmail"]')?.innerText.includes('${second.toLowerCase()}@example.test')`);
    verifier(!fixture.comptes.some((c) => c.id === second) && journal.filter((j) => j.nom === "deconnecter").length === 2, "déconnexion confirmée : un appel par confirmation, compte retiré");

    await cible('button[aria-label="Plus d’options pour la clé de projet"]'); await cliquer("Retirer la clé…", '[role="menuitem"]'); await cliquer("Retirer", '[role="alertdialog"] button');
    await attendre(boutonPret("Coller une clé…"));
    verifier(journal.some((j) => j.nom === "retirer"), "retirer la clé de projet : clé retirée par le pont");

    const carteMcp = (id) => ev(`document.querySelector('[data-app-mcp="${id}"]')?.innerText ?? ""`);
    const attendreMcp = async () => { for (let i = 0; i < 100 && !terminerMcp; i++) await pause(20); verifier(!!terminerMcp, "autorisation en attente du navigateur"); };
    verifier(await ev("document.querySelectorAll('input[type=password]').length === 0"), "Apps en direct : aucun champ de jeton");

    // GitHub passe par Composio : sa carte lance la connexion Composio, sans jeton.
    await cible('[data-app-mcp="github"] button');
    await attendre("document.querySelector('[data-app-mcp=\"github\"]')?.innerText.includes('Autorise dans le navigateur…')", "GitHub : connexion Composio en cours");
    verifier(connectJournal.filter((n) => n === "connecter").length === 3 && !mcpJournal.some((j) => j.nom === "connecter") && !(await ev("document.querySelector('[role=dialog]')")), "GitHub : la connexion Composio s’ouvre, pas de fenêtre de jeton");
    for (let i = 0; i < 100 && !terminerConnect; i++) await pause(20);
    terminerConnect(true);
    await attendre("document.querySelector('[data-app-mcp=\"github\"]')?.innerText.includes('Par Composio')", "GitHub : par Composio");
    await capture("05-mcp-github-composio");

    // Un ancien jeton reste connecté, et passe à l'autorisation sans être perdu avant la fin.
    verifier((await carteMcp("linear")).includes("Connecté par jeton"), "Linear : l’ancien jeton reste connecté et signalé");
    await cible('button[aria-label="Plus d’options pour Linear"]'); await cliquer("Passer à l’autorisation", '[role="menuitem"]');
    await attendreMcp();
    verifier(mcpJournal.some((j) => j.nom === "connecter" && j.entree.remplace === "mcp_ancien") && mcpListe.some((m) => m.id === "mcp_ancien" && m.connexion === "jeton"), "Linear : autorisation demandée, l’ancien jeton gardé jusqu’au retour");
    terminerMcp(true);
    await attendre("(() => { const t = document.querySelector('[data-app-mcp=\"linear\"]')?.innerText ?? ''; return t.includes('Connecté') && !t.includes('par jeton'); })()", "Linear : passé à l’autorisation");
    verifier(mcpListe.find((m) => m.app === "linear")?.id === "mcp_ancien", "Linear : même entrée, mêmes outils pour les agents");

    // Neon : annuler, puis autoriser.
    await cible('[data-app-mcp="neon"] button');
    await attendreMcp();
    await attendre("document.querySelector('[data-app-mcp=\"neon\"]')?.innerText.includes('Autorise dans le navigateur…')");
    await cliquer("Annuler", '[data-app-mcp="neon"] button');
    await attendre("[...document.querySelectorAll('[data-app-mcp=\"neon\"] button')].some((b) => b.innerText.trim() === 'Connecter' && !b.disabled)", "Neon : annulé");
    verifier(mcpJournal.some((j) => j.nom === "annuler") && !(await carteMcp("neon")).includes("Connecté"), "Neon : annulation, rien d’annoncé connecté");
    await cible('[data-app-mcp="neon"] button');
    await attendreMcp();
    terminerMcp(true);
    await attendre("document.querySelector('[data-app-mcp=\"neon\"]')?.innerText.includes('Connecté')", "Neon : connecté");
    verifier(mcpJournal.some((j) => j.nom === "connecter" && j.entree.app === "neon") && !mcpJournal.some((j) => j.nom === "ajouter"), "Neon : autorisé dans le navigateur, sans jeton");
    await capture("05-mcp-oauth");

    // Autre serveur MCP : l'autorisation d'abord ; le jeton seulement si le serveur n'a pas d'OAuth.
    await cliquer("Autre serveur MCP");
    await attendre("document.querySelector('[role=dialog]')?.innerText.includes('Adresse du serveur')");
    verifier(await ev("document.querySelectorAll('[role=dialog] input[type=password]').length === 0"), "MCP personnalisé : pas de champ de jeton d’emblée");
    await saisir('[role="dialog"] input:not([type=password]):not([placeholder])', "Serveur maison");
    await saisir('[role="dialog"] input[placeholder="https://"]', "http://mcp.exemple.test/mcp");
    await cliquer("Connecter", '[role="dialog"] button');
    await attendre("document.querySelector('[role=dialog] [role=alert]')?.innerText.includes('https://')", "adresse non https refusée");
    verifier(await ev("document.querySelector('[role=dialog]') !== null"), "MCP personnalisé : refus affiché, fenêtre gardée ouverte");
    await ev("(() => { const i = document.querySelector('[role=dialog] input[placeholder=\"https://\"]'); i.select(); })()");
    await saisir('[role="dialog"] input[placeholder="https://"]', "https://sans-oauth.exemple.test/mcp");
    await cliquer("Connecter", '[role="dialog"] button');
    await attendre("document.querySelector('[role=dialog] input[type=password]') && document.querySelector('[role=dialog]').innerText.includes('ne propose pas d’autorisation')", "sans OAuth : jeton proposé en dernier recours");
    verifier(mcpJournal.some((j) => j.nom === "connecter" && j.entree.nom === "Serveur maison"), "MCP personnalisé : l’autorisation est tentée d’abord");
    await saisir('[role="dialog"] input[type=password]', JETON_MCP);
    await capture("06-mcp-sans-oauth");
    await cliquer("Ajouter", '[role="dialog"] button');
    await attendre("!document.querySelector('[role=dialog]') && document.body.innerText.includes('sans-oauth.exemple.test')");
    verifier(mcpJournal.some((j) => j.nom === "ajouter" && j.entree.app === null && j.entree.nom === "Serveur maison" && j.entree.jeton === JETON_MCP), "MCP personnalisé sans OAuth : jeton transmis une fois au pont");
    verifier(!(await ev(`document.documentElement.outerHTML.includes(${JSON.stringify(JETON_MCP)})`)), "MCP personnalisé : le jeton ne reste pas dans la page");

    await cible('[data-app-mcp="neon"] button'); await cliquer("Retirer", '[role="alertdialog"] button');
    await attendre("!document.querySelector('[data-app-mcp=\"neon\"]')?.innerText.includes('Connecté')");
    verifier(mcpJournal.some((j) => j.nom === "retirer") && !mcpListe.some((m) => m.app === "neon"), "Neon retiré après confirmation");

    verifier(await ev("document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth + 1"), "fenêtre 1100 × 700 : pas de débordement horizontal global");
    verifier(!(await ev(`document.documentElement.outerHTML.includes(${JSON.stringify(CLE_MAIN_SEULEMENT)}) || JSON.stringify(window.klyra).includes(${JSON.stringify(CLE_MAIN_SEULEMENT)})`)), "aucune clé sentinelle dans DOM ou bridge renderer");
    verifier(await ev("document.querySelectorAll('input[type=password]').length === 0"), "aucun champ de secret hors des fenêtres de connexion");
    verifier(exterieurs.length === 0, "aucune requête réseau extérieure demandée");
    verifier(erreurs.length === 0, `aucune erreur console UI (${erreurs.length})`);
    await capture("07-final");
    if (PREUVES) {
      fs.rmSync(path.join(PREUVES, "ui-echec-simulation.png"), { force: true });
      fs.writeFileSync(path.join(PREUVES, "ui-resultat-simulation.json"), JSON.stringify({
        statut: "reussi", simule: true, date: new Date().toISOString(), root: ROOT,
        build: fs.readFileSync(path.join(ROOT, ".next", "BUILD_ID"), "utf8").trim(),
        viewport: { largeur: 1100, hauteur: 700 }, nombre: total, verifications,
        erreursConsole: erreurs, requetesExterieures: exterieurs, appelsBridge: journal,
        limites: ["OAuth, projet Composio, comptes et coffre natif simulés.", "Le renderer et ses composants sont ceux du build exporté réel.", "Ce test ne prouve pas les autorisations du runtime ni la persistance native : suites séparées."],
      }, null, 2));
    }
    console.log(`${total} vérifications interface réussies ; données et OAuth simulés, vraie UI exportée.`);
    terminer(0);
  } catch (error) {
    console.error(`ÉCHEC ${error.message}`);
    if (win && !win.isDestroyed()) { console.error(await ev("document.activeElement?.outerHTML.slice(0, 2000)")); console.error((await texte()).slice(0, 4500)); await capture("echec"); }
    terminer(1);
  }
});
