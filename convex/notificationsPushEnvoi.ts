"use node";

import { v } from "convex/values";
import webpush from "web-push";
import { internal } from "./_generated/api";
import { env, internalAction } from "./_generated/server";
import { clesVapid, envoyerATous } from "./model/push";

/**
 * L'envoi des notifications du téléphone (web push, clés VAPID de l'env Convex). Programmé par
 * `notificationsPush` ; un abonnement que le service de push dit mort (404, 410) est retiré.
 */
export const envoyer = internalAction({
  args: {
    ids: v.array(v.id("abonnementsPush")),
    message: v.object({ titre: v.string(), corps: v.string(), lien: v.string(), tag: v.string() }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cles = clesVapid(env);
    if (cles === null) return null;
    const abonnements = await ctx.runQuery(internal.notificationsPush.aEnvoyer, { ids: args.ids });
    const charge = JSON.stringify(args.message);
    const morts = await envoyerATous(abonnements, (abonnement) =>
      webpush.sendNotification(abonnement, charge, {
        vapidDetails: { subject: cles.sujet, publicKey: cles.publique, privateKey: cles.privee },
        /* Un accord ou une réponse qui attend depuis un jour n'a plus besoin de sonner. */
        TTL: 24 * 60 * 60,
        urgency: "high",
      }),
    );
    if (morts.length) await ctx.runMutation(internal.notificationsPush.retirerMorts, { ids: morts });
    return null;
  },
});
