import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { erreur, exigerMembre, sessionActuelle } from "./model/acces";
import { prevenirOuverture } from "./notificationsPush";

/** Sans signal pendant ce délai, le téléphone dit le poste fermé (2,5 × 10 s). */
export const OUVERT_MS = 25_000;

const vSysteme = v.union(v.literal("mac"), v.literal("windows"), v.literal("autre"));

/** L'ordinateur dit qu'il est ouvert. Le téléphone n'appelle pas cette fonction. */
export const signaler = mutation({
  args: { cle: v.string(), systeme: vSysteme, nom: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const nom = args.nom.trim();
    if (!/^[\w-]{8,80}$/.test(args.cle) || nom.length < 1 || nom.length > 80) throw erreur("poste_invalide");
    const existant = await ctx.db
      .query("postes")
      .withIndex("by_membre_and_cle", (q) => q.eq("membreId", moi._id).eq("cle", args.cle))
      .unique();
    const dernierSignal = Date.now();
    /* La session de cet ordinateur : Réglages › Mobile ne la compte pas parmi les téléphones. */
    const sessionId = (await sessionActuelle(ctx))?._id;
    if (existant) {
      await ctx.db.patch("postes", existant._id, { systeme: args.systeme, nom, dernierSignal, sessionId });
      /* De retour après une absence : « Me prévenir à l'ouverture » part, une fois (T-23). */
      if (dernierSignal - existant.dernierSignal >= OUVERT_MS) await prevenirOuverture(ctx, moi._id, { cle: args.cle, systeme: args.systeme, nom });
    } else await ctx.db.insert("postes", { membreId: moi._id, cle: args.cle, systeme: args.systeme, nom, dernierSignal, sessionId });
    return null;
  },
});

/** Les ordinateurs du compte, et s'ils ont donné signe de vie. */
export const etat = query({
  args: {},
  returns: v.array(
    v.object({
      cle: v.string(),
      systeme: vSysteme,
      nom: v.string(),
      ouvert: v.boolean(),
      dernierSignal: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const lignes = await ctx.db
      .query("postes")
      .withIndex("by_membre_and_cle", (q) => q.eq("membreId", moi._id))
      .take(20);
    const maintenant = Date.now();
    return lignes
      .map((p) => ({
        cle: p.cle,
        systeme: p.systeme,
        nom: p.nom,
        ouvert: maintenant - p.dernierSignal < OUVERT_MS,
        dernierSignal: p.dernierSignal,
      }))
      .sort((a, b) => b.dernierSignal - a.dernierSignal);
  },
});
