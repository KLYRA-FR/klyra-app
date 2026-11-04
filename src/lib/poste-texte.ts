/** Textes P-1, P-2 et P-3. Le mot vient du système du poste, jamais du téléphone. */

export type SystemePoste = "mac" | "windows" | "autre";

export interface PosteLu {
  systeme: SystemePoste;
  nom: string;
  ouvert: boolean;
  dernierSignal: number;
}

export function support(poste: Pick<PosteLu, "systeme" | "nom">): string {
  if (poste.systeme === "mac") return "ton Mac";
  if (poste.systeme === "windows") return "ton PC";
  return poste.nom;
}

/**
 * Les mots du téléphone (socle § 8) : « ton Mac », « ton PC », « ton ordinateur » (autre système, ou
 * aucun poste encore signalé) ; le nom du poste seulement s'il y en a plusieurs sur le compte. Un nom
 * de machine seul (« openbot ») ne dit rien, et un système n'est jamais deviné.
 */
export function supportOuOrdinateur(poste: Pick<PosteLu, "systeme" | "nom"> | null, plusieurs = false): string {
  if (!poste) return "ton ordinateur";
  if (plusieurs) return poste.nom;
  return poste.systeme === "autre" ? "ton ordinateur" : support(poste);
}

export const majuscule = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1);

/** Réglages › Ce téléphone (MO-T15). */
export function cheminTelephone(poste: Pick<PosteLu, "systeme" | "nom"> | null): string {
  return `Passe par ton compte, puis par ${supportOuOrdinateur(poste)}.`;
}

/** Plus › Automatisations (MO-T17) : une routine d'un VPS tourne même l'ordinateur fermé. */
export function texteRoutines(poste: Pick<PosteLu, "systeme" | "nom"> | null): string {
  const sur = supportOuOrdinateur(poste);
  return `Les routines se gèrent sur ${sur}. Celles d’un VPS y tournent même ${sur} fermé.`;
}

/** Le téléphone après une déconnexion depuis Réglages › Mobile (MO-T14). */
export function texteDeconnecte(poste: Pick<PosteLu, "systeme" | "nom"> | null): string {
  return `Ce téléphone a été déconnecté depuis ${supportOuOrdinateur(poste)}. Reconnecte-toi pour retrouver tes conversations.`;
}

/**
 * La pastille de l'ordinateur (socle § 2.3) : « Mac », « PC » ou « Ordinateur », suivi de « fermé »
 * s'il l'est ; le nom du poste seulement s'il y en a plusieurs. Jamais le nom d'une machine seule.
 */
export function libellePastille(poste: PosteLu | null, plusieurs = false): string {
  if (!poste) return "Aucun ordinateur";
  const nom = plusieurs ? poste.nom : poste.systeme === "mac" ? "Mac" : poste.systeme === "windows" ? "PC" : "Ordinateur";
  return poste.ouvert ? nom : `${nom} fermé`;
}

function heure(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Les deux phrases de la feuille (P-3). */
export function texteFeuille(poste: PosteLu, plusieurs = false): string {
  const sur = supportOuOrdinateur(poste, plusieurs);
  if (poste.ouvert) return `KLYRA est ouverte sur ${sur}.`;
  return `KLYRA est fermée sur ${sur} depuis ${heure(poste.dernierSignal)}. Tes messages partiront à son ouverture ; les fichiers, les routines et les réglages de l'ordinateur reviendront avec lui.`;
}

/**
 * Ce que dit un geste ou une lecture qui n'a pas abouti (socle § 8, C-1f) : P-10 sans réponse, sinon
 * la phrase de l'ordinateur ou du compte ; sans phrase, qui n'a pas pu le faire. Jamais « Le geste a
 * échoué sur l'ordinateur ».
 */
export function texteErreurPoste(r: { code: string; message: string }, sur: string): string {
  if (r.code === "delai") return `${majuscule(sur)} ne répond pas.`;
  if (r.message.trim()) return r.message;
  if (r.code === "compte") return "Ton compte n’a pas répondu. Réessaie.";
  return `${majuscule(sur)} n’a pas pu le faire : erreur inattendue.`;
}

export function bandeauComposeur(poste: PosteLu | null): string | null {
  if (!poste || poste.ouvert) return null;
  return `${majuscule(supportOuOrdinateur(poste))} est fermé : ton message partira à son ouverture.`;
}

export function attenteEnvoi(poste: PosteLu | null): string {
  return `En attente de ${supportOuOrdinateur(poste)}`;
}
