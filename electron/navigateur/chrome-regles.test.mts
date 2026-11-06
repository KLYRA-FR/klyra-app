import assert from "node:assert/strict";
import test from "node:test";
import { argumentsChrome, cheminsCandidatsChrome, lirePortActif, trouverChrome } from "./chrome-regles.ts";

test("Chrome se cherche aux emplacements habituels de chaque système", () => {
  const win = cheminsCandidatsChrome("win32", { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" });
  assert.deepEqual(win, [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
  ]);
  assert.equal(cheminsCandidatsChrome("darwin", { HOME: "/Users/a" })[0], "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.ok(cheminsCandidatsChrome("darwin", { HOME: "/Users/a" }).includes("/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
  assert.equal(cheminsCandidatsChrome("linux", {})[0], "/usr/bin/google-chrome");
  // Un chemin donné passe en premier (tests, installation à part).
  assert.equal(cheminsCandidatsChrome("linux", { KLYRA_CHROME_PATH: "/opt/chrome/chrome" })[0], "/opt/chrome/chrome");
  assert.equal(trouverChrome("linux", {}, (c) => c === "/usr/bin/chromium"), "/usr/bin/chromium");
  assert.equal(trouverChrome("linux", {}, () => false), null);
});

test("pour la personne, un Chrome ordinaire ; pour les agents, le même profil avec un port local", () => {
  const personne = argumentsChrome("/donnees/navigateur-chrome", "personne", "https://exemple.fr/connexion");
  assert.deepEqual(personne, ["--user-data-dir=/donnees/navigateur-chrome", "--no-first-run", "--no-default-browser-check", "https://exemple.fr/connexion"]);
  assert.ok(!personne.some((a) => a.includes("remote-debugging") || a.includes("automation")), "aucun pilotage pour la personne");

  const agent = argumentsChrome("/donnees/navigateur-chrome", "agent");
  assert.ok(agent.includes("--remote-debugging-port=0"));
  assert.ok(!agent.some((a) => a.includes("automation") || a.includes("AutomationControlled")), "rien qui masque le pilotage");
  assert.equal(agent.at(-1), "about:blank");
  // Seulement une page web : rien d'autre ne part en argument.
  assert.equal(argumentsChrome("/p", "personne", "--disable-web-security").at(-1), "about:blank");
  assert.equal(argumentsChrome("/p", "personne", "file:///etc/passwd").at(-1), "about:blank");
});

test("DevToolsActivePort : le port et le chemin du navigateur", () => {
  assert.deepEqual(lirePortActif("43117\n/devtools/browser/0c5b-11\n"), { port: 43117, chemin: "/devtools/browser/0c5b-11" });
  assert.deepEqual(lirePortActif("9222\r\n/devtools/browser/abc"), { port: 9222, chemin: "/devtools/browser/abc" });
  assert.equal(lirePortActif(""), null);
  assert.equal(lirePortActif("9222"), null);
  assert.equal(lirePortActif("0\n/devtools/browser/x"), null);
  assert.equal(lirePortActif("9222\n/autre/chose"), null);
});
