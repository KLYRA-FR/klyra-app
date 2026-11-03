import assert from "node:assert/strict";
import test from "node:test";
import { lireListeArtefacts } from "./artefacts-liste.ts";

const reponse = (champs: Record<string, unknown>) => JSON.stringify({ type: "result", subtype: "success", is_error: false, permission_denials: [], ...champs });

test("lit le tableau, même entouré de texte, et écarte ce qui n’est pas un lien d’artefact", () => {
  const result = 'Voici : [{"titre": "Propale", "url": "https://claude.ai/artifact/abc-1", "misAJour": "2026-11-01T10:00:00Z"}, {"url": "https://claude.ai/code/artifact/def"}, {"titre": "X", "url": "https://exemple.fr"}]';
  assert.deepEqual(lireListeArtefacts(reponse({ result })), [
    { titre: "Propale", url: "https://claude.ai/artifact/abc-1", misAJour: "2026-11-01T10:00:00Z" },
    { titre: "Sans titre", url: "https://claude.ai/code/artifact/def", misAJour: null },
  ]);
  assert.deepEqual(lireListeArtefacts(reponse({ result: "[]" })), []);
});

test("Claude Code pas connecté : dit comment se connecter", () => {
  assert.throws(() => lireListeArtefacts(reponse({ is_error: true, result: "Not logged in · Please run /login" })), /lance claude puis \/login/);
});

test("pas de tableau : redit la réponse de Claude Code au lieu d’un message vague", () => {
  assert.throws(
    () => lireListeArtefacts(reponse({ result: "Je n’ai pas accès à un outil Artifact dans cette session." })),
    /n’a pas pu lire tes artefacts : « Je n’ai pas accès à un outil Artifact dans cette session\. »/,
  );
  assert.throws(() => lireListeArtefacts(reponse({ result: "[pas du json]" })), /« \[pas du json\] »/);
});

test("autres échecs : erreur de l’API, outil refusé, sortie vide ou illisible", () => {
  assert.throws(() => lireListeArtefacts(reponse({ is_error: true, result: "API Error: 529 Overloaded" })), /a échoué : « API Error: 529 Overloaded »/);
  assert.throws(() => lireListeArtefacts(reponse({ result: "", permission_denials: [{ tool_name: "Artifact" }] })), /outil Artifact/);
  assert.throws(() => lireListeArtefacts(""), /n’a rien répondu/);
  assert.throws(() => lireListeArtefacts("error: something"), /autre chose que prévu : « error: something »/);
});
