import assert from "node:assert/strict";
import test from "node:test";
import { accesCodex, autorisationDe, corpsDeFiche, mcpPourCodex, outilsLibresCodex, reponseAutorisation, reponseDOffice, TourCodex } from "./codex-protocole.ts";
import type { AgentEvent } from "./types.ts";

const FIL = "01a19ce0-267e-77d0-8959-69fa1039a617";

function tour(jetonsAvant = 0) {
  const recus: AgentEvent[] = [];
  const t = new TourCodex(FIL, (e) => recus.push(e), jetonsAvant);
  return { t, recus };
}

test("les trois accès de l'app deviennent une politique et un bac à sable de Codex", () => {
  assert.equal(accesCodex("demander").approvalPolicy, "untrusted");
  assert.equal(accesCodex("demander").sandboxPolicy.type, "readOnly");
  assert.equal(accesCodex("projet").sandbox, "workspace-write");
  assert.equal(accesCodex("tout").approvalPolicy, "never");
  assert.equal(accesCodex("tout").sandboxPolicy.type, "dangerFullAccess");
});

test("les serveurs MCP de l'app passent dans le format de Codex", () => {
  const config = JSON.stringify({ mcpServers: { klyra: { type: "http", url: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer x" } }, local: { command: "node", args: ["s.js"] } } });
  assert.deepEqual(mcpPourCodex(config), {
    klyra: { url: "http://127.0.0.1:1/mcp", http_headers: { Authorization: "Bearer x" } },
    local: { command: "node", args: ["s.js"] },
  });
  assert.deepEqual(mcpPourCodex(null), {});
});

test("les outils libres de l'app sont approuvés d'avance pour Codex, tous en accès complet", () => {
  const config = JSON.stringify({ mcpServers: { klyra: { type: "http", url: "http://127.0.0.1:1/mcp" }, ordinateur: { command: "cua" }, linear: { url: "https://mcp.linear.app/mcp" } } });
  const libres = ["mcp__klyra__cerveau_chercher", "mcp__klyra__creer_routine", "mcp__klyra__cerveau_chercher", "mcp__ordinateur__capture", "Bash(git status)", "mcp__klyra__"];
  // Accès « Projet » : outil par outil, seulement ceux de la liste, rangés sous leur serveur.
  assert.deepEqual(mcpPourCodex(config, libres), {
    klyra: { url: "http://127.0.0.1:1/mcp", tools: { cerveau_chercher: { approval_mode: "approve" }, creer_routine: { approval_mode: "approve" } } },
    ordinateur: { command: "cua", args: [], tools: { capture: { approval_mode: "approve" } } },
    linear: { url: "https://mcp.linear.app/mcp" },
  });
  // Accès complet : Codex refuserait tout appel MCP (« approval policy is never ») sans cette approbation.
  for (const serveur of Object.values(mcpPourCodex(config, "tout"))) assert.equal(serveur.default_tools_approval_mode, "approve");
  // Accès « Demander » : rien d'approuvé d'avance, chaque appel passe par une carte.
  assert.equal(JSON.stringify(mcpPourCodex(config, [])).includes("approv"), false);
  let lus = 0;
  const liste = () => (lus++, ["mcp__klyra__cerveau_lire"]);
  assert.equal(outilsLibresCodex("tout", liste), "tout");
  assert.deepEqual(outilsLibresCodex("demander", liste), []);
  assert.deepEqual(outilsLibresCodex("projet", liste), ["mcp__klyra__cerveau_lire"]);
  assert.equal(lus, 1);
});

test("la fiche d'un agent perd son en-tête YAML", () => {
  assert.equal(corpsDeFiche("---\nname: hugo\nmodel: opus\n---\n\nTu es Hugo.\n"), "Tu es Hugo.");
  assert.equal(corpsDeFiche("Sans en-tête."), "Sans en-tête.");
});

test("un tour : texte, étape, texte après l'étape sur un nouveau bloc, puis la fin", () => {
  const { t, recus } = tour();
  t.notification("turn/started", { threadId: FIL, turn: { id: "t1" } });
  t.notification("item/agentMessage/delta", { delta: "Je regarde." });
  t.notification("item/started", { item: { type: "commandExecution", id: "c1", command: "ls" } });
  t.notification("item/completed", { item: { type: "commandExecution", id: "c1", status: "completed", exitCode: 0, aggregatedOutput: "a.txt\n" } });
  t.notification("item/agentMessage/delta", { delta: "Voilà." });
  t.notification("item/completed", { item: { type: "agentMessage", id: "m2", text: "Voilà." } });
  assert.equal(t.turnId, "t1");
  const fini = t.notification("turn/completed", { threadId: FIL, turn: { status: "completed", error: null } });
  assert.equal(fini, true);
  assert.deepEqual(recus, [
    { type: "texte", delta: "Je regarde.", nouveauBloc: false },
    { type: "etape", id: "c1", outil: "Bash", entree: { command: "ls" }, parent: null },
    { type: "etape-fin", id: "c1", ok: true, apercu: "a.txt" },
    { type: "texte", delta: "Voilà.", nouveauBloc: true },
    { type: "fin", ok: true, texte: "Voilà.", erreur: undefined, sessionId: FIL },
  ]);
});

test("les outils MCP gardent le nom que l'interface connaît, et une commande en échec est en échec", () => {
  const { t, recus } = tour();
  t.notification("item/started", { item: { type: "mcpToolCall", id: "m1", server: "klyra", tool: "ouvrir_fil", arguments: { agent: "hugo" } } });
  t.notification("item/completed", { item: { type: "mcpToolCall", id: "m1", status: "completed", error: null, result: { content: [{ type: "text", text: "Fil ouvert" }] } } });
  t.notification("item/started", { item: { type: "commandExecution", id: "c2", command: "false" } });
  t.notification("item/completed", { item: { type: "commandExecution", id: "c2", status: "completed", exitCode: 1, aggregatedOutput: "" } });
  t.notification("item/started", { item: { type: "reasoning", id: "r1" } });
  assert.deepEqual(recus, [
    { type: "etape", id: "m1", outil: "mcp__klyra__ouvrir_fil", entree: { agent: "hugo" }, parent: null },
    { type: "etape-fin", id: "m1", ok: true, apercu: "Fil ouvert" },
    { type: "etape", id: "c2", outil: "Bash", entree: { command: "false" }, parent: null },
    { type: "etape-fin", id: "c2", ok: false, apercu: "" },
  ]);
});

test("les jetons comptent la réponse, pas tout le fil", () => {
  const { t, recus } = tour(100);
  t.notification("thread/tokenUsage/updated", { tokenUsage: { total: { outputTokens: 130, reasoningOutputTokens: 20 } } });
  assert.deepEqual(recus, [{ type: "jetons", total: 50 }]);
  assert.equal(t.jetonsDuFil, 150);
});

test("un tour arrêté ou en erreur finit sur le bon message", () => {
  const arrete = tour();
  arrete.t.arrete = true;
  arrete.t.notification("turn/completed", { turn: { status: "interrupted", error: null } });
  assert.deepEqual(arrete.recus.at(-1), { type: "fin", ok: false, texte: "", erreur: "Arrêté par toi.", sessionId: FIL });
  const echec = tour();
  echec.t.notification("turn/completed", { turn: { status: "failed", error: { message: "Quota atteint" } } });
  assert.deepEqual(echec.recus.at(-1), { type: "fin", ok: false, texte: "", erreur: "Quota atteint", sessionId: FIL });
});

test("les demandes d'autorisation deviennent des cartes, et ta réponse repart dans les mots de Codex", () => {
  assert.deepEqual(autorisationDe("item/commandExecution/requestApproval", { command: "rm -rf build", reason: "Nettoyer" }), {
    outil: "Bash",
    entree: { command: "rm -rf build" },
    description: "Nettoyer",
  });
  assert.equal(autorisationDe("item/tool/requestUserInput", {}), null);
  assert.deepEqual(reponseAutorisation("item/commandExecution/requestApproval", {}, "toujours"), { decision: "acceptForSession" });
  assert.deepEqual(reponseAutorisation("item/fileChange/requestApproval", {}, "non"), { decision: "decline" });
  const permissions = { network: { enabled: true }, fileSystem: null };
  assert.deepEqual(reponseAutorisation("item/permissions/requestApproval", { permissions }, "oui"), { permissions, scope: "turn" });
  assert.deepEqual(reponseAutorisation("item/permissions/requestApproval", { permissions }, "non"), { permissions: {}, scope: "turn" });
});

/* L'accord avant un appel d'outil MCP, tel que Codex 0.166 l'envoie (relevé sur le vrai programme). */
const ACCORD_MCP = {
  threadId: FIL,
  turnId: "01a1bf3e-7f7a-7dd1-9ecd-298fa3c3ff4a",
  serverName: "klyra",
  mode: "form",
  _meta: {
    codex_approval_kind: "mcp_tool_call",
    persist: ["session", "always"],
    tool_description: "Lance un workflow enregistré.",
    tool_params: { id: "brief-du-matin" },
    tool_params_display: [{ name: "id", value: "brief-du-matin", display_name: "id" }],
  },
  message: 'Allow the klyra MCP server to run tool "lancer_workflow"?',
  requestedSchema: { type: "object", properties: {} },
};

test("l'accord avant un appel d'outil MCP devient une carte, comme pour Claude Code", () => {
  assert.deepEqual(autorisationDe("mcpServer/elicitation/request", ACCORD_MCP), {
    outil: "mcp__klyra__lancer_workflow",
    entree: { id: "brief-du-matin" },
    description: "Lance un workflow enregistré.",
  });
  // Sans le nom de l'outil dans la question : le serveur seul, la carte reste lisible.
  const sansNom = autorisationDe("mcpServer/elicitation/request", { ...ACCORD_MCP, message: "Autre texte", _meta: { codex_approval_kind: "mcp_tool_call" } });
  assert.deepEqual(sansNom, { outil: "mcp__klyra", entree: {}, description: "Utiliser un outil de klyra" });
  // Un vrai formulaire d'un serveur MCP n'est pas un accord : refusé d'office, comme avant.
  assert.equal(autorisationDe("mcpServer/elicitation/request", { ...ACCORD_MCP, _meta: null }), null);
  assert.equal(autorisationDe("mcpServer/elicitation/request", { ...ACCORD_MCP, mode: "url", _meta: { autre: true } }), null);

  assert.deepEqual(reponseAutorisation("mcpServer/elicitation/request", ACCORD_MCP, "oui"), { action: "accept", content: {}, _meta: null });
  // « Toujours » : pour la session de Codex, jamais `always` (écrit dans sa configuration).
  assert.deepEqual(reponseAutorisation("mcpServer/elicitation/request", ACCORD_MCP, "toujours"), { action: "accept", content: {}, _meta: { persist: "session" } });
  const sansSession = { ...ACCORD_MCP, _meta: { ...ACCORD_MCP._meta, persist: ["always"] } };
  assert.deepEqual(reponseAutorisation("mcpServer/elicitation/request", sansSession, "toujours"), { action: "accept", content: {}, _meta: null });
  assert.deepEqual(reponseAutorisation("mcpServer/elicitation/request", ACCORD_MCP, "non"), { action: "decline", content: null, _meta: null });
});

test("ce que l'app ne sait pas montrer est refusé d'office, sans bloquer Codex", () => {
  assert.deepEqual(reponseDOffice("mcpServer/elicitation/request"), { result: { action: "decline", content: null, _meta: null } });
  assert.deepEqual(reponseDOffice("item/tool/requestUserInput"), { result: { answers: {} } });
  assert.equal("error" in reponseDOffice("attestation/generate"), true);
});
