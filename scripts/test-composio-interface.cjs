/**
 * Vraie UI exportée, faux bridge exclusif au test, fenêtre Electron cachée.
 * Aucun import du main productif, compte, coffre, clé ou réseau extérieur.
 *   pnpm build
 *   xvfb-run -a env -u ELECTRON_RUN_AS_NODE pnpm exec electron scripts/test-composio-interface.cjs
 * KLYRA_TEST_RUNTIME_ROOT : dépôt contenant out/ (sinon ..).
 * KLYRA_TEST_PREUVES : dossier facultatif des captures PNG marquées « Données simulées ».
 * Les résultats vérifient l'UI et ses appels au pont, pas l'OAuth ni le stockage natif.
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
  if (nom === "importer") {
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
async function actualiser() { await cliquer("Actualiser"); await attendre("![...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Actualisation…')"); }
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
  await cliquer("Connecter un service");
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
    assert.ok(fs.existsSync(path.join(OUT, "reglages.html")), "build Next absent");
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
    await win.loadURL(`${base}/reglages?section=composio`);
    await attendre("document.body.innerText.includes('Actualisation…')", "état chargement");
    verifier(await ev("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Actualisation…' && b.disabled)"), "chargement visible et actualisation désactivée");
    await capture("00-chargement");
    lectureBloquee = false; libererLecture?.();
    await attendre("document.body.innerText.includes('Composio · Pas configuré')");
    verifier((await texte()).includes("Préparer ton projet"), "profil vierge : configuration honnête sans compte fictif");
    await capture("01-vierge");
    await cliquer("Importer la clé du projet…");
    await attendre("document.body.innerText.includes('Aucun compte connecté pour ce profil')");
    verifier(journal.some((j) => j.nom === "importer"), "import simulé par IPC sans champ secret renderer");

    changer({ comptes: [account("A"), account("B"), account("Expire", "EXPIRED")], selections: { gmail: "A" }, verifieLe: Date.now() });
    await actualiser();
    verifier(await ev("document.querySelectorAll('[data-compte-composio]').length === 3"), "multi-comptes : trois états réels de la fixture affichés");
    await capture("02-comptes-1100x700");
    await rendu();
    await attendre("document.querySelector('[role=combobox]') && !document.querySelector('[role=combobox]').disabled", "choix des agents disponible");
    await ev("document.querySelector('[role=combobox]').focus()");
    await attendre("document.activeElement === document.querySelector('[role=combobox]')", "focus du choix des agents");
    await touche("Space");
    await attendre("document.querySelector('[role=combobox]')?.getAttribute('aria-expanded') === 'true'", "liste ouverte au clavier");
    await touche("Home");
    await attendre("document.getElementById(document.querySelector('[role=combobox]')?.getAttribute('aria-activedescendant'))?.innerText.includes('a@example.test')", "première option active au clavier");
    await touche("Down");
    await attendre("document.getElementById(document.querySelector('[role=combobox]')?.getAttribute('aria-activedescendant'))?.innerText.includes('b@example.test')", "seconde option active au clavier");
    await touche("Enter");
    await attendre("document.querySelector('[role=combobox]')?.innerText.includes('b@example.test')");
    verifier(fixture.selections.gmail === "B", "sélection A vers B au clavier transmise au pont");
    await cible('[role="combobox"]');
    verifier(await ev("[...document.querySelectorAll('[role=option]')].some((e) => e.innerText.includes('expire@example.test') && e.getAttribute('aria-disabled') === 'true')"), "compte expiré non sélectionnable");
    await touche("End"); await touche("Enter");
    await attendre("document.querySelector('[role=combobox]')?.innerText.includes('Aucun')");
    verifier(!fixture.selections.gmail, "Aucun efface le choix sans remplacement");
    await cible('[role="combobox"]'); await cliquer("a@example.test", '[role="option"]');
    await attendre("document.querySelector('[role=combobox]')?.innerText.includes('a@example.test')");

    changer({ comptes: [account("B")], selections: { gmail: "A" } }); await actualiser();
    verifier((await texte()).includes("le compte choisi n’est plus présent"), "compte choisi absent : avertissement sans faux connecté");
    verifier(await ev("document.querySelector('[role=combobox]')?.innerText.includes('introuvable')"), "compte disparu : référence explicite conservée, jamais présenté comme Aucun");
    await cible('[role="combobox"]');
    verifier(await ev("[...document.querySelectorAll('[role=option]')].some((e) => e.innerText.includes('introuvable') && e.getAttribute('aria-disabled') === 'true')") && fixture.selections.gmail === "A", "compte disparu désactivé dans la liste, choix backend inchangé");
    await touche("Escape");
    changer({ comptes: [account("A", "EXPIRED"), account("B")], selections: { gmail: "A" } }); await actualiser();
    verifier((await texte()).includes("Tes agents ne peuvent pas utiliser Gmail"), "compte choisi expiré : agents annoncés indisponibles");
    changer({ erreur: { code: "reseau", message: "Erreur réseau simulée" }, comptes: [], verifieLe: null }); await actualiser();
    verifier((await texte()).includes("Composio · Hors ligne") && !(await ev("document.querySelector('[data-compte-composio]') !== null")), "échec API : listes vidées et état hors ligne");
    changer({ erreur: { code: "acces", message: "Clé refusée simulée" } }); await actualiser();
    verifier(await ev("document.body.innerText.includes('Composio · Clé refusée') && [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Remplacer la clé…' && !b.disabled)"), "clé refusée : remplacement reste accessible");
    await capture("03-cle-refusee");
    changer({ erreur: null, comptes: [account("A"), account("B")], selections: { gmail: "A" }, verifieLe: Date.now() }); await actualiser();

    changer({ services: [{ ...service, configurations: [...service.configurations, { id: "auth_secondaire", nom: "Configuration secondaire", methode: "OAUTH2", active: true }] }] }); await actualiser();
    const connexionsAvantChoix = journal.filter((j) => j.nom === "connecter").length;
    await ouvrirConnexion();
    verifier(await ev("document.querySelector('[role=dialog] [role=combobox]')?.innerText.includes('Choisir une configuration…') && [...document.querySelectorAll('[role=dialog] button')].some((b) => b.innerText.trim() === 'Continuer dans le navigateur' && b.disabled)") && journal.filter((j) => j.nom === "connecter").length === connexionsAvantChoix, "plusieurs configurations actives : aucun choix par défaut, Continuer désactivé, aucun appel de connexion");
    await cible('[role="dialog"] [role="combobox"]');
    await cliquer("Configuration secondaire · OAUTH2", '[role="option"]');
    await cliquer("Continuer dans le navigateur");
    await attendre("document.body.innerText.includes('Termine la connexion dans le navigateur')");
    const connexionsApresChoix = journal.filter((j) => j.nom === "connecter");
    verifier(connexionsApresChoix.length === connexionsAvantChoix + 1 && JSON.stringify(connexionsApresChoix.at(-1).args) === JSON.stringify(["gmail", "auth_secondaire"]), "configuration choisie explicitement : seul auth_secondaire est transmis au pont pour Gmail");
    await cliquer("Fermer");
    changer({ services: [service], comptes: [account("A"), account("B")], selections: { gmail: "A" }, enAttente: [] }); await actualiser();

    await ouvrirConnexion();
    verifier(await ev("document.activeElement?.closest('[role=dialog]') !== null"), "focus placé dans la fenêtre de connexion");
    for (let i = 0; i < 9; i++) await touche("Tab");
    verifier(await ev("document.activeElement?.closest('[role=dialog]') !== null"), "Tab reste dans la fenêtre modale");
    verifier(await ev("document.querySelectorAll('[role=dialog] input[type=radio]').length === 0"), "connexion : aucune autorisation anticipée de sélectionner le compte");
    await capture("04-connexion");
    await cliquer("Continuer dans le navigateur");
    await attendre("document.body.innerText.includes('Termine la connexion dans le navigateur')");
    verifier(fixture.selections.gmail === "A", "ouverture simulée du navigateur ne confirme ni ne sélectionne le nouveau compte");
    await capture("05-attente-confirmation");
    const abandonne = pending.compteId;
    await cliquer("Fermer");
    changer({ comptes: fixture.comptes.map((c) => c.id === abandonne ? { ...c, statut: "ACTIVE" } : c), enAttente: [] });
    await actualiser();
    verifier(fixture.selections.gmail === "A", "fermer conserve le choix même si OAuth termine ensuite");

    await ouvrirConnexion(); await cliquer("Continuer dans le navigateur");
    await attendre("document.body.innerText.includes('Termine la connexion dans le navigateur')");
    const consenti = pending.compteId;
    const choixAvantConfirmation = journal.filter((j) => j.nom === "selectionner").length;
    await confirmerCompteAttendu();
    verifier(fixture.selections.gmail === "A" && journal.filter((j) => j.nom === "selectionner").length === choixAvantConfirmation, "ACTIVE relu : aucun choix automatique ni appel selectionner");
    await cible(`[data-compte-composio="${consenti}"] [data-utiliser-composio]`);
    await attendre(`document.querySelector('[role=combobox]')?.innerText.includes('${consenti}@example.test')`);
    verifier(fixture.selections.gmail === consenti, "clic explicite Utiliser pour tes agents sélectionne le compte confirmé");
    verifier(fixture.comptes.some((c) => c.id === "A"), "connexion supplémentaire conserve l'ancien compte");

    changer({ comptes: fixture.comptes.map((c) => c.id === "A" ? { ...c, statut: "EXPIRED" } : c) }); await actualiser();
    await cible('[data-compte-composio="A"] button:not([aria-label])');
    await attendre("document.querySelector('[role=dialog]')?.innerText.includes('Reconnecter Gmail')");
    verifier((await texte()).includes("Tes agents gardent le compte choisi jusqu’à ce que tu le changes."), "reconnexion : maintien du compte actuel annoncé");
    await cliquer("Continuer dans le navigateur");
    await attendre("document.body.innerText.includes('Termine la connexion dans le navigateur')");
    const reconnecte = pending.compteId;
    await confirmerCompteAttendu();
    verifier(fixture.selections.gmail === consenti && fixture.comptes.some((c) => c.id === "A"), "reconnexion confirmée : compte choisi et ancien compte conservés");
    verifier((await texte()).includes("L’ancien compte reste chez Composio."), "effet de reconnexion annoncé avec retrait séparé");
    await cible(`[data-compte-composio="${reconnecte}"] [data-utiliser-composio]`);
    await attendre(`document.querySelector('[role=combobox]')?.innerText.includes('${reconnecte}@example.test')`);
    verifier(fixture.selections.gmail === reconnecte, "reconnexion : nouveau compte choisi uniquement après clic explicite");

    const menu = `[data-compte-composio="${reconnecte}"] button[aria-label]`;
    await cible(menu); await cliquer("Déconnecter…", '[role="menuitem"]', true);
    await attendre("document.querySelector('[role=alertdialog]')");
    verifier(!journal.some((j) => j.nom === "deconnecter"), "déconnexion : aucune mutation avant confirmation");
    verifier((await texte()).includes("ni tes agents ni aucun autre outil qui l’utilise"), "confirmation : effet sur tous les consommateurs de la connexion annoncé");
    await capture("06-deconnexion-confirmation");
    verifier(await ev("document.activeElement?.closest('[role=alertdialog]') !== null"), "confirmation : focus dans la fenêtre avant Échap");
    await touche("Escape");
    await attendre("!document.querySelector('[role=alertdialog]')");
    verifier(fixture.comptes.some((c) => c.id === reconnecte), "Échap annule la déconnexion");
    echecDeconnexion = "distante";
    await cible(menu); await cliquer("Déconnecter…", '[role="menuitem"]', true); await cliquer("Déconnecter", '[role="alertdialog"] button');
    await attendre("document.querySelector('[role=combobox]')?.innerText.trim() === 'Aucun' && document.body.innerText.includes('Déconnexion…')");
    verifier(!fixture.selections.gmail && fixture.comptes.some((c) => c.id === reconnecte), "déconnexion en cours : Aucun avant la réponse, ligne conservée");
    libererDeconnexion();
    await attendre(`document.querySelector('[data-compte-composio="${reconnecte}"]')?.innerText.includes('Tes agents n’utilisent déjà plus ce compte.')`);
    verifier(await ev("document.querySelector('[role=combobox]')?.innerText.trim() === 'Aucun'") && !(await texte()).includes("Connexion retirée chez Composio."), "suppression refusée : erreur sous la ligne, Aucun conservé, aucun faux succès");
    await cible(menu); await cliquer("Déconnecter…", '[role="menuitem"]', true);
    const comptesAvantPanne = clone(fixture.comptes);
    echecDeconnexion = "horsligne";
    await cliquer("Déconnecter", '[role="alertdialog"] button');
    await attendre("document.body.innerText.includes('Déconnexion…')");
    libererDeconnexion();
    await attendre("document.body.innerText.includes('Déconnexion à vérifier')");
    verifier((await texte()).includes(`${reconnecte}@example.test`) && (await texte()).includes("État non vérifié") && (await texte()).includes("Tes agents n’utilisent déjà plus ce compte."), "panne persistante : compte en échec conservé avec état non vérifié, sans ancien statut connecté");
    verifier(await ev("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Déconnecter…' && !b.disabled)"), "panne persistante : action de déconnexion disponible pour réessayer");
    await capture("06b-deconnexion-echec");
    echecDeconnexion = null;
    changer({ comptes: comptesAvantPanne, erreur: null, verifieLe: Date.now() }); await actualiser();
    await cible(menu); await cliquer("Déconnecter…", '[role="menuitem"]', true); await cliquer("Déconnecter", '[role="alertdialog"] button');
    await attendre(`!document.querySelector('[data-compte-composio="${reconnecte}"]')`);
    verifier(!fixture.selections.gmail && journal.filter((j) => j.nom === "deconnecter").length === 3, "déconnexion réessayée : un appel par confirmation, compte retiré, choix Aucun");

    await ev("document.querySelector('[role=combobox]').scrollIntoView({block:'center'})");
    verifier(await ev("document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth + 1"), "fenêtre 1100 × 700 : pas de débordement horizontal global");
    verifier(!(await ev(`document.documentElement.outerHTML.includes(${JSON.stringify(CLE_MAIN_SEULEMENT)}) || JSON.stringify(window.klyra).includes(${JSON.stringify(CLE_MAIN_SEULEMENT)})`)), "aucune clé sentinelle dans DOM ou bridge renderer");
    verifier(await ev("document.querySelectorAll('input[type=password]').length === 0"), "aucun champ de secret dans l'interface");
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
