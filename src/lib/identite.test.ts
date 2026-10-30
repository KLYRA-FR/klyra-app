import { describe, expect, test } from "vitest";
import { ecartProfils, identiteAffichee, identiteValable, type ProfilCompte } from "./identite";
import type { User } from "@/types/domain";

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";
const ICI: User = { id: "pelin", name: "Pelin", title: "Design · KLYRA", initial: "P", photo: PHOTO };
const COMPTE_A: ProfilCompte = { nom: "Pelin Bagcaci", intitule: "Direction artistique", couleur: "violet" };
const COMPTE_B: ProfilCompte = { nom: "Yanis", intitule: "", couleur: "vert" };

describe("identité affichée", () => {
  test("sans compte : le profil de cet ordinateur, tel quel", () => {
    expect(identiteAffichee(ICI, null)).toEqual({ id: "pelin", name: "Pelin", title: "Design · KLYRA", initial: "P", photo: PHOTO, couleur: null, source: "local" });
  });

  test("connecté : nom, rôle et couleur du compte ; photo et identifiant de cet ordinateur", () => {
    expect(identiteAffichee(ICI, COMPTE_A)).toEqual({
      id: "pelin",
      name: "Pelin Bagcaci",
      title: "Direction artistique",
      initial: "P",
      photo: PHOTO,
      couleur: "violet",
      source: "compte",
    });
  });

  test("profil d'équipe incomplet : l'app montre ce que l'équipe voit (rôle vide), sans rien écrire", () => {
    const moi = identiteAffichee(ICI, { ...COMPTE_A, intitule: "" });
    expect(moi.title).toBe("");
    expect(ICI.title).toBe("Design · KLYRA");
  });

  test("la photo n'est jamais remplacée par une valeur vide du compte", () => {
    expect(identiteAffichee(ICI, COMPTE_B).photo).toBe(PHOTO);
    expect(identiteAffichee({ ...ICI, photo: undefined }, COMPTE_B).photo).toBeNull();
  });

  test("déconnexion, puis changement de compte : rien du compte précédent ne reste", () => {
    const apresA = identiteAffichee(ICI, COMPTE_A);
    const deconnecte = identiteAffichee(ICI, null);
    const sousB = identiteAffichee(ICI, COMPTE_B);
    expect(deconnecte).toEqual(identiteAffichee(ICI, null));
    for (const valeur of [COMPTE_A.nom, COMPTE_A.intitule, COMPTE_A.couleur]) {
      expect(Object.values(deconnecte)).not.toContain(valeur);
      expect(Object.values(sousB)).not.toContain(valeur);
    }
    expect(sousB).toMatchObject({ name: "Yanis", title: "", couleur: "vert", initial: "Y" });
    expect(apresA.name).toBe("Pelin Bagcaci");
  });

  test("premier lancement sans nom : l'initiale vient du nom s'il en manque une", () => {
    expect(identiteAffichee({ id: "moi", name: "élise", title: "", initial: "" }, null).initial).toBe("É");
  });
});

describe("écart entre cet ordinateur et le compte", () => {
  test("pas de compte, ou un ordinateur sans nom : rien à proposer", () => {
    expect(ecartProfils(ICI, null)).toBeNull();
    expect(ecartProfils({ ...ICI, name: "  " }, COMPTE_A)).toBeNull();
  });

  test("mêmes valeurs, aux espaces près : pas d'écart", () => {
    expect(ecartProfils({ ...ICI, name: "  Pelin   Bagcaci ", title: "Direction  artistique" }, COMPTE_A)).toBeNull();
  });

  test("première connexion, compte rempli autrement : les deux versions, sans rien choisir", () => {
    expect(ecartProfils(ICI, COMPTE_A)).toEqual({
      local: { nom: "Pelin", intitule: "Design · KLYRA" },
      localBrut: { nom: "Pelin", intitule: "Design · KLYRA" },
      compte: { nom: "Pelin Bagcaci", intitule: "Direction artistique" },
    });
  });

  test("première connexion, compte incomplet (rôle vide) : l'ordinateur peut le compléter", () => {
    expect(ecartProfils(ICI, { ...COMPTE_A, nom: "Pelin", intitule: "" })?.local).toEqual({ nom: "Pelin", intitule: "Design · KLYRA" });
  });

  test("un nom trop long sur cet ordinateur ne peut pas partir vers le compte", () => {
    const ecart = ecartProfils({ ...ICI, name: "P".repeat(81) }, COMPTE_A);
    expect(ecart?.local).toBeNull();
    expect(ecart?.localBrut.nom).toHaveLength(81);
  });
});

describe("nom et rôle valables (mêmes règles que le serveur)", () => {
  test("espaces retirés, rôle facultatif, 80 caractères au plus", () => {
    expect(identiteValable("  Pelin   B. ", "  ")).toEqual({ nom: "Pelin B.", intitule: "" });
    expect(identiteValable(" ", "Design")).toBeNull();
    expect(identiteValable("Pelin", "D".repeat(81))).toBeNull();
    expect(identiteValable("P".repeat(80), "D".repeat(80))).not.toBeNull();
  });
});
