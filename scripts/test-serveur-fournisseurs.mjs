/**
 * Les fournisseurs du VPS, de bout en bout : le vrai serveur KLYRA (serveur/klyra-serveur.mjs) sur 127.0.0.1,
 * le vrai Codex face au faux serveur « Responses » d'OpenAI (faux-openai.cjs), et une fausse IA « chat completions ».
 * Aucun compte, aucune dépense ; dossier de klyra, CODEX_HOME et données jetables.
 * Vérifie : routes Fournisseurs (moteurs, compte, modèles), IA à consulter (ajout, clé gardée sur le VPS,
 * test, retrait), conversation avec Codex (texte, session reprise par conversation, outil demander_ia
 * proposé, autorisation, arrêt), limites de l'abonnement reçues pendant une réponse (route `utilisation`).
 *   KLYRA_CODEX_PATH=/chemin/codex node scripts/test-serveur-fournisseurs.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { demarrerFauxOpenAI, configCodex } = require("./faux-openai.cjs");

const bin = process.env.KLYRA_CODEX_PATH;
if (!bin) {
  console.log("Codex introuvable : test sauté (KLYRA_CODEX_PATH).");
  process.exit(0);
}

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-serveur-fournisseurs-"));
const HOME = path.join(TMP, "klyra");
const DONNEES = path.join(HOME, "donnees");
const CODEX_HOME = path.join(TMP, "codex");
mkdirSync(DONNEES, { recursive: true });
mkdirSync(CODEX_HOME, { recursive: true });
process.env.CODEX_HOME = CODEX_HOME;
process.env.FAUX_CLE = "sk-faux-essai";
const ok = (texte) => console.log(`OK     ${texte}`);

const { creerAgents } = await import("../serveur/agents.mjs");
const { creerIa } = await import("../serveur/ia.mjs");
const { creerMoteurs } = await import("../serveur/moteurs.mjs");
const { creerCode, creerJournal, ecouter } = await import("../serveur/klyra-serveur.mjs");

/* Une fausse IA compatible OpenAI : elle répète la dernière consigne. */
const appelsIa = [];
const fausseIa = createServer((req, res) => {
  let corps = "";
  req.on("data", (d) => (corps += d));
  req.on("end", () => {
    appelsIa.push({ url: req.url, auth: req.headers.authorization, corps: JSON.parse(corps) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  });
});
await new Promise((r) => fausseIa.listen(0, "127.0.0.1", r));

const openai = await demarrerFauxOpenAI();
writeFileSync(path.join(CODEX_HOME, "config.toml"), configCodex(openai.url));

/* Le serveur, comme au lancement réel, avec les événements gardés pour le test. */
const journal = creerJournal(Date.now, path.join(DONNEES, "sessions-conversations.json"));
const evenements = new Map();
const publier = (requestId, event, sessionId) => {
  journal.publier(requestId, event, sessionId);
  if (!evenements.has(requestId)) evenements.set(requestId, []);
  evenements.get(requestId).push(event);
};
const ia = creerIa({ donnees: DONNEES, version: "1" });
await ia.demarrer();
const agents = creerAgents({ home: HOME, donnees: DONNEES, nomServeur: "essai", publier, spontane: journal.spontane, ia, claude: null, codex: bin });
const moteurs = creerMoteurs({ home: HOME, claude: agents.claude, codex: agents.codex });
const serveur = await ecouter({ nom: "essai", dossier: DONNEES, journal, agents, moteurs, ia });
const base = `http://127.0.0.1:${serveur.port}`;

const appairage = await fetch(`${base}/klyra/v1/appairer`, { method: "POST", body: JSON.stringify({ code: creerCode(DONNEES), appareil: "essai" }) });
const { jeton } = await appairage.json();
const appel = async (chemin, methode = "GET", corps) => {
  const r = await fetch(`${base}${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}` }, ...(corps ? { body: JSON.stringify(corps) } : {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

/** Envoie un message et attend son `fin` (événements gardés par `publier`). */
async function reponse(requestId, options, pendant = () => {}) {
  const r = await appel("/klyra/v1/agent/envoyer", "POST", { requestId, options: { agent: null, sessionId: null, acces: "tout", conversation: "chat-essai", moteur: "codex", ...options } });
  assert.equal(r.status, 202);
  const debut = Date.now();
  let vus = 0;
  while (Date.now() - debut < 60_000) {
    const liste = evenements.get(requestId) ?? [];
    for (; vus < liste.length; vus++) await pendant(liste[vus], liste);
    if (liste.at(-1)?.type === "fin") return liste;
    await new Promise((f) => setTimeout(f, 50));
  }
  throw new Error(`délai dépassé (${requestId}) : ${JSON.stringify(evenements.get(requestId)).slice(0, 600)}`);
}

try {
  /* 1. Le serveur annonce les fournisseurs ; les routes demandent un appareil relié. */
  assert.equal((await appel("/klyra/v1/serveur")).json.fournisseurs, true);
  assert.equal((await fetch(`${base}/klyra/v1/moteurs`)).status, 401);
  assert.equal((await fetch(`${base}/klyra/v1/ia`)).status, 401);
  ok("le serveur annonce ses fournisseurs, réservés aux appareils reliés");

  /* 2. Moteurs, compte et modèles. */
  const { moteurs: liste } = (await appel("/klyra/v1/moteurs")).json;
  assert.deepEqual(liste.map((m) => [m.id, m.fournisseur, m.installable]), [["claude", "Claude", false], ["codex", "ChatGPT", true]]);
  assert.equal(liste[0].chemin, null);
  assert.equal(liste[1].chemin, bin);
  const compte = (await appel("/klyra/v1/moteurs/codex/compte")).json.compte;
  assert.equal(compte.connecte, true);
  assert.equal(compte.methode, "config");
  assert.match(compte.version ?? "", /^\d+\.\d+\.\d+$/);
  assert.equal((await appel("/klyra/v1/moteurs/claude/compte")).json.compte.installe, false);
  assert.ok(Array.isArray((await appel("/klyra/v1/moteurs/codex/modeles")).json.modeles));
  assert.equal((await appel("/klyra/v1/moteurs/inconnu/compte")).status, 400);
  ok(`moteurs lus : Claude Code absent, Codex ${compte.version} prêt par sa config`);

  /* 2 bis. Connexion par le navigateur : la page d'OpenAI, et son retour relayé jusqu'à Codex. */
  const connexion = (await appel("/klyra/v1/moteurs/codex/connecter", "POST", { mode: "navigateur" })).json;
  assert.match(connexion.url, /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
  assert.match(connexion.retour, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.equal((await appel("/klyra/v1/moteurs/codex/retour", "POST", { chemin: "/ailleurs?x=1" })).status, 400);
  /* Un faux état : Codex le refuse, preuve que le retour l'a atteint. */
  const relaye = await appel("/klyra/v1/moteurs/codex/retour", "POST", { chemin: "/auth/callback?code=faux&state=faux" });
  assert.equal(relaye.status, 200);
  assert.equal(relaye.json.statut, 400);
  const parCode = (await appel("/klyra/v1/moteurs/codex/connecter", "POST", { mode: "code" })).json;
  assert.match(parCode.url, /^https:\/\//);
  assert.match(parCode.code, /^[A-Z0-9-]{6,}$/);
  ok("connexion ChatGPT : page d’OpenAI et retour relayé jusqu’à Codex ; code d’appareil en secours");

  /* 3. Les IA à consulter : la clé reste sur le VPS. */
  const { catalogue } = (await appel("/klyra/v1/ia")).json;
  assert.ok(catalogue.deepseek && catalogue.xai && catalogue.gemini);
  const refus = await appel("/klyra/v1/ia/ajouter", "POST", { nom: "X", fournisseur: "inconnu", url: "", modele: "m", cle: "sk-1234567890" });
  assert.equal(refus.status, 400);
  const ajout = await appel("/klyra/v1/ia/ajouter", "POST", { nom: "Fausse", fournisseur: "autre", url: `http://127.0.0.1:${fausseIa.address().port}/v1`, modele: "faux", cle: "sk-fausse-cle-123" });
  assert.equal(ajout.status, 200);
  assert.deepEqual(Object.keys(ajout.json.liste[0]).sort(), ["fournisseur", "id", "modele", "nom", "url"]);
  assert.ok(!JSON.stringify((await appel("/klyra/v1/ia")).json).includes("sk-fausse-cle-123"), "la clé revient à l’app");
  assert.equal(statSync(path.join(DONNEES, "ia.json")).mode & 0o777, 0o600);
  const test = await appel("/klyra/v1/ia/tester", "POST", { id: ajout.json.liste[0].id });
  assert.equal(test.json.texte, "ok");
  assert.equal(appelsIa.at(-1).url, "/v1/chat/completions");
  assert.equal(appelsIa.at(-1).auth, "Bearer sk-fausse-cle-123");
  ok("IA à consulter ajoutée et testée : la clé reste dans ia.json (600), jamais renvoyée");

  /* 4. Une conversation avec Codex : texte, et l'outil demander_ia proposé. */
  const premiere = await reponse("r1", { prompt: "TEXTE un" });
  const session = premiere.find((e) => e.type === "session")?.sessionId;
  assert.match(session ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(premiere.at(-1).ok, true, premiere.at(-1).erreur);
  assert.equal(premiere.at(-1).texte, "Bonjour de ChatGPT");
  const requete = JSON.stringify(openai.requetes[0]);
  assert.ok(requete.includes("demander_ia"), "l’outil demander_ia n’est pas proposé à Codex");
  assert.ok(requete.includes("tu travailles avec ChatGPT (Codex)"), "consigne Codex absente");
  assert.ok(requete.includes("VPS « essai »"), "Codex ne sait pas qu’il tourne sur le VPS");
  ok("Codex répond sur le VPS, avec ses consignes et l’outil demander_ia");

  /* 5. Même conversation, sans session : le serveur reprend celle de Codex. */
  const seconde = await reponse("r2", { prompt: "TEXTE deux" });
  assert.equal(seconde.at(-1).ok, true, seconde.at(-1).erreur);
  assert.ok(!seconde.some((e) => e.type === "session"), "une session neuve a été ouverte");
  assert.ok(JSON.stringify(openai.requetes.at(-1).input).includes("TEXTE un"), "Codex a oublié le premier message");
  const sessions = JSON.parse(readFileSync(path.join(DONNEES, "sessions-conversations.json"), "utf8"));
  assert.equal(sessions["chat-essai|principal|codex"], session);
  assert.equal(sessions["chat-essai|principal"], undefined);
  ok("session de Codex retenue par conversation, à part de celle de Claude Code");

  /* 5 bis. Les limites de l'abonnement : rien d'inventé avant, puis celles que Codex a reçues pendant une réponse. */
  assert.equal((await appel("/klyra/v1/moteurs/claude/utilisation")).json.utilisation, null);
  assert.equal((await appel("/klyra/v1/moteurs/codex/utilisation?actualiser=1")).json.utilisation, null);
  const limitee = await reponse("r2b", { prompt: "TEXTE LIMITES", conversation: "chat-limites" });
  assert.equal(limitee.at(-1).ok, true, limitee.at(-1).erreur);
  let utilisation = null;
  for (let i = 0; i < 40 && !utilisation; i++) {
    utilisation = (await appel("/klyra/v1/moteurs/codex/utilisation")).json.utilisation;
    if (!utilisation) await new Promise((f) => setTimeout(f, 50));
  }
  assert.ok(utilisation, "Codex n’a pas transmis les limites de la réponse");
  assert.deepEqual([utilisation.session, utilisation.semaine, utilisation.statut], [{ utilise: 0.25, reinitialiseA: 1_900_000_000_000 }, { utilise: 0.6, reinitialiseA: 1_900_500_000_000 }, "allowed"]);
  ok("limites de l’abonnement ChatGPT reçues pendant une réponse et servies par le VPS (5 h 25 %, semaine 60 %)");

  /* 6. Une session inconnue (d'un autre moteur) : un nouveau fil, sans erreur. */
  const etrangere = await reponse("r3", { prompt: "TEXTE trois", sessionId: "00000000-0000-4000-8000-000000000000", conversation: "chat-autre" });
  assert.equal(etrangere.at(-1).ok, true, etrangere.at(-1).erreur);
  assert.ok(etrangere.some((e) => e.type === "session"));
  ok("session d’un autre moteur : la conversation repart sur un nouveau fil");

  /* 7. Autorisation demandée par Codex, acceptée depuis l'app. */
  const accepte = await reponse("r4", { prompt: "COMMANDE", acces: "demander", conversation: "chat-commande" }, async (e) => {
    if (e.type === "autorisation") assert.equal((await appel("/klyra/v1/agent/autoriser", "POST", { requestId: "r4", demandeId: e.id, decision: "oui" })).json.ok, true);
  });
  assert.ok(accepte.some((e) => e.type === "autorisation"), "pas de carte d’autorisation");
  assert.equal(accepte.find((e) => e.type === "autorisation-fin")?.accepte, true);
  assert.equal(accepte.at(-1).texte, "Commande faite");
  ok("autorisation demandée sur le VPS, acceptée depuis l’app");

  /* 8. Arrêt en cours de réponse. */
  const arretee = await reponse("r5", { prompt: "LENT", conversation: "chat-lent" }, async (e, tous) => {
    if (e.type === "texte" && tous.filter((x) => x.type === "texte").length === 1) await appel("/klyra/v1/agent/annuler", "POST", { requestId: "r5" });
  });
  assert.equal(arretee.at(-1).ok, false);
  assert.equal(arretee.at(-1).erreur, "Arrêté par toi.");
  ok("arrêt depuis l’app : « Arrêté par toi. »");

  /* 9. L'IA retirée : la liste se vide. */
  assert.deepEqual((await appel("/klyra/v1/ia/retirer", "POST", { id: ajout.json.liste[0].id })).json.liste, []);
  ok("IA retirée");
} finally {
  await serveur.fermer();
  openai.fermer();
  fausseIa.close();
  rmSync(TMP, { recursive: true, force: true });
}
console.log("Fournisseurs du VPS : tout est bon.");
process.exit(0);
