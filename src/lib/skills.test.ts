import { describe, expect, it } from "vitest";
import { skillEnTete as skillEnTeteMain } from "../../electron/connaissances-agent";
import { commandeEnCours, resumeFiche, skillEnTete, skillsDemandables, skillsProposees } from "./skills";

describe("skills côté écran", () => {
  it("reconnaît /skill en tête comme le process principal", () => {
    const essais = ["/rangement range", "  /rangement", "/outils:deploi vite", "/compact", "/Compact", "range /rangement", "/", "/rangement.txt", "/a_b-c\nsuite", "@hugo /rangement"];
    for (const t of essais) expect(skillEnTete(t)).toBe(skillEnTeteMain(t));
    expect(skillEnTete("/rangement range")).toBe("rangement");
    expect(skillEnTete("/compact")).toBeNull();
  });

  it("suit la commande en cours de frappe, seulement en tête et avant l'espace", () => {
    expect(commandeEnCours("/ran", 4)).toBe("ran");
    expect(commandeEnCours("/", 1)).toBe("");
    expect(commandeEnCours("/rangement ", 11)).toBeNull();
    expect(commandeEnCours("salut /ran", 10)).toBeNull();
    expect(commandeEnCours("/rangement suite", 3)).toBe("ra");
  });

  it("propose d'abord les noms qui commencent par la saisie, sans doublon", () => {
    const skills = [
      { nom: "deploi", description: "" },
      { nom: "rangement", description: "Range" },
      { nom: "derangement", description: "" },
      { nom: "rangement", description: "Doublon du projet" },
    ];
    expect(skillsProposees(skills, "ran").map((s) => s.nom)).toEqual(["rangement", "derangement"]);
    expect(skillsProposees(skills, "").map((s) => s.nom)).toEqual(["deploi", "rangement", "derangement"]);
    expect(skillsProposees(skills, "zz")).toEqual([]);
  });

  it("ne propose par « / » ni une skill coupée pour l'agent, ni une skill de sa fiche introuvable", () => {
    const lues = {
      fiche: [
        { nom: "projet-soir", description: "Soir", dossier: "/a/projet-soir" },
        { nom: "absente", description: "", dossier: null },
      ],
      projet: [{ nom: "deploi", description: "Déploie" }],
      poste: [{ nom: "rangement", description: "Range" }, { nom: "projet-soir", description: "Soir" }],
      plugins: [{ nom: "outils:deploi-rapide", description: "Vite" }],
    };
    expect(skillsDemandables(lues).map((s) => s.nom)).toEqual(["projet-soir", "deploi", "rangement", "projet-soir", "outils:deploi-rapide"]);
    expect(skillsDemandables({ ...lues, coupees: ["projet-soir", "deploi"] }).map((s) => s.nom)).toEqual(["rangement", "outils:deploi-rapide"]);
  });

  it("dit combien de skills de sa fiche lui sont coupées", () => {
    expect(resumeFiche(1, 0)).toBe("1 dans sa fiche");
    expect(resumeFiche(1, 1)).toBe("1 dans sa fiche · coupée");
    expect(resumeFiche(2, 2)).toBe("2 dans sa fiche · coupées");
    expect(resumeFiche(3, 1)).toBe("3 dans sa fiche · 1 coupée");
  });
});
