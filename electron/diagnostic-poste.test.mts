import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CARACTERES_PAR_JETON, description, diagnostiquerPoste } from "./diagnostic-poste.ts";

function poste() {
  const home = mkdtempSync(path.join(os.tmpdir(), "klyra-diagnostic-"));
  const claude = path.join(home, ".claude");
  mkdirSync(path.join(claude, "skills", "rangement"), { recursive: true });
  mkdirSync(path.join(claude, "agents"), { recursive: true });
  return { home, claude, fin: () => rmSync(home, { recursive: true, force: true }) };
}

test("un poste vierge n'ajoute rien", () => {
  const { home, fin } = poste();
  try {
    const d = diagnostiquerPoste(home, []);
    assert.equal(d.total, 0);
    assert.ok(d.elements.every((e) => e.conseil === null));
  } finally {
    fin();
  }
});

test("le CLAUDE.md personnel et ses imports, avec un conseil au-delà de 1 500 jetons", () => {
  const { home, claude, fin } = poste();
  try {
    writeFileSync(path.join(home, "regles.md"), "r".repeat(3000));
    writeFileSync(path.join(claude, "CLAUDE.md"), `${"x".repeat(3000)}\n@~/regles.md\n`);
    const md = diagnostiquerPoste(home, []).elements.find((e) => e.cle === "claude-md")!;
    assert.ok(md.jetons! >= Math.round(6000 / CARACTERES_PAR_JETON));
    assert.match(md.detail, /1 fichier importé/);
    assert.ok(md.conseil && /AGENTS\.md/.test(md.conseil));
  } finally {
    fin();
  }
});

test("skills, agents actifs (seuls comptés), plugins et serveurs MCP", () => {
  const { home, claude, fin } = poste();
  try {
    writeFileSync(path.join(claude, "skills", "rangement", "SKILL.md"), "---\nname: rangement\ndescription: Range les fichiers par type.\n---\nRange.\n");
    writeFileSync(path.join(claude, "agents", "dev.md"), `---\nname: dev\ndescription: "${"d".repeat(400)}"\n---\n`);
    writeFileSync(path.join(claude, "agents", "inactif.md"), `---\nname: inactif\ndescription: "${"i".repeat(4000)}"\n---\n`);
    writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ enabledPlugins: { "vercel@marche": true, "ancien@marche": false } }));
    writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { gmail: {}, notion: {} } }));
    const d = diagnostiquerPoste(home, ["dev"]);
    const par = Object.fromEntries(d.elements.map((e) => [e.cle, e]));
    assert.match(par.skills.detail, /1 skill.*rangement/);
    assert.ok(par.agents.jetons! < 1000 / CARACTERES_PAR_JETON, "l'agent inactif ne compte pas");
    assert.ok(par.agents.conseil && /300 caractères/.test(par.agents.conseil));
    assert.match(par.plugins.detail, /1 activé : vercel/);
    assert.equal(par.plugins.jetons, null);
    assert.match(par.mcp.detail, /2 : gmail, notion/);
    assert.equal(d.total, (par["claude-md"].jetons ?? 0) + (par.skills.jetons ?? 0) + (par.agents.jetons ?? 0));
  } finally {
    fin();
  }
});

test("description d'un en-tête, entre guillemets ou non", () => {
  assert.equal(description('---\nname: a\ndescription: "Avec guillemets"\n---\n'), "Avec guillemets");
  assert.equal(description("---\nname: a\ndescription: Sans guillemets\n---\n"), "Sans guillemets");
  assert.equal(description("pas d'en-tête"), "");
});
