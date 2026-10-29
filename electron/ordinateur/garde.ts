import { lireReglages } from "../reglages";

/**
 * La règle de Computer Use : rien ne pilote l'ordinateur sans l'interrupteur
 * des Réglages (coupé par défaut). Chaque fonction qui capture l'écran ou
 * envoie clavier et souris passe d'abord par ici.
 */
export class ComputerUseCoupe extends Error {
  code = "computer-use-coupe";
  constructor() {
    super("Computer Use est coupé : active-le dans Réglages → Computer Use.");
  }
}

export function verifierInterrupteur(): void {
  if (!lireReglages().computerUse.actif) throw new ComputerUseCoupe();
}
