import { describe, expect, test } from "vitest";
import { nomDepot, resumeDepot } from "@/lib/depot-projet";

describe("nomDepot", () => {
  test("le dépôt noté au clonage d'abord", () => {
    expect(nomDepot("KLYRA-FR/klyra-app", "https://github.com/autre/chose.git")).toBe("KLYRA-FR/klyra-app");
  });
  test("GitHub en https ou ssh : propriétaire/dépôt", () => {
    expect(nomDepot(undefined, "https://github.com/KLYRA-FR/klyra-app.git")).toBe("KLYRA-FR/klyra-app");
    expect(nomDepot(undefined, "git@github.com:KLYRA-FR/klyra-app.git")).toBe("KLYRA-FR/klyra-app");
  });
  test("jamais d'identifiant ni de jeton à l'écran", () => {
    const nom = nomDepot(undefined, "https://moi:ghp_secret123@github.com/KLYRA-FR/klyra-app.git");
    expect(nom).toBe("KLYRA-FR/klyra-app");
    expect(nomDepot(undefined, "https://jeton@gitlab.com/a/b.git")).toBe("gitlab.com/a/b");
  });
  test("autre chose : un libellé neutre", () => {
    expect(nomDepot(undefined, "/srv/depots/site.git")).toBe("Dépôt distant");
    expect(nomDepot(undefined, "file:///srv/depots/site.git")).toBe("Dépôt local");
  });
});

describe("resumeDepot", () => {
  const base = { branche: "main", suivie: true, enAvance: 0, enRetard: 0, fichiers: [] };
  test("à jour", () => {
    expect(resumeDepot(base)).toBe("Branche main · à jour depuis la dernière récupération");
  });
  test("ce qui attend, accordé", () => {
    expect(resumeDepot({ ...base, enRetard: 2, enAvance: 1, fichiers: [{ statut: "M", chemin: "a" }] })).toBe(
      "Branche main · 2 nouveautés à récupérer · 1 commit à envoyer · 1 fichier modifié ici",
    );
  });
  test("branche locale seulement, et ancien état sans enRetard", () => {
    expect(resumeDepot({ branche: "essai", suivie: false, enAvance: 0, fichiers: [] })).toBe("Branche essai · pas encore sur le dépôt distant");
  });
});
