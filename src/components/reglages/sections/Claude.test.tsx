// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CompteClaudeLocal } from "@/lib/bridge";
import { ComptesClaude } from "./Claude";

const etat = vi.hoisted(() => ({
  comptes: [] as CompteClaudeLocal[] | null,
  action: null as { id: string; type: string } | null,
  erreur: null as string | null,
  relire: vi.fn(), agir: vi.fn(),
}));
vi.mock("@/lib/compte-claude", () => ({ useComptesClaude: () => etat, nomAbonnement: (s: string) => s === "max" ? "Max" : "Pro" }));
vi.mock("@/components/chat/CarteUtilisation", () => ({ CarteUtilisation: () => null }));
vi.mock("@/lib/sons/sons", () => ({ jouer: () => {} }));

const compte = (id: string, poste: boolean): CompteClaudeLocal => ({
  id, poste, installe: true, connecte: true, chemin: "claude", version: "2.1.318",
  email: `${id}@example.test`, abonnement: "max", organisation: "Équipe fictive", methode: "claude.ai", verifieLe: 1,
});
const rendu = () => renderToStaticMarkup(<ComptesClaude />).replace(/&#x27;/g, "'");

describe("comptes Claude dans les réglages du poste", () => {
  beforeEach(() => { etat.comptes = [compte("poste", true), compte("second", false)]; etat.action = null; etat.erreur = null; });

  test("deux comptes connectés, deux vérifications, deux déconnexions et un ajout", () => {
    const html = rendu();
    expect(html).toContain('aria-label="poste@example.test"');
    expect(html).toContain('aria-label="second@example.test"');
    expect(html.match(/>Se déconnecter</g)).toHaveLength(2);
    expect(html.match(/>Vérifier</g)).toHaveLength(2);
    expect(html).toContain("Ajouter un compte Claude");
    expect(html.match(/Compte utilisé par les agents/g)).toHaveLength(1);
    expect(html).not.toContain("Clé Admin");
  });

  test("déconnecter le second laisse le premier connecté et utilisé par les agents", () => {
    etat.comptes![1].connecte = false;
    const html = rendu();
    expect(html.match(/>Se déconnecter</g)).toHaveLength(1);
    expect(html.match(/>Se connecter</g)).toHaveLength(1);
    expect(html).toContain("Compte utilisé par les agents");
    expect(html).toContain("Pas connecté");
  });

  test("une vérification impossible garde les autres comptes et ne prétend pas à une déconnexion", () => {
    etat.comptes![1] = { ...compte("second", false), connecte: false, erreur: "Impossible de vérifier ce compte Claude." };
    const html = rendu();
    expect(html).toContain("Vérification impossible");
    expect(html).not.toContain("Pas connecté");
    expect(html).not.toContain(">Se connecter<");
    expect(html.match(/>Vérifier</g)).toHaveLength(2);
    expect(html).toContain("Ajouter un compte Claude");
  });

  test("une connexion en cours indique l'attente et empêche les mutations concurrentes", () => {
    etat.action = { id: "nouveau", type: "connexion" };
    const html = rendu();
    expect(html).toContain('role="status"');
    expect(html).toContain("En attente du navigateur…");
    expect(html.match(/disabled=""/g)).toHaveLength(5);
  });

  test("une erreur de lecture offre de réessayer", () => {
    etat.comptes = null;
    etat.erreur = "Lecture impossible";
    expect(rendu()).toContain("Réessayer");
  });
});
