import { describe, expect, test } from "vitest";
import { analyserCollage, estCaptureCollee, TAILLE_MAX_IMAGE } from "./collage";

const capture = { type: "image/png", taille: 120_000, chemin: "" };

describe("ce que fait un collage dans le composeur", () => {
  test("du texte seul : le collage normal", () => {
    expect(analyserCollage("Bonjour", [])).toEqual({ action: "texte" });
  });

  test("du texte avec son image (tableur, traitement de texte) : le texte, sans pièce jointe", () => {
    expect(analyserCollage("A1\tB1", [capture])).toEqual({ action: "texte" });
  });

  test("une capture seule : une image à joindre", () => {
    expect(analyserCollage("", [capture])).toEqual({ action: "joindre", chemins: [], image: 0, alerte: null });
    expect(analyserCollage("  \n", [capture])).toMatchObject({ action: "joindre", image: 0 });
  });

  test("plusieurs représentations de la même image : une seule pièce jointe, au format admis", () => {
    const representations = [
      { type: "image/tiff", taille: 900_000, chemin: "" },
      { type: "image/png", taille: 120_000, chemin: "" },
      { type: "image/png", taille: 120_000, chemin: "" },
    ];
    expect(analyserCollage("", representations)).toEqual({ action: "joindre", chemins: [], image: 1, alerte: null });
  });

  test("des fichiers copiés dans le Finder ou l'Explorateur : leurs chemins, sans doublon", () => {
    const copies = [
      { type: "image/png", taille: 10, chemin: "C:\\Users\\pelin\\Bureau\\maquette finale.png" },
      { type: "application/pdf", taille: 10, chemin: "/Users/pelin/brief.pdf" },
      { type: "application/pdf", taille: 10, chemin: "/Users/pelin/brief.pdf" },
    ];
    expect(analyserCollage("", copies)).toEqual({
      action: "joindre",
      chemins: ["C:\\Users\\pelin\\Bureau\\maquette finale.png", "/Users/pelin/brief.pdf"],
      image: null,
      alerte: null,
    });
  });

  test("format non admis : rien de joint, le message habituel", () => {
    expect(analyserCollage("", [{ type: "image/tiff", taille: 10, chemin: "" }])).toEqual({
      action: "joindre",
      chemins: [],
      image: null,
      alerte: "Format d’image non pris en charge : PNG, JPEG, GIF ou WebP.",
    });
  });

  test("image trop lourde : rien de joint, sa taille dite", () => {
    expect(analyserCollage("", [{ type: "image/png", taille: TAILLE_MAX_IMAGE + 1, chemin: "" }])).toMatchObject({
      image: null,
      alerte: "Image trop lourde (21 Mo) : 20 Mo au plus.",
    });
    expect(analyserCollage("", [{ type: "image/jpeg", taille: TAILLE_MAX_IMAGE, chemin: "" }])).toMatchObject({ image: 0, alerte: null });
  });

  test("une capture collée se reconnaît à son dossier et à son nom, sous Mac comme sous Windows", () => {
    expect(estCaptureCollee("/Users/pelin/Library/Application Support/klyra-app/collages/capture-2026-10-30-114205-1a2b3c4d5e6f.png")).toBe(true);
    expect(estCaptureCollee("C:\\Users\\pelin\\AppData\\Roaming\\klyra-app\\collages\\capture-2026-10-30-114205-1a2b3c4d5e6f.webp")).toBe(true);
    expect(estCaptureCollee("/Users/pelin/Bureau/capture-2026-10-30-114205-1a2b3c4d5e6f.png")).toBe(false);
    expect(estCaptureCollee("/Users/pelin/collages/vacances.png")).toBe(false);
  });

  test("un fichier sans chemin qui n'est pas une image : le collage normal", () => {
    expect(analyserCollage("", [{ type: "application/octet-stream", taille: 10, chemin: "" }])).toEqual({ action: "texte" });
  });
});
