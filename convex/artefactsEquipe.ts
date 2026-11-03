import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";
import { DESCRIPTION_MAX, lienArtefact } from "./model/artefacts";
import { nettoyerNom } from "./model/valeurs";

/**
 * Les artefacts de l'équipe : les liens claude.ai qu'un membre partage volontairement, pour que
 * chacun les retrouve dans l'écran Artefacts. Seulement pour les membres actifs, identifiés par
 * leur session. Qui l'a partagé seul le modifie ou le retire. Rien d'autre que le lien, le titre
 * et la description : la page reste sur claude.ai, avec ses propres droits d'accès.
 */

function controler(titre: string, description: string) {
  const titreNet = nettoyerNom(titre);
  if (titreNet === null) throw erreur("nom_invalide");
  const descriptionNette = description.trim();
  if (descriptionNette.length > DESCRIPTION_MAX) throw erreur("description_trop_longue");
  return { titre: titreNet, description: descriptionNette };
}

const vArtefact = v.object({
  _id: v.id("artefactsEquipe"),
  url: v.string(),
  titre: v.string(),
  description: v.string(),
  majLe: v.number(),
  auteur: v.object({ nom: v.string(), couleur: v.string(), actif: v.boolean() }),
  deMoi: v.boolean(),
});

async function resume(ctx: QueryCtx, a: Doc<"artefactsEquipe">, moi: Id<"membres">) {
  const auteur = await ctx.db.get("membres", a.auteurId);
  return {
    _id: a._id,
    url: a.url,
    titre: a.titre,
    description: a.description,
    majLe: a.majLe,
    auteur: { nom: auteur?.nom ?? "Ancien membre", couleur: auteur?.couleur ?? "ocre", actif: auteur?.actif ?? false },
    deMoi: a.auteurId === moi,
  };
}

/** Les artefacts partagés, du plus récemment modifié au plus ancien. `pour` : le membre de la session. */
export const lister = query({
  args: {},
  returns: v.object({ pour: v.id("membres"), artefacts: v.array(vArtefact) }),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const liste = await ctx.db
      .query("artefactsEquipe")
      .withIndex("by_retireLe_and_majLe", (q) => q.eq("retireLe", null))
      .order("desc")
      .take(500);
    return { pour: moi._id, artefacts: await Promise.all(liste.map((a) => resume(ctx, a, moi._id))) };
  },
});

/** « Partager avec l'équipe ». Un lien déjà partagé (par n'importe qui) est refusé. */
export const partager = mutation({
  args: { url: v.string(), titre: v.string(), description: v.string() },
  returns: v.id("artefactsEquipe"),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const url = lienArtefact(args.url);
    if (url === null) throw erreur("lien_invalide");
    const { titre, description } = controler(args.titre, args.description);
    const deja = await ctx.db
      .query("artefactsEquipe")
      .withIndex("by_url_and_retireLe", (q) => q.eq("url", url).eq("retireLe", null))
      .first();
    if (deja) throw erreur("deja_partage");
    return await ctx.db.insert("artefactsEquipe", { auteurId: moi._id, url, titre, description, majLe: Date.now(), retireLe: null });
  },
});

/** Changer le titre ou la description, par qui l'a partagé. */
export const modifier = mutation({
  args: { artefactId: v.id("artefactsEquipe"), titre: v.string(), description: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const a = await ctx.db.get("artefactsEquipe", args.artefactId);
    if (a === null || a.retireLe !== null) throw erreur("introuvable");
    if (a.auteurId !== moi._id) throw erreur("reserve_a_l_auteur");
    await ctx.db.patch("artefactsEquipe", a._id, { ...controler(args.titre, args.description), majLe: Date.now() });
    return null;
  },
});

/** Ne plus le montrer à l'équipe, par qui l'a partagé. L'artefact reste sur claude.ai. */
export const retirer = mutation({
  args: { artefactId: v.id("artefactsEquipe") },
  returns: v.null(),
  handler: async (ctx, { artefactId }) => {
    const moi = await exigerMembre(ctx);
    const a = await ctx.db.get("artefactsEquipe", artefactId);
    if (a === null || a.retireLe !== null) throw erreur("introuvable");
    if (a.auteurId !== moi._id) throw erreur("reserve_a_l_auteur");
    await ctx.db.patch("artefactsEquipe", artefactId, { retireLe: Date.now() });
    return null;
  },
});
