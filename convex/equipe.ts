import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { autreAdminActif, erreur, exigerAdmin, exigerMembre, membreActuel } from "./model/acces";
import { estEmail, estTeinte, nettoyerNom, normaliserEmail, vRole } from "./model/valeurs";

const vMembre = v.object({
  _id: v.id("membres"),
  email: v.string(),
  nom: v.string(),
  intitule: v.string(),
  couleur: v.string(),
  role: vRole,
});

function vueMembre(m: Doc<"membres">) {
  return { _id: m._id, email: m.email, nom: m.nom, intitule: m.intitule, couleur: m.couleur, role: m.role };
}

/** La personne connectée, ou null (pas de session, ou plus membre). */
export const moi = query({
  args: {},
  returns: v.union(vMembre, v.null()),
  handler: async (ctx) => {
    const membre = await membreActuel(ctx);
    return membre ? vueMembre(membre) : null;
  },
});

/** L'équipe : les membres actifs, visibles par tous les membres. */
export const membres = query({
  args: {},
  returns: v.array(vMembre),
  handler: async (ctx) => {
    await exigerMembre(ctx);
    const liste = await ctx.db
      .query("membres")
      .withIndex("by_actif_and_role", (q) => q.eq("actif", true))
      .take(200);
    return liste.map(vueMembre).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  },
});

/** Les invitations qui attendent une première connexion : admins seulement. */
export const invitationsEnAttente = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("invitations"), email: v.string(), nom: v.string(), role: vRole })),
  handler: async (ctx) => {
    await exigerAdmin(ctx);
    const liste = await ctx.db
      .query("invitations")
      .withIndex("by_statut", (q) => q.eq("statut", "en_attente"))
      .take(100);
    return liste.map((i) => ({ _id: i._id, email: i.email, nom: i.nom, role: i.role }));
  },
});

async function ajouterInvitation(
  ctx: MutationCtx,
  entree: { email: string; nom: string; role: Doc<"invitations">["role"] },
  inviteePar: Doc<"membres">["_id"] | null,
): Promise<"ajoutee" | "deja_membre" | "deja_invitee"> {
  const email = normaliserEmail(entree.email);
  const nom = nettoyerNom(entree.nom);
  if (!estEmail(email)) throw erreur("adresse_invalide");
  if (nom === null) throw erreur("nom_invalide");
  const membre = await ctx.db
    .query("membres")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (membre?.actif) return "deja_membre";
  const enAttente = await ctx.db
    .query("invitations")
    .withIndex("by_email_and_statut", (q) => q.eq("email", email).eq("statut", "en_attente"))
    .first();
  if (enAttente) return "deja_invitee";
  await ctx.db.insert("invitations", { email, nom, role: entree.role, inviteePar, statut: "en_attente" });
  return "ajoutee";
}

/** Inviter une adresse : elle pourra demander un lien de connexion. */
export const inviter = mutation({
  args: { email: v.string(), nom: v.string(), role: vRole },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await exigerAdmin(ctx);
    const resultat = await ajouterInvitation(ctx, args, admin._id);
    if (resultat !== "ajoutee") throw erreur(resultat);
    return null;
  },
});

export const annulerInvitation = mutation({
  args: { invitationId: v.id("invitations") },
  returns: v.null(),
  handler: async (ctx, { invitationId }) => {
    await exigerAdmin(ctx);
    const invitation = await ctx.db.get("invitations", invitationId);
    if (invitation === null || invitation.statut !== "en_attente") throw erreur("introuvable");
    await ctx.db.patch("invitations", invitationId, { statut: "annulee" });
    return null;
  },
});

export const changerRole = mutation({
  args: { membreId: v.id("membres"), role: vRole },
  returns: v.null(),
  handler: async (ctx, { membreId, role }) => {
    await exigerAdmin(ctx);
    const membre = await ctx.db.get("membres", membreId);
    if (membre === null || !membre.actif) throw erreur("introuvable");
    if (membre.role === "admin" && role !== "admin" && !(await autreAdminActif(ctx, membreId))) throw erreur("dernier_admin");
    await ctx.db.patch("membres", membreId, { role });
    return null;
  },
});

/** Retirer quelqu'un de l'équipe : ses sessions sont fermées, il ne peut plus se connecter. */
export const retirer = mutation({
  args: { membreId: v.id("membres") },
  returns: v.null(),
  handler: async (ctx, { membreId }) => {
    await exigerAdmin(ctx);
    const membre = await ctx.db.get("membres", membreId);
    if (membre === null || !membre.actif) throw erreur("introuvable");
    if (membre.role === "admin" && !(await autreAdminActif(ctx, membreId))) throw erreur("dernier_admin");
    await ctx.db.patch("membres", membreId, { actif: false });
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", membre.userId))
      .take(100);
    for (const session of sessions) {
      const jetons = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .take(500);
      for (const jeton of jetons) await ctx.db.delete("authRefreshTokens", jeton._id);
      await ctx.db.delete("authSessions", session._id);
    }
    return null;
  },
});

export const modifierMonProfil = mutation({
  args: { nom: v.string(), intitule: v.string(), couleur: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membre = await exigerMembre(ctx);
    const nom = nettoyerNom(args.nom);
    const intitule = args.intitule.trim() === "" ? "" : nettoyerNom(args.intitule);
    if (nom === null || intitule === null) throw erreur("nom_invalide");
    if (!estTeinte(args.couleur)) throw erreur("couleur_invalide");
    await ctx.db.patch("membres", membre._id, { nom, intitule, couleur: args.couleur });
    return null;
  },
});

/**
 * L'équipe de départ, une seule fois par déploiement (`npx convex run equipe:initialiser`).
 * Les adresses sont passées en argument : elles ne sont pas écrites dans le dépôt.
 */
export const initialiser = internalMutation({
  args: { admins: v.array(v.object({ email: v.string(), nom: v.string() })) },
  returns: v.array(v.object({ email: v.string(), resultat: v.string() })),
  handler: async (ctx, { admins }) => {
    const resultats = [];
    for (const admin of admins) {
      const resultat = await ajouterInvitation(ctx, { ...admin, role: "admin" }, null);
      resultats.push({ email: normaliserEmail(admin.email), resultat });
    }
    return resultats;
  },
});
