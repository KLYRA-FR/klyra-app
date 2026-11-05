/**
 * Les workflows pour les agents du VPS. Les workflows vivent sur l'ordinateur de la personne (page
 * Workflows et moteur, dans l'app) : un outil `*_workflow` appelé ici part au PC par le journal des
 * événements (type `workflow`, comme le navigateur de KLYRA), le PC l'exécute pour la conversation de
 * l'agent et renvoie la réponse (`POST /klyra/v1/agent/workflow`). La personne voit le workflow se
 * construire sur sa page, comme pour un agent du PC (l'entrée de `construire_workflow` lui arrive aussi
 * pendant que le modèle l'écrit, par `etape-partielle`). Sans app ouverte sur le PC, l'outil le dit tout
 * de suite. Les outils sont ceux du PC (`workflows-outils.mjs`, généré).
 */
import { randomUUID } from "node:crypto";
import { estOutilWorkflow, OUTILS_WORKFLOWS, OUTILS_WORKFLOWS_LIBRES } from "./workflows-outils.mjs";

export { estOutilWorkflow, OUTILS_WORKFLOWS, OUTILS_WORKFLOWS_LIBRES };

/** Construire joue les étapes une à une sur la page (quelques secondes) : le délai le couvre largement. */
export const DELAI_WORKFLOW_MS = 60_000;
const REPONSE_MAX = 200_000;

const texte = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

/** La réponse rendue par le PC, vérifiée : du texte seulement. */
export function resultatValide(brut) {
  const contenu = Array.isArray(brut?.content) ? brut.content : [];
  const propre = contenu.slice(0, 5).filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => ({ type: "text", text: c.text }));
  if (!propre.length || propre.reduce((n, c) => n + c.text.length, 0) > REPONSE_MAX) return texte("Réponse illisible de l'ordinateur (workflows).", true);
  return { content: propre, ...(brut?.isError === true ? { isError: true } : {}) };
}

/**
 * @param {{ publier: (requestId: string, event: object, sessionId: string | null) => void, ecouteurs: () => number, delaiMs?: number, maintenant?: () => number }} options
 */
export function creerRelaisWorkflows(options) {
  const delai = options.delaiMs ?? DELAI_WORKFLOW_MS;
  const maintenant = options.maintenant ?? Date.now;
  const attentes = new Map();

  /** Appelle l'outil sur le PC ; rend toujours un résultat MCP (une erreur aussi). */
  function appeler(appelant, nom, args) {
    if (!estOutilWorkflow(nom)) return Promise.resolve(texte("Outil inconnu.", true));
    if (!appelant?.conversation) return Promise.resolve(texte("Conversation inconnue : les workflows ne s'utilisent que depuis une conversation.", true));
    /* Sans app ouverte, le moteur de ce serveur répond ; seule la construction, qui se regarde se faire, attend l'app. */
    const local = options.local?.();
    if (!options.ecouteurs() && local) return Promise.resolve(local.outilAgent(appelant, nom, args && typeof args === "object" ? args : {}));
    if (!options.ecouteurs())
      return Promise.resolve(texte("L'app KLYRA n'est pas ouverte sur l'ordinateur de la personne : ses workflows y vivent et ne sont pas joignables. Dis-lui de l'ouvrir.", true));
    const id = randomUUID();
    return new Promise((resoudre) => {
      const minuteur = setTimeout(() => {
        attentes.delete(id);
        resoudre(texte("L'ordinateur de la personne n'a pas répondu à temps (workflows).", true));
      }, delai);
      attentes.set(id, (r) => {
        clearTimeout(minuteur);
        resoudre(r);
      });
      options.publier(id, { type: "workflow", id, nom, arguments: args && typeof args === "object" ? args : {}, agent: appelant.agent ?? "principal", conversation: appelant.conversation, expire: maintenant() + delai }, null);
    });
  }

  /** La réponse du PC à un appel en attente ; faux si l'appel n'attend plus. */
  function repondre(id, resultat) {
    const fin = typeof id === "string" ? attentes.get(id) : undefined;
    if (!fin) return false;
    attentes.delete(id);
    fin(resultatValide(resultat));
    return true;
  }

  return { appeler, repondre, enAttente: () => attentes.size };
}
