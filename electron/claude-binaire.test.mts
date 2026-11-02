import assert from "node:assert/strict";
import test from "node:test";
import { expliquerLancement, trierExtensions } from "./claude-binaire.ts";

const binaire = (editeur: string, version: string) =>
  `C:\\Users\\Klyra\\${editeur}\\extensions\\anthropic.claude-code-${version}-win32-x64\\resources\\native-binary\\claude.exe`.replaceAll("\\", "/");

test("la plus récente des extensions passe d’abord, VS Code et Cursor confondus", () => {
  const vieux = binaire(".cursor", "2.1.201");
  const recent = binaire(".vscode", "2.1.316");
  const ancien = binaire(".vscode", "2.1.99");
  assert.deepEqual(trierExtensions([ancien, vieux, recent]), [recent, vieux, ancien]);
});

test("une option inconnue dit que Claude Code est trop ancien, et lequel", () => {
  const chemin = "C:\\Users\\Klyra\\.cursor\\extensions\\anthropic.claude-code-2.1.201-win32-x64\\resources\\native-binary\\claude.exe";
  const message = expliquerLancement("error: unknown option '--permission-prompts'\n", chemin);
  assert.ok(message);
  assert.match(message, /trop ancien/);
  assert.match(message, /--permission-prompts/);
  assert.match(message, /extension Cursor/);
  assert.ok(message.includes(chemin));
});

test("hors extension, le chemin seul", () => {
  const message = expliquerLancement("error: unknown option '--effort'", "/usr/local/bin/claude");
  assert.ok(message?.includes("L’app utilise /usr/local/bin/claude."));
});

test("une autre erreur garde la sortie de Claude Code", () => {
  assert.equal(expliquerLancement("API Error: 529 overloaded", "/usr/local/bin/claude"), null);
  assert.equal(expliquerLancement("", "/usr/local/bin/claude"), null);
});
