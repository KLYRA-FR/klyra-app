import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CodeErreur } from "./valeurs";

export function erreur(code: CodeErreur): ConvexError<CodeErreur> {
  return new ConvexError(code);
}

/** La personne connectée, si elle est membre actif de l'équipe. L'identité vient toujours de la session. */
export async function membreActuel(ctx: QueryCtx): Promise<Doc<"membres"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const membre = await ctx.db
    .query("membres")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  return membre?.actif ? membre : null;
}

export async function exigerMembre(ctx: QueryCtx): Promise<Doc<"membres">> {
  const membre = await membreActuel(ctx);
  if (membre === null) throw erreur("non_connecte");
  return membre;
}

export async function exigerAdmin(ctx: QueryCtx): Promise<Doc<"membres">> {
  const membre = await exigerMembre(ctx);
  if (membre.role !== "admin") throw erreur("reserve_aux_admins");
  return membre;
}

/** Vrai s'il reste au moins un autre admin actif que `membreId`. */
export async function autreAdminActif(ctx: QueryCtx, membreId: Doc<"membres">["_id"]): Promise<boolean> {
  const admins = await ctx.db
    .query("membres")
    .withIndex("by_actif_and_role", (q) => q.eq("actif", true).eq("role", "admin"))
    .take(2);
  return admins.some((a) => a._id !== membreId);
}
