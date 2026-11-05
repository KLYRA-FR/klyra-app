import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";
import { REACTIONS, reactionValide } from "./model/reactions";

/** Lots : une conversation tient ses messages à part, pour rester sous la taille d'un document. */
const LOT_CONVERSATIONS = 40;
const LOT_MESSAGES = 25;
const LOT_CARTES = 50;
const PAGE_MESSAGES = 400;
/** Pièces jointes du téléphone (spec mobile T-02) : 10 au plus, 20 Mo chacune, comme une image collée au bureau. */
export const PIECES_MAX = 10;
export const PIECE_TAILLE_MAX = 20 * 1024 * 1024;
/** Un message pris mais jamais terminé (ordinateur fermé entre-temps) : ses pièces sont effacées après ce délai. */
export const PIECES_VIE_MS = 15 * 60_000;
const OPTIONS_MAX = 2000;

const vKind = v.union(v.literal("direct"), v.literal("equipe"));
const vStatut = v.union(v.literal("en-cours"), v.literal("fait"), v.literal("erreur"), v.null());
const vAuteur = v.union(v.literal("user"), v.literal("role"));

export function origineValide(valeur: string): boolean {
  return valeur.length >= 1 && valeur.length <= 200 && !/[\u0000-\u001f]/.test(valeur);
}

/** Un champ JSON court venu de l'ordinateur ou du téléphone : un objet, sinon refusé. */
function objetJson(valeur: string, max: number): Record<string, unknown> | null {
  if (valeur.length > max) return null;
  try {
    const brut = JSON.parse(valeur) as unknown;
    return brut && typeof brut === "object" && !Array.isArray(brut) ? (brut as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function court(valeur: string, max: number): string {
  const texte = valeur.replace(/\u0000/g, "").trim();
  return texte.length <= max ? texte : texte.slice(0, max);
}

export async function parOrigine(ctx: QueryCtx | MutationCtx, membreId: Id<"membres">, origine: string) {
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
  lieu: v.optional(v.union(v.string(), v.null())),
  parent: v.optional(v.union(v.string(), v.null())),
  archiveLe: v.optional(v.union(v.string(), v.null())),
  activite: v.optional(v.union(v.string(), v.null())),
  modele: v.optional(v.union(v.string(), v.null())),
  contexte: v.optional(v.union(v.string(), v.null())),
});

/** Les champs ajoutés pour le téléphone : absents d'une version d'avant, ils restent tels quels. */
function champsTelephone(entree: {
  lieu?: string | null;
  parent?: string | null;
  archiveLe?: string | null;
  activite?: string | null;
  modele?: string | null;
  contexte?: string | null;
}) {
  if (entree.parent && !origineValide(entree.parent)) throw erreur("conversation_invalide");
  if (entree.activite && !objetJson(entree.activite, 2000)) throw erreur("conversation_invalide");
  if (entree.modele && !objetJson(entree.modele, 200)) throw erreur("conversation_invalide");
  if (entree.contexte && !objetJson(entree.contexte, 200)) throw erreur("conversation_invalide");
  const champs: Partial<Pick<Doc<"conversationsCompte">, "lieu" | "parent" | "archiveLe" | "activite" | "modele" | "contexte">> = {};
  if (entree.lieu !== undefined) champs.lieu = entree.lieu ? court(entree.lieu, 300) : null;
  if (entree.parent !== undefined) champs.parent = entree.parent;
  if (entree.archiveLe !== undefined) champs.archiveLe = entree.archiveLe ? court(entree.archiveLe, 40) : null;
  if (entree.activite !== undefined) champs.activite = entree.activite;
  if (entree.modele !== undefined) champs.modele = entree.modele;
  if (entree.contexte !== undefined) champs.contexte = entree.contexte;
  return champs;
}

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
        ...champsTelephone(entree),
      };
      const existante = await parOrigine(ctx, moi._id, entree.origine);
      if (existante) await ctx.db.patch("conversationsCompte", existante._id, ligne);
      else await ctx.db.insert("conversationsCompte", ligne);
      n += 1;
    }
    return n;
  },
});

/** Les conversations ouvertes depuis le téléphone que l'ordinateur n'a pas encore créées. */
async function creeesSurLeTelephone(ctx: MutationCtx, membreId: Id<"membres">): Promise<Set<string>> {
  const operations = await ctx.db
    .query("operationsFile")
    .withIndex("by_membre_and_pris_and_creeLe", (q) => q.eq("membreId", membreId).eq("pris", false))
    .take(200);
  const messages = await ctx.db
    .query("messagesFile")
    .withIndex("by_membre_and_pris_and_creeLe", (q) => q.eq("membreId", membreId).eq("pris", false))
    .take(100);
  return new Set([
    ...operations.filter((o) => o.type === "creerFil" && o.conversationOrigine).map((o) => o.conversationOrigine!),
    ...messages.filter((m) => m.options && objetJson(m.options, OPTIONS_MAX)?.nouveau).map((m) => m.conversationOrigine),
  ]);
}

/** Retire du compte les conversations qui ne sont plus sur l'ordinateur. Les messages restent. */
export const alignerConversations = mutation({
  args: { origines: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { origines }) => {
    const moi = await exigerMembre(ctx);
    if (origines.length > 2000) throw erreur("lot_trop_grand");
    /* Celles que le téléphone vient d'ouvrir restent : l'ordinateur les crée en reprenant sa file. */
    const gardes = new Set([...origines, ...(await creeesSurLeTelephone(ctx, moi._id))]);
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
  reactions: v.optional(v.array(v.string())),
  compaction: v.optional(v.boolean()),
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
        ...(entree.reactions !== undefined ? { reactions: entree.reactions.filter(reactionValide).slice(0, REACTIONS.length) } : {}),
        ...(entree.compaction !== undefined ? { compaction: entree.compaction } : {}),
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
      lieu: v.union(v.string(), v.null()),
      parent: v.union(v.string(), v.null()),
      archiveLe: v.union(v.string(), v.null()),
      activite: v.union(v.string(), v.null()),
      modele: v.union(v.string(), v.null()),
      contexte: v.union(v.string(), v.null()),
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
      lieu: c.lieu ?? null,
      /* Une copie d'avant : le fil se reconnaît à son id, son agent est le seul de la conversation. */
      parent: c.parent ?? (c.origine.startsWith("klyra-fil-") && c.roleIds[0] ? `dm-${c.roleIds[0]}` : null),
      archiveLe: c.archiveLe ?? null,
      activite: c.activite ?? null,
      modele: c.modele ?? null,
      contexte: c.contexte ?? null,
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
        reactions: v.array(v.string()),
        compaction: v.boolean(),
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
        reactions: m.reactions ?? [],
        compaction: m.compaction === true,
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

/* ─── File : ce que le téléphone laisse à l'ordinateur ─────────── */

const vPieceDeposee = v.object({ fichier: v.id("_storage"), nom: v.string(), type: v.string() });

/** Titre d'une conversation d'équipe ouverte depuis le téléphone : le début du premier message, comme au bureau. */
function titreDe(texte: string): string {
  const propre = texte.replace(/\s+/g, " ").trim();
  return propre.length > 42 ? `${propre.slice(0, 40).trimEnd()}…` : propre;
}

/** Un nom de fichier sûr : sans dossier ni caractère de contrôle. */
function nomPiece(nom: string): string {
  const propre = nom.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).at(-1)?.trim() ?? "";
  return (propre || "fichier").slice(0, 120);
}

async function effacerPieces(ctx: MutationCtx, ligne: Doc<"messagesFile">) {
  for (const piece of ligne.pieces ?? []) {
    if (await ctx.db.system.get("_storage", piece.fichier)) await ctx.storage.delete(piece.fichier);
  }
}

/**
 * Le téléphone écrit. Le message attend l'ordinateur, dans l'ordre, avec ce qui part avec lui
 * (`options` : destinataire, modèle, effort, façon de réessayer, branche, nouvelle conversation…)
 * et ses pièces, déjà déposées dans le stockage du compte.
 */
export const laisser = mutation({
  args: {
    conversationOrigine: v.string(),
    texte: v.string(),
    options: v.optional(v.string()),
    pieces: v.optional(v.array(vPieceDeposee)),
  },
  returns: v.id("messagesFile"),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const texte = args.texte.trim();
    if (!origineValide(args.conversationOrigine) || texte.length < 1 || texte.length > 8000) throw erreur("conversation_invalide");
    const options = args.options === undefined ? null : objetJson(args.options, OPTIONS_MAX);
    if (args.options !== undefined && !options) throw erreur("conversation_invalide");
    const pieces = args.pieces ?? [];
    if (pieces.length > PIECES_MAX) throw erreur("conversation_invalide");
    const deposees: { fichier: Id<"_storage">; nom: string; type: string; taille: number }[] = [];
    for (const piece of pieces) {
      const meta = await ctx.db.system.get("_storage", piece.fichier);
      if (!meta) throw erreur("conversation_invalide");
      /* Le téléphone vérifie la taille avant de déposer : ce refus n'arrive qu'à un appel fait à la main. */
      if (meta.size > PIECE_TAILLE_MAX) throw erreur("fichier_trop_lourd");
      deposees.push({ fichier: piece.fichier, nom: nomPiece(piece.nom), type: court(piece.type, 100), taille: meta.size });
    }

    const conversation = await parOrigine(ctx, moi._id, args.conversationOrigine);
    const agent = args.conversationOrigine.startsWith("dm-")
      ? await ctx.db
          .query("cartesAgents")
          .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id).eq("origine", args.conversationOrigine.slice(3)))
          .unique()
      : null;
    const nouveau = options?.nouveau as { projetId?: unknown } | undefined;
    if (!conversation && nouveau) {
      /* Une conversation d'équipe ouverte depuis le téléphone : elle est dans le compte tout de suite. */
      if (!/^[0-9a-f-]{36}$/.test(args.conversationOrigine) || typeof nouveau.projetId !== "string") throw erreur("conversation_invalide");
      const projetId = nouveau.projetId;
      const projet = await ctx.db
        .query("cartesProjets")
        .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id).eq("origine", projetId))
        .unique();
      if (!projet) throw erreur("introuvable");
      const a = typeof options?.a === "string" && options.a !== "principal" && origineValide(options.a) ? options.a : null;
      const maintenant = new Date().toISOString();
      await ctx.db.insert("conversationsCompte", {
        membreId: moi._id,
        origine: args.conversationOrigine,
        kind: "equipe",
        titre: titreDe(texte) || "Conversation",
        projetId: projet.origine,
        projetNom: projet.nom,
        roleIds: a ? ["principal", a] : ["principal"],
        misAJour: maintenant,
        epingleLe: null,
        extrait: "",
        extraitLe: null,
        nonLus: 0,
        taches: "[]",
        lieu: null,
        parent: null,
        archiveLe: null,
        activite: null,
        modele: null,
      });
    } else if (!conversation && !agent) {
      throw erreur("introuvable");
    }
    return await ctx.db.insert("messagesFile", {
      membreId: moi._id,
      conversationOrigine: args.conversationOrigine,
      texte,
      creeLe: Date.now(),
      pris: false,
      ...(options ? { options: JSON.stringify(options) } : {}),
      ...(deposees.length ? { pieces: deposees } : {}),
    });
  },
});

/** « Annuler l'envoi » : tant que l'ordinateur ne l'a pas pris, le message et ses pièces disparaissent. Faux : il était déjà parti. */
export const annuler = mutation({
  args: { id: v.id("messagesFile") },
  returns: v.boolean(),
  handler: async (ctx, { id }) => {
    const moi = await exigerMembre(ctx);
    const ligne = await ctx.db.get("messagesFile", id);
    if (!ligne || ligne.membreId !== moi._id) throw erreur("introuvable");
    if (ligne.pris) return false;
    await effacerPieces(ctx, ligne);
    await ctx.db.delete("messagesFile", id);
    return true;
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
      options: v.union(v.string(), v.null()),
      pieces: v.array(v.object({ nom: v.string(), taille: v.number() })),
    }),
  ),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const lignes = await ctx.db
      .query("messagesFile")
      .withIndex("by_membre_and_pris_and_creeLe", (q) => q.eq("membreId", moi._id).eq("pris", false))
      .take(50);
    return lignes.map((m) => ({
      _id: m._id,
      conversationOrigine: m.conversationOrigine,
      texte: m.texte,
      creeLe: m.creeLe,
      options: m.options ?? null,
      pieces: (m.pieces ?? []).map((p) => ({ nom: p.nom, taille: p.taille })),
    }));
  },
});

/**
 * L'ordinateur prend le message. Un second appel ne le rend pas deux fois. Les pièces viennent avec
 * leur adresse de téléchargement ; l'ordinateur les écrit sur le disque puis appelle `terminer`, qui
 * les efface du compte. S'il ne le fait pas (fermé entre-temps), elles sont effacées après 15 min.
 */
export const prendre = mutation({
  args: { id: v.id("messagesFile") },
  returns: v.union(
    v.object({
      conversationOrigine: v.string(),
      texte: v.string(),
      options: v.optional(v.string()),
      pieces: v.optional(v.array(v.object({ nom: v.string(), type: v.string(), taille: v.number(), url: v.string() }))),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const moi = await exigerMembre(ctx);
    const ligne = await ctx.db.get("messagesFile", id);
    if (!ligne || ligne.membreId !== moi._id || ligne.pris) return null;
    await ctx.db.patch("messagesFile", id, { pris: true });
    const pieces: { nom: string; type: string; taille: number; url: string }[] = [];
    for (const piece of ligne.pieces ?? []) {
      const url = await ctx.storage.getUrl(piece.fichier);
      if (url) pieces.push({ nom: piece.nom, type: piece.type, taille: piece.taille, url });
    }
    if (ligne.pieces?.length) await ctx.scheduler.runAfter(PIECES_VIE_MS, internal.conversationsCompte.oublierPieces, { id });
    return {
      conversationOrigine: ligne.conversationOrigine,
      texte: ligne.texte,
      ...(ligne.options ? { options: ligne.options } : {}),
      ...(pieces.length ? { pieces } : {}),
    };
  },
});

/** L'ordinateur a repris le message (pièces écrites sur son disque) : rien n'en reste dans le compte. */
export const terminer = mutation({
  args: { id: v.id("messagesFile") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const moi = await exigerMembre(ctx);
    const ligne = await ctx.db.get("messagesFile", id);
    if (!ligne || ligne.membreId !== moi._id || !ligne.pris) return null;
    await effacerPieces(ctx, ligne);
    await ctx.db.delete("messagesFile", id);
    return null;
  },
});

export const oublierPieces = internalMutation({
  args: { id: v.id("messagesFile") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const ligne = await ctx.db.get("messagesFile", id);
    if (!ligne) return null;
    await effacerPieces(ctx, ligne);
    await ctx.db.delete("messagesFile", id);
    return null;
  },
});

/* ─── Recherche (T-04) ─────────────────────────────────────────── */

const sansAccents = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** L'extrait autour du premier mot trouvé : un peu de contexte avant, le reste après, « … » aux bords. */
export function extraitAutour(texte: string, requete: string): string {
  const propre = texte.replace(/\s+/g, " ").trim();
  const normal = sansAccents(propre);
  const mots = sansAccents(requete).split(/[\s"«»“”]+/).filter((m) => m.length >= 2);
  const positions = mots.map((m) => normal.indexOf(m)).filter((i) => i >= 0);
  const premier = positions.length ? Math.min(...positions) : 0;
  const debut = Math.max(0, premier - 40);
  const fin = Math.min(propre.length, debut + 180);
  return `${debut > 0 ? "…" : ""}${propre.slice(debut, fin).trim()}${fin < propre.length ? "…" : ""}`;
}

/** Une conversation d'agent : sa conversation directe ou un de ses fils (portée « Agents »). */
const estDAgent = (origine: string) => origine.startsWith("dm-") || origine.startsWith("klyra-fil-");

/**
 * Les messages du compte qui correspondent, les plus récents d'abord (40 au plus). Pas les réponses en
 * cours d'écriture, comme au bureau. Les titres de conversations se cherchent sur le téléphone.
 */
export const chercher = query({
  args: {
    requete: v.string(),
    portee: v.union(v.literal("tout"), v.literal("agents"), v.literal("projets"), v.literal("conversation")),
    conversationOrigine: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      conversationOrigine: v.string(),
      origine: v.string(),
      auteurKind: vAuteur,
      auteurId: v.union(v.string(), v.null()),
      creeLe: v.string(),
      extrait: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const requete = args.requete.trim().slice(0, 200);
    if (sansAccents(requete).replace(/[\s"«»“”]+/g, "").length < 2) return [];
    const dans = args.portee === "conversation" && args.conversationOrigine && origineValide(args.conversationOrigine) ? args.conversationOrigine : null;
    const lignes = await ctx.db
      .query("messagesCompte")
      .withSearchIndex("search_texte", (q) => {
        const base = q.search("texte", requete).eq("membreId", moi._id);
        return dans ? base.eq("conversationOrigine", dans) : base;
      })
      .take(80);
    return lignes
      .filter((m) => m.statut !== "en-cours")
      .filter((m) => (args.portee === "agents" ? estDAgent(m.conversationOrigine) : args.portee === "projets" ? !estDAgent(m.conversationOrigine) : true))
      .sort((a, b) => b.creeLe.localeCompare(a.creeLe))
      .slice(0, 40)
      .map((m) => ({
        conversationOrigine: m.conversationOrigine,
        origine: m.origine,
        auteurKind: m.auteurKind,
        auteurId: m.auteurId,
        creeLe: m.creeLe,
        extrait: extraitAutour(m.texte, requete),
      }));
  },
});
