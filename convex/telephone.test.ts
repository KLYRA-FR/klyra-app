import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { connecter, initialiser, nouvelEssai, patienter } from "./test.utils";

const conversation = {
  origine: "dm-hugo",
  kind: "direct" as const,
  titre: "Hugo",
  projetId: null,
  projetNom: null,
  roleIds: ["hugo"],
  misAJour: "2026-11-01T00:00:00.000Z",
  epingleLe: null,
  extrait: "Salut",
  extraitLe: null,
  nonLus: 0,
  taches: "[]",
};

describe("téléphone", () => {
  test("une demande web parle d'appareil et n'envoie pas klyra://", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    await t.mutation(api.connexion.demanderLien, { email: "corentin@klyra.design", cible: "web" });
    await patienter(t, 50);
    const courriel = await t.query(internal.courriels.dernierCourrielSimule, { a: "corentin@klyra.design" });
    expect(courriel?.texte).toContain("appareil");
    expect(courriel?.texte).toContain("cible=web");
    expect(courriel?.texte).not.toContain("klyra://");
  });

  test("le poste est ouvert puis fermé sans nouveau signal", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const corentin = await connecter(t, "corentin@klyra.design");
    await corentin.mutation(api.postes.signaler, { cle: "poste-mac-1", systeme: "mac", nom: "Mac de Corentin" });
    expect((await corentin.query(api.postes.etat, {}))[0]?.ouvert).toBe(true);
    await patienter(t, 30_000);
    expect((await corentin.query(api.postes.etat, {}))[0]?.ouvert).toBe(false);
  });

  test("la même conversation est reprise, pas doublée, et un message ne part qu'une fois", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const corentin = await connecter(t, "corentin@klyra.design");
    await corentin.mutation(api.conversationsCompte.importerConversations, { lot: [conversation] });
    await corentin.mutation(api.conversationsCompte.importerConversations, { lot: [{ ...conversation, titre: "Hugo 2" }] });
    const liste = await corentin.query(api.conversationsCompte.liste, {});
    expect(liste).toHaveLength(1);
    expect(liste[0]?.titre).toBe("Hugo 2");
    const id = await corentin.mutation(api.conversationsCompte.laisser, { conversationOrigine: "dm-hugo", texte: "Depuis le téléphone" });
    expect(await corentin.mutation(api.conversationsCompte.prendre, { id })).toEqual({
      conversationOrigine: "dm-hugo",
      texte: "Depuis le téléphone",
    });
    expect(await corentin.mutation(api.conversationsCompte.prendre, { id })).toBeNull();
  });
});
