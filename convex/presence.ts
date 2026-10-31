import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";

/** Une seule salle : l'app de bureau, pas une pièce par écran. */
export const SALLE = "klyra";

export const presence = new Presence(components.presence);

/**
 * L'app signale qu'elle est ouverte. L'identifiant vient de la session :
 * celui envoyé par l'app est ignoré. Sans signal pendant 2,5 intervalles,
 * le composant passe la personne hors ligne.
 */
export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, { roomId, sessionId, interval }) => {
    const membre = await exigerMembre(ctx);
    if (roomId !== SALLE || sessionId.length < 8 || sessionId.length > 200 || interval < 5_000 || interval > 60_000) {
      throw erreur("rappel_invalide");
    }
    return await presence.heartbeat(ctx, SALLE, membre._id, sessionId, interval);
  },
});

/** Fermeture de l'app : le jeton de session suffit, l'appel part sans session (page qui se ferme). */
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    if (sessionToken.length < 8 || sessionToken.length > 200) return null;
    await presence.disconnect(ctx, sessionToken);
    return null;
  },
});
