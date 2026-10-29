import { PostShiba } from "@postshiba/convex";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { env, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { courrielConnexion, EXPEDITEUR_CONNEXION, type Courriel } from "./model/contenus";

/** PostShiba envoie seulement si la clé, l'équipe et le cluster sont posés sur le déploiement. */
const configuration =
  env.POSTSHIBA_API_KEY && env.POSTSHIBA_TEAM_ID && env.POSTSHIBA_CLUSTER_ID
    ? { apiKey: env.POSTSHIBA_API_KEY, teamId: env.POSTSHIBA_TEAM_ID, clusterId: env.POSTSHIBA_CLUSTER_ID }
    : null;

/* Offre Nano : 100 e-mails par heure, d'où la limite juste en dessous. */
const postshiba = configuration ? new PostShiba(components.postshiba, { ...configuration, testMode: false, hourlyLimit: 90 }) : null;

/**
 * Sans PostShiba, un déploiement de développement peut garder les e-mails dans
 * `courrielsSimules` (KLYRA_COURRIEL_SIMULE=1). Sinon, l'envoi échoue : jamais de lien perdu sans le dire.
 */
async function envoyer(ctx: MutationCtx, de: string, a: string, courriel: Courriel): Promise<void> {
  if (env.KLYRA_COURRIEL_SIMULE === "1") {
    await ctx.db.insert("courrielsSimules", { a, sujet: courriel.sujet, texte: courriel.texte });
    return;
  }
  if (postshiba === null) {
    throw new Error("L’envoi des e-mails n’est pas configuré sur ce déploiement (POSTSHIBA_API_KEY, _TEAM_ID ou _CLUSTER_ID absente).");
  }
  await postshiba.sendEmail(ctx, { from: de, to: a, subject: courriel.sujet, text: courriel.texte, html: courriel.html });
}

/** Appelée par le fournisseur `postshiba` de Convex Auth (`convex/auth.ts`). */
export const envoyerLienConnexion = internalMutation({
  args: { a: v.string(), lien: v.string() },
  returns: v.null(),
  handler: async (ctx, { a, lien }) => {
    await envoyer(ctx, EXPEDITEUR_CONNEXION, a, courrielConnexion(lien));
    return null;
  },
});

/** Tests et essais en développement : le dernier e-mail simulé pour une adresse. */
export const dernierCourrielSimule = internalQuery({
  args: { a: v.string() },
  returns: v.union(v.object({ sujet: v.string(), texte: v.string() }), v.null()),
  handler: async (ctx, { a }) => {
    const courriel = await ctx.db
      .query("courrielsSimules")
      .withIndex("by_a", (q) => q.eq("a", a))
      .order("desc")
      .first();
    return courriel ? { sujet: courriel.sujet, texte: courriel.texte } : null;
  },
});
