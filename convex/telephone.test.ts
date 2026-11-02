import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { connecter, connecterSession, initialiser, nouvelEssai, patienter } from "./test.utils";

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

/* Réglages › Mobile : uniquement des sessions fictives, ouvertes par les liens simulés de ce backend en mémoire. */
describe("téléphones connectés", () => {
  const page = { numItems: 20, cursor: null };

  async function troisSessions() {
    const t = nouvelEssai();
    await initialiser(t);
    const pc = await connecterSession(t, "corentin@klyra.design");
    await pc.client.mutation(api.postes.signaler, { cle: "poste-pc-0001", systeme: "windows", nom: "PC de Corentin" });
    const iphone = await connecterSession(t, "corentin@klyra.design");
    const navigateur = await connecterSession(t, "corentin@klyra.design");
    return { t, pc, iphone, navigateur };
  }

  test("signaler n'écrit qu'une ligne par session, et vu une fois par minute", async () => {
    const { t, iphone } = await troisSessions();
    await iphone.client.mutation(api.telephones.signaler, { modele: "iphone" });
    const lire = () => t.run((ctx) => ctx.db.query("telephones").withIndex("by_sessionId", (q) => q.eq("sessionId", iphone.sessionId)).collect());
    const [premiere] = await lire();
    await patienter(t, 20_000);
    await iphone.client.mutation(api.telephones.signaler, { modele: "iphone" });
    expect(await lire()).toEqual([premiere]);
    await patienter(t, 45_000);
    await iphone.client.mutation(api.telephones.signaler, { modele: "iphone" });
    const apres = await lire();
    expect(apres).toHaveLength(1);
    expect(apres[0].vu).toBeGreaterThan(premiere.vu);
  });

  test("la liste rend mes autres sessions hors ordinateur, jamais celles d'un autre membre", async () => {
    const { t, pc, iphone, navigateur } = await troisSessions();
    await iphone.client.mutation(api.telephones.signaler, { modele: "iphone" });
    await t.mutation(internal.equipe.initialiser, { admins: [{ email: "pelin@klyra.design", nom: "Pelin" }] });
    const pelin = await connecterSession(t, "pelin@klyra.design");
    await pelin.client.mutation(api.telephones.signaler, { modele: "android" });

    const vue = await pc.client.query(api.telephones.liste, { paginationOpts: page });
    expect(vue.isDone).toBe(true);
    expect(vue.page.map((l) => [l.sessionId, l.modele])).toEqual([
      [navigateur.sessionId, null],
      [iphone.sessionId, "iphone"],
    ]);
    /* Vu depuis l'iPhone : le PC (poste signalé) et l'iPhone lui-même n'y sont pas. */
    const depuisIphone = await iphone.client.query(api.telephones.liste, { paginationOpts: page });
    expect(depuisIphone.page.map((l) => l.sessionId)).toEqual([navigateur.sessionId]);
    const dePelin = await pelin.client.query(api.telephones.liste, { paginationOpts: page });
    expect(dePelin.page).toEqual([]);
  });

  test("au-delà d'une page, les sessions suivantes restent accessibles", async () => {
    const { pc, iphone, navigateur } = await troisSessions();
    const premiere = await pc.client.query(api.telephones.liste, { paginationOpts: { numItems: 1, cursor: null } });
    expect(premiere.isDone).toBe(false);
    const vus = [...premiere.page.map((l) => l.sessionId)];
    let curseur = premiere.continueCursor;
    for (let tour = 0; tour < 5; tour += 1) {
      const suite = await pc.client.query(api.telephones.liste, { paginationOpts: { numItems: 1, cursor: curseur } });
      vus.push(...suite.page.map((l) => l.sessionId));
      curseur = suite.continueCursor;
      if (suite.isDone) break;
    }
    expect(vus).toEqual([navigateur.sessionId, iphone.sessionId]);
  });

  test("déconnecter refuse la session d'un autre membre, celle-ci et celle d'un ordinateur", async () => {
    const { t, pc, iphone } = await troisSessions();
    await t.mutation(internal.equipe.initialiser, { admins: [{ email: "pelin@klyra.design", nom: "Pelin" }] });
    const pelin = await connecterSession(t, "pelin@klyra.design");
    await expect(pelin.client.mutation(api.telephones.deconnecter, { sessionId: iphone.sessionId })).rejects.toThrow(/introuvable/);
    await expect(iphone.client.mutation(api.telephones.deconnecter, { sessionId: iphone.sessionId })).rejects.toThrow(/session_actuelle/);
    await expect(iphone.client.mutation(api.telephones.deconnecter, { sessionId: pc.sessionId })).rejects.toThrow(/session_ordinateur/);
    expect(await iphone.client.query(api.equipe.statutSession, {})).toBe("membre");
  });

  test("après déconnecter, la session est refusée tout de suite ; l'ordinateur ne change pas", async () => {
    const { t, pc, iphone } = await troisSessions();
    await pc.client.mutation(api.conversationsCompte.importerConversations, { lot: [conversation] });
    await iphone.client.mutation(api.telephones.signaler, { modele: "iphone" });
    expect(await iphone.client.query(api.conversationsCompte.liste, {})).toHaveLength(1);

    await pc.client.mutation(api.telephones.deconnecter, { sessionId: iphone.sessionId });

    /* Même jeton d'accès, encore valable pour Convex Auth : refusé sans attendre son expiration. */
    await expect(iphone.client.query(api.conversationsCompte.liste, {})).rejects.toThrow(/non_connecte/);
    await expect(iphone.client.mutation(api.conversationsCompte.laisser, { conversationOrigine: "dm-hugo", texte: "x" })).rejects.toThrow(/non_connecte/);
    expect(await iphone.client.query(api.equipe.moi, {})).toBeNull();
    expect(await iphone.client.query(api.equipe.statutSession, {})).toBe("session_fermee");
    const restes = await t.run(async (ctx) => ({
      session: await ctx.db.get("authSessions", iphone.sessionId),
      jetons: await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", iphone.sessionId)).collect(),
      lignes: await ctx.db.query("telephones").withIndex("by_sessionId", (q) => q.eq("sessionId", iphone.sessionId)).collect(),
    }));
    expect(restes).toEqual({ session: null, jetons: [], lignes: [] });

    expect(await pc.client.query(api.conversationsCompte.liste, {})).toHaveLength(1);
    expect(await pc.client.query(api.equipe.statutSession, {})).toBe("membre");
    expect((await pc.client.query(api.telephones.liste, { paginationOpts: page })).page.map((l) => l.sessionId)).not.toContain(iphone.sessionId);
  });

  test("une session fermée par signOut sur le téléphone disparaît de la liste", async () => {
    const { pc, iphone, navigateur } = await troisSessions();
    await iphone.client.mutation(api.telephones.signaler, { modele: "iphone" });
    await iphone.client.action(api.auth.signOut, {});
    const vue = await pc.client.query(api.telephones.liste, { paginationOpts: page });
    expect(vue.page.map((l) => l.sessionId)).toEqual([navigateur.sessionId]);
  });

  test("un membre retiré reste « retiré », pas « session fermée »", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const corentin = await connecter(t, "corentin@klyra.design");
    await corentin.mutation(api.equipe.inviter, { email: "yanis@klyra.design", nom: "Yanis", role: "membre" });
    const yanis = await connecter(t, "yanis@klyra.design");
    const membres = await corentin.query(api.equipe.membres, {});
    await corentin.mutation(api.equipe.retirer, { membreId: membres.find((m) => m.email === "yanis@klyra.design")!._id });
    expect(await yanis.query(api.equipe.statutSession, {})).toBe("retire");
  });

  test("l'adresse de l'app : null sans KLYRA_APP_URL, l'adresse https sinon", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const corentin = await connecter(t, "corentin@klyra.design");
    expect(await corentin.query(api.telephones.adresseApp, {})).toBeNull();
    vi.stubEnv("KLYRA_APP_URL", "https://app.exemple.test/");
    expect(await corentin.query(api.telephones.adresseApp, {})).toBe("https://app.exemple.test");
    vi.stubEnv("KLYRA_APP_URL", "klyra://pas-une-page");
    expect(await corentin.query(api.telephones.adresseApp, {})).toBeNull();
    vi.unstubAllEnvs();
    await expect(t.query(api.telephones.adresseApp, {})).rejects.toThrow(/non_connecte/);
  });
});
