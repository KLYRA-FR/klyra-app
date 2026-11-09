import assert from "node:assert/strict";
import test from "node:test";
import { accesCodex, accordeDOffice, autorisationDe, corpsDeFiche, mcpPourCodex, reponseAutorisation, reponseDOffice, TourCodex } from "./codex-protocole.ts";
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

test("l'accord pour un outil MCP (Composio, outils de l'app) devient une carte, plus un refus d'office", () => {
  // Le formulaire que Codex 0.167 envoie avant un outil MCP qui ne se dit pas en lecture seule.
  const formulaire = {
    threadId: "fil",
    turnId: "tour",
    serverName: "composio",
    mode: "form",
    message: "Allow the composio MCP server to run tool \"COMPOSIO_MULTI_EXECUTE_TOOL\"?",
    requestedSchema: { type: "object", properties: {} },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      persist: ["session", "always"],
      tool_name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      tool_params: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: { query: "from:thomas" } }] },
    },
  };
  assert.deepEqual(autorisationDe("mcpServer/elicitation/request", formulaire), {
    outil: "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL",
    entree: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: { query: "from:thomas" } }] },
    description: "Utiliser « COMPOSIO_MULTI_EXECUTE_TOOL » (composio)",
  });
  assert.deepEqual(reponseAutorisation("mcpServer/elicitation/request", formulaire, "oui"), { action: "accept", content: null, _meta: null });
  assert.deepEqual(reponseAutorisation("mcpServer/elicitation/request", formulaire, "toujours"), { action: "accept", content: null, _meta: { persist: "session" } });
  assert.deepEqual(reponseAutorisation("mcpServer/elicitation/request", formulaire, "non"), { action: "decline", content: null, _meta: null });
  // Un autre formulaire d'un serveur MCP (pas un accord) reste refusé d'office.
  assert.equal(autorisationDe("mcpServer/elicitation/request", { serverName: "composio", _meta: null, message: "Ton nom ?" }), null);

  // La même demande quand Codex passe par une question (formulaires MCP coupés chez lui).
  const question = {
    threadId: "fil",
    turnId: "tour",
    itemId: "appel",
    questions: [
      {
        id: "mcp_tool_call_approval_appel",
        header: "Approve app tool call?",
        question: "Allow the klyra MCP server to run tool \"ouvrir_fil\"?",
        isOther: false,
        isSecret: false,
        options: [{ label: "Allow" }, { label: "Allow for this session" }, { label: "Cancel" }],
      },
    ],
  };
  assert.deepEqual(autorisationDe("item/tool/requestUserInput", question), { outil: "mcp__klyra__ouvrir_fil", entree: {}, description: "Utiliser « ouvrir_fil » (klyra)" });
  assert.deepEqual(reponseAutorisation("item/tool/requestUserInput", question, "oui"), { answers: { mcp_tool_call_approval_appel: { answers: ["Allow"] } } });
  assert.deepEqual(reponseAutorisation("item/tool/requestUserInput", question, "toujours"), { answers: { mcp_tool_call_approval_appel: { answers: ["Allow for this session"] } } });
  assert.deepEqual(reponseAutorisation("item/tool/requestUserInput", question, "non"), { answers: { mcp_tool_call_approval_appel: { answers: ["Cancel"] } } });
  // « Pour cette session » pas proposé : un simple accord.
  const sansSession = { ...question, questions: [{ ...question.questions[0], options: [{ label: "Allow" }, { label: "Cancel" }] }] };
  assert.deepEqual(reponseAutorisation("item/tool/requestUserInput", sansSession, "toujours"), { answers: { mcp_tool_call_approval_appel: { answers: ["Allow"] } } });
  // Une vraie question de l'agent n'est pas une carte : il la pose dans sa réponse.
  assert.equal(autorisationDe("item/tool/requestUserInput", { questions: [{ id: "couleur", question: "Bleu ou vert ?" }] }), null);
});

test("accordé sans carte : tout en accès complet, les outils libres de l'app en accès projet, rien en accès demander", () => {
  const libres = ["mcp__klyra__ouvrir_fil", "mcp__composio__COMPOSIO_SEARCH_TOOLS"];
  assert.equal(accordeDOffice("tout", "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", libres), true);
  assert.equal(accordeDOffice("projet", "mcp__klyra__ouvrir_fil", libres), true);
  assert.equal(accordeDOffice("projet", "mcp__composio__COMPOSIO_SEARCH_TOOLS", libres), true);
  assert.equal(accordeDOffice("projet", "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", libres), false);
  assert.equal(accordeDOffice("demander", "mcp__klyra__ouvrir_fil", libres), false);
});

test("ce que l'app ne sait pas montrer est refusé d'office, sans bloquer Codex", () => {
  assert.deepEqual(reponseDOffice("mcpServer/elicitation/request"), { result: { action: "decline", content: null, _meta: null } });
  assert.deepEqual(reponseDOffice("item/tool/requestUserInput"), { result: { answers: {} } });
  assert.equal("error" in reponseDOffice("attestation/generate"), true);
});
