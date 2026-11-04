import { describe, expect, it } from "vitest";
import { TAILLE_MAX_TOTALE, TAILLE_MAX_VUE, cleVue, effacerVues, garderVue, libelleVue, lireVue, type Stock } from "./vue-gardee";

/** Un `localStorage` en mémoire ; `plafond` simule un stockage plein. */
function stockFictif(plafond = Infinity): Stock & { donnees: Map<string, string> } {
  const donnees = new Map<string, string>();
  return {
    donnees,
    get length() {
      return donnees.size;
    },
    key: (i) => [...donnees.keys()][i] ?? null,
    getItem: (cle) => donnees.get(cle) ?? null,
    setItem: (cle, valeur) => {
      const total = [...donnees].reduce((s, [c, v]) => s + (c === cle ? 0 : v.length), 0);
      if (total + valeur.length > plafond) throw new Error("QuotaExceededError");
      donnees.set(cle, valeur);
    },
    removeItem: (cle) => void donnees.delete(cle),
  };
}

describe("vue gardée", () => {
  it("garde et relit une lecture, par compte, poste, lecture et arguments", () => {
    const stock = stockFictif();
    const cle = cleVue("camille", "poste-1", "routines.liste", '{"agentId":"basile"}');
    expect(garderVue(cle, { routines: [1, 2] }, 1000, stock)).toBe(true);
    expect(lireVue(cle, stock)).toEqual({ data: { routines: [1, 2] }, lu: 1000 });
    expect(lireVue(cleVue("sam", "poste-1", "routines.liste", '{"agentId":"basile"}'), stock)).toBeNull();
    expect(lireVue(cleVue("camille", "poste-2", "routines.liste", '{"agentId":"basile"}'), stock)).toBeNull();
    expect(lireVue(cleVue("camille", "poste-1", "routines.liste", "{}"), stock)).toBeNull();
  });

  it("ne garde pas une vue trop grande, et retire l'ancienne de la même clé", () => {
    const stock = stockFictif();
    const cle = cleVue("camille", "p", "fichiers.lire", "{}");
    garderVue(cle, "petit", 1, stock);
    expect(garderVue(cle, "x".repeat(TAILLE_MAX_VUE + 1), 2, stock)).toBe(false);
    expect(lireVue(cle, stock)).toBeNull();
  });

  it("retire les vues les plus anciennes au-delà du total, ou quand le stockage est plein", () => {
    const stock = stockFictif();
    const gros = "x".repeat(Math.floor(TAILLE_MAX_TOTALE / 4) + 1000);
    garderVue("klyra:vue:a", gros, 1, stock);
    garderVue("klyra:vue:b", gros, 2, stock);
    garderVue("klyra:vue:c", gros, 3, stock);
    expect(stock.getItem("klyra:vue:a")).not.toBeNull();
    garderVue("klyra:vue:d", gros, 4, stock);
    expect(stock.getItem("klyra:vue:a")).toBeNull();
    expect(lireVue("klyra:vue:b", stock)?.lu).toBe(2);
    expect(lireVue("klyra:vue:d", stock)?.lu).toBe(4);

    const plein = stockFictif(250);
    garderVue("klyra:vue:a", "y".repeat(100), 1, plein);
    garderVue("klyra:vue:b", "y".repeat(100), 2, plein);
    expect(garderVue("klyra:vue:c", "y".repeat(100), 3, plein)).toBe(true);
    expect(plein.getItem("klyra:vue:a")).toBeNull();
    expect(plein.getItem("klyra:vue:b")).not.toBeNull();
  });

  it("efface tout à la déconnexion, et les autres comptes quand le compte change", () => {
    const stock = stockFictif();
    stock.setItem("klyra:telephone:poste", "garde");
    garderVue(cleVue("camille", "p", "t", "{}"), 1, 1, stock);
    garderVue(cleVue("sam", "p", "t", "{}"), 1, 1, stock);
    effacerVues(stock, "camille");
    expect(lireVue(cleVue("camille", "p", "t", "{}"), stock)).not.toBeNull();
    expect(lireVue(cleVue("sam", "p", "t", "{}"), stock)).toBeNull();
    effacerVues(stock);
    expect([...stock.donnees.keys()]).toEqual(["klyra:telephone:poste"]);
  });

  it("ignore une valeur illisible", () => {
    const stock = stockFictif();
    stock.setItem("klyra:vue:x", "{pas du json");
    expect(lireVue("klyra:vue:x", stock)).toBeNull();
    expect(lireVue("klyra:vue:x", null)).toBeNull();
  });

  it("date la vue comme le bureau : aujourd'hui, hier, ou le jour", () => {
    const maintenant = new Date(2026, 10, 4, 20, 0).getTime();
    expect(libelleVue(new Date(2026, 10, 4, 18, 42).getTime(), maintenant)).toBe("Vue à 18:42");
    expect(libelleVue(new Date(2026, 10, 3, 18, 42).getTime(), maintenant)).toBe("Vue hier à 18:42");
    expect(libelleVue(new Date(2026, 10, 2, 8, 5).getTime(), maintenant, "Vus")).toBe("Vus le 2 nov. à 08:05");
  });
});
