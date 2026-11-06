// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { FeuilleModele } from "@/components/telephone/ComposeurFil";
import type { EtatMoteur } from "@/lib/moteurs";

/* La feuille du téléphone se pose dans un portail : ici, son contenu seul. */
vi.mock("@/components/telephone/Feuille", () => ({
  Feuille: ({ titre, children, pied }: { titre: string; children: ReactNode; pied?: ReactNode }) => <section><h2>{titre}</h2>{children}{pied}</section>,
  MenuFeuille: () => null,
}));

const SECOND = "11111111-1111-4111-8111-111111111111";
const claude: EtatMoteur = {
  moteur: { id: "claude", nom: "Claude Code", fournisseur: "Claude", chemin: "installe", gere: false, installable: false },
  compte: { connecte: true, installe: true, chemin: "installe", version: "test", methode: "claude.ai", email: "agents@exemple.test", organisation: null, abonnement: "max", verifieLe: 0 },
  modeles: [], erreur: null,
};
const comptes = [
  { id: "poste", email: "agents@exemple.test", abonnement: "max", poste: true },
  { id: SECOND, email: "second@exemple.test", abonnement: "pro", poste: false },
];
const groupe = (html: string) => {
  const zone = html.split('aria-label="Compte Claude"')[1]?.split('role="radiogroup"')[0] ?? "";
  return [...zone.matchAll(/role="radio" aria-checked="(true|false)" title="([^"]+)"/g)].map((m) => [m[2], m[1] === "true"]);
};

describe("le téléphone choisit le compte Claude de la conversation", () => {
  test("avec deux comptes connectés : la section Compte, celui de la conversation coché", () => {
    const html = renderToStaticMarkup(<FeuilleModele actuel={{ modele: "opus", effort: "high", compteClaude: SECOND }} modeleFiche="opus" moteurs={[claude]} erreur={null} comptes={comptes} onChoisir={vi.fn()} onFermer={vi.fn()} />);
    expect(html).toContain("Modèle, compte et effort");
    expect(groupe(html)).toEqual([["agents@exemple.test", false], ["second@exemple.test", true]]);
    /* Les boutons touchables du téléphone. */
    expect(html.split('aria-label="Compte Claude"')[1]).toContain("min-h-11");
  });

  test("un seul compte : la feuille reste « Modèle et effort », sans choix du compte", () => {
    const html = renderToStaticMarkup(<FeuilleModele actuel={null} modeleFiche="opus" moteurs={[claude]} erreur={null} comptes={[comptes[0]]} onChoisir={vi.fn()} onFermer={vi.fn()} />);
    expect(html).toContain("Modèle et effort");
    expect(html).not.toContain('aria-label="Compte Claude"');
  });
});
