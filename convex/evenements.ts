import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { erreur, exigerMembre } from "./model/acces";
import {
  CLE_WEEKLY,
  PAGE_MAX,
  WEEKLY,
  fenetreValide,
  joursDans,
  saisieValide,
  type SaisieEvenement,
} from "./model/evenements";

const vHeure = v.union(v.string(), v.null());
const vRepetition = v.union(v.literal("aucune"), v.literal("semaine"));

const vOccurrence = v.object({
  id: v.string(),
  evenementId: v.id("evenements"),
  titre: v.string(),
  notes: v.string(),
  jour: v.string(),
  debut: vHeure,
  fin: vHeure,
  jourEntier: v.boolean(),
  repetition: vRepetition,
  touteEquipe: v.boolean(),
  /** Jour enregistré : le premier jour d'une répétition, pas celui de l'occurrence. */
  origine: v.string(),
  organisateur: v.id("membres"),
  couleur: v.string(),
  participants: v.array(v.id("membres")),
  modifiable: v.boolean(),
});

const vSaisie = {
  titre: v.string(),
  notes: v.string(),
  jour: v.string(),
  debut: vHeure,
  fin: vHeure,
  jourEntier: v.boolean(),
  repetition: vRepetition,
  touteEquipe: v.boolean(),
  participants: v.array(v.id("membres")),
  debutMs: v.number(),
};

type Contexte = QueryCtx | MutationCtx;

async function membresActifs(ctx: Contexte): Promise<Doc<"membres">[]> {
  const admins = await ctx.db.query("membres").withIndex("by_actif_and_role", (q) => q.eq("actif", true).eq("role", "admin")).take(100);
  const membres = await ctx.db.query("membres").withIndex("by_actif_and_role", (q) => q.eq("actif", true).eq("role", "membre")).take(100);
  return [...admins, ...membres];
}

async function destinataires(ctx: MutationCtx, moi: Id<"membres">, touteEquipe: boolean, demandes: Id<"membres">[]): Promise<Id<"membres">[]> {
  if (touteEquipe) return (await membresActifs(ctx)).map((membre) => membre._id);
  const ids = new Set<Id<"membres">>([moi]);
  for (const id of demandes) {
    const membre = await ctx.db.get("membres", id);
    if (!membre?.actif) throw erreur("membre_inconnu");
    ids.add(membre._id);
  }
  return [...ids];
}

async function poserParticipants(ctx: MutationCtx, evenementId: Id<"evenements">, debut: number, ids: Id<"membres">[]) {
  const anciens = await ctx.db.query("participations").withIndex("by_evenement", (q) => q.eq("evenementId", evenementId)).take(200);
  for (const participation of anciens) await ctx.db.delete("participations", participation._id);
  for (const participant of ids) await ctx.db.insert("participations", { evenementId, participant, debut });
}

function exigerSaisie(args: SaisieEvenement): SaisieEvenement {
  const saisie = saisieValide(args);
  if (saisie === null) throw erreur("evenement_invalide");
  return saisie;
}

/** Les occurrences que je vois entre deux jours (fin exclue). Jamais les créneaux des autres. */
export const entre = query({
  args: { debut: v.string(), fin: v.string(), finMs: v.number() },
  returns: v.array(vOccurrence),
  handler: async (ctx, { debut, fin, finMs }) => {
    const moi = await exigerMembre(ctx);
    if (!fenetreValide(debut, fin) || !Number.isFinite(finMs)) throw erreur("evenement_invalide");
    const participations = await ctx.db
      .query("participations")
      .withIndex("by_participant_and_debut", (q) => q.eq("participant", moi._id).lt("debut", finMs))
      .take(PAGE_MAX);
    const vus = new Set<string>();
    const liste = [];
    for (const participation of participations) {
      const evenement = await ctx.db.get("evenements", participation.evenementId);
      if (!evenement || vus.has(evenement._id)) continue;
      vus.add(evenement._id);
      const organisateur = await ctx.db.get("membres", evenement.organisateur);
      const participants = (
        await ctx.db.query("participations").withIndex("by_evenement", (q) => q.eq("evenementId", evenement._id)).take(200)
      ).map((p) => p.participant);
      for (const jour of joursDans(evenement.jour, evenement.repetition, debut, fin)) {
        liste.push({
          id: evenement.repetition === "semaine" ? `${evenement._id}-${jour}` : evenement._id,
          evenementId: evenement._id,
          titre: evenement.titre,
          notes: evenement.notes,
          jour,
          debut: evenement.debut,
          fin: evenement.fin,
          jourEntier: evenement.jourEntier,
          repetition: evenement.repetition,
          touteEquipe: evenement.touteEquipe,
          origine: evenement.jour,
          organisateur: evenement.organisateur,
          couleur: organisateur?.couleur ?? "bleu-k1",
          participants,
          modifiable: evenement.organisateur === moi._id && evenement.cle === null,
        });
      }
    }
    return liste.sort((a, b) => (a.jour + (a.debut ?? "")).localeCompare(b.jour + (b.debut ?? "")));
  },
});

export const creer = mutation({
  args: vSaisie,
  returns: v.id("evenements"),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const saisie = exigerSaisie(args);
    const ids = await destinataires(ctx, moi._id, args.touteEquipe, args.participants);
    const id = await ctx.db.insert("evenements", { ...saisie, organisateur: moi._id, touteEquipe: args.touteEquipe, cle: null });
    await poserParticipants(ctx, id, saisie.debutMs, ids);
    return id;
  },
});

export const modifier = mutation({
  args: { evenementId: v.id("evenements"), ...vSaisie },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const evenement = await ctx.db.get("evenements", args.evenementId);
    const participation = evenement
      ? await ctx.db.query("participations").withIndex("by_evenement", (q) => q.eq("evenementId", args.evenementId)).take(200)
      : [];
    const voit = participation.some((p) => p.participant === moi._id);
    if (!evenement || !voit) throw erreur("introuvable");
    if (evenement.organisateur !== moi._id || evenement.cle !== null) throw erreur("reserve_a_lorganisateur");
    const saisie = exigerSaisie(args);
    const ids = await destinataires(ctx, moi._id, args.touteEquipe, args.participants);
    await ctx.db.patch("evenements", evenement._id, { ...saisie, touteEquipe: args.touteEquipe });
    await poserParticipants(ctx, evenement._id, saisie.debutMs, ids);
    return null;
  },
});

export const supprimer = mutation({
  args: { evenementId: v.id("evenements") },
  returns: v.null(),
  handler: async (ctx, { evenementId }) => {
    const moi = await exigerMembre(ctx);
    const evenement = await ctx.db.get("evenements", evenementId);
    if (!evenement || evenement.organisateur !== moi._id) {
      const voit = evenement
        ? await ctx.db.query("participations").withIndex("by_evenement", (q) => q.eq("evenementId", evenementId)).take(200)
        : [];
      throw erreur(voit.some((p) => p.participant === moi._id) ? "reserve_a_lorganisateur" : "introuvable");
    }
    if (evenement.cle !== null) throw erreur("reserve_a_lorganisateur");
    const lies = await ctx.db.query("participations").withIndex("by_evenement", (q) => q.eq("evenementId", evenementId)).take(200);
    for (const participation of lies) await ctx.db.delete("participations", participation._id);
    await ctx.db.delete("evenements", evenementId);
    return null;
  },
});

/** Le Weekly, une seule fois, visible par toute l'équipe. Le rappel est sans effet. */
export const assurerWeekly = mutation({
  args: {},
  returns: v.id("evenements"),
  handler: async (ctx) => {
    await exigerMembre(ctx);
    const existant = await ctx.db.query("evenements").withIndex("by_cle", (q) => q.eq("cle", CLE_WEEKLY)).unique();
    const actifs = await membresActifs(ctx);
    if (existant) {
      await poserParticipants(ctx, existant._id, existant.debutMs, actifs.map((membre) => membre._id));
      return existant._id;
    }
    const organisateur = actifs.find((membre) => membre.role === "admin") ?? actifs[0];
    if (!organisateur) throw erreur("evenement_invalide");
    const id = await ctx.db.insert("evenements", {
      titre: WEEKLY.titre,
      notes: WEEKLY.notes,
      jour: WEEKLY.jour,
      debut: WEEKLY.debut,
      fin: WEEKLY.fin,
      jourEntier: false,
      organisateur: organisateur._id,
      touteEquipe: true,
      repetition: "semaine",
      debutMs: WEEKLY.debutMs,
      cle: CLE_WEEKLY,
    });
    await poserParticipants(ctx, id, WEEKLY.debutMs, actifs.map((membre) => membre._id));
    return id;
  },
});
