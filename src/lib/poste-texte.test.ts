import { describe, expect, test } from "vitest";
import { attenteEnvoi, bandeauComposeur, cheminTelephone, libellePastille, support, supportOuOrdinateur, texteDeconnecte, texteFeuille, texteRoutines } from "./poste-texte";

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

  test("support et textes du téléphone suivent le système du poste, jamais « ton Mac » par défaut", () => {
    const pc = { ...mac, systeme: "windows" as const, nom: "PC de Corentin" };
    const autre = { ...mac, systeme: "autre" as const, nom: "Atelier" };
    expect([support(mac), support(pc), support(autre)]).toEqual(["ton Mac", "ton PC", "Atelier"]);
    expect(supportOuOrdinateur(null)).toBe("ton ordinateur");
    expect(cheminTelephone(pc)).toBe("Passe par ton compte, puis par ton PC.");
    expect(cheminTelephone(mac)).toBe("Passe par ton compte, puis par ton Mac.");
    expect(cheminTelephone(autre)).toBe("Passe par ton compte, puis par Atelier.");
    expect(cheminTelephone(null)).toBe("Passe par ton compte, puis par ton ordinateur.");
    expect(texteRoutines(pc)).toBe("Les routines se gèrent sur ton PC. Celles d’un VPS y tournent même ton PC fermé.");
    expect(texteRoutines(null)).not.toMatch(/Mac/);
    expect(texteDeconnecte(pc)).toBe("Ce téléphone a été déconnecté depuis ton PC. Reconnecte-toi pour retrouver tes conversations.");
    expect(texteDeconnecte(autre)).toContain("depuis Atelier.");
    expect(attenteEnvoi(null)).toBe("En attente de ton ordinateur");
    expect(attenteEnvoi({ ...pc, ouvert: false })).toBe("En attente de ton PC");
    expect(bandeauComposeur({ ...pc, ouvert: false })).toBe("Ton PC est fermé : ton message partira à son ouverture.");
  });

  test("le bandeau du composeur n'existe que poste fermé", () => {
    expect(bandeauComposeur(mac)).toBeNull();
    expect(bandeauComposeur({ ...mac, ouvert: false })).toBe("Ton Mac est fermé : ton message partira à son ouverture.");
  });
});
