import { describe, expect, it } from "vitest";
import { gestesMemoire } from "./gestes-memoire";

/** Un faux bureau : ce que `appelerCerveau` rendrait pour chaque action, et les appels reçus. */
function bureau(reponses: Record<string, (args: Record<string, unknown>) => unknown>) {
  const appels: { lieu: string | null; action: string; args: Record<string, unknown> }[] = [];
  const gestes = gestesMemoire({
    appeler: async <T,>(lieu: string | null, action: string, args: Record<string, unknown>) => {
      appels.push({ lieu, action, args });
      const f = reponses[action];
      if (!f) throw new Error("Action de mémoire inconnue.");
      return f(args) as T;
    },
    nomAgent: (id) => ({ dev: "Hugo", redac: "Lou" })[id] ?? null,
  });
  return { gestes, appels };
}

const souvenir = { id: "souvenir:dev:1", nom: "Client Acme", agent: "dev", type: "project", resume: "Livraison le vendredi", date: "2026-11-08T10:00:00.000Z", projet: null };

describe("gestes mémoire du téléphone", () => {
  it("chercher réunit notes et souvenirs, dans l'espace choisi, avec le nom des agents", async () => {
    const { gestes, appels } = bureau({
      chercher: () => ({ elements: [{ id: "p-1", titre: "rapport.pdf", extrait: "Projet Orion", origine: "document importé", lignes: [1, 3] }] }),
      "graphe-lire": () => ({ resultats: [{ ...souvenir, trouveDans: "contenu", extrait: "…Jeanne…" }] }),
    });
    const r = await gestes["memoire.chercher"]({ lieu: "https://srv.exemple", requete: " acme " });
    expect(r).toEqual({
      requete: "acme",
      notes: [{ id: "p-1", titre: "rapport.pdf", extrait: "Projet Orion", origine: "document importé", historique: false }],
      souvenirs: [{ id: "souvenir:dev:1", nom: "Client Acme", agent: "dev", nomAgent: "Hugo", type: "project", resume: "Livraison le vendredi", date: "2026-11-08T10:00:00.000Z", projet: null, trouveDans: "contenu", extrait: "…Jeanne…" }],
      manques: [],
    });
    expect(appels.map((a) => [a.lieu, a.action])).toEqual([["https://srv.exemple", "chercher"], ["https://srv.exemple", "graphe-lire"]]);
  });

  it("un serveur d'avant le graphe : les notes quand même, et le manque dit en clair", async () => {
    const { gestes } = bureau({ chercher: () => ({ elements: [] }) });
    const r = (await gestes["memoire.chercher"]({ lieu: "https://srv.exemple", requete: "acme" })) as { manques: string[] };
    expect(r.manques).toEqual(["Souvenirs des agents : Ce serveur doit être mis à jour pour lire le graphe des souvenirs (relancer son installation)."]);
  });

  it("refuse une demande illisible ou trop courte", async () => {
    const { gestes } = bureau({});
    await expect(gestes["memoire.chercher"]({ lieu: null, requete: "a" })).rejects.toThrow("deux lettres");
    await expect(gestes["memoire.chercher"]("x")).rejects.toThrow("illisible");
  });

  it("lire un souvenir rend son texte et ses liens, sans chemin", async () => {
    const { gestes } = bureau({
      "graphe-lire": (a) => (a.souvenir ? { trouve: true, souvenir, texte: "Livraison le vendredi.", tronque: false, voisins: [{ relation: "Cite", id: "souvenir:redac:2", nom: "Ton", agent: "redac" }] } : { souvenirs: [], total: 0, tronque: false }),
    });
    const r = await gestes["memoire.souvenir"]({ lieu: null, id: "souvenir:dev:1" });
    expect(r).toMatchObject({ texte: "Livraison le vendredi.", voisins: [{ relation: "Cite", id: "souvenir:redac:2", nom: "Ton", nomAgent: "Lou" }] });
    expect(JSON.stringify(r)).not.toMatch(/\/home|\.claude/);
  });

  it("un passage disparu entre-temps est dit, pas inventé", async () => {
    const { gestes } = bureau({ lire: () => ({ elements: [] }) });
    await expect(gestes["memoire.lire"]({ lieu: null, id: "p-ancien" })).rejects.toThrow("a changé");
  });
});
