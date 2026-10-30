import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { preparerPublication } from "./model/definitions";
import { connecter, initialiser, nouvelEssai, type Essai } from "./test.utils";

/** Deux comptes fictifs : A (admin) publie, B (membre) consulte et ajoute. */
async function deuxComptes(t: Essai) {
  await initialiser(t, [{ email: "a@essai.klyra", nom: "Alice" }]);
  const a = await connecter(t, "a@essai.klyra");
  await a.mutation(api.equipe.inviter, { email: "b@essai.klyra", nom: "Bruno", role: "membre" });
  const b = await connecter(t, "b@essai.klyra");
  return { a, b };
}

const FICHE = `---
name: juriste
displayName: Nina
description: "Juriste — contrats, CGV, RGPD. Appelle Nina dès qu’il faut relire un contrat."
model: sonnet
memory: project
hooks: "echo secret"
---

# Nina — Juriste

Je relis les contrats rangés dans /Users/alice/Clients/Contrats et je réponds en clair.

## Comment je travaille

1. Je lis d'abord ~/.claude/agents/juriste.md et /Users/alice/Clients/Contrats/modele.docx.
`;

type Client = Awaited<ReturnType<typeof deuxComptes>>["a"];
const liste = async (c: Client) => (await c.query(api.bibliotheque.lister, {})).definitions;
const fiche = async (c: Client, definitionId: string) => (await c.query(api.bibliotheque.lire, { definitionId })).definition;
const etats = async (c: Client, ids: string[]) =>
  (await c.query(api.bibliotheque.etats, { ids })).etats.map(({ _id, version, retiree, deMoi }) => ({ _id, version, retiree, deMoi }));

function publication(contenu = FICHE) {
  const p = preparerPublication(contenu, { contrats: "Dossier des contrats" });
  return { contenu: p.contenu, role: "Juridique", dependances: p.dependances };
}

describe("bibliothèque : aperçu de publication", () => {
  test("ne garde que les clés partagées et remplace les chemins personnels", () => {
    const p = preparerPublication(FICHE, { contrats: "Dossier des contrats" });
    expect(p.nonPartages).toEqual(["memory", "hooks"]);
    expect(p.contenu).not.toMatch(/memory:|hooks:|\/Users\/alice/);
    expect(p.contenu).toContain("{{chemin:contrats}}");
    expect(p.contenu).toContain("{{chemin:modele}}");
    expect(p.contenu).toContain("~/.claude/agents/juriste.md");
    expect(p.dependances).toEqual([
      { cle: "modele", libelle: "Dossier « modele »" },
      { cle: "contrats", libelle: "Dossier des contrats" },
    ]);
    expect(p).toMatchObject({ slug: "juriste", nom: "Nina", modele: "sonnet", capacites: ["Contrats", "CGV", "RGPD"], secrets: [] });
  });

  test("signale un secret sans le recopier", () => {
    const p = preparerPublication(`${FICHE}\nClé : sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv\n`);
    expect(p.secrets).toHaveLength(1);
    expect(p.secrets[0].extrait).not.toContain("AbCdEf");
  });
});

describe("bibliothèque : droits", () => {
  test("sans session, rien n'est lisible ni publiable", async () => {
    const t = nouvelEssai();
    await deuxComptes(t);
    await expect(t.query(api.bibliotheque.lister, {})).rejects.toThrow(/non_connecte/);
    await expect(t.query(api.bibliotheque.lire, { definitionId: "x" })).rejects.toThrow(/non_connecte/);
    await expect(t.mutation(api.bibliotheque.publier, publication())).rejects.toThrow(/non_connecte/);
  });

  test("A publie, B voit la définition et son auteur, sans la fiche dans la liste", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    expect(await liste(b)).toEqual([]);
    const id = await a.mutation(api.bibliotheque.publier, publication());
    const vues = await liste(b);
    expect(vues).toHaveLength(1);
    expect(vues[0]).toMatchObject({ _id: id, slug: "juriste", nom: "Nina", role: "Juridique", version: 1, deMoi: false, auteur: { nom: "Alice", actif: true } });
    expect(vues[0]).not.toHaveProperty("contenu");
    expect((await fiche(b, id))?.contenu).toContain("{{chemin:contrats}}");
    expect((await liste(a))[0].deMoi).toBe(true);
  });

  test("chaque réponse dit pour quel membre elle a été lue", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const membres = await a.query(api.equipe.membres, {});
    const [alice, bruno] = ["Alice", "Bruno"].map((n) => membres.find((m) => m.nom === n)!._id);
    expect((await a.query(api.bibliotheque.lister, {})).pour).toBe(alice);
    expect((await b.query(api.bibliotheque.lister, {})).pour).toBe(bruno);
    expect((await b.query(api.bibliotheque.etats, { ids: [] })).pour).toBe(bruno);
    expect((await b.query(api.bibliotheque.lire, { definitionId: "x" })).pour).toBe(bruno);
  });

  test("B ne peut ni modifier ni retirer la définition d'A", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const id = await a.mutation(api.bibliotheque.publier, publication());
    await expect(
      b.mutation(api.bibliotheque.mettreAJour, { definitionId: id, versionAttendue: 1, ...publication(FICHE.replace("en clair", "vite")) }),
    ).rejects.toThrow(/reserve_a_l_auteur/);
    await expect(b.mutation(api.bibliotheque.retirer, { definitionId: id })).rejects.toThrow(/reserve_a_l_auteur/);
    expect((await fiche(b, id))?.version).toBe(1);
  });

  test("un membre retiré n'a plus accès, et sa session ne sert plus", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    await a.mutation(api.bibliotheque.publier, publication());
    const bruno = (await a.query(api.equipe.membres, {})).find((m) => m.nom === "Bruno")!;
    await a.mutation(api.equipe.retirer, { membreId: bruno._id });
    await expect(b.query(api.bibliotheque.lister, {})).rejects.toThrow(/non_connecte/);
    await expect(b.query(api.bibliotheque.etats, { ids: [] })).rejects.toThrow(/non_connecte/);
  });
});

describe("bibliothèque : contrôles du serveur", () => {
  test("refuse une fiche qui n'est pas passée par l'aperçu", async () => {
    const t = nouvelEssai();
    const { a } = await deuxComptes(t);
    const dep = { role: "Juridique", dependances: [] };
    await expect(a.mutation(api.bibliotheque.publier, { contenu: FICHE, ...dep })).rejects.toThrow(/cle_non_partagee/);
    const sansCles = "---\nname: juriste\n---\n\nVoir /Users/alice/Clients.\n";
    await expect(a.mutation(api.bibliotheque.publier, { contenu: sansCles, ...dep })).rejects.toThrow(/chemin_personnel/);
    const secret = "---\nname: juriste\n---\n\nToken: ghp_abcdefghijklmnopqrstuvwxyz123456\n";
    await expect(a.mutation(api.bibliotheque.publier, { contenu: secret, ...dep })).rejects.toThrow(/secret_detecte/);
    const oubli = "---\nname: juriste\n---\n\nVoir {{chemin:contrats}}.\n";
    await expect(a.mutation(api.bibliotheque.publier, { contenu: oubli, ...dep })).rejects.toThrow(/dependance_invalide/);
    await expect(a.mutation(api.bibliotheque.publier, { contenu: "---\nname: Juriste !\n---\n\nTexte.\n", ...dep })).rejects.toThrow(
      /nom_invalide/,
    );
    await expect(a.mutation(api.bibliotheque.publier, { contenu: `---\nname: juriste\n---\n\n${"x".repeat(60_001)}`, ...dep })).rejects.toThrow(
      /trop_long/,
    );
  });

  test("une même fiche n'est publiée qu'une fois par son auteur", async () => {
    const t = nouvelEssai();
    const { a } = await deuxComptes(t);
    const id = await a.mutation(api.bibliotheque.publier, publication());
    await expect(a.mutation(api.bibliotheque.publier, publication())).rejects.toThrow(/deja_publiee/);
    await a.mutation(api.bibliotheque.retirer, { definitionId: id });
    await expect(a.mutation(api.bibliotheque.publier, publication())).resolves.toBeTruthy();
  });
});

describe("bibliothèque : versions", () => {
  test("mise à jour de l'auteur, version attendue, conflit entre deux ordinateurs", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const id = await a.mutation(api.bibliotheque.publier, publication());
    expect(await a.mutation(api.bibliotheque.mettreAJour, { definitionId: id, versionAttendue: 1, ...publication(FICHE.replace("en clair", "en deux lignes")) })).toBe(2);
    // Le second ordinateur d'A avait encore la version 1 sous les yeux : refusé, rien d'écrasé.
    await expect(
      a.mutation(api.bibliotheque.mettreAJour, { definitionId: id, versionAttendue: 1, ...publication(FICHE.replace("en clair", "autrement")) }),
    ).rejects.toThrow(/conflit_version/);
    expect((await fiche(b, id))?.contenu).toContain("en deux lignes");
    expect(await etats(b, [id, "inconnu", "k57abc"])).toEqual([{ _id: id, version: 2, retiree: false, deMoi: false }]);
    expect(await etats(a, [id])).toEqual([{ _id: id, version: 2, retiree: false, deMoi: true }]);
    // Le nom local ne change pas d'une version à l'autre.
    await expect(
      a.mutation(api.bibliotheque.mettreAJour, { definitionId: id, versionAttendue: 2, ...publication(FICHE.replace("name: juriste", "name: avocate")) }),
    ).rejects.toThrow(/nom_invalide/);
  });

  test("retirée : absente de la liste, illisible pour B, signalée dans ses états", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const id = await a.mutation(api.bibliotheque.publier, publication());
    await a.mutation(api.bibliotheque.retirer, { definitionId: id });
    expect(await liste(b)).toEqual([]);
    expect(await fiche(b, id)).toBeNull();
    expect(await etats(b, [id])).toEqual([{ _id: id, version: 1, retiree: true, deMoi: false }]);
    expect(await fiche(a, id)).not.toBeNull();
  });
});
