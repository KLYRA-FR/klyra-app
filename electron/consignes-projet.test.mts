import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appliquerConsignesProjet, commandesVerification, etatConsignesProjet, IMPORT_AGENTS } from "./consignes-projet.ts";

function projet() {
  const dossier = mkdtempSync(path.join(os.tmpdir(), "klyra-consignes-"));
  return { dossier, lire: (nom: string) => readFileSync(path.join(dossier, nom), "utf8"), fin: () => rmSync(dossier, { recursive: true, force: true }) };
}

test("projet vierge : AGENTS.md à remplir, et un CLAUDE.md qui l'importe", () => {
  const { dossier, lire, fin } = projet();
  try {
    const avant = etatConsignesProjet(dossier, "Site du Bouchon");
    assert.deepEqual(avant.propositions.map((p) => `${p.nom}:${p.action}`), ["AGENTS.md:creer", "CLAUDE.md:creer"]);
    const apres = appliquerConsignesProjet(dossier, "Site du Bouchon");
    assert.equal(apres.propositions.length, 0);
    assert.match(lire("AGENTS.md"), /^# Site du Bouchon\n/);
    assert.match(lire("AGENTS.md"), /## Vérifier avant de dire que c'est fini/);
    assert.equal(lire("CLAUDE.md"), `${IMPORT_AGENTS}\n`);
  } finally {
    fin();
  }
});

test("un CLAUDE.md existant reçoit seulement l'import en tête, une seule fois ; rien n'est écrasé", () => {
  const { dossier, lire, fin } = projet();
  try {
    writeFileSync(path.join(dossier, "CLAUDE.md"), "Mes consignes à moi.\n");
    writeFileSync(path.join(dossier, "AGENTS.md"), "Déjà écrit.\n");
    const etat = etatConsignesProjet(dossier, "P");
    assert.equal(etat.claudeMd, "sans-import");
    assert.deepEqual(etat.propositions.map((p) => `${p.nom}:${p.action}`), ["CLAUDE.md:ajouter-import"]);
    appliquerConsignesProjet(dossier, "P");
    appliquerConsignesProjet(dossier, "P");
    assert.equal(lire("CLAUDE.md"), `${IMPORT_AGENTS}\n\nMes consignes à moi.\n`);
    assert.equal(lire("AGENTS.md"), "Déjà écrit.\n");
    assert.equal(etatConsignesProjet(dossier, "P").claudeMd, "importe");
  } finally {
    fin();
  }
});

test("les commandes de vérification devinées d'après le package.json et le verrou", () => {
  const { dossier, fin } = projet();
  try {
    assert.equal(commandesVerification(dossier), null);
    writeFileSync(path.join(dossier, "package.json"), JSON.stringify({ scripts: { lint: "eslint", test: "vitest", dev: "next dev" } }));
    assert.equal(commandesVerification(dossier), "npm run lint && npm run test");
    writeFileSync(path.join(dossier, "pnpm-lock.yaml"), "");
    assert.equal(commandesVerification(dossier), "pnpm lint && pnpm test");
    assert.match(etatConsignesProjet(dossier, "P").propositions[0].contenu, /pnpm lint && pnpm test/);
  } finally {
    fin();
  }
});

test("un dossier introuvable est refusé", () => {
  assert.throws(() => etatConsignesProjet(path.join(os.tmpdir(), "klyra-nexiste-pas-1234"), "P"), /introuvable/);
});
