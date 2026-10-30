/**
 * Les messages commencés et pas envoyés, par conversation (`localStorage`) : ils
 * survivent à un changement d'onglet. Le composeur les lit et les écrit ; un
 * autre écran peut y ajouter un début de message (« Le décrire à Sam ») et lui
 * demander de prendre le focus, curseur à la fin, sans rien envoyer.
 */

const CLE_BROUILLONS = "klyra-brouillons";
const EVENEMENT_BROUILLON = "klyra:brouillon";

export type Brouillon = { text: string; fichiers: string[] };

export function lireBrouillons(): Record<string, Brouillon> {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_BROUILLONS) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, Brouillon>) : {};
  } catch {
    return {};
  }
}

export function garderBrouillon(chatId: string, brouillon: Brouillon) {
  try {
    const tous = lireBrouillons();
    if (brouillon.text.trim() || brouillon.fichiers.length) tous[chatId] = brouillon;
    else delete tous[chatId];
    localStorage.setItem(CLE_BROUILLONS, JSON.stringify(tous));
  } catch {
    /* stockage indisponible : le brouillon ne survit pas */
  }
}

/** La conversation dont le composeur doit prendre le focus en s'ouvrant (une fois). */
let ecrireDans: string | null = null;

/** Le composeur de cette conversation prendra le focus, curseur à la fin, dès qu'il s'affiche. */
export function demanderEcriture(chatId: string): void {
  ecrireDans = chatId;
}

/** Vrai une seule fois après `demanderEcriture(chatId)`. */
export function prendreDemandeEcriture(chatId: string): boolean {
  if (ecrireDans !== chatId) return false;
  ecrireDans = null;
  return true;
}

/**
 * Ajoute un début de message au brouillon d'une conversation, sans l'écraser : à
 * la ligne s'il y avait déjà du texte (rien si ce début y est déjà, à la fin).
 * Le composeur ouvert sur cette conversation le reprend tout de suite ; sinon,
 * il le lira à son ouverture. Rien n'est envoyé.
 */
export function ajouterAuBrouillon(chatId: string, debut: string): void {
  const actuel = lireBrouillons()[chatId] ?? { text: "", fichiers: [] };
  const avant = actuel.text.trimEnd();
  const text = !avant ? debut : avant.endsWith(debut.trimEnd()) ? actuel.text : `${avant}\n${debut}`;
  garderBrouillon(chatId, { ...actuel, text });
  demanderEcriture(chatId);
  window.dispatchEvent(new CustomEvent<{ chatId: string; text: string }>(EVENEMENT_BROUILLON, { detail: { chatId, text } }));
}

/** Le composeur d'une conversation suit les ajouts faits d'ailleurs à son brouillon. */
export function surBrouillon(chatId: string, recevoir: (text: string) => void): () => void {
  const ecouter = (e: Event) => {
    const { detail } = e as CustomEvent<{ chatId: string; text: string }>;
    if (detail.chatId === chatId) recevoir(detail.text);
  };
  window.addEventListener(EVENEMENT_BROUILLON, ecouter);
  return () => window.removeEventListener(EVENEMENT_BROUILLON, ecouter);
}
