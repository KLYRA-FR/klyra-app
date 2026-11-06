import { describe, expect, test } from "vitest";
import type { Chat, Message } from "@/types/domain";
import { refusSuppression, sansConversation } from "./suppression-conversation";

const chat = (id: string, patch: Partial<Chat> = {}): Chat => ({
  id,
  kind: "equipe",
  projectId: null,
  title: id,
  roleIds: ["principal"],
  updatedAt: "2026-11-06T10:00:00.000Z",
  sessions: {},
  luJusqua: null,
  ...patch,
});

const message = (id: string, chatId: string): Message =>
  ({ id, chatId, author: { kind: "user" }, parts: [], createdAt: "2026-11-06T10:00:00.000Z" }) as unknown as Message;

describe("refusSuppression", () => {
  test("une conversation d'équipe au repos se supprime", () => {
    expect(refusSuppression(chat("a"), false)).toBeNull();
  });

  test("refuse une conversation absente, directe, un fil, ou une conversation où un agent travaille", () => {
    expect(refusSuppression(undefined, false)).toMatch(/n’existe plus/);
    expect(refusSuppression(chat("dm-principal", { kind: "direct" }), false)).toMatch(/agent ne se supprime pas/);
    expect(
      refusSuppression(chat("klyra-fil-1", { kind: "direct", fil: { roleId: "dev", statut: "ouvert", creeLe: "", lancePar: null } as Chat["fil"] }), false),
    ).toMatch(/fil/);
    expect(refusSuppression(chat("a"), true)).toMatch(/arrête-le/);
  });
});

describe("sansConversation", () => {
  test("retire la conversation, ses messages et sa file, sans toucher aux autres", () => {
    const etat = {
      chats: [chat("a"), chat("b")],
      messages: [message("1", "a"), message("2", "b"), message("3", "a")],
      file: { a: [{}], b: [{}] } as Record<string, unknown[]>,
      autre: 42,
    };
    const apres = sansConversation(etat, "a");
    expect(apres.chats.map((c) => c.id)).toEqual(["b"]);
    expect(apres.messages.map((m) => m.id)).toEqual(["2"]);
    expect(Object.keys(apres.file)).toEqual(["b"]);
    expect(apres.autre).toBe(42);
    expect(etat.chats).toHaveLength(2);
  });
});
