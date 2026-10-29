/**
 * Test du journal de consommation et du rattrapage de l'historique, dans
 * Electron (mêmes chemins et mêmes droits que l'app), sur un dossier
 * temporaire : jamais les vraies données. Tourne sous Linux, Mac et Windows.
 *   pnpm build:electron && pnpm test:consommation
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-conso-"));
/* Le dossier de l'app là où l'app le met : %APPDATA% sous Windows, ~/Library/Application Support sur Mac.
   Un nom avec une espace, comme beaucoup de dossiers personnels. Effacé à la fin. */
const DONNEES = path.join(app.getPath("appData"), `klyra-test conso-${process.pid}`);
app.setPath("userData", DONNEES);
// Le cache réseau d'Electron dans le dossier temporaire : rien ne reste dans le dossier de l'app après le test.
app.setPath("sessionData", path.join(TMP, "session"));
process.env.CLAUDE_CONFIG_DIR = path.join(TMP, ".claude");

const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};

/* Un faux historique : la session de Hugo (dev), lancée par l'app ; une session lancée ailleurs. */
const MAINTENANT = Date.now();
const JOUR = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const SESSION_APP = "11111111-aaaa-4bbb-8ccc-000000000001";
const SESSION_AILLEURS = "22222222-aaaa-4bbb-8ccc-000000000002";

function preparer() {
  const donnees = app.getPath("userData");
  fs.mkdirSync(donnees, { recursive: true });
  fs.writeFileSync(path.join(donnees, "conversations.json"), JSON.stringify({ chats: [{ id: "c1", sessions: { dev: SESSION_APP } }] }));
  const projet = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", "C--Users-corentin-klyra-site");
  fs.mkdirSync(projet, { recursive: true });
  const reponse = (id, ms, sortie) => ({
    type: "assistant",
    timestamp: iso(ms),
    requestId: `req-${id}`,
    sessionId: SESSION_APP,
    message: { id, model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: sortie, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } },
  });
  const lignes = [
    { type: "user", timestamp: iso(MAINTENANT - 10 * JOUR), sessionId: SESSION_APP },
    reponse("m1", MAINTENANT - 10 * JOUR, 50),
    reponse("m1", MAINTENANT - 10 * JOUR, 50), // la même réponse, répétée par bloc : comptée une fois
    { type: "cost-state", sessionId: SESSION_APP, startTime: 1, modelUsage: { "claude-opus-5-5": { costUSD: 0.5 } } },
    reponse("m2", MAINTENANT - 3 * JOUR, 20),
    { type: "cost-state", sessionId: SESSION_APP, startTime: 1, modelUsage: { "claude-opus-5-5": { costUSD: 0.8 } } },
    reponse("m3", MAINTENANT + 60 * 1000, 999), // après le début du journal : pas dans l'historique
  ];
  // Fins de ligne Windows (CRLF), comme un fichier écrit sous Windows.
  fs.writeFileSync(path.join(projet, `${SESSION_APP}.jsonl`), lignes.map((l) => JSON.stringify(l)).join("\r\n") + "\r\n");
  // Une session du terminal : comptée en entier dans « Tout Claude Code », même après le début du journal.
  const terminal = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", "-home-corentin-autre-projet");
  fs.mkdirSync(terminal, { recursive: true });
  fs.writeFileSync(
    path.join(terminal, `${SESSION_AILLEURS}.jsonl`),
    [reponse("x1", MAINTENANT - 2 * JOUR, 5000), reponse("x2", MAINTENANT + 120 * 1000, 7)].map((l) => JSON.stringify({ ...l, sessionId: SESSION_AILLEURS })).join("\n") + "\n",
  );
}

app.whenReady().then(async () => {
  try {
    preparer();
    const conso = require("../dist-electron/consommation.js");

    // 1. Le journal en direct s'écrit dans le dossier de l'app (%APPDATA% sous Windows) et se relit.
    conso.enregistrerConsommation({ fournisseur: "Claude Code", modele: "claude-opus-5-5", agent: "dev", jetons: { entree: 1, sortie: 2, cacheLu: 3, cacheEcrit: 4 }, coutUsd: 0.01 });
    await new Promise((r) => setTimeout(r, 300));
    const journalBrut = fs.readFileSync(path.join(app.getPath("userData"), "consommation.jsonl"), "utf8");
    verifier(journalBrut.trim().split(/\r?\n/).length === 1, `journal écrit dans ${app.getPath("userData")}`);

    // 2. Lecture : journal + historique rattrapé de tout Claude Code.
    const premier = await conso.lireConsommation();
    const total = (liste) => liste.reduce((s, e) => s + e.jetons.entree + e.jetons.sortie + e.jetons.cacheLu + e.jetons.cacheEcrit, 0);
    const app_ = premier.entrees.filter((e) => e.klyra && e.at < premier.depuis);
    const terminal = premier.entrees.filter((e) => e.klyra === false);
    const cout = app_.reduce((s, e) => s + (e.coutUsd ?? 0), 0);
    verifier(total(app_) === 110 + 50 + 110 + 20, `sessions de l'app : réponses répétées comptées une fois (${total(app_)} jetons)`);
    verifier(Math.abs(cout - 0.8) < 1e-9, `sessions de l'app : coût = écarts des cost-state (${cout.toFixed(2)} $)`);
    verifier(app_.every((e) => e.agent === "dev"), "sessions de l'app : l'agent vient de la conversation de l'app");
    verifier(!premier.entrees.some((e) => e.jetons.sortie === 999), "session de l'app : rien d'après le début du journal (le journal la compte)");
    verifier(total(terminal) === 5110 + 117 && terminal.every((e) => e.agent === "hors-klyra"), `session du terminal comptée en entier, même après le journal (${total(terminal)} jetons)`);
    verifier(premier.entrees.filter((e) => e.klyra).length === app_.length + 1, "le journal compte comme KLYRA");
    verifier(premier.historique && premier.historique.depuis === MAINTENANT - 10 * JOUR, "« Historique rattrapé depuis » = la plus ancienne réponse");
    verifier(premier.historique && premier.historique.sessionsTotal === 2 && premier.historique.sessionsTrouvees === 1, "2 sessions sur le poste, dont 1 de l'app");
    verifier(premier.historique && premier.historique.raison === null, "aucune donnée manquante signalée");

    // 3. Deuxième passage : incrémental, sans doublon.
    const second = await conso.lireConsommation();
    verifier(second.entrees.length === premier.entrees.length, `deuxième lecture sans doublon (${second.entrees.length} lignes)`);

    // 4. Un poste sans transcription : la raison est dite.
    fs.rmSync(path.join(process.env.CLAUDE_CONFIG_DIR, "projects"), { recursive: true, force: true });
    fs.rmSync(path.join(app.getPath("userData"), "consommation-historique.json"), { force: true });
    const vide = await conso.lireConsommation();
    verifier(/Aucune transcription/.test(vide.historique?.raison ?? ""), `raison affichée : « ${vide.historique?.raison} »`);

    // 5. Clé Admin d'Anthropic, contre un faux serveur qui répond comme la doc (montants en centimes).
    const http = require("node:http");
    const serveur = http.createServer((req, res) => {
      if (req.headers["x-api-key"] !== "sk-ant-admin01-bonne-cle-de-test" || req.headers["anthropic-beta"] !== "analytics-usage-cost-2026-08-24") {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: { message: "invalid x-api-key" } }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url.startsWith("/v1/organizations/analytics/cost")) {
        return res.end(JSON.stringify({ data: [{ cost: { amount: "41280.000000", list_amount: "45000.000000", currency: "USD", requests: 10 } }], has_more: false, data_refreshed_at: "2026-10-29T12:00:00Z" }));
      }
      res.end(JSON.stringify({ data: [{ group: { model: "claude-opus-5-5" }, usage: { total_tokens: 900, requests: 7 } }, { group: { model: "claude-haiku-5-5" }, usage: { total_tokens: 100, requests: 3 } }], has_more: false, data_refreshed_at: "2026-10-29T12:00:00Z" }));
    });
    await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
    process.env.KLYRA_ANTHROPIC_API = `http://127.0.0.1:${serveur.address().port}`;
    const admin = require("../dist-electron/anthropic-admin.js");
    let refus = null;
    await admin.definirCleAdmin("sk-ant-admin01-mauvaise-cle-xx").catch((e) => (refus = e.message));
    verifier(/refuse/.test(refus ?? "") && !(await admin.etatAdmin()).configuree, "clé refusée par l'API : pas gardée");
    const { safeStorage } = require("electron");
    if (safeStorage.isEncryptionAvailable()) {
      const r = await admin.definirCleAdmin("sk-ant-admin01-bonne-cle-de-test");
      verifier(Math.abs(r.coutUsd - 412.8) < 1e-9 && Math.abs(r.coutCatalogueUsd - 450) < 1e-9, `coût en centimes converti : ${r.coutUsd} $ (catalogue ${r.coutCatalogueUsd} $)`);
      verifier(r.jetons === 1000 && r.requetes === 10 && r.parModele[0].modele === "claude-opus-5-5", "jetons et modèles lus");
      verifier((await admin.etatAdmin()).configuree && !fs.readFileSync(path.join(app.getPath("userData"), "anthropic-admin.json"), "utf8").includes("bonne-cle"), "clé gardée chiffrée (jamais en clair sur le disque)");
      await admin.retirerCleAdmin();
      verifier(!(await admin.etatAdmin()).configuree, "clé retirée");
    } else {
      let e2 = null;
      await admin.definirCleAdmin("sk-ant-admin01-bonne-cle-de-test").catch((e) => (e2 = e.message));
      verifier(/trousseau/.test(e2 ?? "") && !(await admin.etatAdmin()).configuree, "sans trousseau sur ce système : la clé n'est pas gardée, et c'est dit");
    }
    serveur.close();
  } catch (e) {
    verifier(false, `exception : ${e && e.stack ? e.stack : e}`);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(DONNEES, { recursive: true, force: true });
    console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout est bon.");
    app.exit(echecs.length ? 1 : 0);
  }
});
