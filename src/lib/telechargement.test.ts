import { describe, expect, it } from "vitest";
import { ID_RENDU_VPS, nomTelechargeable, nomUnique, segmentsSurs, suiviProgression } from "../../electron/telechargement-regles";

describe("le nom libre dans Téléchargements (nomUnique)", () => {
  const pris = (...noms: string[]) => (nom: string) => noms.includes(nom);

  it("garde le nom quand il est libre", () => {
    expect(nomUnique("film.mov", pris())).toBe("film.mov");
  });
  it("ajoute (1), puis (2)… avant l'extension, sans écraser", () => {
    expect(nomUnique("film.mov", pris("film.mov"))).toBe("film (1).mov");
    expect(nomUnique("film.mov", pris("film.mov", "film (1).mov", "film (2).mov"))).toBe("film (3).mov");
  });
  it("sans extension, ou un fichier caché : le suffixe va à la fin", () => {
    expect(nomUnique("LISEZMOI", pris("LISEZMOI"))).toBe("LISEZMOI (1)");
    expect(nomUnique(".env", pris(".env"))).toBe(".env (1)");
  });
  it("seule la dernière extension reste à part", () => {
    expect(nomUnique("site.tar.gz", pris("site.tar.gz"))).toBe("site.tar (1).gz");
  });
});

describe("le nom accepté (nomTelechargeable)", () => {
  it("garde un nom simple, accents et espaces compris", () => {
    expect(nomTelechargeable("Présentation finale.mov")).toBe("Présentation finale.mov");
  });
  it("refuse un chemin ou une traversée", () => {
    for (const nom of ["../secret", "a/b.txt", "..\\..\\x", "/etc/passwd", "C:\\x.txt", "..", ".", "", "  ", "a\0b", 42, null, undefined]) {
      expect(() => nomTelechargeable(nom)).toThrow();
    }
  });
  it("remplace ce que Windows refuse et retire les points ou espaces de fin", () => {
    expect(nomTelechargeable('a<b>c:"d|e?f*.txt')).toBe("a_b_c__d_e_f_.txt");
    expect(nomTelechargeable("rapport. ")).toBe("rapport");
    expect(nomTelechargeable("CON.txt")).toBe("_CON.txt");
  });
  it("raccourcit un nom trop long en gardant l'extension", () => {
    const nom = nomTelechargeable(`${"a".repeat(300)}.mov`);
    expect(nom.length).toBe(200);
    expect(nom.endsWith(".mov")).toBe(true);
  });
});

describe("les chemins d'une page servie par le VPS (segmentsSurs)", () => {
  it("découpe un chemin relatif simple", () => {
    expect(segmentsSurs("index.html")).toEqual(["index.html"]);
    expect(segmentsSurs("assets/img/logo.png")).toEqual(["assets", "img", "logo.png"]);
  });
  it("refuse l'absolu, `..`, `.`, les segments vides et les antislashs", () => {
    for (const relatif of ["/etc/passwd", "../x", "a/../../x", "a/./b", "a//b", "a/", "C:/x", "a\\..\\b", "", "a\0", 3, null]) {
      expect(() => segmentsSurs(relatif)).toThrow();
    }
  });
});

describe("l'identifiant d'une publication du VPS", () => {
  it("n'accepte qu'un uuid", () => {
    expect(ID_RENDU_VPS.test("0f830d35-1234-4abc-8def-0123456789ab")).toBe(true);
    expect(ID_RENDU_VPS.test("../../klyra/v1/agent")).toBe(false);
  });
});

describe("la progression envoyée à l'écran (suiviProgression)", () => {
  it("compte tout, n'envoie qu'une fois par intervalle, et toujours la fin", () => {
    let t = 0;
    const envois: number[] = [];
    const suivi = suiviProgression((recu) => envois.push(recu), 200, () => t);
    suivi.ajouter(10);
    t = 50;
    suivi.ajouter(10);
    t = 250;
    suivi.ajouter(10);
    suivi.finir();
    expect(suivi.recu).toBe(30);
    expect(envois).toEqual([10, 30, 30]);
  });
});
