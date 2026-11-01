import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vRole, vStatutInvitation } from "./model/valeurs";

/**
 * Données partagées de l'équipe, hébergées par Convex (cf. `docs/CONVEX-PLAN.md`).
 * Les conversations, les fichiers et les clés restent sur l'ordinateur.
 */
export default defineSchema({
  ...authTables,

  /** Les adresses qui peuvent se connecter avant d'être membres. Adresse en minuscules. */
  invitations: defineTable({
    email: v.string(),
    nom: v.string(),
    role: vRole,
    /** null : l'équipe de départ, créée par `equipe:initialiser`. */
    inviteePar: v.union(v.id("membres"), v.null()),
    statut: vStatutInvitation,
  })
    .index("by_email_and_statut", ["email", "statut"])
    .index("by_statut", ["statut"]),

  /** Une personne de l'équipe : son rôle et son profil. Une seule ligne par compte. */
  membres: defineTable({
    userId: v.id("users"),
    email: v.string(),
    nom: v.string(),
    intitule: v.string(),
    /** Une des teintes de `ROLE_TEINTES`. */
    couleur: v.string(),
    role: vRole,
    /** false : retiré de l'équipe, ne peut plus se connecter. */
    actif: v.boolean(),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"])
    .index("by_actif_and_role", ["actif", "role"]),

  /**
   * Les liens de connexion demandés par adresse sur la dernière heure (cf. `model/limites.ts`),
   * pour toute adresse saisie, invitée ou non : la réponse ne dit pas qui est dans l'équipe.
   * Une ligne est oubliée une heure après sa dernière demande.
   */
  demandesLien: defineTable({
    email: v.string(),
    /** Les instants (ms) des demandes acceptées, du plus ancien au plus récent ; cinq au plus. */
    envois: v.array(v.number()),
  }).index("by_email", ["email"]),

  /** Une demande acceptée par `connexion:demanderLien` : Convex Auth la consomme en créant le lien. */
  ticketsLien: defineTable({
    email: v.string(),
    expire: v.number(),
  }).index("by_email", ["email"]),

  /**
   * La Bibliothèque KLYRA : les définitions d'agents publiées volontairement par un membre
   * (cf. `bibliotheque.ts`). Seulement la fiche : jamais la mémoire, l'historique, les
   * conversations, les clés ni les chemins de l'auteur. Seul l'auteur la met à jour ou la retire ;
   * chacun l'ajoute chez soi sous forme de copie locale (`~/.claude/agents/`).
   */
  definitionsAgents: defineTable({
    auteurId: v.id("membres"),
    /** L'identifiant proposé pour la fiche locale (`name`), fixe d'une version à l'autre. */
    slug: v.string(),
    nom: v.string(),
    /** Rôle court affiché sur la carte. */
    role: v.string(),
    description: v.string(),
    capacites: v.array(v.string()),
    modele: v.union(v.string(), v.null()),
    /** La fiche partagée, mot pour mot (cf. `model/definitions.ts`). */
    contenu: v.string(),
    /** Les dossiers propres à chaque ordinateur, écrits `{{chemin:cle}}` dans la fiche. */
    dependances: v.array(v.object({ cle: v.string(), libelle: v.string() })),
    /** 1 à la publication, +1 à chaque mise à jour de l'auteur. */
    version: v.number(),
    majLe: v.number(),
    /** null : visible dans la bibliothèque. Les copies déjà ajoutées restent chez chacun. */
    retireeLe: v.union(v.number(), v.null()),
  })
    .index("by_retireeLe_and_majLe", ["retireeLe", "majLe"])
    .index("by_auteurId_and_slug", ["auteurId", "slug"]),

  /**
   * Un rappel partagé (cf. `docs/CONVEX-PLAN.md`, § 2). Visible par qui l'a créé et par
   * la personne à qui il est assigné. `liste` est la catégorie de l'assigné, sur son
   * ordinateur ; null : la colonne « Assignés par l'équipe ».
   */
  rappels: defineTable({
    titre: v.string(),
    notes: v.string(),
    /** « 2026-10-31 », ou null : pas de date. Le jour est celui choisi, pas un calcul de fuseau. */
    jour: v.union(v.string(), v.null()),
    /** « 14:00 », ou null. null avec un jour : journée entière. */
    heure: v.union(v.string(), v.null()),
    /** Dernier jour d'une période, strictement après `jour`, ou null. */
    fin: v.union(v.string(), v.null()),
    jourEntier: v.boolean(),
    /** Instant (ms) où le rappel passe en retard. null : pas d'échéance. */
    echeance: v.union(v.number(), v.null()),
    creePar: v.id("membres"),
    assigneA: v.id("membres"),
    statut: v.union(v.literal("a_faire"), v.literal("fait"), v.literal("en_retard")),
    faitLe: v.union(v.number(), v.null()),
    priorite: v.union(v.literal(0), v.literal(1), v.literal(2), v.literal(3)),
    /** La fonction qui le passera en retard, annulée si l'échéance change. */
    planificationId: v.union(v.id("_scheduled_functions"), v.null()),
    /** L'identifiant du rappel sur l'ordinateur, pour un import sans doublon. */
    origineLocale: v.union(v.string(), v.null()),
    liste: v.union(v.string(), v.null()),
  })
    .index("by_assigneA_and_statut_and_echeance", ["assigneA", "statut", "echeance"])
    .index("by_creePar_and_echeance", ["creePar", "echeance"])
    .index("by_assigneA_and_origineLocale", ["assigneA", "origineLocale"]),

  /** Écrite dans la même mutation que le changement, ou par la fonction planifiée à l'échéance. */
  notifications: defineTable({
    destinataire: v.id("membres"),
    type: v.union(v.literal("assigne"), v.literal("echeance"), v.literal("fait"), v.literal("modifie")),
    rappelId: v.id("rappels"),
    lue: v.boolean(),
  })
    .index("by_destinataire_and_lue", ["destinataire", "lue"])
    .index("by_rappelId", ["rappelId"]),

  /**
   * Un événement du calendrier commun (cf. `docs/CONVEX-PLAN.md`, § 3). Visible par
   * l'organisateur et les participants. `cle` identifie le Weekly, une seule fois.
   */
  evenements: defineTable({
    titre: v.string(),
    notes: v.string(),
    /** « 2026-10-27 » : le jour, ou le premier jour d'une répétition. */
    jour: v.string(),
    /** « 09:00 », ou null pour un jour entier. */
    debut: v.union(v.string(), v.null()),
    fin: v.union(v.string(), v.null()),
    jourEntier: v.boolean(),
    organisateur: v.id("membres"),
    touteEquipe: v.boolean(),
    repetition: v.union(v.literal("aucune"), v.literal("semaine")),
    /** Instant du premier début, fourni par l'ordinateur, pour l'index de période. */
    debutMs: v.number(),
    cle: v.union(v.string(), v.null()),
  }).index("by_cle", ["cle"]),

  /** Une personne qui voit l'événement. `debut` recopie le premier début, pour chercher par période. */
  participations: defineTable({
    evenementId: v.id("evenements"),
    participant: v.id("membres"),
    debut: v.number(),
  })
    .index("by_participant_and_debut", ["participant", "debut"])
    .index("by_evenement", ["evenementId"]),

  /** Développement seulement (`KLYRA_COURRIEL_SIMULE=1`, sans clé PostShiba) : les e-mails au lieu de l'envoi. */
  courrielsSimules: defineTable({
    a: v.string(),
    sujet: v.string(),
    texte: v.string(),
  }).index("by_a", ["a"]),
});
