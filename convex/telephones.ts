import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { env, mutation, query, type QueryCtx } from "./_generated/server";
import { erreur, exigerMembre, sessionActuelle } from "./model/acces";
import { adresseApp as adresseValable } from "./model/contenus";

/**
 * Réglages › Mobile : les sessions de mon compte ouvertes hors de l'app de bureau (téléphone,
 * navigateur), et leur déconnexion à distance. La liste part des sessions de Convex Auth
 * (`authSessions`), pas d'une table tenue à part : une session qui ne s'est jamais signalée
 * (version d'avant, appareil inconnu) reste visible et se déconnecte comme les autres.
 */

/** `vu` s'écrit au plus une fois par minute (comme `vu` des appareils du serveur VPS). */
export const VU_MS = 60_000;

const vModele = v.union(v.literal("iphone"), v.literal("android"), v.literal("navigateur"));

const vTelephone = v.object({
  sessionId: v.id("authSessions"),
  /** null : la session ne s'est jamais signalée (appareil non identifié). */
  modele: v.union(vModele, v.null()),
  connecteLe: v.number(),
  vu: v.number(),
});

async function posteDeSession(ctx: QueryCtx, sessionId: Id<"authSessions">): Promise<Doc<"postes"> | null> {
  return await ctx.db
    .query("postes")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .first();
}

/** Le téléphone dit qu'il est ouvert. La session vient du jeton, jamais d'un argument. */
export const signaler = mutation({
  args: { modele: vModele },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const session = await sessionActuelle(ctx);
    if (session === null) throw erreur("non_connecte");
    /* L'app de bureau se signale par `postes:signaler` : elle n'est pas un téléphone. */
    if (await posteDeSession(ctx, session._id)) return null;
    const existant = await ctx.db
      .query("telephones")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .unique();
    const maintenant = Date.now();
    if (existant) {
      if (existant.modele !== args.modele || maintenant - existant.vu >= VU_MS) {
        await ctx.db.patch("telephones", existant._id, { modele: args.modele, vu: maintenant });
      }
      return null;
    }
    /* Les lignes des sessions fermées par `signOut` (sur le téléphone même) partent ici. */
    const anciennes = await ctx.db
      .query("telephones")
      .withIndex("by_membre", (q) => q.eq("membreId", moi._id))
      .take(100);
    for (const ligne of anciennes) {
      if ((await ctx.db.get("authSessions", ligne.sessionId)) === null) await ctx.db.delete("telephones", ligne._id);
    }
    await ctx.db.insert("telephones", { membreId: moi._id, sessionId: session._id, modele: args.modele, cree: maintenant, vu: maintenant });
    return null;
  },
});

/**
 * Mes sessions hors de l'app de bureau, la plus récente d'abord, page par page : aucune n'est
 * cachée au-delà d'un plafond. Ni cette session, ni celles d'un ordinateur, ni les expirées.
 * Une page peut donc compter moins de lignes que demandé ; `isDone` dit s'il en reste.
 */
export const liste = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(vTelephone),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const actuelle = await sessionActuelle(ctx);
    const resultat = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", moi.userId))
      .order("desc")
      .paginate(args.paginationOpts);
    const maintenant = Date.now();
    const page = [];
    for (const session of resultat.page) {
      if (session._id === actuelle?._id || session.expirationTime < maintenant) continue;
      if (await posteDeSession(ctx, session._id)) continue;
      const telephone = await ctx.db
        .query("telephones")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .unique();
      /* Convex Auth renouvelle le jeton d'une session active : le dernier renouvellement date son activité. */
      const dernierJeton = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .order("desc")
        .first();
      page.push({
        sessionId: session._id,
        modele: telephone?.modele ?? null,
        connecteLe: session._creationTime,
        vu: Math.max(session._creationTime, telephone?.vu ?? 0, dernierJeton?._creationTime ?? 0),
      });
    }
    return { ...resultat, page };
  },
});

/**
 * Ferme une de mes sessions, tout de suite : session, jetons de renouvellement et ligne du
 * téléphone. `membreActuel` refuse ensuite son jeton d'accès, encore valable jusqu'à une heure.
 * Jamais cette session-ci, ni celle d'un ordinateur.
 */
export const deconnecter = mutation({
  args: { sessionId: v.id("authSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const session = await ctx.db.get("authSessions", args.sessionId);
    if (session === null || session.userId !== moi.userId) throw erreur("introuvable");
    if (session._id === (await sessionActuelle(ctx))?._id) throw erreur("session_actuelle");
    if (await posteDeSession(ctx, session._id)) throw erreur("session_ordinateur");
    for await (const jeton of ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", session._id))) {
      await ctx.db.delete("authRefreshTokens", jeton._id);
    }
    for await (const ligne of ctx.db.query("telephones").withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))) {
      await ctx.db.delete("telephones", ligne._id);
    }
    await ctx.db.delete("authSessions", session._id);
    return null;
  },
});

/** L'adresse https de l'app web (`KLYRA_APP_URL`, même source que la page relais), ou null. */
export const adresseApp = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    await exigerMembre(ctx);
    return adresseValable(env.KLYRA_APP_URL);
  },
});
