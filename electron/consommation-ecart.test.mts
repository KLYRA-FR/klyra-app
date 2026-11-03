import assert from "node:assert/strict";
import test from "node:test";
import { ecartModelUsage, ligneValide } from "./consommation-ecart.ts";

const usage = (entree: number, sortie: number, cout: number) => ({ "claude-opus-5-5": { inputTokens: entree, outputTokens: sortie, cacheReadInputTokens: 2 * entree, cacheCreationInputTokens: 0, costUSD: cout } });

test("l'écart du modelUsage cumulé, tour après tour", () => {
  const t1 = ecartModelUsage(usage(10, 5, 0.01), {});
  assert.deepEqual(t1.lignes, [{ modele: "claude-opus-5-5", jetons: { entree: 10, sortie: 5, cacheLu: 20, cacheEcrit: 0 }, coutUsd: 0.01 }]);
  const t2 = ecartModelUsage(usage(25, 9, 0.03), t1.cumul);
  assert.equal(t2.lignes[0].jetons.entree, 15);
  assert.equal(t2.lignes[0].jetons.sortie, 4);
  assert.ok(Math.abs((t2.lignes[0].coutUsd ?? 0) - 0.02) < 1e-9);
  // Rien de neuf : aucune ligne.
  assert.deepEqual(ecartModelUsage(usage(25, 9, 0.03), t2.cumul).lignes, []);
});

test("un compteur qui recule est un nouveau processus : on repart de zéro", () => {
  const avant = ecartModelUsage(usage(100, 50, 1), {}).cumul;
  assert.equal(ecartModelUsage(usage(10, 5, 0.1), avant).lignes[0].jetons.entree, 10);
  assert.deepEqual(ecartModelUsage(null, avant), { cumul: avant, lignes: [] });
});

test("une ligne reçue d'un VPS est vérifiée champ par champ", () => {
  assert.deepEqual(ligneValide({ modele: "claude-opus-5-5", jetons: { entree: 3, sortie: "x", cacheLu: -1, cacheEcrit: 2 }, coutUsd: 0.5 }), {
    modele: "claude-opus-5-5",
    jetons: { entree: 3, sortie: 0, cacheLu: 0, cacheEcrit: 2 },
    coutUsd: 0.5,
  });
  assert.equal(ligneValide({ modele: "", jetons: { entree: 3 } }), null);
  assert.equal(ligneValide({ modele: "m", jetons: { entree: 0 } }), null);
  assert.equal(ligneValide("x"), null);
});
