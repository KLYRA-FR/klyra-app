import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vRole, vStatutInvitation } from "./model/valeurs";

/**
 * Données partagées de l'équipe, hébergées par Convex (cf. `docs/CONVEX-PLAN.md`).
 * Les fichiers et les clés restent sur l'ordinateur. Une copie des conversations
 * (messages, cartes d'agents et de projets) est aussi dans le compte, pour le téléphone.
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
    /** D'où part la dernière demande acceptée. Absent : l'ordinateur (`klyra://`). */
    cible: v.optional(v.union(v.literal("web"), v.literal("poste"))),
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

  /**
   * Un ordinateur du compte. Le téléphone lit `dernierSignal` : ouvert s'il date
   * de moins de 25 s. Le téléphone ne s'écrit pas ici.
   */
  postes: defineTable({
    membreId: v.id("membres"),
    /** Identifiant stable de cet ordinateur, choisi par l'app, pas par le téléphone. */
    cle: v.string(),
    systeme: v.union(v.literal("mac"), v.literal("windows"), v.literal("autre")),
    nom: v.string(),
    dernierSignal: v.number(),
    /** La session de cet ordinateur (Convex Auth), écrite à chaque signal. Absente : version d'avant. */
    sessionId: v.optional(v.id("authSessions")),
  })
    .index("by_membre_and_cle", ["membreId", "cle"])
    .index("by_sessionId", ["sessionId"]),

  /**
   * Un téléphone ou un navigateur connecté au compte (Réglages › Mobile) : une ligne par session,
   * écrite par la session elle-même (`telephones:signaler`). La liste part des sessions
   * (`authSessions`) : une session sans ligne s'affiche quand même, « appareil non identifié ».
   */
  telephones: defineTable({
    membreId: v.id("membres"),
    sessionId: v.id("authSessions"),
    modele: v.union(v.literal("iphone"), v.literal("android"), v.literal("navigateur")),
    cree: v.number(),
    /** Dernier signal, écrit au plus une fois par minute. */
    vu: v.number(),
  })
    .index("by_membre", ["membreId"])
    .index("by_sessionId", ["sessionId"]),

  /**
   * Copie des conversations de l'ordinateur (spec mobile M-4). La copie locale
   * reste dans `conversations.json`. Ni sessions Claude, ni fichiers, ni clés.
   */
  conversationsCompte: defineTable({
    membreId: v.id("membres"),
    origine: v.string(),
    kind: v.union(v.literal("direct"), v.literal("equipe")),
    titre: v.string(),
    projetId: v.union(v.string(), v.null()),
    projetNom: v.union(v.string(), v.null()),
    roleIds: v.array(v.string()),
    misAJour: v.string(),
    epingleLe: v.union(v.string(), v.null()),
    extrait: v.string(),
    extraitLe: v.union(v.string(), v.null()),
    nonLus: v.number(),
    /** Tâches du fil, JSON court. */
    taches: v.string(),
    /** La machine de la conversation : null ce PC, sinon l'id du VPS relié. Absent : version d'avant. */
    lieu: v.optional(v.union(v.string(), v.null())),
    /** Fil d'un agent : l'id de sa conversation directe. Archivé : la date. Absents : version d'avant. */
    parent: v.optional(v.union(v.string(), v.null())),
    archiveLe: v.optional(v.union(v.string(), v.null())),
  })
    .index("by_membre_and_origine", ["membreId", "origine"])
    .index("by_membre_and_misAJour", ["membreId", "misAJour"]),

  messagesCompte: defineTable({
    membreId: v.id("membres"),
    conversationOrigine: v.string(),
    origine: v.string(),
    auteurKind: v.union(v.literal("user"), v.literal("role")),
    auteurId: v.union(v.string(), v.null()),
    creeLe: v.string(),
    texte: v.string(),
    /** Parties réduites (texte, nombre d'étapes, tâches), JSON. */
    parties: v.string(),
    statut: v.union(v.literal("en-cours"), v.literal("fait"), v.literal("erreur"), v.null()),
  })
    .index("by_membre_and_conversation_and_creeLe", ["membreId", "conversationOrigine", "creeLe"])
    .index("by_membre_and_origine", ["membreId", "origine"]),

  /** Carte d'identité d'un agent, pour lire un fil sans la fiche (M-4). */
  cartesAgents: defineTable({
    membreId: v.id("membres"),
    origine: v.string(),
    nom: v.string(),
    teinte: v.string(),
    roleCourt: v.string(),
    actif: v.boolean(),
  }).index("by_membre_and_origine", ["membreId", "origine"]),

  /** Carte d'un projet, sans son dossier (M-4). */
  cartesProjets: defineTable({
    membreId: v.id("membres"),
    origine: v.string(),
    nom: v.string(),
    accroche: v.string(),
    statut: v.string(),
    epingle: v.boolean(),
  }).index("by_membre_and_origine", ["membreId", "origine"]),

  /** Message écrit sur le téléphone : il part sur l'ordinateur à son ouverture. */
  messagesFile: defineTable({
    membreId: v.id("membres"),
    conversationOrigine: v.string(),
    texte: v.string(),
    creeLe: v.number(),
    pris: v.boolean(),
    /** Ce qui part avec le message (destinataire, modèle, effort, façon de réessayer…), JSON court. Absent : version d'avant. */
    options: v.optional(v.string()),
    /** Pièces jointes déposées dans le stockage du compte, effacées une fois écrites sur le poste. */
    pieces: v.optional(
      v.array(v.object({ fichier: v.id("_storage"), nom: v.string(), type: v.string(), taille: v.number() })),
    ),
  }).index("by_membre_and_pris_and_creeLe", ["membreId", "pris", "creeLe"]),

  /**
   * Un geste du téléphone sur une conversation (renommer, épingler, archiver un fil…), « Compte » dans
   * la spec : déjà appliqué à la copie du compte, il part sur l'ordinateur à son ouverture, dans l'ordre.
   */
  operationsFile: defineTable({
    membreId: v.id("membres"),
    conversationOrigine: v.union(v.string(), v.null()),
    type: v.string(),
    /** JSON court. */
    valeur: v.string(),
    creeLe: v.number(),
    pris: v.boolean(),
  }).index("by_membre_and_pris_and_creeLe", ["membreId", "pris", "creeLe"]),

  /**
   * Demande du téléphone à l'ordinateur ouvert (spec mobile M-3) : lire un dossier, un fichier, les
   * routines… La réponse n'est pas gardée (M-7) : effacée dès que le téléphone l'a lue, ou à l'expiration.
   */
  demandesPoste: defineTable({
    membreId: v.id("membres"),
    /** L'ordinateur visé ; null : le premier ordinateur ouvert du compte qui la prend. */
    posteCle: v.union(v.string(), v.null()),
    /** « domaine.geste », par exemple « fichiers.lire ». */
    type: v.string(),
    /** JSON. */
    args: v.string(),
    statut: v.union(v.literal("attente"), v.literal("prise"), v.literal("faite"), v.literal("erreur")),
    /** JSON de la réponse, quand elle tient dans le document. */
    reponse: v.union(v.string(), v.null()),
    /** Réponse trop grande pour le document : déposée dans le stockage, effacée avec la demande. */
    fichier: v.union(v.id("_storage"), v.null()),
    erreur: v.union(v.object({ code: v.string(), message: v.string() }), v.null()),
    creeLe: v.number(),
    expireLe: v.number(),
  }).index("by_membre_and_statut_and_creeLe", ["membreId", "statut", "creeLe"]),

  /** Notifications web du téléphone (spec mobile § 8) : un abonnement par session. */
  abonnementsPush: defineTable({
    membreId: v.id("membres"),
    sessionId: v.id("authSessions"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    /** Événements choisis dans Réglages › Ce téléphone, JSON. */
    preferences: v.string(),
    cree: v.number(),
  })
    .index("by_membre", ["membreId"])
    .index("by_sessionId", ["sessionId"])
    .index("by_endpoint", ["endpoint"]),

  /** Développement seulement (`KLYRA_COURRIEL_SIMULE=1`, sans clé PostShiba) : les e-mails au lieu de l'envoi. */
  courrielsSimules: defineTable({
    a: v.string(),
    sujet: v.string(),
    texte: v.string(),
  }).index("by_a", ["a"]),
});
