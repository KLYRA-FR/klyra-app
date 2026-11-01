import assert from "node:assert/strict";
import test from "node:test";
import { lienRejoindre } from "./lien-rejoindre.ts";

const LIEN = "klyra://rejoindre?adresse=https%3A%2F%2Fexemple.test&invitation=code-test";

test("klyra://rejoindre est accepté, klyra://connexion ne l’est pas", () => {
  assert.equal(lienRejoindre(LIEN), LIEN);
  assert.equal(lienRejoindre("klyra://connexion?code=abcdefghij123456"), null);
  assert.equal(lienRejoindre("klyra://rejoindre"), null);
  assert.equal(lienRejoindre("https://exemple.test"), null);
  assert.equal(lienRejoindre(12), null);
});
