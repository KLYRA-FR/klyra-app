// @vitest-environment node
import { describe, expect, it } from "vitest";
import { aretesMemoire, chercherMemoire, cleMemoire, decoderMemoire, enregistrerMemoire, exempleMemoire, placerMemoire, sansNote } from "./memoire";

describe("mémoire locale du prototype", () => {
  it("isole les serveurs et le poste, et retrouve les notes après relecture", () => {
    const donnees = new Map<string, string>();
    const stockage = { getItem: (k: string) => donnees.get(k) ?? null, setItem: (k: string, v: string) => { donnees.set(k, v); } };
    const notes = exempleMemoire();
    enregistrerMemoire("https://serveur-a.test", notes, stockage);
    expect(decoderMemoire(stockage.getItem(cleMemoire("https://serveur-a.test")))).toEqual(notes);
    expect(decoderMemoire(stockage.getItem(cleMemoire("https://serveur-b.test")))).toEqual([]);
    expect(decoderMemoire(stockage.getItem(cleMemoire(null)))).toEqual([]);
  });
  it("refuse d’écraser un stockage corrompu ou de version inconnue", () => {
    for (const brut of ["{", '{"version":2,"notes":[]}', '{"version":1,"notes":[{}]}']) {
      let ecrit = false;
      expect(() => enregistrerMemoire(null, [], { getItem: () => brut, setItem: () => { ecrit = true; } })).toThrow();
      expect(ecrit).toBe(false);
    }
  });
  it("propage les échecs de stockage au formulaire sans prétendre avoir enregistré", () => {
    expect(() => enregistrerMemoire(null, exempleMemoire(), { getItem: () => null, setItem: () => { throw new Error("quota"); } })).toThrow("quota");
  });
  it("trace uniquement les liens explicites, déduplique les deux sens, ignore les liens orphelins", () => {
    const [a, b] = exempleMemoire();
    expect(aretesMemoire([{ ...a, liens: [b.id, a.id, "absent"] }, { ...b, liens: [a.id] }])).toEqual([[a.id, b.id].sort()]);
    const retirees = sansNote(exempleMemoire(), "memoire");
    expect(retirees.some((n) => n.id === "memoire" || n.liens.includes("memoire"))).toBe(false);
  });
  it("cherche sans tenir compte des accents et conserve les notes isolées dans le graphe", () => {
    const notes = exempleMemoire();
    expect(chercherMemoire(notes, "memoire").has("memoire")).toBe(true);
    expect(chercherMemoire(notes, "introuvable").size).toBe(0);
    const points = placerMemoire(notes);
    expect(points).toEqual(placerMemoire(notes));
    expect(Object.keys(points)).toHaveLength(notes.length);
    expect(Object.values(points).every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
});
