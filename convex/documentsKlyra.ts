import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";
import { DESCRIPTION_MAX } from "./model/artefacts";
import { nettoyerNom } from "./model/valeurs";

/**
 * Documents HTML de KLYRA, stockés par l'app. Un agent les enregistre en privé : seul le membre
 * qui les a déposés les reçoit. « Partager à l'équipe » (l'auteur, à la main) les passe à `equipe`.
 * Le filtre est ici, pas dans l'écran. Aucun plafond de taille : l'espace sert à suivre le coût.
 */

const AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LISTE_MAX = 500;
const ESPACE_MAX = 2000;

const vDocument = v.object({
  _id: v.id("documentsKlyra"),
  titre: v.string(),
  description: v.string(),
  agent: v.union(v.string(), v.null()),
  visibilite: v.union(v.literal("prive"), v.literal("equipe")),
  taille: v.number(),
  version: v.number(),
  majLe: v.number(),
  auteur: v.object({ nom: v.string(), couleur: v.string(), actif: v.boolean() }),
  deMoi: v.boolean(),
});

function controler(titre: string, description: string) {
  const titreNet = nettoyerNom(titre);
  if (titreNet === null) throw erreur("nom_invalide");
  const descriptionNette = description.trim();
  if (descriptionNette.length > DESCRIPTION_MAX) throw erreur("description_trop_longue");
  return { titre: titreNet, description: descriptionNette };
}

function origineValide(origine: string): string {
  const propre = origine.trim();
  if (!propre || propre.length > 300 || propre.includes("\0")) throw erreur("document_invalide");
  return propre;
}

function agentValide(agent: string | null): string | null {
  if (agent === null) return null;
  const propre = agent.trim();
  if (!AGENT.test(propre)) throw erreur("document_invalide");
  return propre;
}

async function resume(ctx: QueryCtx, doc: Doc<"documentsKlyra">, moi: Id<"membres">) {
  const auteur = await ctx.db.get("membres", doc.auteurId);
  return {
    _id: doc._id,
    titre: doc.titre,
    description: doc.description,
    agent: doc.agent,
    visibilite: doc.visibilite,
    taille: doc.taille,
    version: doc.version,
    majLe: doc.majLe,
    auteur: { nom: auteur?.nom ?? "Ancien membre", couleur: auteur?.couleur ?? "ocre", actif: auteur?.actif ?? false },
    deMoi: doc.auteurId === moi,
  };
}

/** Le document encore là, ou une erreur. Un privé qui n'est pas à soi est introuvable. */
async function visible(ctx: QueryCtx, id: Id<"documentsKlyra">, moi: Id<"membres">): Promise<Doc<"documentsKlyra">> {
  const doc = await ctx.db.get("documentsKlyra", id);
  if (doc === null || doc.retireLe !== null) throw erreur("introuvable");
  if (doc.visibilite === "prive" && doc.auteurId !== moi) throw erreur("introuvable");
  return doc;
}

async function aLAuteur(ctx: QueryCtx, id: Id<"documentsKlyra">, moi: Id<"membres">): Promise<Doc<"documentsKlyra">> {
  const doc = await ctx.db.get("documentsKlyra", id);
  if (doc === null || doc.retireLe !== null) throw erreur("introuvable");
  if (doc.auteurId !== moi) throw erreur("reserve_a_l_auteur");
  return doc;
}

/**
 * Le fichier déposé, s'il est un HTML. Un refus annule toute la mutation : on ne peut pas
 * effacer le fichier dans le même élan. L'app ne dépose que du HTML.
 */
async function fichierHtml(ctx: MutationCtx, fichier: Id<"_storage">) {
  const meta = await ctx.db.system.get("_storage", fichier);
  const type = (meta?.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!meta || type !== "text/html") throw erreur("document_invalide");
  return meta;
}

/** Adresse pour déposer le HTML avant `enregistrer`. */
export const preparerDepot = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await exigerMembre(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Enregistre un HTML en privé. Republier la même origine (même auteur) remplace le fichier
 * et garde la visibilité : l'agent ne peut pas la passer à l'équipe.
 */
export const enregistrer = mutation({
  args: {
    fichier: v.id("_storage"),
    titre: v.string(),
    description: v.string(),
    origine: v.string(),
    agent: v.union(v.string(), v.null()),
  },
  returns: v.id("documentsKlyra"),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const meta = await fichierHtml(ctx, args.fichier);
    const { titre, description } = controler(args.titre, args.description);
    const origine = origineValide(args.origine);
    const agent = agentValide(args.agent);
    const deja = (
      await ctx.db
        .query("documentsKlyra")
        .withIndex("by_auteurId_and_origine", (q) => q.eq("auteurId", moi._id).eq("origine", origine))
        .take(20)
    ).find((doc) => doc.retireLe === null);
    const maintenant = Date.now();
    if (deja) {
      if (deja.fichier !== args.fichier) await ctx.storage.delete(deja.fichier);
      await ctx.db.patch("documentsKlyra", deja._id, {
        titre,
        description,
        agent,
        fichier: args.fichier,
        taille: meta.size,
        empreinte: meta.sha256,
        version: deja.version + 1,
        majLe: maintenant,
      });
      return deja._id;
    }
    return await ctx.db.insert("documentsKlyra", {
      auteurId: moi._id,
      agent,
      titre,
      description,
      type: "html",
      fichier: args.fichier,
      taille: meta.size,
      empreinte: meta.sha256,
      version: 1,
      origine,
      visibilite: "prive",
      majLe: maintenant,
      retireLe: null,
    });
  },
});

/** Les documents du membre, privés et déjà partagés, du plus récent au plus ancien. */
export const listerMes = query({
  args: {},
  returns: v.object({ pour: v.id("membres"), documents: v.array(vDocument) }),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const liste = await ctx.db
      .query("documentsKlyra")
      .withIndex("by_auteurId_and_retireLe_and_majLe", (q) => q.eq("auteurId", moi._id).eq("retireLe", null))
      .order("desc")
      .take(LISTE_MAX);
    return { pour: moi._id, documents: await Promise.all(liste.map((doc) => resume(ctx, doc, moi._id))) };
  },
});

/** Les documents passés à l'équipe. Un privé n'y est jamais. */
export const listerEquipe = query({
  args: {},
  returns: v.object({ pour: v.id("membres"), documents: v.array(vDocument) }),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const liste = await ctx.db
      .query("documentsKlyra")
      .withIndex("by_visibilite_and_retireLe_and_majLe", (q) => q.eq("visibilite", "equipe").eq("retireLe", null))
      .order("desc")
      .take(LISTE_MAX);
    return { pour: moi._id, documents: await Promise.all(liste.map((doc) => resume(ctx, doc, moi._id))) };
  },
});

/** L'adresse du HTML, pour qui a le droit de le lire. Un privé d'un autre membre est introuvable. */
export const lire = query({
  args: { documentId: v.id("documentsKlyra") },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { documentId }) => {
    const moi = await exigerMembre(ctx);
    const doc = await visible(ctx, documentId, moi._id);
    const url = await ctx.storage.getUrl(doc.fichier);
    if (url === null) throw erreur("introuvable");
    return { url };
  },
});

/**
 * Octets de tous les documents encore là, privés compris, sans leur contenu.
 * `complet` est faux si la lecture s'est arrêtée à `ESPACE_MAX` : le chiffre est alors un minimum.
 */
export const espace = query({
  args: {},
  returns: v.object({ octets: v.number(), nombre: v.number(), complet: v.boolean() }),
  handler: async (ctx) => {
    await exigerMembre(ctx);
    const liste = await ctx.db
      .query("documentsKlyra")
      .withIndex("by_retireLe_and_majLe", (q) => q.eq("retireLe", null))
      .take(ESPACE_MAX + 1);
    const complet = liste.length <= ESPACE_MAX;
    const gardes = complet ? liste : liste.slice(0, ESPACE_MAX);
    return { octets: gardes.reduce((n, doc) => n + doc.taille, 0), nombre: gardes.length, complet };
  },
});

/** L'auteur montre le document à l'équipe. */
export const partager = mutation({
  args: { documentId: v.id("documentsKlyra") },
  returns: v.null(),
  handler: async (ctx, { documentId }) => {
    const moi = await exigerMembre(ctx);
    const doc = await aLAuteur(ctx, documentId, moi._id);
    if (doc.visibilite !== "equipe") await ctx.db.patch("documentsKlyra", doc._id, { visibilite: "equipe", majLe: Date.now() });
    return null;
  },
});

/** L'auteur le reprend : il redevient privé, le fichier reste. */
export const reprendre = mutation({
  args: { documentId: v.id("documentsKlyra") },
  returns: v.null(),
  handler: async (ctx, { documentId }) => {
    const moi = await exigerMembre(ctx);
    const doc = await aLAuteur(ctx, documentId, moi._id);
    if (doc.visibilite !== "prive") await ctx.db.patch("documentsKlyra", doc._id, { visibilite: "prive", majLe: Date.now() });
    return null;
  },
});

/** L'auteur le supprime. Le fichier part avec. */
export const supprimer = mutation({
  args: { documentId: v.id("documentsKlyra") },
  returns: v.null(),
  handler: async (ctx, { documentId }) => {
    const moi = await exigerMembre(ctx);
    const doc = await aLAuteur(ctx, documentId, moi._id);
    await ctx.storage.delete(doc.fichier);
    await ctx.db.patch("documentsKlyra", doc._id, { retireLe: Date.now() });
    return null;
  },
});
