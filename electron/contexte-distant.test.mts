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

test("un fil tenu par le serveur arrive avec son ticket, vérifié champ par champ", () => {
  const fil = { roleId: "hugo", statut: "ouvert", creeLe: "2026-11-06T09:00:00.000Z", lancePar: { roleId: "camille", chatId: "dm-camille" }, retourAttendu: true, etape: "en-cours", raison: null, priorite: 2, echeance: "2026-11-07", projetId: null, inconnu: "x" };
  const lu = contexteDe(VPS, { chatId: "klyra-fil-ab12cd34", agentId: "hugo", titre: "Qonto", fil } as never);
  assert.deepEqual(lu, { chatId: "klyra-fil-ab12cd34", agentId: "hugo", titre: "Qonto", lieu: VPS, fil: { roleId: "hugo", statut: "ouvert", creeLe: fil.creeLe, lancePar: fil.lancePar, retourAttendu: true, etape: "en-cours", raison: null, priorite: 2, echeance: "2026-11-07", projetId: null } });
  const abime = contexteDe(VPS, { chatId: "klyra-fil-ab12cd34", agentId: "hugo", titre: "Qonto", fil: { ...fil, lancePar: { roleId: "../x", chatId: "dm" }, etape: "fini", priorite: 9 } } as never);
  assert.deepEqual([abime?.fil?.lancePar, abime?.fil?.retourAttendu, abime?.fil?.etape, abime?.fil?.priorite], [null, undefined, "a-faire", 0]);
});

test("le retour d'un fil rapporté par le serveur porte son message, sinon rien", () => {
  const retour = { messageId: "m-1", roleId: "hugo", texte: "**Fil terminé : Qonto**", creeLe: "2026-11-06T09:10:00.000Z" };
  assert.deepEqual(contexteDe(VPS, { chatId: "dm-camille", agentId: "camille", titre: "Camille", retour } as never), { chatId: "dm-camille", agentId: "camille", titre: "Camille", lieu: VPS, retour });
  assert.equal(contexteDe(VPS, { chatId: "dm-camille", agentId: "camille", titre: "Camille", retour: { ...retour, roleId: "a b" } } as never), null);
});
