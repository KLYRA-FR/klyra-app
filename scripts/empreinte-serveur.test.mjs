import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { empreinteCodeServeur } from "./empreinte-serveur.mjs";

function dossier(t) {
  const d = mkdtempSync(path.join(os.tmpdir(), "klyra-empreinte-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(path.join(d, "klyra-serveur.mjs"), "export const a = 1;\nexport const b = 2;\n");
  writeFileSync(path.join(d, "lancer.sh"), "#!/bin/sh\n");
  return d;
}

test("changer le code du serveur ou lancer.sh change l’empreinte", (t) => {
  const d = dossier(t);
  const depart = empreinteCodeServeur(d);
  writeFileSync(path.join(d, "klyra-serveur.mjs"), "export const a = 2;\nexport const b = 2;\n");
  const apresCode = empreinteCodeServeur(d);
  assert.notEqual(apresCode, depart);
  writeFileSync(path.join(d, "lancer.sh"), "#!/bin/sh\necho nouveau\n");
  assert.notEqual(empreinteCodeServeur(d), apresCode);
});

test("un nouveau fichier du serveur change l’empreinte", (t) => {
  const d = dossier(t);
  const depart = empreinteCodeServeur(d);
  writeFileSync(path.join(d, "coffre.mjs"), "export {};\n");
  assert.notEqual(empreinteCodeServeur(d), depart);
});

test("les tests et la version elle-même ne comptent pas", (t) => {
  const d = dossier(t);
  const depart = empreinteCodeServeur(d);
  writeFileSync(path.join(d, "klyra-serveur.test.mjs"), "// un test\n");
  writeFileSync(path.join(d, "version-code.mjs"), "export const VERSION_CODE_SERVEUR = 9;\n");
  writeFileSync(path.join(d, "notes.txt"), "autre chose\n");
  assert.equal(empreinteCodeServeur(d), depart);
});

test("les fins de ligne de Windows ne comptent pas", (t) => {
  const d = dossier(t);
  const depart = empreinteCodeServeur(d);
  writeFileSync(path.join(d, "klyra-serveur.mjs"), "export const a = 1;\r\nexport const b = 2;\r\n");
  assert.equal(empreinteCodeServeur(d), depart);
});
