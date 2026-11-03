import assert from "node:assert/strict";
import test from "node:test";
import { consigneTitre, nettoyerTitre, TEXTE_MAX, TITRE_MAX } from "./titre.ts";

test("la demande est encadrée et coupée", () => {
  const consigne = consigneTitre("x".repeat(TEXTE_MAX + 50));
  assert.match(consigne, /<demande>\nx+\n<\/demande>/);
  assert.ok(!consigne.includes("x".repeat(TEXTE_MAX + 1)));
});

test("un titre propre passe tel quel", () => {
  assert.equal(nettoyerTitre("Poids du dossier"), "Poids du dossier");
});

test("guillemets, préfixe, gras et point final retirés", () => {
  assert.equal(nettoyerTitre("Titre : « poids du dossier »."), "Poids du dossier");
  assert.equal(nettoyerTitre('**"Relance facture Dupont"**\n'), "Relance facture Dupont");
});

test("seule la première ligne compte", () => {
  assert.equal(nettoyerTitre("\nPoids du dossier\nJe ne peux pas répondre."), "Poids du dossier");
});

test("une réponse vide ou trop longue n'est pas un titre", () => {
  assert.equal(nettoyerTitre("   \n "), null);
  assert.equal(nettoyerTitre("mot ".repeat(TITRE_MAX)), null);
});

test("un titre un peu long est coupé", () => {
  const titre = nettoyerTitre("a".repeat(TITRE_MAX + 10));
  assert.equal(titre?.length, TITRE_MAX);
  assert.ok(titre?.endsWith("…"));
});
