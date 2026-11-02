import { describe, expect, test, vi } from "vitest";
import { ErreurPoste } from "@/lib/poste/types";
import type { Artefact } from "@/types/domain";
import { gestesArtefacts, type DepsArtefacts } from "./gestes-artefacts";

function poste() {
  const artefacts: Artefact[] = [
    { id: "a1", titre: "Design system", url: "https://claude.ai/artifact/abc-123", description: "", projectId: null, ajouteLe: "2026-10-01T10:00:00Z" },
    { id: "a2", titre: "Propale", url: "https://claude.ai/artifact/def-456", description: "Devis", projectId: "p1", ajouteLe: "2026-10-30T10:00:00Z" },
  ];
  const deps = {
    ton: "ton Mac",
    artefacts: () => artefacts,
    projets: () => [{ id: "p1", name: "Bizwhoo" }],
    synchroniser: async () => ({ total: 2, nouveaux: 0 }),
    modifier: vi.fn(),
    supprimer: vi.fn(),
    ajouter: vi.fn(),
    session: async () => false,
    vignette: async () => null,
  } satisfies DepsArtefacts;
  return { deps, gestes: gestesArtefacts(deps) };
}

async function refus(promesse: Promise<unknown>): Promise<ErreurPoste> {
  const erreur = await promesse.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erreur).toBeInstanceOf(ErreurPoste);
  return erreur as ErreurPoste;
}

describe("gestes « artefacts » (T-20)", () => {
  test("la liste : les plus récents d'abord, avec le nom du projet", async () => {
    const { gestes } = poste();
    const liste = (await gestes["artefacts.liste"]({})) as { artefacts: { id: string; projet: string | null }[] };
    expect(liste.artefacts.map((a) => [a.id, a.projet])).toEqual([
      ["a2", "Bizwhoo"],
      ["a1", null],
    ]);
  });

  test("coller un lien : seulement claude.ai/artifact, sans doublon", async () => {
    const { deps, gestes } = poste();
    expect((await refus(gestes["artefacts.ajouter"]({ url: "https://exemple.fr/artifact/x", titre: "X", projetId: null }))).code).toBe("invalide");
    expect((await refus(gestes["artefacts.ajouter"]({ url: "https://claude.ai/artifact/abc-123/", titre: "X", projetId: null }))).message).toBe("Cet artefact est déjà dans la liste.");
    expect((await refus(gestes["artefacts.ajouter"]({ url: "https://claude.ai/artifact/nouveau", titre: "X", projetId: "inconnu" }))).code).toBe("arguments");
    await gestes["artefacts.ajouter"]({ url: "https://claude.ai/artifact/nouveau", titre: "Nouveau", projetId: "p1" });
    expect(deps.ajouter).toHaveBeenCalledWith({ url: "https://claude.ai/artifact/nouveau", titre: "Nouveau", description: "", projectId: "p1", source: "manuel" });
  });

  test("modifier ou retirer : seulement un artefact de la liste", async () => {
    const { deps, gestes } = poste();
    expect((await refus(gestes["artefacts.retirer"]({ id: "inconnu" }))).code).toBe("introuvable");
    await gestes["artefacts.modifier"]({ id: "a1", titre: "Design system KLYRA", description: "Les tokens", projetId: null });
    expect(deps.modifier).toHaveBeenCalledWith("a1", { titre: "Design system KLYRA", titrePerso: true, description: "Les tokens", projectId: null });
  });

  test("refaire les aperçus sans session claude.ai : « Aperçu indisponible »", async () => {
    const { gestes } = poste();
    expect((await refus(gestes["artefacts.apercus"]({}))).message).toContain("Aperçu indisponible");
  });
});
