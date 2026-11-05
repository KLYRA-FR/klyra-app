import { beforeEach, describe, expect, test } from "vitest";
import { citationDuMessage, garderCitation, lireCitation } from "./citation";

const message = { origine: "m1", auteurId: "hugo", texte: "**Voici** le résultat" };

describe("la citation du brouillon (E2-40)", () => {
  beforeEach(() => {
    const donnees = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: (k: string) => donnees.get(k) ?? null, setItem: (k: string, v: string) => donnees.set(k, v) },
    });
  });

  test("le début du texte sans Markdown ; rien pour un message de la personne", () => {
    expect(citationDuMessage(message)).toEqual({ messageId: "m1", roleId: "hugo", extrait: "Voici le résultat" });
    expect(citationDuMessage({ ...message, auteurId: null })).toBeNull();
    expect(citationDuMessage({ ...message, texte: "   " })).toBeNull();
    expect(citationDuMessage({ ...message, texte: "a".repeat(600) })?.extrait.length).toBeLessThanOrEqual(280);
  });

  test("gardée par conversation ; la retirer ne touche pas aux autres", () => {
    const c = citationDuMessage(message)!;
    garderCitation("dm-hugo", c);
    garderCitation("dm-iris", { ...c, roleId: "iris" });
    expect(lireCitation("dm-hugo")).toEqual(c);
    garderCitation("dm-hugo", null);
    expect(lireCitation("dm-hugo")).toBeNull();
    expect(lireCitation("dm-iris")?.roleId).toBe("iris");
  });
});
