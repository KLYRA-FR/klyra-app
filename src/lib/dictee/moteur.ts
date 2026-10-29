import type { CodeErreurDictee, KlyraBridge } from "@/lib/bridge";

/**
 * Ce qu'un moteur de dictée doit savoir faire : recevoir le micro en trames de
 * 100 ms et rendre le texte, provisoire puis définitif. useDictee ne connaît
 * que ce contrat : moteur-local.ts (Whisper sur l'ordinateur) et
 * moteur-elevenlabs.ts (en ligne) l'implémentent ; un autre service se
 * branche en ajoutant le sien.
 */

/** Le pont vers le process principal, pour les moteurs. */
export type PontDictee = NonNullable<KlyraBridge["dictee"]>;

/** Ce qu'un moteur rend à la dictée, au fil de la parole. */
export interface Rappels {
  /** Le texte provisoire du segment en cours (il remplace le précédent). */
  partiel: (texte: string) => void;
  /** Le texte définitif d'un segment : il s'ajoute, le provisoire s'efface. */
  definitif: (texte: string) => void;
  /** Le moteur ne peut plus continuer. */
  erreur: (code: CodeErreurDictee, message: string) => void;
}

export interface Moteur {
  readonly nom: "elevenlabs" | "local";
  /** Une trame de 100 ms du micro. */
  trame: (trame: Float32Array) => void;
  /** Plus de parole : rend la main quand tout le texte définitif est arrivé. */
  terminer: () => Promise<void>;
  annuler: () => void;
}
