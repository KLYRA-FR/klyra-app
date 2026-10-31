import { v } from "convex/values";
import { ROLE_TEINTES, type RoleTeinte } from "../../src/types/domain";

export const vRole = v.union(v.literal("admin"), v.literal("membre"));
export type Role = "admin" | "membre";

export const vStatutInvitation = v.union(v.literal("en_attente"), v.literal("acceptee"), v.literal("annulee"));

/** Les erreurs que l'app sait traduire (cf. `src/lib/compte.tsx`). */
export type CodeErreur =
  | "connexion_refusee"
  | "non_connecte"
  | "reserve_aux_admins"
  | "adresse_invalide"
  | "nom_invalide"
  | "couleur_invalide"
  | "deja_membre"
  | "deja_invitee"
  | "introuvable"
  | "dernier_admin"
  | "trop_tot"
  // Bibliothèque KLYRA (cf. `convex/bibliotheque.ts`, `model/definitions.ts`).
  | "reserve_a_l_auteur"
  | "deja_publiee"
  | "conflit_version"
  | "fiche_invalide"
  | "trop_long"
  | "cle_non_partagee"
  | "secret_detecte"
  | "chemin_personnel"
  | "dependance_invalide"
  // Rappels assignés (cf. `convex/rappels.ts`).
  | "reserve_au_createur"
  | "rappel_invalide"
  | "membre_inconnu"
  | "lot_trop_grand"
  // Calendrier commun (cf. `convex/evenements.ts`).
  | "evenement_invalide"
  | "reserve_a_lorganisateur";

const ADRESSE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Une adresse comparable : sans espaces autour, en minuscules. */
export function normaliserEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function estEmail(email: string): boolean {
  return email.length <= 254 && ADRESSE.test(email);
}

export function estTeinte(couleur: string): couleur is RoleTeinte {
  return (ROLE_TEINTES as string[]).includes(couleur);
}

/** La couleur d'une nouvelle personne : la suivante dans la palette, selon le nombre de membres. */
export function couleurSuivante(nombreDeMembres: number): RoleTeinte {
  return ROLE_TEINTES[nombreDeMembres % ROLE_TEINTES.length];
}

/** Un nom affiché : 1 à 80 caractères, espaces superflus retirés. */
export function nettoyerNom(nom: string, max = 80): string | null {
  const propre = nom.trim().replace(/\s+/g, " ");
  return propre.length > 0 && propre.length <= max ? propre : null;
}
