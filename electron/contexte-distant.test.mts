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

test("sans message du téléphone, une conversation ordinaire n'est pas reprise", () => {
  assert.equal(contexteDe(VPS, { chatId: "dm-hugo", agentId: "hugo", titre: "Hugo" }), null);
  assert.equal(contexteDe(VPS, { chatId: "../x", agentId: "hugo", titre: "x", telephone: { messageId: "m", texte: "a", creeLe: "2026-11-02T10:00:00Z" } }), null);
  assert.equal(contexteDe(VPS, { chatId: "dm-hugo", agentId: "hugo", titre: "x", telephone: { messageId: "m", texte: "a", creeLe: "hier" } }), null);
  assert.equal(contexteDe(VPS, undefined), null);
});
