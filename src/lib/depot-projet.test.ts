import { describe, expect, test } from "vitest";
import { emplacementProjet, nomDepot, resumeCourt, resumeDepot } from "@/lib/depot-projet";

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

describe("emplacementProjet", () => {
  test("un projet de serveur : le nom du serveur, jamais son chemin", () => {
    expect(emplacementProjet("/var/lib/klyra/projets/GitHub/KLYRA-FR/klyra-app-0d6e4079e367", "https://vps.exemple.fr", "VPS Hetzner")).toBe("Sur VPS Hetzner");
  });
  test("ce poste : le dossier personnel en « ~ », Mac, Linux et Windows", () => {
    expect(emplacementProjet("/Users/pelin/Sites/klyra", null, "Ce PC")).toBe("~/Sites/klyra");
    expect(emplacementProjet("/home/corentin/KLYRA/GitHub/site", null, "Ce PC")).toBe("~/KLYRA/GitHub/site");
    expect(emplacementProjet("C:\\Users\\Corentin\\KLYRA\\site", null, "Ce PC")).toBe("~\\KLYRA\\site");
    expect(emplacementProjet("/srv/site", null, "Ce PC")).toBe("/srv/site");
    expect(emplacementProjet("/Users/pelinou", null, "Ce PC")).toBe("~");
  });
});

test("resumeCourt : la branche et ce qui attend, en quelques mots", () => {
  const base = { branche: "main", suivie: true, enAvance: 0, enRetard: 0, fichiers: [] };
  expect(resumeCourt(base)).toBe("main · à jour");
  expect(resumeCourt({ ...base, enRetard: 2, fichiers: [{ statut: "M", chemin: "a" }] })).toBe("main · 2 à récupérer · 1 modifié");
  expect(resumeCourt({ ...base, suivie: false, enAvance: 3 })).toBe("main · pas sur GitHub · 3 à envoyer");
});
