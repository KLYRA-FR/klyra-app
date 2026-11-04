// @vitest-environment node
import { describe, expect, test } from "vitest";
import { ordreBarre, type PrefBarre } from "./ordre-barre";

describe("ordre des agents, le même dans Routines et dans Chats", () => {
  const roles = [
    { id: "principal", name: "Cicco" },
    { id: "hugo", name: "Hugo" },
    { id: "iris", name: "Iris" },
    { id: "val", name: "Val" },
  ];
  const ids = (prefs: Record<string, PrefBarre> = {}) => ordreBarre(roles, (id) => prefs[id]).map((agent) => agent.id);

  test("sans ordre perso, l'ordre de base reste", () => {
    expect(ids()).toEqual(["principal", "hugo", "iris", "val"]);
  });

  test("le rang glissé dans Chats remplace l'ordre alphabétique, l'assistant reste en tête", () => {
    expect(ids({ iris: { rang: 0 }, hugo: { rang: 1 }, val: { rang: 2 } })).toEqual(["principal", "iris", "hugo", "val"]);
  });

  test("un agent sans rang suit ceux qui en ont un, dans l'ordre reçu", () => {
    expect(ids({ iris: { rang: 0 } })).toEqual(["principal", "iris", "hugo", "val"]);
  });

  test("un épinglé passe avant les autres, même si son rang est plus grand", () => {
    expect(ids({ hugo: { rang: 0 }, iris: { rang: 5, epingleLe: "2026-11-01T00:00:00.000Z" } })).toEqual([
      "principal",
      "iris",
      "hugo",
      "val",
    ]);
  });

  test("deux épinglés sans rang : le plus récemment épinglé d'abord", () => {
    expect(
      ids({
        iris: { epingleLe: "2026-11-01T00:00:00.000Z" },
        hugo: { epingleLe: "2026-11-04T00:00:00.000Z" },
      }),
    ).toEqual(["principal", "hugo", "iris", "val"]);
  });

  test("un masqué sort de la liste visible et revient à l'ordre reçu", () => {
    expect(ids({ iris: { rang: 0 }, hugo: { rang: 1, masque: true }, val: { rang: 2 } })).toEqual([
      "principal",
      "iris",
      "val",
      "hugo",
    ]);
  });

  test("une liste vide reste vide", () => {
    expect(ordreBarre([], () => undefined)).toEqual([]);
  });
});
