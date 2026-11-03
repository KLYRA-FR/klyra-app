import assert from "node:assert/strict";
import { test } from "node:test";
import { appliquerRemise, totalCentimes } from "../src/panier.js";

test("total d'un panier", () => {
  assert.equal(totalCentimes([{ libelle: "Café", prixCentimes: 250, quantite: 2 }, { libelle: "Croissant", prixCentimes: 120, quantite: 1 }]), 620);
});

test("remise", () => {
  assert.equal(appliquerRemise(1000, 15), 850);
  assert.throws(() => appliquerRemise(1000, 120), RangeError);
});
