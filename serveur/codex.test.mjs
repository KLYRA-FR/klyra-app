import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
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
import readline from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize") out({ id: m.id, result: { userAgent: "codex/1.0.0" } });
  else if (m.method === "thread/start") out({ id: m.id, result: { thread: { id: "t1" } } });
  else if (m.method === "turn/start" && process.env.FAUX_MODE !== "muet") out({ id: m.id, result: { turn: { id: "u1" } } });
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
