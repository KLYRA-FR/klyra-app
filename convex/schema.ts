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

  /** Développement seulement (`KLYRA_COURRIEL_SIMULE=1`, sans clé PostShiba) : les e-mails au lieu de l'envoi. */
  courrielsSimules: defineTable({
    a: v.string(),
    sujet: v.string(),
    texte: v.string(),
  }).index("by_a", ["a"]),
});
