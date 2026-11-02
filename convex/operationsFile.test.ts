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
