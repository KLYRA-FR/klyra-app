import type { NativeImage } from "electron";

/**
 * Une page du navigateur de KLYRA, quel que soit le moteur : la vue intégrée (Electron,
 * `PageElectron` dans `navigateur.ts`) ou un onglet du Chrome de ce poste (`chrome-poste.ts`).
 * Les gestes des agents (`navigateur.ts`) ne passent que par elle.
 */

export type MoteurNavigateur = "integre" | "chrome";

export type GestePage = "retour" | "suivant" | "recharger" | "arreter";

/** Un cadre direct de la page (iframe), lisible par un script. */
export interface CadrePage {
  /** Ce qui le retrouve à l'action suivante (tant qu'il n'a pas changé). */
  cle: string;
  nom: string;
  url: string;
  script<T>(code: string): Promise<T>;
}

export interface Page {
  readonly moteur: MoteurNavigateur;
  detruite(): boolean;
  url(): string;
  chargement(): boolean;
  /** Un script dans un monde isolé du cadre principal : il voit le DOM, pas les variables de la page. */
  script<T>(code: string): Promise<T>;
  /** Une commande du protocole de débogage de la page (gestes « de confiance »). */
  cdp(methode: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Les événements du protocole de cette page. Rend de quoi arrêter d'écouter. */
  ecouter(f: (methode: string, params: Record<string, unknown>) => void): () => void;
  /** Une image de la partie visible ; `cachee` : la page n'est pas à l'écran. */
  image(cachee: boolean): Promise<NativeImage>;
  /** Les cadres directs de la page. */
  cadres(): Promise<CadrePage[]>;
  /** Un cadre lu plus tôt, ou null s'il a changé. */
  cadre(cle: string): CadrePage | null;
  aller(url: string): void;
  geste(g: GestePage): void;
}
