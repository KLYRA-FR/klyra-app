import { describe, expect, test, vi } from "vitest";
import { ErreurPoste } from "@/lib/poste/types";
import type { Artefact, Rendu } from "@/types/domain";
import { filtrerArtefacts, gestesArtefacts, imageApercu, type DepsArtefacts, type ListeArtefacts } from "./gestes-artefacts";

function poste() {
  const artefacts: Artefact[] = [
    { id: "a1", titre: "Design system", url: "https://claude.ai/artifact/abc-123", description: "", projectId: null, ajouteLe: "2026-10-01T10:00:00Z" },
    { id: "a2", titre: "Propale", url: "https://claude.ai/artifact/def-456", description: "Devis", projectId: "p1", ajouteLe: "2026-10-30T10:00:00Z" },
  ];
  const rendu = (id: string, patch: Partial<Rendu>): Rendu => ({
    id,
    chemin: `/maison/.klyra/rendus/dev/${id}.html`,
    origine: `/maison/projets/${id}.html`,
    taille: 10,
    titre: `Rendu ${id}`,
    description: "",
    type: "page",
    roleId: "dev",
    chatId: null,
    projectId: "p1",
    ajouteLe: "2026-10-01T10:00:00Z",
    misAJour: "2026-10-02T10:00:00Z",
    ...patch,
  });
  const rendus: Rendu[] = [
    rendu("page", {}),
    rendu("video", { type: "video", chemin: "/maison/.klyra/rendus/dev/film.mp4", misAJour: "2026-10-03T10:00:00Z", roleId: "ancien" }),
    rendu("vps", { chemin: "", origine: "https://vps.example.test#/klyra/page.html", distantId: "d1" }),
  ];
  const deps = {
    rendus: () => rendus,
    claude: () => true,
    nomAgent: (id: string) => (id === "dev" ? "Léon" : null),
    vignetteRendu: vi.fn(async () => "data:image/png;base64,AAAA"),
    ouvrirRendu: vi.fn(async () => undefined),
    retirerPartage: vi.fn(async () => undefined),
    retirerRendu: vi.fn(),
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

  test("les rendus de ce PC seulement, sans chemin à lire ; ceux d'un serveur sont comptés, pas mêlés", async () => {
    const { gestes } = poste();
    const liste = (await gestes["artefacts.liste"]({})) as ListeArtefacts;
    expect(liste.rendus.map((r) => [r.id, r.agent, r.projet, r.apercu])).toEqual([
      ["video", "Agent indisponible", "Bizwhoo", false],
      ["page", "Léon", "Bizwhoo", true],
    ]);
    expect(liste.rendusServeur).toBe(1);
    expect(JSON.stringify(liste)).not.toContain("/maison");
    expect(JSON.stringify(liste)).not.toContain("vps.example.test");
  });

  test("source claude.ai éteinte sur l'ordinateur : ses liens ne se lisent pas ici non plus", async () => {
    const { deps } = poste();
    const liste = (await gestesArtefacts({ ...deps, claude: () => false })["artefacts.liste"]({})) as ListeArtefacts;
    expect(liste.claude).toBe(false);
    expect(liste.artefacts).toEqual([]);
    expect(liste.rendus).toHaveLength(2);
  });

  test("aperçu : une image de l'ordinateur ; sans aperçu possible, null ; jamais un rendu d'un serveur", async () => {
    const { gestes, deps } = poste();
    expect(await gestes["rendus.apercu"]({ id: "page" })).toEqual({ image: "data:image/png;base64,AAAA" });
    expect(await gestes["rendus.apercu"]({ id: "video" })).toEqual({ image: null });
    expect((await refus(gestes["rendus.apercu"]({ id: "vps" }))).code).toBe("introuvable");
    expect(deps.vignetteRendu).toHaveBeenCalledTimes(1);
    expect(imageApercu("http://localhost:3000/page")).toBeNull();
    expect(imageApercu("data:text/html;base64,AAAA")).toBeNull();
    expect(imageApercu("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(imageApercu("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  test("ouvrir : sur l'ordinateur, une erreur dite sans chemin ; retirer : le partage part avant la copie, l'échec garde le rendu", async () => {
    const { gestes, deps } = poste();
    await gestes["rendus.ouvrir"]({ id: "page" });
    expect(deps.ouvrirRendu).toHaveBeenCalledWith("/maison/.klyra/rendus/dev/page.html");
    deps.ouvrirRendu.mockRejectedValueOnce(new Error("/maison/.klyra/rendus/dev/page.html introuvable"));
    const erreur = await refus(gestes["rendus.ouvrir"]({ id: "page" }));
    expect(erreur.message).toBe("Ce rendu n’a pas pu s’ouvrir sur ton Mac.");

    deps.retirerPartage.mockRejectedValueOnce(new ErreurPoste("compte", "Le compte ne répond pas."));
    expect((await refus(gestes["rendus.retirer"]({ id: "page" }))).code).toBe("compte");
    expect(deps.retirerRendu).not.toHaveBeenCalled();
    await gestes["rendus.retirer"]({ id: "page" });
    expect(deps.retirerPartage).toHaveBeenLastCalledWith("/maison/projets/page.html");
    expect(deps.retirerRendu).toHaveBeenCalledWith("page");
    expect((await refus(gestes["rendus.retirer"]({ id: "vps" }))).code).toBe("introuvable");
  });

  test("le filtre : titre et description, projet choisi ; effacé, tout revient", () => {
    const liste = [
      { titre: "Simulateur de devis", description: "", projetId: "p1" },
      { titre: "Carte", description: "Les devis de la semaine", projetId: "p2" },
      { titre: "Grille", description: "", projetId: null },
    ];
    expect(filtrerArtefacts(liste, "DEVIS", "").map((a) => a.titre)).toEqual(["Simulateur de devis", "Carte"]);
    expect(filtrerArtefacts(liste, "devis", "p2").map((a) => a.titre)).toEqual(["Carte"]);
    expect(filtrerArtefacts(liste, " ", "")).toHaveLength(3);
  });
});
