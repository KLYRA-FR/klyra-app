import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { connecter, initialiser, nouvelEssai, type Essai } from "./test.utils";

/** Deux comptes fictifs : A (admin) partage, B (membre) consulte. */
async function deuxComptes(t: Essai) {
  await initialiser(t, [{ email: "a@essai.klyra", nom: "Alice" }]);
  const a = await connecter(t, "a@essai.klyra");
  await a.mutation(api.equipe.inviter, { email: "b@essai.klyra", nom: "Bruno", role: "membre" });
  const b = await connecter(t, "b@essai.klyra");
  return { a, b };
}

type Client = Awaited<ReturnType<typeof deuxComptes>>["a"];
const liste = async (c: Client) => (await c.query(api.artefactsEquipe.lister, {})).artefacts;
const LIEN = "https://claude.ai/artifact/C3Tqnor89ed3qjk6n1Wben";

describe("artefacts de l'équipe", () => {
  test("un artefact partagé est vu par toute l'équipe, avec qui l'a partagé", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    await a.mutation(api.artefactsEquipe.partager, { url: `${LIEN}/`, titre: "  Design   system ", description: "Les tokens" });
    const vu = await liste(b);
    expect(vu).toHaveLength(1);
    expect(vu[0]).toMatchObject({ url: LIEN, titre: "Design system", description: "Les tokens", auteur: { nom: "Alice", actif: true }, deMoi: false });
    expect((await liste(a))[0].deMoi).toBe(true);
  });

  test("refuse un lien qui n'est pas un artefact claude.ai, et un lien déjà partagé", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    await expect(a.mutation(api.artefactsEquipe.partager, { url: "https://exemple.fr/artifact/abc", titre: "X", description: "" })).rejects.toThrow(/lien_invalide/);
    await a.mutation(api.artefactsEquipe.partager, { url: LIEN, titre: "DS", description: "" });
    await expect(b.mutation(api.artefactsEquipe.partager, { url: `${LIEN}/`, titre: "DS", description: "" })).rejects.toThrow(/deja_partage/);
    await expect(a.mutation(api.artefactsEquipe.partager, { url: "https://claude.ai/artifact/autre", titre: " ", description: "" })).rejects.toThrow(/nom_invalide/);
    await expect(
      a.mutation(api.artefactsEquipe.partager, { url: "https://claude.ai/artifact/autre", titre: "Long", description: "x".repeat(501) }),
    ).rejects.toThrow(/description_trop_longue/);
  });

  test("seul qui l'a partagé le modifie ou le retire ; retiré, il peut être partagé à nouveau", async () => {
    const t = nouvelEssai();
    const { a, b } = await deuxComptes(t);
    const id = await a.mutation(api.artefactsEquipe.partager, { url: LIEN, titre: "DS", description: "" });
    await expect(b.mutation(api.artefactsEquipe.modifier, { artefactId: id, titre: "Pris", description: "" })).rejects.toThrow(/reserve_a_l_auteur/);
    await expect(b.mutation(api.artefactsEquipe.retirer, { artefactId: id })).rejects.toThrow(/reserve_a_l_auteur/);
    await a.mutation(api.artefactsEquipe.modifier, { artefactId: id, titre: "Design system KLYRA", description: "La référence" });
    expect((await liste(b))[0]).toMatchObject({ titre: "Design system KLYRA", description: "La référence" });
    await a.mutation(api.artefactsEquipe.retirer, { artefactId: id });
    expect(await liste(b)).toEqual([]);
    await expect(a.mutation(api.artefactsEquipe.retirer, { artefactId: id })).rejects.toThrow(/introuvable/);
    await b.mutation(api.artefactsEquipe.partager, { url: LIEN, titre: "DS", description: "" });
    expect((await liste(a))[0]).toMatchObject({ auteur: { nom: "Bruno" }, deMoi: false });
  });

  test("réservé aux membres connectés", async () => {
    const t = nouvelEssai();
    await deuxComptes(t);
    await expect(t.query(api.artefactsEquipe.lister, {})).rejects.toThrow(/non_connecte/);
    await expect(t.mutation(api.artefactsEquipe.partager, { url: LIEN, titre: "DS", description: "" })).rejects.toThrow(/non_connecte/);
  });
});
