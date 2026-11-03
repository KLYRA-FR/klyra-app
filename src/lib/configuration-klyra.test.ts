import { describe, expect, it } from "vitest";
import { adopter } from "@/components/reglages/ConfigurationKlyra";
import {
  CONFIGURATION_PAR_DEFAUT,
  consigneKlyra,
  consignesAJour,
  estRecommandee,
  MODELE_CONSIGNES,
  MODELES_PRECEDENTS,
  nouveauModeleDisponible,
  signatureConfiguration,
  TAILLE_MAX_CONSIGNES,
  validerConfiguration,
} from "../../electron/configuration-klyra";

describe("validerConfiguration", () => {
  it("par défaut : rien d'adopté, la mémoire comme les fiches la demandent, la carte à proposer", () => {
    expect(validerConfiguration(undefined)).toEqual(CONFIGURATION_PAR_DEFAUT);
    expect(validerConfiguration({ memoireAgents: "non", proposition: "autre", consignes: { texte: 3 } })).toEqual(CONFIGURATION_PAR_DEFAUT);
  });

  it("garde ce qui est valide, et coupe un texte trop long", () => {
    const c = validerConfiguration({ consignes: { texte: "x".repeat(TAILLE_MAX_CONSIGNES + 10), version: 1 }, memoireAgents: false, proposition: "ecartee" });
    expect(c.consignes?.texte.length).toBe(TAILLE_MAX_CONSIGNES);
    expect(c.memoireAgents).toBe(false);
    expect(c.proposition).toBe("ecartee");
  });
});

describe("versions du modèle", () => {
  it("un texte resté tel quel passe à la nouvelle version d'office ; un texte modifié reste, avec la nouvelle proposée", () => {
    MODELES_PRECEDENTS[0] = "ancien modèle";
    try {
      expect(consignesAJour({ texte: "ancien modèle", version: 0 })).toEqual(MODELE_CONSIGNES);
      const modifie = { texte: "ancien modèle, revu par moi", version: 0 };
      expect(consignesAJour(modifie)).toEqual(modifie);
      expect(nouveauModeleDisponible(modifie)).toBe(true);
    } finally {
      delete MODELES_PRECEDENTS[0];
    }
    expect(nouveauModeleDisponible({ ...MODELE_CONSIGNES })).toBe(false);
  });

  it("chaque version précédente du modèle mène à l'actuelle (la v1 publiée le 03/11 passe en v2)", () => {
    for (const [version, texte] of Object.entries(MODELES_PRECEDENTS)) {
      expect(consignesAJour({ texte, version: Number(version) })).toEqual(MODELE_CONSIGNES);
    }
    expect(MODELES_PRECEDENTS[1]).toMatch(/pas d'exploration du poste/);
    expect(MODELE_CONSIGNES.texte).toMatch(/recherche ciblée/);
  });
});

describe("ce qui part aux agents", () => {
  it("le texte adopté, présenté comme le choix de la personne ; rien sans consignes ou avec un texte vide", () => {
    expect(consigneKlyra(MODELE_CONSIGNES)).toMatch(/^Consignes KLYRA, choisies par la personne/);
    expect(consigneKlyra(null)).toBeNull();
    expect(consigneKlyra({ texte: "   ", version: 1 })).toBeNull();
  });

  it("changer de consignes ou de mémoire change la signature des sessions (elles repartent avec)", () => {
    const a = signatureConfiguration(CONFIGURATION_PAR_DEFAUT);
    expect(signatureConfiguration({ ...CONFIGURATION_PAR_DEFAUT, memoireAgents: false })).not.toBe(a);
    expect(signatureConfiguration({ ...CONFIGURATION_PAR_DEFAUT, consignes: MODELE_CONSIGNES })).not.toBe(a);
    expect(signatureConfiguration({ ...CONFIGURATION_PAR_DEFAUT, proposition: "ecartee" })).toBe(a);
  });
});

describe("adopter la configuration recommandée", () => {
  it("consignes du modèle et mémoire coupée ; des consignes déjà modifiées restent les siennes", () => {
    const adoptee = adopter(CONFIGURATION_PAR_DEFAUT);
    expect(adoptee).toEqual({ consignes: MODELE_CONSIGNES, memoireAgents: false, proposition: "adoptee" });
    expect(estRecommandee(adoptee)).toBe(true);
    const miennes = { texte: "Mes consignes.", version: 1 };
    expect(adopter({ ...CONFIGURATION_PAR_DEFAUT, consignes: miennes }).consignes).toEqual(miennes);
  });
});
