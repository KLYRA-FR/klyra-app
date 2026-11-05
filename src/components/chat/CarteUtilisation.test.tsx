// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CompteClaudeLocal } from "@/lib/bridge";
import { UtilisationRail } from "./CarteUtilisation";

const etat = vi.hoisted(() => ({ lieu: null as string | null, comptes: [] as CompteClaudeLocal[], demandes: [] as [string | null, boolean][] }));
vi.mock("@/lib/lieux", () => ({ useLieuActif: () => etat.lieu }));
vi.mock("@/lib/moteurs", () => ({
  pret: () => true,
  useMoteurs: () => ({ moteurs: [{ moteur: { id: "claude" }, compte: { connecte: true }, modeles: null, erreur: null }] }),
}));
vi.mock("@/lib/compte-claude", () => ({
  useComptesClaudeConnectes: (lieu: string | null, actif: boolean) => {
    etat.demandes.push([lieu, actif]);
    return etat.comptes;
  },
}));

const compte = (id: string, poste: boolean): CompteClaudeLocal => ({
  id, poste, installe: true, connecte: true, chemin: "claude", version: "2.1.318",
  email: `${id}@example.test`, abonnement: "max", organisation: null, methode: "claude.ai", verifieLe: 1,
});
const boutons = (html: string) => [...html.matchAll(/aria-label="(Utilisation de [^"]+)"/g)].map((m) => m[1].replace(/&#x27;/g, "'"));

describe("anneaux d'utilisation du rail", () => {
  beforeEach(() => { etat.lieu = null; etat.comptes = []; etat.demandes = []; });

  test("un seul compte : un anneau Claude, comme avant", () => {
    etat.comptes = [compte("poste", true)];
    const liste = boutons(renderToStaticMarkup(<UtilisationRail />));
    expect(liste).toEqual(["Utilisation de Claude, pas encore lue. Mettre à jour"]);
  });

  test("un compte ajouté : son propre anneau, chacun nommé par son adresse", () => {
    etat.comptes = [compte("poste", true), compte("second", false)];
    const liste = boutons(renderToStaticMarkup(<UtilisationRail />));
    expect(liste).toEqual([
      "Utilisation de Claude (poste@example.test), pas encore lue. Mettre à jour",
      "Utilisation de Claude (second@example.test), pas encore lue. Mettre à jour",
    ]);
  });

  test("sur un VPS, ce sont les comptes de ce serveur qui sont demandés", () => {
    etat.lieu = "https://vps.example.test";
    etat.comptes = [compte("poste", true), compte("autre", false)];
    expect(boutons(renderToStaticMarkup(<UtilisationRail />))).toHaveLength(2);
    expect(etat.demandes.at(-1)).toEqual(["https://vps.example.test", true]);
  });
});
