import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";

/**
 * Le téléphone demande, l'ordinateur ouvert répond (spec mobile M-3). Rien de ce que l'ordinateur
 * renvoie n'est gardé (M-7) : la demande et sa réponse sont effacées dès que le téléphone l'a lue,
 * et au plus tard à l'expiration.
 */

/** Une demande non prise ni lue disparaît après ce délai. Le téléphone dit « ne répond pas » bien avant (P-10). */
export const VIE_DEMANDE_MS = 2 * 60_000;
/** Au-delà, l'ordinateur dépose la réponse dans le stockage. Un document Convex tient 1 Mo. */
export const REPONSE_DOCUMENT_MAX = 700_000;
const ARGS_MAX = 64_000;
const EN_ATTENTE_MAX = 40;
const TYPE = /^[a-z]{2,20}\.[a-zA-Z]{2,40}$/;
const CLE_POSTE = /^[\w-]{8,80}$/;

async function effacer(ctx: MutationCtx, demande: Doc<"demandesPoste">) {
  if (demande.fichier) await ctx.storage.delete(demande.fichier);
  await ctx.db.delete("demandesPoste", demande._id);
}

async function aMoi(ctx: MutationCtx, membreId: Id<"membres">, id: Id<"demandesPoste">) {
  const demande = await ctx.db.get("demandesPoste", id);
  return demande && demande.membreId === membreId ? demande : null;
}

/** Le téléphone : « lis ce dossier », « lance cette routine »… Renvoie l'id à suivre. */
export const demander = mutation({
  args: { type: v.string(), args: v.string(), posteCle: v.optional(v.union(v.string(), v.null())) },
  returns: v.id("demandesPoste"),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const posteCle = args.posteCle ?? null;
    if (!TYPE.test(args.type) || args.args.length > ARGS_MAX || (posteCle !== null && !CLE_POSTE.test(posteCle))) {
      throw erreur("demande_invalide");
    }
    try {
      JSON.parse(args.args);
    } catch {
      throw erreur("demande_invalide");
    }
    const enAttente = await ctx.db
      .query("demandesPoste")
      .withIndex("by_membre_and_statut_and_creeLe", (q) => q.eq("membreId", moi._id).eq("statut", "attente"))
      .take(EN_ATTENTE_MAX);
    if (enAttente.length >= EN_ATTENTE_MAX) throw erreur("trop_de_demandes");
    const creeLe = Date.now();
    const id = await ctx.db.insert("demandesPoste", {
      membreId: moi._id,
      posteCle,
      type: args.type,
      args: args.args,
      statut: "attente",
      reponse: null,
      fichier: null,
      erreur: null,
      creeLe,
      expireLe: creeLe + VIE_DEMANDE_MS,
    });
    await ctx.scheduler.runAfter(VIE_DEMANDE_MS, internal.demandesPoste.expirer, { id });
    return id;
  },
});

/** Le téléphone suit sa demande. null : effacée (lue, expirée) ou pas à lui. */
export const suivre = query({
  args: { id: v.id("demandesPoste") },
  returns: v.union(
    v.object({
      statut: v.union(v.literal("attente"), v.literal("prise"), v.literal("faite"), v.literal("erreur")),
      reponse: v.union(v.string(), v.null()),
      url: v.union(v.string(), v.null()),
      erreur: v.union(v.object({ code: v.string(), message: v.string() }), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const moi = await exigerMembre(ctx);
    const demande = await ctx.db.get("demandesPoste", id);
    if (!demande || demande.membreId !== moi._id) return null;
    return {
      statut: demande.statut,
      reponse: demande.reponse,
      url: demande.fichier ? await ctx.storage.getUrl(demande.fichier) : null,
      erreur: demande.erreur,
    };
  },
});

/** Le téléphone a lu la réponse (ou abandonne) : tout est effacé (M-7). */
export const oublier = mutation({
  args: { id: v.id("demandesPoste") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const moi = await exigerMembre(ctx);
    const demande = await aMoi(ctx, moi._id, id);
    if (demande) await effacer(ctx, demande);
    return null;
  },
});

/** L'ordinateur : ce qui l'attend, pour lui ou pour le premier ordinateur ouvert. */
export const aTraiter = query({
  args: { posteCle: v.string() },
  returns: v.array(v.object({ _id: v.id("demandesPoste"), type: v.string() })),
  handler: async (ctx, { posteCle }) => {
    const moi = await exigerMembre(ctx);
    const lignes = await ctx.db
      .query("demandesPoste")
      .withIndex("by_membre_and_statut_and_creeLe", (q) => q.eq("membreId", moi._id).eq("statut", "attente"))
      .take(EN_ATTENTE_MAX);
    return lignes.filter((d) => d.posteCle === null || d.posteCle === posteCle).map((d) => ({ _id: d._id, type: d.type }));
  },
});

/** L'ordinateur prend la demande. Un second ordinateur, ou un second appel, reçoit null. */
export const prendre = mutation({
  args: { id: v.id("demandesPoste"), posteCle: v.string() },
  returns: v.union(v.object({ type: v.string(), args: v.string() }), v.null()),
  handler: async (ctx, { id, posteCle }) => {
    const moi = await exigerMembre(ctx);
    const demande = await aMoi(ctx, moi._id, id);
    if (!demande || demande.statut !== "attente") return null;
    if (demande.posteCle !== null && demande.posteCle !== posteCle) return null;
    await ctx.db.patch("demandesPoste", id, { statut: "prise", posteCle });
    return { type: demande.type, args: demande.args };
  },
});

/** Adresse de dépôt : grande réponse de l'ordinateur, ou pièce jointe du téléphone. */
export const adresseDepot = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await exigerMembre(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** L'ordinateur répond : la réponse en JSON, ou le fichier déposé, ou une erreur dite en clair. */
export const repondre = mutation({
  args: {
    id: v.id("demandesPoste"),
    reponse: v.optional(v.string()),
    fichier: v.optional(v.id("_storage")),
    erreur: v.optional(v.object({ code: v.string(), message: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const demande = await aMoi(ctx, moi._id, args.id);
    if (!demande || demande.statut !== "prise") {
      /* Effacée ou expirée entre-temps : le fichier déposé ne doit pas rester. */
      if (args.fichier) await ctx.storage.delete(args.fichier);
      return null;
    }
    if (args.erreur) {
      if (args.fichier) await ctx.storage.delete(args.fichier);
      await ctx.db.patch("demandesPoste", args.id, {
        statut: "erreur",
        erreur: { code: args.erreur.code.slice(0, 60), message: args.erreur.message.slice(0, 500) },
      });
      return null;
    }
    if (args.reponse !== undefined && args.reponse.length > REPONSE_DOCUMENT_MAX) {
      if (args.fichier) await ctx.storage.delete(args.fichier);
      throw erreur("fichier_trop_lourd");
    }
    await ctx.db.patch("demandesPoste", args.id, {
      statut: "faite",
      reponse: args.reponse ?? null,
      fichier: args.fichier ?? null,
    });
    return null;
  },
});

export const expirer = internalMutation({
  args: { id: v.id("demandesPoste") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const demande = await ctx.db.get("demandesPoste", id);
    if (demande) await effacer(ctx, demande);
    return null;
  },
});
