import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";
import { origineValide, parOrigine } from "./conversationsCompte";

/**
 * Le contrat commun des lots 3 et 4 (`LOT-3` § 6, `LOT-4` § 5) : une demande du téléphone sur un ticket
 * a un identifiant stable, un état et son résultat. Accepter une demande ne dit rien de son exécution :
 * seul l'accusé de l'ordinateur (`terminer`) la confirme, et il pose en même temps l'état final du fil.
 * Un double appui ou une reprise réseau retombent sur la même demande : elle ne s'exécute qu'une fois.
 */

const vType = v.union(v.literal("priorite"), v.literal("etape"), v.literal("fermer"), v.literal("supprimer"), v.literal("rouvrir"), v.literal("confier"));
const vEtat = v.union(v.literal("en-attente"), v.literal("traitement"), v.literal("confirmee"), v.literal("echouee"));

const ID_DEMANDE = /^[\w-]{8,64}$/;
const FIL = /^klyra-fil-[0-9a-f]{8}$/;
const EN_ATTENTE_MAX = 200;
/** Une demande prise et restée sans accusé (app fermée pendant l'écriture) se reprend ; l'ordinateur reconnaît ce qu'il a déjà appliqué. */
const REPRISE_MS = 2 * 60 * 1000;
/** Les demandes finies restent lisibles le temps que le téléphone les montre. */
const CONSERVATION_MS = 7 * 24 * 60 * 60 * 1000;
const RESULTAT_MAX = 2000;
const TICKET_MAX = 2000;

function objet(json: string, max: number): Record<string, unknown> | null {
  if (json.length > max) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function ligneDemande(ctx: MutationCtx, membreId: Id<"membres">, demandeId: string) {
  return await ctx.db
    .query("demandesTicket")
    .withIndex("by_membre_and_demande", (q) => q.eq("membreId", membreId).eq("demandeId", demandeId))
    .unique();
}

/** Le rappel à confier tel que le compte le connaît : le téléphone ne dit que lequel. */
async function valeurConfier(ctx: MutationCtx, moi: Doc<"membres">, valeur: Record<string, unknown>): Promise<{ valeur: string; cleRappel: string }> {
  const { roleId, rappel } = valeur as { roleId?: unknown; rappel?: { source?: unknown; id?: unknown } };
  if (typeof roleId !== "string" || !origineValide(roleId) || !rappel || (rappel.source !== "compte" && rappel.source !== "local") || typeof rappel.id !== "string" || !rappel.id || rappel.id.length > 200) {
    throw erreur("demande_invalide");
  }
  const agent = await ctx.db
    .query("cartesAgents")
    .withIndex("by_membre_and_origine", (q) => q.eq("membreId", moi._id).eq("origine", roleId))
    .unique();
  if (!agent?.actif) throw erreur("introuvable");
  const cleRappel = `${rappel.source}:${rappel.id}`;
  if (rappel.source === "local") return { valeur: JSON.stringify({ roleId, rappel: { source: "local", id: rappel.id } }), cleRappel };
  const id = ctx.db.normalizeId("rappels", rappel.id);
  const doc = id ? await ctx.db.get("rappels", id) : null;
  if (!doc || (doc.assigneA !== moi._id && doc.creePar !== moi._id)) throw erreur("introuvable");
  if (doc.statut === "fait") throw erreur("demande_invalide");
  return {
    valeur: JSON.stringify({ roleId, rappel: { source: "compte", id: rappel.id, titre: doc.titre, notes: doc.notes, echeance: doc.jour, heure: doc.heure, priorite: doc.priorite } }),
    cleRappel,
  };
}

/** Déjà confié : une demande qui attend, ou un fil ouvert pour ce rappel. Pas de seconde attribution. */
async function dejaConfie(ctx: MutationCtx, membreId: Id<"membres">, cleRappel: string): Promise<boolean> {
  const demandes = await ctx.db
    .query("demandesTicket")
    .withIndex("by_membre_and_rappel", (q) => q.eq("membreId", membreId).eq("cleRappel", cleRappel))
    .take(20);
  if (demandes.some((d) => d.etat === "en-attente" || d.etat === "traitement")) return true;
  const lignes = await ctx.db
    .query("conversationsCompte")
    .withIndex("by_membre_and_misAJour", (q) => q.eq("membreId", membreId))
    .order("desc")
    .take(200);
  return lignes.some((c) => {
    const t = c.ticket ? (objet(c.ticket, TICKET_MAX) as { statut?: unknown; rappel?: { source?: unknown; id?: unknown } } | null) : null;
    return t?.statut === "ouvert" && `${String(t.rappel?.source)}:${String(t.rappel?.id)}` === cleRappel;
  });
}

/**
 * Le téléphone demande un geste. Le même `demandeId` rend la demande déjà acceptée, sans en créer une autre.
 * Les droits se vérifient ici : le fil ou le rappel doivent être ceux du compte.
 */
export const demander = mutation({
  args: { demandeId: v.string(), conversationOrigine: v.string(), type: vType, valeur: v.string(), revision: v.number() },
  returns: v.object({ etat: vEtat }),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    if (!ID_DEMANDE.test(args.demandeId) || !origineValide(args.conversationOrigine)) throw erreur("demande_invalide");
    const existante = await ligneDemande(ctx, moi._id, args.demandeId);
    if (existante) return { etat: existante.etat };
    const valeur = objet(args.valeur, 500);
    if (!valeur) throw erreur("demande_invalide");
    const enAttente = await ctx.db
      .query("demandesTicket")
      .withIndex("by_membre_and_etat_and_creeLe", (q) => q.eq("membreId", moi._id).eq("etat", "en-attente"))
      .take(EN_ATTENTE_MAX);
    if (enAttente.length >= EN_ATTENTE_MAX) throw erreur("lot_trop_grand");

    let valeurGardee = JSON.stringify(valeur);
    let cleRappel: string | null = null;
    if (args.type === "confier") {
      if (!FIL.test(args.conversationOrigine)) throw erreur("demande_invalide");
      const confier = await valeurConfier(ctx, moi, valeur);
      if (await dejaConfie(ctx, moi._id, confier.cleRappel)) throw erreur("deja_confie");
      valeurGardee = confier.valeur;
      cleRappel = confier.cleRappel;
    } else {
      const ligne = await parOrigine(ctx, moi._id, args.conversationOrigine);
      if (!ligne?.ticket) throw erreur("introuvable");
      if (args.type === "priorite" && ![0, 1, 2, 3].includes(valeur.priorite as number)) throw erreur("demande_invalide");
      if (args.type === "etape" && valeur.etape !== "a-faire") throw erreur("demande_invalide");
    }
    await ctx.db.insert("demandesTicket", {
      membreId: moi._id,
      demandeId: args.demandeId,
      conversationOrigine: args.conversationOrigine,
      type: args.type,
      valeur: valeurGardee,
      cleRappel,
      etat: "en-attente",
      revision: args.revision,
      resultat: null,
      creeLe: Date.now(),
      prisLe: null,
      finiLe: null,
    });
    return { etat: "en-attente" as const };
  },
});

/** Ce que le téléphone suit : les demandes récentes, avec leur état et leur résultat. */
export const mesDemandes = query({
  args: {},
  returns: v.array(
    v.object({
      demandeId: v.string(),
      conversationOrigine: v.string(),
      type: vType,
      valeur: v.string(),
      etat: vEtat,
      resultat: v.union(v.string(), v.null()),
      creeLe: v.number(),
      finiLe: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const lignes = await ctx.db
      .query("demandesTicket")
      .withIndex("by_membre_and_creeLe", (q) => q.eq("membreId", moi._id))
      .order("desc")
      .take(100);
    return lignes.map((d) => ({ demandeId: d.demandeId, conversationOrigine: d.conversationOrigine, type: d.type, valeur: d.valeur, etat: d.etat, resultat: d.resultat, creeLe: d.creeLe, finiLe: d.finiLe }));
  },
});

/** L'ordinateur : les demandes qui l'attendent, dans l'ordre, et celles prises sans accusé depuis un moment. */
export const aTraiter = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("demandesTicket"), creeLe: v.number(), prisLe: v.union(v.number(), v.null()) })),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const attente = await ctx.db
      .query("demandesTicket")
      .withIndex("by_membre_and_etat_and_creeLe", (q) => q.eq("membreId", moi._id).eq("etat", "en-attente"))
      .take(EN_ATTENTE_MAX);
    const prises = await ctx.db
      .query("demandesTicket")
      .withIndex("by_membre_and_etat_and_creeLe", (q) => q.eq("membreId", moi._id).eq("etat", "traitement"))
      .take(EN_ATTENTE_MAX);
    return [...attente, ...prises].sort((a, b) => a.creeLe - b.creeLe).map((d) => ({ _id: d._id, creeLe: d.creeLe, prisLe: d.prisLe }));
  },
});

/** L'ordinateur prend une demande : une seule exécution à la fois. Prise depuis trop longtemps sans accusé, elle se reprend. */
export const prendre = mutation({
  args: { id: v.id("demandesTicket") },
  returns: v.union(
    v.object({ demandeId: v.string(), conversationOrigine: v.string(), type: vType, valeur: v.string(), revision: v.number() }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const moi = await exigerMembre(ctx);
    const d = await ctx.db.get("demandesTicket", id);
    if (!d || d.membreId !== moi._id) return null;
    const maintenant = Date.now();
    const reprise = d.etat === "traitement" && maintenant - (d.prisLe ?? 0) > REPRISE_MS;
    if (d.etat !== "en-attente" && !reprise) return null;
    await ctx.db.patch("demandesTicket", id, { etat: "traitement", prisLe: maintenant });
    return { demandeId: d.demandeId, conversationOrigine: d.conversationOrigine, type: d.type, valeur: d.valeur, revision: d.revision };
  },
});

/**
 * L'accusé de l'ordinateur : confirmée (avec l'état final du fil, posé en même temps dans la copie) ou
 * échouée (conflit, retrait, erreur). Une demande finie le reste : un second accusé ne change rien.
 */
export const terminer = mutation({
  args: { id: v.id("demandesTicket"), etat: v.union(v.literal("confirmee"), v.literal("echouee")), resultat: v.string(), ticket: v.optional(v.union(v.string(), v.null())), retirer: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const d = await ctx.db.get("demandesTicket", args.id);
    if (!d || d.membreId !== moi._id) throw erreur("introuvable");
    if (d.etat === "confirmee" || d.etat === "echouee") return null;
    if (!objet(args.resultat, RESULTAT_MAX) || (args.ticket && !objet(args.ticket, TICKET_MAX))) throw erreur("demande_invalide");
    const maintenant = Date.now();
    await ctx.db.patch("demandesTicket", args.id, { etat: args.etat, resultat: args.resultat, prisLe: null, finiLe: maintenant });
    if (args.etat === "confirmee") {
      const ligne = await parOrigine(ctx, moi._id, d.conversationOrigine);
      if (ligne && args.retirer) await ctx.db.delete("conversationsCompte", ligne._id);
      else if (ligne && args.ticket) await ctx.db.patch("conversationsCompte", ligne._id, { ticket: args.ticket, ticketLu: maintenant });
    }
    /* Le compte ne garde pas les demandes finies indéfiniment. */
    const anciennes = await ctx.db
      .query("demandesTicket")
      .withIndex("by_membre_and_creeLe", (q) => q.eq("membreId", moi._id).lt("creeLe", maintenant - CONSERVATION_MS))
      .take(50);
    for (const a of anciennes) {
      if (a.etat === "confirmee" || a.etat === "echouee") await ctx.db.delete("demandesTicket", a._id);
    }
    return null;
  },
});
