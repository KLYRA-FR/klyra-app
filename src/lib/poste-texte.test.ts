import { describe, expect, test } from "vitest";
import { bandeauComposeur, libellePastille, texteFeuille } from "./poste-texte";

const mac = { systeme: "mac" as const, nom: "Mac de Corentin", ouvert: true, dernierSignal: Date.parse("2026-11-01T18:42:00") };

describe("textes du poste", () => {
  test("la pastille dit Mac ou PC, pas le téléphone", () => {
    expect(libellePastille(mac)).toBe("Mac ouvert");
    expect(libellePastille({ ...mac, ouvert: false })).toBe("Mac fermé");
    expect(libellePastille({ ...mac, systeme: "windows", ouvert: false })).toBe("PC fermé");
    expect(libellePastille(null)).toBe("Aucun ordinateur relié");
  });

  test("la feuille reprend P-3", () => {
    expect(texteFeuille(mac)).toBe("KLYRA est ouverte sur ton Mac.");
    expect(texteFeuille({ ...mac, ouvert: false })).toContain("KLYRA est fermée sur ton Mac depuis 18:42.");
    expect(texteFeuille({ ...mac, systeme: "windows", ouvert: true })).toBe("KLYRA est ouverte sur ton PC.");
  });

  test("le bandeau du composeur n'existe que poste fermé", () => {
    expect(bandeauComposeur(mac)).toBeNull();
    expect(bandeauComposeur({ ...mac, ouvert: false })).toBe("Ton Mac est fermé : ton message partira à son ouverture.");
  });
});
