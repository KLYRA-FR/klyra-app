/**
 * L'atelier d'un agent sur le VPS, comme sur le PC : les outils de l'assistant servis par le serveur MCP
 * du VPS (ia.mjs), la carte suivie par conversation (atelier-agent.mjs), les refus, l'épreuve jouée par
 * le Claude Code du VPS (epreuve.mjs) avec ce qu'elle a consommé, et la carte écrite en direct.
 * Un faux Claude Code : rien ne sort de la machine.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { creerAgents } from "./agents.mjs";
import { creerIa } from "./ia.mjs";
import { CHEMIN, CHEMIN_AGENT, CHEMIN_APPAIRER, CHEMIN_EQUIPE, CHEMIN_FICHES, creerCode, creerJournal, ecouter } from "./klyra-serveur.mjs";

const jetable = () => mkdtempSync(path.join(tmpdir(), "klyra-atelier-"));

/**
 * Un faux Claude Code. En flux (une session) : « atelier » écrit l'entrée de `proposer_agent` en deux morceaux.
 * En impression (l'épreuve) : le juge rend un verdict JSON ; l'agent en essai prend un bug pour lui tant que
 * sa fiche ne dit pas de passer la main.
 */
const FAUX_CLAUDE = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.HOME + "/args.log", JSON.stringify(args) + "\\n");
const ecrire = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const usage = { "claude-haiku-4-5": { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.001 } };
let entree = "";
process.stdin.on("data", (d) => (entree += d));
if (!args.includes("--input-format")) {
  process.stdin.on("end", () => {
    if (args.includes("haiku")) {
      const reponse = (entree.match(/<reponse>\\n([\\s\\S]*?)\\n<\\/reponse>/) || [])[1] || "";
      const ko = entree.includes("hors de son métier") && reponse.includes("Je corrige");
      const verdict = ko ? { verdict: "ko", raison: "Il prend un travail qui n’est pas le sien.", correction: { pilier: "limites", texte: "Le code : je passe la main." } } : { verdict: "ok", raison: "Bien.", correction: null };
      return ecrire({ result: JSON.stringify(verdict), is_error: false, modelUsage: usage });
    }
    const fiche = fs.readFileSync(args[args.indexOf("--agents") + 1], "utf8");
    const texte = /bug/.test(entree) ? (fiche.includes("passe la main") ? "Pas mon métier : je passe la main." : "Je corrige le bug.") : "Une note sourcée.";
    ecrire({ result: texte, is_error: false, modelUsage: usage });
  });
} else {
  let tampon = "";
  process.stdin.on("data", (d) => {
    tampon += d;
    const lignes = tampon.split("\\n");
    tampon = lignes.pop();
    for (const l of lignes) {
      if (!l.trim()) continue;
      const m = JSON.parse(l);
      if (m.type !== "user") continue;
      ecrire({ type: "system", subtype: "init", session_id: "11111111-2222-3333-4444-555555555555" });
      const json = JSON.stringify({ nom: "Zoe", role: "Veille" });
      ecrire({ type: "stream_event", event: { type: "message_start" } });
      ecrire({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "mcp__klyra__proposer_agent", input: {} } } });
      ecrire({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(0, 12) } } });
      ecrire({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(12) } } });
      ecrire({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
      ecrire({ type: "result", subtype: "success", is_error: false, result: "fin", session_id: "11111111-2222-3333-4444-555555555555" });
    }
  });
}
`;

async function appel(port, chemin, { methode = "GET", jeton, corps } = {}) {
  const reponse = await fetch(`http://127.0.0.1:${port}${chemin}`, {
    method: methode,
    headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { "Content-Type": "application/json" }) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { statut: reponse.status, json: await reponse.json().catch(() => null) };
}

/** Un appel au serveur MCP du VPS, avec les en-têtes que porte la session d'un agent. */
async function mcp(config, methode, params = {}) {
  const { url, headers } = JSON.parse(config).mcpServers.klyra;
  const reponse = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: methode, params }) });
  return (await reponse.json()).result;
}

test("l'atelier d'un agent sur le VPS : outils de l'assistant, carte suivie, refus, épreuve et carte en direct", async () => {
  const dossier = jetable();
  const home = jetable();
  const claude = path.join(home, "faux-claude");
  writeFileSync(claude, FAUX_CLAUDE);
  chmodSync(claude, 0o755);
  writeFileSync(path.join(dossier, "claude-token"), "jeton-claude");
  const journal = creerJournal();
  const publies = [];
  const publier = (requestId, event, sessionId) => {
    publies.push(event);
    journal.publier(requestId, event, sessionId);
  };
  const ia = creerIa({ donnees: dossier, version: "1" });
  await ia.demarrer();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier, spontane: journal.spontane, claude, ia });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents, ia });
  try {
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton })).json.atelier, true, "le VPS annonce l'atelier");
    await appel(ecoute.port, CHEMIN_FICHES, { methode: "PUT", jeton, corps: { fiches: [{ id: "lou", nom: "Lou", contenu: "---\nname: lou\n---\nPrompt." }], assistant: "Cicco", empreinte: "e1" } });

    // Les outils : à l'assistant seulement.
    const config = ia.configMcp({ agent: "principal", conversation: "dm-principal" });
    assert.ok(config, "l'assistant reçoit le serveur MCP, même sans IA ajoutée");
    const noms = (await mcp(config, "tools/list")).tools.map((t) => t.name);
    assert.ok(noms.includes("proposer_agent") && noms.includes("proposer_choix"), `les outils de l'atelier pour l'assistant (${noms.join(", ")})`);
    const configLou = ia.configMcp({ agent: "lou", conversation: "dm-lou" });
    const nomsLou = configLou ? (await mcp(configLou, "tools/list")).tools.map((t) => t.name) : [];
    assert.ok(!nomsLou.includes("proposer_agent") && !nomsLou.includes("proposer_choix"), "un autre agent n'a pas ces outils");
    const refuse = configLou ? await mcp(configLou, "tools/call", { name: "proposer_agent", arguments: { nom: "Zoe" } }) : null;
    assert.ok(!configLou || refuse.isError, "et son appel est refusé");

    // La carte suivie par conversation, comme sur le PC.
    const appeler = (args, cfg = config, nom = "proposer_agent") => mcp(cfg, "tools/call", { name: nom, arguments: args });
    assert.match((await appeler({ nom: "Zoe", role: "Veille", mission: "Suit les concurrents." })).content[0].text, /Carte de Zoe à jour : 1\/5 piliers/);
    assert.match((await appeler({ declencheurs: ["Chaque vendredi"] })).content[0].text, /Carte de Zoe à jour : 2\/5 piliers/);
    const autre = ia.configMcp({ agent: "principal", conversation: "dm-principal@ailleurs" });
    assert.match((await appeler({ declencheurs: ["Le lundi"] }, autre)).content[0].text, /Carte de l’agent à jour : 1\/5/, "une autre conversation, une autre carte");
    assert.equal((await appeler({ nom: "lou" })).isError, true, "un prénom déjà pris est refusé");
    assert.equal((await appeler({ voisins: [{ id: "absent", raison: "x" }] })).isError, true, "un voisin hors de l'équipe est refusé");
    assert.match((await appeler({ voisins: [{ id: "lou", raison: "Elle écrit déjà." }] })).content[0].text, /2\/5/);
    assert.match((await appeler({ options: ["Lundi", "Mardi"] }, config, "proposer_choix")).content[0].text, /Réponses affichées/);
    assert.equal((await appeler({ options: ["Seule"] }, config, "proposer_choix")).isError, true);

    // L'atelier d'une équipe, suivi de même par conversation.
    assert.ok(noms.includes("proposer_equipe") && !nomsLou.includes("proposer_equipe"), "l'atelier d'équipe : à l'assistant seulement");
    const equipe = (args) => mcp(config, "tools/call", { name: "proposer_equipe", arguments: args });
    assert.match((await equipe({ nom: "Studio", membres: [{ nom: "Nina", role: "Rédaction", mission: "Écrit la newsletter." }] })).content[0].text, /Équipe « Studio » à jour : 1 agent — Nina \(nina, Rédaction\)/);
    assert.match((await equipe({ membres: [{ nom: "Léo", role: "Visuels" }] })).content[0].text, /2 agents[^]*Léo : sa mission/, "un membre de plus, les autres restent");
    assert.equal((await equipe({ membres: [{ nom: "Lou" }] })).isError, true, "un agent déjà dans Mes agents va dans existants");
    assert.match((await equipe({ existants: [{ id: "lou", raison: "Relit tout." }], exemples: [{ demande: "La newsletter de mai", membre: "Nina" }] })).content[0].text, /Avec ses agents actifs : lou/);
    // Nina créée sur le PC, puis copiée au VPS : la carte suivante repart de zéro.
    const nee = await appel(ecoute.port, `${CHEMIN_EQUIPE}/creer`, { methode: "POST", jeton, corps: { id: "nina", contenu: "---\nname: nina\ndisplayName: Nina\n---\nPrompt." } });
    assert.equal(nee.statut, 200, JSON.stringify(nee.json));
    assert.match((await equipe({ nom: "Autre" })).content[0].text, /Équipe « Autre » à jour : 0 agent\./, "après la naissance sur le PC, une autre carte");

    // L'épreuve sur le VPS : un raté, puis la phrase ajoutée, que l'assistant verra.
    const brouillon = (corps) => ({ id: "veille", description: "Veille.", corps, modele: "sonnet", fiche: `---\nname: veille\n---\n\n${corps}\n` });
    const cas = { type: "hors-metier", demande: "Corrige le bug du formulaire." };
    const rate = await appel(ecoute.port, `${CHEMIN_AGENT}/essayer`, { methode: "POST", jeton, corps: { brouillon: brouillon("# Zoe — Veille"), cas, conversation: "dm-principal", ajouts: [] } });
    assert.equal(rate.statut, 200);
    assert.equal(rate.json.resultat.verdict, "ko");
    assert.deepEqual(rate.json.resultat.correction, { pilier: "limites", texte: "Le code : je passe la main." });
    assert.equal(rate.json.consommation.length, 2, "l'essai et le juge rendent ce qu'ils ont consommé");
    const corrige = await appel(ecoute.port, `${CHEMIN_AGENT}/essayer`, {
      methode: "POST",
      jeton,
      corps: { brouillon: brouillon("# Zoe — Veille\n\n## Ce que je ne fais pas\n\n- Le code : je passe la main."), cas, conversation: "dm-principal", ajouts: [{ pilier: "limites", texte: "Le code : je passe la main." }] },
    });
    assert.equal(corrige.json.resultat.verdict, "ok");
    assert.match((await appeler({ mission: "Suit le marché." })).content[0].text, /La personne a ajouté à la fiche[^]*« Le code : je passe la main. »/);
    const essais = readFileSync(path.join(home, "args.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const essai = essais.find((a) => a.includes("--agents"));
    assert.ok(essai && essai[essai.indexOf("--tools") + 1] === "" && essai.includes("--strict-mcp-config") && essai[essai.indexOf("--agent") + 1] === "essai-veille", "l'essai : la fiche comme agent de la session, sans outil ni MCP");

    // Une session de l'assistant : le serveur MCP sait sa conversation, les outils sont permis, la carte s'écrit en direct.
    await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r1", options: { agent: null, prompt: "atelier", sessionId: null, acces: "projet", conversation: "dm-principal" } } });
    for (let i = 0; i < 100 && !publies.some((e) => e.type === "fin"); i++) await new Promise((r) => setTimeout(r, 50));
    const partielles = publies.filter((e) => e.type === "etape-partielle").map((e) => e.entree);
    assert.deepEqual(partielles, [{ nom: "Zoe" }, { nom: "Zoe", role: "Veille" }], "la carte s'écrit pendant que le modèle remplit l'outil");
    const session = readFileSync(path.join(home, "args.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((a) => a.includes("--input-format"));
    const configSession = JSON.parse(session[session.indexOf("--mcp-config") + 1]);
    assert.equal(configSession.mcpServers.klyra.headers["X-Klyra-Conversation"], "dm-principal");
    assert.equal(configSession.mcpServers.klyra.headers["X-Klyra-Agent"], "principal");
    assert.ok(session.includes("mcp__klyra__proposer_agent") && session.includes("mcp__klyra__proposer_equipe") && session.includes("mcp__klyra__proposer_choix"), "les outils de l'atelier permis en accès projet");
    assert.match(session[session.indexOf("--append-system-prompt") + 1], /Pour créer un agent avec elle[^]*Pour composer une équipe/);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
