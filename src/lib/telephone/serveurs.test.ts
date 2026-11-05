import { describe, expect, test } from "vitest";
import { etapeTerminal, ligneServeur } from "./serveurs";

const sur = "ton Mac";
const dixHeures = new Date(2026, 10, 5, 14, 2).getTime();

describe("une ligne de serveur (E8-12, E8-49)", () => {
  test("il répond : étiquette bleue, agents prêts et heure de vérification", () => {
    expect(ligneServeur({ etat: "joint", sonde: "repond", agents: "pret", verifieLe: dixHeures, sur })).toEqual({ etiquette: "Répond", ton: "bleue", phrase: "Agents prêts · vérifié à 14:02" });
  });

  test("il répond sans Claude : ce qu'il faut faire, sans nom de commande", () => {
    const l = ligneServeur({ etat: "joint", sonde: "repond", agents: "non-connecte", sur });
    expect(l.phrase).toBe("Claude Code est à connecter sur le serveur");
    expect(l.phrase).not.toMatch(/connecter-claude/);
  });

  test("pas de réponse : jamais un arrêt annoncé, et le chemin réel des messages", () => {
    const l = ligneServeur({ etat: "joint", sonde: "silence", sur });
    expect(l).toEqual({ etiquette: "Ne répond pas", ton: "orange", phrase: "La connexion échoue : les messages directs restent à réessayer vers ce serveur." });
    expect(l.phrase).not.toMatch(/arrêté|éteint\./);
  });

  test("plus relié, autre version, quitté, vérification : une phrase par état", () => {
    expect(ligneServeur({ etat: "joint", sonde: "invitation", sur }).etiquette).toBe("Plus relié");
    expect(ligneServeur({ etat: "joint", sonde: "version", sur }).etiquette).toBe("Autre version");
    expect(ligneServeur({ etat: "quitte", sonde: "repond", sur })).toEqual({ etiquette: "Quitté", ton: "neutre", phrase: "Ce téléphone ne l’interroge plus" });
    expect(ligneServeur({ etat: "joint", sonde: undefined, sur }).etiquette).toBe("Vérification…");
  });

  test("un code en retard : dit avant le reste, sans parler de numéro de version", () => {
    const l = ligneServeur({ etat: "joint", sonde: "repond", agents: "pret", retard: true, sur });
    expect(l).toEqual({ etiquette: "À mettre à jour", ton: "orange", phrase: "Il répond, mais son code a du retard : relance la commande sur le VPS." });
  });

  test("hors ligne : pas d'étiquette qui aurait l'air actuelle", () => {
    const l = ligneServeur({ etat: "joint", sonde: "repond", agents: "pret", sur, horsLigne: true });
    expect(l.etiquette).toBeNull();
    expect(l.phrase).toBe("Possible quand ce téléphone est en ligne");
  });

  test("aucune phrase ne porte une adresse ni un code", () => {
    for (const sonde of ["repond", "silence", "invitation", "version", "attente"] as const) {
      const { phrase } = ligneServeur({ etat: "joint", sonde, sur });
      expect(phrase).not.toMatch(/https?:|\b\d{3}\b|klyra:\/\//);
    }
  });
});

describe("le guide nomme le vrai terminal (socle § 8)", () => {
  test("Mac, Windows, autre", () => {
    expect(etapeTerminal("mac", "ton Mac")).toBe("Sur ton Mac, ouvre Terminal");
    expect(etapeTerminal("windows", "ton PC")).toBe("Sur ton PC, ouvre PowerShell");
    expect(etapeTerminal("autre", "ton ordinateur")).toBe("Sur ton ordinateur, ouvre un terminal");
    expect(etapeTerminal(null, "ton ordinateur")).toBe("Sur ton ordinateur, ouvre un terminal");
  });
});
