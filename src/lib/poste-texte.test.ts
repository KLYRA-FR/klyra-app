import { describe, expect, test } from "vitest";
import {
  attenteEnvoi,
  bandeauComposeur,
  cheminTelephone,
  libellePastille,
  support,
  supportOuOrdinateur,
  texteDeconnecte,
  texteErreurPoste,
  texteFeuille,
  texteRoutines,
} from "./poste-texte";

const mac = { systeme: "mac" as const, nom: "Mac de Corentin", ouvert: true, dernierSignal: Date.parse("2026-11-01T18:42:00") };

describe("textes du poste", () => {
  test("la pastille dit Mac ou PC, jamais le nom d'une machine seule (C-2g)", () => {
    expect(libellePastille(mac)).toBe("Mac");
    expect(libellePastille({ ...mac, ouvert: false })).toBe("Mac fermé");
    expect(libellePastille({ ...mac, systeme: "windows", ouvert: false })).toBe("PC fermé");
    expect(libellePastille({ ...mac, systeme: "autre", nom: "openbot" })).toBe("Ordinateur");
    expect(libellePastille({ ...mac, systeme: "autre", nom: "openbot", ouvert: false })).toBe("Ordinateur fermé");
    expect(libellePastille({ ...mac, ouvert: false }, true)).toBe("Mac de Corentin fermé");
    expect(libellePastille(null)).toBe("Aucun ordinateur");
  });

  test("une erreur dit ce qui n'a pas marché, jamais « le geste a échoué » (C-1f)", () => {
    expect(texteErreurPoste({ code: "delai", message: "" }, "ton Mac")).toBe("Ton Mac ne répond pas.");
    expect(texteErreurPoste({ code: "introuvable", message: "Ce dossier n’existe plus sur ton Mac." }, "ton Mac")).toBe("Ce dossier n’existe plus sur ton Mac.");
    expect(texteErreurPoste({ code: "erreur", message: " " }, "ton PC")).toBe("Ton PC n’a pas pu le faire : erreur inattendue.");
    expect(texteErreurPoste({ code: "compte", message: "" }, "ton PC")).toBe("Ton compte n’a pas répondu. Réessaie.");
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
    expect([supportOuOrdinateur(mac), supportOuOrdinateur(pc), supportOuOrdinateur(autre)]).toEqual(["ton Mac", "ton PC", "ton ordinateur"]);
    expect(supportOuOrdinateur(mac, true)).toBe("Mac de Corentin");
    expect(supportOuOrdinateur(null)).toBe("ton ordinateur");
    expect(cheminTelephone(pc)).toBe("Passe par ton compte, puis par ton PC.");
    expect(cheminTelephone(mac)).toBe("Passe par ton compte, puis par ton Mac.");
    expect(cheminTelephone(autre)).toBe("Passe par ton compte, puis par ton ordinateur.");
    expect(cheminTelephone(null)).toBe("Passe par ton compte, puis par ton ordinateur.");
    expect(texteRoutines()).toBe("Les routines et les workflows de tes agents");
    expect(texteRoutines({ nom: "Studio-VPS", sur: "ton PC" })).toBe("Les routines de Studio-VPS tournent même ton PC fermé");
    expect(texteDeconnecte(pc)).toBe("Ce téléphone a été déconnecté depuis ton PC. Reconnecte-toi pour retrouver tes conversations.");
    expect(texteDeconnecte(autre)).toContain("depuis ton ordinateur.");
    expect(attenteEnvoi(null)).toBe("En attente de ton ordinateur");
    expect(attenteEnvoi({ ...pc, ouvert: false })).toBe("En attente de ton PC");
    expect(bandeauComposeur({ ...pc, ouvert: false })).toBe("Ton PC est fermé : ton message partira à son ouverture.");
  });

  test("le bandeau du composeur n'existe que poste fermé", () => {
    expect(bandeauComposeur(mac)).toBeNull();
    expect(bandeauComposeur({ ...mac, ouvert: false })).toBe("Ton Mac est fermé : ton message partira à son ouverture.");
  });
});
