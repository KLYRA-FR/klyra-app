/**
 * Le navigateur de KLYRA dans le Chrome de ce poste (Réglages › Navigateur › « Chrome de ce poste »),
 * de bout en bout, dans Electron, sur un dossier d'app temporaire et des pages servies en local :
 *   pnpm build:electron && KLYRA_CHROME_PATH=/chemin/vers/chrome pnpm test:navigateur-chrome
 *   (Linux : xvfb-run -a … -- --no-sandbox ; sans Chrome trouvé, le test le dit et s'arrête)
 * - l'agent ouvre, lit, tape, clique « de confiance » et capture dans un onglet de Chrome ;
 * - une fenêtre ouverte par la page garde son lien avec elle (connexions « Se connecter avec… ») ;
 * - un cadre d'un autre site se lit ; un téléchargement arrive dans Téléchargements ;
 * - la personne se connecte dans un Chrome sans pilotage (`navigator.webdriver` faux), l'agent attend,
 *   puis reprend la session qu'elle a ouverte (le cookie posé pendant sa connexion).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-navigateur-chrome-"));
app.setPath("userData", path.join(TMP, "donnees"));
app.setPath("sessionData", path.join(TMP, "session"));
app.setPath("downloads", path.join(TMP, "telechargements"));
fs.mkdirSync(app.getPath("userData"), { recursive: true });
fs.mkdirSync(app.getPath("downloads"), { recursive: true });

const echecs = [];
const verifier = (ok, message, detail) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}${!ok && detail ? `\n       ${String(detail).slice(0, 700).replace(/\n/g, "\n       ")}` : ""}`);
  if (!ok) echecs.push(message);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendre(condition, ms = 10_000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condition()) return true;
    await pause(150);
  }
  return false;
}

/* Les pages. `/connexion` pose un cookie neuf et dit si le navigateur se déclare piloté. */
const webdriver = [];
const cookiesPoses = [];
const CADRE = `<!doctype html><meta charset="utf-8"><title>Cadre</title><body><input id="ville" placeholder="Ville"></body>`;
const autre = http.createServer((_q, r) => {
  r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  r.end(CADRE);
});
const serveur = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const html = (corps) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8">${corps}`);
  };
  if (u.pathname === "/wd") {
    webdriver.push(u.searchParams.get("v"));
    res.end();
    return;
  }
  /* L'accueil de la connexion : il dit s'il est piloté ; sans pilotage, il « connecte » (comme la personne le ferait). */
  if (u.pathname === "/accueil-connexion") return html(`<title>Accueil connexion</title><p>Se connecter</p><script>fetch('/wd?v=' + navigator.webdriver).then(() => { if (!navigator.webdriver) location.href = '/connexion'; })</script>`);
  if (u.pathname === "/connexion") {
    const valeur = `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    cookiesPoses.push(valeur);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": `session=${valeur}; Max-Age=86400; Path=/; SameSite=Lax` });
    res.end(`<!doctype html><meta charset="utf-8"><title>Connexion</title><p>Connecté</p>`);
    return;
  }
  if (u.pathname === "/moi") return html(`<title>Moi</title><p>Cookie : ${(req.headers.cookie || "aucun").replace(/[<>&]/g, "")}</p>`);
  if (u.pathname === "/pop") return html(`<title>Fenêtre</title><p>Fenêtre ouverte</p><script>if (window.opener) window.opener.postMessage("lien-ok", "*")</script>`);
  /* Les variables de la page ne se voient pas du monde isolé : ce qu'on vérifie est écrit dans le DOM. */
  if (u.pathname === "/fichier.txt") {
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename="devis.txt"' });
    res.end("devis KLYRA");
    return;
  }
  if (u.pathname === "/cadre") return html(`<title>Avec cadre</title><iframe src="http://localhost:${autre.address().port}/" style="width:400px;height:100px;border:0"></iframe>`);
  html(`<title>Contact KLYRA</title>
<h1>Écrivez-nous</h1>
<label>Nom <input id="nom"></label>
<button type="button" id="b" onclick="this.dataset.clics=(+this.dataset.clics||0)+1;this.dataset.confiance=event.isTrusted">Compter</button>
<button type="button" id="ouvrir" onclick="window.open('/pop')">Se connecter avec un compte</button>
<a href="/fichier.txt" download>Télécharger le devis</a>
<script>window.addEventListener("message", (e) => { if (e.data === "lien-ok") document.body.dataset.lien = "ok"; });</script>`);
});

app.whenReady().then(async () => {
  const chrome = process.env.KLYRA_CHROME_PATH;
  if (!chrome || !fs.existsSync(chrome)) {
    console.log("Chrome introuvable : donne son chemin dans KLYRA_CHROME_PATH. Test sauté.");
    app.exit(process.env.CI ? 1 : 0);
    return;
  }
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  await new Promise((r) => autre.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const dist = path.join(__dirname, "..", "dist-electron");
  const reglages = require(path.join(dist, "reglages.js"));
  await reglages.ecrireReglages({ ...reglages.lireReglages(), navigateur: { agents: true, moteur: "chrome" } });
  const nav = require(path.join(dist, "navigateur", "navigateur.js"));
  const poste = require(path.join(dist, "navigateur", "chrome-poste.js"));
  const { executerOutilNavigateur } = require(path.join(dist, "navigateur", "outils.js"));

  const win = new BrowserWindow({ width: 900, height: 700, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL("data:text/html,<title>KLYRA</title><body>app</body>");
  nav.brancherNavigateur({ fenetre: () => win, signaler: () => undefined });

  const A = { chatId: "chat-a", roleId: "principal" };
  const outil = (nom, args) => executerOutilNavigateur(nom, args, A);
  const texteDe = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const refDe = (t, motif) => (t.split("\n").find((l) => motif.test(l)) ?? "").match(/\[((?:c\d+)?e\d+)\]/)?.[1];

  try {
    /* Ouvrir et lire, dans un onglet de Chrome. */
    let r = await outil("navigateur_aller", { url: base });
    let t = texteDe(r);
    verifier(!r.isError && /Page : Contact KLYRA/.test(t), "l'agent ouvre et lit une page dans Chrome", t);
    const id = t.match(/Onglet (nav-[\w-]+)/)?.[1];
    const onglet = () => nav.etatNavigateur().find((o) => o.id === id);
    verifier(onglet()?.moteur === "chrome" && poste.modeChrome() === "agent", "l'onglet vit dans Chrome, ouvert pour les agents", JSON.stringify(onglet()));

    r = await outil("navigateur_agir", { action: "taper", ref: refDe(t, /champ « Nom »/), texte: "Corentin" });
    r = await outil("navigateur_lire", { mode: "texte" });
    r = await outil("navigateur_agir", { action: "cliquer", ref: refDe(t, /bouton « Compter »/) });
    const etat = await outil("navigateur_lire", {});
    verifier(!r.isError, "le clic part sans erreur", texteDe(r));

    /* Fenêtre ouverte par la page : un onglet de la conversation, qui garde son lien avec la page. */
    r = await outil("navigateur_agir", { action: "cliquer", ref: refDe(t, /Se connecter avec un compte/), onglet: id });
    const ouverte = await attendre(() => nav.ongletsDe("chat-a").length === 2, 8_000);
    verifier(ouverte && nav.ongletsDe("chat-a")[1].moteur === "chrome", "une fenêtre ouverte par la page devient un onglet de la conversation", texteDe(r));
    r = await outil("navigateur_lire", { mode: "texte", onglet: id, attendre_texte: "Contact" });
    const lien = await attendre(async () => {
      const pg = await nav.pageDeLAgent(nav.ongletPourAgent("chat-a", id), "principal", "test", false);
      return pg.script("document.body.dataset.lien === 'ok'");
    }, 8_000);
    verifier(lien, "la fenêtre ouverte a gardé son lien avec la page (window.opener)", JSON.stringify(nav.etatNavigateur().map((o) => o.url)));

    /* La frappe et le clic sont arrivés « de confiance ». */
    const pg = await nav.pageDeLAgent(nav.ongletPourAgent("chat-a", id), "principal", "test", false);
    verifier((await pg.script("document.getElementById('nom').value")) === "Corentin", "la frappe arrive dans le champ", texteDe(etat));
    verifier((await pg.script("document.getElementById('b').dataset.clics")) === "1" && (await pg.script("document.getElementById('b').dataset.confiance")) === "true", "le clic est reçu comme un vrai clic (isTrusted)");

    /* Capture. */
    r = await outil("navigateur_capture", { onglet: id });
    const image = r.content.find((c) => c.type === "image");
    verifier(!r.isError && image && image.data.length > 1500, "la capture rend une image", texteDe(r));

    /* Un cadre d'un autre site. */
    r = await outil("navigateur_aller", { url: `${base}/cadre`, onglet: id });
    await pause(800);
    r = await outil("navigateur_lire", { onglet: id });
    t = texteDe(r);
    const refVille = refDe(t, /Ville/);
    verifier(!!refVille && refVille.startsWith("c1"), "un cadre d'un autre site est lu, avec ses références", t);
    if (refVille) {
      r = await outil("navigateur_agir", { action: "taper", ref: refVille, texte: "Lyon", onglet: id });
      verifier(!r.isError, "la frappe arrive dans le champ du cadre", texteDe(r));
    }

    /* Téléchargement. */
    r = await outil("navigateur_aller", { url: base, onglet: id });
    t = texteDe(r);
    r = await outil("navigateur_agir", { action: "cliquer", ref: refDe(t, /Télécharger/), onglet: id });
    const telecharge = await attendre(() => fs.existsSync(path.join(app.getPath("downloads"), "devis.txt")), 10_000);
    verifier(telecharge && onglet()?.telechargements[0]?.etat === "fini", "le téléchargement arrive dans Téléchargements, et sur l'onglet", JSON.stringify(onglet()?.telechargements));

    /* Piloté, Chrome le dit aux sites : c'est pour cela que la personne se connecte ailleurs. */
    r = await outil("navigateur_aller", { url: `${base}/accueil-connexion`, onglet: id });
    await attendre(() => webdriver.length >= 1);
    verifier(webdriver.at(-1) === "true", "Chrome piloté se déclare piloté (navigator.webdriver)", webdriver.join(","));

    /* La personne se connecte dans un Chrome sans pilotage. */
    const avant = cookiesPoses.length;
    await nav.connexionDansChrome(id);
    verifier(poste.modeChrome() === "personne" && onglet()?.connexion === "ouverte" && onglet()?.main?.type === "personne", "Chrome se rouvre pour la personne, sans pilotage", JSON.stringify(onglet()));
    await attendre(() => cookiesPoses.length > avant && webdriver.length >= 2, 15_000);
    verifier(cookiesPoses.length > avant, "la personne s'est « connectée » (cookie posé dans son Chrome)", cookiesPoses.join(","));
    verifier(webdriver.at(-1) === "false", "dans le Chrome de la personne, rien ne déclare de pilotage", webdriver.join(","));
    r = await outil("navigateur_lire", { onglet: id });
    verifier(r.isError && /attends qu’elle te dise/.test(texteDe(r)), "l'agent attend tant que la personne se connecte", texteDe(r));

    const fin = await nav.connexionTerminee(id);
    if (process.platform === "win32") verifier(fin === "ferme", "« C'est fait » ferme Chrome comme un clic sur la croix", fin);
    else {
      verifier(fin === "a-fermer" && onglet()?.connexion === "a-fermer" && poste.modeChrome() === "personne", "« C'est fait » demande à la personne de fermer Chrome (Mac, Linux)", `${fin} ${JSON.stringify(onglet())}`);
      /* La personne ferme Chrome. Ici, par un signal : il n'écrit que les cookies de plus de 30 s (une vraie
         fermeture de fenêtre les écrit tous, vérifié à part) ; on attend donc qu'il les ait écrits. */
      await pause(32_000);
      await poste.fermerChrome();
    }
    await attendre(() => poste.modeChrome() === null);
    verifier(poste.modeChrome() === null && onglet()?.connexion === null && onglet()?.main === null, "Chrome fermé : la main revient seule", JSON.stringify(onglet()));

    /* L'agent reprend, avec la session ouverte par la personne. */
    r = await outil("navigateur_aller", { url: `${base}/moi`, onglet: id });
    r = await outil("navigateur_lire", { mode: "texte", onglet: id });
    /* Seul le Chrome de la personne pose ce cookie (piloté, la page ne « connecte » pas) ; il a pu la charger plus d'une fois. */
    const poses = cookiesPoses.slice(avant);
    const recu = texteDe(r).match(/session=(\w+)/)?.[1];
    verifier(!!recu && poses.includes(recu) && poste.modeChrome() === "agent", "l'agent retrouve la session ouverte par la personne", `${poses.join(",")}\n${texteDe(r)}`);

    /* Fermer un onglet de KLYRA ferme celui de Chrome. */
    const second = nav.ongletsDe("chat-a").find((o) => o.id !== id);
    if (second) nav.fermerOnglet(second.id);
    verifier(nav.ongletsDe("chat-a").length === 1, "fermer un onglet le retire de la conversation");

    /* Effacer les données efface aussi le profil de KLYRA dans Chrome. */
    await nav.effacerDonnees();
    verifier(!fs.existsSync(path.join(app.getPath("userData"), "navigateur-chrome", "Default", "Cookies")), "effacer les données efface le profil Chrome de KLYRA");
  } catch (e) {
    verifier(false, "le test s'est déroulé sans exception", e && e.stack);
  } finally {
    await poste.fermerChrome().catch(() => undefined);
    serveur.close();
    autre.close();
    console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nNAVIGATEUR CHROME : TOUT PASSE");
    fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    app.exit(echecs.length ? 1 : 0);
  }
});
