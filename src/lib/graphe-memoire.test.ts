import { describe, expect, it } from "vitest";
import {
  cleNom, construireGraphe, filtrerGraphe, FILTRES_VIDES, fichiersDepuisRendus, filsDepuisChats, liensDeduits, orphelins,
  placerGraphe, visiblePour, voisinDansDirection, voisins, type SourcesGraphe, type SouvenirSource,
} from "./graphe-memoire";

const souvenir = (o: Partial<SouvenirSource> & { id: string; nom: string; agent: string }): SouvenirSource => ({
  fichier: cleNom(o.nom), description: "", type: "project", date: "2026-11-08T10:00:00.000Z", chemin: `/m/${o.id}.md`,
  prive: false, projetId: null, liens: [], remplace: [], ...o,
});
const sources = (): SourcesGraphe => ({
  agents: [{ id: "principal", nom: "Cicco" }, { id: "dev", nom: "Hugo" }, { id: "designer", nom: "Iris" }],
  projets: [{ id: "p1", nom: "klyra-app", date: null }],
  souvenirs: [
    souvenir({ id: "s1", nom: "Fonctionnement modifications klyra-app", agent: "principal", description: "Chaque modification passe par une PR" }),
    souvenir({ id: "s2", nom: "github-klyra-app", agent: "principal", liens: ["fonctionnement-modifications-klyra-app"] }),
    souvenir({ id: "s3", nom: "outillage", agent: "dev", description: "Lancer typecheck lint vitest sur le serveur", projetId: "p1" }),
    souvenir({ id: "s4", nom: "secret-iris", agent: "designer", prive: true, description: "Brouillon personnel" }),
    souvenir({ id: "s5", nom: "outillage v2", agent: "dev", remplace: ["outillage"], description: "Lancer typecheck lint vitest sur le serveur" }),
  ],
  fils: filsDepuisChats([
    { id: "klyra-fil-1", title: "Refonte page Mémoire", projectId: "p1", updatedAt: "2026-11-08T10:00:00Z", fil: { roleId: "dev", creeLe: "2026-11-08T09:00:00Z" } },
    { id: "dm-dev", title: "Hugo", projectId: null, updatedAt: "2026-11-08T10:00:00Z" },
    { id: "klyra-fil-2", title: "Ancien", projectId: null, updatedAt: "2026-11-01T10:00:00Z", fil: { roleId: "dev", creeLe: "2026-11-01T09:00:00Z", supprime: true } },
  ]),
  fichiers: fichiersDepuisRendus([
    { id: "r1", titre: "Maquette", description: "Vue graphe", roleId: "designer", origine: "https://vps:8791#/atelier/designer/m.png", chemin: "", chatId: "klyra-fil-1", projectId: "p1", misAJour: "2026-11-08T11:00:00Z" },
  ]),
});

describe("graphe commun", () => {
  it("met le bon agent sur chaque nœud et relie les sources", () => {
    const g = construireGraphe(sources());
    const parId = new Map(g.noeuds.map((n) => [n.id, n]));
    expect(parId.get("s3")?.agent).toBe("dev");
    expect(parId.get("agent:principal")?.titre).toBe("Cicco");
    expect(parId.has("fil:dm-dev")).toBe(false);
    expect(parId.has("fil:klyra-fil-2")).toBe(false);
    expect(parId.get("fichier:r1")?.chemin).toBe("/atelier/designer/m.png");
    const types = (de: string, vers: string) => g.aretes.filter((a) => a.de === de && a.vers === vers).map((a) => a.type);
    expect(types("s2", "s1")).toEqual(["lien"]);
    expect(types("s5", "s3")).toEqual(["remplace"]);
    expect(types("s3", "projet:p1")).toEqual(["concerne"]);
    expect(types("fichier:r1", "fil:klyra-fil-1")).toEqual(["issu-de"]);
    expect(types("fichier:r1", "agent:designer")).toEqual(["produit-par"]);
  });

  it("cache un nœud privé hors de son agent et de Corentin", () => {
    const g = construireGraphe(sources());
    expect(visiblePour(g, null).noeuds.some((n) => n.id === "s4")).toBe(true);
    expect(visiblePour(g, "designer").noeuds.some((n) => n.id === "s4")).toBe(true);
    const dev = visiblePour(g, "dev");
    expect(dev.noeuds.some((n) => n.id === "s4")).toBe(false);
    expect(dev.aretes.some((a) => a.de === "s4" || a.vers === "s4")).toBe(false);
  });

  it("repère les orphelins et propose des liens sans les écrire", () => {
    const g = construireGraphe(sources());
    const o = orphelins(g);
    expect(o.has("s4")).toBe(true);
    expect(o.has("s1")).toBe(false);
    const d = liensDeduits(g);
    expect(d.every((a) => a.type === "deduit" && (a.confiance ?? 0) > 0)).toBe(true);
    // s3 et s5 sont déjà reliés par « remplace » : pas de suggestion en double.
    expect(d.some((a) => [a.de, a.vers].sort().join() === "s3,s5")).toBe(false);
    expect(g.aretes.some((a) => a.type === "deduit")).toBe(false);
  });

  it("filtre par agent, type, projet, période et orphelins", () => {
    const g = construireGraphe(sources());
    const dev = filtrerGraphe(g, { ...FILTRES_VIDES, agents: ["dev"] });
    expect(dev.noeuds.filter((n) => n.type === "souvenir").map((n) => n.id).sort()).toEqual(["s3", "s5"]);
    expect(dev.noeuds.some((n) => n.id === "agent:principal")).toBe(false);
    const fichiers = filtrerGraphe(g, { ...FILTRES_VIDES, types: ["fichier"] });
    expect(fichiers.noeuds.map((n) => n.id)).toEqual(["fichier:r1"]);
    const projet = filtrerGraphe(g, { ...FILTRES_VIDES, projetId: "p1" });
    expect(projet.noeuds.some((n) => n.id === "s1")).toBe(false);
    expect(projet.noeuds.some((n) => n.id === "s3")).toBe(true);
    const recents = filtrerGraphe(g, { ...FILTRES_VIDES, periode: "7j" }, Date.parse("2026-11-20T00:00:00Z"));
    expect(recents.noeuds.filter((n) => n.type !== "agent" && n.type !== "projet")).toEqual([]);
    expect(filtrerGraphe(g, { ...FILTRES_VIDES, orphelins: true }).noeuds.some((n) => n.id === "s1")).toBe(false);
    expect(voisins(g, "s1").map((v) => v.noeud.id).sort()).toEqual(["agent:principal", "s2"]);
  });

  it("place 600 nœuds vite, sans chevauchement complet et de façon stable", () => {
    const s = sources();
    for (let i = 0; i < 600; i++) {
      s.souvenirs.push(souvenir({ id: `t${i}`, nom: `test ${i} sujet${i % 37}`, agent: ["principal", "dev", "designer", "camille"][i % 4], description: `mot${i % 50} groupe${i % 50} thème${i % 13}`, liens: i ? [`test ${i - 1} sujet${(i - 1) % 37}`] : [] }));
    }
    s.agents.push({ id: "camille", nom: "Camille" });
    const t = performance.now();
    const g = construireGraphe(s);
    const d = liensDeduits(g);
    const pos = placerGraphe(g);
    const duree = performance.now() - t;
    expect(g.noeuds.length).toBeGreaterThan(600);
    expect(Object.keys(pos)).toHaveLength(g.noeuds.length);
    expect(duree).toBeLessThan(1500);
    expect(d.length).toBeGreaterThan(0);
    expect(new Set(Object.values(pos).map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`)).size).toBeGreaterThan(g.noeuds.length * 0.95);
    expect(placerGraphe(g)).toEqual(pos);
    const ids = g.noeuds.map((n) => n.id);
    expect(voisinDansDirection(pos, ids[0], "droite", ids)).not.toBeNull();
  });
});

import { chercherNoeuds, motsDe, segmentsSurlignes } from "./graphe-memoire";

describe("recherche dans le graphe", () => {
  it("classe nom, puis résumé, puis contenu, sans accent ni casse", () => {
    const g = construireGraphe(sources());
    const r = chercherNoeuds(g, "OUTILLAGE", [{ chemin: "/m/s1.md", extrait: "… voir l’outillage …", occurrences: 2 }]);
    expect(r.map((x) => [x.noeud.id, x.ou])).toEqual([["s3", "nom"], ["s5", "nom"], ["s1", "contenu"]]);
    expect(chercherNoeuds(g, "memoire refonte").map((x) => x.noeud.id)).toEqual(["fil:klyra-fil-1"]);
    expect(chercherNoeuds(g, "typecheck serveur").map((x) => x.ou)).toEqual(["resume", "resume"]);
    expect(chercherNoeuds(g, " ")).toEqual([]);
  });
  it("ne renvoie jamais un nœud privé hors du périmètre", () => {
    const g = visiblePour(construireGraphe(sources()), "dev");
    expect(chercherNoeuds(g, "brouillon", [{ chemin: "/m/s4.md", extrait: "brouillon", occurrences: 1 }])).toEqual([]);
  });
  it("surligne les mots trouvés", () => {
    expect(segmentsSurlignes("Lancer le Typecheck", motsDe("typecheck"))).toEqual([{ texte: "Lancer le ", trouve: false }, { texte: "Typecheck", trouve: true }]);
    expect(segmentsSurlignes("Mémoire", motsDe("memoire"))).toEqual([{ texte: "Mémoire", trouve: true }]);
  });
});

import { propositionsEntretien } from "./graphe-memoire";

describe("entretien", () => {
  it("signale doublons d'un même agent et souvenirs obsolètes, sans rien appliquer", () => {
    const s = sources();
    s.souvenirs.push(
      souvenir({ id: "d1", nom: "Outillage", agent: "dev", date: "2026-11-01T00:00:00.000Z", description: "autre" }),
      souvenir({ id: "d2", nom: "Charte couleurs studio", agent: "designer", description: "palette bleue typographie studio" }),
      souvenir({ id: "d3", nom: "Charte couleurs studio v2", agent: "designer", description: "palette bleue typographie studio", date: "2026-11-09T00:00:00.000Z" }),
      souvenir({ id: "d4", nom: "Charte couleurs studio", agent: "dev", description: "palette bleue typographie studio" }),
      souvenir({ id: "vieux", nom: "Ancien chantier", agent: "camille", date: "2026-06-01T00:00:00.000Z" }),
    );
    const g = construireGraphe(s);
    const { doublons, obsoletes } = propositionsEntretien(g, Date.parse("2026-11-08T12:00:00Z"));
    const paires = doublons.map((d) => [d.garder.id, d.retirer.id, d.raison.split(" ")[0]]);
    expect(paires).toContainEqual(["s3", "d1", "Même"]);
    expect(paires).toContainEqual(["d3", "d2", "Titre"]);
    // Deux agents différents : pas de fusion proposée.
    expect(paires.some(([a, b]) => [a, b].includes("d4"))).toBe(false);
    expect(obsoletes.map((o) => [o.noeud.id, o.raison.split(" ")[0]])).toEqual([["s3", "Remplacé"], ["vieux", "Souvenir"]]);
    expect(g.noeuds.length).toBe(construireGraphe(s).noeuds.length);
  });
});
