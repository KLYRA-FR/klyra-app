/**
 * ChatGPT par Codex, de bout en bout : le vrai Codex (`codex app-server`) lancé par l'adaptateur compilé
 * (dist-electron/moteurs/codex.js), face à un faux serveur « Responses » d'OpenAI sur 127.0.0.1.
 * Aucun compte, aucune dépense ; dossier personnel, CODEX_HOME et données de l'app jetables.
 * Vérifie : texte en direct, session reprise (Codex se souvient), consignes de l'app reçues,
 * autorisation acceptée puis refusée, arrêt en cours de réponse, compte et modèles.
 * Prérequis : pnpm build:electron, Codex installé (sinon le test est sauté).
 *   KLYRA_CODEX_PATH=/chemin/codex xvfb-run -a electron scripts/test-moteur-codex.cjs --no-sandbox
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-codex-"));
const MAISON = path.join(TMP, "home");
const CODEX_HOME = path.join(TMP, "codex");
fs.mkdirSync(MAISON, { recursive: true });
fs.mkdirSync(CODEX_HOME, { recursive: true });
// Avant de charger les modules de l'app : ils lisent le dossier personnel au chargement.
process.env.HOME = MAISON;
process.env.USERPROFILE = MAISON;
process.env.CODEX_HOME = CODEX_HOME;
process.env.FAUX_CLE = "sk-faux-essai";
app.setPath("userData", path.join(TMP, "donnees"));
app.setPath("sessionData", path.join(TMP, "session"));

const DIST = path.resolve(__dirname, "..", "dist-electron");
const ok = (texte) => console.log(`OK     ${texte}`);

const { demarrerFauxOpenAI, configCodex } = require("./faux-openai.cjs");

/** Une réponse de l'agent, jusqu'à son `fin` (ou au bout du délai). */
function reponse(codex, requestId, options, pendant = () => {}) {
  const evenements = [];
  return new Promise((resolve, reject) => {
    const delai = setTimeout(() => reject(new Error(`délai dépassé (${requestId}) : ${JSON.stringify(evenements).slice(0, 600)}`)), 60_000);
    codex.lancer(requestId, { agent: null, dossier: null, sessionId: null, chatId: "chat-essai", acces: "tout", ...options }, (e) => {
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
  const bin = process.env.KLYRA_CODEX_PATH;
  if (!bin || !fs.existsSync(bin)) {
    console.log("Codex introuvable : test sauté (KLYRA_CODEX_PATH).");
    return;
  }
  const fournisseur = await demarrerFauxOpenAI();
  const { requetes } = fournisseur;
  fs.writeFileSync(path.join(CODEX_HOME, "config.toml"), configCodex(fournisseur.url));

  await require(path.join(DIST, "mes-agents.js")).chargerMesAgents([]);
  const { codex } = require(path.join(DIST, "moteurs", "codex.js"));
  try {
    assert.equal(codex.trouver(), bin);
    ok("l’app trouve Codex");

    /* 1. Un texte, en direct, dans un nouveau fil de Codex. */
    const premiere = await reponse(codex, "r1", { prompt: "TEXTE un" });
    const session = premiere.find((e) => e.type === "session")?.sessionId;
    assert.match(session ?? "", /^[0-9a-f-]{36}$/);
    const fin1 = premiere.at(-1);
    assert.equal(fin1.ok, true, fin1.erreur);
    assert.equal(fin1.texte, "Bonjour de ChatGPT");
    assert.equal(fin1.sessionId, session);
    assert.equal(premiere.filter((e) => e.type === "texte").map((e) => e.delta).join(""), "Bonjour de ChatGPT");
    ok("texte en direct, nouveau fil annoncé comme session");
    const consignes = JSON.stringify(requetes[0].input);
    assert.ok(consignes.includes("tu travailles avec ChatGPT (Codex)"), "consigne Codex absente");
    assert.ok(consignes.includes("planning"), "consigne du planning absente");
    ok("Codex reçoit les consignes de l’app (planning, et ce qu’il ne peut pas faire)");

    /* 2. La même session : Codex se souvient. */
    const seconde = await reponse(codex, "r2", { prompt: "TEXTE deux", sessionId: session });
    assert.equal(seconde.at(-1).ok, true, seconde.at(-1).erreur);
    assert.ok(!seconde.some((e) => e.type === "session"), "une session neuve a été ouverte");
    assert.ok(JSON.stringify(requetes.at(-1).input).includes("TEXTE un"), "Codex a oublié le premier message");
    ok("session reprise : le premier message est encore dans le fil");

    /* 3. Une commande hors de l'accès : la carte d'autorisation, acceptée. */
    const atelier = path.join(MAISON, ".klyra", "atelier");
    const accepte = await reponse(codex, "r3", { prompt: "COMMANDE", acces: "demander" }, (e) => {
      if (e.type === "autorisation") codex.autoriser("r3", e.id, "oui");
    });
    const carte = accepte.find((e) => e.type === "autorisation");
    assert.ok(carte, "pas de carte d’autorisation");
    assert.equal(carte.outil, "Bash");
    assert.match(String(carte.entree.command), /touch klyra-essai\.txt/);
    assert.deepEqual(accepte.find((e) => e.type === "autorisation-fin"), { type: "autorisation-fin", id: carte.id, accepte: true });
    const etape = accepte.find((e) => e.type === "etape");
    assert.equal(etape?.outil, "Bash");
    assert.equal(accepte.find((e) => e.type === "etape-fin" && e.id === etape.id)?.ok, true);
    assert.ok(fs.existsSync(path.join(atelier, "klyra-essai.txt")), "la commande n’a pas tourné");
    assert.equal(accepte.at(-1).texte, "Commande faite");
    ok("autorisation demandée, acceptée : la commande tourne dans l’atelier");

    /* 4. La même, refusée. */
    fs.rmSync(path.join(atelier, "klyra-essai.txt"));
    const refuse = await reponse(codex, "r4", { prompt: "COMMANDE", acces: "demander" }, (e) => {
      if (e.type === "autorisation") codex.autoriser("r4", e.id, "non");
    });
    assert.equal(refuse.find((e) => e.type === "autorisation-fin")?.accepte, false);
    assert.ok(!fs.existsSync(path.join(atelier, "klyra-essai.txt")), "la commande refusée a tourné");
    assert.equal(refuse.at(-1).type, "fin");
    ok("autorisation refusée : rien ne tourne, la réponse se termine");

    /* 5. Arrêt en cours de réponse. */
    const debut = Date.now();
    const arretee = await reponse(codex, "r5", { prompt: "LENT" }, (e, tous) => {
      if (e.type === "texte" && tous.filter((x) => x.type === "texte").length === 1) codex.arreter("r5");
    });
    const fin5 = arretee.at(-1);
    assert.equal(fin5.ok, false);
    assert.equal(fin5.erreur, "Arrêté par toi.");
    assert.ok(Date.now() - debut < 15_000);
    ok("arrêt : la réponse se termine sur « Arrêté par toi. »");

    /* 6. Une réponse qui n'est pas à Codex : il l'ignore. */
    assert.equal(codex.autoriser("inconnue", "1", "oui"), false);
    codex.arreter("inconnue");
    ok("une réponse d’un autre moteur est ignorée");

    /* 7. Compte et modèles. */
    const compte = await codex.compte();
    assert.equal(compte.installe, true);
    assert.match(compte.version ?? "", /^\d+\.\d+\.\d+$/);
    assert.equal(compte.connecte, true);
    assert.equal(compte.methode, "config");
    assert.equal(compte.email, null);
    ok(`compte lu : Codex ${compte.version}, prêt par le fournisseur de sa config, sans compte OpenAI`);
    const modeles = await codex.modeles();
    assert.ok(Array.isArray(modeles) && modeles.length > 0, "aucun modèle");
    assert.ok(modeles.every((m) => m.id && m.nom && Array.isArray(m.efforts)));
    ok(`${modeles.length} modèles annoncés (${modeles.slice(0, 3).map((m) => m.nom).join(", ")}…)`);
  } finally {
    codex.fermer();
    fournisseur.fermer();
  }
  console.log("\nTout est bon.");
}

/** Codex écrit encore quelques instants après sa fermeture : on retente, sans faire échouer le test. */
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
