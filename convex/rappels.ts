import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { envoyerCourriel } from "./courriels";
import { erreur, exigerMembre } from "./model/acces";
import { EXPEDITEUR_RAPPELS, courrielRappel } from "./model/contenus";
import {
  LOT_MAX,
  PAGE_MAX,
  echeanceValide,
  libelleEcheance,
  listeValide,
  notesValides,
  origineValide,
  titreValide,
  type Echeance,
  type SaisieEcheance,
} from "./model/rappels";
import { presence } from "./presence";

const vPriorite = v.union(v.literal(0), v.literal(1), v.literal(2), v.literal(3));
const vStatut = v.union(v.literal("a_faire"), v.literal("fait"), v.literal("en_retard"));
const vJour = v.union(v.string(), v.null());
const vType = v.union(v.literal("assigne"), v.literal("echeance"), v.literal("fait"), v.literal("modifie"));

const vRappel = v.object({
  _id: v.id("rappels"),
  titre: v.string(),
  notes: v.string(),
  jour: vJour,
  heure: vJour,
  fin: vJour,
  jourEntier: v.boolean(),
  echeance: v.union(v.number(), v.null()),
  creePar: v.id("membres"),
  assigneA: v.id("membres"),
  statut: vStatut,
  faitLe: v.union(v.number(), v.null()),
  priorite: vPriorite,
  origineLocale: vJour,
  liste: vJour,
});

const vSaisie = {
  titre: v.string(),
  notes: v.string(),
  jour: vJour,
  heure: vJour,
  fin: vJour,
  echeance: v.union(v.number(), v.null()),
  priorite: vPriorite,
};

type Statut = Doc<"rappels">["statut"];
type Priorite = Doc<"rappels">["priorite"];

function vue(rappel: Doc<"rappels">) {
  return {
    _id: rappel._id,
    titre: rappel.titre,
    notes: rappel.notes,
    jour: rappel.jour,
    heure: rappel.heure,
    fin: rappel.fin,
    jourEntier: rappel.jourEntier,
    echeance: rappel.echeance,
    creePar: rappel.creePar,
    assigneA: rappel.assigneA,
    statut: rappel.statut,
    faitLe: rappel.faitLe,
    priorite: rappel.priorite,
    origineLocale: rappel.origineLocale,
    liste: rappel.liste,
  };
}

function parEcheance(a: { echeance: number | null; _id: string }, b: { echeance: number | null; _id: string }) {
  if (a.echeance === b.echeance) return a._id < b._id ? -1 : 1;
  if (a.echeance === null) return 1;
  if (b.echeance === null) return -1;
  return a.echeance - b.echeance;
}

function exigerEcheance(saisie: SaisieEcheance): Echeance {
  const echeance = echeanceValide(saisie);
  if (echeance === null) throw erreur("rappel_invalide");
  return echeance;
}

async function membreActif(ctx: MutationCtx, membreId: Id<"membres">): Promise<Doc<"membres">> {
  const membre = await ctx.db.get("membres", membreId);
  if (!membre?.actif) throw erreur("membre_inconnu");
  return membre;
}

async function appOuverte(ctx: MutationCtx, membreId: Id<"membres">): Promise<boolean> {
  const salles = await presence.listUser(ctx, membreId, true);
  return salles.some((salle) => salle.online);
}

async function notifier(ctx: MutationCtx, destinataire: Id<"membres">, type: Doc<"notifications">["type"], rappelId: Id<"rappels">) {
  await ctx.db.insert("notifications", { destinataire, type, rappelId, lue: false });
}

async function prevenirAssignation(ctx: MutationCtx, assignateur: Doc<"membres">, destinataire: Doc<"membres">, rappel: Echeance & { titre: string }, rappelId: Id<"rappels">) {
  if (destinataire._id === assignateur._id) return;
  await notifier(ctx, destinataire._id, "assigne", rappelId);
  if (await appOuverte(ctx, destinataire._id)) return;
  await envoyerCourriel(
    ctx,
    EXPEDITEUR_RAPPELS,
    destinataire.email,
    courrielRappel({ titre: rappel.titre, echeance: libelleEcheance(rappel.jour, rappel.heure), par: assignateur.nom }),
  );
}

/** Planifie le passage en retard, ou le pose tout de suite si l'échéance est déjà passée. */
async function reglerPlan(
  ctx: MutationCtx,
  rappelId: Id<"rappels">,
  ancienne: Id<"_scheduled_functions"> | null,
  echeance: number | null,
  faite: boolean,
  maintenant: number,
): Promise<{ statut: Statut; planificationId: Id<"_scheduled_functions"> | null }> {
  if (ancienne) await ctx.scheduler.cancel(ancienne);
  if (faite) return { statut: "fait", planificationId: null };
  if (echeance !== null && echeance <= maintenant) return { statut: "en_retard", planificationId: null };
  if (echeance === null) return { statut: "a_faire", planificationId: null };
  const planificationId = await ctx.scheduler.runAt(echeance, internal.rappels.passerEnRetard, { rappelId });
  return { statut: "a_faire", planificationId };
}

interface Nouveau {
  titre: string;
  notes: string;
  echeance: Echeance;
  priorite: Priorite;
  assigneA: Id<"membres">;
  liste: string | null;
  origineLocale: string | null;
  faite: boolean;
}

async function creerRappel(ctx: MutationCtx, moi: Doc<"membres">, nouveau: Nouveau, destinataire: Doc<"membres">): Promise<Id<"rappels">> {
  const maintenant = Date.now();
  const id = await ctx.db.insert("rappels", {
    titre: nouveau.titre,
    notes: nouveau.notes,
    ...nouveau.echeance,
    creePar: moi._id,
    assigneA: nouveau.assigneA,
    statut: "a_faire",
    faitLe: null,
    priorite: nouveau.priorite,
    planificationId: null,
    origineLocale: nouveau.origineLocale,
    liste: nouveau.liste,
  });
  const plan = await reglerPlan(ctx, id, null, nouveau.echeance.echeance, nouveau.faite, maintenant);
  await ctx.db.patch("rappels", id, { statut: plan.statut, planificationId: plan.planificationId, faitLe: nouveau.faite ? maintenant : null });
  await prevenirAssignation(ctx, moi, destinataire, { ...nouveau.echeance, titre: nouveau.titre }, id);
  return id;
}

/** Les rappels qui me sont assignés, y compris ceux que je me suis assignés. */
export const mes = query({
  args: {},
  returns: v.array(vRappel),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const liste = await ctx.db
      .query("rappels")
      .withIndex("by_assigneA_and_statut_and_echeance", (q) => q.eq("assigneA", moi._id))
      .take(PAGE_MAX);
    return liste.map(vue).sort(parEcheance);
  },
});

/** Ceux que j'ai créés pour quelqu'un d'autre. */
export const assignes = query({
  args: {},
  returns: v.array(vRappel),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const liste = await ctx.db
      .query("rappels")
      .withIndex("by_creePar_and_echeance", (q) => q.eq("creePar", moi._id))
      .take(PAGE_MAX);
    return liste
      .filter((rappel) => rappel.assigneA !== moi._id)
      .map(vue)
      .sort(parEcheance);
  },
});

const vNotification = v.object({
  _id: v.id("notifications"),
  type: vType,
  rappelId: v.id("rappels"),
  lue: v.boolean(),
  titre: v.string(),
  jour: vJour,
  heure: vJour,
});

/** Le compteur et la liste du Planning. Les rappels supprimés n'y figurent plus. */
export const notifications = query({
  args: {},
  returns: v.object({ nonLues: v.number(), liste: v.array(vNotification) }),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const nonLues = await ctx.db
      .query("notifications")
      .withIndex("by_destinataire_and_lue", (q) => q.eq("destinataire", moi._id).eq("lue", false))
      .take(100);
    const lues = await ctx.db
      .query("notifications")
      .withIndex("by_destinataire_and_lue", (q) => q.eq("destinataire", moi._id).eq("lue", true))
      .order("desc")
      .take(30);
    const liste = [];
    for (const notification of [...nonLues].reverse().concat(lues).slice(0, 30)) {
      const rappel = await ctx.db.get("rappels", notification.rappelId);
      if (!rappel) continue;
      liste.push({
        _id: notification._id,
        type: notification.type,
        rappelId: notification.rappelId,
        lue: notification.lue,
        titre: rappel.titre,
        jour: rappel.jour,
        heure: rappel.heure,
      });
    }
    return { nonLues: nonLues.length, liste };
  },
});

export const creer = mutation({
  args: { ...vSaisie, assigneA: v.id("membres"), liste: vJour },
  returns: v.id("rappels"),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const titre = titreValide(args.titre);
    const notes = notesValides(args.notes);
    const liste = listeValide(args.liste);
    if (titre === null || notes === null || liste === false) throw erreur("rappel_invalide");
    const destinataire = await membreActif(ctx, args.assigneA);
    const pourSoi = destinataire._id === moi._id;
    return await creerRappel(
      ctx,
      moi,
      {
        titre,
        notes,
        echeance: exigerEcheance(args),
        priorite: args.priorite,
        assigneA: destinataire._id,
        liste: pourSoi ? liste : null,
        origineLocale: null,
        faite: false,
      },
      destinataire,
    );
  },
});

export const modifier = mutation({
  args: {
    rappelId: v.id("rappels"),
    titre: v.optional(v.string()),
    notes: v.optional(v.string()),
    jour: v.optional(vJour),
    heure: v.optional(vJour),
    fin: v.optional(vJour),
    echeance: v.optional(v.union(v.number(), v.null())),
    priorite: v.optional(vPriorite),
    assigneA: v.optional(v.id("membres")),
    liste: v.optional(vJour),
    fait: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const moi = await exigerMembre(ctx);
    const rappel = await ctx.db.get("rappels", args.rappelId);
    if (rappel === null || (rappel.creePar !== moi._id && rappel.assigneA !== moi._id)) throw erreur("introuvable");
    const createur = rappel.creePar === moi._id;
    const reserve =
      args.titre !== undefined ||
      args.priorite !== undefined ||
      args.assigneA !== undefined ||
      args.jour !== undefined ||
      args.heure !== undefined ||
      args.fin !== undefined ||
      args.echeance !== undefined;
    if (reserve && !createur) throw erreur("reserve_au_createur");

    const patch: Partial<Doc<"rappels">> = {};
    let destinataire = rappel.assigneA;
    let nouvelAssigne: Doc<"membres"> | null = null;
    let prevenirAutre: Doc<"notifications">["type"] | null = null;

    if (args.titre !== undefined) {
      const titre = titreValide(args.titre);
      if (titre === null) throw erreur("rappel_invalide");
      if (titre !== rappel.titre) {
        patch.titre = titre;
        prevenirAutre = "modifie";
      }
    }
    if (args.notes !== undefined) {
      const notes = notesValides(args.notes);
      if (notes === null) throw erreur("rappel_invalide");
      if (notes !== rappel.notes) {
        patch.notes = notes;
        prevenirAutre = prevenirAutre ?? "modifie";
      }
    }
    if (args.priorite !== undefined && args.priorite !== rappel.priorite) {
      patch.priorite = args.priorite;
      prevenirAutre = "modifie";
    }
    if (args.assigneA !== undefined && args.assigneA !== rappel.assigneA) {
      const membre = await membreActif(ctx, args.assigneA);
      patch.assigneA = membre._id;
      patch.liste = null;
      destinataire = membre._id;
      nouvelAssigne = membre;
      prevenirAutre = null;
    }
    if (args.liste !== undefined) {
      const liste = listeValide(args.liste);
      if (liste === false) throw erreur("rappel_invalide");
      if (moi._id !== destinataire) throw erreur("reserve_au_createur");
      patch.liste = liste;
    }

    const dateDemandee = args.jour !== undefined || args.heure !== undefined || args.fin !== undefined || args.echeance !== undefined;
    let echeance = rappel.echeance;
    if (dateDemandee) {
      const saisie = exigerEcheance({
        jour: args.jour !== undefined ? args.jour : rappel.jour,
        heure: args.heure !== undefined ? args.heure : rappel.heure,
        fin: args.fin !== undefined ? args.fin : rappel.fin,
        echeance: args.echeance !== undefined ? args.echeance : rappel.echeance,
      });
      patch.jour = saisie.jour;
      patch.heure = saisie.heure;
      patch.fin = saisie.fin;
      patch.jourEntier = saisie.jourEntier;
      patch.echeance = saisie.echeance;
      echeance = saisie.echeance;
      if (saisie.echeance !== rappel.echeance || saisie.jour !== rappel.jour || saisie.heure !== rappel.heure) prevenirAutre = prevenirAutre ?? "modifie";
    }

    const faite = args.fait !== undefined ? args.fait : rappel.statut === "fait";
    const faitChange = args.fait !== undefined && args.fait !== (rappel.statut === "fait");
    if (dateDemandee || faitChange) {
      const plan = await reglerPlan(ctx, rappel._id, rappel.planificationId, echeance, faite, Date.now());
      patch.statut = plan.statut;
      patch.planificationId = plan.planificationId;
      patch.faitLe = faite ? (rappel.faitLe ?? Date.now()) : null;
      if (faitChange) prevenirAutre = faite ? "fait" : "modifie";
    }

    if (Object.keys(patch).length > 0) await ctx.db.patch("rappels", rappel._id, patch);
    if (nouvelAssigne) {
      await prevenirAssignation(ctx, moi, nouvelAssigne, { jour: patch.jour ?? rappel.jour, heure: patch.heure ?? rappel.heure, fin: patch.fin ?? rappel.fin, echeance, jourEntier: patch.jourEntier ?? rappel.jourEntier, titre: patch.titre ?? rappel.titre }, rappel._id);
    } else if (prevenirAutre) {
      const autre = moi._id === rappel.creePar ? destinataire : rappel.creePar;
      if (autre !== moi._id) await notifier(ctx, autre, prevenirAutre, rappel._id);
    }
    return null;
  },
});

export const supprimer = mutation({
  args: { rappelId: v.id("rappels") },
  returns: v.null(),
  handler: async (ctx, { rappelId }) => {
    const moi = await exigerMembre(ctx);
    const rappel = await ctx.db.get("rappels", rappelId);
    if (rappel === null || rappel.creePar !== moi._id) throw erreur(rappel === null || rappel.assigneA !== moi._id ? "introuvable" : "reserve_au_createur");
    if (rappel.planificationId) await ctx.scheduler.cancel(rappel.planificationId);
    const notificationsLiees = await ctx.db
      .query("notifications")
      .withIndex("by_rappelId", (q) => q.eq("rappelId", rappelId))
      .take(200);
    for (const notification of notificationsLiees) await ctx.db.delete("notifications", notification._id);
    await ctx.db.delete("rappels", rappelId);
    return null;
  },
});

export const marquerLues = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const moi = await exigerMembre(ctx);
    const liste = await ctx.db
      .query("notifications")
      .withIndex("by_destinataire_and_lue", (q) => q.eq("destinataire", moi._id).eq("lue", false))
      .take(100);
    for (const notification of liste) await ctx.db.patch("notifications", notification._id, { lue: true });
    return null;
  },
});

const vEntree = v.object({ ...vSaisie, origineLocale: v.string(), faite: v.boolean(), liste: vJour });

/** Reprend les rappels de l'ordinateur, par lots de 100. La même origine n'est pas reprise deux fois. */
export const importer = mutation({
  args: { lot: v.array(vEntree) },
  returns: v.object({ ajoutes: v.number(), deja: v.number() }),
  handler: async (ctx, { lot }) => {
    const moi = await exigerMembre(ctx);
    if (lot.length > LOT_MAX) throw erreur("lot_trop_grand");
    let ajoutes = 0;
    let deja = 0;
    for (const entree of lot) {
      const origine = origineValide(entree.origineLocale);
      const titre = titreValide(entree.titre);
      const notes = notesValides(entree.notes);
      const liste = listeValide(entree.liste);
      if (origine === null || titre === null || notes === null || liste === false) throw erreur("rappel_invalide");
      const existant = await ctx.db
        .query("rappels")
        .withIndex("by_assigneA_and_origineLocale", (q) => q.eq("assigneA", moi._id).eq("origineLocale", origine))
        .unique();
      if (existant) {
        deja += 1;
        continue;
      }
      await creerRappel(
        ctx,
        moi,
        { titre, notes, echeance: exigerEcheance(entree), priorite: entree.priorite, assigneA: moi._id, liste, origineLocale: origine, faite: entree.faite },
        moi,
      );
      ajoutes += 1;
    }
    return { ajoutes, deja };
  },
});

/** Passe un rappel en retard à son échéance. Aucun e-mail : l'app le montrera à l'ouverture. */
export const passerEnRetard = internalMutation({
  args: { rappelId: v.id("rappels") },
  returns: v.null(),
  handler: async (ctx, { rappelId }) => {
    const rappel = await ctx.db.get("rappels", rappelId);
    if (rappel === null || rappel.statut === "fait" || rappel.echeance === null || Date.now() < rappel.echeance) return null;
    if (rappel.statut === "en_retard") return null;
    await ctx.db.patch("rappels", rappelId, { statut: "en_retard", planificationId: null });
    await notifier(ctx, rappel.assigneA, "echeance", rappelId);
    return null;
  },
});
