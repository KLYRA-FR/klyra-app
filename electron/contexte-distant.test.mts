import assert from "node:assert/strict";
import test from "node:test";
import { contexteDe } from "./contexte-distant.ts";

const VPS = "https://vps.exemple.test";

test("une réponse de routine s'ouvre dans sa conversation", () => {
  assert.deepEqual(contexteDe(VPS, { chatId: "routine-r1", agentId: "lea", titre: "Point" }), { chatId: "routine-r1", agentId: "lea", titre: "Point", lieu: VPS });
});

test("un message du téléphone garde sa conversation et son texte", () => {
  const telephone = { messageId: "tel-1", texte: "Relance le build", creeLe: "2026-11-02T10:00:00.000Z" };
  assert.deepEqual(contexteDe(VPS, { chatId: "dm-hugo", agentId: "hugo", titre: "Hugo", telephone }), { chatId: "dm-hugo", agentId: "hugo", titre: "Hugo", lieu: VPS, telephone });
});

test("le choix du fournisseur traverse le relais du PC, sans être appliqué à un autre fil", () => {
  const telephone = { messageId: "tel-2", texte: "Salut", creeLe: "2026-11-05T10:00:00.000Z" };
  const choix = { fournisseur: "codex", modele: "modele-test", effort: "ultra" };
  const lu = contexteDe(VPS, { chatId: "dm-cicco", agentId: "cicco", titre: "Cicco", telephone, choix });
  assert.deepEqual(lu?.choix, choix);
  assert.equal(lu?.chatId, "dm-cicco");
  assert.equal(contexteDe(VPS, { chatId: "dm-cicco", agentId: "cicco", telephone, choix: { ...choix, fournisseur: "inconnu" } })?.choix, undefined);
});

test("sans message du téléphone, une conversation ordinaire n'est pas reprise", () => {
  assert.equal(contexteDe(VPS, { chatId: "dm-hugo", agentId: "hugo", titre: "Hugo" }), null);
  assert.equal(contexteDe(VPS, { chatId: "../x", agentId: "hugo", titre: "x", telephone: { messageId: "m", texte: "a", creeLe: "2026-11-02T10:00:00Z" } }), null);
  assert.equal(contexteDe(VPS, { chatId: "dm-hugo", agentId: "hugo", titre: "x", telephone: { messageId: "m", texte: "a", creeLe: "hier" } }), null);
  assert.equal(contexteDe(VPS, undefined), null);
});
