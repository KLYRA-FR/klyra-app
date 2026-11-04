import assert from "node:assert/strict";
import test from "node:test";
import { creerRelaisWorkflows, OUTILS_WORKFLOWS, resultatValide } from "./workflows.mjs";

const appelant = { agent: "iris", conversation: "dm-iris@vps.exemple.fr" };

test("les outils sont ceux du PC", () => {
  assert.deepEqual(OUTILS_WORKFLOWS.map((o) => o.name), ["lister_workflows", "lire_workflow", "construire_workflow", "lancer_workflow"]);
});

test("un appel part au PC par le journal, et sa réponse revient à l'agent", async () => {
  const publies = [];
  const relais = creerRelaisWorkflows({ publier: (id, event) => publies.push({ id, event }), ecouteurs: () => 1, maintenant: () => 1000 });
  const promesse = relais.appeler(appelant, "construire_workflow", { titre: "Page", etapes: [{ id: "depart", type: "declencheur" }] });
  assert.equal(publies.length, 1);
  const { id, event } = publies[0];
  assert.equal(event.type, "workflow");
  assert.equal(event.id, id);
  assert.deepEqual([event.nom, event.agent, event.conversation, event.arguments.titre], ["construire_workflow", "iris", appelant.conversation, "Page"]);
  assert.ok(event.expire > 1000);
  assert.equal(relais.repondre(id, { content: [{ type: "text", text: "Workflow créé" }] }), true);
  assert.deepEqual(await promesse, { content: [{ type: "text", text: "Workflow créé" }] });
  assert.equal(relais.repondre(id, { content: [{ type: "text", text: "deux fois" }] }), false, "une réponse arrive une fois");
});

test("sans app ouverte sur le PC, outil inconnu, sans conversation : refusés sans rien publier", async () => {
  const relais = creerRelaisWorkflows({ publier: () => assert.fail("rien ne doit partir"), ecouteurs: () => 0 });
  const r = await relais.appeler(appelant, "lister_workflows", {});
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /pas ouverte/);
  const ouvert = creerRelaisWorkflows({ publier: () => assert.fail("rien ne doit partir"), ecouteurs: () => 1 });
  assert.equal((await ouvert.appeler(appelant, "Bash", {})).isError, true);
  assert.equal((await ouvert.appeler({ agent: "iris", conversation: "" }, "lire_workflow", {})).isError, true);
});

test("pas de réponse : abandon au bout du délai ; la réponse du PC est filtrée", async () => {
  const relais = creerRelaisWorkflows({ publier: () => undefined, ecouteurs: () => 1, delaiMs: 30 });
  const r = await relais.appeler(appelant, "lancer_workflow", { workflow: "w" });
  assert.match(r.content[0].text, /pas répondu/);
  assert.equal(relais.enAttente(), 0);
  assert.deepEqual(resultatValide({ content: [{ type: "image", data: "AAAA", mimeType: "image/png" }, { type: "text", text: "ok" }] }).content, [{ type: "text", text: "ok" }]);
  assert.equal(resultatValide(null).isError, true);
});
