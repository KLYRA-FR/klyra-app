import { describe, expect, test } from "vitest";
import { agentDeConversation, agentsAutomatisation, conversationsDuProjet, derniereConversation, sansAssistantImpose } from "@/lib/conversation-projet";
import type { Chat, Message } from "@/types/domain";

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
  test("une routine ou un workflow plus récents ne prennent pas la place de la conversation de la personne", () => {
    const avecRoutine = [...liste, chat({ id: "routine-r1", updatedAt: "2026-11-09T10:00:00.000Z" }), chat({ id: "wf-w1", updatedAt: "2026-11-09T11:00:00.000Z" })];
    expect(derniereConversation(avecRoutine, "p")).toBe("b");
    expect(derniereConversation([chat({ id: "routine-r1" })], "p")).toBe("routine-r1");
  });
  test("un projet sans conversation : rien à rouvrir", () => {
    expect(derniereConversation(liste, "vide")).toBeNull();
  });
});

describe("conversations de routine et de workflow", () => {
  test("l'agent qui travaille en tête, sans l'assistant imposé ; une conversation existante garde son agent", () => {
    expect(agentsAutomatisation("veille", ["veille", "redac"])).toEqual(["veille", "redac"]);
    expect(agentsAutomatisation("redac", ["redac"], ["veille"])).toEqual(["veille", "redac"]);
    expect(agentsAutomatisation("veille", [])).toEqual(["veille"]);
  });

  const reponse = (chatId: string, roleId: string): Pick<Message, "chatId" | "author"> => ({ chatId, author: { kind: "role", roleId } });
  test("les anciennes, où l'assistant n'a jamais répondu, prennent pour agent le premier qui y a répondu", () => {
    const [r] = sansAssistantImpose([chat({ id: "routine-r1", projectId: null, roleIds: ["principal", "veille", "redac"] })], [
      { chatId: "routine-r1", author: { kind: "user" } },
      reponse("routine-r1", "redac"),
      reponse("routine-r1", "veille"),
    ]);
    expect(r.roleIds).toEqual(["redac", "veille"]);
    const [w] = sansAssistantImpose([chat({ id: "wf-w1", roleIds: ["principal", "dev"] })], []);
    expect(w.roleIds).toEqual(["dev"]);
  });
  test("l'assistant reste en tête s'il y a répondu ; les conversations de la personne ne bougent pas", () => {
    const liste = [chat({ id: "routine-r1", roleIds: ["principal", "veille"] }), chat({ id: "c1", roleIds: ["principal", "dev"] }), chat({ id: "routine-r2", roleIds: ["principal"] })];
    const apres = sansAssistantImpose(liste, [reponse("routine-r1", "principal"), reponse("c1", "dev")]);
    expect(apres.map((c) => c.roleIds)).toEqual([["principal", "veille"], ["principal", "dev"], ["principal"]]);
    expect(apres[1]).toBe(liste[1]);
  });
});
