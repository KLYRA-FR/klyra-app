import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { connecter, initialiser, nouvelEssai, type Essai } from "./test.utils";

/** Corentin (admin) et Yanis, invité comme membre puis connecté. */
async function equipe(t: Essai) {
  await initialiser(t, [{ email: "corentin@klyra.design", nom: "Corentin" }]);
  const admin = await connecter(t, "corentin@klyra.design");
  await admin.mutation(api.equipe.inviter, { email: "yanis@klyra.design", nom: "Yanis", role: "membre" });
  const membre = await connecter(t, "yanis@klyra.design");
  return { admin, membre };
}

describe("équipe : sans session", () => {
  test("rien n'est lisible ni modifiable", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    expect(await t.query(api.equipe.moi, {})).toBeNull();
    await expect(t.query(api.equipe.membres, {})).rejects.toThrow(/non_connecte/);
    await expect(t.query(api.equipe.invitationsEnAttente, {})).rejects.toThrow(/non_connecte/);
    await expect(t.mutation(api.equipe.inviter, { email: "x@klyra.design", nom: "X", role: "admin" })).rejects.toThrow(
      /non_connecte/,
    );
  });

  test("une session d'un compte qui n'est pas membre ne donne rien", async () => {
    const t = nouvelEssai();
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "inconnu@example.com" }));
    const sessionId = await t.run((ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 60_000 }));
    const intrus = t.withIdentity({ subject: `${userId}|${sessionId}` });
    expect(await intrus.query(api.equipe.moi, {})).toBeNull();
    await expect(intrus.query(api.equipe.membres, {})).rejects.toThrow(/non_connecte/);
  });
});

describe("équipe : membre", () => {
  test("voit l'équipe, pas les invitations, et ne gère rien", async () => {
    const t = nouvelEssai();
    const { membre } = await equipe(t);
    const liste = await membre.query(api.equipe.membres, {});
    expect(liste.map((m) => m.email)).toEqual(["corentin@klyra.design", "yanis@klyra.design"]);
    const corentin = liste[0];

    await expect(membre.query(api.equipe.invitationsEnAttente, {})).rejects.toThrow(/reserve_aux_admins/);
    await expect(membre.mutation(api.equipe.inviter, { email: "x@klyra.design", nom: "X", role: "membre" })).rejects.toThrow(
      /reserve_aux_admins/,
    );
    await expect(membre.mutation(api.equipe.changerRole, { membreId: corentin._id, role: "membre" })).rejects.toThrow(
      /reserve_aux_admins/,
    );
    await expect(membre.mutation(api.equipe.retirer, { membreId: corentin._id })).rejects.toThrow(/reserve_aux_admins/);
  });

  test("modifie son propre profil, avec un nom et une teinte valables", async () => {
    const t = nouvelEssai();
    const { membre } = await equipe(t);
    await membre.mutation(api.equipe.modifierMonProfil, { nom: "  Yanis   B. ", intitule: "Dev", couleur: "violet" });
    expect(await membre.query(api.equipe.moi, {})).toMatchObject({ nom: "Yanis B.", intitule: "Dev", couleur: "violet" });

    await expect(membre.mutation(api.equipe.modifierMonProfil, { nom: " ", intitule: "", couleur: "violet" })).rejects.toThrow(
      /nom_invalide/,
    );
    await expect(
      membre.mutation(api.equipe.modifierMonProfil, { nom: "Yanis", intitule: "", couleur: "#ff0000" }),
    ).rejects.toThrow(/couleur_invalide/);
  });
});

describe("équipe : admin", () => {
  test("invite, refuse les doublons et les adresses invalides, normalise l'adresse", async () => {
    const t = nouvelEssai();
    const { admin } = await equipe(t);
    await admin.mutation(api.equipe.inviter, { email: "  Nouvelle@Klyra.design ", nom: "Nouvelle", role: "membre" });
    expect(await admin.query(api.equipe.invitationsEnAttente, {})).toEqual([
      expect.objectContaining({ email: "nouvelle@klyra.design", nom: "Nouvelle", role: "membre" }),
    ]);

    await expect(admin.mutation(api.equipe.inviter, { email: "nouvelle@klyra.design", nom: "N", role: "membre" })).rejects.toThrow(
      /deja_invitee/,
    );
    await expect(admin.mutation(api.equipe.inviter, { email: "yanis@klyra.design", nom: "Y", role: "membre" })).rejects.toThrow(
      /deja_membre/,
    );
    await expect(admin.mutation(api.equipe.inviter, { email: "pas-une-adresse", nom: "X", role: "membre" })).rejects.toThrow(
      /adresse_invalide/,
    );
    await expect(admin.mutation(api.equipe.inviter, { email: "x@klyra.design", nom: "  ", role: "membre" })).rejects.toThrow(
      /nom_invalide/,
    );
  });

  test("change un rôle, mais le dernier admin ne peut ni redevenir membre ni être retiré", async () => {
    const t = nouvelEssai();
    const { admin, membre } = await equipe(t);
    const [corentin, yanis] = await admin.query(api.equipe.membres, {});

    await expect(admin.mutation(api.equipe.changerRole, { membreId: corentin._id, role: "membre" })).rejects.toThrow(
      /dernier_admin/,
    );
    await expect(admin.mutation(api.equipe.retirer, { membreId: corentin._id })).rejects.toThrow(/dernier_admin/);

    await admin.mutation(api.equipe.changerRole, { membreId: yanis._id, role: "admin" });
    expect(await membre.query(api.equipe.invitationsEnAttente, {})).toEqual([]);
    await membre.mutation(api.equipe.changerRole, { membreId: corentin._id, role: "membre" });
    expect(await admin.query(api.equipe.moi, {})).toMatchObject({ role: "membre" });
  });

  test("l'équipe de départ ne s'ajoute qu'une fois", async () => {
    const t = nouvelEssai();
    expect(await initialiser(t)).toEqual([
      { email: "corentin@klyra.design", resultat: "ajoutee" },
      { email: "pelin@klyra.design", resultat: "ajoutee" },
    ]);
    expect(await initialiser(t)).toEqual([
      { email: "corentin@klyra.design", resultat: "deja_invitee" },
      { email: "pelin@klyra.design", resultat: "deja_invitee" },
    ]);
  });
});
