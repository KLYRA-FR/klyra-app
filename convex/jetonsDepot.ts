import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, query, type QueryCtx } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";
import { HEURE_MS, JETONS_PAR_HEURE, normaliserDepot, vRoleDepot } from "./model/depots";
import { normaliserEmail } from "./model/valeurs";

/**
 * Qui peut demander un jeton GitHub, et pour quel dépôt. Accorder et retirer sont internes : ils se
 * lancent depuis le tableau de bord Convex ou `npx convex run`, aucun écran ni agent ne peut s'accorder
 * un accès. La demande elle-même est dans `jetonsDepotEnvoi.ts` (Node, pour signer).
 */

function depotValide(depot: string) {
  const lu = normaliserDepot(depot);
  if (lu === null) throw erreur("depot_invalide");
  return lu;
}

async function accesDe(ctx: QueryCtx, membreId: Doc<"membres">["_id"], depot: string) {
  return await ctx.db
    .query("accesDepots")
    .withIndex("by_membre_and_depot", (q) => q.eq("membreId", membreId).eq("depot", depot))
    .unique();
}

async function membreParEmail(ctx: QueryCtx, email: string) {
  return await ctx.db
    .query("membres")
    .withIndex("by_email", (q) => q.eq("email", normaliserEmail(email)))
    .unique();
}

/** Les dépôts sur lesquels la personne connectée peut demander un jeton. */
export const mesDepots = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const membre = await exigerMembre(ctx);
    const acces = await ctx.db
      .query("accesDepots")
      .withIndex("by_membre_and_depot", (q) => q.eq("membreId", membre._id))
      .take(200);
    return acces.map((a) => a.depot);
  },
});

export const accorder = internalMutation({
  args: { email: v.string(), depot: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { complet } = depotValide(args.depot);
    const membre = await membreParEmail(ctx, args.email);
    if (membre === null || !membre.actif) throw erreur("membre_inconnu");
    if ((await accesDe(ctx, membre._id, complet)) === null) {
      await ctx.db.insert("accesDepots", { membreId: membre._id, depot: complet, cree: Date.now() });
    }
    return null;
  },
});

export const retirer = internalMutation({
  args: { email: v.string(), depot: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { complet } = depotValide(args.depot);
    const membre = await membreParEmail(ctx, args.email);
    const acces = membre === null ? null : await accesDe(ctx, membre._id, complet);
    if (acces !== null) await ctx.db.delete("accesDepots", acces._id);
    return null;
  },
});

/**
 * Vérifie le droit et note la demande, avant tout appel à GitHub. Dans une mutation : deux demandes
 * simultanées se suivent, la limite ne se contourne pas. La trace ne contient jamais le jeton.
 */
export const reserver = internalMutation({
  args: { depot: v.string(), role: vRoleDepot },
  returns: v.object({ proprietaire: v.string(), nom: v.string() }),
  handler: async (ctx, args) => {
    const membre = await exigerMembre(ctx);
    const { complet, proprietaire, nom } = depotValide(args.depot);
    if ((await accesDe(ctx, membre._id, complet)) === null) throw erreur("depot_non_autorise");
    const maintenant = Date.now();
    const recentes = await ctx.db
      .query("demandesJetonDepot")
      .withIndex("by_membre_and_cree", (q) => q.eq("membreId", membre._id).gt("cree", maintenant - HEURE_MS))
      .take(JETONS_PAR_HEURE);
    if (recentes.length >= JETONS_PAR_HEURE) throw erreur("trop_tot");
    await ctx.db.insert("demandesJetonDepot", { membreId: membre._id, depot: complet, role: args.role, cree: maintenant });
    return { proprietaire, nom };
  },
});
