import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";
import { origineValide, parOrigine } from "./conversationsCompte";

/**
 * Les gestes « Compte » du téléphone sur une conversation (spec mobile T-01, T-02) : renommer,
 * épingler, ouvrir, archiver ou supprimer un fil, la marquer lue. Ils s'appliquent tout de suite à la copie du
 * compte, et partent sur l'ordinateur à son ouverture, dans l'ordre (`operationsFile`), avec les
 * messages laissés (`messagesFile`). L'ordinateur prend chaque geste une fois, puis il est effacé.
 */

const TYPES = ["renommer", "epingler", "creerFil", "archiverFil", "rouvrirFil", "lu"] as const;
export type TypeOperation = (typeof TYPES)[number];
const vType = v.union(
  v.literal("renommer"),
  v.literal("epingler"),
  v.literal("creerFil"),
  v.literal("archiverFil"),
  v.literal("rouvrirFil"),
  v.literal("lu"),
);

/** Un fil se reconnaît à son id, comme au bureau (`FIL` de `src/lib/workspace.tsx`). */
const FIL = /^klyra-fil-[0-9a-f]{8}$/;
/** Pas plus de gestes en attente : au-delà, l'ordinateur est fermé depuis trop longtemps pour tout rejouer. */
const EN_ATTENTE_MAX = 200;

async function empiler(ctx: MutationCtx, membreId: Id<"membres">, conversationOrigine: string, type: TypeOperation, valeur: Record<string, unknown>) {
  const enAttente = await ctx.db
    .query("operationsFile")
    .withIndex("by_membre_and_pris_and_creeLe", (q) => q.eq("membreId", membreId).eq("pris", false))
    .take(EN_ATTENTE_MAX);
  if (enAttente.length >= EN_ATTENTE_MAX) throw erreur("lot_trop_grand");
  await ctx.db.insert("operationsFile", { membreId, conversationOrigine, type, valeur: JSON.stringify(valeur), creeLe: Date.now(), pris: false });
}

async function conversation(ctx: MutationCtx, membreId: Id<"membres">, origine: string): Promise<Doc<"conversationsCompte">> {
  if (!origineValide(origine)) throw erreur("conversation_invalide");
  const ligne = await parOrigine(ctx, membreId, origine);
  if (!ligne) throw erreur("introuvable");
  return ligne;
}

const estFil = (c: Doc<"conversationsCompte">) => FIL.test(c.origine) || !!c.parent;

/** « Renommer » : une conversation d'équipe ou un fil. Le chat principal d'un agent garde son nom. */
export const renommer = mutation({
  args: { conversationOrigine: v.string(), titre: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const ligne = await conversation(ctx, moi._id, args.conversationOrigine);
    const titre = args.titre.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!titre || (ligne.kind === "direct" && !estFil(ligne))) throw erreur("conversation_invalide");
    await ctx.db.patch("conversationsCompte", ligne._id, { titre });
    await empiler(ctx, moi._id, ligne.origine, "renommer", { titre });
    return null;
  },
});

/** « Épingler » / « Retirer l'épingle » : les conversations d'équipe seulement, comme au bureau. */
export const epingler = mutation({
  args: { conversationOrigine: v.string(), epingle: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const ligne = await conversation(ctx, moi._id, args.conversationOrigine);
    if (ligne.kind !== "equipe") throw erreur("conversation_invalide");
    await ctx.db.patch("conversationsCompte", ligne._id, { epingleLe: args.epingle ? new Date().toISOString() : null });
    await empiler(ctx, moi._id, ligne.origine, "epingler", { epingle: args.epingle });
    return null;
  },
});

/** « Nouveau fil » : l'id vient du téléphone, pour l'ouvrir tout de suite ; l'ordinateur crée le fil sous ce même id. */
export const creerFil = mutation({
  args: { origine: v.string(), roleId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    if (!FIL.test(args.origine) || !origineValide(args.roleId)) throw erreur("conversation_invalide");
    if (await parOrigine(ctx, moi._id, args.origine)) throw erreur("conversation_invalide");
    const agent = await ctx.db
      .query("cartesAgents")
      .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id).eq("origine", args.roleId))
      .unique();
    if (!agent?.actif) throw erreur("introuvable");
    const maintenant = new Date().toISOString();
    await ctx.db.insert("conversationsCompte", {
      membreId: moi._id,
      origine: args.origine,
      kind: "direct",
      titre: "Nouveau fil",
      projetId: null,
      projetNom: null,
      roleIds: [args.roleId],
      misAJour: maintenant,
      epingleLe: null,
      extrait: "",
      extraitLe: null,
      nonLus: 0,
      taches: "[]",
      lieu: null,
      parent: `dm-${args.roleId}`,
      archiveLe: null,
      activite: null,
      modele: null,
    });
    await empiler(ctx, moi._id, args.origine, "creerFil", { roleId: args.roleId });
    return null;
  },
});

/** « Archiver » un fil (il s'arrête), ou « Supprimer » (retiré des archivés, rien n'est effacé sur l'ordinateur). */
export const archiverFil = mutation({
  args: { conversationOrigine: v.string(), supprime: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const ligne = await conversation(ctx, moi._id, args.conversationOrigine);
    if (!estFil(ligne)) throw erreur("conversation_invalide");
    if (args.supprime) await ctx.db.delete("conversationsCompte", ligne._id);
    else await ctx.db.patch("conversationsCompte", ligne._id, { archiveLe: new Date().toISOString(), activite: null });
    await empiler(ctx, moi._id, ligne.origine, "archiverFil", { supprime: args.supprime });
    return null;
  },
});

export const rouvrirFil = mutation({
  args: { conversationOrigine: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const ligne = await conversation(ctx, moi._id, args.conversationOrigine);
    if (!estFil(ligne)) throw erreur("conversation_invalide");
    await ctx.db.patch("conversationsCompte", ligne._id, { archiveLe: null });
    await empiler(ctx, moi._id, ligne.origine, "rouvrirFil", {});
    return null;
  },
});

/**
 * La conversation lue sur le téléphone : ses non-lus et sa question tombent tout de suite dans le
 * compte (pastille de la barre du bas), et l'ordinateur la marque lue à son ouverture. Rien n'est
 * empilé s'il n'y avait rien à lire.
 */
export const marquerLu = mutation({
  args: { conversationOrigine: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    if (!origineValide(args.conversationOrigine)) throw erreur("conversation_invalide");
    const ligne = await parOrigine(ctx, moi._id, args.conversationOrigine);
    const question = !!ligne?.activite && ligne.activite.includes('"etat":"question"');
    if (!ligne || (ligne.nonLus === 0 && !question)) return null;
    await ctx.db.patch("conversationsCompte", ligne._id, { nonLus: 0, ...(question ? { activite: null } : {}) });
    await empiler(ctx, moi._id, ligne.origine, "lu", {});
    return null;
  },
});

/** L'ordinateur : les gestes qui l'attendent, dans l'ordre. */
export const aRejouer = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("operationsFile"),
      conversationOrigine: v.union(v.string(), v.null()),
      type: vType,
      creeLe: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const lignes = await ctx.db
      .query("operationsFile")
      .withIndex("by_membre_and_pris_and_creeLe", (q) => q.eq("membreId", moi._id).eq("pris", false))
      .take(EN_ATTENTE_MAX);
    return lignes
      .filter((o): o is typeof o & { type: TypeOperation } => (TYPES as readonly string[]).includes(o.type))
      .map((o) => ({ _id: o._id, conversationOrigine: o.conversationOrigine, type: o.type, creeLe: o.creeLe }));
  },
});

/** L'ordinateur prend le geste : il le reçoit une fois, et le geste est effacé du compte. */
export const prendre = mutation({
  args: { id: v.id("operationsFile") },
  returns: v.union(v.object({ conversationOrigine: v.union(v.string(), v.null()), type: v.string(), valeur: v.string() }), v.null()),
  handler: async (ctx, { id }) => {
    const moi = await exigerMembre(ctx);
    const ligne = await ctx.db.get("operationsFile", id);
    if (!ligne || ligne.membreId !== moi._id || ligne.pris) return null;
    await ctx.db.delete("operationsFile", id);
    return { conversationOrigine: ligne.conversationOrigine, type: ligne.type, valeur: ligne.valeur };
  },
});
