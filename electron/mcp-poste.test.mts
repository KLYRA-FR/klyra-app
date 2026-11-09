import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { serveursDuPoste } from "./mcp-poste.ts";

/**
 * Ce que la Marketplace montre du poste (electron/mcp-poste.ts), sur un dossier
 * personnel temporaire.
 *   node --experimental-strip-types --test electron/mcp-poste.test.mts
 */

function poste(t: test.TestContext, claudeJson?: string, skills: string[] = []) {
  const home = mkdtempSync(path.join(tmpdir(), "klyra-mcp-poste-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  if (claudeJson !== undefined) writeFileSync(path.join(home, ".claude.json"), claudeJson);
  for (const s of skills) {
    mkdirSync(path.join(home, ".claude", "skills", s), { recursive: true });
    writeFileSync(path.join(home, ".claude", "skills", s, "SKILL.md"), "---\nname: x\n---\n");
  }
  return home;
}

test("un poste sans configuration ne montre rien", (t) => {
  assert.deepEqual(serveursDuPoste(poste(t)), []);
});

test("un fichier illisible ou sans serveur ne casse pas la liste", (t) => {
  assert.deepEqual(serveursDuPoste(poste(t, "{ pas du json")), []);
  assert.deepEqual(serveursDuPoste(poste(t, JSON.stringify({ mcpServers: ["x"] }))), []);
  assert.deepEqual(serveursDuPoste(poste(t, JSON.stringify({ mcpServers: { casse: "x" } }))), []);
});

test("un serveur MCP ajouté à la main apparaît, distant par son hôte, local sans sa commande", (t) => {
  const home = poste(t, JSON.stringify({
    mcpServers: {
      distant: { type: "http", url: "https://mcp.exemple.dev/mcp?cle=abc" },
      local: { command: "npx", args: ["outil", "--token", "secret"], env: { CLE: "secret" } },
    },
  }));
  assert.deepEqual(serveursDuPoste(home), [
    { id: "mcp:distant", nom: "distant", detail: "mcp.exemple.dev" },
    { id: "mcp:local", nom: "local", detail: "Commande locale" },
  ]);
});

test("aucun secret ne sort, même dans une adresse avec identifiants", (t) => {
  const home = poste(t, JSON.stringify({
    mcpServers: { s: { url: "https://moi:secret@mcp.exemple.dev/?token=secret", headers: { Authorization: "Bearer secret" } } },
  }));
  assert.ok(!JSON.stringify(serveursDuPoste(home)).includes("secret"));
});

test("Sunra connecté en ligne de commande apparaît par sa skill", (t) => {
  assert.deepEqual(serveursDuPoste(poste(t, undefined, ["sunra"])), [{ id: "outil:sunra", nom: "Sunra", detail: "Outil en ligne de commande" }]);
});

test("Sunra branché aussi en MCP n'apparaît qu'une fois", (t) => {
  const home = poste(t, JSON.stringify({ mcpServers: { sunra: { url: "https://mcp.sunra.ai" } } }), ["sunra"]);
  assert.deepEqual(serveursDuPoste(home), [{ id: "mcp:sunra", nom: "sunra", detail: "mcp.sunra.ai" }]);
});

test("une skill quelconque n'est pas prise pour une app", (t) => {
  assert.deepEqual(serveursDuPoste(poste(t, undefined, ["autre"])), []);
});
