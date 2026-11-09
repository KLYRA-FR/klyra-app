import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { creerCodex } from "./codex.mjs";

/** Un faux `codex app-server` qui se fige : `muet` ne répond jamais à turn/start, sinon il démarre le tour puis se tait. */
function fauxCodex(dossier) {
  const fichier = path.join(dossier, "faux-codex.mjs");
  writeFileSync(
    fichier,
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
import readline from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
/* L'accord que Codex 0.167 demande avant un outil MCP qui ne se dit pas en lecture seule. */
const accord = (serverName, tool_name) => ({
  threadId: "t1",
  turnId: "u1",
  serverName,
  mode: "form",
  message: "Allow?",
  requestedSchema: { type: "object", properties: {} },
  _meta: { codex_approval_kind: "mcp_tool_call", tool_name, tool_params: { a: 1 } },
});
readline.createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize") out({ id: m.id, result: { userAgent: "codex/1.0.0" } });
  else if (m.method === "thread/start") out({ id: m.id, result: { thread: { id: "t1" } } });
  else if (m.method === "turn/start" && process.env.FAUX_MODE === "mcp") {
    out({ id: m.id, result: { turn: { id: "u1" } } });
    out({ id: 900, method: "mcpServer/elicitation/request", params: accord("klyra", "ouvrir_fil") });
  } else if (m.method === "turn/start" && process.env.FAUX_MODE !== "muet") out({ id: m.id, result: { turn: { id: "u1" } } });
  else if (m.id === 900 || m.id === 901) {
    appendFileSync(process.env.FAUX_JOURNAL, JSON.stringify(m) + "\\n");
    if (m.id === 900) out({ id: 901, method: "mcpServer/elicitation/request", params: accord("composio", "COMPOSIO_MULTI_EXECUTE_TOOL") });
    else out({ method: "turn/completed", params: { threadId: "t1", turn: { id: "u1", status: "completed", error: null } } });
  }
  else if (m.method === "turn/interrupt") out({ id: m.id, result: {} });
});
`,
  );
  chmodSync(fichier, 0o755);
  return fichier;
}

async function finDe(mode, arreter) {
  process.env.FAUX_MODE = mode;
  const dossier = mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
  const evenements = [];
  const codex = creerCodex({
    home: dossier,
    version: "test",
    publier: (_r, e) => evenements.push(e),
    consigne: () => "",
    estActif: () => true,
    mcp: () => null,
    generation: () => "g",
    codex: fauxCodex(dossier),
    delais: { requete: 800, inactivite: 1000, pas: 200 },
  });
  codex.envoyer("r1", { prompt: "x", acces: "projet" }, dossier);
  if (arreter) setTimeout(() => codex.annuler("r1"), 300);
  const debut = Date.now();
  while (!evenements.some((e) => e.type === "fin") && Date.now() - debut < 6000) await new Promise((r) => setTimeout(r, 50));
  codex.fermer?.();
  return evenements.find((e) => e.type === "fin");
}

test("un tour qui ne donne plus de nouvelles se termine en erreur", async () => {
  const fin = await finDe("fige");
  assert.equal(fin?.ok, false);
  assert.match(fin.erreur, /ne répond plus/);
});

test("turn/start sans réponse : la réponse se termine en erreur", async () => {
  const fin = await finDe("muet");
  assert.equal(fin?.ok, false);
  assert.match(fin.erreur, /turn\/start/);
});

test("arrêter avant la réponse de turn/start ne laisse pas la réponse suspendue", async () => {
  const fin = await finDe("muet", true);
  assert.equal(fin?.ok, false);
});

test("accès projet : un outil libre de l'app est accordé d'office, un outil Composio attend ta carte, puis part accepté", async () => {
  process.env.FAUX_MODE = "mcp";
  const dossier = mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
  process.env.FAUX_JOURNAL = path.join(dossier, "journal.jsonl");
  const evenements = [];
  const codex = creerCodex({
    home: dossier,
    version: "test",
    publier: (_r, e) => evenements.push(e),
    consigne: () => "",
    estActif: () => true,
    mcp: () => null,
    libres: () => ["mcp__klyra__ouvrir_fil"],
    generation: () => "g",
    codex: fauxCodex(dossier),
    delais: { requete: 2000, inactivite: 5000, pas: 200 },
  });
  codex.envoyer("r1", { prompt: "x", acces: "projet" }, dossier);
  const attendre = async (ok) => {
    const debut = Date.now();
    while (!ok() && Date.now() - debut < 6000) await new Promise((r) => setTimeout(r, 30));
  };
  await attendre(() => evenements.some((e) => e.type === "autorisation"));
  const cartes = evenements.filter((e) => e.type === "autorisation");
  // Une seule carte : celle de Composio. L'outil libre de l'app n'en a pas eu.
  assert.equal(cartes.length, 1);
  assert.equal(cartes[0].outil, "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL");
  assert.deepEqual(cartes[0].entree, { a: 1 });
  assert.equal(codex.autoriser("r1", cartes[0].id, "oui"), true);
  await attendre(() => evenements.some((e) => e.type === "fin"));
  codex.fermer?.();
  assert.equal(evenements.find((e) => e.type === "fin")?.ok, true);
  assert.ok(existsSync(process.env.FAUX_JOURNAL));
  const recus = readFileSync(process.env.FAUX_JOURNAL, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(recus.map((m) => [m.id, m.result?.action]), [[900, "accept"], [901, "accept"]]);
});
