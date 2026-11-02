import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { erreur, exigerMembre, sessionActuelle } from "./model/acces";
import {
  abonnementValable,
  clesVapid,
  ecrirePreferences,
  lirePreferences,
  messagePush,
  PREFERENCES_PAR_DEFAUT,
  type MessagePush,
} from "./model/push";
import { majuscule, support } from "../src/lib/poste-texte";
import { OUVERT_MS } from "./postes";

/**
 * Notifications du téléphone (spec mobile § 8) : un abonnement web push par session, ses choix par
 * événement, et l'envoi. L'ordinateur déclenche les quatre événements du bureau (`pousser`) ; Convex
 * envoie lui-même « Ton Mac s'est ouvert » (`prevenirOuverture`, depuis `postes:signaler`). L'envoi
 * part dans une action Node (`notificationsPushEnvoi.ts`). Sans clés VAPID, rien ne part.
 */

const vEvenementBureau = v.union(v.literal("accord"), v.literal("agentFini"), v.literal("agentErreur"), v.literal("workflow"));
const vEvenement = v.union(vEvenementBureau, v.literal("ouverture"));
const vPreferences = v.object({ accord: v.boolean(), agentFini: v.boolean(), agentErreur: v.boolean(), workflow: v.boolean(), ouverture: v.boolean() });
const ATTENTES_MAX = 20;

async function maSession(ctx: QueryCtx) {
  const moi = await exigerMembre(ctx);
  const session = await sessionActuelle(ctx);
  if (session === null) throw erreur("non_connecte");
  return { moi, session };
}

async function abonnementDeSession(ctx: QueryCtx, sessionId: Id<"authSessions">) {
  return await ctx.db
    .query("abonnementsPush")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .first();
}

/**
 * Les abonnements d'un membre qui veulent cet événement. Ceux d'une session fermée (déconnexion à
 * distance, `signOut`) partent ici : un téléphone déconnecté ne reçoit plus rien.
 */
async function destinataires(ctx: MutationCtx, membreId: Id<"membres">, garder: (a: Doc<"abonnementsPush">) => boolean) {
  const gardes: Doc<"abonnementsPush">[] = [];
  const lignes = await ctx.db
    .query("abonnementsPush")
    .withIndex("by_membre", (q) => q.eq("membreId", membreId))
    .take(50);
  for (const ligne of lignes) {
    if ((await ctx.db.get("authSessions", ligne.sessionId)) === null) {
      await ctx.db.delete("abonnementsPush", ligne._id);
      continue;
    }
    if (garder(ligne)) gardes.push(ligne);
  }
  return gardes;
}

async function programmer(ctx: MutationCtx, ids: Id<"abonnementsPush">[], message: MessagePush) {
  if (ids.length === 0 || clesVapid(env) === null) return 0;
  await ctx.scheduler.runAfter(0, internal.notificationsPushEnvoi.envoyer, { ids, message });
  return ids.length;
}

/** La clé publique VAPID, que le téléphone donne au navigateur pour s'abonner. Null : rien ne part. */
export const clePublique = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    await exigerMembre(ctx);
    return clesVapid(env)?.publique ?? null;
  },
});

/** L'abonnement de cette session, ses choix et les ouvertures attendues. */
export const monAbonnement = query({
  args: {},
  returns: v.union(
    v.object({
      endpoint: v.string(),
      preferences: vPreferences,
      ouverturesAttendues: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const { session } = await maSession(ctx);
    const ligne = await abonnementDeSession(ctx, session._id);
    if (!ligne) return null;
    return { endpoint: ligne.endpoint, preferences: lirePreferences(ligne.preferences), ouverturesAttendues: ligne.ouverturesAttendues ?? [] };
  },
});

/**
 * Le téléphone s'abonne (ou renouvelle son abonnement) : une ligne par session. Le même navigateur
 * repris par une autre session (reconnexion) ne garde que la nouvelle ligne.
 */
export const sAbonner = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { moi, session } = await maSession(ctx);
    if (!abonnementValable(args)) throw erreur("demande_invalide");
    const existant = await abonnementDeSession(ctx, session._id);
    let preferences = existant?.preferences ?? ecrirePreferences(PREFERENCES_PAR_DEFAUT);
    for await (const ancien of ctx.db.query("abonnementsPush").withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))) {
      if (ancien._id === existant?._id) continue;
      if (!existant && ancien.membreId === moi._id) preferences = ancien.preferences;
      await ctx.db.delete("abonnementsPush", ancien._id);
    }
    const champs = { endpoint: args.endpoint, p256dh: args.p256dh, auth: args.auth };
    if (existant) await ctx.db.patch("abonnementsPush", existant._id, champs);
    else await ctx.db.insert("abonnementsPush", { membreId: moi._id, sessionId: session._id, ...champs, preferences, cree: Date.now() });
    return null;
  },
});

/** « Couper les notifications sur ce téléphone ». */
export const seDesabonner = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { session } = await maSession(ctx);
    for await (const ligne of ctx.db.query("abonnementsPush").withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))) {
      await ctx.db.delete("abonnementsPush", ligne._id);
    }
    return null;
  },
});

/** Un interrupteur de Réglages › Ce téléphone. */
export const changerPreference = mutation({
  args: { evenement: vEvenement, actif: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { session } = await maSession(ctx);
    const ligne = await abonnementDeSession(ctx, session._id);
    if (!ligne) throw erreur("introuvable");
    const preferences = { ...lirePreferences(ligne.preferences), [args.evenement]: args.actif };
    await ctx.db.patch("abonnementsPush", ligne._id, { preferences: ecrirePreferences(preferences) });
    return null;
  },
});

/**
 * « Me prévenir à l'ouverture » (T-23) : une seule notification, au prochain retour de ce poste.
 * Demander, c'est aussi vouloir « Ton Mac s'est ouvert » : l'interrupteur se rallume. Poste déjà
 * ouvert : rien n'est gardé (« ouvert »).
 */
export const attendreOuverture = mutation({
  args: { cle: v.string() },
  returns: v.union(v.literal("attente"), v.literal("ouvert")),
  handler: async (ctx, args) => {
    const { moi, session } = await maSession(ctx);
    const poste = await ctx.db
      .query("postes")
      .withIndex("by_membre_and_cle", (q) => q.eq("membreId", moi._id).eq("cle", args.cle))
      .unique();
    if (!poste) throw erreur("poste_invalide");
    const ligne = await abonnementDeSession(ctx, session._id);
    if (!ligne) throw erreur("introuvable");
    if (Date.now() - poste.dernierSignal < OUVERT_MS) return "ouvert";
    const attendues = ligne.ouverturesAttendues ?? [];
    await ctx.db.patch("abonnementsPush", ligne._id, {
      ouverturesAttendues: attendues.includes(args.cle) ? attendues : [...attendues, args.cle].slice(-ATTENTES_MAX),
      preferences: ecrirePreferences({ ...lirePreferences(ligne.preferences), ouverture: true }),
    });
    return "attente";
  },
});

/**
 * L'ordinateur prévient le téléphone, aux mêmes moments que ses notifications du bureau, et
 * seulement quand sa fenêtre n'a pas le focus (pas de doublon : c'est l'ordinateur qui le sait).
 * Renvoie le nombre de téléphones visés.
 */
export const pousser = mutation({
  args: { evenement: vEvenementBureau, titre: v.string(), corps: v.string(), lien: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const message = messagePush(args.evenement, args.titre, args.corps, args.lien);
    if (!message) throw erreur("demande_invalide");
    if (clesVapid(env) === null) return 0;
    const abonnes = await destinataires(ctx, moi._id, (a) => lirePreferences(a.preferences)[args.evenement]);
    return await programmer(ctx, abonnes.map((a) => a._id), message);
  },
});

/**
 * Le poste se signale de nouveau après une absence (`postes:signaler`) : ceux qui ont demandé
 * « Me prévenir à l'ouverture » sont prévenus, une seule fois. La demande est consommée même
 * si l'interrupteur a été coupé entre-temps.
 */
export async function prevenirOuverture(ctx: MutationCtx, membreId: Id<"membres">, poste: Pick<Doc<"postes">, "cle" | "systeme" | "nom">) {
  const abonnes = await destinataires(ctx, membreId, (a) => (a.ouverturesAttendues ?? []).includes(poste.cle));
  const envoyes: Id<"abonnementsPush">[] = [];
  for (const ligne of abonnes) {
    await ctx.db.patch("abonnementsPush", ligne._id, { ouverturesAttendues: (ligne.ouverturesAttendues ?? []).filter((cle) => cle !== poste.cle) });
    if (lirePreferences(ligne.preferences).ouverture) envoyes.push(ligne._id);
  }
  const sur = support(poste);
  const message = messagePush("ouverture", `${majuscule(sur)} s’est ouvert`, `KLYRA est ouverte sur ${sur}.`, "/chats");
  if (message) await programmer(ctx, envoyes, { ...message, tag: `ouverture:${poste.cle}` });
}

/** Pour l'action d'envoi : les abonnements encore là. */
export const aEnvoyer = internalQuery({
  args: { ids: v.array(v.id("abonnementsPush")) },
  returns: v.array(v.object({ _id: v.id("abonnementsPush"), endpoint: v.string(), p256dh: v.string(), auth: v.string() })),
  handler: async (ctx, args) => {
    const lignes = [];
    for (const id of args.ids.slice(0, 50)) {
      const ligne = await ctx.db.get("abonnementsPush", id);
      if (ligne) lignes.push({ _id: ligne._id, endpoint: ligne.endpoint, p256dh: ligne.p256dh, auth: ligne.auth });
    }
    return lignes;
  },
});

/** Les abonnements morts (404, 410) : retirés. */
export const retirerMorts = internalMutation({
  args: { ids: v.array(v.id("abonnementsPush")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const id of args.ids.slice(0, 50)) {
      if (await ctx.db.get("abonnementsPush", id)) await ctx.db.delete("abonnementsPush", id);
    }
    return null;
  },
});
