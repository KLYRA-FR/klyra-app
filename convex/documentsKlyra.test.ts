import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { connecter, initialiser, nouvelEssai, type Essai } from "./test.utils";

/** Deux comptes fictifs : A dépose, B est un autre membre. */
async function deuxComptes(t: Essai) {
  await initialiser(t, [{ email: "a@essai.klyra", nom: "Alice" }]);
  const a = await connecter(t, "a@essai.klyra");
  await a.mutation(api.equipe.inviter, { email: "b@essai.klyra", nom: "Bruno", role: "membre" });
  const b = await connecter(t, "b@essai.klyra");
  return { a, b };
}

type Client = Awaited<ReturnType<typeof deuxComptes>>["a"];

async function deposer(t: Essai, contenu = "<p>Bonjour</p>", type = "text/html"): Promise<Id<"_storage">> {
  return await t.run((ctx) => ctx.storage.store(new Blob([contenu], { type })));
}

const existe = (t: Essai, fichier: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", fichier)) !== null);

async function enregistrer(t: Essai, c: Client, fichier: Id<"_storage">, origine = "/tmp/page.html") {
  return await c.mutation(api.documentsKlyra.enregistrer, { fichier, titre: "  Page   une ", description: "Notes", origine, agent: "iris" });
}

describe("documents KLYRA", () => {
  test("un document enregistré est privé : seul son auteur le voit, et il compte dans l'espace", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const id = await enregistrer(t, a, await deposer(t, "<p>secret</p>"));
    const mes = await a.query(api.documentsKlyra.listerMes, {});
    expect(mes.documents).toHaveLength(1);
    expect(mes.documents[0]).toMatchObject({
      _id: id,
      titre: "Page une",
      description: "Notes",
      agent: "iris",
      visibilite: "prive",
      version: 1,
      deMoi: true,
      auteur: { nom: "Alice", actif: true },
    });
    expect(mes.documents[0].taille).toBeGreaterThan(0);
    expect(await b.query(api.documentsKlyra.listerMes, {})).toMatchObject({ documents: [] });
    expect(await b.query(api.documentsKlyra.listerEquipe, {})).toMatchObject({ documents: [] });
    await expect(b.query(api.documentsKlyra.lire, { documentId: id })).rejects.toThrow(/introuvable/);
    const url = await a.query(api.documentsKlyra.lire, { documentId: id });
    expect(url.url).toContain("http");
    const espaceB = await b.query(api.documentsKlyra.espace, {});
    expect(espaceB).toEqual({ octets: mes.documents[0].taille, nombre: 1, complet: true });
  });

  test("seul l'auteur le partage, le reprend ou le supprime", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const fichier = await deposer(t);
    const id = await enregistrer(t, a, fichier);
    await expect(b.mutation(api.documentsKlyra.partager, { documentId: id })).rejects.toThrow(/reserve_a_l_auteur/);
    await a.mutation(api.documentsKlyra.partager, { documentId: id });
    expect((await b.query(api.documentsKlyra.listerEquipe, {})).documents[0]).toMatchObject({ _id: id, visibilite: "equipe", deMoi: false });
    expect((await b.query(api.documentsKlyra.lire, { documentId: id })).url).toContain("http");
    await expect(b.mutation(api.documentsKlyra.reprendre, { documentId: id })).rejects.toThrow(/reserve_a_l_auteur/);
    await a.mutation(api.documentsKlyra.reprendre, { documentId: id });
    expect(await b.query(api.documentsKlyra.listerEquipe, {})).toMatchObject({ documents: [] });
    await expect(b.query(api.documentsKlyra.lire, { documentId: id })).rejects.toThrow(/introuvable/);
    await expect(b.mutation(api.documentsKlyra.supprimer, { documentId: id })).rejects.toThrow(/reserve_a_l_auteur/);
    await a.mutation(api.documentsKlyra.supprimer, { documentId: id });
    expect(await existe(t, fichier)).toBe(false);
    expect(await a.query(api.documentsKlyra.espace, {})).toEqual({ octets: 0, nombre: 0, complet: true });
    await expect(a.mutation(api.documentsKlyra.supprimer, { documentId: id })).rejects.toThrow(/introuvable/);
    await expect(a.query(api.documentsKlyra.lire, { documentId: id })).rejects.toThrow(/introuvable/);
  });

  test("réenregistrer le même original remplace le fichier et garde la visibilité", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const premier = await deposer(t, "<p>v1</p>");
    const id = await enregistrer(t, a, premier);
    await a.mutation(api.documentsKlyra.partager, { documentId: id });
    const second = await deposer(t, "<p>v2 plus long</p>");
    const encore = await enregistrer(t, a, second);
    expect(encore).toBe(id);
    const vu = (await b.query(api.documentsKlyra.listerEquipe, {})).documents[0];
    expect(vu).toMatchObject({ _id: id, version: 2, visibilite: "equipe" });
    expect(vu.taille).toBeGreaterThan((await t.run(async (ctx) => (await ctx.db.system.get("_storage", premier))?.size ?? 0)));
    expect(await existe(t, premier)).toBe(false);
    expect(await existe(t, second)).toBe(true);
  });

  test("refuse ce qui n'est pas un HTML, un titre vide ou une description trop longue", async () => {
    const t = nouvelEssai();
    const { a } = await deuxComptes(t);
    const image = await deposer(t, "pas html", "image/png");
    await expect(enregistrer(t, a, image)).rejects.toThrow(/document_invalide/);
    const html = await deposer(t);
    await expect(enregistrer(t, a, html, "")).rejects.toThrow(/document_invalide/);
    const autre = await deposer(t);
    await expect(
      a.mutation(api.documentsKlyra.enregistrer, { fichier: autre, titre: "Page", description: "x".repeat(501), origine: "/tmp/a.html", agent: null }),
    ).rejects.toThrow(/description_trop_longue/);
    const agent = await deposer(t);
    await expect(
      a.mutation(api.documentsKlyra.enregistrer, { fichier: agent, titre: "Page", description: "", origine: "/tmp/a.html", agent: "Iris" }),
    ).rejects.toThrow(/document_invalide/);
    expect(await a.query(api.documentsKlyra.espace, {})).toEqual({ octets: 0, nombre: 0, complet: true });
  });

  test("réservé aux membres connectés", async () => {
    const t = nouvelEssai();
    const { a } = await deuxComptes(t);
    const id = await enregistrer(t, a, await deposer(t));
    await expect(t.query(api.documentsKlyra.listerMes, {})).rejects.toThrow(/non_connecte/);
    await expect(t.query(api.documentsKlyra.listerEquipe, {})).rejects.toThrow(/non_connecte/);
    await expect(t.query(api.documentsKlyra.espace, {})).rejects.toThrow(/non_connecte/);
    await expect(t.query(api.documentsKlyra.lire, { documentId: id })).rejects.toThrow(/non_connecte/);
    await expect(t.mutation(api.documentsKlyra.preparerDepot, {})).rejects.toThrow(/non_connecte/);
  });
});
