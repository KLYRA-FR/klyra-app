import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { connecter, demanderLien, dernierLien, initialiser, nouvelEssai, ouvrirLien } from "./test.utils";

describe("lien magique", () => {
  test("une adresse ni invitée ni membre : refusée avant tout envoi, aucun compte créé", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    await expect(demanderLien(t, "inconnu@example.com")).rejects.toThrow(/connexion_refusee/);
    expect(await dernierLien(t, "inconnu@example.com")).toBeNull();
    const comptes = await t.run((ctx) => ctx.db.query("users").take(10));
    expect(comptes).toHaveLength(0);
  });

  test("une adresse sous une autre forme est refusée : l'app envoie l'adresse normalisée", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    await expect(demanderLien(t, "Corentin@Klyra.design")).rejects.toThrow(/connexion_refusee/);
    await expect(demanderLien(t, " corentin@klyra.design")).rejects.toThrow(/connexion_refusee/);
  });

  test("une adresse invitée reçoit un lien vers la page relais, valable une fois", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    await demanderLien(t, "corentin@klyra.design");
    const lien = await dernierLien(t, "corentin@klyra.design");
    expect(lien?.lien).toMatch(/^https:\/\/essai\.convex\.site\/connexion\?code=[A-Za-z0-9]{32}$/);

    await expect(ouvrirLien(t, "pelin@klyra.design", lien!.code)).rejects.toThrow(/Could not verify code/);
    const { tokens } = await ouvrirLien(t, "corentin@klyra.design", lien!.code);
    expect(tokens?.token).toBeTruthy();
    await expect(ouvrirLien(t, "corentin@klyra.design", lien!.code)).rejects.toThrow(/Could not verify code/);
  });

  test("la première connexion fait de l'invitation un membre, avec son rôle", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const corentin = await connecter(t, "corentin@klyra.design");
    expect(await corentin.query(api.equipe.moi, {})).toMatchObject({
      email: "corentin@klyra.design",
      nom: "Corentin",
      role: "admin",
      couleur: "bleu-k1",
    });
    const invitations = await t.run((ctx) => ctx.db.query("invitations").take(10));
    expect(invitations.find((i) => i.email === "corentin@klyra.design")?.statut).toBe("acceptee");

    /* Une seconde connexion ne crée ni compte ni membre de plus. */
    await connecter(t, "corentin@klyra.design");
    const membres = await t.run((ctx) => ctx.db.query("membres").take(10));
    const comptes = await t.run((ctx) => ctx.db.query("users").take(10));
    expect(membres).toHaveLength(1);
    expect(comptes).toHaveLength(1);
  });

  test("une invitation annulée ne permet plus de demander un lien", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const corentin = await connecter(t, "corentin@klyra.design");
    const [pelin] = await corentin.query(api.equipe.invitationsEnAttente, {});
    await corentin.mutation(api.equipe.annulerInvitation, { invitationId: pelin._id });
    await expect(demanderLien(t, "pelin@klyra.design")).rejects.toThrow(/connexion_refusee/);
  });

  test("une personne retirée perd sa session et ne peut plus se connecter, jusqu'à une nouvelle invitation", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const corentin = await connecter(t, "corentin@klyra.design");
    const pelin = await connecter(t, "pelin@klyra.design");
    const membrePelin = (await corentin.query(api.equipe.membres, {})).find((m) => m.email === "pelin@klyra.design")!;

    await corentin.mutation(api.equipe.retirer, { membreId: membrePelin._id });
    expect(await pelin.query(api.equipe.moi, {})).toBeNull();
    await expect(pelin.query(api.equipe.membres, {})).rejects.toThrow(/non_connecte/);
    const sessions = await t.run((ctx) => ctx.db.query("authSessions").take(10));
    expect(sessions).toHaveLength(1);
    await expect(demanderLien(t, "pelin@klyra.design")).rejects.toThrow(/connexion_refusee/);

    await corentin.mutation(api.equipe.inviter, { email: "pelin@klyra.design", nom: "Pelin", role: "membre" });
    const deRetour = await connecter(t, "pelin@klyra.design");
    expect(await deRetour.query(api.equipe.moi, {})).toMatchObject({ role: "membre" });
    const membres = await t.run((ctx) => ctx.db.query("membres").take(10));
    expect(membres).toHaveLength(2);
  });
});

describe("page relais du lien", () => {
  test("un code valable ouvre klyra://connexion", async () => {
    const t = nouvelEssai();
    const code = "A".repeat(32);
    const reponse = await t.fetch(`/connexion?code=${code}`);
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await reponse.text()).toContain(`klyra://connexion?code=${code}`);
  });

  test("un code mal formé n'ouvre rien et n'est pas recopié dans la page", async () => {
    const t = nouvelEssai();
    const reponse = await t.fetch(`/connexion?code=${encodeURIComponent('"><script>alert(1)</script>')}`);
    expect(reponse.status).toBe(400);
    const page = await reponse.text();
    expect(page).not.toContain("klyra://");
    expect(page).not.toContain("<script>");
  });
});
