import { describe, expect, it } from "vitest";
import type { SanteMcpLieu } from "@/lib/bridge";
import { defautsMcp, depuisLe, lectureValide, libelleEtat, verificationsRatees } from "@/lib/sante-mcp";

const lieux: SanteMcpLieu[] = [
  {
    lieu: null,
    sante: { entrees: [{ agent: "dev", mcp: "sentry", etat: "echec", distant: true, depuis: 20 }, { agent: "dev", mcp: "ok", etat: "connecte", distant: true, depuis: 1 }], verifieLe: 30, enCours: false, erreurs: [{ agent: "iris", message: "Claude Code n'a pas répondu à temps." }] },
    erreur: null,
  },
  {
    lieu: "https://vps.exemple.ts.net",
    sante: { entrees: [{ agent: "camille", mcp: "qonto-mcp", etat: "authentification", distant: true, depuis: 10 }], verifieLe: 30, enCours: false, erreurs: [] },
    erreur: null,
  },
  { lieu: "https://autre.exemple.ts.net", sante: null, erreur: "Serveur injoignable." },
];

describe("veille des MCP vue par l'écran", () => {
  it("les défauts de tous les lieux, le plus ancien d'abord", () => {
    expect(defautsMcp(lieux).map((d) => [d.lieu, d.agent, d.mcp])).toEqual([
      ["https://vps.exemple.ts.net", "camille", "qonto-mcp"],
      [null, "dev", "sentry"],
    ]);
  });

  it("ce qui n'a pas pu être vérifié", () => {
    expect(verificationsRatees(lieux)).toEqual([
      { lieu: null, message: "iris : Claude Code n'a pas répondu à temps." },
      { lieu: "https://autre.exemple.ts.net", message: "Serveur injoignable." },
    ]);
  });

  it("libellés et dates", () => {
    expect(libelleEtat("authentification")).toBe("Connexion expirée");
    const maintenant = new Date(2026, 10, 9, 17, 30).getTime();
    expect(depuisLe(new Date(2026, 10, 9, 14, 5).getTime(), maintenant)).toBe("depuis 14 h 05");
    expect(depuisLe(new Date(2026, 10, 8, 18, 30).getTime(), maintenant)).toBe("depuis hier, 18 h 30");
    expect(depuisLe(new Date(2026, 10, 6, 9, 0).getTime(), maintenant)).toMatch(/^depuis le 6 nov\.?, 9 h 00$/);
  });

  it("une lecture mal formée est ignorée", () => {
    expect(lectureValide({})).toBeNull();
    expect(lectureValide([{ lieu: 3 }])).toBeNull();
    expect(lectureValide(lieux)).toBe(lieux);
  });
});
