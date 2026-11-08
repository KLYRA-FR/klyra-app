import { describe, expect, test } from "vitest";
import { agentDeConversation, conversationsDuProjet, derniereConversation } from "@/lib/conversation-projet";
import type { Chat } from "@/types/domain";

const chat = (p: Partial<Chat>): Chat => ({ id: "c", kind: "equipe", projectId: "p", title: "", roleIds: ["principal"], updatedAt: "2026-11-01T00:00:00.000Z", sessions: {}, luJusqua: null, ...p });

describe("agentDeConversation", () => {
  test("l'agent avec qui la conversation a commencé, même quand d'autres l'ont rejointe", () => {
    expect(agentDeConversation(chat({ roleIds: ["dev", "principal"] }))).toBe("dev");
    expect(agentDeConversation(chat({ roleIds: ["dev"] }))).toBe("dev");
  });
  test("les anciennes conversations d'équipe gardent l'assistant, qu'elles avaient en tête", () => {
    expect(agentDeConversation(chat({ roleIds: ["principal", "designer", "qa"] }))).toBe("principal");
    expect(agentDeConversation(chat({ roleIds: [] }))).toBe("principal");
  });
});

describe("conversations d'un projet", () => {
  const liste = [
    chat({ id: "a", updatedAt: "2026-11-02T00:00:00.000Z" }),
    chat({ id: "b", updatedAt: "2026-11-05T00:00:00.000Z" }),
    chat({ id: "autre", projectId: "q", updatedAt: "2026-11-09T00:00:00.000Z" }),
    chat({ id: "dm-principal", kind: "direct", projectId: "p", updatedAt: "2026-11-09T00:00:00.000Z" }),
  ];
  test("seulement les siennes, la plus récente d'abord", () => {
    expect(conversationsDuProjet(liste, "p").map((c) => c.id)).toEqual(["b", "a"]);
    expect(derniereConversation(liste, "p")).toBe("b");
  });
  test("un projet sans conversation : rien à rouvrir", () => {
    expect(derniereConversation(liste, "vide")).toBeNull();
  });
});
