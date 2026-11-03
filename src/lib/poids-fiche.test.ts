import { describe, expect, it } from "vitest";
import { AGENT_TEMPLATES } from "@/data/agent-templates.generated";
import { parseAgentFile } from "@/lib/agent-file";
import { CARACTERES_PAR_JETON as CARACTERES_DIAGNOSTIC } from "../../electron/diagnostic-poste";
import { aideFiche, CARACTERES_PAR_JETON, jetonsEstimes, SEUIL_FICHE_LONGUE } from "./poids-fiche";

describe("poids d'une fiche", () => {
  it("la même estimation que le diagnostic du poste", () => {
    expect(CARACTERES_PAR_JETON).toBe(CARACTERES_DIAGNOSTIC);
  });

  it("une fiche vide : seulement le format", () => {
    expect(aideFiche("")).not.toMatch(/jetons/);
  });

  it("le poids estimé, et un conseil au-delà du seuil", () => {
    const courte = "# Nina — Juridique\n\nJe relis les contrats.";
    expect(aideFiche(courte)).toMatch(/Environ \d+ jetons, relus à chaque appel/);
    expect(aideFiche(courte)).not.toMatch(/Une fiche courte coûte moins/);
    const longue = "x".repeat(Math.ceil(SEUIL_FICHE_LONGUE * CARACTERES_PAR_JETON) + 10);
    expect(jetonsEstimes(longue)).toBeGreaterThan(SEUIL_FICHE_LONGUE);
    expect(aideFiche(longue)).toMatch(/Une fiche courte coûte moins/);
    // Une version suivie : la raccourcir en ferait une copie privée, donc pas de conseil.
    expect(aideFiche(longue, false)).not.toMatch(/Une fiche courte coûte moins/);
  });

  it("les modèles KLYRA ne grossissent pas : aucun au-delà de deux fois le seuil", () => {
    const poids = AGENT_TEMPLATES.map((t) => jetonsEstimes(parseAgentFile(t.content).body));
    expect(Math.max(...poids)).toBeLessThan(SEUIL_FICHE_LONGUE * 2);
  });
});
