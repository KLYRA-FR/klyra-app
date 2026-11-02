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

/** Sans poste connu (pas encore de signal) : « ton ordinateur », jamais un système deviné. */
export function supportOuOrdinateur(poste: Pick<PosteLu, "systeme" | "nom"> | null): string {
  return poste ? support(poste) : "ton ordinateur";
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

export function libellePastille(poste: PosteLu | null): string {
  if (!poste) return "Aucun ordinateur relié";
  if (poste.systeme === "mac") return poste.ouvert ? "Mac ouvert" : "Mac fermé";
  if (poste.systeme === "windows") return poste.ouvert ? "PC ouvert" : "PC fermé";
  return poste.ouvert ? `${poste.nom} ouvert` : `${poste.nom} fermé`;
}

function heure(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Les deux phrases de la feuille (P-3). */
export function texteFeuille(poste: PosteLu): string {
  const sur = support(poste);
  if (poste.ouvert) return `KLYRA est ouverte sur ${sur}.`;
  return `KLYRA est fermée sur ${sur} depuis ${heure(poste.dernierSignal)}. Tes messages partiront à son ouverture ; les fichiers, les routines et les réglages de l'ordinateur reviendront avec lui.`;
}

export function bandeauComposeur(poste: PosteLu | null): string | null {
  if (!poste || poste.ouvert) return null;
  return `${majuscule(support(poste))} est fermé : ton message partira à son ouverture.`;
}

export function attenteEnvoi(poste: PosteLu | null): string {
  return `En attente de ${supportOuOrdinateur(poste)}`;
}
