import assert from "node:assert/strict";
import test from "node:test";
import { creerRelaisNavigateur, resultatValide } from "./navigateur.mjs";

const appelant = { agent: "hugo", conversation: "dm-hugo@vps.exemple.fr" };

test("un appel part au PC par le journal, et sa réponse revient à l'agent", async () => {
  const publies = [];
  const relais = creerRelaisNavigateur({ publier: (id, event) => publies.push({ id, event }), ecouteurs: () => 1, maintenant: () => 1000 });
  const promesse = relais.appeler(appelant, "navigateur_lire", { mode: "texte" });
  assert.equal(publies.length, 1);
  const { id, event } = publies[0];
  assert.equal(event.type, "navigateur");
  assert.equal(event.id, id);
  assert.deepEqual([event.nom, event.agent, event.conversation, event.arguments.mode], ["navigateur_lire", "hugo", appelant.conversation, "texte"]);
  assert.ok(event.expire > 1000);
  assert.equal(relais.repondre(id, { content: [{ type: "text", text: "Page : Accueil" }] }), true);
  assert.deepEqual(await promesse, { content: [{ type: "text", text: "Page : Accueil" }] });
  assert.equal(relais.repondre(id, { content: [{ type: "text", text: "deux fois" }] }), false, "une réponse arrive une fois");
});

test("sans app ouverte sur le PC : l'outil le dit tout de suite, rien ne part", async () => {
  const publies = [];
  const relais = creerRelaisNavigateur({ publier: (...a) => publies.push(a), ecouteurs: () => 0 });
  const r = await relais.appeler(appelant, "navigateur_aller", { url: "klyra.fr" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /pas ouverte/);
  assert.equal(publies.length, 0);
});

test("pas de réponse : abandon au bout du délai", async () => {
  const relais = creerRelaisNavigateur({ publier: () => undefined, ecouteurs: () => 1, delaiMs: 30 });
  const r = await relais.appeler(appelant, "navigateur_capture", {});
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /pas répondu/);
  assert.equal(relais.enAttente(), 0);
});

test("outil inconnu ou conversation absente : refusés", async () => {
  const relais = creerRelaisNavigateur({ publier: () => assert.fail("rien ne doit partir"), ecouteurs: () => 1 });
  assert.equal((await relais.appeler(appelant, "Bash", {})).isError, true);
  assert.equal((await relais.appeler({ agent: "hugo", conversation: "" }, "navigateur_lire", {})).isError, true);
});

test("la réponse du PC est filtrée : texte et images seulement", () => {
  const r = resultatValide({ content: [{ type: "image", data: "AAAA", mimeType: "image/jpeg" }, { type: "resource", uri: "file:///etc/passwd" }, { type: "text", text: "ok" }], isError: false });
  assert.deepEqual(r.content.map((c) => c.type), ["image", "text"]);
  assert.equal(resultatValide({ content: [{ type: "image", data: "AAAA", mimeType: "image/svg+xml" }] }).isError, true);
  assert.equal(resultatValide(null).isError, true);
});
