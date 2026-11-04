/**
 * Les skills de Claude pour un agent qui travaille avec ChatGPT : le vrai Codex, lancé par le vrai serveur
 * KLYRA (serveur/agents.mjs, serveur/codex.mjs), face au faux serveur « Responses » d'OpenAI. Aucun compte,
 * aucune dépense ; dossier de klyra et CODEX_HOME jetables.
 * Codex ne lit pas `.claude/skills` (seulement `CODEX_HOME/skills` et `.agents/skills`, vérifié avec Codex
 * 0.166). Chaque agent a son processus et son dossier préparé : seulement ses skills allumées.
 * Vérifie :
 * - la skill allumée est dans le dossier préparé et dans les skills de Codex ;
 * - une skill coupée pour un agent n'y est pas, et son processus est distinct ;
 * - la skill que la fiche précharge arrive avec son texte ;
 * - `/rangement` demandé : Codex reçoit d'abord la consigne de lire ce fichier, puis le message.
 *   KLYRA_CODEX_PATH=/chemin/codex node scripts/test-skills-codex.mjs
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-skills-codex-"));
const HOME = path.join(TMP, "klyra");
const DONNEES = path.join(HOME, "donnees");
const CODEX_HOME = path.join(TMP, "codex");
for (const d of [DONNEES, CODEX_HOME, path.join(HOME, ".claude", "skills", "rangement")]) mkdirSync(d, { recursive: true });
writeFileSync(path.join(HOME, ".claude", "skills", "rangement", "SKILL.md"), "---\nname: rangement\ndescription: Range les fichiers par type.\n---\n\nTEXTE-RANGEMENT : trie par extension.\n");
process.env.CODEX_HOME = CODEX_HOME;
process.env.FAUX_CLE = "sk-faux-essai";
const ok = (texte) => console.log(`OK     ${texte}`);

const { creerAgents } = await import("../serveur/agents.mjs");
const { creerCode, creerJournal, ecouter } = await import("../serveur/klyra-serveur.mjs");

const openai = await demarrerFauxOpenAI();
writeFileSync(path.join(CODEX_HOME, "config.toml"), configCodex(openai.url));

const journal = creerJournal();
const evenements = new Map();
const publier = (requestId, event, sessionId) => {
  journal.publier(requestId, event, sessionId);
  if (!evenements.has(requestId)) evenements.set(requestId, []);
  evenements.get(requestId).push(event);
};
const agents = creerAgents({ home: HOME, donnees: DONNEES, nomServeur: "essai", publier, spontane: journal.spontane, claude: null, codex: bin });
const serveur = await ecouter({ nom: "essai", dossier: DONNEES, journal, agents });
const base = `http://127.0.0.1:${serveur.port}`;
const { jeton } = await (await fetch(`${base}/klyra/v1/appairer`, { method: "POST", body: JSON.stringify({ code: creerCode(DONNEES), appareil: "essai" }) })).json();
const appel = async (chemin, methode = "GET", corps) => {
  const r = await fetch(`${base}${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}` }, ...(corps ? { body: JSON.stringify(corps) } : {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
async function reponse(requestId, options) {
  assert.equal((await appel("/klyra/v1/agent/envoyer", "POST", { requestId, options: { sessionId: null, acces: "tout", moteur: "codex", ...options } })).status, 202);
  const debut = Date.now();
  while (Date.now() - debut < 60_000) {
    const liste = evenements.get(requestId) ?? [];
    if (liste.at(-1)?.type === "fin") return liste;
    await new Promise((f) => setTimeout(f, 50));
  }
  throw new Error(`délai dépassé (${requestId}) : ${JSON.stringify(evenements.get(requestId)).slice(0, 600)}`);
}
/** Ce que Codex a envoyé au modèle : ses consignes (rôle developer) et le dernier message de la personne. */
const lu = (requete) => {
  const messages = requete.input.filter((i) => i.type === "message");
  const texte = (m) => (m.content ?? []).map((c) => c.text ?? "").join("\n");
  return { consignes: messages.filter((m) => m.role === "developer").map(texte).join("\n"), demande: texte(messages.filter((m) => m.role === "user").at(-1) ?? {}) };
};

try {
  /* L'équipe du PC : Hugo, dont la fiche précharge la skill. */
  const fiche = "---\nname: hugo\nskills:\n  - rangement\n---\nTu es Hugo.";
  assert.equal((await appel("/klyra/v1/agents/fiches", "PUT", { fiches: [{ id: "hugo", nom: "Hugo", contenu: fiche }], assistant: "Sam", empreinte: "e1" })).status, 200);

  /* L'assistant, sans préchargement : la skill de Claude lui est présentée par son fichier. */
  const r1 = await reponse("c1", { agent: null, prompt: "bonjour", conversation: "chat-1" });
  assert.equal(r1.at(-1).ok, true, r1.at(-1).erreur);
  const a = lu(openai.requetes.at(-1));
  const blocSkills = (consignes) => consignes.split("<skills_instructions>")[1]?.split("</skills_instructions>")[0] ?? "";
  assert.match(a.consignes, /<skills_instructions>/);
  assert.match(blocSkills(a.consignes), /rangement/, "la skill allumée est dans le dossier préparé de Codex");
  assert.match(a.consignes, /- rangement: Range les fichiers par type\. \(fichier : .*\.claude\/skills\/rangement\/SKILL\.md\)/);
  assert.doesNotMatch(a.consignes, /TEXTE-RANGEMENT/);
  assert.equal(existsSync(path.join(DONNEES, "preparation-codex", "principal", "skills", "rangement", "SKILL.md")), true);
  ok("l’assistant a son dossier Codex, avec seulement la skill allumée");

  /* Hugo : la skill que sa fiche précharge arrive avec son texte. */
  const r2 = await reponse("c2", { agent: "hugo", prompt: "bonjour", conversation: "chat-2" });
  assert.equal(r2.at(-1).ok, true, r2.at(-1).erreur);
  assert.match(lu(openai.requetes.at(-1)).consignes, /<competence nom="rangement">[\s\S]*TEXTE-RANGEMENT : trie par extension\./);
  ok("la skill préchargée par la fiche arrive avec son texte");

  /* « /rangement » demandé : la consigne de lire le fichier passe devant le message de l'app. */
  const prompt = "[Contexte] Essai.\n\n[Message de Corentin]\n/rangement range le dossier";
  const r3 = await reponse("c3", { agent: null, prompt, conversation: "chat-3", skill: "rangement" });
  assert.equal(r3.at(-1).ok, true, r3.at(-1).erreur);
  assert.match(lu(openai.requetes.at(-1)).demande, /^\[La personne demande la compétence « rangement » : lis .*rangement\/SKILL\.md avant de répondre, et suis-la\.\]\n\n\[Contexte\] Essai\./);
  ok("/rangement : Codex reçoit d’abord la compétence à lire, puis le message");

  /* Iris a la skill coupée : son processus et son dossier ne la reçoivent pas. Hugo la garde. */
  const choix = {
    fige: true,
    personnellesConnues: ["rangement"],
    agentsConnus: ["principal", "hugo", "iris"],
    coupees: { iris: ["rangement"] },
    activees: {},
  };
  const ficheIris = "---\nname: iris\n---\nTu es Iris.";
  assert.equal((await appel("/klyra/v1/agents/fiches", "PUT", {
    fiches: [{ id: "hugo", nom: "Hugo", contenu: fiche }, { id: "iris", nom: "Iris", contenu: ficheIris }],
    assistant: "Sam",
    skillsParAgent: choix,
    empreinte: "e2",
  })).status, 200);
  const r4 = await reponse("c4", { agent: "iris", prompt: "bonjour", conversation: "chat-4" });
  assert.equal(r4.at(-1).ok, true, r4.at(-1).erreur);
  const iris = lu(openai.requetes.at(-1));
  assert.doesNotMatch(blocSkills(iris.consignes), /rangement/);
  assert.doesNotMatch(iris.consignes, /fichier : .*rangement\/SKILL\.md/);
  assert.equal(existsSync(path.join(DONNEES, "preparation-codex", "iris", "skills", "rangement")), false);
  assert.equal(existsSync(path.join(DONNEES, "preparation-codex", "hugo", "skills", "rangement", "SKILL.md")), true);
  const homes = new Set();
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`).toString();
      if (!cmd.includes("app-server")) continue;
      const env = readFileSync(`/proc/${pid}/environ`).toString().split("\0");
      const dossier = env.find((ligne) => ligne.startsWith("CODEX_HOME="))?.slice("CODEX_HOME=".length);
      if (dossier?.includes(`${path.sep}preparation-codex${path.sep}`)) homes.add(dossier);
    } catch {
      /* processus déjà terminé */
    }
  }
  assert.ok(homes.size >= 2, `un processus Codex par agent, trouvés : ${[...homes].join(", ")}`);
  ok("Iris n’a pas la skill coupée ; Hugo et Iris n’ont pas le même processus");
  console.log("\nSkills de Claude pour Codex : tout est vérifié.");
} finally {
  agents.fermerTout();
  await serveur.fermer();
  openai.fermer();
  rmSync(TMP, { recursive: true, force: true });
}
