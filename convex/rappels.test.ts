import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { courrielsRecus, connecter, initialiser, nouvelEssai, patienter, type Essai } from "./test.utils";

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

function saisie(partiel: { jour?: string | null; heure?: string | null; echeance?: number | null; titre?: string; notes?: string } = {}) {
  const jour = partiel.jour === undefined ? "2026-11-02" : partiel.jour;
  const heure = partiel.heure === undefined ? "14:00" : partiel.heure;
  return {
    titre: partiel.titre ?? "Relire le contrat",
    notes: partiel.notes ?? "",
    jour,
    heure,
    fin: null,
    echeance: partiel.echeance === undefined ? Date.parse("2026-11-02T14:00:00") : partiel.echeance,
    priorite: 1 as const,
  };
}

async function dernierSujet(t: Essai, email: string) {
  return (await t.query(internal.courriels.dernierCourrielSimule, { a: email }))?.sujet ?? null;
}

describe("rappels : droits", () => {
  test("sans session, rien n'est lisible ni modifiable", async () => {
    const { t } = await equipe();
    await expect(t.query(api.rappels.mes, {})).rejects.toThrow(/non_connecte/);
    await expect(t.query(api.rappels.assignes, {})).rejects.toThrow(/non_connecte/);
    await expect(t.mutation(api.rappels.importer, { lot: [] })).rejects.toThrow(/non_connecte/);
  });

  test("chacun ne voit que les siens, admin compris ; l'assigné change le statut et les notes", async () => {
    const { a, b, c, idA, idB } = await equipe();
    const perso = await a.mutation(api.rappels.creer, { ...saisie({ titre: "Le mien" }), assigneA: idA, liste: "perso" });
    const confie = await a.mutation(api.rappels.creer, { ...saisie({ titre: "Pour Bruno", notes: "note-secrète-xyz" }), assigneA: idB, liste: "clients" });

    expect((await a.query(api.rappels.mes, {})).map((r) => r.titre)).toEqual(["Le mien"]);
    expect((await a.query(api.rappels.assignes, {})).map((r) => r._id)).toEqual([confie]);
    expect((await b.query(api.rappels.mes, {})).map((r) => r.titre)).toEqual(["Pour Bruno"]);
    expect(await b.query(api.rappels.assignes, {})).toEqual([]);
    expect(await c.query(api.rappels.mes, {})).toEqual([]);
    expect((await b.query(api.rappels.mes, {}))[0].liste).toBeNull();

    await expect(b.mutation(api.rappels.modifier, { rappelId: confie, titre: "Volé" })).rejects.toThrow(/reserve_au_createur/);
    await expect(c.mutation(api.rappels.modifier, { rappelId: confie, notes: "vu" })).rejects.toThrow(/introuvable/);
    await expect(b.mutation(api.rappels.supprimer, { rappelId: confie })).rejects.toThrow(/reserve_au_createur/);
    await expect(c.mutation(api.rappels.supprimer, { rappelId: perso })).rejects.toThrow(/introuvable/);

    await b.mutation(api.rappels.modifier, { rappelId: confie, notes: "je m'en occupe", fait: true, liste: "perso" });
    const vu = (await b.query(api.rappels.mes, {}))[0];
    expect(vu).toMatchObject({ notes: "je m'en occupe", statut: "fait", liste: "perso", titre: "Pour Bruno" });
    expect((await a.query(api.rappels.notifications, {})).liste.map((n) => n.type)).toContain("fait");

    await a.mutation(api.rappels.supprimer, { rappelId: perso });
    expect(await a.query(api.rappels.mes, {})).toEqual([]);
  });

  test("une personne retirée n'a plus accès", async () => {
    const { a, b, idB } = await equipe();
    await a.mutation(api.equipe.retirer, { membreId: idB });
    await expect(b.query(api.rappels.mes, {})).rejects.toThrow(/non_connecte/);
    await expect(a.mutation(api.rappels.creer, { ...saisie(), assigneA: idB, liste: null })).rejects.toThrow(/membre_inconnu/);
  });
});

describe("rappels : retard, import, e-mail", () => {
  test("une échéance passée est en retard tout de suite, une échéance future le devient à l'heure dite, sans e-mail", async () => {
    const { t, a, idA } = await equipe();
    const avant = await courrielsRecus(t, "a@essai.klyra");
    const passe = await a.mutation(api.rappels.creer, { ...saisie({ echeance: Date.now() - 60_000, titre: "Déjà dû" }), assigneA: idA, liste: null });
    expect((await a.query(api.rappels.mes, {})).find((r) => r._id === passe)?.statut).toBe("en_retard");

    const dansUneHeure = Date.now() + 60 * 60_000;
    const futur = await a.mutation(api.rappels.creer, {
      ...saisie({ jour: "2026-11-03", heure: "09:00", echeance: dansUneHeure, titre: "Plus tard" }),
      assigneA: idA,
      liste: null,
    });
    expect((await a.query(api.rappels.mes, {})).find((r) => r._id === futur)?.statut).toBe("a_faire");
    await patienter(t, 60 * 60_000 + 1_000);
    expect((await a.query(api.rappels.mes, {})).find((r) => r._id === futur)?.statut).toBe("en_retard");
    const notif = await a.query(api.rappels.notifications, {});
    expect(notif.liste.some((n) => n.type === "echeance" && n.rappelId === futur)).toBe(true);
    expect(await courrielsRecus(t, "a@essai.klyra")).toBe(avant);
  });

  test("l'import par lots de 100 reprend sans doublon et garde la catégorie", async () => {
    const { a, idA } = await equipe();
    const lot = [
      { ...saisie({ titre: "Local 1" }), origineLocale: "local-1", faite: false, liste: "perso" },
      { ...saisie({ titre: "Local 2", jour: null, heure: null, echeance: null }), origineLocale: "local-2", faite: true, liste: "clients" },
    ];
    expect(await a.mutation(api.rappels.importer, { lot })).toEqual({ ajoutes: 2, deja: 0 });
    expect(await a.mutation(api.rappels.importer, { lot: [lot[0]] })).toEqual({ ajoutes: 0, deja: 1 });
    const mes = await a.query(api.rappels.mes, {});
    expect(mes.map((r) => r.origineLocale).sort()).toEqual(["local-1", "local-2"]);
    expect(mes.find((r) => r.origineLocale === "local-2")).toMatchObject({ statut: "fait", liste: "clients", assigneA: idA });
    await expect(a.mutation(api.rappels.importer, { lot: Array.from({ length: 101 }, (_, i) => ({ ...saisie(), origineLocale: `x${i}`, faite: false, liste: null })) })).rejects.toThrow(/lot_trop_grand/);
  });

  test("e-mail seulement si l'app de la personne est fermée, sans les notes, pas pour soi", async () => {
    const { t, a, b, idA, idB } = await equipe();
    const avantSoi = await courrielsRecus(t, "a@essai.klyra");
    await a.mutation(api.rappels.creer, { ...saisie({ titre: "Pour moi", notes: "note-secrète-xyz" }), assigneA: idA, liste: null });
    expect(await courrielsRecus(t, "a@essai.klyra")).toBe(avantSoi);

    const avant = await courrielsRecus(t, "b@essai.klyra");
    await a.mutation(api.rappels.creer, { ...saisie({ titre: "Appeler le client", notes: "note-secrète-xyz" }), assigneA: idB, liste: null });
    expect(await courrielsRecus(t, "b@essai.klyra")).toBe(avant + 1);
    const courriel = await t.query(internal.courriels.dernierCourrielSimule, { a: "b@essai.klyra" });
    expect(courriel?.sujet).toBe("Rappel : Appeler le client");
    expect(courriel?.texte).toContain("Alice");
    expect(courriel?.texte).not.toContain("note-secrète-xyz");
    expect((await b.query(api.rappels.notifications, {})).nonLues).toBe(1);

    await b.mutation(api.presence.heartbeat, { roomId: "klyra", userId: "ignore", sessionId: "session-bruno-1", interval: 10_000 });
    await a.mutation(api.rappels.creer, { ...saisie({ titre: "Pendant qu'il est là" }), assigneA: idB, liste: null });
    expect(await courrielsRecus(t, "b@essai.klyra")).toBe(avant + 1);
    expect(await dernierSujet(t, "b@essai.klyra")).toBe("Rappel : Appeler le client");
  });
});
