import { describe, expect, test } from "vitest";
import { agentPartageable, lieuDuRendu, renduDansEspace, texteEspace } from "./rendus-espace";

const VPS = "https://vps.exemple";

describe("espace d'un rendu", () => {
  test("un chemin de ce PC n'est pas un document du VPS", () => {
    expect(lieuDuRendu("/home/a/.klyra/rendus/iris/page.html")).toBeNull();
    expect(renduDansEspace("/tmp/page.html", null)).toBe(true);
    expect(renduDansEspace("/tmp/page.html", VPS)).toBe(false);
  });

  test("un livrable de VPS n'apparaît que dans cet espace", () => {
    const origine = `${VPS}#/root/klyra/page.html`;
    expect(lieuDuRendu(origine)).toBe(VPS);
    expect(renduDansEspace(origine, VPS)).toBe(true);
    expect(renduDansEspace(origine, null)).toBe(false);
    expect(renduDansEspace(origine, "https://autre.exemple")).toBe(false);
  });

  test("un agent sans identifiant valable ne part pas dans le partage", () => {
    expect(agentPartageable("iris")).toBe("iris");
    expect(agentPartageable("Iris")).toBeNull();
    expect(agentPartageable("")).toBeNull();
    expect(agentPartageable(null)).toBeNull();
  });

  test("l'espace affiché est un chiffre, et un minimum quand la lecture s'arrête", () => {
    expect(texteEspace(0, true)).toBe("Espace du compte : 0 o");
    expect(texteEspace(1536, true)).toBe("Espace du compte : 1,5 Ko");
    expect(texteEspace(2 * 1024 * 1024, false)).toBe("Espace du compte : au moins 2 Mo");
  });
});
