import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";
import { DESCRIPTION_MAX } from "./model/artefacts";
import { nettoyerNom } from "./model/valeurs";

/**
 * HTML partagés avec l'équipe. Un document privé ne passe pas ici : il reste dans l'espace
 * où il a été créé (copie `~/.klyra/rendus` sur ce PC, fichier du VPS sur le serveur).
 * `lieu` est celui du sélecteur : null pour Ce PC, l'adresse du VPS sinon. Une lecture d'un
 * autre espace est introuvable. L'auteur seul retire le fichier de Convex.
 * Aucun plafond : `espace` additionne les octets encore dans Convex, pour suivre le coût.
 */

const AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LISTE_MAX = 500;
const ESPACE_MAX = 2000;

const vLieu = v.union(v.string(), v.null());

const vDocument = v.object({
  _id: v.id("documentsKlyra"),
  titre: v.string(),
  description: v.string(),
  agent: v.union(v.string(), v.null()),
  lieu: vLieu,
  /** Le chemin d'origine, pour l'auteur seulement. Les autres ne voient pas le disque. */
  origine: v.union(v.string(), v.null()),
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

/** null : Ce PC. Une adresse vide ne compte pas comme ce PC. */
function lieuValide(lieu: string | null): string | null {
  if (lieu === null) return null;
  const propre = lieu.trim();
  if (!propre || propre.length > 300 || propre.includes("\0") || /\s/.test(propre)) throw erreur("document_invalide");
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
    lieu: doc.lieu,
    origine: doc.auteurId === moi ? doc.origine : null,
    taille: doc.taille,
    version: doc.version,
    majLe: doc.majLe,
    auteur: { nom: auteur?.nom ?? "Ancien membre", couleur: auteur?.couleur ?? "ocre", actif: auteur?.actif ?? false },
    deMoi: doc.auteurId === moi,
  };
}

/** Le document partagé de cet espace, ou introuvable. Un autre espace ne se distingue pas d'une absence. */
async function dansCetEspace(ctx: QueryCtx, id: Id<"documentsKlyra">, lieu: string | null): Promise<Doc<"documentsKlyra">> {
  const doc = await ctx.db.get("documentsKlyra", id);
  if (doc === null || doc.retireLe !== null || doc.lieu !== lieu) throw erreur("introuvable");
  return doc;
}

async function aLAuteur(ctx: QueryCtx, id: Id<"documentsKlyra">, moi: Id<"membres">, lieu: string | null): Promise<Doc<"documentsKlyra">> {
  const doc = await dansCetEspace(ctx, id, lieu);
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

async function retirer(ctx: MutationCtx, id: Id<"documentsKlyra">, moi: Id<"membres">, lieu: string | null) {
  const doc = await aLAuteur(ctx, id, moi, lieu);
  await ctx.storage.delete(doc.fichier);
  await ctx.db.patch("documentsKlyra", doc._id, { retireLe: Date.now() });
}

/** Adresse pour déposer le HTML avant `partager`. */
export const preparerDepot = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await exigerMembre(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Partage un HTML avec l'équipe, dans un seul espace. Le même auteur qui repartage
 * le même original au même endroit remplace sa carte. Un autre membre crée la sienne :
 * il n'écrase pas le fichier, et l'auteur garde le retrait. Il n'y a pas d'argument
 * pour viser un autre espace que `lieu`.
 */
export const partager = mutation({
  args: {
    fichier: v.id("_storage"),
    titre: v.string(),
    description: v.string(),
    origine: v.string(),
    agent: v.union(v.string(), v.null()),
    lieu: vLieu,
  },
  returns: v.id("documentsKlyra"),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const meta = await fichierHtml(ctx, args.fichier);
    const { titre, description } = controler(args.titre, args.description);
    const origine = origineValide(args.origine);
    const agent = agentValide(args.agent);
    const lieu = lieuValide(args.lieu);
    const deja = (
      await ctx.db
        .query("documentsKlyra")
        .withIndex("by_auteurId_and_lieu_and_origine", (q) => q.eq("auteurId", moi._id).eq("lieu", lieu).eq("origine", origine))
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
      lieu,
      majLe: maintenant,
      retireLe: null,
    });
  },
});

/** Les documents partagés de cet espace, du plus récent au plus ancien. Un autre espace n'y est pas. */
export const lister = query({
  args: { lieu: vLieu },
  returns: v.object({ pour: v.id("membres"), lieu: vLieu, documents: v.array(vDocument) }),
  handler: async (ctx, { lieu }) => {
    const moi = await exigerMembre(ctx);
    const espace = lieuValide(lieu);
    const liste = await ctx.db
      .query("documentsKlyra")
      .withIndex("by_lieu_and_retireLe_and_majLe", (q) => q.eq("lieu", espace).eq("retireLe", null))
      .order("desc")
      .take(LISTE_MAX);
    return { pour: moi._id, lieu: espace, documents: await Promise.all(liste.map((doc) => resume(ctx, doc, moi._id))) };
  },
});

/**
 * L'identifiant du fichier dans cet espace. L'écran ne le reçoit pas :
 * seule l'action `contenu` s'en sert pour lire les octets.
 */
export const fichierDansEspace = internalQuery({
  args: { documentId: v.id("documentsKlyra"), lieu: vLieu },
  returns: v.id("_storage"),
  handler: async (ctx, { documentId, lieu }) => {
    await exigerMembre(ctx);
    const doc = await dansCetEspace(ctx, documentId, lieuValide(lieu));
    return doc.fichier;
  },
});

/** Référence par nom : importer `internal` ici bouclerait les types avec `_generated/api`. */
const fichierDansEspaceRef = makeFunctionReference<"query", { documentId: Id<"documentsKlyra">; lieu: string | null }, Id<"_storage">>(
  "documentsKlyra:fichierDansEspace",
);

/**
 * Le HTML partagé dans cet espace, sans adresse de stockage.
 * Une requête ne peut pas lire les octets. `lire` renvoie l'adresse et l'écran ne l'appelle pas.
 */
export const contenu = action({
  args: { documentId: v.id("documentsKlyra"), lieu: vLieu },
  returns: v.object({ html: v.string() }),
  handler: async (ctx, { documentId, lieu }): Promise<{ html: string }> => {
    const fichier = await ctx.runQuery(fichierDansEspaceRef, { documentId, lieu });
    const blob = await ctx.storage.get(fichier);
    if (blob === null) throw erreur("introuvable");
    return { html: await blob.text() };
  },
});

/** L'adresse du HTML partagé dans cet espace. Un document d'un autre espace est introuvable. L'écran ne l'appelle pas. */
export const lire = query({
  args: { documentId: v.id("documentsKlyra"), lieu: vLieu },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { documentId, lieu }) => {
    await exigerMembre(ctx);
    const doc = await dansCetEspace(ctx, documentId, lieuValide(lieu));
    const url = await ctx.storage.getUrl(doc.fichier);
    if (url === null) throw erreur("introuvable");
    return { url };
  },
});

/**
 * Octets de tous les HTML encore partagés, tous espaces confondus, sans leur contenu.
 * C'est le coût Convex, pas la liste d'un espace. `complet` est faux au-delà de `ESPACE_MAX` :
 * le chiffre est alors un minimum.
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

/** L'auteur retire le partage. Le fichier quitte Convex. La copie de l'espace, s'il y en a une, n'est pas ici. */
export const reprendre = mutation({
  args: { documentId: v.id("documentsKlyra"), lieu: vLieu },
  returns: v.null(),
  handler: async (ctx, { documentId, lieu }) => {
    const moi = await exigerMembre(ctx);
    await retirer(ctx, documentId, moi._id, lieuValide(lieu));
    return null;
  },
});

/** L'auteur supprime le partage. Même effet dans Convex que `reprendre` : le fichier part. */
export const supprimer = mutation({
  args: { documentId: v.id("documentsKlyra"), lieu: vLieu },
  returns: v.null(),
  handler: async (ctx, { documentId, lieu }) => {
    const moi = await exigerMembre(ctx);
    await retirer(ctx, documentId, moi._id, lieuValide(lieu));
    return null;
  },
});
