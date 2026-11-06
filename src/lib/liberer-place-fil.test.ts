import { describe, expect, it } from "vitest";
import { libererPlaceFil } from "@/lib/liberer-place-fil";

/** Faux journal : une place par fil ouvert, rendue quand le travail passe « cancelled » (comme `changerStatut`). */
function journal(capacite: number, fils: string[], refus: Record<string, string> = {}) {
  const occupes = new Set(fils);
  const appels: { filId: string; status: string }[] = [];
  return {
    appels,
    placesLibres: () => capacite - occupes.size,
    marquer: async (filId: string, status: string) => {
      appels.push({ filId, status });
      if (refus[filId]) return { ok: true as const, data: { ok: false, motif: refus[filId] } };
      if (status === "cancelled" || status === "done") occupes.delete(filId);
      return { ok: true as const, data: { ok: true } };
    },
  };
}

describe("libererPlaceFil", () => {
  it("rend la place d'un fil archivé ou supprimé : placesLibres remonte", async () => {
    const j = journal(3, ["a", "b", "c"]);
    expect(j.placesLibres()).toBe(0);
    expect(await libererPlaceFil(j.marquer, "a")).toEqual({ libere: true });
    expect(j.placesLibres()).toBe(1);
    expect(j.appels).toEqual([{ filId: "a", status: "cancelled" }]);
  });

  it("un refus (operations_a_verifier) est rendu sans lever d'erreur", async () => {
    const j = journal(3, ["a"], { a: "operations_a_verifier" });
    expect(await libererPlaceFil(j.marquer, "a")).toEqual({ libere: false, motif: "operations_a_verifier" });
    expect(j.placesLibres()).toBe(2);
  });

  it("sans journal ou IPC en échec : rien ne casse", async () => {
    expect(await libererPlaceFil(undefined, "a")).toEqual({ libere: false, motif: "journal_absent" });
    expect(await libererPlaceFil(async () => { throw new Error("ipc"); }, "a")).toEqual({ libere: false, motif: "ipc" });
    expect(await libererPlaceFil(async () => ({ ok: false, code: "x", message: "y" }), "a")).toEqual({ libere: false, motif: "x" });
  });
});
