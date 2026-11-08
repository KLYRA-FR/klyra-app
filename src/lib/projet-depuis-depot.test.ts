import { describe, expect, test } from "vitest";
import { depotsTrouves, detailsDepot, identifiantProjet, projetDepuisDepot, projetDuDepot } from "@/lib/projet-depuis-depot";
import type { Project } from "@/types/domain";

const depot = { nom: "KLYRA-FR/klyra-app", prive: true, branche: "main", archive: false, description: "Agents IA Klyra", site: "https://app.klyra.fr/", langage: "TypeScript", pousseLe: "2026-11-08T10:00:00.000Z" };
const projet = (p: Partial<Project>): Project => ({ id: "x", name: "x", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "", previewUrl: "", folder: "/x", files: [], updatedAt: "2026-11-01T00:00:00.000Z", ...p });

describe("projetDepuisDepot", () => {
  test("tout vient de GitHub : nom, ligne de description, aperçu, dépôt", () => {
    const { projet: p, existant } = projetDepuisDepot({ depot, branche: "main", dossier: "/home/c/KLYRA/GitHub/KLYRA-FR/klyra-app-abc", lieu: null, projets: [], maintenant: new Date("2026-11-08T12:00:00Z") });
    expect(existant).toBe(false);
    expect(p).toMatchObject({ id: "klyra-app", name: "klyra-app", subtitle: "Agents IA Klyra", brief: "", previewUrl: "https://app.klyra.fr", depot: "KLYRA-FR/klyra-app", githubConnecte: true, roleIds: ["principal"] });
    expect(p.lieu).toBeUndefined();
  });
  test("sur un serveur : le lieu suit ; sans description ni site : rien d'inventé", () => {
    const { projet: p } = projetDepuisDepot({ depot: { ...depot, description: null, site: null }, branche: "main", dossier: "/var/lib/klyra/projets/GitHub/a", lieu: "https://vps.exemple.fr", projets: [] });
    expect(p).toMatchObject({ subtitle: "", previewUrl: "", lieu: "https://vps.exemple.fr" });
  });
  test("une autre branche que celle par défaut se voit dans le nom ; l'identifiant reste unique", () => {
    const { projet: p } = projetDepuisDepot({ depot, branche: "dev", dossier: "/b", lieu: null, projets: [projet({ id: "klyra-app-dev" })] });
    expect(p.name).toBe("klyra-app (dev)");
    expect(p.id).toBe("klyra-app-dev-2");
  });
  test("le même dossier sur la même machine : le projet existant est rouvert, pas de doublon", () => {
    const deja = projet({ id: "mon-app", folder: "/a", depot: "KLYRA-FR/klyra-app" });
    expect(projetDepuisDepot({ depot, branche: "main", dossier: "/a", lieu: null, projets: [deja] })).toEqual({ projet: deja, existant: true });
    expect(projetDepuisDepot({ depot, branche: "main", dossier: "/a", lieu: "https://vps.exemple.fr", projets: [deja] }).existant).toBe(false);
  });
});

test("projetDuDepot : seulement sur la machine affichée", () => {
  const pc = projet({ id: "pc", depot: "a/b", githubConnecte: true });
  const vps = projet({ id: "vps", depot: "a/b", lieu: "https://vps.exemple.fr", githubConnecte: true });
  expect(projetDuDepot("a/b", null, [vps, pc])?.id).toBe("pc");
  expect(projetDuDepot("a/b", "https://vps.exemple.fr", [pc, vps])?.id).toBe("vps");
  expect(projetDuDepot("a/c", null, [pc])).toBeUndefined();
});

test("identifiantProjet : accents et signes retirés", () => {
  expect(identifiantProjet("Équipe Été !", [])).toBe("equipe-ete");
  expect(identifiantProjet("", [])).toBe("projet");
});

describe("depotsTrouves", () => {
  const liste = [
    { ...depot, nom: "a/vieux", description: null, pousseLe: "2025-01-01T00:00:00.000Z" },
    { ...depot, nom: "a/archive", archive: true, pousseLe: "2026-11-08T11:00:00.000Z" },
    { ...depot, nom: "a/recent", description: "Site de l’Été", pousseLe: "2026-11-07T00:00:00.000Z" },
  ];
  test("les plus récents d'abord, les archivés à la fin", () => {
    expect(depotsTrouves(liste, "").map((d) => d.nom)).toEqual(["a/recent", "a/vieux", "a/archive"]);
  });
  test("recherche dans le nom et la description, sans accent ni casse", () => {
    expect(depotsTrouves(liste, "SITE ete").map((d) => d.nom)).toEqual(["a/recent"]);
    expect(depotsTrouves(liste, "vieux").map((d) => d.nom)).toEqual(["a/vieux"]);
    expect(depotsTrouves(liste, "introuvable")).toEqual([]);
  });
  test("un dépôt d'un ancien serveur, sans infos : gardé dans l'ordre reçu", () => {
    const anciens = [{ nom: "a/un", prive: false, branche: "main", archive: false }, { nom: "a/deux", prive: false, branche: "main", archive: false }];
    expect(depotsTrouves(anciens, "").map((d) => d.nom)).toEqual(["a/un", "a/deux"]);
  });
});

test("detailsDepot : privé, langage et dernière modification", () => {
  const maintenant = new Date("2026-11-08T15:00:00");
  expect(detailsDepot({ ...depot, pousseLe: new Date("2026-11-08T09:00:00").toISOString() }, maintenant)).toBe("Privé · TypeScript · modifié aujourd’hui");
  expect(detailsDepot({ ...depot, pousseLe: new Date("2026-11-07T09:00:00").toISOString() }, maintenant)).toBe("Privé · TypeScript · modifié hier");
  expect(detailsDepot({ nom: "a/b", prive: false, branche: "", archive: true })).toBe("Archivé · Vide");
});
