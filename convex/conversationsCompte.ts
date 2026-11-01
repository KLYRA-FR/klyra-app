import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";

/** Lots : une conversation tient ses messages à part, pour rester sous la taille d'un document. */
const LOT_CONVERSATIONS = 40;
const LOT_MESSAGES = 25;
const LOT_CARTES = 50;
const PAGE_MESSAGES = 400;

const vKind = v.union(v.literal("direct"), v.literal("equipe"));
const vStatut = v.union(v.literal("en-cours"), v.literal("fait"), v.literal("erreur"), v.null());
const vAuteur = v.union(v.literal("user"), v.literal("role"));

function origineValide(valeur: string): boolean {
  return valeur.length >= 1 && valeur.length <= 200 && !/[\u0000-\u001f]/.test(valeur);
}

function court(valeur: string, max: number): string {
  const texte = valeur.replace(/\u0000/g, "").trim();
  return texte.length <= max ? texte : texte.slice(0, max);
}

async function parOrigine(ctx: MutationCtx, membreId: Id<"membres">, origine: string) {
  return await ctx.db
    .query("conversationsCompte")
    .withIndex("by_membre_and_origine", (q) => q.eq("membreId", membreId).eq("origine", origine))
    .unique();
}

const vConversation = v.object({
  origine: v.string(),
  kind: vKind,
  titre: v.string(),
  projetId: v.union(v.string(), v.null()),
  projetNom: v.union(v.string(), v.null()),
  roleIds: v.array(v.string()),
  misAJour: v.string(),
  epingleLe: v.union(v.string(), v.null()),
  extrait: v.string(),
  extraitLe: v.union(v.string(), v.null()),
  nonLus: v.number(),
  taches: v.string(),
});

/** Reprend les conversations de l'ordinateur, par lots. La même origine est mise à jour, pas doublée. */
export const importerConversations = mutation({
  args: { lot: v.array(vConversation) },
  returns: v.number(),
  handler: async (ctx, { lot }) => {
    const moi = await exigerMembre(ctx);
    if (lot.length > LOT_CONVERSATIONS) throw erreur("lot_trop_grand");
    let n = 0;
    for (const entree of lot) {
      if (!origineValide(entree.origine) || entree.roleIds.length > 20 || entree.nonLus < 0 || entree.nonLus > 9999) {
        throw erreur("conversation_invalide");
      }
      if (entree.roleIds.some((id) => !origineValide(id))) throw erreur("conversation_invalide");
      const ligne = {
        membreId: moi._id,
        origine: entree.origine,
        kind: entree.kind,
        titre: court(entree.titre, 200) || "Conversation",
        projetId: entree.projetId ? court(entree.projetId, 200) : null,
        projetNom: entree.projetNom ? court(entree.projetNom, 200) : null,
        roleIds: entree.roleIds,
        misAJour: court(entree.misAJour, 40),
        epingleLe: entree.epingleLe ? court(entree.epingleLe, 40) : null,
        extrait: court(entree.extrait, 240),
        extraitLe: entree.extraitLe ? court(entree.extraitLe, 40) : null,
        nonLus: entree.nonLus,
        taches: court(entree.taches, 4000),
      };
      const existante = await parOrigine(ctx, moi._id, entree.origine);
      if (existante) await ctx.db.patch("conversationsCompte", existante._id, ligne);
      else await ctx.db.insert("conversationsCompte", ligne);
      n += 1;
    }
    return n;
  },
});

/** Retire du compte les conversations qui ne sont plus sur l'ordinateur. Les messages restent. */
export const alignerConversations = mutation({
  args: { origines: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { origines }) => {
    const moi = await exigerMembre(ctx);
    if (origines.length > 2000) throw erreur("lot_trop_grand");
    const gardes = new Set(origines);
    const lignes = await ctx.db
      .query("conversationsCompte")
      .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id))
      .take(2000);
    for (const ligne of lignes) {
      if (!gardes.has(ligne.origine)) await ctx.db.delete("conversationsCompte", ligne._id);
    }
    return null;
  },
});

const vMessage = v.object({
  conversationOrigine: v.string(),
  origine: v.string(),
  auteurKind: vAuteur,
  auteurId: v.union(v.string(), v.null()),
  creeLe: v.string(),
  texte: v.string(),
  parties: v.string(),
  statut: vStatut,
});

/** Reprend les messages, par lots. La copie locale n'est pas touchée. */
export const importerMessages = mutation({
  args: { lot: v.array(vMessage) },
  returns: v.number(),
  handler: async (ctx, { lot }) => {
    const moi = await exigerMembre(ctx);
    if (lot.length > LOT_MESSAGES) throw erreur("lot_trop_grand");
    let n = 0;
    for (const entree of lot) {
      if (!origineValide(entree.origine) || !origineValide(entree.conversationOrigine)) throw erreur("conversation_invalide");
      if (entree.auteurKind === "role" && (!entree.auteurId || !origineValide(entree.auteurId))) throw erreur("conversation_invalide");
      if (entree.parties.length > 20_000) throw erreur("conversation_invalide");
      const ligne = {
        membreId: moi._id,
        conversationOrigine: entree.conversationOrigine,
        origine: entree.origine,
        auteurKind: entree.auteurKind,
        auteurId: entree.auteurKind === "user" ? null : entree.auteurId,
        creeLe: court(entree.creeLe, 40),
        texte: court(entree.texte, 8000),
        parties: entree.parties,
        statut: entree.statut,
      };
      const existant = await ctx.db
        .query("messagesCompte")
        .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id).eq("origine", entree.origine))
        .unique();
      if (existant) await ctx.db.patch("messagesCompte", existant._id, ligne);
      else await ctx.db.insert("messagesCompte", ligne);
      n += 1;
    }
    return n;
  },
});

const vCarteAgent = v.object({
  origine: v.string(),
  nom: v.string(),
  teinte: v.string(),
  roleCourt: v.string(),
  actif: v.boolean(),
});

export const importerAgents = mutation({
  args: { lot: v.array(vCarteAgent) },
  returns: v.number(),
  handler: async (ctx, { lot }) => {
    const moi = await exigerMembre(ctx);
    if (lot.length > LOT_CARTES) throw erreur("lot_trop_grand");
    let n = 0;
    for (const entree of lot) {
      if (!origineValide(entree.origine)) throw erreur("conversation_invalide");
      const ligne = {
        membreId: moi._id,
        origine: entree.origine,
        nom: court(entree.nom, 80) || entree.origine,
        teinte: court(entree.teinte, 40),
        roleCourt: court(entree.roleCourt, 120),
        actif: entree.actif,
      };
      const existante = await ctx.db
        .query("cartesAgents")
        .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id).eq("origine", entree.origine))
        .unique();
      if (existante) await ctx.db.patch("cartesAgents", existante._id, ligne);
      else await ctx.db.insert("cartesAgents", ligne);
      n += 1;
    }
    return n;
  },
});

const vCarteProjet = v.object({
  origine: v.string(),
  nom: v.string(),
  accroche: v.string(),
  statut: v.string(),
  epingle: v.boolean(),
});

export const importerProjets = mutation({
  args: { lot: v.array(vCarteProjet) },
  returns: v.number(),
  handler: async (ctx, { lot }) => {
    const moi = await exigerMembre(ctx);
    if (lot.length > LOT_CARTES) throw erreur("lot_trop_grand");
    let n = 0;
    for (const entree of lot) {
      if (!origineValide(entree.origine)) throw erreur("conversation_invalide");
      const ligne = {
        membreId: moi._id,
        origine: entree.origine,
        nom: court(entree.nom, 120) || "Projet",
        accroche: court(entree.accroche, 200),
        statut: court(entree.statut, 40),
        epingle: entree.epingle,
      };
      const existante = await ctx.db
        .query("cartesProjets")
        .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id).eq("origine", entree.origine))
        .unique();
      if (existante) await ctx.db.patch("cartesProjets", existante._id, ligne);
      else await ctx.db.insert("cartesProjets", ligne);
      n += 1;
    }
    return n;
  },
});

/** Les conversations du compte, les plus récentes d'abord. Épinglées comprises. */
export const liste = query({
  args: {},
  returns: v.array(
    v.object({
      origine: v.string(),
      kind: vKind,
      titre: v.string(),
      projetId: v.union(v.string(), v.null()),
      projetNom: v.union(v.string(), v.null()),
      roleIds: v.array(v.string()),
      misAJour: v.string(),
      epingleLe: v.union(v.string(), v.null()),
      extrait: v.string(),
      extraitLe: v.union(v.string(), v.null()),
      nonLus: v.number(),
      taches: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const lignes = await ctx.db
      .query("conversationsCompte")
      .withIndex("by_membre_and_misAJour", (q) => q.eq("membreId", moi._id))
      .order("desc")
      .take(200);
    return lignes.map((c) => ({
      origine: c.origine,
      kind: c.kind,
      titre: c.titre,
      projetId: c.projetId,
      projetNom: c.projetNom,
      roleIds: c.roleIds,
      misAJour: c.misAJour,
      epingleLe: c.epingleLe,
      extrait: c.extrait,
      extraitLe: c.extraitLe,
      nonLus: c.nonLus,
      taches: c.taches,
    }));
  },
});

/** Les messages d'une conversation, dans l'ordre. 400 au plus : les plus récents. */
export const messages = query({
  args: { origine: v.string() },
  returns: v.object({
    coupe: v.boolean(),
    messages: v.array(
      v.object({
        origine: v.string(),
        auteurKind: vAuteur,
        auteurId: v.union(v.string(), v.null()),
        creeLe: v.string(),
        texte: v.string(),
        parties: v.string(),
        statut: vStatut,
      }),
    ),
  }),
  handler: async (ctx, { origine }) => {
    const moi = await exigerMembre(ctx);
    if (!origineValide(origine)) throw erreur("conversation_invalide");
    const lignes = await ctx.db
      .query("messagesCompte")
      .withIndex("by_membre_and_conversation_and_creeLe", (q) => q.eq("membreId", moi._id).eq("conversationOrigine", origine))
      .order("desc")
      .take(PAGE_MESSAGES);
    return {
      coupe: lignes.length === PAGE_MESSAGES,
      messages: lignes.reverse().map((m) => ({
        origine: m.origine,
        auteurKind: m.auteurKind,
        auteurId: m.auteurId,
        creeLe: m.creeLe,
        texte: m.texte,
        parties: m.parties,
        statut: m.statut,
      })),
    };
  },
});

export const agents = query({
  args: {},
  returns: v.array(
    v.object({
      origine: v.string(),
      nom: v.string(),
      teinte: v.string(),
      roleCourt: v.string(),
      actif: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const lignes = await ctx.db
      .query("cartesAgents")
      .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id))
      .take(200);
    return lignes
      .map((a) => ({ origine: a.origine, nom: a.nom, teinte: a.teinte, roleCourt: a.roleCourt, actif: a.actif }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  },
});

export const projets = query({
  args: {},
  returns: v.array(
    v.object({
      origine: v.string(),
      nom: v.string(),
      accroche: v.string(),
      statut: v.string(),
      epingle: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const lignes = await ctx.db
      .query("cartesProjets")
      .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id))
      .take(200);
    return lignes.map((p) => ({ origine: p.origine, nom: p.nom, accroche: p.accroche, statut: p.statut, epingle: p.epingle }));
  },
});

/** Le téléphone écrit. Le message attend l'ordinateur, dans l'ordre. */
export const laisser = mutation({
  args: { conversationOrigine: v.string(), texte: v.string() },
  returns: v.id("messagesFile"),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const texte = args.texte.trim();
    if (!origineValide(args.conversationOrigine) || texte.length < 1 || texte.length > 8000) throw erreur("conversation_invalide");
    const conversation = await parOrigine(ctx, moi._id, args.conversationOrigine);
    const agent = args.conversationOrigine.startsWith("dm-")
      ? await ctx.db
          .query("cartesAgents")
          .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id).eq("origine", args.conversationOrigine.slice(3)))
          .unique()
      : null;
    if (!conversation && !agent) throw erreur("introuvable");
    return await ctx.db.insert("messagesFile", {
      membreId: moi._id,
      conversationOrigine: args.conversationOrigine,
      texte,
      creeLe: Date.now(),
      pris: false,
    });
  },
});

export const annuler = mutation({
  args: { id: v.id("messagesFile") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const moi = await exigerMembre(ctx);
    const ligne = await ctx.db.get("messagesFile", id);
    if (!ligne || ligne.membreId !== moi._id) throw erreur("introuvable");
    if (!ligne.pris) await ctx.db.delete("messagesFile", id);
    return null;
  },
});

/** Ce qui attend encore l'ordinateur. */
export const enAttente = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("messagesFile"),
      conversationOrigine: v.string(),
      texte: v.string(),
      creeLe: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const lignes = await ctx.db
      .query("messagesFile")
      .withIndex("by_membre_and_pris_and_creeLe", (q) => q.eq("membreId", moi._id).eq("pris", false))
      .take(50);
    return lignes.map((m) => ({ _id: m._id, conversationOrigine: m.conversationOrigine, texte: m.texte, creeLe: m.creeLe }));
  },
});

/** L'ordinateur prend le message. Un second appel ne le rend pas deux fois. */
export const prendre = mutation({
  args: { id: v.id("messagesFile") },
  returns: v.union(v.object({ conversationOrigine: v.string(), texte: v.string() }), v.null()),
  handler: async (ctx, { id }) => {
    const moi = await exigerMembre(ctx);
    const ligne = await ctx.db.get("messagesFile", id);
    if (!ligne || ligne.membreId !== moi._id || ligne.pris) return null;
    await ctx.db.patch("messagesFile", id, { pris: true });
    return { conversationOrigine: ligne.conversationOrigine, texte: ligne.texte };
  },
});
