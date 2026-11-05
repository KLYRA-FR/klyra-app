import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { connecter, initialiser, nouvelEssai } from "./test.utils";

const base = { projetId: null, projetNom: null, misAJour: "2026-11-01T00:00:00.000Z", epingleLe: null, extrait: "", extraitLe: null, nonLus: 0, taches: "[]" };
const ticket = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, statut: "ouvert", etape: "a-valider", creeLe: "2026-11-01T00:00:00.000Z", revision: 0, ...extra });
const fil = { ...base, origine: "klyra-fil-1a2b3c4d", kind: "direct" as const, titre: "Arrondi", roleIds: ["hugo"], parent: "dm-hugo", ticket: ticket(), contratTickets: 1 };
const hugo = { origine: "hugo", nom: "Hugo", teinte: "bleu-k1", roleCourt: "Dev", actif: true };
const demande = { demandeId: "demande-0001", conversationOrigine: fil.origine, type: "fermer" as const, valeur: "{}", revision: 0 };

async function compte(email = "corentin@klyra.design") {
  const t = nouvelEssai();
  await initialiser(t);
  const moi = await connecter(t, email);
  await moi.mutation(api.conversationsCompte.importerAgents, { lot: [hugo] });
  await moi.mutation(api.conversationsCompte.importerConversations, { lot: [fil] });
  return { t, moi };
}

describe("contrat des lots 3 et 4 : demandes sur les tickets", () => {
  test("acceptée n'est pas faite : la copie ne bouge pas avant l'accusé", async () => {
    const { moi } = await compte();
    expect(await moi.mutation(api.ticketsCompte.demander, demande)).toEqual({ etat: "en-attente" });
    const c = (await moi.query(api.conversationsCompte.liste, {})).find((x) => x.origine === fil.origine);
    expect(JSON.parse(c!.ticket!).statut).toBe("ouvert");
    expect((await moi.query(api.ticketsCompte.mesDemandes, {}))[0]).toMatchObject({ demandeId: "demande-0001", etat: "en-attente" });
  });

  test("double appui ou reprise réseau : une seule demande", async () => {
    const { moi } = await compte();
    await moi.mutation(api.ticketsCompte.demander, demande);
    await moi.mutation(api.ticketsCompte.demander, demande);
    expect(await moi.query(api.ticketsCompte.mesDemandes, {})).toHaveLength(1);
    expect(await moi.query(api.ticketsCompte.aTraiter, {})).toHaveLength(1);
  });

  test("une seule prise ; l'accusé confirme et pose l'état final dans la copie, une seule fois", async () => {
    const { moi } = await compte();
    await moi.mutation(api.ticketsCompte.demander, demande);
    const [{ _id }] = await moi.query(api.ticketsCompte.aTraiter, {});
    expect(await moi.mutation(api.ticketsCompte.prendre, { id: _id })).toMatchObject({ type: "fermer", revision: 0 });
    expect(await moi.mutation(api.ticketsCompte.prendre, { id: _id })).toBeNull();
    const finale = ticket({ statut: "archive", revision: 1 });
    await moi.mutation(api.ticketsCompte.terminer, { id: _id, etat: "confirmee", resultat: '{"rappel":"coche"}', ticket: finale });
    expect((await moi.query(api.conversationsCompte.liste, {})).find((x) => x.origine === fil.origine)?.ticket).toBe(finale);
    await moi.mutation(api.ticketsCompte.terminer, { id: _id, etat: "echouee", resultat: '{"code":"erreur"}' });
    expect((await moi.query(api.ticketsCompte.mesDemandes, {}))[0]).toMatchObject({ etat: "confirmee", resultat: '{"rappel":"coche"}' });
    expect(await moi.query(api.ticketsCompte.aTraiter, {})).toHaveLength(0);
  });

  test("une copie partie avant l'accusé ne réécrit pas un état ancien ; une copie à jour passe", async () => {
    const { moi } = await compte();
    await moi.mutation(api.ticketsCompte.demander, demande);
    const [{ _id }] = await moi.query(api.ticketsCompte.aTraiter, {});
    await moi.mutation(api.ticketsCompte.prendre, { id: _id });
    const finale = ticket({ statut: "archive", revision: 1 });
    await moi.mutation(api.ticketsCompte.terminer, { id: _id, etat: "confirmee", resultat: "{}", ticket: finale });
    await moi.mutation(api.conversationsCompte.importerConversations, { lot: [{ ...fil, titre: "Arrondi 2" }] });
    const apres = (await moi.query(api.conversationsCompte.liste, {})).find((x) => x.origine === fil.origine);
    expect(apres?.ticket).toBe(finale);
    expect(apres?.titre).toBe("Arrondi 2");
    const plusRecent = ticket({ statut: "archive", revision: 1, raison: "x" });
    await moi.mutation(api.conversationsCompte.importerConversations, { lot: [{ ...fil, ticket: plusRecent }] });
    expect((await moi.query(api.conversationsCompte.liste, {})).find((x) => x.origine === fil.origine)?.ticket).toBe(plusRecent);
  });

  test("un échec ne change pas la copie ; supprimer retire la ligne", async () => {
    const { moi } = await compte();
    await moi.mutation(api.ticketsCompte.demander, demande);
    const [{ _id }] = await moi.query(api.ticketsCompte.aTraiter, {});
    await moi.mutation(api.ticketsCompte.prendre, { id: _id });
    await moi.mutation(api.ticketsCompte.terminer, { id: _id, etat: "echouee", resultat: '{"code":"conflit"}', ticket: ticket({ statut: "archive", revision: 9 }) });
    expect(JSON.parse((await moi.query(api.conversationsCompte.liste, {})).find((x) => x.origine === fil.origine)!.ticket!).statut).toBe("ouvert");

    await moi.mutation(api.ticketsCompte.demander, { ...demande, demandeId: "demande-0002", type: "supprimer" });
    const [autre] = await moi.query(api.ticketsCompte.aTraiter, {});
    await moi.mutation(api.ticketsCompte.prendre, { id: autre._id });
    await moi.mutation(api.ticketsCompte.terminer, { id: autre._id, etat: "confirmee", resultat: "{}", retirer: true });
    expect((await moi.query(api.conversationsCompte.liste, {})).some((x) => x.origine === fil.origine)).toBe(false);
  });

  test("les droits : un autre compte ne voit ni ne termine la demande ; une conversation sans ticket est refusée", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const moi = await connecter(t, "corentin@klyra.design");
    await moi.mutation(api.conversationsCompte.importerConversations, { lot: [fil] });
    await moi.mutation(api.ticketsCompte.demander, demande);
    const [{ _id }] = await moi.query(api.ticketsCompte.aTraiter, {});
    const autre = await connecter(t, "pelin@klyra.design");
    await expect(autre.mutation(api.ticketsCompte.demander, demande)).rejects.toThrow();
    expect(await autre.mutation(api.ticketsCompte.prendre, { id: _id })).toBeNull();
    await expect(autre.mutation(api.ticketsCompte.terminer, { id: _id, etat: "confirmee", resultat: "{}" })).rejects.toThrow();
    expect(await autre.query(api.ticketsCompte.mesDemandes, {})).toEqual([]);
    await expect(moi.mutation(api.ticketsCompte.demander, { ...demande, demandeId: "demande-0009", type: "priorite", valeur: '{"priorite":7}' })).rejects.toThrow();
  });

  test("Confier : le compte lit le rappel, pas de seconde attribution, un rappel d'un autre est refusé", async () => {
    const { moi } = await compte();
    const moiId = (await moi.query(api.equipe.moi, {}))!._id;
    const rappelId = await moi.mutation(api.rappels.creer, { titre: "Relancer Ostral", notes: "Note", jour: null, heure: null, fin: null, echeance: null, priorite: 2, assigneA: moiId, liste: null });
    const confier = { demandeId: "confier-0001", conversationOrigine: "klyra-fil-99999999", type: "confier" as const, valeur: JSON.stringify({ roleId: "hugo", rappel: { source: "compte", id: rappelId } }), revision: 0 };
    await moi.mutation(api.ticketsCompte.demander, confier);
    expect(JSON.parse((await moi.query(api.ticketsCompte.mesDemandes, {}))[0].valeur).rappel).toMatchObject({ titre: "Relancer Ostral", notes: "Note", priorite: 2 });
    await expect(moi.mutation(api.ticketsCompte.demander, { ...confier, demandeId: "confier-0002", conversationOrigine: "klyra-fil-88888888" })).rejects.toThrow();
    /* Un fil ouvert pour ce rappel, copié par l'ordinateur : toujours pas de seconde attribution. */
    const [{ _id }] = await moi.query(api.ticketsCompte.aTraiter, {});
    await moi.mutation(api.ticketsCompte.prendre, { id: _id });
    await moi.mutation(api.ticketsCompte.terminer, { id: _id, etat: "confirmee", resultat: '{"fil":"klyra-fil-99999999"}' });
    await moi.mutation(api.conversationsCompte.importerConversations, { lot: [{ ...fil, origine: "klyra-fil-99999999", ticket: ticket({ rappel: { source: "compte", id: rappelId } }) }] });
    await expect(moi.mutation(api.ticketsCompte.demander, { ...confier, demandeId: "confier-0003", conversationOrigine: "klyra-fil-77777777" })).rejects.toThrow();
    await expect(moi.mutation(api.ticketsCompte.demander, { ...confier, demandeId: "confier-0004", conversationOrigine: "klyra-fil-66666666", valeur: JSON.stringify({ roleId: "absent", rappel: { source: "local", id: "t1" } }) })).rejects.toThrow();
  });
});
