import { describe, expect, it } from "vitest";
import type { TerminalAgent } from "@/lib/bridge";
import { etatTerminal, memeListe, terminalAffiche } from "./terminal";

const s = (id: string, ouvertLe: number, fini = false, code: number | null = null): TerminalAgent => ({ id, conversation: "c", agent: "camille", titre: id, commande: "", dossier: "/", ouvertLe, fini, code });

describe("terminal (écran)", () => {
  it("montre le terminal choisi, sinon le plus récent qui tourne", () => {
    const liste = [s("a", 1), s("b", 3, true, 0), s("c", 2)];
    expect(terminalAffiche(liste, "b")?.id).toBe("b");
    expect(terminalAffiche(liste, "disparu")?.id).toBe("c");
    expect(terminalAffiche([s("b", 3, true, 0)], null)?.id).toBe("b");
    expect(terminalAffiche([], null)).toBeNull();
  });
  it("dit l'état en mots", () => {
    expect(etatTerminal(s("a", 1))).toBe("En cours");
    expect(etatTerminal(s("a", 1, true, 0))).toBe("Terminé");
    expect(etatTerminal(s("a", 1, true, 2))).toBe("Terminé (code 2)");
  });
  it("ne rend pas deux fois la même liste", () => {
    expect(memeListe([s("a", 1)], [s("a", 1)])).toBe(true);
    expect(memeListe([s("a", 1)], [s("a", 1, true, 0)])).toBe(false);
  });
});
