import { describe, expect, test } from "vitest";
import { bonjour, dateDuJour, journeeDuJour, texteAFaire } from "./journee";

describe("Ta journée (lot 2, E2-01)", () => {
  const aujourdhui = "2026-11-04";
  const evenement = (cle: string, jour: string, debut: string | null) => ({ cle, titre: cle, jour, debut, href: `/planning#${cle}` });
  const rappel = (id: string, jour: string | null, heure: string | null, faite = false) => ({ id, titre: id, jour, fin: null, heure, faite, priorite: 0, href: `/planning#${id}` });

  test("rendez-vous et rappels à heure d'aujourd'hui dans l'ordre des heures ; les rappels à faire comptent le retard", () => {
    const j = journeeDuJour({
      aujourdhui,
      evenements: [evenement("Point client", aujourdhui, "10:00"), evenement("Démo demain", "2026-11-05", "14:00"), evenement("Atelier", aujourdhui, null)],
      rappels: [rappel("Rappeler", aujourdhui, "16:30"), rappel("Facture en retard", "2026-11-03", null), rappel("Déjà fait", aujourdhui, "09:00", true), rappel("Demain", "2026-11-05", "08:00")],
    });
    expect(j.lignes.map((l) => `${l.heure ?? "—"} ${l.titre}`)).toEqual(["— Atelier", "10:00 Point client", "16:30 Rappeler"]);
    expect(j.lignes[2].href).toBe("/planning#Rappeler");
    expect(j.autres).toBe(0);
    expect(j.aFaire).toBe(2);
  });

  test("trois lignes au plus, les autres comptées", () => {
    const j = journeeDuJour({ aujourdhui, evenements: ["08:00", "09:00", "10:00", "11:00", "12:00"].map((h) => evenement(h, aujourdhui, h)), rappels: [] });
    expect(j.lignes).toHaveLength(3);
    expect(j.autres).toBe(2);
    expect(j.aFaire).toBe(0);
  });

  test("textes", () => {
    expect(texteAFaire(0)).toBeNull();
    expect(texteAFaire(1)).toBe("Un rappel à faire aujourd’hui");
    expect(texteAFaire(2)).toBe("2 rappels à faire aujourd’hui");
    expect(bonjour("Camille Essai")).toBe("Bonjour Camille");
    expect(bonjour("")).toBe("Bonjour");
    expect(dateDuJour(new Date(2026, 10, 4))).toBe("Mercredi 4 novembre");
  });
});
