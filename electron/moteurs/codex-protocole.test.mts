import assert from "node:assert/strict";
import test from "node:test";
import { accesCodex, autorisationDe, corpsDeFiche, mcpPourCodex, reponseAutorisation, reponseDOffice, TourCodex } from "./codex-protocole.ts";
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

test("ce que l'app ne sait pas montrer est refusé d'office, sans bloquer Codex", () => {
  assert.deepEqual(reponseDOffice("mcpServer/elicitation/request"), { result: { action: "decline", content: null, _meta: null } });
  assert.deepEqual(reponseDOffice("item/tool/requestUserInput"), { result: { answers: {} } });
  assert.equal("error" in reponseDOffice("attestation/generate"), true);
});
