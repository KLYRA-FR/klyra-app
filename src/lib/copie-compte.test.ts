import { describe, expect, test } from "vitest";
import { messageCompte, partiesReduites } from "./copie-compte";
import type { Message } from "@/types/domain";

describe("copie des conversations", () => {
  test("les chemins et les sessions ne partent pas", () => {
    const message: Message = {
      id: "m1",
      chatId: "dm-hugo",
      author: { kind: "role", roleId: "hugo" },
      createdAt: "2026-11-01T10:00:00.000Z",
      parts: [
        { type: "text", text: "Bonjour" },
        { type: "fichiers", chemins: ["/home/secret/cle.env"] },
        { type: "etapes", etapes: [{ id: "e", outil: "Lire", libelle: "Lit /home/secret", statut: "fait", parent: null, chemin: "/home/secret" }] },
      ],
    };
    const copie = messageCompte(message);
    expect(copie.texte).toBe("Bonjour");
    expect(copie.parties).not.toContain("/home/secret");
    expect(copie.parties).not.toContain("cle.env");
    expect(JSON.parse(partiesReduites(message.parts))).toEqual([
      { type: "text", text: "Bonjour" },
      { type: "fichiers" },
      { type: "etapes", n: 1 },
    ]);
  });
});
