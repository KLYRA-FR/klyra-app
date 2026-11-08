import { describe, expect, it } from "vitest";
import { cadrerCamera, SimulationGraphe, zoomerCamera, ZOOM_MAX, ZOOM_MIN } from "./graphe-physique";

const structure = {
  noeuds: [{ id: "a", type: "agent" as const }, { id: "b", type: "souvenir" as const }, { id: "c", type: "souvenir" as const }],
  aretes: [{ de: "a", vers: "b", type: "produit-par" as const }],
};

describe("navigation et physique du graphe", () => {
  it("garde le point sous le curseur fixe, même aux bornes du zoom", () => {
    const v = { k: 0.5, x: -20, y: 35 }, p = { x: 120, y: 380 };
    for (const facteur of [0.0001, 0.5, 2, 100000]) {
      const n = zoomerCamera(v, facteur, p);
      expect((p.x - n.x) / n.k).toBeCloseTo((p.x - v.x) / v.k);
      expect((p.y - n.y) / n.k).toBeCloseTo((p.y - v.y) / v.k);
      expect(n.k).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(n.k).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });
  it("recadre toutes les positions, même dans une fenêtre très étroite", () => {
    const pos = { a: { x: -650, y: -80 }, b: { x: 420, y: 850 } };
    for (const [l, h] of [[1400, 700], [280, 600]]) {
      const v = cadrerCamera(pos, l, h);
      for (const p of Object.values(pos)) {
        expect(p.x * v.k + v.x).toBeGreaterThan(0);
        expect(p.x * v.k + v.x).toBeLessThan(l);
        expect(p.y * v.k + v.y).toBeGreaterThan(0);
        expect(p.y * v.k + v.y).toBeLessThan(h);
      }
    }
  });
  it("tient exactement le nœud sous le curseur et entraîne son voisin", () => {
    const s = new SimulationGraphe(structure);
    const b = { ...s.positions.b };
    s.saisir("a", s.positions.a);
    s.tirer({ x: 600, y: -240 });
    for (let i = 0; i < 40; i++) s.avancer();
    expect(s.positions.a.x).toBe(600);
    expect(s.positions.a.y).toBe(-240);
    expect(Math.hypot(s.positions.b.x - b.x, s.positions.b.y - b.y)).toBeGreaterThan(30);
    s.relacher();
    let pas = 0;
    while (s.avancer() && pas++ < 1000) { /* amortissement */ }
    expect(pas).toBeLessThan(1000);
    expect(s.positions.a.x).not.toBe(600);
  });
  it("ne transforme pas un lien suggéré en ressort", () => {
    const a = new SimulationGraphe(structure);
    const b = new SimulationGraphe({ ...structure, aretes: [...structure.aretes, { de: "b", vers: "c", type: "deduit" }] });
    expect(a.positions).toEqual(b.positions);
  });
  it("garde 600 nœuds finis, distincts, et s'arrête au repos", () => {
    const g = { noeuds: Array.from({ length: 600 }, (_, i) => ({ id: String(i), type: "souvenir" as const })), aretes: Array.from({ length: 599 }, (_, i) => ({ de: String(i), vers: String(i + 1), type: "lien" as const })) };
    const debut = performance.now(), s = new SimulationGraphe(g);
    let pas = 0;
    while (s.avancer() && pas++ < 1000) { /* jusqu'au repos */ }
    expect(pas).toBeLessThan(1000);
    expect(performance.now() - debut).toBeLessThan(5000);
    expect(Object.values(s.positions).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(new Set(Object.values(s.positions).map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)).size).toBe(600);
  });
});
