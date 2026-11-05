import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { creerAgents } from "./agents.mjs";
import { filtreSkills, nomsSkills } from "./connaissances-agent.mjs";
import { preparerSessionClaude } from "./preparation-fournisseur.mjs";
import { creerIa } from "./ia.mjs";
import { VERSION_CODE_SERVEUR } from "./version-code.mjs";
import { CHEMIN, CHEMIN_AGENT, CHEMIN_APPAIRER, CHEMIN_APPAREIL, CHEMIN_FICHES, CHEMIN_RENDUS, DUREE_CODE_MS, cleConversation, contexteTelephone, creerCode, creerJournal, ecouter, lireAppareils, revoquerTout } from "./klyra-serveur.mjs";

function dossierJetable() {
  return mkdtempSync(path.join(tmpdir(), "klyra-serveur-"));
}

async function appel(port, chemin, { methode = "GET", jeton, corps } = {}) {
  const headers = {};
  if (jeton) headers.Authorization = `Bearer ${jeton}`;
  if (corps !== undefined) headers["Content-Type"] = "application/json";
  const reponse = await fetch(`http://127.0.0.1:${port}${chemin}`, {
    method: methode,
    headers,
    body: corps === undefined ? undefined : JSON.stringify(corps),
    cache: "no-store",
  });
  const texte = await reponse.text();
  let json = null;
  try {
    json = JSON.parse(texte);
  } catch {
    json = null;
  }
  return { statut: reponse.status, json, texte, origine: reponse.headers.get("access-control-allow-origin") };
}

test("un equipe.json écrit par un ancien serveur n’annonce pas d’empreinte : l’app renvoie l’équipe", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const journal = creerJournal();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents });
  const fichier = path.join(dossier, "equipe.json");
  try {
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const annonce = async () => (await appel(ecoute.port, CHEMIN, { jeton })).json.equipe;
    const base = { assistant: "Cicco", actifs: [], empreinte: "e1" };
    const configuration = { memoireAgents: true, consignes: null, navigateur: false, coffre: true };

    assert.equal(await annonce(), "", "aucun fichier");
    writeFileSync(fichier, JSON.stringify(base));
    assert.equal(await annonce(), "", "sans configuration");
    writeFileSync(fichier, JSON.stringify({ ...base, configuration: { memoireAgents: true, consignes: null, navigateur: false }, skillsParAgent: {} }));
    assert.equal(await annonce(), "", "sans le Coffre");
    writeFileSync(fichier, JSON.stringify({ ...base, configuration }));
    assert.equal(await annonce(), "", "sans les skills par agent");
    writeFileSync(fichier, JSON.stringify({ ...base, configuration, skillsParAgent: {} }));
    assert.equal(await annonce(), "e1", "fichier complet");

    // Ce que ce serveur écrit lui-même est toujours complet, même sans configuration reçue : pas d'envoi en boucle.
    writeFileSync(fichier, JSON.stringify(base));
    assert.equal((await appel(ecoute.port, CHEMIN_FICHES, { methode: "PUT", jeton, corps: { fiches: [], assistant: "Cicco", empreinte: "e1" } })).json.equipe, "e1");
    assert.equal(await annonce(), "e1");
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("le client et le VPS partagent les chemins", () => {
  const lecture = readFileSync(new URL("../electron/lecture-serveur.ts", import.meta.url), "utf8");
  assert.match(lecture, /export const CHEMIN_SERVEUR = "\/klyra\/v1\/serveur"/);
  assert.match(lecture, /export const CHEMIN_APPAIRER = "\/klyra\/v1\/appairer"/);
  assert.match(lecture, /export const CHEMIN_APPAREIL = "\/klyra\/v1\/appareil"/);
  assert.equal(CHEMIN, "/klyra/v1/serveur");
});

test("lancer.sh pose tout ce que le serveur importe, sinon il ne démarre plus sur le VPS", () => {
  const ici = import.meta.dirname;
  const poses = new Set([...readFileSync(path.join(ici, "lancer.sh"), "utf8").matchAll(/\$SOURCE\/([\w.-]+\.mjs)/g)].map((m) => m[1]));
  const vus = new Set();
  const suivre = (nom) => {
    if (vus.has(nom)) return;
    vus.add(nom);
    const code = readFileSync(path.join(ici, nom), "utf8");
    for (const [, importe] of code.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']\.\/([\w.-]+\.mjs)["']/g)) suivre(importe);
  };
  suivre("klyra-serveur.mjs");
  assert.ok(vus.has("version-code.mjs"), "le serveur lit sa version");
  assert.deepEqual([...vus].filter((nom) => !poses.has(nom)), []);
});

test("un code s’échange une fois contre un jeton, qui ouvre le serveur", async () => {
  const dossier = dossierJetable();
  const ecoute = await ecouter({ nom: "Klyra-vps", dossier, port: 0 });
  try {
    const sansJeton = await appel(ecoute.port, CHEMIN);
    assert.equal(sansJeton.statut, 401);
    assert.equal(sansJeton.origine, "*");

    const code = creerCode(dossier);
    assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
    const appaire = await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: code.toLowerCase(), appareil: "PC de test" } });
    assert.equal(appaire.statut, 200);
    assert.equal(appaire.json.produit, "klyra-serveur");
    assert.equal(appaire.json.nom, "Klyra-vps");
    const jeton = appaire.json.jeton;
    assert.match(jeton, /^[A-Za-z0-9_-]{43}$/);

    const encore = await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code } });
    assert.equal(encore.statut, 401, "un code ne sert qu’une fois");

    const lu = await appel(ecoute.port, CHEMIN, { jeton });
    assert.deepEqual(lu.json, { produit: "klyra-serveur", protocole: 1, nom: "Klyra-vps", version: "1", versionCode: VERSION_CODE_SERVEUR, agents: "absent", equipe: "" });
    assert.equal(appaire.json.versionCode, VERSION_CODE_SERVEUR, "l’appairage annonce aussi la version du code");
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton: `${jeton.slice(0, -2)}xx` })).statut, 401);

    // Le serveur ne garde que des empreintes.
    const stockes = readFileSync(path.join(dossier, "appareils.json"), "utf8");
    assert.equal(stockes.includes(jeton), false);
    assert.equal(readFileSync(path.join(dossier, "codes.json"), "utf8").includes(code), false);
    assert.equal(lireAppareils(dossier)[0].nom, "PC de test");
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("un code expire, et trop d’essais font tomber les codes en attente", async () => {
  const dossier = dossierJetable();
  let horloge = 1_000_000;
  const ecoute = await ecouter({ dossier, port: 0, maintenant: () => horloge });
  try {
    const vieux = creerCode(dossier, horloge);
    horloge += DUREE_CODE_MS + 1;
    assert.equal((await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: vieux } })).statut, 401);

    const bon = creerCode(dossier, horloge);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: `FAUX${i}` } })).statut, 401);
    }
    assert.equal((await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: bon } })).statut, 401);

    const corpsIllisible = await fetch(`http://127.0.0.1:${ecoute.port}${CHEMIN_APPAIRER}`, { method: "POST", body: "x".repeat(5000) });
    assert.equal(corpsIllisible.status, 401);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("un appareil se retire lui-même, et tout peut être révoqué", async () => {
  const dossier = dossierJetable();
  const ecoute = await ecouter({ dossier, port: 0 });
  try {
    const jetonDe = async () => (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const un = await jetonDe();
    const deux = await jetonDe();

    assert.equal((await appel(ecoute.port, CHEMIN_APPAREIL, { methode: "DELETE" })).statut, 401);
    assert.equal((await appel(ecoute.port, CHEMIN_APPAREIL, { methode: "DELETE", jeton: un })).statut, 204);
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton: un })).statut, 401);
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton: deux })).statut, 200);

    revoquerTout(dossier);
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton: deux })).statut, 401);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("la page publique ne montre ni lien ni code, le reste est fermé", async () => {
  const dossier = dossierJetable();
  const ecoute = await ecouter({ nom: "Klyra-vps", dossier, port: 0 });
  try {
    const code = creerCode(dossier);
    const page = await appel(ecoute.port, "/");
    assert.equal(page.statut, 200);
    assert.match(page.texte, /Klyra-vps/);
    assert.doesNotMatch(page.texte, /klyra:\/\/|<svg|<script/);
    assert.equal(page.texte.includes(code), false);

    const options = await fetch(`http://127.0.0.1:${ecoute.port}${CHEMIN}`, { method: "OPTIONS" });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("access-control-allow-headers"), "Authorization, Content-Type");

    assert.equal((await appel(ecoute.port, "/rejoindre")).statut, 404);
    assert.equal((await appel(ecoute.port, "/tarif")).statut, 404);
    assert.equal((await appel(ecoute.port, CHEMIN, { methode: "POST" })).statut, 405);
    assert.equal((await appel(ecoute.port, CHEMIN_APPAIRER)).statut, 405);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
  await assert.rejects(fetch(`http://127.0.0.1:${ecoute.port}${CHEMIN}`));
});

/** Un faux Claude Code : répond « Bonjour <message> » en flux, et demande l'accord avant un outil si le message contient « outil ». */
const FAUX_CLAUDE = `#!/usr/bin/env node
const args = process.argv.slice(2);
require("node:fs").appendFileSync(process.env.HOME + "/args.log", JSON.stringify(args) + "\\n");
require("node:fs").appendFileSync(process.env.HOME + "/env.log", JSON.stringify({ memoireCoupee: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === "1" }) + "\\n");
let tours = 0;
const usage = () => ({ "claude-opus-5-5": { inputTokens: 10 * tours, outputTokens: 5 * tours, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 * tours } });
const ecrire = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const session = "11111111-2222-3333-4444-555555555555";
let attente = null;
let tampon = "";
process.stdin.on("data", (d) => {
  tampon += d;
  const lignes = tampon.split("\\n");
  tampon = lignes.pop();
  for (const l of lignes) {
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    if (m.type === "user") {
      ecrire({ type: "system", subtype: "init", session_id: session });
      if (m.message.content.includes("outil")) {
        attente = m.message.content;
        ecrire({ type: "control_request", request_id: "d1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
        continue;
      }
      ecrire({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Bonjour " + m.message.content } } });
      tours += 1;
      ecrire({ type: "result", subtype: "success", is_error: false, result: "Bonjour " + m.message.content, session_id: session, modelUsage: usage() });
    }
    if (m.type === "control_response" && attente) {
      const ok = m.response.response.behavior === "allow";
      ecrire({ type: "result", subtype: "success", is_error: false, result: ok ? "outil lancé" : "refusé", session_id: session });
      attente = null;
    }
  }
});
`;

function lireFlux(port, jeton, depuis, instance, jusqua, requete = null) {
  return new Promise((resolve, reject) => {
    const controle = new AbortController();
    const recus = [];
    let instanceRecue = null;
    fetch(`http://127.0.0.1:${port}${CHEMIN_AGENT}/evenements?depuis=${depuis}&instance=${instance}${requete ? `&requete=${requete}` : ""}`, { headers: { Authorization: `Bearer ${jeton}` }, signal: controle.signal })
      .then(async (reponse) => {
        const lecteur = reponse.body.getReader();
        let tampon = "";
        for (;;) {
          const { value, done } = await lecteur.read();
          if (done) break;
          tampon += new TextDecoder().decode(value);
          const blocs = tampon.split("\n\n");
          tampon = blocs.pop();
          for (const bloc of blocs) {
            const data = bloc.split("\n").find((l) => l.startsWith("data: "));
            if (!data) continue;
            const json = JSON.parse(data.slice(6));
            if (bloc.startsWith("event: instance")) instanceRecue = json.instance;
            else recus.push(json);
            if (jusqua(recus)) {
              controle.abort();
              return resolve({ recus, instance: instanceRecue });
            }
          }
        }
      })
      .catch((e) => (e.name === "AbortError" ? null : reject(e)));
    setTimeout(() => {
      controle.abort();
      reject(new Error(`flux incomplet : ${JSON.stringify(recus)}`));
    }, 5000);
  });
}

test("un agent répond sur le VPS, en flux, avec rattrapage et autorisation", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const claude = path.join(home, "faux-claude");
  writeFileSync(claude, FAUX_CLAUDE);
  chmodSync(claude, 0o755);
  writeFileSync(path.join(dossier, "claude-token"), "jeton-claude");
  const journal = creerJournal();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane, claude });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents });
  try {
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", corps: { requestId: "r0" } })).statut, 401);
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton })).json.agents, "pret");

    const fiches = await appel(ecoute.port, CHEMIN_FICHES, {
      methode: "PUT",
      jeton,
      corps: { fiches: [{ id: "lou", nom: "Lou", contenu: "---\nname: lou\n---\nPrompt." }], assistant: "Cicco", empreinte: "e1" },
    });
    assert.equal(fiches.statut, 200);
    assert.equal(fiches.json.equipe, "e1");
    assert.equal(readFileSync(path.join(home, ".claude", "agents", "lou.md"), "utf8").includes("Prompt."), true);
    assert.equal((await appel(ecoute.port, CHEMIN_FICHES, { methode: "PUT", jeton, corps: { fiches: [{ id: "../x", contenu: "" }] } })).statut, 400);

    const options = { agent: null, prompt: "toi", sessionId: null, acces: "projet" };
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r1", options: { ...options, conversation: "dm-lou" } } })).statut, 202);
    const premier = await lireFlux(ecoute.port, jeton, 0, "", (recus) => recus.some((e) => e.event?.type === "fin"));
    const types = premier.recus.map((e) => e.event.type).filter((t) => t !== "jetons");
    assert.deepEqual(types, ["session", "texte", "fin"]);
    assert.equal(premier.recus.at(-1).event.texte, "Bonjour toi");
    assert.equal(premier.recus.at(-1).requestId, "r1");
    const args = readFileSync(path.join(home, "args.log"), "utf8");
    assert.match(args, /Klyra-VPS/);
    assert.match(args, /Cicco/);

    // Rattrapage : depuis le dernier numéro lu, seulement la suite.
    const dernier = premier.recus.at(-1).seq;
    await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r2", options: { ...options, prompt: "outil", sessionId: "11111111-2222-3333-4444-555555555555" } } });
    const demande = await lireFlux(ecoute.port, jeton, dernier, premier.instance, (recus) => recus.some((e) => e.event?.type === "autorisation"));
    assert.equal(demande.recus.every((e) => e.seq > dernier), true);
    const id = demande.recus.find((e) => e.event?.type === "autorisation").event.id;
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/autoriser`, { methode: "POST", jeton, corps: { requestId: "r2", demandeId: id, decision: "oui" } })).json.ok, true);
    const fin = await lireFlux(ecoute.port, jeton, dernier, premier.instance, (recus) => recus.some((e) => e.event?.type === "fin"));
    assert.equal(fin.recus.find((e) => e.event?.type === "fin").event.texte, "outil lancé");

    // Une autre instance du journal (serveur redémarré) : tout est renvoyé depuis le début.
    const autre = await lireFlux(ecoute.port, jeton, 9999, "ancienne", (recus) => recus.length >= 3);
    assert.equal(autre.recus[0].seq, 1);

    // Le téléphone écrit, PC fermé : chaque événement de la réponse porte sa conversation et son message.
    const contexte = { chatId: "dm-lou", agentId: "lou", titre: "Lou", telephone: { messageId: "tel-1", texte: "toi", creeLe: "2026-11-02T10:00:00.000Z" } };
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r4", options, contexte } })).statut, 202);
    const duTelephone = await lireFlux(ecoute.port, jeton, 0, premier.instance, (recus) => recus.some((e) => e.requestId === "r4" && e.event?.type === "fin"));
    const r4 = duTelephone.recus.filter((e) => e.requestId === "r4");
    assert.equal(r4.length > 0 && r4.every((e) => e.contexte?.telephone?.messageId === "tel-1" && e.contexte.chatId === "dm-lou"), true);
    // Sans session (le compte n'en garde pas), le téléphone reprend celle que le PC avait dans cette conversation.
    assert.equal(journal.sessionDe(cleConversation("dm-lou", null)), "11111111-2222-3333-4444-555555555555");
    // Le téléphone ne suit que sa réponse.
    const filtre = await lireFlux(ecoute.port, jeton, 0, premier.instance, (recus) => recus.some((e) => e.event?.type === "fin"), "r4");
    assert.equal(filtre.recus.every((e) => e.requestId === "r4"), true);
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r5", options, contexte: { ...contexte, chatId: "../x" } } })).statut, 400);

    const inconnu = await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r3", options: { ...options, agent: "absent" } } });
    assert.equal(inconnu.statut, 202);
    const refus = await lireFlux(ecoute.port, jeton, 0, premier.instance, (recus) => recus.some((e) => e.requestId === "r3"));
    assert.match(refus.recus.find((e) => e.requestId === "r3").event.erreur, /pas dans Mes agents/);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("les compétences d'un agent du VPS : lues sur le serveur, préchargées, et /skill remis en tête", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const claude = path.join(home, "faux-claude");
  writeFileSync(claude, FAUX_CLAUDE);
  chmodSync(claude, 0o755);
  writeFileSync(path.join(dossier, "claude-token"), "jeton-claude");
  mkdirSync(path.join(home, ".claude", "skills", "rangement"), { recursive: true });
  writeFileSync(path.join(home, ".claude", "skills", "rangement", "SKILL.md"), "---\nname: rangement\ndescription: Range les fichiers.\nversion: 3\n---\n\nTEXTE-RANGEMENT\n");
  const projet = path.join(home, "projets", "site");
  mkdirSync(path.join(projet, ".claude", "skills", "deploi"), { recursive: true });
  writeFileSync(path.join(projet, ".claude", "skills", "deploi", "SKILL.md"), "---\nname: deploi\ndescription: Déploie.\n---\n\nTEXTE-DEPLOI\n");
  const journal = creerJournal();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane, claude });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents });
  const competences = (jeton, agent, projetVps = null) =>
    appel(ecoute.port, `${CHEMIN_AGENT}/competences?agent=${encodeURIComponent(agent)}${projetVps ? `&dossier=${encodeURIComponent(projetVps)}` : ""}`, { jeton });
  try {
    assert.equal((await competences(undefined, "lou")).statut, 401);
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    // La fiche arrive du PC avec ses skills en liste, comme l'app les écrit.
    const fiche = "---\nname: lou\nskills:\n  - rangement\n  - absente\n---\nPrompt de Lou.";
    assert.equal((await appel(ecoute.port, CHEMIN_FICHES, { methode: "PUT", jeton, corps: { fiches: [{ id: "lou", nom: "Lou", contenu: fiche }], assistant: "Cicco", empreinte: "e1" } })).statut, 200);

    const lues = (await competences(jeton, "lou", projet)).json.competences;
    assert.deepEqual(lues.fiche.map((c) => [c.nom, c.version, !!c.dossier]), [["rangement", "3", true], ["absente", null, false]]);
    assert.deepEqual(lues.poste.map((c) => c.nom), ["rangement"]);
    assert.deepEqual(lues.projet.map((c) => [c.nom, c.description]), [["deploi", "Déploie."]]);
    // L'assistant n'a pas de fiche ; sans projet, pas de skills de projet.
    const assistant = (await competences(jeton, "principal")).json.competences;
    assert.deepEqual([assistant.fiche, assistant.projet, assistant.poste.map((c) => c.nom)], [[], [], ["rangement"]]);
    // Réglages du serveur › Général : ce que la configuration de Claude Code du VPS ajoute, ses agents actifs compris.
    const diagnostic = (await appel(ecoute.port, `${CHEMIN_AGENT}/diagnostic`, { jeton })).json.diagnostic;
    assert.deepEqual(diagnostic.elements.map((e) => e.cle), ["claude-md", "skills", "agents", "plugins", "mcp"]);
    assert.match(diagnostic.elements.find((e) => e.cle === "skills").detail, /rangement/);
    assert.ok(diagnostic.elements.find((e) => e.cle === "agents").jetons > 0);
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/diagnostic`, {})).statut, 401);
    // Hors du dossier de klyra, ou un nom d'agent qui sort de son dossier : refusé.
    assert.equal((await competences(jeton, "lou", "/etc")).statut, 400);
    assert.equal((await competences(jeton, "../x")).statut, 400);
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/competences?agent=lou`, { methode: "POST", jeton, corps: {} })).statut, 405);

    // Lou lancé seul reçoit sa skill préchargée ; « /rangement » passe devant le message de l'app.
    const options = { agent: "lou", prompt: "[Contexte] Essai.\n\n[Message de Corentin]\n/rangement range", sessionId: null, acces: "projet", skill: "rangement" };
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "s1", options } })).statut, 202);
    const flux = await lireFlux(ecoute.port, jeton, 0, "", (recus) => recus.some((e) => e.requestId === "s1" && e.event?.type === "fin"));
    assert.equal(flux.recus.find((e) => e.requestId === "s1" && e.event.type === "fin").event.texte, `Bonjour /rangement\n\n${options.prompt}`);
    const args = readFileSync(path.join(home, "args.log"), "utf8");
    assert.match(args, /TEXTE-RANGEMENT/);
    assert.match(args, /Introuvables sur ce poste, donc absentes : absente/);
    // Une compétence au nom invalide : la demande est refusée.
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "s2", options: { ...options, skill: "../x" } } })).statut, 202);
    const refus = await lireFlux(ecoute.port, jeton, 0, "", (recus) => recus.some((e) => e.requestId === "s2"));
    assert.match(refus.recus.find((e) => e.requestId === "s2").event.erreur, /Compétence invalide/);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("la mémoire d'un agent du VPS, la configuration KLYRA reçue avec l'équipe et la consommation, comme sur le PC", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const claude = path.join(home, "faux-claude");
  writeFileSync(claude, FAUX_CLAUDE);
  chmodSync(claude, 0o755);
  writeFileSync(path.join(dossier, "claude-token"), "jeton-claude");
  const projet = path.join(home, "projets", "site");
  mkdirSync(projet, { recursive: true });
  const journal = creerJournal();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane, claude });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents });
  const lire = (jeton, action, params) => appel(ecoute.port, `${CHEMIN_AGENT}/${action}?${new URLSearchParams(params)}`, { jeton });
  try {
    assert.equal((await lire(undefined, "memoire", { agent: "hugo" })).statut, 401);
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const fiches = [
      { id: "hugo", nom: "Hugo", contenu: "---\nname: hugo\nmemory: user\n---\nPrompt." },
      { id: "iris", nom: "Iris", contenu: "---\nname: iris\nmemory: project\n---\nPrompt." },
      { id: "lou", nom: "Lou", contenu: "---\nname: lou\n---\nPrompt." },
    ];
    // La configuration KLYRA du PC arrive avec l'équipe : mémoire coupée, consignes.
    const equipe = (configuration, empreinte) => appel(ecoute.port, CHEMIN_FICHES, { methode: "PUT", jeton, corps: { fiches, assistant: "Cicco", configuration, empreinte } });
    assert.equal((await equipe({ memoireAgents: false, consignes: "CONSIGNES-KLYRA-ESSAI" }, "e1")).statut, 200);

    // Sans mémoire dans sa fiche : null ; avec : vide tant qu'il n'a rien retenu.
    assert.equal((await lire(jeton, "memoire", { agent: "lou" })).json.memoire, null);
    const vide = (await lire(jeton, "memoire", { agent: "hugo" })).json.memoire;
    assert.equal(vide.portee, "user");
    assert.equal(vide.dossier, path.join(home, ".claude", "agent-memory", "hugo"));
    assert.deepEqual(vide.souvenirs, []);

    // Un souvenir ajouté depuis l'app : son fichier, sa ligne dans l'index, relus par l'agent.
    const cree = await appel(ecoute.port, `${CHEMIN_AGENT}/souvenir-creer`, { methode: "POST", jeton, corps: { agent: "hugo", titre: "Ton de Corentin", contenu: "Tutoiement, phrases courtes." } });
    assert.equal(cree.statut, 200);
    assert.equal(cree.json.souvenir.id, "ton-de-corentin.md");
    const liste = (await lire(jeton, "memoire", { agent: "hugo" })).json.memoire.souvenirs;
    assert.deepEqual(liste.map((x) => [x.id, x.toujours]), [["MEMORY.md", true], ["ton-de-corentin.md", false]]);
    const lu = (await lire(jeton, "souvenir", { agent: "hugo", id: "ton-de-corentin.md" })).json.souvenir;
    assert.match(lu.contenu, /Tutoiement, phrases courtes\./);
    const ecrit = await appel(ecoute.port, `${CHEMIN_AGENT}/souvenir-ecrire`, { methode: "POST", jeton, corps: { agent: "hugo", id: "ton-de-corentin.md", contenu: `${lu.contenu}Vouvoiement jamais.`, attendu: lu.modifieLe } });
    assert.equal(ecrit.statut, 200);
    assert.match(readFileSync(path.join(home, ".claude", "agent-memory", "hugo", "ton-de-corentin.md"), "utf8"), /Vouvoiement jamais\./);
    // Changé entre-temps : refusé, rien d'écrasé ; hors de la mémoire : refusé.
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/souvenir-ecrire`, { methode: "POST", jeton, corps: { agent: "hugo", id: "ton-de-corentin.md", contenu: "écrasé", attendu: lu.modifieLe - 60_000 } })).statut, 409);
    assert.equal((await lire(jeton, "souvenir", { agent: "hugo", id: "../../agents/hugo.md" })).statut, 400);
    assert.equal((await lire(jeton, "memoire", { agent: "../x" })).statut, 400);
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/memoire?agent=hugo`, { methode: "POST", jeton, corps: {} })).statut, 405);
    // Portée « project » : dans le projet ; un projet hors du dossier de klyra est refusé.
    assert.equal((await lire(jeton, "memoire", { agent: "iris", dossier: projet })).json.memoire.dossier, path.join(projet, ".claude", "agent-memory", "iris"));
    assert.equal((await lire(jeton, "memoire", { agent: "iris", dossier: "/etc" })).statut, 400);
    // L'assistant : la mémoire automatique de son atelier sur le VPS.
    const auto = (await lire(jeton, "memoire", { agent: "principal" })).json.memoire;
    assert.equal(auto.portee, "auto");
    assert.equal(auto.dossier, path.join(home, ".claude", "projects", path.join(home, "atelier", "principal").replace(/[^a-zA-Z0-9]/g, "-"), "memory"));

    // Une session du VPS reçoit cette configuration, comme une session de l'app.
    const options = { agent: "hugo", prompt: "toi", sessionId: null, acces: "projet" };
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "m1", options } })).statut, 202);
    const fin1 = await lireFlux(ecoute.port, jeton, 0, "", (recus) => recus.some((e) => e.requestId === "m1" && e.event?.type === "fin"));
    assert.match(readFileSync(path.join(home, "args.log"), "utf8"), /CONSIGNES-KLYRA-ESSAI/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(home, "env.log"), "utf8").trim().split("\n").at(-1)), { memoireCoupee: true });
    // Ce que la réponse a consommé revient avec sa fin, en écart du cumul : 10 puis 10 de plus.
    const c1 = fin1.recus.find((e) => e.requestId === "m1" && e.event.type === "fin").event.consommation;
    assert.deepEqual(c1, { agent: "hugo", lignes: [{ modele: "claude-opus-5-5", jetons: { entree: 10, sortie: 5, cacheLu: 0, cacheEcrit: 0 }, coutUsd: 0.01 }] });
    await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "m2", options: { ...options, sessionId: "11111111-2222-3333-4444-555555555555" } } });
    const fin2 = await lireFlux(ecoute.port, jeton, 0, "", (recus) => recus.some((e) => e.requestId === "m2" && e.event?.type === "fin"));
    assert.equal(fin2.recus.find((e) => e.requestId === "m2" && e.event.type === "fin").event.consommation.lignes[0].jetons.entree, 10);
    // La configuration change sur le PC (mémoire gardée) : Claude Code est relancé sur la même session, sans la variable.
    assert.equal((await equipe({ memoireAgents: true, consignes: null }, "e2")).statut, 200);
    await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "m3", options: { ...options, sessionId: "11111111-2222-3333-4444-555555555555" } } });
    await lireFlux(ecoute.port, jeton, 0, "", (recus) => recus.some((e) => e.requestId === "m3" && e.event?.type === "fin"));
    assert.deepEqual(JSON.parse(readFileSync(path.join(home, "env.log"), "utf8").trim().split("\n").at(-1)), { memoireCoupee: false });
    assert.doesNotMatch(readFileSync(path.join(home, "args.log"), "utf8").trim().split("\n").at(-1), /CONSIGNES-KLYRA-ESSAI/);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("le Coffre d'un serveur : à lui seul, sans le PC, jamais une valeur en clair ni dans le journal", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const journal = creerJournal();
  const ia = creerIa({ donnees: dossier, version: "1" });
  await ia.demarrer();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane, ia, claude: null, ecouteurs: journal.ecouteurs });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents, ia });
  try {
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const config = JSON.parse(ia.configMcp({ agent: "hugo", conversation: "dm-hugo" })).mcpServers.klyra;
    const mcp = async (method, params = {}) => (await (await fetch(config.url, { method: "POST", headers: config.headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
    const coffre = (methode, corps = {}) => appel(ecoute.port, `/klyra/v1/coffre/${methode}`, { methode: "POST", jeton, corps });
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton })).json.coffrePropre, true);

    // Aucun PC à l'écoute : les outils sont là et répondent quand même.
    assert.deepEqual((await mcp("tools/list")).tools.filter((t) => t.name.startsWith("coffre_")).map((t) => t.name), ["coffre_lister", "coffre_demander", "coffre_enregistrer", "coffre_ecrire_fichier"]);
    const vide = await mcp("tools/call", { name: "coffre_lister", arguments: {} });
    assert.ok(!vide.isError);
    assert.doesNotMatch(vide.content[0].text, /GITHUB_TOKEN/);

    // Un agent range un secret : ni dans le journal, ni en clair sur le disque, ni dans sa réponse.
    const VALEUR = "ghp_JamaisEnClair_7";
    const rangee = await mcp("tools/call", { name: "coffre_enregistrer", arguments: { variable: "GITHUB_TOKEN", nom: "Jeton GitHub", valeur: VALEUR } });
    assert.match(rangee.content[0].text, /Rangé dans le coffre : GITHUB_TOKEN/);
    assert.ok(!rangee.content[0].text.includes(VALEUR));
    assert.ok(!readFileSync(path.join(dossier, "coffre.json"), "utf8").includes(VALEUR));
    assert.equal((await mcp("tools/call", { name: "coffre_enregistrer", arguments: { variable: "GITHUB_TOKEN", nom: "Autre", valeur: "x" } })).isError, true, "un agent n'écrase pas un secret");

    // Écrit dans un fichier du serveur, sans le voir ; refusé dans les données du serveur.
    const fichier = path.join(home, "projet", ".env");
    mkdirSync(path.dirname(fichier), { recursive: true });
    const ecrit = await mcp("tools/call", { name: "coffre_ecrire_fichier", arguments: { variable: "GITHUB_TOKEN", chemin: fichier } });
    assert.ok(!ecrit.isError, ecrit.content[0].text);
    assert.ok(!ecrit.content[0].text.includes(VALEUR));
    assert.match(readFileSync(fichier, "utf8"), /GITHUB_TOKEN=/);
    assert.equal((await mcp("tools/call", { name: "coffre_ecrire_fichier", arguments: { variable: "GITHUB_TOKEN", chemin: path.join(dossier, ".env") } })).isError, true);

    // L'écran : sans jeton, rien ; la liste ne donne jamais la valeur ; un secret interdit aux agents leur reste fermé.
    assert.equal((await appel(ecoute.port, "/klyra/v1/coffre/etat", { methode: "POST", corps: {} })).statut, 401);
    const etat = (await coffre("etat")).json.resultat;
    assert.equal(etat.secrets.length, 1);
    assert.ok(!JSON.stringify(etat).includes(VALEUR) && !("valeur" in etat.secrets[0]));
    const id = etat.secrets[0].id;
    assert.equal((await coffre("lire", { id })).json.resultat, VALEUR);
    assert.equal((await coffre("modifier", { id, champs: { agents: false } })).json.resultat.agents, false);
    assert.equal((await mcp("tools/call", { name: "coffre_ecrire_fichier", arguments: { variable: "GITHUB_TOKEN", chemin: fichier } })).isError, true);
    assert.equal((await coffre("ajouter", { entree: { variable: "CLE_PC", nom: "Copiée du PC", valeur: "abc" } })).statut, 200);
    assert.equal((await coffre("ajouter", { entree: { variable: "CLE_PC", nom: "Encore", valeur: "def" } })).statut, 400);
    assert.equal((await coffre("ajouter", { entree: { variable: "CLE_PC", nom: "Remplacée", valeur: "def" }, remplacer: true })).statut, 200);
    assert.equal((await coffre("retirer", { id })).statut, 200);
    assert.deepEqual((await coffre("etat")).json.resultat.secrets.map((x) => x.variable), ["CLE_PC"]);
    assert.ok(!JSON.stringify(journal.depuis?.(0) ?? []).includes(VALEUR));
  } finally {
    await ecoute.fermer();
    ia.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("les livrables des agents du VPS : publiés par l'outil MCP, annoncés à l'app, servis seuls", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const journal = creerJournal();
  const ia = creerIa({ donnees: dossier, version: "1" });
  await ia.demarrer();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane, ia, claude: null });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents, ia });
  try {
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    // La configuration MCP d'une session porte son agent et sa conversation.
    const config = JSON.parse(ia.configMcp({ agent: "hugo", conversation: "dm-hugo" })).mcpServers.klyra;
    assert.equal(config.headers["X-Klyra-Agent"], "hugo");
    assert.equal(config.headers["X-Klyra-Conversation"], "dm-hugo");
    const mcp = async (method, params = {}) => (await (await fetch(config.url, { method: "POST", headers: config.headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
    assert.ok((await mcp("tools/list")).tools.some((t) => t.name === "publier_artefact"), "publier_artefact n’est pas proposé sans IA ajoutée");

    mkdirSync(path.join(home, "livrables"), { recursive: true });
    writeFileSync(path.join(home, "livrables", "rapport.md"), "# Rapport\n");
    mkdirSync(path.join(home, "site", "img"), { recursive: true });
    mkdirSync(path.join(home, "site", "node_modules"), { recursive: true });
    writeFileSync(path.join(home, "site", "index.html"), "<h1>Site</h1>");
    writeFileSync(path.join(home, "site", "img", "a.png"), "PNG");
    writeFileSync(path.join(home, "site", "node_modules", "x.js"), "lourd");
    const publier = (args) => mcp("tools/call", { name: "publier_artefact", arguments: args });

    const r1 = await publier({ chemin: path.join(home, "livrables", "rapport.md"), titre: "Rapport", description: "Le point." });
    assert.match(r1.content[0].text, /Publié dans Artefacts : « Rapport »/);
    assert.equal(r1.isError, undefined);
    const flux = await lireFlux(ecoute.port, jeton, 0, "", (recus) => recus.some((e) => e.event?.type === "rendu"));
    const annonce = flux.recus.find((e) => e.event?.type === "rendu").event;
    assert.deepEqual([annonce.titre, annonce.agent, annonce.conversation, annonce.dossier, annonce.taille], ["Rapport", "hugo", "dm-hugo", false, 10]);
    // Republier le même fichier garde son identifiant.
    await publier({ chemin: "~/livrables/rapport.md", titre: "Rapport v2" });
    assert.equal(agents.rendus.lire().length, 1);
    assert.equal(agents.rendus.lire()[0].id, annonce.id);
    assert.equal(agents.rendus.lire()[0].titre, "Rapport v2");

    // Ses octets, à l'appareil relié seulement.
    assert.equal((await appel(ecoute.port, `${CHEMIN_RENDUS}/${annonce.id}/fichiers`, {})).statut, 401);
    assert.deepEqual((await appel(ecoute.port, `${CHEMIN_RENDUS}/${annonce.id}/fichiers`, { jeton })).json.fichiers, [{ relatif: "rapport.md", taille: 10 }]);
    const octets = await fetch(`http://127.0.0.1:${ecoute.port}${CHEMIN_RENDUS}/${annonce.id}/fichier`, { headers: { Authorization: `Bearer ${jeton}` } });
    assert.equal(await octets.text(), "# Rapport\n");

    // Une page : son dossier, sans node_modules ; rien hors du livrable.
    await publier({ chemin: path.join(home, "site"), titre: "Site" });
    const page = agents.rendus.lire().find((r) => r.titre === "Site");
    assert.deepEqual((await appel(ecoute.port, `${CHEMIN_RENDUS}/${page.id}/fichiers`, { jeton })).json.fichiers.map((f) => f.relatif).sort(), ["img/a.png", "index.html"]);
    assert.equal((await appel(ecoute.port, `${CHEMIN_RENDUS}/${page.id}/fichier?relatif=${encodeURIComponent("../livrables/rapport.md")}`, { jeton })).statut, 400);
    assert.equal((await appel(ecoute.port, `${CHEMIN_RENDUS}/${page.id}/fichier?relatif=${encodeURIComponent("node_modules/x.js")}`, { jeton })).statut, 400);
    assert.equal((await appel(ecoute.port, `${CHEMIN_RENDUS}/00000000-0000-4000-8000-000000000000/fichiers`, { jeton })).statut, 400);

    // Refusés, avec ce qu'il faut corriger.
    assert.match((await publier({ chemin: "/etc/hostname", titre: "x" })).content[0].text, /Seuls les fichiers sous/);
    mkdirSync(path.join(home, "vrac"), { recursive: true });
    assert.match((await publier({ chemin: path.join(home, "vrac"), titre: "x" })).content[0].text, /index\.html/);
    assert.match((await publier({ chemin: "rapport.md", titre: "x" })).content[0].text, /chemin complet/);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("les projets du VPS : arbre, lecture et création sous le dossier de klyra seulement", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const { creerFichiers } = await import("./fichiers.mjs");
  const ecoute = await ecouter({ dossier, port: 0, fichiers: creerFichiers(home) });
  try {
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const projet = path.join(home, "projets", "site");
    assert.equal((await appel(ecoute.port, `/klyra/v1/fichiers/dossier?dossier=${encodeURIComponent(projet)}`, { methode: "POST" })).statut, 401);
    const cree = await appel(ecoute.port, `/klyra/v1/fichiers/dossier?dossier=${encodeURIComponent(projet)}`, { methode: "POST", jeton });
    assert.equal(cree.json.dossier, projet);
    writeFileSync(path.join(projet, "lisez-moi.md"), "# Bonjour");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.join(projet, "src"));
    mkdirSync(path.join(projet, "node_modules"));

    const arbre = await appel(ecoute.port, `/klyra/v1/fichiers/arbre?dossier=${encodeURIComponent(projet)}`, { jeton });
    assert.deepEqual(arbre.json.noeuds, [
      { name: "src", path: "src", kind: "dossier" },
      { name: "lisez-moi.md", path: "lisez-moi.md", kind: "fichier" },
    ]);
    const lu = await appel(ecoute.port, `/klyra/v1/fichiers/lire?dossier=${encodeURIComponent(projet)}&relatif=lisez-moi.md`, { jeton });
    assert.equal(Buffer.from(lu.json.base64, "base64").toString(), "# Bonjour");
    assert.equal(lu.json.taille, 9);

    const sortie = await appel(ecoute.port, `/klyra/v1/fichiers/lire?dossier=${encodeURIComponent(projet)}&relatif=../../../etc/passwd`, { jeton });
    assert.equal(sortie.statut, 400);
    const ailleurs = await appel(ecoute.port, `/klyra/v1/fichiers/arbre?dossier=${encodeURIComponent("/etc")}`, { jeton });
    assert.equal(ailleurs.statut, 400);
    assert.match(ailleurs.json.message, /sous/);
    assert.equal((await appel(ecoute.port, `/klyra/v1/fichiers/dossier?dossier=${encodeURIComponent("/tmp/x")}`, { methode: "POST", jeton })).statut, 400);

    // Les consignes KLYRA d'un projet du VPS : ce qui serait écrit, l'écriture, jamais d'écrasement.
    const consignes = (methode) => appel(ecoute.port, `/klyra/v1/fichiers/consignes?dossier=${encodeURIComponent(projet)}&nom=Site`, { methode, jeton });
    const avant = (await consignes("GET")).json.consignes;
    assert.deepEqual(avant.propositions.map((p) => [p.nom, p.action]), [["AGENTS.md", "creer"], ["CLAUDE.md", "creer"]]);
    const apres = (await consignes("POST")).json.consignes;
    assert.deepEqual(apres.propositions, []);
    assert.match(readFileSync(path.join(projet, "AGENTS.md"), "utf8"), /Site/);
    assert.equal(readFileSync(path.join(projet, "CLAUDE.md"), "utf8").trim(), "@AGENTS.md");
    writeFileSync(path.join(projet, "AGENTS.md"), "Mes consignes.\n");
    assert.deepEqual((await consignes("POST")).json.consignes.propositions, []);
    assert.equal(readFileSync(path.join(projet, "AGENTS.md"), "utf8"), "Mes consignes.\n");
    assert.equal((await appel(ecoute.port, `/klyra/v1/fichiers/consignes?dossier=${encodeURIComponent("/etc")}&nom=x`, { jeton })).statut, 400);
    // Le fichier d'un workflow du VPS : sous le dossier de klyra seulement.
    const ecrit = await appel(ecoute.port, "/klyra/v1/fichiers/ecrire", { methode: "POST", jeton, corps: { chemin: "rapports/hebdo.md", texte: "Bonjour" } });
    assert.equal(ecrit.statut, 200);
    assert.equal(readFileSync(ecrit.json.chemin, "utf8"), "Bonjour");
    assert.equal((await appel(ecoute.port, "/klyra/v1/fichiers/ecrire", { methode: "POST", jeton, corps: { chemin: "/etc/klyra-essai", texte: "non" } })).statut, 400);
    assert.equal((await appel(ecoute.port, "/klyra/v1/fichiers/ecrire", { methode: "POST", corps: { chemin: "a.md", texte: "non" } })).statut, 401);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("le VPS écrit les skills allumées dans sa bibliothèque et les sessions préparées les lisent", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  mkdirSync(path.join(home, ".claude", "skills", "ancienne"), { recursive: true });
  writeFileSync(path.join(home, ".claude", "skills", "ancienne", "SKILL.md"), "---\nname: ancienne\n---\n\nPOSTE\n");
  const journal = creerJournal();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane, claude: null });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents });
  const skill = (nom, texte) => ({ nom, dossier: nom, fichiers: [{ chemin: "SKILL.md", contenu: `---\nname: ${nom}\n---\n\n${texte}\n` }] });
  const choix = {
    fige: true,
    personnellesConnues: ["rangement"],
    agentsConnus: ["principal", "iris", "hugo"],
    coupees: {},
    activees: { hugo: ["maquette"] },
  };
  try {
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const fiches = [
      { id: "iris", nom: "Iris", contenu: "---\nname: iris\n---\nIris." },
      { id: "hugo", nom: "Hugo", contenu: "---\nname: hugo\n---\nHugo." },
    ];
    const sansFichiers = await appel(ecoute.port, CHEMIN_FICHES, { methode: "PUT", jeton, corps: { fiches, assistant: "Cicco", skillsParAgent: choix, empreinte: "e0" } });
    assert.equal(sansFichiers.statut, 200);
    assert.equal(existsSync(path.join(dossier, "bibliotheque-skills")), false);
    assert.equal(readFileSync(path.join(home, ".claude", "skills", "ancienne", "SKILL.md"), "utf8").includes("POSTE"), true);

    const avec = await appel(ecoute.port, CHEMIN_FICHES, {
      methode: "PUT",
      jeton,
      corps: { fiches, assistant: "Cicco", skillsParAgent: choix, skills: [skill("rangement", "RANGE"), skill("maquette", "DESSINE")], empreinte: "e1" },
    });
    assert.equal(avec.statut, 200);
    assert.equal(readFileSync(path.join(dossier, "bibliotheque-skills", "rangement", "SKILL.md"), "utf8").includes("RANGE"), true);
    assert.equal(readFileSync(path.join(dossier, "bibliotheque-skills", "maquette", "SKILL.md"), "utf8").includes("DESSINE"), true);
    assert.equal(existsSync(path.join(dossier, "bibliotheque-skills", "ancienne")), false);
    assert.equal(readFileSync(path.join(home, ".claude", "skills", "ancienne", "SKILL.md"), "utf8").includes("POSTE"), true);
    assert.equal(process.env.KLYRA_USER_DATA, dossier);
    assert.deepEqual(nomsSkills(path.join(home, ".claude"), null).poste.sort(), ["maquette", "rangement"]);

    const filtreIris = filtreSkills(choix, "iris", path.join(home, ".claude"), null);
    const session = preparerSessionClaude({
      userData: dossier,
      home,
      agent: "iris",
      dossierAgents: path.join(home, ".claude", "agents"),
      idsActifs: ["iris", "hugo"],
      garder: filtreIris.garder,
    });
    assert.ok(session);
    assert.equal(readFileSync(path.join(session.dossier, "skills", "rangement", "SKILL.md"), "utf8").includes("RANGE"), true);
    assert.equal(existsSync(path.join(session.dossier, "skills", "maquette")), false);
    const filtreHugo = filtreSkills(choix, "hugo", path.join(home, ".claude"), null);
    const sessionHugo = preparerSessionClaude({
      userData: dossier,
      home,
      agent: "hugo",
      dossierAgents: path.join(home, ".claude", "agents"),
      idsActifs: ["iris", "hugo"],
      garder: filtreHugo.garder,
    });
    assert.ok(sessionHugo);
    assert.equal(existsSync(path.join(sessionHugo.dossier, "skills", "maquette", "SKILL.md")), true);

    const encore = await appel(ecoute.port, CHEMIN_FICHES, { methode: "PUT", jeton, corps: { fiches, assistant: "Cicco", skillsParAgent: choix, empreinte: "e2" } });
    assert.equal(encore.statut, 200);
    assert.equal(readFileSync(path.join(dossier, "bibliotheque-skills", "rangement", "SKILL.md"), "utf8").includes("RANGE"), true);

    const vide = await appel(ecoute.port, CHEMIN_FICHES, {
      methode: "PUT",
      jeton,
      corps: { fiches, assistant: "Cicco", skillsParAgent: choix, skills: [], empreinte: "e3" },
    });
    assert.equal(vide.statut, 200);
    assert.equal(existsSync(path.join(dossier, "bibliotheque-skills", "rangement")), false);
    assert.equal(readFileSync(path.join(home, ".claude", "skills", "ancienne", "SKILL.md"), "utf8").includes("POSTE"), true);

    const sortie = await appel(ecoute.port, CHEMIN_FICHES, {
      methode: "PUT",
      jeton,
      corps: { fiches, assistant: "Cicco", skills: [{ dossier: "../sortie", fichiers: [{ chemin: "SKILL.md", contenu: "x" }] }], empreinte: "e4" },
    });
    assert.equal(sortie.statut, 400);
    assert.equal(existsSync(path.join(dossier, "sortie")), false);
    assert.equal(existsSync(path.join(home, ".claude", "skills", "sortie")), false);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("contexte d'un message du téléphone : seulement une conversation et un texte lisibles", () => {
  const bon = { chatId: "c-1", agentId: "hugo", titre: "Refonte", telephone: { messageId: "m1", texte: "Relance le build", creeLe: "2026-11-02T10:00:00Z" } };
  assert.deepEqual(contexteTelephone(bon), { ...bon, telephone: { ...bon.telephone, creeLe: "2026-11-02T10:00:00.000Z" } });
  assert.equal(contexteTelephone({ ...bon, chatId: "routine-x" }), null);
  assert.equal(contexteTelephone({ ...bon, agentId: "../hugo" }), null);
  assert.equal(contexteTelephone({ ...bon, telephone: { ...bon.telephone, texte: " " } }), null);
  assert.equal(contexteTelephone({ ...bon, telephone: { ...bon.telephone, creeLe: "hier" } }), null);
  assert.equal(contexteTelephone(null), null);
});

test("la session de chaque agent par conversation est retenue, et gardée entre deux redémarrages", () => {
  const dossier = mkdtempSync(path.join(tmpdir(), "klyra-sessions-"));
  try {
    const fichier = path.join(dossier, "sessions-conversations.json");
    const journal = creerJournal(Date.now, fichier);
    const cle = cleConversation("dm-hugo", "hugo");
    journal.lierConversation("r1", cle);
    journal.publier("r1", { type: "session" }, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    journal.publier("r1", { type: "fin", ok: true, texte: "" }, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert.equal(journal.sessionDe(cle), "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert.equal(creerJournal(Date.now, fichier).sessionDe(cle), "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert.equal(journal.sessionDe(cleConversation("dm-hugo", null)), null);
    assert.equal(cleConversation("../x", "hugo"), null);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("chaque serveur garde son équipe : l'app la lit et la modifie ici, et ne l'écrase plus", async () => {
  const dossier = dossierJetable();
  const home = path.join(dossier, "home");
  mkdirSync(home, { recursive: true });
  const agents = creerAgents({ home, donnees: path.join(dossier, "donnees"), nomServeur: "VPS", publier: () => {}, spontane: () => {}, claude: null });
  const ecoute = await ecouter({ dossier: path.join(dossier, "donnees"), port: 0, agents });
  const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(path.join(dossier, "donnees")), nom: "PC" } })).json.jeton;
  const equipe = (methode, corps = {}) => appel(ecoute.port, `/klyra/v1/equipe/${methode}`, { methode: "POST", jeton, corps });
  const claude = (id) => path.join(home, ".claude", "agents", `${id}.md`);
  const fiche = (nom) => `---\nname: ${nom}\ndisplayName: ${nom.toUpperCase()}\n---\nConsignes de ${nom}.`;
  try {
    assert.equal((await appel(ecoute.port, "/klyra/v1/equipe/etat", { methode: "POST", corps: {} })).statut, 401);
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton })).json.equipePropre, true);
    assert.equal((await equipe("etat")).json.resultat.initialise, false);

    // Une première copie, une seule fois.
    const copie = (await equipe("initialiser", { fiches: [{ id: "lou", contenu: fiche("lou") }], assistant: "Cicco" })).json.resultat;
    assert.equal(copie.copie, true);
    assert.equal(copie.mes.assistant.nom, "Cicco");
    assert.ok(existsSync(claude("lou")));
    assert.equal((await equipe("initialiser", { fiches: [{ id: "autre", contenu: fiche("autre") }] })).json.resultat.copie, false);
    assert.ok(!existsSync(claude("autre")));

    // Une fiche créée ici, puis désactivée : elle reste au serveur, sans être chargée par Claude Code.
    assert.equal((await equipe("creer", { id: "iris", contenu: fiche("iris") })).statut, 200);
    assert.ok(existsSync(claude("iris")));
    assert.equal((await equipe("creer", { id: "iris", contenu: fiche("iris") })).json.erreur, "existe-deja");
    assert.equal((await equipe("creer", { id: "../x", contenu: "x" })).json.erreur, "nom-invalide");
    assert.equal((await equipe("activer", { id: "iris", actif: false })).json.resultat.agents.iris.actif, false);
    assert.ok(!existsSync(claude("iris")));
    assert.deepEqual((await equipe("lister")).json.resultat.agents.map((a) => a.name).sort(), ["iris", "lou"]);
    assert.deepEqual(agents.equipeServeur.actifs(), [{ id: "lou", nom: "LOU" }]);

    // Écrire garde l'ancienne version, et refuse d'écraser une fiche changée entre-temps.
    const avant = (await equipe("lister")).json.resultat.agents.find((a) => a.name === "lou");
    assert.equal((await equipe("ecrire", { id: "lou", contenu: fiche("lou") + "\nSuite.", attendu: avant.modifiedAt })).statut, 200);
    assert.equal((await equipe("ecrire", { id: "lou", contenu: "x", attendu: 1 })).json.erreur, "conflit");
    assert.match(readFileSync(claude("lou"), "utf8"), /Suite\./);
    const versions = (await equipe("historique", { id: "lou" })).json.resultat;
    assert.equal(versions.length, 1);
    assert.equal((await equipe("version", { id: "lou", version: versions[0].id })).json.resultat, fiche("lou"));

    // Ses préférences restent ici.
    assert.equal((await equipe("meta-ecrire", { meta: { lou: { teinte: "violet" } } })).statut, 200);
    assert.deepEqual((await equipe("meta")).json.resultat, { lou: { teinte: "violet" } });

    // Réglés sur ce serveur, ses réglages restent à lui, même face à l'envoi complet d'une ancienne app.
    assert.equal((await equipe("reglages-ecrire", { configuration: { memoireAgents: false, consignes: "Du VPS" }, configurationEcran: { memoireAgents: false } })).statut, 200);
    agents.recevoirFiches({ fiches: [], assistant: null, configuration: { memoireAgents: true, consignes: "Du PC", coffre: true }, empreinte: "e8" });
    assert.deepEqual((await equipe("reglages")).json.resultat.configuration, { memoireAgents: false });
    assert.equal(agents.empreinteEquipe(), "e8", "l'empreinte suit, pour que l'app ne renvoie pas sans fin");
    // Un fichier partiel reste complet : l'app ne le renvoie pas à chaque message.
    agents.recevoirFiches({ fiches: [], partielle: true, configuration: { navigateur: true, coffre: true }, empreinte: "e8b" });
    assert.equal(agents.empreinteEquipe(), "e8b");

    // L'envoi d'une ancienne app n'écrase plus l'équipe.
    agents.recevoirFiches({ fiches: [{ id: "intrus", nom: "Intrus", contenu: fiche("intrus") }], assistant: "Autre", empreinte: "e9" });
    assert.equal(agents.empreinteEquipe(), "e9");
    assert.ok(!existsSync(claude("intrus")));
    assert.ok(existsSync(claude("lou")));
    assert.equal(agents.equipeServeur.assistant(), "Cicco");
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("repartie à zéro sur le PC : le VPS ne reprend pas la session qu'il retient, le téléphone suit la neuve", async () => {
  const dossier = dossierJetable();
  const journal = creerJournal();
  const recues = [];
  const agents = { envoyer: (requestId, options) => recues.push(options), fermerTout() {} };
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents });
  const envoyer = (jeton, requestId, options, contexte) => appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId, options, ...(contexte ? { contexte } : {}) } });
  try {
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const ancienne = "11111111-2222-3333-4444-555555555555";
    const neuve = "66666666-7777-8888-9999-000000000000";
    const options = { agent: null, prompt: "toi", sessionId: null, acces: "projet", conversation: "dm-lou" };
    await envoyer(jeton, "r1", options);
    journal.publier("r1", { type: "session", sessionId: ancienne }, ancienne);

    await envoyer(jeton, "r2", options);
    assert.equal(recues.at(-1).sessionId, ancienne, "sans session, l'agent reprend la sienne");

    await envoyer(jeton, "r3", { ...options, sessionNeuve: true });
    assert.equal(recues.at(-1).sessionId, null, "repartie à zéro : pas l'ancienne");

    journal.publier("r3", { type: "session", sessionId: neuve }, neuve);
    const contexte = { chatId: "dm-lou", agentId: "principal", titre: "Lou", telephone: { messageId: "tel-1", texte: "toi", creeLe: "2026-11-05T10:00:00.000Z" } };
    await envoyer(jeton, "r4", { agent: null, prompt: "toi", sessionId: null, acces: "demander" }, contexte);
    assert.equal(recues.at(-1).sessionId, neuve, "le téléphone suit la session neuve");
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("un serveur qui recevait les fiches du PC garde ces agents comme son équipe", async () => {
  const dossier = dossierJetable();
  const donnees = path.join(dossier, "donnees");
  const agentsClaude = path.join(dossier, "home", ".claude", "agents");
  mkdirSync(agentsClaude, { recursive: true });
  mkdirSync(donnees, { recursive: true });
  writeFileSync(path.join(agentsClaude, "hugo.md"), "---\nname: hugo\n---\nCode.");
  writeFileSync(path.join(donnees, "equipe.json"), JSON.stringify({ assistant: "Cicco", actifs: [{ id: "hugo", nom: "Hugo" }], empreinte: "x" }));
  const { creerEquipe } = await import("./equipe.mjs");
  const equipe = creerEquipe({ donnees, dossierClaude: path.join(dossier, "home", ".claude") });
  try {
    assert.equal(equipe.initialise(), true);
    assert.equal(equipe.assistant(), "Cicco");
    assert.deepEqual(equipe.actifs(), [{ id: "hugo", nom: "hugo" }]);
    assert.ok(existsSync(path.join(agentsClaude, "hugo.md")));
    assert.ok(existsSync(path.join(donnees, "equipe", "hugo.md")));
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("l'espace d'un serveur : ses éléments restent ici, retirés comme écrits, et un seul numéro dit si ça a changé", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "VPS", publier: () => {}, spontane: () => {}, claude: null });
  const ecoute = await ecouter({ dossier, port: 0, agents });
  try {
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const espace = (methode, corps = {}) => appel(ecoute.port, `/klyra/v1/espace/${methode}`, { methode: "POST", jeton, corps });
    assert.equal((await appel(ecoute.port, "/klyra/v1/espace/lire", { methode: "POST", corps: {} })).statut, 401);
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton })).json.espacePropre, true);
    assert.deepEqual((await espace("lire")).json.resultat, { revision: 0, elements: [], supprimes: {} });

    const conversation = { chat: { id: "dm-iris@vps:8791", title: "Iris" }, messages: [{ id: "m1", chatId: "dm-iris@vps:8791" }] };
    const ecrit = await espace("ecrire", { elements: [{ type: "conversation", id: "dm-iris@vps:8791", valeur: conversation }, { type: "projet", id: "p1", valeur: { id: "p1" } }] });
    assert.equal(ecrit.json.resultat.revision, 1);
    assert.deepEqual((await espace("lire", { depuis: 1 })).json.resultat, { revision: 1, inchange: true });
    const lu = (await espace("lire", { depuis: 0 })).json.resultat;
    assert.deepEqual(lu.elements.find((e) => e.type === "conversation").valeur, conversation);
    assert.equal(lu.elements.length, 2);

    // Retiré : il part, et l'autre appareil le saura. Réécrit plus tard : il revient.
    assert.equal((await espace("ecrire", { supprimes: [{ type: "projet", id: "p1" }] })).json.resultat.revision, 2);
    const apres = (await espace("lire")).json.resultat;
    assert.deepEqual(apres.elements.map((e) => e.id), ["dm-iris@vps:8791"]);
    assert.ok(apres.supprimes.projet.p1);
    await espace("ecrire", { elements: [{ type: "projet", id: "p1", valeur: { id: "p1" } }] });
    assert.ok(!(await espace("lire")).json.resultat.supprimes.projet.p1);

    // Ce qui n'en est pas est refusé, et rien ne sort du dossier.
    assert.equal((await espace("ecrire", { elements: [{ type: "../../etc", id: "x", valeur: 1 }] })).statut, 400);
    assert.equal((await espace("ecrire", { elements: [{ type: "projet", id: "", valeur: 1 }] })).statut, 400);
    assert.equal((await espace("autre")).statut, 400);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("Composio : chaque serveur a son compte, gardé chiffré, et ses agents le joignent sans le PC", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const ia = creerIa({ donnees: dossier, version: "1" });
  await ia.demarrer();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "VPS", publier: () => {}, spontane: () => {}, ia, claude: null });
  const ecoute = await ecouter({ dossier, port: 0, agents, ia });
  const jetons = { clientId: "client-1", acces: "acces-secret", renouvellement: "renouveau-secret", expireLe: Date.now() + 3_600_000, compte: "corentin@exemple.fr" };
  try {
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const composio = (methode, corps = {}) => appel(ecoute.port, `/klyra/v1/composio/${methode}`, { methode: "POST", jeton, corps });
    assert.equal((await appel(ecoute.port, "/klyra/v1/composio/etat", { methode: "POST", corps: {} })).statut, 401);
    assert.equal((await composio("etat")).json.resultat.connecte, false);
    assert.equal(JSON.parse(ia.configMcp({ agent: "hugo", conversation: "c" })).mcpServers.composio, undefined);

    assert.equal((await composio("adopter", { jetons: { acces: "sans le reste" } })).statut, 400);
    const adopte = (await composio("adopter", { jetons })).json.resultat;
    assert.deepEqual([adopte.connecte, adopte.compte], [true, "corentin@exemple.fr"]);
    assert.ok(!JSON.stringify(adopte).includes("acces-secret"), "l'état ne donne jamais un jeton");
    assert.ok(!readFileSync(path.join(dossier, "composio-connect.json"), "utf8").includes("acces-secret"), "rien en clair sur le disque");

    const mcp = JSON.parse(ia.configMcp({ agent: "hugo", conversation: "c" })).mcpServers;
    assert.equal(mcp.composio.url, "https://connect.composio.dev/mcp");
    assert.equal(mcp.composio.headers.Authorization, "Bearer acces-secret");
    assert.ok(mcp.klyra);

    // Relu au redémarrage : le compte reste à ce serveur.
    const relu = creerAgents({ home, donnees: dossier, nomServeur: "VPS", publier: () => {}, spontane: () => {}, claude: null });
    assert.equal((await relu.composioServeur.appeler("etat")).connecte, true);

    assert.equal((await composio("deconnecter")).json.resultat.connecte, false);
    assert.equal(JSON.parse(ia.configMcp({ agent: "hugo", conversation: "c" })).mcpServers.composio, undefined);
    assert.ok(!existsSync(path.join(dossier, "composio-connect.json")));
  } finally {
    await ecoute.fermer();
    ia.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
