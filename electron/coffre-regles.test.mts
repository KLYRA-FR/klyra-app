import assert from "node:assert/strict";
import test from "node:test";
import { ecrireDansEnv, ligneEnv, lireDemandeSecret, messageReponseCoffre, normaliserVariable, remplacerModele, validerValeur, variableProposee } from "./coffre-regles.ts";

test("nom de variable : majuscules, chiffres et _, commence par une lettre", () => {
  assert.equal(normaliserVariable("stripe-secret key"), "STRIPE_SECRET_KEY");
  assert.equal(normaliserVariable("  Clé API été  "), "CLE_API_ETE");
  assert.equal(normaliserVariable("OPENAI_API_KEY"), "OPENAI_API_KEY");
  assert.throws(() => normaliserVariable("1PASSWORD"));
  assert.throws(() => normaliserVariable(""));
  assert.throws(() => normaliserVariable("é"));
  assert.throws(() => normaliserVariable(42));
  assert.equal(normaliserVariable("a".repeat(100)).length, 64);
  assert.equal(variableProposee("Clé secrète Stripe"), "CLE_SECRETE_STRIPE");
  assert.equal(variableProposee("!!"), "");
});

test("valeur : sans les espaces collés autour, ni vide ni trop longue", () => {
  assert.equal(validerValeur("  sk_test_123\n"), "sk_test_123");
  assert.equal(validerValeur("​sk﻿"), "sk");
  assert.throws(() => validerValeur("   "));
  assert.throws(() => validerValeur("x".repeat(10_001)));
});

test("ligne .env : brute si possible, sinon entre guillemets échappés", () => {
  assert.equal(ligneEnv("K", "sk_test-1.2/3+4=="), "K=sk_test-1.2/3+4==");
  assert.equal(ligneEnv("K", 'a b"$c`\\'), 'K="a b\\"\\$c\\`\\\\"');
  assert.throws(() => ligneEnv("K", "a\nb"));
});

test("fichier .env : remplace la ligne de la variable, garde le reste et export, sinon ajoute", () => {
  const avant = "# config\nAUTRE=1\nexport STRIPE_KEY=ancien\nSTRIPE_KEY_2=x";
  const r = ecrireDansEnv(avant, "STRIPE_KEY", "nouveau");
  assert.equal(r.remplace, true);
  assert.equal(r.contenu, "# config\nAUTRE=1\nexport STRIPE_KEY=nouveau\nSTRIPE_KEY_2=x");
  const ajout = ecrireDansEnv("AUTRE=1", "NOUVELLE", "v");
  assert.deepEqual(ajout, { contenu: "AUTRE=1\nNOUVELLE=v\n", remplace: false });
  assert.deepEqual(ecrireDansEnv("", "A_B", "v"), { contenu: "A_B=v\n", remplace: false });
});

test("modèle : chaque {{coffre:VARIABLE}} est remplacé, les autres marques restent", () => {
  const r = remplacerModele("a={{coffre:K}}\nb={{coffre:K}}\nc={{coffre:AUTRE}}", "K", "v");
  assert.equal(r.n, 2);
  assert.equal(r.contenu, "a=v\nb=v\nc={{coffre:AUTRE}}");
});

test("demande d'un agent : lue des deux côtés, refusée sans variable lisible", () => {
  const d = lireDemandeSecret({ variable: "openai key", nom: "Clé OpenAI", genre: "jeton", raison: "Pour appeler l'API", service: "platform.openai.com" });
  assert.deepEqual(d, { variable: "OPENAI_KEY", nom: "Clé OpenAI", genre: "jeton", service: "platform.openai.com", raison: "Pour appeler l'API", ouTrouver: "" });
  assert.equal(lireDemandeSecret({ variable: "??" }), null);
  assert.equal(lireDemandeSecret({ variable: "KEY", genre: "inconnu" })?.genre, "cle-api");
  // La réponse écrite à l'agent ne contient que le nom.
  assert.match(messageReponseCoffre("rangee", { nom: "Clé OpenAI", variable: "OPENAI_KEY" }), /OPENAI_KEY/);
});
