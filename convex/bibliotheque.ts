import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";
import { LIMITES, verifierDefinition, type Dependance } from "./model/definitions";
import { nettoyerNom } from "./model/valeurs";

/**
 * La Bibliothèque KLYRA : les définitions d'agents qu'un membre publie volontairement, pour que
 * chacun ajoute chez soi celles qui lui servent. Seulement pour les membres actifs, identifiés
 * par leur session. L'auteur seul met à jour ou retire sa définition ; les autres la copient.
 * Rien ne dit qui a ajouté quoi : les ajouts restent sur chaque ordinateur.
 */

const vDependance = v.object({ cle: v.string(), libelle: v.string() });

const vResume = v.object({
  _id: v.id("definitionsAgents"),
  slug: v.string(),
  nom: v.string(),
  role: v.string(),
  description: v.string(),
  capacites: v.array(v.string()),
  modele: v.union(v.string(), v.null()),
  dependances: v.array(vDependance),
  version: v.number(),
  majLe: v.number(),
  auteur: v.object({ nom: v.string(), couleur: v.string(), actif: v.boolean() }),
  deMoi: v.boolean(),
});

async function resume(ctx: QueryCtx, d: Doc<"definitionsAgents">, moi: Id<"membres">) {
  const auteur = await ctx.db.get("membres", d.auteurId);
  return {
    _id: d._id,
    slug: d.slug,
    nom: d.nom,
    role: d.role,
    description: d.description,
    capacites: d.capacites,
    modele: d.modele,
    dependances: d.dependances,
    version: d.version,
    majLe: d.majLe,
    auteur: { nom: auteur?.nom ?? "Ancien membre", couleur: auteur?.couleur ?? "ocre", actif: auteur?.actif ?? false },
    deMoi: d.auteurId === moi,
  };
}

/*
 * Chaque lecture dit pour qui elle a été faite (`pour`, le membre de la session) : après un changement
 * de compte, l'app écarte une réponse qui ne vient pas de la session en cours, même un instant.
 */

/** Les définitions publiées, de la plus récemment mise à jour à la plus ancienne. */
export const lister = query({
  args: {},
  returns: v.object({ pour: v.id("membres"), definitions: v.array(vResume) }),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const liste = await ctx.db
      .query("definitionsAgents")
      .withIndex("by_retireeLe_and_majLe", (q) => q.eq("retireeLe", null))
      .order("desc")
      .take(200);
    return { pour: moi._id, definitions: await Promise.all(liste.map((d) => resume(ctx, d, moi._id))) };
  },
});

/** Une définition et sa fiche complète. Retirée : seul son auteur la lit encore. */
export const lire = query({
  args: { definitionId: v.string() },
  returns: v.object({ pour: v.id("membres"), definition: v.union(vResume.extend({ contenu: v.string() }), v.null()) }),
  handler: async (ctx, { definitionId }) => {
    const moi = await exigerMembre(ctx);
    const id = ctx.db.normalizeId("definitionsAgents", definitionId);
    const d = id ? await ctx.db.get("definitionsAgents", id) : null;
    if (d === null || (d.retireeLe !== null && d.auteurId !== moi._id)) return { pour: moi._id, definition: null };
    return { pour: moi._id, definition: { ...(await resume(ctx, d, moi._id)), contenu: d.contenu } };
  },
});

/**
 * La version actuelle de définitions déjà ajoutées sur un ordinateur, pour proposer leurs mises à jour.
 * Un identifiant inconnu (autre déploiement, définition effacée) est simplement absent de la réponse.
 */
export const etats = query({
  args: { ids: v.array(v.string()) },
  returns: v.object({
    pour: v.id("membres"),
    etats: v.array(v.object({ _id: v.id("definitionsAgents"), version: v.number(), majLe: v.number(), retiree: v.boolean(), deMoi: v.boolean() })),
  }),
  handler: async (ctx, { ids }) => {
    const moi = await exigerMembre(ctx);
    const etats = [];
    for (const brut of ids.slice(0, 200)) {
      const id = ctx.db.normalizeId("definitionsAgents", brut);
      const d = id ? await ctx.db.get("definitionsAgents", id) : null;
      if (d) etats.push({ _id: d._id, version: d.version, majLe: d.majLe, retiree: d.retireeLe !== null, deMoi: d.auteurId === moi._id });
    }
    return { pour: moi._id, etats };
  },
});

function controler(contenu: string, role: string, dependances: Dependance[]) {
  const roleNet = nettoyerNom(role, LIMITES.role);
  if (roleNet === null) throw erreur("nom_invalide");
  const dependancesNettes = dependances.map((d) => ({ cle: d.cle, libelle: d.libelle.trim() }));
  const verdict = verifierDefinition({ contenu, role: roleNet, dependances: dependancesNettes });
  if (!verdict.ok) throw erreur(verdict.refus);
  return { ...verdict, role: roleNet, dependances: dependancesNettes };
}

/** « Partager avec l'équipe » : la fiche telle que l'aperçu l'a montrée. */
export const publier = mutation({
  args: { contenu: v.string(), role: v.string(), dependances: v.array(vDependance) },
  returns: v.id("definitionsAgents"),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const d = controler(args.contenu, args.role, args.dependances);
    const memes = await ctx.db
      .query("definitionsAgents")
      .withIndex("by_auteurId_and_slug", (q) => q.eq("auteurId", moi._id).eq("slug", d.slug))
      .take(20);
    if (memes.some((m) => m.retireeLe === null)) throw erreur("deja_publiee");
    return await ctx.db.insert("definitionsAgents", {
      auteurId: moi._id,
      slug: d.slug,
      nom: d.nom,
      role: d.role,
      description: d.description,
      capacites: d.capacites,
      modele: d.modele,
      contenu: args.contenu,
      dependances: d.dependances,
      version: 1,
      majLe: Date.now(),
      retireeLe: null,
    });
  },
});

/**
 * Une nouvelle version, par son auteur seulement. `versionAttendue` : celle qu'il avait sous les yeux ;
 * si une autre mise à jour est passée entre-temps (autre ordinateur), rien n'est écrasé.
 */
export const mettreAJour = mutation({
  args: {
    definitionId: v.id("definitionsAgents"),
    versionAttendue: v.number(),
    contenu: v.string(),
    role: v.string(),
    dependances: v.array(vDependance),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const actuelle = await ctx.db.get("definitionsAgents", args.definitionId);
    if (actuelle === null || actuelle.retireeLe !== null) throw erreur("introuvable");
    if (actuelle.auteurId !== moi._id) throw erreur("reserve_a_l_auteur");
    if (actuelle.version !== args.versionAttendue) throw erreur("conflit_version");
    const d = controler(args.contenu, args.role, args.dependances);
    if (d.slug !== actuelle.slug) throw erreur("nom_invalide");
    const version = actuelle.version + 1;
    await ctx.db.patch("definitionsAgents", actuelle._id, {
      nom: d.nom,
      role: d.role,
      description: d.description,
      capacites: d.capacites,
      modele: d.modele,
      contenu: args.contenu,
      dependances: d.dependances,
      version,
      majLe: Date.now(),
    });
    return version;
  },
});

/** Retirer de la bibliothèque, par son auteur. Les copies déjà ajoutées restent sur chaque ordinateur. */
export const retirer = mutation({
  args: { definitionId: v.id("definitionsAgents") },
  returns: v.null(),
  handler: async (ctx, { definitionId }) => {
    const moi = await exigerMembre(ctx);
    const d = await ctx.db.get("definitionsAgents", definitionId);
    if (d === null || d.retireeLe !== null) throw erreur("introuvable");
    if (d.auteurId !== moi._id) throw erreur("reserve_a_l_auteur");
    await ctx.db.patch("definitionsAgents", definitionId, { retireeLe: Date.now() });
    return null;
  },
});
