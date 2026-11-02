import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CodeErreur } from "./valeurs";

export function erreur(code: CodeErreur): ConvexError<CodeErreur> {
  return new ConvexError(code);
}

/**
 * La session de la requête, si elle existe encore. Le jeton d'accès de Convex Auth (0.0.96) vaut
 * une heure : sans cette lecture, une session fermée à distance (`telephones:deconnecter`) ou par
 * `equipe:retirer` resterait valable jusqu'à son expiration.
 */
export async function sessionActuelle(ctx: QueryCtx): Promise<Doc<"authSessions"> | null> {
  const brut = await getAuthSessionId(ctx);
  const sessionId = brut === null ? null : ctx.db.normalizeId("authSessions", brut);
  return sessionId === null ? null : await ctx.db.get("authSessions", sessionId);
}

/** Ce que la session dit de la personne : membre actif, retirée de l'équipe, ou session fermée. */
export async function statutSession(ctx: QueryCtx): Promise<{ statut: "anonyme" | "session_fermee" | "retire" } | { statut: "membre"; membre: Doc<"membres"> }> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return { statut: "anonyme" };
  const membre = await ctx.db
    .query("membres")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  /* Retirer quelqu'un ferme aussi ses sessions : le retrait passe avant. */
  if (membre && !membre.actif) return { statut: "retire" };
  if ((await sessionActuelle(ctx)) === null) return { statut: "session_fermee" };
  return membre ? { statut: "membre", membre } : { statut: "retire" };
}

/** La personne connectée, si elle est membre actif de l'équipe et que sa session existe encore. L'identité vient toujours de la session. */
export async function membreActuel(ctx: QueryCtx): Promise<Doc<"membres"> | null> {
  const lu = await statutSession(ctx);
  return lu.statut === "membre" ? lu.membre : null;
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
