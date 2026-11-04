/**
 * Grok par Grok Build, de bout en bout dans Electron : l'adaptateur compilé (dist-electron/moteurs/grok.js)
 * lance `grok agent stdio`. Par défaut, le faux Grok Build (scripts/faux-acp.mjs, un agent ACP qui suit
 * la documentation embarquée de Grok Build 1.0.70) : aucun compte, aucun réseau. Avec KLYRA_GROK_PATH,
 * le vrai Grok Build (un compte connecté ou XAI_API_KEY ; consomme) : seules les étapes qui ne dépendent
 * pas des réponses du faux tournent.
 * Dossier personnel, GROK_HOME et données de l'app jetables.
 * Vérifie : texte en direct, consignes de l'app reçues (`_meta.rules`), session
 * reprise, autorisation acceptée puis refusée, arrêt, compte (clé API chiffrée, abonnement), modèles.
 * Prérequis : pnpm build:electron.
 *   xvfb-run -a electron scripts/test-moteur-grok.cjs --no-sandbox
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app, safeStorage } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-grok-"));
const MAISON = path.join(TMP, "home");
const JOURNAL = path.join(TMP, "faux-acp.jsonl");
const FAUX = path.join(__dirname, "faux-acp.mjs");
const reel = process.env.KLYRA_GROK_PATH;
fs.mkdirSync(MAISON, { recursive: true });
// Avant de charger les modules de l'app : ils lisent le dossier personnel au chargement.
process.env.HOME = MAISON;
process.env.USERPROFILE = MAISON;
if (!reel) {
  fs.chmodSync(FAUX, 0o755);
  process.env.KLYRA_GROK_PATH = FAUX;
  process.env.GROK_HOME = path.join(TMP, "grok");
  process.env.FAUX_ACP_JOURNAL = JOURNAL;
}
app.setPath("userData", path.join(TMP, "donnees"));
app.setPath("sessionData", path.join(TMP, "session"));

const DIST = path.resolve(__dirname, "..", "dist-electron");
const ok = (texte) => console.log(`OK     ${texte}`);
const requetes = () => (fs.existsSync(JOURNAL) ? fs.readFileSync(JOURNAL, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

function reponse(grok, requestId, options, pendant = () => {}) {
  const evenements = [];
  return new Promise((resolve, reject) => {
    const delai = setTimeout(() => reject(new Error(`délai dépassé (${requestId}) : ${JSON.stringify(evenements).slice(0, 600)}`)), reel ? 180_000 : 30_000);
    grok.lancer(requestId, { agent: null, dossier: null, sessionId: null, chatId: "chat-essai", acces: "projet", ...options }, (e) => {
      evenements.push(e);
      pendant(e, evenements);
      if (e.type === "fin") {
        clearTimeout(delai);
        resolve(evenements);
      }
    }, () => null);
  });
}

async function principal() {
  await require(path.join(DIST, "mes-agents.js")).chargerMesAgents([]);
  const { grok } = require(path.join(DIST, "moteurs", "grok.js"));
  try {
    assert.equal(grok.trouver(), process.env.KLYRA_GROK_PATH);
    ok(`l’app trouve Grok Build${reel ? " (le vrai)" : " (le faux)"}`);

    /* 1. Un texte, en direct, dans une nouvelle session de Grok. */
    const premiere = await reponse(grok, "r1", { prompt: reel ? "Réponds seulement : ok" : "TEXTE un" });
    const session = premiere.find((e) => e.type === "session")?.sessionId;
    assert.ok(session, "pas de session");
    const fin1 = premiere.at(-1);
    assert.equal(fin1.ok, true, fin1.erreur);
    assert.equal(fin1.sessionId, session);
    assert.ok(premiere.some((e) => e.type === "texte"), "pas de texte en direct");
    if (!reel) {
      assert.equal(fin1.texte, "Bonjour de Grok");
      const nouvelle = requetes().find((m) => m.method === "session/new")?.params;
      assert.ok(nouvelle._meta.rules.includes("tu travailles avec Grok"), "consigne Grok absente");
      assert.ok(nouvelle._meta.rules.includes("planning"), "consigne du planning absente");
      // Le serveur MCP de l'app n'est pas démarré dans ce test (comme pour Codex) : test:serveur-grok le vérifie sur le VPS.
      assert.ok(Array.isArray(nouvelle.mcpServers));
      assert.deepEqual(requetes().find((m) => m.env)?.env, { XAI_API_KEY: null, GROK_CLAUDE_SKILLS_ENABLED: "false", GROK_DISABLE_AUTOUPDATER: "1" });
      ok("texte en direct ; consignes de l’app dans _meta.rules, sans les skills de Claude");
    } else ok(`texte en direct : « ${fin1.texte.slice(0, 60)} »`);

    /* 2. La même session : reprise, pas de nouvelle. */
    const seconde = await reponse(grok, "r2", { prompt: reel ? "Quel mot t’ai-je demandé de répondre ? Un mot." : "TEXTE deux", sessionId: session });
    assert.equal(seconde.at(-1).ok, true, seconde.at(-1).erreur);
    assert.ok(!seconde.some((e) => e.type === "session"), "une session neuve a été ouverte");
    ok("session reprise");

    if (!reel) {
      /* 3. Autorisation acceptée, puis refusée. */
      const accepte = await reponse(grok, "r3", { prompt: "AUTORISATION", sessionId: session }, (e) => {
        if (e.type === "autorisation") assert.equal(grok.autoriser("r3", e.id, "oui"), true);
      });
      const carte = accepte.find((e) => e.type === "autorisation");
      assert.equal(carte?.outil, "Edit");
      assert.equal(accepte.find((e) => e.type === "autorisation-fin")?.accepte, true);
      assert.equal(accepte.at(-1).texte, "Réponse : oui-une-fois");
      const refuse = await reponse(grok, "r4", { prompt: "AUTORISATION", sessionId: session }, (e) => {
        if (e.type === "autorisation") grok.autoriser("r4", e.id, "non");
      });
      assert.equal(refuse.find((e) => e.type === "autorisation-fin")?.accepte, false);
      assert.equal(refuse.at(-1).texte, "Réponse : non");
      ok("autorisation acceptée, puis refusée");

      /* 4. Arrêt en cours de réponse. */
      const arretee = await reponse(grok, "r5", { prompt: "LENT", sessionId: session }, (e) => {
        if (e.type === "texte") grok.arreter("r5");
      });
      assert.deepEqual([arretee.at(-1).ok, arretee.at(-1).erreur], [false, "Arrêté par toi."]);
      ok("arrêt : « Arrêté par toi. »");

      /* 5. Une réponse qui n'est pas à Grok : ignorée. */
      assert.equal(grok.autoriser("inconnue", "1", "oui"), false);
      grok.arreter("inconnue");
      ok("une réponse d’un autre moteur est ignorée");

      /* 6. Le compte : rien ; une clé API chiffrée (si le trousseau est là) ; l'abonnement par `grok login`. */
      let compte = await grok.compte();
      assert.deepEqual([compte.installe, compte.version, compte.connecte], [true, "9.9.9", false]);
      if (safeStorage.isEncryptionAvailable()) {
        compte = await grok.connecterAvecCle("xai-cle-essai-123456");
        assert.deepEqual([compte.connecte, compte.methode], [true, "cle-api"]);
        const fichier = path.join(TMP, "donnees", "grok-cle.json");
        assert.ok(!fs.readFileSync(fichier, "utf8").includes("xai-cle-essai"), "la clé est écrite en clair");
        await reponse(grok, "r6", { prompt: "TEXTE trois" });
        assert.equal(requetes().filter((m) => m.env).at(-1).env.XAI_API_KEY, "xai-cle-essai-123456");
        ok("clé API chiffrée par le trousseau, donnée au processus de Grok seulement");
      } else {
        await assert.rejects(grok.connecterAvecCle("xai-cle-essai-123456"), /trousseau/);
        ok("trousseau indisponible ici : la clé est refusée plutôt que gardée en clair");
      }
      compte = await grok.deconnecter();
      assert.equal(compte.connecte, false);
      compte = await grok.connecter();
      assert.deepEqual([compte.connecte, compte.methode, compte.email], [true, "grok.com", "essai@exemple.fr"]);
      assert.ok(!JSON.stringify(compte).includes("jeton-secret"));
      ok("abonnement par grok login : connecté, e-mail lu sans jeton");
    }

    /* 7. Les modèles annoncés par Grok. */
    const modeles = await grok.modeles();
    assert.ok(Array.isArray(modeles) && modeles.length > 0, "aucun modèle");
    ok(`${modeles.length} modèles annoncés (${modeles.slice(0, 3).map((m) => m.nom).join(", ")})`);
  } finally {
    grok.fermer();
  }
  console.log("\nTout est bon.");
}

const nettoyer = () => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.error(`(dossier jetable laissé : ${TMP} — ${error.message})`);
  }
};

app.whenReady().then(principal).then(
  () => {
    nettoyer();
    app.exit(0);
  },
  (error) => {
    console.error(`ÉCHEC  ${error.stack ?? error}`);
    nettoyer();
    app.exit(1);
  },
);
