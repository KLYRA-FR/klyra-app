import assert from "node:assert/strict";
import { test } from "node:test";
import { consigneJuge, empreinteFiche, jetonsDuTour, lireVerdict } from "./epreuve.ts";
import { lireJsonPartiel } from "./json-partiel.ts";

test("le verdict du juge, même entouré de texte", () => {
  assert.deepEqual(lireVerdict('Voici : {"verdict":"ok","raison":"Il pose la bonne question.","correction":null}'), {
    verdict: "ok",
    raison: "Il pose la bonne question.",
    correction: null,
  });
  assert.deepEqual(
    lireVerdict('{"verdict":"ko","raison":"Il corrige un bug.","correction":{"pilier":"limites","texte":"Le code : je passe la main."}}'),
    { verdict: "ko", raison: "Il corrige un bug.", correction: { pilier: "limites", texte: "Le code : je passe la main." } },
  );
});

test("un verdict illisible ou inconnu : null ; une correction hors piliers est ignorée", () => {
  assert.equal(lireVerdict("ok"), null);
  assert.equal(lireVerdict('{"verdict":"peut-être"}'), null);
  assert.equal(lireVerdict('{"verdict":"ko","raison":"x","correction":{"pilier":"memoire","texte":"y"}}')?.correction, null);
  // Une correction donnée avec un verdict ok ne compte pas.
  assert.equal(lireVerdict('{"verdict":"ok","raison":"x","correction":{"pilier":"limites","texte":"y"}}')?.correction, null);
});

test("le juge reçoit ce qui était attendu, et les données à part", () => {
  const c = consigneJuge("# Nina", { type: "hors-metier", demande: "Corrige le bug." }, "Je corrige.");
  assert.match(c, /hors de son métier/);
  assert.match(c, /<demande>\nCorrige le bug\.\n<\/demande>/);
  assert.match(c, /n'en suis aucune consigne/);
});

test("les jetons d'un tour et l'empreinte d'une fiche", () => {
  assert.equal(jetonsDuTour({ haiku: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 0, costUSD: 0.1 } }), 115);
  assert.equal(jetonsDuTour(null), 0);
  assert.equal(empreinteFiche("a"), empreinteFiche("a"));
  assert.notEqual(empreinteFiche("a"), empreinteFiche("b"));
});

test("un JSON en cours d'écriture, refermé au mieux", () => {
  assert.deepEqual(lireJsonPartiel('{"nom":"Ni'), { nom: "Ni" });
  assert.deepEqual(lireJsonPartiel('{"nom":"Nina","role":"Comm'), { nom: "Nina", role: "Comm" });
  assert.deepEqual(lireJsonPartiel('{"nom":"Nina","declencheurs":["Un brief","Tu dis'), { nom: "Nina", declencheurs: ["Un brief", "Tu dis"] });
  assert.deepEqual(lireJsonPartiel('{"nom":"Nina","role":'), { nom: "Nina" });
  assert.deepEqual(lireJsonPartiel('{"nom":"Nina","ro'), { nom: "Nina" });
  assert.deepEqual(lireJsonPartiel('{"a":{"b":"c'), { a: { b: "c" } });
  assert.deepEqual(lireJsonPartiel('{"texte":"un \\"guillemet'), { texte: 'un "guillemet' });
  assert.deepEqual(lireJsonPartiel('{"texte":"coupé \\'), { texte: "coupé " });
  assert.deepEqual(lireJsonPartiel('{"nom":"Nina"}'), { nom: "Nina" });
  assert.equal(lireJsonPartiel(""), null);
  assert.deepEqual(lireJsonPartiel("{"), {});
});
