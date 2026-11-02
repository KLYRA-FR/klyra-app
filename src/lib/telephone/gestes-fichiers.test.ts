// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import type { ContenuFichier, Reponse } from "@/lib/bridge";
import type { FileNode, Project } from "@/types/domain";
import { gestesFichiers, type DependancesFichiers } from "./gestes-fichiers";

const site: Project = {
  id: "site",
  name: "Site",
  subtitle: "Refonte",
  status: "en-cours",
  pinned: false,
  roleIds: ["principal"],
  brief: "Le brief",
  previewUrl: "",
  folder: "/Users/moi/site",
  files: [],
  updatedAt: "2026-10-01T10:00:00.000Z",
};
const vps: Project = { ...site, id: "vps", folder: "/var/lib/klyra/projets/vps", lieu: "https://vps.klyra.fr" };

function monter(surcharges: Partial<DependancesFichiers> = {}) {
  const pont = {
    arbre: vi.fn(async (): Promise<Reponse<FileNode[]>> => ({
      ok: true,
      data: [
        { name: "src", path: "src", kind: "dossier" },
        { name: "README.md", path: "README.md", kind: "fichier" },
      ],
    })),
    lireFichier: vi.fn(async (): Promise<Reponse<ContenuFichier>> => ({ ok: true, data: { type: "texte", texte: "# Site", taille: 6 } })),
    ouvrirFichier: vi.fn(async (): Promise<Reponse<void>> => ({ ok: true, data: undefined })),
  };
  const enregistrer = vi.fn();
  const publier = vi.fn(async () => null);
  const gestes = gestesFichiers({
    projets: [site, vps],
    pont,
    modifies: () => new Set(["src/app/page.tsx"]),
    enregistrer,
    publier,
    ton: "ton Mac",
    ...surcharges,
  });
  return { gestes, pont, enregistrer, publier };
}

describe("fichiers.arbre", () => {
  test("le dossier vient du projet de l'ordinateur, jamais de la demande", async () => {
    const { gestes, pont } = monter();
    const niveau = await gestes["fichiers.arbre"]({ projetId: "site", chemin: "./src//app", dossier: "/etc" });
    expect(pont.arbre).toHaveBeenCalledWith("/Users/moi/site", "src/app", null);
    expect(niveau).toMatchObject({ total: 2, elements: [{ nom: "src", contientModifies: true }, { nom: "README.md", modifie: false }] });
  });

  test("la racine du projet ; un projet d'un VPS passe par l'app de bureau", async () => {
    const { gestes, pont } = monter();
    await gestes["fichiers.arbre"]({ projetId: "site", chemin: "" });
    expect(pont.arbre).toHaveBeenLastCalledWith("/Users/moi/site", undefined, null);
    await gestes["fichiers.arbre"]({ projetId: "vps", chemin: "docs" });
    expect(pont.arbre).toHaveBeenLastCalledWith("/var/lib/klyra/projets/vps", "docs", "https://vps.klyra.fr");
  });

  test.each(["..", "../../etc", "/etc", "C:\\Windows", "src/../../x"])("%s est refusé avant toute lecture", async (chemin) => {
    const { gestes, pont } = monter();
    await expect(gestes["fichiers.arbre"]({ projetId: "site", chemin })).rejects.toMatchObject({ code: "chemin", message: "Ce chemin n’est pas dans le projet." });
    expect(pont.arbre).not.toHaveBeenCalled();
  });

  test("un dossier disparu est dit en clair, sans chemin de l'ordinateur", async () => {
    const { gestes } = monter({
      pont: {
        arbre: async () => ({ ok: false, code: "erreur", message: "ENOENT: no such file or directory, scandir '/Users/moi/site/a'" }),
        lireFichier: async () => ({ ok: false, code: "erreur", message: "" }),
        ouvrirFichier: async () => ({ ok: false, code: "erreur", message: "" }),
      },
    });
    await expect(gestes["fichiers.arbre"]({ projetId: "site", chemin: "a" })).rejects.toMatchObject({ code: "introuvable", message: "Ce dossier n’existe plus sur ton Mac." });
  });

  test("projet inconnu, demande illisible, pas d'app de bureau", async () => {
    await expect(monter().gestes["fichiers.arbre"]({ projetId: "autre", chemin: "" })).rejects.toMatchObject({ code: "introuvable" });
    await expect(monter().gestes["fichiers.arbre"]("site")).rejects.toMatchObject({ code: "arguments" });
    await expect(monter().gestes["fichiers.arbre"]({ projetId: "site" })).rejects.toMatchObject({ code: "arguments" });
    await expect(monter({ pont: null }).gestes["fichiers.arbre"]({ projetId: "site", chemin: "" })).rejects.toMatchObject({ code: "bureau" });
  });
});

describe("fichiers.lire et fichiers.ouvrir", () => {
  test("un fichier du projet, prêt à afficher", async () => {
    const { gestes, pont } = monter();
    await expect(gestes["fichiers.lire"]({ projetId: "site", chemin: "README.md" })).resolves.toEqual({ contenu: { type: "texte", texte: "# Site", taille: 6 }, surPoste: true });
    expect(pont.lireFichier).toHaveBeenCalledWith("/Users/moi/site", "README.md", null);
    await expect(gestes["fichiers.lire"]({ projetId: "vps", chemin: "a.md" })).resolves.toMatchObject({ surPoste: false });
  });

  test("ni la racine ni un chemin hors du projet ne se lisent", async () => {
    const { gestes, pont } = monter();
    await expect(gestes["fichiers.lire"]({ projetId: "site", chemin: "" })).rejects.toMatchObject({ code: "chemin" });
    await expect(gestes["fichiers.lire"]({ projetId: "site", chemin: "../.ssh/id_ed25519" })).rejects.toMatchObject({ code: "chemin" });
    expect(pont.lireFichier).not.toHaveBeenCalled();
  });

  test("ouvrir : un document oui, un programme ou un fichier du VPS non", async () => {
    const { gestes, pont } = monter();
    await expect(gestes["fichiers.ouvrir"]({ projetId: "site", chemin: "docs/devis.pdf" })).resolves.toBeNull();
    expect(pont.ouvrirFichier).toHaveBeenCalledWith("/Users/moi/site", "docs/devis.pdf");
    await expect(gestes["fichiers.ouvrir"]({ projetId: "site", chemin: "outils/lancer.command" })).rejects.toMatchObject({ code: "type" });
    await expect(gestes["fichiers.ouvrir"]({ projetId: "vps", chemin: "devis.pdf" })).rejects.toMatchObject({ code: "vps" });
    await expect(gestes["fichiers.ouvrir"]({ projetId: "site", chemin: "../devis.pdf" })).rejects.toMatchObject({ code: "chemin" });
    expect(pont.ouvrirFichier).toHaveBeenCalledTimes(1);
  });
});

describe("projets.modifier", () => {
  test("nom, ligne, brief, statut, épingle ; le dossier ne bouge pas", async () => {
    const { gestes, enregistrer, publier } = monter();
    const rendu = await gestes["projets.modifier"]({ projetId: "site", nom: " Site KLYRA ", accroche: "Refonte 2026", brief: "Nouveau", statut: "en-revue", epingle: true, folder: "/etc" });
    expect(rendu).toEqual({ nom: "Site KLYRA", accroche: "Refonte 2026", brief: "Nouveau", statut: "en-revue", epingle: true });
    expect(enregistrer).toHaveBeenCalledWith(expect.objectContaining({ id: "site", name: "Site KLYRA", folder: "/Users/moi/site", status: "en-revue", pinned: true }));
    expect(publier).toHaveBeenCalledTimes(1);
  });

  test("un nom vide, un statut inconnu ou une épingle mal formée sont refusés", async () => {
    const { gestes, enregistrer } = monter();
    const base = { projetId: "site", nom: "Site", accroche: "", brief: "", statut: "en-cours", epingle: false };
    await expect(gestes["projets.modifier"]({ ...base, nom: "  " })).rejects.toMatchObject({ message: "Donne-lui un nom." });
    await expect(gestes["projets.modifier"]({ ...base, statut: "archive" })).rejects.toMatchObject({ code: "arguments" });
    await expect(gestes["projets.modifier"]({ ...base, epingle: "oui" })).rejects.toMatchObject({ code: "arguments" });
    expect(enregistrer).not.toHaveBeenCalled();
  });

  test("projets.lire rend ce qui se modifie", async () => {
    await expect(monter().gestes["projets.lire"]({ projetId: "site" })).resolves.toEqual({ nom: "Site", accroche: "Refonte", brief: "Le brief", statut: "en-cours", epingle: false });
  });
});
