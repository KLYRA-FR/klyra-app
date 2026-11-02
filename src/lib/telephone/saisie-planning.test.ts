import { describe, expect, test } from "vitest";
import { ErreurPoste } from "@/lib/poste/types";
import type { Categorie, Evenement, Tache } from "@/types/domain";
import { categorieSaisie, evenementModifie, lireFenetre, lireReport, rappelModifie } from "./saisie-planning";

const CATEGORIES: Categorie[] = [
  { id: "perso", nom: "Perso", teinte: "violet", icone: "home-01" },
  { id: "clients", nom: "Clients", teinte: "bleu-k2", icone: "users-profiles-01" },
];

const tache = (patch: Partial<Tache> = {}): Tache => ({
  id: "t1",
  titre: "Appeler l’école",
  notes: "",
  liste: "perso",
  date: "2026-11-02",
  heure: "10:00",
  fin: null,
  priorite: 1,
  signalee: true,
  faite: false,
  faiteLe: null,
  projectId: "p1",
  creeLe: "2026-10-20T08:00:00.000Z",
  notifiee: true,
  ...patch,
});

const saisieRappel = (patch: Record<string, unknown> = {}) => ({
  id: "t1",
  titre: "  Appeler   l’école  ",
  notes: " Avant midi ",
  liste: "clients",
  jour: "2026-11-02",
  heure: "10:00",
  fin: null,
  priorite: 2,
  faite: false,
  ...patch,
});

const evenement = (patch: Partial<Evenement> = {}): Evenement => ({
  id: "e1",
  titre: "Démo client",
  date: "2026-11-04",
  debut: "14:00",
  fin: "15:00",
  notes: "",
  projectId: null,
  notifie: true,
  ...patch,
});

const code = (geste: () => unknown): string | null => {
  try {
    geste();
    return null;
  } catch (err) {
    return err instanceof ErreurPoste ? err.code : "autre";
  }
};

describe("arguments venus du téléphone", () => {
  test("une fenêtre de départs : deux instants, la fin après, au plus deux mois", () => {
    expect(lireFenetre({ debut: "2026-11-01T23:00:00.000Z", fin: "2026-11-08T23:00:00.000Z" })).toEqual({
      debut: "2026-11-01T23:00:00.000Z",
      fin: "2026-11-08T23:00:00.000Z",
    });
    expect(code(() => lireFenetre({ debut: "2026-11-08T00:00:00Z", fin: "2026-11-01T00:00:00Z" }))).toBe("arguments");
    expect(code(() => lireFenetre({ debut: "2026-01-01T00:00:00Z", fin: "2026-06-01T00:00:00Z" }))).toBe("arguments");
    expect(code(() => lireFenetre({ debut: "hier", fin: "demain" }))).toBe("arguments");
    expect(code(() => lireFenetre({ debut: 1, fin: 2 }))).toBe("arguments");
  });

  test("un report : seulement les trois du bureau", () => {
    expect(lireReport({ report: "lundi" })).toBe("lundi");
    expect(code(() => lireReport({ report: "jamais" }))).toBe("arguments");
  });
});

describe("un rappel de l'ordinateur modifié", () => {
  test("titre et notes nettoyés, même rappel (id, création, projet, drapeau gardés)", () => {
    const modifie = rappelModifie(saisieRappel(), tache(), CATEGORIES);
    expect(modifie).toMatchObject({ id: "t1", titre: "Appeler l’école", notes: "Avant midi", liste: "clients", priorite: 2, projectId: "p1", signalee: true, creeLe: "2026-10-20T08:00:00.000Z" });
  });

  test("la date et l'heure inchangées gardent la notification ; changées, elle repart", () => {
    expect(rappelModifie(saisieRappel(), tache(), CATEGORIES).notifiee).toBe(true);
    expect(rappelModifie(saisieRappel({ heure: "11:00" }), tache(), CATEGORIES).notifiee).toBe(false);
    expect(rappelModifie(saisieRappel({ jour: "2026-11-03" }), tache(), CATEGORIES).notifiee).toBe(false);
  });

  test("sans date, ni heure ni fin ; une fin avant la date est retirée", () => {
    expect(rappelModifie(saisieRappel({ jour: null, heure: "10:00", fin: "2026-11-05" }), tache(), CATEGORIES)).toMatchObject({ date: null, heure: null, fin: null });
    expect(rappelModifie(saisieRappel({ fin: "2026-11-01" }), tache(), CATEGORIES).fin).toBeNull();
    expect(rappelModifie(saisieRappel({ fin: "2026-11-05" }), tache(), CATEGORIES).fin).toBe("2026-11-05");
  });

  test("cocher note quand ; rouvrir l'efface ; rien ne change sinon", () => {
    expect(rappelModifie(saisieRappel({ faite: true }), tache(), CATEGORIES).faiteLe).toEqual(expect.any(String));
    expect(rappelModifie(saisieRappel({ faite: false }), tache({ faite: true, faiteLe: "2026-11-01T10:00:00.000Z" }), CATEGORIES).faiteLe).toBeNull();
    expect(rappelModifie(saisieRappel({ faite: true }), tache({ faite: true, faiteLe: "2026-11-01T10:00:00.000Z" }), CATEGORIES).faiteLe).toBe("2026-11-01T10:00:00.000Z");
  });

  test("refusés : titre vide, catégorie inconnue, date ou heure impossibles, urgence hors de 0 à 3", () => {
    expect(code(() => rappelModifie(saisieRappel({ titre: "   " }), tache(), CATEGORIES))).toBe("titre");
    expect(code(() => rappelModifie(saisieRappel({ liste: "ecole" }), tache(), CATEGORIES))).toBe("categorie");
    expect(code(() => rappelModifie(saisieRappel({ jour: "2026-02-30" }), tache(), CATEGORIES))).toBe("arguments");
    expect(code(() => rappelModifie(saisieRappel({ heure: "25:00" }), tache(), CATEGORIES))).toBe("arguments");
    expect(code(() => rappelModifie(saisieRappel({ priorite: 4 }), tache(), CATEGORIES))).toBe("arguments");
    expect(code(() => rappelModifie(saisieRappel({ faite: "oui" }), tache(), CATEGORIES))).toBe("arguments");
  });
});

describe("un événement de l'ordinateur modifié", () => {
  const saisie = (patch: Record<string, unknown> = {}) => ({ id: "e1", titre: " Démo ", notes: "", jour: "2026-11-04", debut: "14:00", fin: "15:00", projectId: "p2", ...patch });

  test("mêmes champs que sa fenêtre ; la notification repart si la date ou le début change", () => {
    expect(evenementModifie(saisie(), evenement())).toMatchObject({ titre: "Démo", projectId: "p2", notifie: true });
    expect(evenementModifie(saisie({ debut: "15:00", fin: "16:00" }), evenement()).notifie).toBe(false);
    expect(evenementModifie(saisie({ jour: "2026-11-05" }), evenement()).notifie).toBe(false);
  });

  test("toute la journée : ni début ni fin ; refusés : fin avant le début, sans date", () => {
    expect(evenementModifie(saisie({ debut: null, fin: "15:00" }), evenement())).toMatchObject({ debut: null, fin: null });
    expect(code(() => evenementModifie(saisie({ fin: "13:00" }), evenement()))).toBe("heure");
    expect(code(() => evenementModifie(saisie({ jour: null }), evenement()))).toBe("arguments");
  });
});

describe("une catégorie", () => {
  const icones = ["home-01", "list"];

  test("nom nettoyé, teinte des agents, icône de la liste du bureau", () => {
    expect(categorieSaisie({ nom: "  École  ", teinte: "jaune", icone: "list" }, icones)).toEqual({ nom: "École", teinte: "jaune", icone: "list" });
  });

  test("refusées : sans nom, teinte ou icône inconnues", () => {
    expect(code(() => categorieSaisie({ nom: " ", teinte: "jaune", icone: "list" }, icones))).toBe("nom");
    expect(code(() => categorieSaisie({ nom: "École", teinte: "fuchsia", icone: "list" }, icones))).toBe("arguments");
    expect(code(() => categorieSaisie({ nom: "École", teinte: "jaune", icone: "bombe" }, icones))).toBe("arguments");
  });
});
