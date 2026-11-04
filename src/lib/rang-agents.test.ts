// @vitest-environment node
import { describe, expect, test } from "vitest";
import { aLaPlace, decaler, deplacer, ecart, placeVisee, trierParRang } from "./rang-agents";

describe("ordre des agents dans la barre", () => {
  const ordre = ["hugo", "iris", "sam", "val"];

  test("poser un agent avant ou après un autre", () => {
    expect(deplacer(ordre, "val", "hugo", false)).toEqual(["val", "hugo", "iris", "sam"]);
    expect(deplacer(ordre, "hugo", "sam", true)).toEqual(["iris", "sam", "hugo", "val"]);
    expect(deplacer(ordre, "hugo", "hugo", true)).toEqual(ordre);
    expect(deplacer(ordre, "absent", "hugo", false)).toEqual(ordre);
  });

  test("monter et descendre d'une place, sans sortir de la liste", () => {
    expect(decaler(ordre, "iris", -1)).toEqual(["iris", "hugo", "sam", "val"]);
    expect(decaler(ordre, "iris", 1)).toEqual(["hugo", "sam", "iris", "val"]);
    expect(decaler(ordre, "hugo", -1)).toEqual(ordre);
    expect(decaler(ordre, "val", 1)).toEqual(ordre);
  });

  test("poser un agent à une place donnée", () => {
    expect(aLaPlace(ordre, "val", 0)).toEqual(["val", "hugo", "iris", "sam"]);
    expect(aLaPlace(ordre, "hugo", 2)).toEqual(["iris", "sam", "hugo", "val"]);
    expect(aLaPlace(ordre, "iris", 1)).toEqual(ordre);
    expect(aLaPlace(ordre, "iris", 9)).toEqual(["hugo", "sam", "val", "iris"]);
    expect(aLaPlace(ordre, "absent", 0)).toEqual(ordre);
  });

  test("pendant le glisser, la place visée change à mi-chemin", () => {
    // Lignes de 54 px espacées de 4 px : milieux à 27, 85, 143, 201.
    const milieux = [27, 85, 143, 201];
    expect(placeVisee(milieux, 27)).toBe(0);
    expect(placeVisee(milieux, 55)).toBe(0);
    expect(placeVisee(milieux, 57)).toBe(1);
    expect(placeVisee(milieux, 142)).toBe(2);
    expect(placeVisee(milieux, 260)).toBe(3);
    expect(placeVisee(milieux, -40)).toBe(0);
  });

  test("les lignes entre le départ et la place visée s'écartent d'un pas", () => {
    // Hugo (0) glissé à la place 2 : Iris et Sam montent, Val ne bouge pas.
    expect([0, 1, 2, 3].map((i) => ecart(i, 0, 2, 58))).toEqual([0, -58, -58, 0]);
    // Val (3) glissé à la place 1 : Iris et Sam descendent.
    expect([0, 1, 2, 3].map((i) => ecart(i, 3, 1, 58))).toEqual([0, 58, 58, 0]);
    expect([0, 1, 2, 3].map((i) => ecart(i, 2, 2, 58))).toEqual([0, 0, 0, 0]);
  });

  test("trier par rang, les agents sans rang à la suite dans leur ordre", () => {
    const rangs: Record<string, number> = { sam: 0, hugo: 1 };
    const liste = ordre.map((id) => ({ id }));
    expect(trierParRang(liste, (id) => rangs[id]).map((r) => r.id)).toEqual(["sam", "hugo", "iris", "val"]);
  });
});
