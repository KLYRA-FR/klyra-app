import { afterEach, describe, expect, test, vi } from "vitest";
import { composition, lireDerniereDonnee, PAYSAGE_TELEPHONE_MAX, retenirDerniereDonnee, TELEPHONE_MAX, texteHorsLigne } from "./coque";

describe("composition de l'app web (M-2, § 9)", () => {
  test("l'app de bureau reste le bureau, quelle que soit la fenêtre", () => {
    expect(composition({ largeur: 1280, hauteur: 800, electron: true })).toBe("bureau");
    expect(composition({ largeur: 375, hauteur: 812, electron: true })).toBe("bureau");
  });

  test("hors Electron : téléphone sous 760 px, tablette au-delà, jamais le bureau", () => {
    expect(composition({ largeur: 375, hauteur: 812, electron: false })).toBe("telephone");
    expect(composition({ largeur: TELEPHONE_MAX - 1, hauteur: 1024, electron: false })).toBe("telephone");
    expect(composition({ largeur: TELEPHONE_MAX, hauteur: 1024, electron: false })).toBe("tablette");
    expect(composition({ largeur: 1024, hauteur: 768, electron: false })).toBe("tablette");
    expect(composition({ largeur: 1440, hauteur: 900, electron: false })).toBe("tablette");
  });

  test("un téléphone couché garde une colonne", () => {
    expect(composition({ largeur: 932, hauteur: 430, electron: false })).toBe("telephone");
    expect(composition({ largeur: 932, hauteur: PAYSAGE_TELEPHONE_MAX, electron: false })).toBe("tablette");
  });
});

/** Le stockage du téléphone, simulé (l'environnement des tests n'en a pas). */
function stockage(lever = false) {
  const valeurs = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (cle: string) => {
      if (lever) throw new Error("refusé");
      return valeurs.get(cle) ?? null;
    },
    setItem: (cle: string, valeur: string) => {
      if (lever) throw new Error("refusé");
      valeurs.set(cle, valeur);
    },
  });
}

describe("bandeau hors ligne (P-12)", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("l'heure de la dernière donnée reçue, au format de la spec", () => {
    expect(texteHorsLigne(new Date(2026, 9, 31, 18, 42).getTime())).toBe("Hors ligne · données du 31/10 à 18:42");
    expect(texteHorsLigne(new Date(2026, 0, 5, 7, 3).getTime())).toBe("Hors ligne · données du 05/01 à 07:03");
  });

  test("sans donnée reçue : « Hors ligne », sans heure inventée", () => {
    expect(texteHorsLigne(null)).toBe("Hors ligne");
    expect(texteHorsLigne(Number.NaN)).toBe("Hors ligne");
  });

  test("l'heure est gardée d'une ouverture à l'autre", () => {
    stockage();
    expect(lireDerniereDonnee()).toBeNull();
    retenirDerniereDonnee(1_761_932_520_000);
    expect(lireDerniereDonnee()).toBe(1_761_932_520_000);
  });

  test("sans stockage : rien ne casse", () => {
    stockage(true);
    retenirDerniereDonnee(1_761_932_520_000);
    expect(lireDerniereDonnee()).toBeNull();
  });
});
