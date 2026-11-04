/**
 * Grok sur le VPS, de bout en bout : le vrai serveur KLYRA (serveur/klyra-serveur.mjs) sur 127.0.0.1,
 * face au faux Grok Build (scripts/faux-acp.mjs, un agent ACP qui suit la documentation embarquée de
 * Grok Build 1.0.70). Aucun compte, aucun réseau ; dossier de klyra, GROK_HOME et données jetables.
 * Vérifie : Grok dans les fournisseurs, compte (non connecté, clé API gardée sur le VPS en 600 et
 * jamais renvoyée, puis l'abonnement par code d'appareil, e-mail lu sans jeton, déconnexion), modèles,
 * conversation (consignes du VPS dans `_meta.rules`, serveur MCP du VPS, session retenue par
 * conversation à part de Claude Code et de Codex, reprise), autorisation acceptée depuis l'app, arrêt.
 *   node scripts/test-serveur-grok.mjs
 * Avec le vrai Grok Build (un compte connecté, ou XAI_API_KEY ; consomme) : KLYRA_GROK_PATH=/chemin/grok.
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAUX = path.join(path.dirname(fileURLToPath(import.meta.url)), "faux-acp.mjs");
const reel = process.env.KLYRA_GROK_PATH;
const bin = reel || FAUX;
if (!reel) chmodSync(FAUX, 0o755);

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-serveur-grok-"));
const HOME = path.join(TMP, "klyra");
const DONNEES = path.join(HOME, "donnees");
const JOURNAL = path.join(TMP, "faux-acp.jsonl");
mkdirSync(DONNEES, { recursive: true });
if (!reel) {
  process.env.GROK_HOME = path.join(TMP, "grok");
  process.env.FAUX_ACP_JOURNAL = JOURNAL;
}
const ok = (texte) => console.log(`OK     ${texte}`);

const { creerAgents } = await import("../serveur/agents.mjs");
const { creerIa } = await import("../serveur/ia.mjs");
const { creerMoteurs } = await import("../serveur/moteurs.mjs");
const { creerCode, creerJournal, ecouter } = await import("../serveur/klyra-serveur.mjs");

const journal = creerJournal(Date.now, path.join(DONNEES, "sessions-conversations.json"));
const evenements = new Map();
const publier = (requestId, event, sessionId) => {
  journal.publier(requestId, event, sessionId);
  if (!evenements.has(requestId)) evenements.set(requestId, []);
  evenements.get(requestId).push(event);
};
const ia = creerIa({ donnees: DONNEES, version: "1" });
await ia.demarrer();
const agents = creerAgents({ home: HOME, donnees: DONNEES, nomServeur: "essai", publier, spontane: journal.spontane, ia, claude: null, codex: null, grok: bin });
const moteurs = creerMoteurs({ home: HOME, claude: agents.claude, codex: agents.codex, grok: agents.grok });
const serveur = await ecouter({ nom: "essai", dossier: DONNEES, journal, agents, moteurs, ia });
const base = `http://127.0.0.1:${serveur.port}`;

const { jeton } = await (await fetch(`${base}/klyra/v1/appairer`, { method: "POST", body: JSON.stringify({ code: creerCode(DONNEES), appareil: "essai" }) })).json();
const appel = async (chemin, methode = "GET", corps) => {
  const r = await fetch(`${base}${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}` }, ...(corps ? { body: JSON.stringify(corps) } : {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const requetes = () => (existsSync(JOURNAL) ? readFileSync(JOURNAL, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

async function reponse(requestId, options, pendant = () => {}) {
  const r = await appel("/klyra/v1/agent/envoyer", "POST", { requestId, options: { agent: null, sessionId: null, acces: "projet", conversation: "chat-grok", moteur: "grok", ...options } });
  assert.equal(r.status, 202);
  const debut = Date.now();
  let vus = 0;
  while (Date.now() - debut < (reel ? 180_000 : 30_000)) {
    const liste = evenements.get(requestId) ?? [];
    for (; vus < liste.length; vus++) await pendant(liste[vus], liste);
    if (liste.at(-1)?.type === "fin") return liste;
    await new Promise((f) => setTimeout(f, 50));
  }
  throw new Error(`délai dépassé (${requestId}) : ${JSON.stringify(evenements.get(requestId)).slice(0, 600)}`);
}

try {
  /* 1. Grok dans les fournisseurs du VPS. */
  const { moteurs: liste } = (await appel("/klyra/v1/moteurs")).json;
  const grok = liste.find((m) => m.id === "grok");
  assert.deepEqual([grok?.fournisseur, grok?.nom, grok?.installable, grok?.chemin], ["Grok", "Grok Build", true, bin]);
  ok("Grok Build dans les fournisseurs du VPS, installable depuis l’app");

  if (!reel) {
    /* 2. Le compte : rien, puis une clé API gardée sur le VPS (600), jamais renvoyée. */
    let compte = (await appel("/klyra/v1/moteurs/grok/compte")).json.compte;
    assert.deepEqual([compte.installe, compte.connecte, compte.version], [true, false, "9.9.9"]);
    const cle = await appel("/klyra/v1/moteurs/grok/connecter-cle", "POST", { cle: "xai-cle-essai-123456" });
    assert.deepEqual([cle.json.compte.connecte, cle.json.compte.methode], [true, "cle-api"]);
    assert.ok(!JSON.stringify(cle.json).includes("xai-cle-essai"), "la clé revient à l’app");
    assert.equal(statSync(path.join(DONNEES, "grok.json")).mode & 0o777, 0o600);
    assert.equal((await appel("/klyra/v1/moteurs/grok/connecter-cle", "POST", { cle: "court" })).status, 400);
    ok("clé API de console.x.ai gardée sur le VPS (600), jamais renvoyée");
    assert.equal((await appel("/klyra/v1/moteurs/grok/utilisation?actualiser=1")).json.utilisation, null, "une clé API n’a pas de crédits du mois");
    ok("connecté par une clé API : pas d’anneau d’utilisation");
  }

  /* 3. Les modèles annoncés par Grok. */
  const modeles = (await appel("/klyra/v1/moteurs/grok/modeles")).json.modeles;
  assert.ok(Array.isArray(modeles) && modeles.length > 0, "aucun modèle");
  ok(`modèles de Grok : ${modeles.map((m) => m.id).join(", ")}`);

  /* 4. Une conversation : texte, consignes du VPS, serveur MCP du VPS, session retenue. */
  const premiere = await reponse("g1", { prompt: reel ? "Réponds seulement : ok" : "TEXTE un" });
  assert.equal(premiere.at(-1).ok, true, premiere.at(-1).erreur);
  const session = premiere.find((e) => e.type === "session")?.sessionId;
  assert.ok(session, "pas de session");
  if (!reel) {
    assert.equal(premiere.at(-1).texte, "Bonjour de Grok");
    const env = requetes().find((m) => m.env)?.env;
    assert.deepEqual(env, { XAI_API_KEY: "xai-cle-essai-123456", GROK_CLAUDE_SKILLS_ENABLED: "false", GROK_DISABLE_AUTOUPDATER: "1" });
    const nouvelle = requetes().find((m) => m.method === "session/new" && m.params?._meta?.rules)?.params;
    assert.ok(nouvelle._meta.rules.includes("VPS « essai »"), "Grok ne sait pas qu’il tourne sur le VPS");
    assert.ok(nouvelle._meta.rules.includes("tu travailles avec Grok"), "consigne Grok absente");
    assert.ok(nouvelle.mcpServers.length > 0, "pas de serveur MCP du VPS");
  }
  const sessions = JSON.parse(readFileSync(path.join(DONNEES, "sessions-conversations.json"), "utf8"));
  assert.equal(sessions["chat-grok|principal|grok"], session);
  assert.equal(sessions["chat-grok|principal"], undefined);
  ok("Grok répond sur le VPS, avec les consignes et les outils du serveur ; session retenue à part");

  /* 5. Même conversation, sans session donnée : le serveur reprend celle de Grok. */
  const seconde = await reponse("g2", { prompt: reel ? "Réponds seulement : encore" : "OUTIL deux" });
  assert.equal(seconde.at(-1).ok, true, seconde.at(-1).erreur);
  assert.ok(!seconde.some((e) => e.type === "session"), "une session neuve a été ouverte");
  if (!reel) assert.deepEqual(seconde.filter((e) => e.type === "etape").map((e) => e.outil), ["Bash"]);
  ok("session de Grok reprise dans la même conversation");

  if (!reel) {
    /* 6. Autorisation demandée par Grok, acceptée depuis l'app. */
    const autorisee = await reponse("g3", { prompt: "AUTORISATION", conversation: "chat-grok-2" }, async (e) => {
      if (e.type === "autorisation") assert.equal((await appel("/klyra/v1/agent/autoriser", "POST", { requestId: "g3", demandeId: e.id, decision: "oui" })).json.ok, true);
    });
    assert.equal(autorisee.find((e) => e.type === "autorisation-fin")?.accepte, true);
    assert.equal(autorisee.at(-1).texte, "Réponse : oui-une-fois");
    ok("autorisation demandée sur le VPS, acceptée depuis l’app");

    /* 7. Arrêt en cours de réponse. */
    const arretee = await reponse("g4", { prompt: "LENT", conversation: "chat-grok-3" }, async (e) => {
      if (e.type === "texte") await appel("/klyra/v1/agent/annuler", "POST", { requestId: "g4" });
    });
    assert.deepEqual([arretee.at(-1).ok, arretee.at(-1).erreur], [false, "Arrêté par toi."]);
    ok("arrêt depuis l’app : « Arrêté par toi. »");

    /* 8. L'abonnement par code d'appareil : lien et code rendus à l'app, puis le compte connecté. */
    await appel("/klyra/v1/moteurs/grok/deconnecter", "POST", {});
    assert.equal(existsSync(path.join(DONNEES, "grok.json")), false);
    const connexion = (await appel("/klyra/v1/moteurs/grok/connecter", "POST", { mode: "navigateur" })).json;
    assert.deepEqual(connexion, { url: "https://auth.x.ai/device", code: "WXYZ-1234" });
    let compte = null;
    for (let i = 0; i < 60 && !compte?.connecte; i++) {
      await new Promise((f) => setTimeout(f, 100));
      compte = (await appel("/klyra/v1/moteurs/grok/compte")).json.compte;
    }
    assert.deepEqual([compte.connecte, compte.methode, compte.email], [true, "grok.com", "essai@exemple.fr"]);
    assert.ok(!JSON.stringify(compte).includes("jeton-secret"), "un jeton de Grok revient à l’app");
    const utilisation = (await appel("/klyra/v1/moteurs/grok/utilisation?actualiser=1")).json.utilisation;
    assert.deepEqual(utilisation?.mois, { utilise: 0.375, reinitialiseA: Date.parse("2026-12-01T00:00:00Z") });
    assert.deepEqual([utilisation.session, utilisation.semaine, utilisation.statut], [null, null, "allowed"]);
    ok("abonnement Grok : crédits du mois servis par le VPS (x.ai/billing)");
    const deconnecte = (await appel("/klyra/v1/moteurs/grok/deconnecter", "POST", {})).json.compte;
    assert.equal(deconnecte.connecte, false);
    ok("abonnement Grok par code d’appareil (lien + code), e-mail lu sans jeton ; déconnexion");
  }
} finally {
  await serveur.fermer();
  rmSync(TMP, { recursive: true, force: true });
}
console.log("Grok sur le VPS : tout est bon.");
process.exit(0);
