import { effacerBrouillons } from "@/lib/brouillons";
import { oublierAccesServeursTelephone } from "@/lib/serveur-vps";
import { effacerEchangesDirects } from "./vps-direct";
import { effacerVues } from "./vue-gardee";

const CLE_COMPTE = "klyra:telephone:compte-local";
let dernierCompte: string | null = null;

/**
 * Les copies et accès appartiennent à la session de ce téléphone. Le propriétaire survit au
 * rechargement ; une première ouverture sans compte peut encore relier un VPS (T-00).
 * Une attente de connexion/réseau n'est jamais une déconnexion confirmée.
 */
export function actualiserSessionTelephone({ membre, deconnecte, revoque }: { membre: string | null; deconnecte: boolean; revoque: boolean }) {
  let precedent = dernierCompte;
  try {
    precedent ??= localStorage.getItem(CLE_COMPTE);
  } catch {
    /* La session en mémoire suffit lorsque le stockage est indisponible. */
  }
  if (revoque || (precedent && (deconnecte || (membre && membre !== precedent)))) {
    effacerVues();
    effacerBrouillons();
    effacerEchangesDirects();
    oublierAccesServeursTelephone();
  }
  if (membre) effacerVues(undefined, membre);
  if (membre || deconnecte || revoque) {
    dernierCompte = membre;
    try {
      if (membre) localStorage.setItem(CLE_COMPTE, membre);
      else localStorage.removeItem(CLE_COMPTE);
    } catch {
      /* Rien n'est écrit dans le compte ni sur un autre appareil. */
    }
  }
}
