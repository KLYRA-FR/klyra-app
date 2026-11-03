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
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-navigateur-"));
app.setPath("userData", path.join(TMP, "donnees"));
app.setPath("sessionData", path.join(TMP, "session"));
app.setPath("downloads", path.join(TMP, "telechargements"));
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

const serveur = http.createServer((req, res) => {
  if (req.url.startsWith("/fichier.txt")) {
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename="devis.txt"' });
    return res.end("devis KLYRA");
  }
  if (req.url.startsWith("/merci")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Merci</title><p>Message reçu de ${new URL(req.url, "http://x").searchParams.get("nom")}</p>`);
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
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const dist = path.join(__dirname, "..", "dist-electron");
  const nav = require(path.join(dist, "navigateur", "navigateur.js"));
  const { executerOutilNavigateur } = require(path.join(dist, "navigateur", "outils.js"));
  const reglages = require(path.join(dist, "reglages.js"));
  const ia = require(path.join(dist, "ia.js"));

  const win = new BrowserWindow({ width: 1200, height: 800, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL("data:text/html,<title>KLYRA</title><body>app</body>");
  const etats = [];
  nav.brancherNavigateur({ fenetre: () => win, signaler: (e) => etats.push(e) });

  const A = { chatId: "chat-a", roleId: "principal" };
  const B = { chatId: "chat-b", roleId: "dev" };
  const outil = (nom, args, qui = A) => executerOutilNavigateur(nom, args, qui);
  const texteDe = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const refDe = (t, motif) => (t.split("\n").find((l) => motif.test(l)) ?? "").match(/\[(e\d+)\]/)?.[1];

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
  fs.rmSync(TMP, { recursive: true, force: true });
  app.exit(echecs.length ? 1 : 0);
});
