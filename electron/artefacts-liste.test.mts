import assert from "node:assert/strict";
import test from "node:test";
import { artefactsDuJson, fusionnerGalerie } from "./artefacts-liste.ts";

const UUID = "596c8de5-3c54-4c76-8df1-3ade3cceafbf";

test("réponses JSON : les objets d'artefact (uuid ou id court, titre), seulement pour une adresse d'artefacts", () => {
  const json = { data: [{ uuid: UUID, title: "  Design   system ", updated_at: "2026-11-01T10:00:00Z", owner: { uuid: "11111111-2222-4333-8444-555555555555", name: "Alice" } }, { id: "C3Tqnor89ed3qjk6n1Wben", name: "Propale" }, { id: "x", title: "trop court" }] };
  assert.deepEqual(artefactsDuJson("https://claude.ai/api/organizations/o/artifacts?limit=50", json), [
    { titre: "Design system", url: `https://claude.ai/code/artifact/${UUID}`, misAJour: "2026-11-01T10:00:00Z" },
    { titre: "Propale", url: "https://claude.ai/artifact/C3Tqnor89ed3qjk6n1Wben", misAJour: null },
  ]);
  assert.deepEqual(artefactsDuJson("https://claude.ai/api/organizations/o/chat_conversations", json), []);
});

test("les liens de la page font foi ; le JSON complète les titres et les dates", () => {
  const liens = [
    { url: `https://claude.ai/code/artifact/${UUID}?x=1`, titre: "Ouvrir" },
    { url: `https://claude.ai/code/artifact/${UUID}`, titre: "doublon" },
    { url: "https://claude.ai/artifact/abc123/", titre: " Ma page " },
    { url: "https://claude.ai/settings", titre: "Réglages" },
  ];
  const json = [{ titre: "Design system", url: `https://claude.ai/code/artifact/${UUID}`, misAJour: "2026-11-01T10:00:00Z" }];
  assert.deepEqual(fusionnerGalerie(liens, json), [
    { url: `https://claude.ai/code/artifact/${UUID}`, titre: "Design system", misAJour: "2026-11-01T10:00:00Z" },
    { url: "https://claude.ai/artifact/abc123", titre: "Ma page", misAJour: null },
  ]);
});

test("sans lien lisible sur la page, les réponses JSON suffisent ; rien du tout : liste vide", () => {
  const json = [{ titre: "Propale", url: "https://claude.ai/artifact/C3Tqnor89ed3qjk6n1Wben", misAJour: null }];
  assert.deepEqual(fusionnerGalerie([], json), json);
  assert.deepEqual(fusionnerGalerie([], []), []);
});
