/**
 * Les skills de Claude pour un agent qui travaille avec ChatGPT : le vrai Codex, lancé par le vrai serveur
 * KLYRA (serveur/agents.mjs, serveur/codex.mjs), face au faux serveur « Responses » d'OpenAI. Aucun compte,
 * aucune dépense ; dossier de klyra et CODEX_HOME jetables.
 * Codex ne lit pas `.claude/skills` (seulement `.codex/skills` et `.agents/skills`, vérifié avec Codex
 * 0.166) : l'app les lui présente comme il présente les siennes. Vérifie :
 * - sans l'app, Codex ne voit pas la skill de Claude ; avec l'app, elle est présentée avec son fichier ;
 * - la skill que la fiche de l'agent précharge arrive avec son texte ;
 * - `/rangement` demandé : Codex reçoit d'abord la consigne de lire ce fichier, puis le message.
 *   KLYRA_CODEX_PATH=/chemin/codex node scripts/test-skills-codex.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  assert.match(a.consignes, /<skills_instructions>/, "Codex ne présente plus ses propres skills");
  assert.doesNotMatch(a.consignes.split("<skills_instructions>")[1].split("</skills_instructions>")[0], /rangement/, "Codex lit maintenant .claude/skills tout seul");
  assert.match(a.consignes, /- rangement: Range les fichiers par type\. \(fichier : .*\.claude\/skills\/rangement\/SKILL\.md\)/);
  assert.doesNotMatch(a.consignes, /TEXTE-RANGEMENT/);
  ok("Codex ne lit pas .claude/skills ; l’app lui présente la skill de Claude par son fichier");

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
  console.log("\nSkills de Claude pour Codex : tout est vérifié.");
} finally {
  agents.fermerTout();
  await serveur.fermer();
  openai.fermer();
  rmSync(TMP, { recursive: true, force: true });
}
