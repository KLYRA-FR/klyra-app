import { majuscule, supportOuOrdinateur, type PosteLu } from "@/lib/poste-texte";
import { libelleVue } from "./vue-gardee";

/**
 * La carte de l'ordinateur en tête de Plus (lot 8, E8-01, E8-03 à E8-06) : ce que le compte sait des
 * postes, sans faux état. Hors ligne, le dernier état connu est daté et ne porte pas d'étiquette qui
 * aurait l'air actuelle.
 */

type Poste = PosteLu & { cle: string };

export type CarteOrdinateur =
  | { etat: "chargement" }
  | { etat: "aucun" }
  | {
      etat: "poste";
      titre: string;
      sous: string;
      etiquette: { texte: string; bleue: boolean } | null;
      phrase: string;
      /** Le poste dont on peut attendre l'ouverture (« Me prévenir »), s'il est fermé. */
      prevenir: string | null;
    };

/** « depuis 18:42 », « depuis hier à 18:42 », « depuis le 2 nov. à 18:42 ». */
export function depuisQuand(ms: number, maintenant: number): string {
  return libelleVue(ms, maintenant, "depuis").replace("depuis à ", "depuis ");
}

/** La phrase courte d'un poste, dans la feuille Ordinateurs et Ce téléphone (S-06, E8-11). */
export function phrasePoste(poste: PosteLu, maintenant: number): string {
  if (poste.ouvert) return "KLYRA est ouverte.";
  return `KLYRA est fermée ${depuisQuand(poste.dernierSignal, maintenant)}. Tes messages partiront à son ouverture.`;
}

export function carteOrdinateur({
  postes,
  horsLigne,
  derniereDonnee,
  maintenant,
}: {
  postes: Poste[] | undefined;
  horsLigne: boolean;
  derniereDonnee: number | null;
  maintenant: number;
}): CarteOrdinateur {
  if (postes === undefined) return { etat: "chargement" };
  if (postes.length === 0) return { etat: "aucun" };
  const plusieurs = postes.length > 1;
  const ouverts = postes.filter((p) => p.ouvert);
  const montre = ouverts[0] ?? postes[0];
  const sur = supportOuOrdinateur(montre, plusieurs);
  const titre = plusieurs ? "Tes ordinateurs" : majuscule(sur);
  const sous = plusieurs ? `${postes.length} ordinateurs · ${ouverts.length} ouvert${ouverts.length > 1 ? "s" : ""}` : montre.nom;

  if (horsLigne) {
    const avant = montre.ouvert ? "ouverte" : "fermée";
    const date = derniereDonnee ? libelleVue(derniereDonnee, maintenant, "").trim() : null;
    return {
      etat: "poste",
      titre,
      sous,
      etiquette: null,
      phrase: date ? `${majuscule(date)}, KLYRA était ${avant} sur ${sur}. Son état revient avec le réseau.` : "Son état revient avec le réseau.",
      prevenir: null,
    };
  }
  if (montre.ouvert) return { etat: "poste", titre, sous, etiquette: { texte: "Ouvert", bleue: true }, phrase: `KLYRA est ouverte sur ${sur}.`, prevenir: null };
  return {
    etat: "poste",
    titre,
    sous,
    etiquette: { texte: "Fermé", bleue: false },
    phrase: `KLYRA est fermée sur ${sur} ${depuisQuand(montre.dernierSignal, maintenant)}. Tes messages partiront à son ouverture.`,
    prevenir: montre.cle,
  };
}
