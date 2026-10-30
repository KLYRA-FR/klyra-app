import { nettoyerNom } from "../../convex/model/valeurs";
import type { User } from "@/types/domain";

/**
 * Qui tu es dans l'app : le profil de cet ordinateur, ou celui du compte d'équipe.
 *
 * - Sans compte (pas connecté, session en cours de vérification ou hors ligne,
 *   compte retiré, app web) : le profil de cet ordinateur fait foi, comme avant.
 * - Connecté, membre actif : le nom et le rôle sont ceux du compte d'équipe, lus
 *   sur le serveur avec la session ; c'est ce que l'équipe et les agents voient.
 *   La photo et les préférences restent celles de cet ordinateur.
 * - Rien n'est recopié tout seul d'un côté à l'autre : un écart se règle par un
 *   choix explicite (`ecartProfils`). Modifier son nom connecté écrit le compte,
 *   puis cet ordinateur. Le profil du compte n'est jamais gardé sur le disque :
 *   déconnecté, il ne reste que celui de cet ordinateur.
 */

/** Ce que le serveur renvoie du compte connecté (`equipe:moi`). */
export interface ProfilCompte {
  nom: string;
  intitule: string;
  couleur: string;
}

export interface Identite {
  /** Identifiant de cet ordinateur (préférences locales), jamais celui du compte. */
  id: string;
  name: string;
  title: string;
  initial: string;
  photo: string | null;
  /** La couleur du compte, s'il y en a un. */
  couleur: string | null;
  source: "compte" | "local";
}

export const initialeDe = (nom: string) => nom.trim().charAt(0).toUpperCase();

export function identiteAffichee(local: User, compte: ProfilCompte | null): Identite {
  const photo = local.photo ?? null;
  if (!compte) return { id: local.id, name: local.name, title: local.title, initial: local.initial || initialeDe(local.name), photo, couleur: null, source: "local" };
  return { id: local.id, name: compte.nom, title: compte.intitule, initial: initialeDe(compte.nom), photo, couleur: compte.couleur, source: "compte" };
}

/**
 * Un nom et un rôle valables, comme le serveur les garde (`modifierMonProfil`) :
 * nom de 1 à 80 caractères, rôle vide ou de 1 à 80, espaces superflus retirés.
 */
export function identiteValable(nom: string, intitule: string): { nom: string; intitule: string } | null {
  const n = nettoyerNom(nom);
  const i = intitule.trim() === "" ? "" : nettoyerNom(intitule);
  return n === null || i === null ? null : { nom: n, intitule: i };
}

export interface Ecart {
  /** Le profil de cet ordinateur, tel qu'il serait envoyé au compte (null : pas envoyable, nom vide ou trop long). */
  local: { nom: string; intitule: string } | null;
  localBrut: { nom: string; intitule: string };
  compte: { nom: string; intitule: string };
}

/**
 * Connecté, le profil de cet ordinateur diffère-t-il de celui du compte ? Un
 * ordinateur sans nom (premier lancement) n'a rien à proposer : pas d'écart.
 */
export function ecartProfils(local: User, compte: ProfilCompte | null): Ecart | null {
  if (!compte || !local.name.trim()) return null;
  const propre = identiteValable(local.name, local.title);
  const memeNom = propre ? propre.nom === compte.nom : false;
  const memeRole = propre ? propre.intitule === compte.intitule : false;
  if (memeNom && memeRole) return null;
  return { local: propre, localBrut: { nom: local.name, intitule: local.title }, compte: { nom: compte.nom, intitule: compte.intitule } };
}
