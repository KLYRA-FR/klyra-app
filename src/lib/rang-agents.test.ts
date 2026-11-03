// @vitest-environment node
import { describe, expect, test } from "vitest";
import { decaler, deplacer, trierParRang } from "./rang-agents";

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

  test("trier par rang, les agents sans rang à la suite dans leur ordre", () => {
    const rangs: Record<string, number> = { sam: 0, hugo: 1 };
    const liste = ordre.map((id) => ({ id }));
    expect(trierParRang(liste, (id) => rangs[id]).map((r) => r.id)).toEqual(["sam", "hugo", "iris", "val"]);
  });
});
