import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { connecter, initialiser, nouvelEssai, type Essai } from "./test.utils";

/** Deux comptes fictifs : A partage, B est un autre membre. */
async function deuxComptes(t: Essai) {
  await initialiser(t, [{ email: "a@essai.klyra", nom: "Alice" }]);
  const a = await connecter(t, "a@essai.klyra");
  await a.mutation(api.equipe.inviter, { email: "b@essai.klyra", nom: "Bruno", role: "membre" });
  const b = await connecter(t, "b@essai.klyra");
  return { a, b };
}

type Client = Awaited<ReturnType<typeof deuxComptes>>["a"];

const PC = null;
const VPS = "https://vps.exemple";

async function deposer(t: Essai, contenu = "<p>Bonjour</p>", type = "text/html"): Promise<Id<"_storage">> {
  return await t.run((ctx) => ctx.storage.store(new Blob([contenu], { type })));
}

const existe = (t: Essai, fichier: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", fichier)) !== null);

async function partager(t: Essai, c: Client, fichier: Id<"_storage">, lieu: string | null = PC, origine = "/tmp/page.html") {
  return await c.mutation(api.documentsKlyra.partager, {
    fichier,
    titre: "  Page   une ",
    description: "Notes",
    origine,
    agent: "iris",
    lieu,
  });
}

describe("documents KLYRA", () => {
  test("un partage sur ce PC est invisible depuis le VPS, et l'autre membre le lit ici", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const id = await partager(t, a, await deposer(t, "<p>secret</p>"));
    const ici = await a.query(api.documentsKlyra.lister, { lieu: PC });
    expect(ici.lieu).toBeNull();
    expect(ici.documents).toHaveLength(1);
    expect(ici.documents[0]).toMatchObject({
      _id: id,
      titre: "Page une",
      description: "Notes",
      agent: "iris",
      lieu: null,
      version: 1,
      deMoi: true,
      origine: "/tmp/page.html",
      auteur: { nom: "Alice", actif: true },
    });
    expect(ici.documents[0].taille).toBeGreaterThan(0);
    expect(await b.query(api.documentsKlyra.lister, { lieu: PC })).toMatchObject({
      documents: [expect.objectContaining({ _id: id, deMoi: false, lieu: null, origine: null })],
    });
    expect(await a.query(api.documentsKlyra.lister, { lieu: VPS })).toMatchObject({ lieu: VPS, documents: [] });
    expect(await b.query(api.documentsKlyra.lister, { lieu: VPS })).toMatchObject({ documents: [] });
    await expect(a.query(api.documentsKlyra.lire, { documentId: id, lieu: VPS })).rejects.toThrow(/introuvable/);
    await expect(b.query(api.documentsKlyra.lire, { documentId: id, lieu: VPS })).rejects.toThrow(/introuvable/);
    expect((await b.query(api.documentsKlyra.lire, { documentId: id, lieu: PC })).url).toContain("http");
    const espace = await b.query(api.documentsKlyra.espace, {});
    expect(espace).toEqual({ octets: ici.documents[0].taille, nombre: 1, complet: true });
  });

  test("un partage sur le VPS n'apparaît pas dans la liste de ce PC", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const id = await partager(t, a, await deposer(t, "<p>serveur</p>"), VPS, "/srv/page.html");
    expect((await b.query(api.documentsKlyra.lister, { lieu: VPS })).documents[0]).toMatchObject({ _id: id, lieu: VPS, deMoi: false });
    expect(await a.query(api.documentsKlyra.lister, { lieu: PC })).toMatchObject({ documents: [] });
    await expect(b.query(api.documentsKlyra.lire, { documentId: id, lieu: PC })).rejects.toThrow(/introuvable/);
    expect((await a.query(api.documentsKlyra.lire, { documentId: id, lieu: VPS })).url).toContain("http");
  });

  test("seul l'auteur reprend ou supprime, et seulement dans le bon espace", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const fichier = await deposer(t);
    const id = await partager(t, a, fichier);
    await expect(b.mutation(api.documentsKlyra.reprendre, { documentId: id, lieu: PC })).rejects.toThrow(/reserve_a_l_auteur/);
    await expect(a.mutation(api.documentsKlyra.reprendre, { documentId: id, lieu: VPS })).rejects.toThrow(/introuvable/);
    expect((await b.query(api.documentsKlyra.lister, { lieu: PC })).documents).toHaveLength(1);
    await a.mutation(api.documentsKlyra.reprendre, { documentId: id, lieu: PC });
    expect(await b.query(api.documentsKlyra.lister, { lieu: PC })).toMatchObject({ documents: [] });
    expect(await existe(t, fichier)).toBe(false);
    await expect(b.query(api.documentsKlyra.lire, { documentId: id, lieu: PC })).rejects.toThrow(/introuvable/);

    const autre = await deposer(t);
    const deux = await partager(t, a, autre);
    await expect(b.mutation(api.documentsKlyra.supprimer, { documentId: deux, lieu: PC })).rejects.toThrow(/reserve_a_l_auteur/);
    await a.mutation(api.documentsKlyra.supprimer, { documentId: deux, lieu: PC });
    expect(await existe(t, autre)).toBe(false);
    expect(await a.query(api.documentsKlyra.espace, {})).toEqual({ octets: 0, nombre: 0, complet: true });
    await expect(a.mutation(api.documentsKlyra.supprimer, { documentId: deux, lieu: PC })).rejects.toThrow(/introuvable/);
  });

  test("partager deux fois le même document dans le même espace donne une seule carte, et l'auteur connecté se voit de soi", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const origine = "/tmp/page-du-pc.html";
    const premier = await deposer(t, "<p>une</p>");
    const id = await partager(t, a, premier, PC, origine);
    const second = await deposer(t, "<p>deux, plus long</p>");
    const encore = await partager(t, a, second, PC, origine);
    expect(encore).toBe(id);
    const cartes = (await a.query(api.documentsKlyra.lister, { lieu: PC })).documents;
    expect(cartes).toHaveLength(1);
    expect(cartes[0]).toMatchObject({
      _id: id,
      deMoi: true,
      version: 2,
      origine,
      lieu: null,
      auteur: { nom: "Alice", actif: true },
    });
    expect(await existe(t, premier)).toBe(false);
    expect(await existe(t, second)).toBe(true);
    expect((await a.query(api.documentsKlyra.espace, {})).nombre).toBe(1);

    const trois = await deposer(t, "<p>bruno</p>");
    const pris = await partager(t, b, trois, PC, origine);
    expect(pris).toBe(id);
    const pourBruno = (await b.query(api.documentsKlyra.lister, { lieu: PC })).documents;
    expect(pourBruno).toHaveLength(1);
    expect(pourBruno[0]).toMatchObject({ _id: id, deMoi: true, version: 3, origine, auteur: { nom: "Bruno" } });
    const pourAlice = (await a.query(api.documentsKlyra.lister, { lieu: PC })).documents;
    expect(pourAlice).toHaveLength(1);
    expect(pourAlice[0]).toMatchObject({ _id: id, deMoi: false, origine: null, auteur: { nom: "Bruno" } });
    await expect(a.mutation(api.documentsKlyra.reprendre, { documentId: id, lieu: PC })).rejects.toThrow(/reserve_a_l_auteur/);
    expect(await existe(t, second)).toBe(false);
    expect((await b.query(api.documentsKlyra.espace, {})).nombre).toBe(1);
  });

  test("repartager le même original remplace le fichier, sans toucher l'autre espace", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const premier = await deposer(t, "<p>v1</p>");
    const id = await partager(t, a, premier, VPS, "/srv/page.html");
    const local = await partager(t, a, await deposer(t, "<p>pc</p>"), PC, "/srv/page.html");
    const second = await deposer(t, "<p>v2 plus long</p>");
    const encore = await partager(t, a, second, VPS, "/srv/page.html");
    expect(encore).toBe(id);
    expect(local).not.toBe(id);
    const vu = (await b.query(api.documentsKlyra.lister, { lieu: VPS })).documents[0];
    expect(vu).toMatchObject({ _id: id, version: 2, lieu: VPS });
    expect(vu.taille).toBeGreaterThan(0);
    expect(await existe(t, premier)).toBe(false);
    expect(await existe(t, second)).toBe(true);
    expect((await a.query(api.documentsKlyra.lister, { lieu: PC })).documents.map((d) => d._id)).toEqual([local]);
  });

  test("refuse ce qui n'est pas un HTML, un espace vide ou une description trop longue", async () => {
    const t = nouvelEssai();
    const { a } = await deuxComptes(t);
    const image = await deposer(t, "pas html", "image/png");
    await expect(partager(t, a, image)).rejects.toThrow(/document_invalide/);
    const html = await deposer(t);
    await expect(partager(t, a, html, PC, "")).rejects.toThrow(/document_invalide/);
    const lieu = await deposer(t);
    await expect(
      a.mutation(api.documentsKlyra.partager, { fichier: lieu, titre: "Page", description: "", origine: "/tmp/a.html", agent: null, lieu: "  " }),
    ).rejects.toThrow(/document_invalide/);
    const autre = await deposer(t);
    await expect(
      a.mutation(api.documentsKlyra.partager, { fichier: autre, titre: "Page", description: "x".repeat(501), origine: "/tmp/a.html", agent: null, lieu: PC }),
    ).rejects.toThrow(/description_trop_longue/);
    const agent = await deposer(t);
    await expect(
      a.mutation(api.documentsKlyra.partager, { fichier: agent, titre: "Page", description: "", origine: "/tmp/a.html", agent: "Iris", lieu: PC }),
    ).rejects.toThrow(/document_invalide/);
    expect(await a.query(api.documentsKlyra.espace, {})).toEqual({ octets: 0, nombre: 0, complet: true });
  });

  test("réservé aux membres connectés", async () => {
    const t = nouvelEssai();
    const { a } = await deuxComptes(t);
    const id = await partager(t, a, await deposer(t));
    await expect(t.query(api.documentsKlyra.lister, { lieu: PC })).rejects.toThrow(/non_connecte/);
    await expect(t.query(api.documentsKlyra.espace, {})).rejects.toThrow(/non_connecte/);
    await expect(t.query(api.documentsKlyra.lire, { documentId: id, lieu: PC })).rejects.toThrow(/non_connecte/);
    await expect(t.mutation(api.documentsKlyra.preparerDepot, {})).rejects.toThrow(/non_connecte/);
    await expect(
      t.mutation(api.documentsKlyra.partager, { fichier: await deposer(t), titre: "Page", description: "", origine: "/tmp/a.html", agent: null, lieu: PC }),
    ).rejects.toThrow(/non_connecte/);
  });
});
