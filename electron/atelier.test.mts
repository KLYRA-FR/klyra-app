import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { atelierDe, dossierHorsProjet, sessionsDuDossier } from "./atelier.ts";

const ATELIER = path.join("/home/alice", ".klyra", "atelier");
const CONFIG = path.join("/home/alice", ".claude");
const SESSION = "0f8d1c2e-3b4a-4c5d-8e9f-a0b1c2d3e4f5";

test("chaque agent a son dossier ; l'assistant, « principal »", () => {
  assert.equal(atelierDe(ATELIER, "designer"), path.join(ATELIER, "designer"));
  assert.equal(atelierDe(ATELIER, null), path.join(ATELIER, "principal"));
});

test("les sessions d'un dossier, nommées comme Claude Code", () => {
  assert.equal(sessionsDuDossier(CONFIG, "/home/alice/.klyra/atelier"), path.join(CONFIG, "projects", "-home-alice--klyra-atelier"));
  assert.equal(sessionsDuDossier(CONFIG, "C:\\Users\\Ali Ce\\.klyra\\atelier"), path.join(CONFIG, "projects", "C--Users-Ali-Ce--klyra-atelier"));
});

test("une session commencée dans l'atelier commun y reste ; les autres vont chez l'agent", () => {
  const ancienne = path.join(sessionsDuDossier(CONFIG, ATELIER), `${SESSION}.jsonl`);
  const existe = (chemin: string) => chemin === ancienne;
  assert.equal(dossierHorsProjet(ATELIER, "designer", SESSION, CONFIG, existe), ATELIER);
  assert.equal(dossierHorsProjet(ATELIER, "designer", "11111111-2222-4333-8444-555555555555", CONFIG, existe), path.join(ATELIER, "designer"));
  assert.equal(dossierHorsProjet(ATELIER, "designer", null, CONFIG, existe), path.join(ATELIER, "designer"));
});
