// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ContenuChoixModele } from "@/components/chat/ContenuChoixModele";
import type { EtatMoteur } from "@/lib/moteurs";
import { comptesPourTelephone, lireModelesTelephone } from "./modeles";

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

describe("choix du compte Claude sur le téléphone", () => {
  const SECOND = "11111111-1111-4111-8111-111111111111";
  const compte = (id: string, poste: boolean, plus: Record<string, unknown> = {}) => ({
    id, poste, connecte: true, installe: true, chemin: "/secret/claude", version: "2", methode: "claude.ai", email: `${id}@exemple.test`, organisation: "Org", abonnement: "max", verifieLe: 0, ...plus,
  });

  test("seuls les comptes connectés passent, réduits à ce qu'il faut pour choisir (sans chemin)", () => {
    const lus = comptesPourTelephone([compte(SECOND, false), compte("poste", true), compte("22222222-2222-4222-8222-222222222222", false, { connecte: false }),
      compte("33333333-3333-4333-8333-333333333333", false, { erreur: "illisible" }), compte("../x", false), compte("poste", false)]);
    expect(lus).toEqual([
      { id: "poste", email: "poste@exemple.test", abonnement: "max", poste: true },
      { id: SECOND, email: `${SECOND}@exemple.test`, abonnement: "max", poste: false },
    ]);
    expect(JSON.stringify(lus)).not.toContain("/secret");
    expect(comptesPourTelephone(null)).toEqual([]);
  });

  test("sur un VPS : les comptes du serveur et le compte gardé pour la conversation", async () => {
    const adresse = "https://vps.exemple.test";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/moteurs")) return Response.json({ moteurs: [moteur("claude").moteur] });
      if (url.endsWith("/moteurs/claude/comptes")) return Response.json({ comptes: [compte("poste", true), compte(SECOND, false)] });
      if (url.endsWith("/compte")) return Response.json({ compte: moteur("claude").compte });
      if (url.endsWith("/espace/lire")) return Response.json({ resultat: { compteClaudeTelephone: true, elements: [{ type: "conversation", id: "dm-cicco", valeur: { chat: { modele: "opus", effort: "high", compteClaude: SECOND } } }] } });
      throw new Error("Route inattendue");
    }));
    const lu = await lireModelesTelephone(adresse, "dm-cicco", new AbortController().signal);
    expect(lu.comptes?.map((c) => c.id)).toEqual(["poste", SECOND]);
    expect(lu.choix).toEqual({ fournisseur: "claude", modele: "opus", effort: "high", compteClaude: SECOND });
  });

  test("un serveur qui ne fait pas répondre le compte choisi ne le propose pas", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/moteurs")) return Response.json({ moteurs: [] });
      if (url.endsWith("/moteurs/claude/comptes")) return Response.json({ comptes: [compte("poste", true), compte(SECOND, false)] });
      if (url.endsWith("/espace/lire")) return Response.json({ resultat: { elements: [] } });
      throw new Error("Route inattendue");
    }));
    expect((await lireModelesTelephone("https://vps.exemple.test", "dm-cicco", new AbortController().signal)).comptes).toEqual([]);
  });
});
