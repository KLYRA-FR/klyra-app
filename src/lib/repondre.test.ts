// @vitest-environment node
import { describe, expect, test } from "vitest";
import { citationDe } from "./repondre";
import type { Message } from "@/types/domain";

const message = (author: Message["author"], text: string): Message => ({
  id: "m1",
  chatId: "dm-principal",
  author,
  createdAt: "2026-11-03T21:00:00.000Z",
  parts: [{ type: "text", text }],
});

describe("Répondre à une réponse d'agent", () => {
  test("garde l'auteur et un extrait sans Markdown", () => {
    const m = message({ kind: "role", roleId: "principal" }, "Mon conseil : **un agent = un rôle précis**.\n\n1. Sa mission");
    expect(citationDe(m, "Mon conseil : **un agent = un rôle précis**.\n\n1. Sa mission")).toEqual({
      messageId: "m1",
      roleId: "principal",
      extrait: "Mon conseil : un agent = un rôle précis. Sa mission",
    });
  });

  test("coupe un long message", () => {
    const long = "mot ".repeat(200);
    const c = citationDe(message({ kind: "role", roleId: "hugo" }, long), long);
    expect(c?.extrait.length).toBeLessThanOrEqual(280);
    expect(c?.extrait.endsWith("…")).toBe(true);
  });

  test("rien pour un message de la personne ou un message vide", () => {
    expect(citationDe(message({ kind: "user" }, "Salut"), "Salut")).toBeNull();
    expect(citationDe(message({ kind: "role", roleId: "hugo" }, ""), "")).toBeNull();
  });
});
