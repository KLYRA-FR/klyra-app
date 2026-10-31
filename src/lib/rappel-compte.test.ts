import { describe, expect, it } from "vitest";
import type { Tache } from "@/types/domain";
import { echeanceLocale, versImport } from "./rappel-compte";

const tache = (partiel: Partial<Tache> = {}): Tache => ({
  id: "rappel-local-1",
  titre: "  Appeler   le client  ",
  notes: "note",
  liste: "clients",
  date: "2026-10-31",
  heure: "09:30",
  fin: null,
  priorite: 2,
  signalee: false,
  faite: false,
  faiteLe: null,
  projectId: null,
  creeLe: "2026-10-29T12:00:00.000Z",
  notifiee: false,
  ...partiel,
});

describe("échéance locale d'un rappel", () => {
  it("prend l'heure choisie, ou le début du lendemain pour un jour entier", () => {
    expect(echeanceLocale(null, "09:30", null)).toBeNull();
    expect(echeanceLocale("2026-10-31", "09:30", null)).toBe(new Date("2026-10-31T09:30").getTime());
    const jour = new Date(2026, 9, 31);
    jour.setDate(jour.getDate() + 1);
    expect(echeanceLocale("2026-10-31", null, null)).toBe(jour.getTime());
    const fin = new Date(2026, 10, 2);
    fin.setDate(fin.getDate() + 1);
    expect(echeanceLocale("2026-10-31", null, "2026-11-02")).toBe(fin.getTime());
  });

  it("prépare l'import sans doublon et ignore un titre vide", () => {
    const entree = versImport(tache());
    expect(entree).toMatchObject({
      titre: "Appeler le client",
      origineLocale: "rappel-local-1",
      liste: "clients",
      heure: "09:30",
      faite: false,
    });
    expect(versImport(tache({ titre: "   " }))).toBeNull();
    expect(versImport(tache({ id: "id avec espaces" }))).toBeNull();
    expect(versImport(tache({ liste: "catégorie", fin: "2026-10-01" }))).toMatchObject({ liste: null, fin: null });
  });
});
