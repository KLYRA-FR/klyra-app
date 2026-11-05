// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ContenuChoixModele } from "@/components/chat/ContenuChoixModele";
import type { EtatMoteur } from "@/lib/moteurs";
import { lireModelesTelephone } from "./modeles";

vi.mock("@/lib/serveur-vps", () => ({ jetonAppareil: () => "acces-fictif" }));

const modele = { id: "modele-fictif", nom: "Modèle de test", efforts: ["low", "high", "ultra"], effortParDefaut: "high", parDefaut: true };
const moteur = (id: string, chemin: string | null = "installe"): EtatMoteur => ({
  moteur: { id, nom: id, fournisseur: id, chemin, gere: false, installable: false },
  compte: { connecte: true, installe: true, chemin: "installe", version: "test", methode: "compte", email: null, organisation: null, abonnement: null, verifieLe: 0 },
  modeles: [modele], erreur: null,
});

afterEach(() => vi.unstubAllGlobals());

describe("choix de modèle partagé bureau et téléphone", () => {
  test("fournisseurs installés à gauche, modèles de la vue à droite, efforts annoncés seulement", () => {
    const html = renderToStaticMarkup(<ContenuChoixModele tactile vue="codex" moteur="codex" modele={modele.id} effort="ultra" modeleFiche="opus"
      moteurs={[moteur("claude"), moteur("codex"), moteur("grok", null)]} modelesVue={[modele]} modelesActuels={[modele]}
      recherche="" connexion={null} onVue={vi.fn()} onRecherche={vi.fn()} onModele={vi.fn()} onEffort={vi.fn()} onConnecter={vi.fn()} onAjouter={vi.fn()} />);
    expect(html).toContain('aria-label="Fournisseurs" aria-orientation="vertical"');
    expect(html).toContain('title="ChatGPT"');
    expect(html).not.toContain('title="Grok"');
    expect(html).toContain("Modèle de test");
    expect(html).toContain('title="Ultra"');
    expect(html).not.toContain('title="Max"');
    expect(html).not.toContain("Claude Opus");
  });
  test("le catalogue et le choix sont lus sur la machine du fil sans bridge Electron", async () => {
    const adresse = "https://vps.exemple.test";
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/moteurs")) return Response.json({ moteurs: [moteur("claude").moteur, moteur("codex").moteur] });
      if (url.endsWith("/compte")) return Response.json({ compte: moteur("codex").compte });
      if (url.endsWith("/modeles")) return Response.json({ modeles: [modele] });
      if (url.endsWith("/espace/lire")) return Response.json({ resultat: { elements: [{ type: "conversation", id: "dm-cicco", valeur: { chat: { fournisseur: "codex", modele: modele.id, effort: "ultra" } } }] } });
      throw new Error("Route inattendue");
    });
    vi.stubGlobal("fetch", fetcher);
    const lu = await lireModelesTelephone(adresse, "dm-cicco", new AbortController().signal);
    expect(lu.moteurs.find((m) => m.moteur.id === "codex")?.modeles).toEqual([modele]);
    expect(lu.choix).toEqual({ fournisseur: "codex", modele: modele.id, effort: "ultra" });
    expect(fetcher).toHaveBeenCalledWith(`${adresse}/klyra/v1/moteurs/codex/modeles`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer acces-fictif" }) }));
    expect(fetcher.mock.calls.every(([url]) => url.startsWith(adresse))).toBe(true);
  });
});
