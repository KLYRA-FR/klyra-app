import { describe, expect, test } from "vitest";
import type { Rendu } from "@/types/domain";
import { estCheminComplet, lirePublication, nomDuFichier, publierRendu, renduDepuisServeur, typeDeRendu } from "./rendus";

const rendu = (r: Partial<Rendu>): Rendu => ({
  id: "r1",
  chemin: "/home/alice/.klyra/rendus/designer/2026-11-03 maquette.html",
  origine: "/home/alice/.klyra/atelier/designer/maquette.html",
  taille: 1200,
  titre: "Maquette",
  description: "",
  type: "page",
  roleId: "designer",
  chatId: "dm-designer",
  projectId: null,
  ajouteLe: "2026-11-03T10:00:00.000Z",
  misAJour: "2026-11-03T10:00:00.000Z",
  ...r,
});

describe("rendus des agents", () => {
  test("le type vient de l'extension", () => {
    expect(["a.html", "b.HTM", "c.png", "d.jpeg", "e.svg", "f.mp4", "g.pdf", "h.docx", "i"].map(typeDeRendu)).toEqual([
      "page", "page", "image", "image", "image", "video", "pdf", "document", "document",
    ]);
  });

  test("chemins complets sous Mac, Linux et Windows ; nom du fichier", () => {
    expect(["/tmp/a.png", "~/a.png", "C:\\Users\\a.png", "D:/a.png", "\\\\nas\\a.png"].every(estCheminComplet)).toBe(true);
    expect(["a.png", "./a.png", "dossier/a.png", ""].some(estCheminComplet)).toBe(false);
    expect(nomDuFichier("C:\\Users\\Ali\\captures\\accueil.png")).toBe("accueil.png");
    expect(nomDuFichier("/home/a/rendu.html")).toBe("rendu.html");
  });

  test("ce que l'agent envoie : chemin complet obligatoire, titre par défaut, longueurs bornées", () => {
    expect(() => lirePublication({})).toThrow(/chemin/);
    expect(() => lirePublication({ chemin: "captures/accueil.png" })).toThrow(/chemin complet/);
    expect(lirePublication({ chemin: " /tmp/accueil.png ", titre: "  Page   d’accueil " })).toEqual({ chemin: "/tmp/accueil.png", titre: "Page d’accueil", description: "" });
    expect(lirePublication({ chemin: "/tmp/accueil.png" }).titre).toBe("accueil.png");
    expect(lirePublication({ chemin: "/tmp/a.png", titre: "x".repeat(200), description: "y".repeat(900) })).toMatchObject({ titre: "x".repeat(80), description: "y".repeat(500) });
  });

  test("un livrable de VPS n'a pas de copie sur ce PC", () => {
    const fiche = renduDepuisServeur(
      "https://vps.exemple",
      { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", chemin: "/root/klyra/page.html", dossier: false, taille: 40, titre: "Page", description: "Notes", agent: "iris" },
      { id: "dm-iris@vps", projectId: null },
      "2026-11-04T12:00:00.000Z",
      "local",
    );
    expect(fiche).toMatchObject({
      chemin: "",
      origine: "https://vps.exemple#/root/klyra/page.html",
      distantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      dossier: false,
      type: "page",
      roleId: "iris",
      chatId: "dm-iris@vps",
    });
    const dossier = renduDepuisServeur(
      "https://vps.exemple",
      { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", chemin: "/root/klyra/site", dossier: true, taille: 80, titre: "", description: "", agent: "iris" },
      undefined,
      "2026-11-04T12:00:00.000Z",
      "local",
    );
    expect(dossier).toMatchObject({ type: "page", titre: "site", chemin: "", chatId: null });
  });

  test("republier le même original met son rendu à jour (nouvelle copie) et le remonte", () => {
    const autre = rendu({ id: "r2", chemin: "/r/autre.png", origine: "/tmp/autre.png", type: "image" });
    const liste = [autre, rendu({})];
    const apres = publierRendu(liste, rendu({ id: "neuf", chemin: "/r/2026-11-04 maquette.html", titre: "Maquette v2", description: "Accueil", ajouteLe: "2026-11-04T12:00:00.000Z", misAJour: "2026-11-04T12:00:00.000Z" }));
    expect(apres.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(apres[0]).toMatchObject({ chemin: "/r/2026-11-04 maquette.html", titre: "Maquette v2", description: "Accueil", ajouteLe: "2026-11-03T10:00:00.000Z", misAJour: "2026-11-04T12:00:00.000Z" });
    expect(publierRendu(liste, rendu({ id: "r3", chemin: "/r/n.pdf", origine: "/tmp/nouveau.pdf" })).map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
  });
});
