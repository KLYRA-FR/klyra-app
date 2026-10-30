import { makeFunctionReference } from "convex/server";
import type { MutationCtx } from "../_generated/server";

/**
 * Le délai entre deux liens de connexion pour une même adresse, appliqué par le
 * serveur avec son horloge. Pas plus d'un lien par minute, pas plus de cinq par
 * heure glissante : un lien vaut 15 minutes, et PostShiba envoie au plus 90
 * e-mails par heure pour toute l'équipe (`courriels.ts`) ; une seule adresse ne
 * doit pas pouvoir les épuiser. La clé est l'adresse normalisée : aucune autre
 * adresse n'est freinée.
 */
export const DELAI_ENTRE_LIENS_MS = 60_000;
export const LIENS_PAR_HEURE = 5;
export const HEURE_MS = 3_600_000;

/* Référence par nom : `internal` créerait une boucle de types avec `_generated/api` (ce fichier sert à `auth.ts`). */
const oublierDemandes = makeFunctionReference<"mutation", { email: string }, null>("connexion:oublierDemandes");

/** Les demandes de la dernière heure, et l'instant où la suivante sera acceptée. */
export function prochaineDemande(envois: number[], maintenant: number): { recents: number[]; prochaine: number } {
  const recents = envois.filter((t) => t > maintenant - HEURE_MS).sort((a, b) => a - b);
  if (recents.length === 0) return { recents, prochaine: maintenant };
  const apresDelai = recents[recents.length - 1] + DELAI_ENTRE_LIENS_MS;
  const apresQuota = recents.length >= LIENS_PAR_HEURE ? recents[recents.length - LIENS_PAR_HEURE] + HEURE_MS : 0;
  return { recents, prochaine: Math.max(apresDelai, apresQuota) };
}

/** Ce que la personne apprend : sa demande est acceptée ou non, et dans combien de temps elle pourra recommencer. */
export interface Reservation {
  acceptee: boolean;
  attenteMs: number;
}

/**
 * Réserve un envoi pour cette adresse, si le délai le permet. Dans une mutation :
 * deux demandes simultanées se suivent, la seconde voit la première.
 */
export async function reserverLien(ctx: MutationCtx, email: string, maintenant: number): Promise<Reservation> {
  const ligne = await ctx.db
    .query("demandesLien")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  const { recents, prochaine } = prochaineDemande(ligne?.envois ?? [], maintenant);
  if (maintenant < prochaine) return { acceptee: false, attenteMs: prochaine - maintenant };

  const envois = [...recents, maintenant].slice(-LIENS_PAR_HEURE);
  if (ligne) await ctx.db.patch("demandesLien", ligne._id, { envois });
  else await ctx.db.insert("demandesLien", { email, envois });
  await ctx.scheduler.runAfter(HEURE_MS, oublierDemandes, { email });
  return { acceptee: true, attenteMs: prochaineDemande(envois, maintenant).prochaine - maintenant };
}
