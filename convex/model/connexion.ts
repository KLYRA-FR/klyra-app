import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { erreur } from "./acces";
import { reserverLien } from "./limites";
import { couleurSuivante, normaliserEmail } from "./valeurs";

/** Une adresse qui peut recevoir un lien : membre actif, ou invitation en attente (mêmes règles que plus bas). */
export async function peutRecevoirUnLien(ctx: QueryCtx, email: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
  const membre = user
    ? await ctx.db
        .query("membres")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .unique()
    : null;
  if (membre?.actif) return true;
  const invitation = await ctx.db
    .query("invitations")
    .withIndex("by_email_and_statut", (q) => q.eq("email", email).eq("statut", "en_attente"))
    .first();
  return invitation !== null;
}

type Etape = "oauth" | "credentials" | "email" | "phone" | "verification";

/**
 * Rappel `createOrUpdateUser` de Convex Auth, appelé deux fois pour un lien magique :
 * - `email` : à la demande du lien, avant tout envoi. Une adresse ni membre actif ni
 *   invitée est refusée ici : aucun compte n'est créé et aucun e-mail ne part.
 * - `verification` : à l'ouverture du lien. La personne invitée devient membre.
 */
export async function accepterConnexion(
  ctx: MutationCtx,
  args: { existingUserId: Id<"users"> | null; type: Etape; profile: Record<string, unknown> },
): Promise<Id<"users">> {
  const email = typeof args.profile.email === "string" ? args.profile.email : null;
  /* L'app envoie l'adresse déjà normalisée : une autre forme créerait un second compte. */
  if (email === null || email !== normaliserEmail(email) || (args.type !== "email" && args.type !== "verification")) {
    throw erreur("connexion_refusee");
  }

  const existant =
    args.existingUserId ??
    (await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first())?._id ??
    null;
  const membre = existant
    ? await ctx.db
        .query("membres")
        .withIndex("by_userId", (q) => q.eq("userId", existant))
        .unique()
    : null;
  const invitation = await ctx.db
    .query("invitations")
    .withIndex("by_email_and_statut", (q) => q.eq("email", email).eq("statut", "en_attente"))
    .first();
  if (!membre?.actif && invitation === null) throw erreur("connexion_refusee");

  /* Demande de lien : le délai (`limites.ts`) a déjà été appliqué par `connexion:demanderLien`, qui
     laisse un ticket ; un appel direct à `auth:signIn` (ancienne version de l'app) passe ici par le
     même délai. Refusé, rien n'est écrit : le lien déjà envoyé reste valable. */
  if (args.type === "email") {
    const ticket = await ctx.db
      .query("ticketsLien")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    const maintenant = Date.now();
    if (ticket) await ctx.db.delete("ticketsLien", ticket._id);
    if (!ticket || ticket.expire <= maintenant) {
      const reservation = await reserverLien(ctx, email, maintenant);
      if (!reservation.acceptee) throw erreur("trop_tot");
    }
  }

  const userId = existant ?? (await ctx.db.insert("users", { email }));
  if (args.type === "email") return userId;

  await ctx.db.patch("users", userId, { emailVerificationTime: Date.now() });
  if (membre?.actif || invitation === null) return userId;

  if (membre) {
    await ctx.db.patch("membres", membre._id, { actif: true, role: invitation.role });
  } else {
    const membres = await ctx.db.query("membres").take(200);
    await ctx.db.insert("membres", {
      userId,
      email,
      nom: invitation.nom,
      intitule: "",
      couleur: couleurSuivante(membres.length),
      role: invitation.role,
      actif: true,
    });
  }
  await ctx.db.patch("invitations", invitation._id, { statut: "acceptee" });
  return userId;
}
