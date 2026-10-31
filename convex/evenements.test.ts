import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { connecter, initialiser, nouvelEssai } from "./test.utils";

const FENETRE = { debut: "2026-11-01", fin: "2026-11-15", finMs: Date.UTC(2026, 10, 15) };

async function equipe() {
  const t = nouvelEssai();
  await initialiser(t, [{ email: "a@essai.klyra", nom: "Alice" }]);
  const a = await connecter(t, "a@essai.klyra");
  await a.mutation(api.equipe.inviter, { email: "b@essai.klyra", nom: "Bruno", role: "membre" });
  await a.mutation(api.equipe.inviter, { email: "c@essai.klyra", nom: "Chloé", role: "admin" });
  const b = await connecter(t, "b@essai.klyra");
  const c = await connecter(t, "c@essai.klyra");
  const idA = (await a.query(api.equipe.moi, {}))!._id;
  const idB = (await b.query(api.equipe.moi, {}))!._id;
  return { t, a, b, c, idA, idB };
}

function saisie(idB: string, partiel: { touteEquipe?: boolean; repetition?: "aucune" | "semaine"; participants?: string[] } = {}) {
  return {
    titre: "Point client",
    notes: "privé",
    jour: "2026-11-03",
    debut: "10:00",
    fin: "11:00",
    jourEntier: false,
    repetition: partiel.repetition ?? "aucune",
    touteEquipe: partiel.touteEquipe ?? false,
    participants: (partiel.participants ?? [idB]) as never,
    debutMs: Date.UTC(2026, 10, 3, 10, 0),
  };
}

describe("calendrier : droits", () => {
  test("sans session, rien n'est lisible ni créé", async () => {
    const { t } = await equipe();
    await expect(t.query(api.evenements.entre, FENETRE)).rejects.toThrow(/non_connecte/);
    await expect(t.mutation(api.evenements.creer, saisie("", { touteEquipe: true, participants: [] }))).rejects.toThrow(/non_connecte/);
  });

  test("chacun ne voit que ses événements, admin compris ; seul l'organisateur modifie", async () => {
    const { a, b, c, idA, idB } = await equipe();
    const evenement = await a.mutation(api.evenements.creer, saisie(idB));
    expect((await a.query(api.evenements.entre, FENETRE)).map((e) => e.titre)).toEqual(["Point client"]);
    expect((await b.query(api.evenements.entre, FENETRE)).map((e) => e.evenementId)).toEqual([evenement]);
    expect(await c.query(api.evenements.entre, FENETRE)).toEqual([]);
    expect((await b.query(api.evenements.entre, FENETRE))[0].notes).toBe("privé");

    await expect(b.mutation(api.evenements.modifier, { evenementId: evenement, ...saisie(idB, { participants: [idA] }), titre: "Volé" })).rejects.toThrow(/reserve_a_lorganisateur/);
    await expect(c.mutation(api.evenements.modifier, { evenementId: evenement, ...saisie(idB) })).rejects.toThrow(/introuvable/);
    await expect(b.mutation(api.evenements.supprimer, { evenementId: evenement })).rejects.toThrow(/reserve_a_lorganisateur/);
    await expect(c.mutation(api.evenements.supprimer, { evenementId: evenement })).rejects.toThrow(/introuvable/);
    await a.mutation(api.evenements.supprimer, { evenementId: evenement });
    expect(await b.query(api.evenements.entre, FENETRE)).toEqual([]);
  });

  test("une personne retirée ne voit plus rien, et on ne l'ajoute pas", async () => {
    const { a, b, idB } = await equipe();
    await a.mutation(api.equipe.retirer, { membreId: idB });
    await expect(b.query(api.evenements.entre, FENETRE)).rejects.toThrow(/non_connecte/);
    await expect(a.mutation(api.evenements.creer, saisie(idB))).rejects.toThrow(/membre_inconnu/);
  });

  test("toute l'équipe et le Weekly : chacun participe, une seule fois, sans modifier le Weekly", async () => {
    const { a, b, c } = await equipe();
    const partage = await a.mutation(api.evenements.creer, saisie("", { touteEquipe: true, participants: [] }));
    expect((await c.query(api.evenements.entre, FENETRE)).map((e) => e.evenementId)).toEqual([partage]);

    const weekly = await b.mutation(api.evenements.assurerWeekly, {});
    expect(await c.mutation(api.evenements.assurerWeekly, {})).toBe(weekly);
    const vus = await a.query(api.evenements.entre, { debut: "2026-11-01", fin: "2026-11-15", finMs: Date.UTC(2026, 10, 15) });
    const jours = vus.filter((e) => e.evenementId === weekly).map((e) => e.jour);
    expect(jours).toEqual(["2026-11-03", "2026-11-10"]);
    expect(vus.find((e) => e.evenementId === weekly)?.modifiable).toBe(false);
    await expect(a.mutation(api.evenements.supprimer, { evenementId: weekly })).rejects.toThrow(/reserve_a_lorganisateur/);
    expect(await b.query(api.evenements.entre, { debut: "2026-10-01", fin: "2026-10-20", finMs: Date.UTC(2026, 9, 20) })).toEqual([]);
  });
});
