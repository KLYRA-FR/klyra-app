import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import { erreur } from "./model/acces";
import { peutRecevoirUnLien } from "./model/connexion";
import { prochaineDemande, reserverLien } from "./model/limites";
import { estEmail, normaliserEmail } from "./model/valeurs";

/** Le temps laissé à Convex Auth pour créer le lien d'une demande acceptée. */
const TICKET_MS = 5 * 60_000;

/**
 * Demander un lien de connexion : la porte d'entrée de l'app, avant toute session
 * (d'où l'absence d'`exigerMembre`). La réponse est la même pour toute adresse,
 * invitée, membre ou inconnue : demande acceptée ou non selon le délai
 * (`model/limites.ts`, horloge du serveur), et l'attente avant la suivante.
 * L'e-mail part ensuite, en arrière-plan, seulement pour une adresse admise.
 */
export const demanderLien = mutation({
  args: { email: v.string() },
  returns: v.object({ acceptee: v.boolean(), attenteMs: v.number() }),
  handler: async (ctx, args) => {
    const email = normaliserEmail(args.email);
    if (!estEmail(email)) throw erreur("adresse_invalide");
    const maintenant = Date.now();
    const reservation = await reserverLien(ctx, email, maintenant);
    if (reservation.acceptee && (await peutRecevoirUnLien(ctx, email))) {
      const ticket = await ctx.db.insert("ticketsLien", { email, expire: maintenant + TICKET_MS });
      await ctx.scheduler.runAfter(0, api.auth.signIn, { provider: "postshiba", params: { email } });
      await ctx.scheduler.runAfter(TICKET_MS, internal.connexion.oublierTicket, { ticket });
    }
    return reservation;
  },
});

/** Une heure après la dernière demande, l'adresse est oubliée. */
export const oublierDemandes = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, { email }) => {
    const ligne = await ctx.db
      .query("demandesLien")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (ligne && prochaineDemande(ligne.envois, Date.now()).recents.length === 0) await ctx.db.delete("demandesLien", ligne._id);
    return null;
  },
});

/** Un ticket que Convex Auth n'a pas consommé (envoi en échec) ne sert plus. */
export const oublierTicket = internalMutation({
  args: { ticket: v.id("ticketsLien") },
  returns: v.null(),
  handler: async (ctx, { ticket }) => {
    if (await ctx.db.get("ticketsLien", ticket)) await ctx.db.delete("ticketsLien", ticket);
    return null;
  },
});
