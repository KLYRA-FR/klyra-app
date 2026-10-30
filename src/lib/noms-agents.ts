import type { Role } from "@/types/domain";

/**
 * Les noms des agents et de l'assistant : deux agents ne portent jamais le même nom, sinon les
 * mentions @ et les listes deviennent ambiguës (spec §5, §9.3). La comparaison ignore les accents,
 * les majuscules et les espaces en trop, et porte sur le nom, le rôle court et l'identifiant.
 */

export const comparable = (texte: string) =>
  texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Un nom propre : espaces multiples réduits, sans espaces autour. */
export const nomPropre = (nom: string) => nom.trim().replace(/\s+/g, " ");

/** L'agent (de `roles`, sauf `saufId`) qui porte déjà ce nom, ce rôle court ou cet identifiant. */
export function nomDejaPris(nom: string, roles: Role[], saufId?: string): Role | null {
  const cible = comparable(nom);
  if (!cible) return null;
  return roles.find((r) => r.id !== saufId && [r.name, r.tag, r.id].some((v) => comparable(v) === cible)) ?? null;
}

/** Le nom de l'assistant : 1 à 24 caractères, lettres (accents compris), chiffres, espace, apostrophe, tiret. */
export function erreurNomAssistant(nom: string, roles: Role[]): string | null {
  const propre = nomPropre(nom);
  if (!propre) return "Donne-lui un nom.";
  if (propre.length > 24) return "24 caractères au plus.";
  if (!/^[\p{L}\p{N} '’-]+$/u.test(propre)) return "Lettres, chiffres, espaces, apostrophes et tirets seulement.";
  const pris = nomDejaPris(propre, roles, "principal");
  return pris ? `Un de tes agents s’appelle déjà ${pris.name}. Choisis un autre nom.` : null;
}

/** L'identifiant déduit d'un nom : minuscules, sans accents, espaces → tirets (« Juriste immo » → `juriste-immo`). */
export function identifiantDe(nom: string): string {
  return comparable(nom)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
