import { describe, expect, it } from "vitest";
import { avecEpingle, basculerEpingle, estEpinglee, trierConversations } from "./epinglage";
import type { Chat } from "@/types/domain";

const date = (jour: number) => `2026-10-${String(jour).padStart(2, "0")}T09:00:00.000Z`;
const chat = (id: string, jour: number, patch: Partial<Chat> = {}): Chat => ({
  id, kind: "equipe", projectId: "atelier", title: id, roleIds: ["principal"], updatedAt: date(jour),
  sessions: { principal: "session-temoin" }, luJusqua: date(1), ...patch,
});
const ids = (chats: Chat[]) => chats.map((c) => c.id);

describe("épingle locale des conversations", () => {
  it("reconnaît une date valide et ignore les préférences absentes ou abîmées", () => {
    expect(estEpinglee(chat("a", 1, { epingleLe: date(3) }))).toBe(true);
    for (const valeur of [undefined, "", "abc", null, 1793379600000, {}]) {
      expect(estEpinglee(chat("a", 1, { epingleLe: valeur as string }))).toBe(false);
    }
  });
  it("classe les dernières épingles avant les conversations les plus actives sans muter", () => {
    const source = [chat("a", 30), chat("b", 29, { epingleLe: date(21) }), chat("c", 28), chat("d", 27, { epingleLe: date(20) })];
    const avant = structuredClone(source);
    expect(ids(trierConversations(source))).toEqual(["b", "d", "a", "c"]);
    expect(source).toEqual(avant);
    expect(trierConversations(source)[0]).toBe(source[1]);
    expect(trierConversations(source)).not.toBe(source);
  });
  it("compare l'instant de pose, même si les dates portent des fuseaux différents", () => {
    expect(ids(trierConversations([
      chat("a", 1, { epingleLe: "2026-10-30T09:00:00+02:00" }),
      chat("b", 1, { epingleLe: "2026-10-30T08:00:00Z" }),
    ]))).toEqual(["b", "a"]);
  });
  it("garde les égalités stables, l'activité départage seulement une même date de pose", () => {
    const source = [chat("a", 1), chat("b", 1), chat("c", 1, { epingleLe: date(8) }), chat("d", 2, { epingleLe: date(8) }), chat("e", 2, { epingleLe: date(8) })];
    expect(ids(trierConversations(source))).toEqual(["d", "e", "c", "a", "b"]);
  });
  it("les nouveaux messages ne changent pas la priorité des épingles", () => {
    const source = [chat("a", 30), chat("b", 1, { epingleLe: date(22) }), chat("c", 2, { epingleLe: date(21) })];
    expect(ids(trierConversations(source.map((c) => ({ ...c, updatedAt: date(31) }))))).toEqual(["b", "c", "a"]);
    expect(ids(trierConversations(source).slice(0, 1))).toEqual(["b"]);
  });
  it("une préférence abîmée reste au classement par activité", () => {
    expect(ids(trierConversations([chat("a", 2, { epingleLe: "abc" }), chat("b", 3), chat("c", 1, { epingleLe: date(5) })]))).toEqual(["c", "b", "a"]);
  });
  it("ne recrée pas un id absent et n'épingle ni une directe ni un fil", () => {
    const source = [chat("a", 1), chat("dm-principal", 1, { kind: "direct" }), chat("fil", 1, { fil: { roleId: "principal", statut: "archive", creeLe: date(1), lancePar: null } })];
    for (const id of ["absent", "dm-principal", "fil"]) expect(basculerEpingle(source, id, true, date(3))).toBe(source);
  });
  it("préserve tous les champs et les autres références, puis retire réellement la clé", () => {
    const source = [chat("a", 1, { modele: "opus", effort: "high", amorce: "contexte", taches: [] }), chat("b", 2)];
    const avant = structuredClone(source);
    const epinglee = basculerEpingle(source, "a", true, date(3));
    expect(epinglee).toEqual([{ ...source[0], epingleLe: date(3) }, source[1]]);
    expect(epinglee[1]).toBe(source[1]);
    expect(epinglee[0].sessions).toBe(source[0].sessions);
    const retiree = basculerEpingle(epinglee, "a", false, date(4));
    expect(retiree).toEqual(avant);
    expect(Object.hasOwn(retiree[0], "epingleLe")).toBe(false);
    expect(source).toEqual(avant);
  });
  it("les demandes répétées sont sans effet et gardent la référence", () => {
    const source = [chat("a", 1)];
    expect(basculerEpingle(source, "a", false, date(3))).toBe(source);
    const epinglee = basculerEpingle(source, "a", true, date(3));
    expect(basculerEpingle(epinglee, "a", true, date(4))).toBe(epinglee);
  });
  it("retirer puis ré-épingler remet en tête", () => {
    const source = [chat("a", 1, { epingleLe: date(3) }), chat("b", 2, { epingleLe: date(4) })];
    const resultat = basculerEpingle(basculerEpingle(source, "a", false, date(5)), "a", true, date(6));
    expect(ids(trierConversations(resultat))).toEqual(["a", "b"]);
  });
  it("répare la préférence invalide en épinglant", () => {
    expect(basculerEpingle([chat("a", 1, { epingleLe: "abc" })], "a", true, date(3))[0].epingleLe).toBe(date(3));
  });
  it("le patch préserve un message, renommage ou réglage arrivé entre-temps", () => {
    const courant = chat("a", 30, { title: "Titre reçu", sessions: { principal: "nouvelle-session" }, modele: "sonnet", luJusqua: date(29) });
    expect(avecEpingle(courant, true, date(4))).toEqual({ ...courant, epingleLe: date(4) });
  });
});
