import { describe, expect, test } from "vitest";
import { MARGE_INFOBULLE, placerInfobulle, type Boite } from "./infobulle";

const vue = { width: 1200, height: 800 };
const bulle = { width: 72, height: 28 };

const boite = (top: number, left: number, width = 48, height = 48): Boite => ({
  top,
  left,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe("placerInfobulle", () => {
  test("à droite du rail, centrée sur l'icône", () => {
    const ancre = boite(120, 16);
    const place = placerInfobulle(ancre, bulle, "droite", vue);
    expect(place.cote).toBe("droite");
    expect(place.left).toBe(ancre.right + MARGE_INFOBULLE);
    expect(place.top).toBe(ancre.top + ancre.height / 2 - bulle.height / 2);
    expect(place.fleche).toBe(bulle.height / 2);
  });

  test("se retourne à gauche quand le bord droit est trop près", () => {
    const ancre = boite(200, 1140);
    const place = placerInfobulle(ancre, bulle, "droite", vue);
    expect(place.cote).toBe("gauche");
    expect(place.left).toBe(ancre.left - MARGE_INFOBULLE - bulle.width);
  });

  test("se retourne au-dessus quand le bas manque", () => {
    const ancre = boite(760, 400);
    const place = placerInfobulle(ancre, bulle, "bas", vue);
    expect(place.cote).toBe("haut");
    expect(place.top).toBe(ancre.top - MARGE_INFOBULLE - bulle.height);
  });

  test("reste dans la fenêtre et garde la flèche sur la bulle", () => {
    const ancre = boite(4, 4, 20, 20);
    const large = { width: 200, height: 40 };
    const place = placerInfobulle(ancre, large, "bas", vue);
    expect(place.left).toBeGreaterThanOrEqual(MARGE_INFOBULLE);
    expect(place.top).toBeGreaterThanOrEqual(MARGE_INFOBULLE);
    expect(place.left + large.width).toBeLessThanOrEqual(vue.width - MARGE_INFOBULLE);
    expect(place.fleche).toBeGreaterThanOrEqual(12);
    expect(place.fleche).toBeLessThanOrEqual(large.width - 12);
  });
});
