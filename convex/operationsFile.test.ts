import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { connecter, initialiser, nouvelEssai, patienter } from "./test.utils";

const base = {
  projetId: null,
  projetNom: null,
  misAJour: "2026-11-01T00:00:00.000Z",
  epingleLe: null,
  extrait: "",
  extraitLe: null,
  nonLus: 0,
  taches: "[]",
};
const direct = { ...base, origine: "dm-hugo", kind: "direct" as const, titre: "Hugo", roleIds: ["hugo"] };
const equipe = { ...base, origine: "c0ffee00-0000-4000-8000-000000000001", kind: "equipe" as const, titre: "Refonte devis", projetId: "p1", projetNom: "KLYRA", roleIds: ["principal"] };
const fil = { ...base, origine: "klyra-fil-1a2b3c4d", kind: "direct" as const, titre: "Maquette", roleIds: ["hugo"], parent: "dm-hugo" };
const hugo = { origine: "hugo", nom: "Hugo", teinte: "bleu-k1", roleCourt: "Dev", actif: true };

async function compte() {
  const t = nouvelEssai();
  await initialiser(t);
  const moi = await connecter(t, "corentin@klyra.design");
  await moi.mutation(api.conversationsCompte.importerAgents, { lot: [hugo] });
  await moi.mutation(api.conversationsCompte.importerConversations, { lot: [direct, equipe, fil] });
  return { t, moi };
}

describe("gestes du téléphone sur les conversations (operationsFile)", () => {
  const message = { conversationOrigine: "dm-hugo", origine: "m-1", auteurKind: "role" as const, auteurId: "hugo", creeLe: "2026-11-01T00:00:00.000Z", texte: "Voilà", parties: "[]", statut: "fait" as const };

  test("une réaction se pose et se retire, sans message pour l'agent ; rejouée, elle ne change rien de plus", async () => {
    const { moi } = await compte();
    await moi.mutation(api.conversationsCompte.importerMessages, { lot: [message] });
    await moi.mutation(api.operationsFile.reagir, { messageOrigine: "m-1", emoji: "👍", mise: true });
    await moi.mutation(api.operationsFile.reagir, { messageOrigine: "m-1", emoji: "👍", mise: true });
    const lu = await moi.query(api.conversationsCompte.messages, { origine: "dm-hugo" });
    expect(lu.messages[0].reactions).toEqual(["👍"]);
    const gestes = await moi.query(api.operationsFile.aRejouer, {});
    expect(gestes.filter((g) => g.type === "reagir")).toHaveLength(1);
    /* Une réaction n'est pas un message : rien dans la file de l'agent. */
    expect(await moi.query(api.conversationsCompte.enAttente, {})).toEqual([]);
    const pris = await moi.mutation(api.operationsFile.prendre, { id: gestes.find((g) => g.type === "reagir")!._id });
    expect(JSON.parse(pris!.valeur)).toEqual({ messageId: "m-1", emoji: "👍", mise: true });

    await moi.mutation(api.operationsFile.reagir, { messageOrigine: "m-1", emoji: "👍", mise: false });
    expect((await moi.query(api.conversationsCompte.messages, { origine: "dm-hugo" })).messages[0].reactions).toEqual([]);
  });

  test("une réaction hors de la liste, ou sur un message de la personne, est refusée", async () => {
    const { moi } = await compte();
    await moi.mutation(api.conversationsCompte.importerMessages, { lot: [message, { ...message, origine: "m-2", auteurKind: "user" as const, auteurId: null }] });
    await expect(moi.mutation(api.operationsFile.reagir, { messageOrigine: "m-1", emoji: "🦄", mise: true })).rejects.toThrow();
    await expect(moi.mutation(api.operationsFile.reagir, { messageOrigine: "m-2", emoji: "👍", mise: true })).rejects.toThrow();
    await expect(moi.mutation(api.operationsFile.reagir, { messageOrigine: "absent", emoji: "👍", mise: true })).rejects.toThrow();
  });

  test("la copie de l'ordinateur reprend les réactions ; une version d'avant, sans ce champ, ne les efface pas", async () => {
    const { moi } = await compte();
    await moi.mutation(api.conversationsCompte.importerMessages, { lot: [{ ...message, reactions: ["🎉", "🦄"] }] });
    expect((await moi.query(api.conversationsCompte.messages, { origine: "dm-hugo" })).messages[0].reactions).toEqual(["🎉"]);
    await moi.mutation(api.conversationsCompte.importerMessages, { lot: [message] });
    expect((await moi.query(api.conversationsCompte.messages, { origine: "dm-hugo" })).messages[0].reactions).toEqual(["🎉"]);
  });

  test("un fil tiré d'un passage porte son titre, dans le compte et sur l'ordinateur", async () => {
    const { moi } = await compte();
    await moi.mutation(api.operationsFile.creerFil, { origine: "klyra-fil-9a9a9a9a", roleId: "hugo", titre: "  Relance   Cabinet Ostral " });
    const c = (await moi.query(api.conversationsCompte.liste, {})).find((x) => x.origine === "klyra-fil-9a9a9a9a");
    expect(c?.titre).toBe("Relance Cabinet Ostral");
    const geste = (await moi.query(api.operationsFile.aRejouer, {})).find((g) => g.type === "creerFil")!;
    expect(JSON.parse((await moi.mutation(api.operationsFile.prendre, { id: geste._id }))!.valeur)).toEqual({ roleId: "hugo", titre: "Relance Cabinet Ostral" });
  });

  test("renommer et épingler s'appliquent tout de suite au compte, puis partent dans l'ordre", async () => {
    const { t, moi } = await compte();
    await moi.mutation(api.operationsFile.renommer, { conversationOrigine: equipe.origine, titre: "  Devis   2027 " });
    await patienter(t, 10);
    await moi.mutation(api.operationsFile.epingler, { conversationOrigine: equipe.origine, epingle: true });
    const ligne = (await moi.query(api.conversationsCompte.liste, {})).find((c) => c.origine === equipe.origine);
    expect(ligne?.titre).toBe("Devis 2027");
    expect(ligne?.epingleLe).not.toBeNull();

    const file = await moi.query(api.operationsFile.aRejouer, {});
    expect(file.map((o) => o.type)).toEqual(["renommer", "epingler"]);
    expect(await moi.mutation(api.operationsFile.prendre, { id: file[0]._id })).toEqual({
      conversationOrigine: equipe.origine,
      type: "renommer",
      valeur: '{"titre":"Devis 2027"}',
    });
    /* Pris une fois : effacé, un second ordinateur ne le rejoue pas. */
    expect(await moi.mutation(api.operationsFile.prendre, { id: file[0]._id })).toBeNull();
    expect((await moi.query(api.operationsFile.aRejouer, {})).map((o) => o.type)).toEqual(["epingler"]);
  });

  test("le chat principal d'un agent ne se renomme ni ne s'épingle", async () => {
    const { moi } = await compte();
    await expect(moi.mutation(api.operationsFile.renommer, { conversationOrigine: "dm-hugo", titre: "Autre" })).rejects.toThrow(/conversation_invalide/);
    await expect(moi.mutation(api.operationsFile.epingler, { conversationOrigine: "dm-hugo", epingle: true })).rejects.toThrow(/conversation_invalide/);
    await expect(moi.mutation(api.operationsFile.archiverFil, { conversationOrigine: equipe.origine, supprime: false })).rejects.toThrow(/conversation_invalide/);
    expect(await moi.query(api.operationsFile.aRejouer, {})).toEqual([]);
  });

  test("un nouveau fil est dans le compte tout de suite et survit à l'alignement tant que l'ordinateur ne l'a pas créé", async () => {
    const { moi } = await compte();
    await moi.mutation(api.operationsFile.creerFil, { origine: "klyra-fil-00ff00ff", roleId: "hugo" });
    const nouveau = (await moi.query(api.conversationsCompte.liste, {})).find((c) => c.origine === "klyra-fil-00ff00ff");
    expect(nouveau).toMatchObject({ kind: "direct", titre: "Nouveau fil", parent: "dm-hugo", roleIds: ["hugo"], archiveLe: null });
    /* L'ordinateur pousse sa liste sans le fil : il reste, la création attend dans la file. */
    await moi.mutation(api.conversationsCompte.alignerConversations, { origines: [direct.origine, equipe.origine, fil.origine] });
    expect((await moi.query(api.conversationsCompte.liste, {})).some((c) => c.origine === "klyra-fil-00ff00ff")).toBe(true);
    const [operation] = await moi.query(api.operationsFile.aRejouer, {});
    expect(await moi.mutation(api.operationsFile.prendre, { id: operation._id })).toMatchObject({ type: "creerFil", valeur: '{"roleId":"hugo"}' });
    /* Repris : l'alignement suivant suit de nouveau l'ordinateur. */
    await moi.mutation(api.conversationsCompte.alignerConversations, { origines: [direct.origine] });
    expect((await moi.query(api.conversationsCompte.liste, {})).map((c) => c.origine)).toEqual([direct.origine]);
  });

  test("un id de fil déjà pris ou mal formé est refusé", async () => {
    const { moi } = await compte();
    await expect(moi.mutation(api.operationsFile.creerFil, { origine: fil.origine, roleId: "hugo" })).rejects.toThrow(/conversation_invalide/);
    await expect(moi.mutation(api.operationsFile.creerFil, { origine: "dm-hugo", roleId: "hugo" })).rejects.toThrow(/conversation_invalide/);
    await expect(moi.mutation(api.operationsFile.creerFil, { origine: "klyra-fil-12345678", roleId: "inconnu" })).rejects.toThrow(/introuvable/);
  });

  test("archiver garde le fil dans les archivés, supprimer le retire du compte", async () => {
    const { moi } = await compte();
    await moi.mutation(api.operationsFile.archiverFil, { conversationOrigine: fil.origine, supprime: false });
    expect((await moi.query(api.conversationsCompte.liste, {})).find((c) => c.origine === fil.origine)?.archiveLe).not.toBeNull();
    await moi.mutation(api.operationsFile.rouvrirFil, { conversationOrigine: fil.origine });
    expect((await moi.query(api.conversationsCompte.liste, {})).find((c) => c.origine === fil.origine)?.archiveLe).toBeNull();
    await moi.mutation(api.operationsFile.archiverFil, { conversationOrigine: fil.origine, supprime: true });
    expect((await moi.query(api.conversationsCompte.liste, {})).some((c) => c.origine === fil.origine)).toBe(false);
    expect((await moi.query(api.operationsFile.aRejouer, {})).map((o) => o.type)).toEqual(["archiverFil", "rouvrirFil", "archiverFil"]);
  });

  test("lue sur le téléphone : non-lus et question tombent tout de suite, l'ordinateur la marquera lue ; rien à lire, rien d'empilé", async () => {
    const { moi } = await compte();
    const question = JSON.stringify({ etat: "question", roleId: "hugo", messageId: "m1", depuis: "2026-11-01T10:00:00.000Z" });
    await moi.mutation(api.conversationsCompte.importerConversations, { lot: [{ ...direct, nonLus: 2, activite: question }] });
    await moi.mutation(api.operationsFile.marquerLu, { conversationOrigine: "dm-hugo" });
    expect((await moi.query(api.conversationsCompte.liste, {})).find((c) => c.origine === "dm-hugo")).toMatchObject({ nonLus: 0, activite: null });
    await moi.mutation(api.operationsFile.marquerLu, { conversationOrigine: "dm-hugo" });
    expect((await moi.query(api.operationsFile.aRejouer, {})).map((o) => o.type)).toEqual(["lu"]);
  });

  test("un autre membre ne voit ni ne prend les gestes", async () => {
    const { t, moi } = await compte();
    await moi.mutation(api.operationsFile.renommer, { conversationOrigine: equipe.origine, titre: "Devis" });
    const [operation] = await moi.query(api.operationsFile.aRejouer, {});
    const autre = await connecter(t, "pelin@klyra.design");
    expect(await autre.query(api.operationsFile.aRejouer, {})).toEqual([]);
    expect(await autre.mutation(api.operationsFile.prendre, { id: operation._id })).toBeNull();
    await expect(autre.mutation(api.operationsFile.renommer, { conversationOrigine: equipe.origine, titre: "Pris" })).rejects.toThrow(/introuvable/);
  });
});
