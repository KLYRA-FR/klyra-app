// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { ContenuChoixModele } from "./ContenuChoixModele";
import type { CompteClaudeLocal } from "@/lib/bridge";
import type { EtatMoteur } from "@/lib/moteurs";

const claude: EtatMoteur = {
  moteur: { id: "claude", nom: "Claude Code", fournisseur: "Claude", chemin: "installe", gere: false, installable: false },
  compte: { connecte: true, installe: true, chemin: "installe", version: "test", methode: "claude.ai", email: "agents@exemple.test", organisation: null, abonnement: "max", verifieLe: 0 },
  modeles: [], erreur: null,
};
const opus = { id: "opus", nom: "Claude Opus 5.5", efforts: ["high"], effortParDefaut: "high", parDefaut: true };
const compte = (id: string, email: string, poste = false): CompteClaudeLocal => ({
  ...claude.compte!, id, email, poste, abonnement: poste ? "max" : "pro",
});
const SECOND = "11111111-1111-4111-8111-111111111111";

function rendre(comptes: CompteClaudeLocal[], choisi: string | null) {
  return renderToStaticMarkup(<ContenuChoixModele vue="claude" moteur="claude" modele="opus" effort="high" modeleFiche="opus"
    moteurs={[claude]} modelesVue={[opus]} modelesActuels={[opus]} recherche="" connexion={null}
    onVue={vi.fn()} onRecherche={vi.fn()} onModele={vi.fn()} onEffort={vi.fn()} onConnecter={vi.fn()} onAjouter={vi.fn()}
    comptes={comptes} compte={choisi} onCompte={vi.fn()} />);
}

/** Les lignes du choix du compte, dans l'ordre : adresse et coche. */
const lignesCompte = (html: string) => {
  const groupe = html.split('aria-label="Compte Claude"')[1]?.split('role="radiogroup"')[0] ?? "";
  return [...groupe.matchAll(/role="radio" aria-checked="(true|false)" title="([^"]+)"/g)].map((m) => [m[2], m[1] === "true"]);
};

describe("choix du compte Claude d'une conversation", () => {
  test("un seul compte connecté : pas de choix, l'adresse reste dans l'en-tête", () => {
    const html = rendre([compte("poste", "agents@exemple.test", true)], null);
    expect(html).not.toContain('aria-label="Compte Claude"');
    expect(html).toContain("Claude · agents@exemple.test");
  });

  test("plusieurs comptes : chacun avec son adresse, celui des agents coché par défaut", () => {
    const comptes = [compte("poste", "agents@exemple.test", true), compte(SECOND, "second@exemple.test")];
    const html = rendre(comptes, null);
    expect(html).toContain('aria-label="Compte Claude"');
    expect(lignesCompte(html)).toEqual([["agents@exemple.test", true], ["second@exemple.test", false]]);
    expect(html).toContain(">agents</span>");
    expect(html).toContain(">Pro</span>");
    expect(lignesCompte(rendre(comptes, SECOND))).toEqual([["agents@exemple.test", false], ["second@exemple.test", true]]);
  });

  test("un compte choisi qui n'est plus connecté est signalé, aucun n'est coché", () => {
    const html = rendre([compte("poste", "agents@exemple.test", true), compte(SECOND, "second@exemple.test")], "22222222-2222-4222-8222-222222222222");
    expect(lignesCompte(html)).toEqual([["agents@exemple.test", false], ["second@exemple.test", false]]);
    expect(html).toContain("n’est plus connecté");
  });
});
