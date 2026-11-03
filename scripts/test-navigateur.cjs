/**
 * Le navigateur de KLYRA de bout en bout, dans Electron, sur un dossier d'app
 * temporaire et une page servie en local :
 *   pnpm build:electron && pnpm test:navigateur      (Linux : xvfb-run -a … -- --no-sandbox)
 * - lecture d'une page (références eN, titres, valeurs), frappe, liste, clic
 *   « de confiance », Entrée qui soumet un formulaire, capture ;
 * - jamais de mot de passe, seulement http(s), onglets d'une conversation
 *   invisibles pour une autre, fenêtre ouverte par la page = onglet ;
 * - prise de main par la personne, main passée par l'agent ;
 * - téléchargement, affichage dans la fenêtre, onglets gardés sur le disque ;
 * - réglage coupé : plus d'outils, ni dans tools/list du serveur MCP de l'app.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app, BrowserWindow, safeStorage } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-navigateur-"));
app.setPath("userData", path.join(TMP, "donnees"));
app.setPath("sessionData", path.join(TMP, "session"));
app.setPath("downloads", path.join(TMP, "telechargements"));
// Sous Linux sans trousseau : le chiffrement de base de Chromium, pour essayer le coffre (l'app installée garde celui du système).
if (process.platform === "linux") app.commandLine.appendSwitch("password-store", "basic");
fs.mkdirSync(app.getPath("userData"), { recursive: true });
fs.mkdirSync(app.getPath("downloads"), { recursive: true });

const echecs = [];
const verifier = (ok, message, detail) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}${!ok && detail ? `\n       ${String(detail).slice(0, 600).replace(/\n/g, "\n       ")}` : ""}`);
  if (!ok) echecs.push(message);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><meta charset="utf-8"><title>Contact KLYRA</title>
<body style="font:16px sans-serif">
<h1>Écrivez-nous</h1>
<form action="/merci" method="get">
  <label>Nom <input name="nom" id="nom"></label>
  <label>Mot de passe <input type="password" name="mdp" id="mdp"></label>
  <label>Sujet <select name="sujet" id="sujet"><option value="a">Devis</option><option value="b">Support</option></select></label>
  <button type="button" id="b" onclick="window.clics=(window.clics||0)+1;window.confiance=event.isTrusted">Compter</button>
  <button type="submit">Envoyer</button>
</form>
<a href="/fichier.txt" download>Télécharger le devis</a>
<a href="/autre" target="_blank">Ouvrir ailleurs</a>
<div style="height:3000px"></div><p>Bas de page</p>
</body>`;

const CADRE = `<!doctype html><meta charset="utf-8"><title>Cadre</title><body>
<input id="ville" placeholder="Ville"><button onclick="window.parent.postMessage('clic-cadre','*')">Valider dans le cadre</button></body>`;
const autre = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(CADRE);
});

const ENVOI = (port) => `<!doctype html><meta charset="utf-8"><title>Envoi</title><body>
<iframe id="ifr" src="http://localhost:${port}/" style="width:500px;height:120px;border:0"></iframe>
<label>Pièce <input type="file" id="f" multiple></label>
<input type="file" id="cache" style="display:none"><button id="joindre" onclick="document.getElementById('cache').click()">Joindre</button>
<form action="/connecte" method="get"><input type="email" name="email" placeholder="E-mail"><input type="password" name="mdp" id="mdpc"><button type="submit">Se connecter</button></form>
<a href="/autre" id="lien">Un lien</a>
<script>window.addEventListener("message", (e) => { if (e.data === "clic-cadre") window.clicCadre = true; });</script>
</body>`;

const serveur = http.createServer((req, res) => {
  if (req.url.startsWith("/fichier.txt")) {
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename="devis.txt"' });
    return res.end("devis KLYRA");
  }
  if (req.url.startsWith("/merci")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Merci</title><p>Message reçu de ${new URL(req.url, "http://x").searchParams.get("nom")}</p>`);
  }
  if (req.url.startsWith("/envoi")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(ENVOI(autre.address().port));
  }
  if (req.url.startsWith("/connecte")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    const q = new URL(req.url, "http://x").searchParams;
    return res.end(`<!doctype html><meta charset="utf-8"><title>Connecté</title><p>Connecté ${q.get("email")} ${q.get("mdp") === "s3cret!" ? "mot de passe juste" : "mot de passe faux"}</p>`);
  }
  if (req.url.startsWith("/autre")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Autre page</title><p>Autre</p>`);
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE);
});

app.whenReady().then(async () => {
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  await new Promise((r) => autre.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const dist = path.join(__dirname, "..", "dist-electron");
  const nav = require(path.join(dist, "navigateur", "navigateur.js"));
  const { executerOutilNavigateur } = require(path.join(dist, "navigateur", "outils.js"));
  const reglages = require(path.join(dist, "reglages.js"));
  const ia = require(path.join(dist, "ia.js"));

  const win = new BrowserWindow({ width: 1200, height: 800, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL("data:text/html,<title>KLYRA</title><body>app</body>");
  const etats = [];
  const menus = [];
  nav.brancherNavigateur({ fenetre: () => win, signaler: (e) => etats.push(e), menu: (id, m) => menus.push({ id, m }) });
  const coffre = require(path.join(dist, "navigateur", "coffre.js"));
  if (process.platform === "linux" && !safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption?.(true);

  const A = { chatId: "chat-a", roleId: "principal" };
  const B = { chatId: "chat-b", roleId: "dev" };
  const outil = (nom, args, qui = A) => executerOutilNavigateur(nom, args, qui);
  const texteDe = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const refDe = (t, motif) => (t.split("\n").find((l) => motif.test(l)) ?? "").match(/\[((?:c\d+)?e\d+)\]/)?.[1];

  try {
    /* Ouvrir et lire. */
    let r = await outil("navigateur_aller", { url: base });
    let t = texteDe(r);
    verifier(!r.isError && /Page : Contact KLYRA/.test(t), "la page s'ouvre et se lit", t);
    verifier(/# Écrivez-nous/.test(t) && /bouton « Envoyer »/.test(t) && /champ « Nom »/.test(t), "éléments et titres listés avec leur rôle", t);
    verifier(/champ mot de passe « Mot de passe »/.test(t), "le mot de passe est reconnu", t);
    const id = t.match(/Onglet (nav-[\w-]+)/)?.[1];
    verifier(!!id, "l'onglet a un identifiant", t);
    const page = nav.contenuDe(id);
    const valeur = (js) => page.executeJavaScript(js);

    /* Taper, choisir, cliquer. */
    r = await outil("navigateur_agir", { action: "taper", ref: refDe(t, /champ « Nom »/), texte: "Corentin" });
    verifier(!r.isError && (await valeur("document.getElementById('nom').value")) === "Corentin", "la frappe arrive dans le champ", texteDe(r));
    r = await outil("navigateur_agir", { action: "taper", ref: refDe(t, /Nom/), texte: "Pelin", effacer: true });
    verifier((await valeur("document.getElementById('nom').value")) === "Pelin", "effacer remplace le texte", texteDe(r));
    r = await outil("navigateur_agir", { action: "taper", ref: refDe(t, /mot de passe/), texte: "secret" });
    verifier(r.isError && /Champ protégé/.test(texteDe(r)) && (await valeur("document.getElementById('mdp').value")) === "", "jamais de mot de passe tapé par l'agent", texteDe(r));
    r = await outil("navigateur_agir", { action: "choisir", ref: refDe(t, /liste « Sujet »/), valeur: "Support" });
    verifier(!r.isError && (await valeur("document.getElementById('sujet').value")) === "b", "une option choisie dans une liste", texteDe(r));
    r = await outil("navigateur_agir", { action: "cliquer", ref: refDe(t, /bouton « Compter »/) });
    verifier(!r.isError && (await valeur("window.clics")) === 1 && (await valeur("window.confiance")) === true, "le clic est reçu, comme un vrai clic (isTrusted)", texteDe(r));

    /* Défiler, capturer. */
    r = await outil("navigateur_agir", { action: "defiler", direction: "bas", quantite: 800 });
    verifier(!r.isError && (await valeur("scrollY")) > 0, "la page défile", texteDe(r));
    r = await outil("navigateur_capture", {});
    const image = r.content.find((c) => c.type === "image");
    verifier(!r.isError && image && image.mimeType === "image/jpeg" && image.data.length > 2000, "la capture rend une image", texteDe(r));

    /* Entrée soumet le formulaire. */
    r = await outil("navigateur_agir", { action: "taper", ref: refDe(t, /Nom/), texte: "Yanis", effacer: true, entree: true });
    await pause(300);
    verifier(/\/merci\?nom=Yanis/.test(page.getURL()), "Entrée soumet le formulaire", `${page.getURL()}\n${texteDe(r)}`);
    r = await outil("navigateur_lire", { mode: "texte" });
    verifier(/Message reçu de Yanis/.test(texteDe(r)), "le texte de la page suivante se lit", texteDe(r));
    r = await outil("navigateur_aller", { historique: "retour" });
    verifier(/Contact KLYRA/.test(texteDe(r)), "retour en arrière", texteDe(r));
    t = texteDe(r);

    /* Une fenêtre ouverte par la page devient un onglet de la conversation ; un téléchargement est gardé. */
    r = await outil("navigateur_agir", { action: "cliquer", ref: refDe(t, /Ouvrir ailleurs/) });
    await pause(500);
    const ongletsA = nav.ongletsDe("chat-a");
    verifier(ongletsA.length === 2 && /\/autre$/.test(ongletsA[1].url), "target=_blank ouvre un onglet dans la même conversation", texteDe(r));
    r = await outil("navigateur_agir", { action: "cliquer", ref: refDe(t, /Télécharger/), onglet: id });
    const limite = Date.now() + 5000;
    while (Date.now() < limite && !fs.existsSync(path.join(app.getPath("downloads"), "devis.txt"))) await pause(100);
    await pause(200);
    const ongletA = nav.etatNavigateur().find((o) => o.id === id);
    verifier(
      fs.existsSync(path.join(app.getPath("downloads"), "devis.txt")) && ongletA.telechargements[0]?.etat === "fini",
      "le téléchargement arrive dans Téléchargements et sur l'onglet",
      JSON.stringify(ongletA.telechargements),
    );

    /* Ce qui est refusé. */
    r = await outil("navigateur_aller", { url: "file:///etc/passwd", onglet: id });
    verifier(r.isError && /pages web/.test(texteDe(r)), "file:// refusé", texteDe(r));
    r = await outil("navigateur_lire", { onglet: id }, B);
    verifier(r.isError && /Aucun onglet/.test(texteDe(r)), "une autre conversation ne voit pas ces onglets", texteDe(r));
    r = await outil("navigateur_onglets", {}, B);
    verifier(/Aucun onglet/.test(texteDe(r)), "…ni dans sa liste", texteDe(r));

    /* La main. */
    nav.prendreLaMain(id, true);
    r = await outil("navigateur_agir", { action: "cliquer", ref: "e1", onglet: id });
    verifier(r.isError && /repris la main/.test(texteDe(r)), "la personne a la main : l'agent n'agit pas", texteDe(r));
    r = await outil("navigateur_lire", { onglet: id });
    verifier(!r.isError, "…mais il peut lire", texteDe(r));
    nav.prendreLaMain(id, false);
    r = await outil("navigateur_agir", { action: "passer_la_main", raison: "connecte-toi", onglet: id });
    const passe = nav.etatNavigateur().find((o) => o.id === id).main;
    verifier(!r.isError && passe?.type === "demandee" && passe.raison === "connecte-toi", "l'agent passe la main", texteDe(r));
    r = await outil("navigateur_agir", { action: "touche", touche: "Tab", onglet: id });
    verifier(r.isError && /passé la main/.test(texteDe(r)), "…et attend qu'on la lui rende", texteDe(r));
    nav.prendreLaMain(id, false);

    /* À l'écran. */
    nav.afficherOnglet(id, { x: 700, y: 100, width: 400, height: 500 });
    const vue = win.contentView.children.find((v) => v.webContents === page);
    const b = vue?.getBounds();
    verifier(vue?.getVisible() && b.x === 700 && b.width === 400, "l'onglet se pose dans le cadre demandé", JSON.stringify(b));
    nav.afficherOnglet(null, null);
    verifier(!vue.getVisible(), "…et disparaît quand l'écran le demande");
    await pause(1500);
    verifier(!!nav.etatNavigateur().find((o) => o.id === id).vignette?.startsWith("data:image/jpeg"), "une vignette existe pour l'aperçu des onglets");

    /* Un cadre d'une autre origine : lu, visé, tapé. */
    r = await outil("navigateur_aller", { url: `${base}/envoi`, nouvel_onglet: true });
    t = texteDe(r);
    const idEnvoi = t.match(/Onglet (nav-[\w-]+)/)?.[1];
    const pageEnvoi = nav.contenuDe(idEnvoi);
    verifier(/Cadre c1 \(localhost:\d+\)/.test(t) && /\[c1e\d+\] bouton « Valider dans le cadre »/.test(t), "un cadre d'une autre origine est lu, avec ses références", t);
    r = await outil("navigateur_agir", { action: "taper", ref: refDe(t, /\[c1e\d+\] champ « Ville »/), texte: "Lyon" });
    const cadre = pageEnvoi.mainFrame.frames[0];
    verifier(!r.isError && (await cadre.executeJavaScript("document.getElementById('ville').value")) === "Lyon", "la frappe arrive dans le champ du cadre", texteDe(r));
    r = await outil("navigateur_agir", { action: "cliquer", ref: refDe(t, /\[c1e\d+\] bouton/) });
    await pause(200);
    verifier(!r.isError && (await pageEnvoi.executeJavaScript("window.clicCadre === true")), "le clic arrive au bouton du cadre", texteDe(r));

    /* Envoyer des fichiers : au champ, puis par un bouton qui ouvre le choix (intercepté). */
    const f1 = path.join(TMP, "devis.pdf");
    const f2 = path.join(TMP, "photo.png");
    fs.writeFileSync(f1, "%PDF-1.4 essai");
    fs.writeFileSync(f2, "png");
    r = await outil("navigateur_agir", { action: "envoyer_fichiers", ref: refDe(t, /fichier « Pièce »/), chemins: [f1, f2] });
    verifier(!r.isError && (await pageEnvoi.executeJavaScript("[...document.getElementById('f').files].map((x) => x.name).join(',')")) === "devis.pdf,photo.png", "des fichiers donnés au champ « fichier »", texteDe(r));
    r = await outil("navigateur_agir", { action: "envoyer_fichiers", ref: refDe(t, /bouton « Joindre »/), chemins: [f1] });
    verifier(!r.isError && (await pageEnvoi.executeJavaScript("document.getElementById('cache').files[0]?.name")) === "devis.pdf", "un bouton qui ouvre le choix de fichiers : choix intercepté et rempli", texteDe(r));
    r = await outil("navigateur_agir", { action: "envoyer_fichiers", ref: refDe(t, /fichier « Pièce »/), chemins: ["relatif.txt"] });
    verifier(r.isError && /chemin complet/.test(texteDe(r)), "un chemin relatif est refusé", texteDe(r));

    /* Le coffre : l'agent remplit la connexion sans voir le mot de passe. */
    r = await outil("navigateur_agir", { action: "remplir_connexion" });
    verifier(r.isError && /Aucune connexion enregistrée/.test(texteDe(r)), "sans connexion dans le coffre : l'agent est invité à passer la main", texteDe(r));
    let chiffrement = true;
    try {
      await coffre.ajouterAuCoffre({ site: "127.0.0.1", identifiant: "pelin@klyra.fr", motDePasse: "s3cret!", agents: true });
    } catch (e) {
      chiffrement = false;
      console.log(`       (coffre non testé : ${e.message})`);
    }
    if (chiffrement) {
      const disque = fs.readFileSync(path.join(app.getPath("userData"), "coffre-navigateur.json"), "utf8");
      verifier(!disque.includes("s3cret!") && coffre.listerCoffre().every((c) => !("motDePasse" in c)), "le mot de passe est chiffré sur le disque et ne sort pas du coffre");
      r = await outil("navigateur_lire", {});
      verifier(/Coffre : une connexion enregistrée pour 127\.0\.0\.1 \(pelin@klyra\.fr\)/.test(texteDe(r)), "la lecture signale la connexion du coffre (identifiant seulement)", texteDe(r));
      r = await outil("navigateur_agir", { action: "remplir_connexion", valider: true });
      await pause(800);
      const apres = await outil("navigateur_lire", { mode: "texte" });
      verifier(!r.isError && !texteDe(r).includes("s3cret!") && /Connecté pelin@klyra\.fr mot de passe juste/.test(texteDe(apres)), "remplir_connexion connecte, sans montrer le mot de passe", `${texteDe(r)}\n${texteDe(apres)}`);
      const [entree] = coffre.listerCoffre();
      await coffre.changerAgentsCoffre(entree.id, false);
      await outil("navigateur_aller", { historique: "retour" });
      r = await outil("navigateur_agir", { action: "remplir_connexion" });
      verifier(r.isError, "une connexion que la personne n'a pas permise aux agents leur est refusée", texteDe(r));
      await coffre.retirerDuCoffre(entree.id);
    }

    /* Le clic droit de la personne : le menu de l'app, avec le lien. */
    await outil("navigateur_aller", { url: `${base}/envoi`, onglet: idEnvoi });
    nav.afficherOnglet(idEnvoi, { x: 0, y: 0, width: 900, height: 700 });
    await pause(13_000); // l'agent ne pilote plus (sinon son clic droit n'ouvre pas de menu)
    const pos = await pageEnvoi.executeJavaScript("(() => { const r = document.getElementById('lien').getBoundingClientRect(); return { x: Math.round(r.x + 5), y: Math.round(r.y + 5) }; })()");
    pageEnvoi.sendInputEvent({ type: "mouseDown", x: pos.x, y: pos.y, button: "right", clickCount: 1 });
    pageEnvoi.sendInputEvent({ type: "mouseUp", x: pos.x, y: pos.y, button: "right", clickCount: 1 });
    await pause(1000);
    const menu = menus.find((m) => m.id === idEnvoi);
    verifier(!!menu && /\/autre$/.test(menu.m.lien ?? ""), "un clic droit de la personne ouvre le menu de l'app, avec le lien", JSON.stringify(menus));
    if (menu) {
      await nav.actionMenu(idEnvoi, "lien-onglet");
      verifier(nav.ongletsDe("chat-a").some((o) => /\/autre$/.test(o.url) && o.id !== idEnvoi), "« Ouvrir le lien dans un nouvel onglet » ouvre l'onglet dans la conversation");
      await nav.actionMenu(idEnvoi, "copier").then(() => verifier(false, "une action d'un menu déjà servi est refusée"), () => verifier(true, "une action d'un menu déjà servi est refusée"));
    }
    nav.afficherOnglet(null, null);
    for (const o of nav.ongletsDe("chat-a")) if (o.id !== id && !/\/autre$/.test(o.url)) nav.fermerOnglet(o.id);
    for (const o of nav.ongletsDe("chat-a").filter((x) => /\/autre$/.test(x.url)).slice(1)) nav.fermerOnglet(o.id);

    /* Le réglage et le serveur MCP de l'app. */
    await ia.demarrerServeurMcp();
    const config = JSON.parse(ia.configMcp({ chatId: "chat-a", roleId: "principal" })).mcpServers.klyra;
    const appel = async (method, params = {}) => {
      const rep = await fetch(config.url, { method: "POST", headers: { ...config.headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return (await rep.json()).result;
    };
    let liste = await appel("tools/list");
    verifier(liste.tools.some((o) => o.name === "navigateur_agir"), "réglage allumé : les agents ont les outils");
    r = await appel("tools/call", { name: "navigateur_onglets", arguments: {} });
    verifier(/Contact KLYRA|Autre page/.test(r.content[0].text), "un outil appelé par le serveur MCP voit les onglets de sa conversation", r.content[0].text);
    verifier(ia.OUTILS_APP().includes("mcp__klyra__navigateur_lire") && !ia.OUTILS_APP().includes("mcp__klyra__navigateur_agir"), "accès « projet » : lire sans demander, agir sur accord");
    await reglages.ecrireReglages({ ...reglages.lireReglages(), navigateur: { agents: false } });
    liste = await appel("tools/list");
    r = await outil("navigateur_lire", { onglet: id });
    verifier(!liste.tools.some((o) => o.name.startsWith("navigateur_")) && r.isError, "réglage coupé : plus d'outils", texteDe(r));
    await reglages.ecrireReglages({ ...reglages.lireReglages(), navigateur: { agents: true } });

    /* Un agent d'un VPS : l'appel passe par le vrai serveur KLYRA (journal, route, relais) jusqu'au navigateur de ce PC. */
    const { pathToFileURL } = require("node:url");
    const srv = await import(pathToFileURL(path.join(__dirname, "..", "serveur", "klyra-serveur.mjs")).href);
    const { creerRelaisNavigateur } = await import(pathToFileURL(path.join(__dirname, "..", "serveur", "navigateur.mjs")).href);
    const dossierVps = path.join(TMP, "vps");
    fs.mkdirSync(dossierVps, { recursive: true });
    const journal = srv.creerJournal();
    const relais = creerRelaisNavigateur({ publier: journal.publier, ecouteurs: journal.ecouteurs });
    const ecoute = await srv.ecouter({ dossier: dossierVps, port: 0, journal, agents: { navigateur: relais, fermerTout: () => undefined } });
    const origine = `http://127.0.0.1:${ecoute.port}`;
    try {
      r = await relais.appeler({ agent: "principal", conversation: "chat-vps" }, "navigateur_lire", {});
      verifier(r.isError && /pas ouverte/.test(r.content[0].text), "VPS : sans PC à l'écoute, l'outil le dit tout de suite", r.content[0].text);
      const appaire = await fetch(`${origine}${srv.CHEMIN_APPAIRER}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: srv.creerCode(dossierVps), appareil: "PC de test" }) }).then((x) => x.json());
      fs.writeFileSync(path.join(app.getPath("userData"), "conversations.json"), JSON.stringify({ version: 1, chats: [{ id: "chat-vps", kind: "direct", roleIds: ["principal"], lieu: origine }, { id: "chat-a", kind: "direct", roleIds: ["principal"] }], messages: [], projects: [] }));
      const distants = require(path.join(dist, "agents-distants.js"));
      const { executerPourServeur } = require(path.join(dist, "navigateur", "outils.js"));
      distants.brancherAgentsDistants(
        {
          fenetre: () => ({ evenement: () => undefined, spontane: () => undefined, rendu: () => undefined }),
          equipe: () => ({ fiches: [], assistant: null, configuration: { memoireAgents: true, consignes: null, navigateur: true }, empreinte: "test" }),
          jeton: () => appaire.jeton,
          navigateur: (o, appel) => executerPourServeur(o, appel),
        },
        [origine],
      );
      for (let i = 0; i < 50 && !journal.ecouteurs(); i++) await pause(100);
      r = await relais.appeler({ agent: "principal", conversation: "chat-vps" }, "navigateur_aller", { url: base });
      verifier(!r.isError && /Page : Contact KLYRA/.test(r.content[0].text) && nav.ongletsDe("chat-vps").length === 1, "VPS : l'agent ouvre et lit une page dans le navigateur de ce PC, dans l'onglet de sa conversation", r.content.map((c) => c.text).join("\n"));
      r = await relais.appeler({ agent: "principal", conversation: "chat-vps" }, "navigateur_capture", {});
      verifier(!r.isError && r.content.some((c) => c.type === "image" && c.data.length > 2000), "VPS : la capture revient en image", JSON.stringify(r).slice(0, 200));
      r = await relais.appeler({ agent: "principal", conversation: "chat-a" }, "navigateur_onglets", {});
      verifier(r.isError && /pas une conversation de ce serveur/.test(r.content[0].text), "VPS : une conversation de ce PC lui est refusée", r.content[0].text);
      distants.oublierServeur(origine);
      for (const o of nav.ongletsDe("chat-vps")) nav.fermerOnglet(o.id);
    } finally {
      journal.fermerTout();
      await ecoute.fermer();
    }

    /* Gardés sur le disque. */
    await pause(1200);
    const garde = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "navigateur.json"), "utf8"));
    verifier(garde.onglets.length === 2 && garde.onglets.every((o) => o.chatId === "chat-a" && !("vignette" in o)), "les onglets sont gardés sur le disque, sans vignette", JSON.stringify(garde));
    nav.fermerOnglet(id);
    verifier(nav.ongletsDe("chat-a").length === 1 && !nav.contenuDe(id), "fermer un onglet libère sa page");
    verifier(etats.length > 0, "l'écran reçoit l'état des onglets");
  } catch (e) {
    verifier(false, "le test s'est déroulé sans exception", e && e.stack);
  }

  console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nNAVIGATEUR : TOUT PASSE");
  serveur.close();
  autre.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  app.exit(echecs.length ? 1 : 0);
});
