/**
 * Le navigateur de KLYRA pour les agents du VPS. Le navigateur est sur l'ordinateur de la personne
 * (electron/navigateur/) : un outil `navigateur_*` appelé ici part au PC par le journal des événements
 * (type `navigateur`, comme un livrable), le PC l'exécute dans l'onglet de la même conversation et
 * renvoie le résultat (`POST /klyra/v1/agent/navigateur`). Sans app ouverte sur le PC, l'outil le dit
 * tout de suite ; sans réponse, il abandonne au bout du délai. Les outils et leur consigne sont ceux du
 * PC (`navigateur-definitions.mjs`, généré).
 */
import { randomUUID } from "node:crypto";
import { consigneNavigateurTexte, estOutilNavigateur, OUTILS_NAVIGATEUR, OUTILS_NAVIGATEUR_LECTURE } from "./navigateur-definitions.mjs";

export { consigneNavigateurTexte, estOutilNavigateur, OUTILS_NAVIGATEUR, OUTILS_NAVIGATEUR_LECTURE };

export const DELAI_NAVIGATEUR_MS = 120_000;
/** Une réponse plus lourde n'est pas transmise à l'agent (une capture fait quelques centaines de Ko). */
const REPONSE_MAX = 8 * 1024 * 1024;

const texte = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

/** Le résultat rendu par le PC, vérifié : seulement du texte et des images. */
export function resultatValide(brut) {
  const contenu = Array.isArray(brut?.content) ? brut.content : [];
  const propre = [];
  let taille = 0;
  for (const c of contenu.slice(0, 10)) {
    if (c?.type === "text" && typeof c.text === "string") {
      taille += c.text.length;
      propre.push({ type: "text", text: c.text });
    } else if (c?.type === "image" && typeof c.data === "string" && /^image\/(jpeg|png)$/.test(String(c.mimeType)) && /^[A-Za-z0-9+/=]+$/.test(c.data.slice(0, 200))) {
      taille += c.data.length;
      propre.push({ type: "image", data: c.data, mimeType: c.mimeType });
    }
  }
  if (!propre.length || taille > REPONSE_MAX) return texte("Réponse illisible du navigateur de l'ordinateur.", true);
  return { content: propre, ...(brut?.isError === true ? { isError: true } : {}) };
}

/**
 * @param {{ publier: (requestId: string, event: object, sessionId: string | null) => void, ecouteurs: () => number, delaiMs?: number, maintenant?: () => number }} options
 */
export function creerRelaisNavigateur(options) {
  const delai = options.delaiMs ?? DELAI_NAVIGATEUR_MS;
  const maintenant = options.maintenant ?? Date.now;
  const attentes = new Map();

  /** Appelle l'outil sur le PC ; rend toujours un résultat MCP (une erreur aussi). */
  function appeler(appelant, nom, args) {
    if (!estOutilNavigateur(nom)) return Promise.resolve(texte("Outil inconnu.", true));
    if (!appelant?.conversation) return Promise.resolve(texte("Conversation inconnue : le navigateur de KLYRA ne s'utilise que depuis une conversation.", true));
    if (!options.ecouteurs())
      return Promise.resolve(texte("L'app KLYRA n'est pas ouverte sur l'ordinateur de la personne : son navigateur n'est pas joignable. Dis-lui de l'ouvrir, ou fais sans navigateur.", true));
    const id = randomUUID();
    return new Promise((resoudre) => {
      const minuteur = setTimeout(() => {
        attentes.delete(id);
        resoudre(texte("L'ordinateur de la personne n'a pas répondu à temps (navigateur de KLYRA).", true));
      }, delai);
      attentes.set(id, (r) => {
        clearTimeout(minuteur);
        resoudre(r);
      });
      options.publier(id, { type: "navigateur", id, nom, arguments: args && typeof args === "object" ? args : {}, agent: appelant.agent ?? "principal", conversation: appelant.conversation, expire: maintenant() + delai }, null);
    });
  }

  /** La réponse du PC à un appel en attente ; faux si l'appel n'attend plus (déjà répondu, expiré). */
  function repondre(id, resultat) {
    const fin = typeof id === "string" ? attentes.get(id) : undefined;
    if (!fin) return false;
    attentes.delete(id);
    fin(resultatValide(resultat));
    return true;
  }

  return { appeler, repondre, enAttente: () => attentes.size };
}
