/**
 * Les annonces des lecteurs d'écran pour les agents (« Juriste ajouté à tes agents. ») : un événement,
 * lu par la région `aria-live` de l'écran des agents (`RegionAnnonces`), d'où qu'il parte (fenêtre,
 * menu, fiche).
 */

export const EVENEMENT_ANNONCE = "klyra:annonce-agents";

export function annoncer(texte: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENEMENT_ANNONCE, { detail: texte }));
}
