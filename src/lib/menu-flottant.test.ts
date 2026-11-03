import { describe, expect, it } from "vitest";
import { placeMenuFlottant } from "./menu-flottant";

const bouton = (left: number, top = 120, width = 300, height = 44) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe("placeMenuFlottant", () => {
  it("décale le menu pour que « Max » reste dans la fenêtre quand le tiroir est à droite", () => {
    const place = placeMenuFlottant(bouton(1100), { width: 1440, height: 900 }, 320);
    expect(place.largeur).toBe(400);
    expect(place.left).toBe(1440 - 16 - 400);
    expect(place.left + place.largeur).toBeLessThanOrEqual(1440 - 16);
    expect(place.top).toBe(120 + 44 + 8);
    expect(place.versLeHaut).toBe(false);
  });

  it("reste aligné sur le bouton quand le menu tient en entier", () => {
    const place = placeMenuFlottant(bouton(200), { width: 1440, height: 900 }, 320);
    expect(place.left).toBe(200);
    expect(place.largeur).toBe(400);
  });

  it("rétrécit le menu à la fenêtre moins les marges", () => {
    const place = placeMenuFlottant(bouton(0), { width: 360, height: 800 }, 320);
    expect(place.largeur).toBe(360 - 32);
    expect(place.left).toBe(16);
    expect(place.left + place.largeur).toBe(360 - 16);
  });

  it("s'ouvre vers le haut quand la place manque en dessous", () => {
    const place = placeMenuFlottant(bouton(200, 700), { width: 1440, height: 800 }, 320);
    expect(place.versLeHaut).toBe(true);
    expect(place.top).toBeUndefined();
    expect(place.bottom).toBe(800 - 700 + 8);
  });
});
