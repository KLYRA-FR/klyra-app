/**
 * Le Coffre de KLYRA pour les agents du VPS. Le coffre est sur l'ordinateur de la personne
 * (electron/coffre.ts) : un outil `coffre_*` appelé ici part au PC par le journal des événements (type
 * `coffre`, comme le navigateur), le PC répond par `POST /klyra/v1/agent/coffre`. Une valeur ne passe
 * jamais par le journal, que tous les appareils reliés lisent :
 * - `coffre_enregistrer` : la valeur reste ici, en mémoire, le temps de l'appel ; le PC la lit une fois
 *   (`lire: true` sur la même route) et la range chez lui ;
 * - `coffre_ecrire_fichier` : le fichier est d'abord contrôlé ici (sous le dossier de klyra, hors des
 *   données du serveur, hors de Git…, `coffre-fichier.mjs`), puis le PC rend la valeur, écrite ici ; la
 *   réponse à l'agent ne la contient pas.
 * Sans app ouverte sur le PC, l'outil le dit tout de suite ; sans réponse, il abandonne au bout du délai.
 * Les outils, leurs textes et leurs règles sont ceux du PC (fichiers générés).
 */
import { randomUUID } from "node:crypto";
import { CONSIGNE_COFFRE, estOutilCoffre, OUTILS_COFFRE, OUTILS_COFFRE_LIBRES, texteDemande, texteEnregistre, texteListe } from "./coffre-definitions.mjs";
import { ecrireCible, verifierCible } from "./coffre-fichier.mjs";
import { lireDemandeSecret, normaliserVariable, validerValeur, VALEUR_MAX } from "./coffre-regles.mjs";

export { CONSIGNE_COFFRE, estOutilCoffre, OUTILS_COFFRE, OUTILS_COFFRE_LIBRES };

export const DELAI_COFFRE_MS = 60_000;

const texte = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

/**
 * @param {{ publier: (requestId: string, event: object, sessionId: string | null) => void, ecouteurs: () => number,
 *   home: string, donnees: string, delaiMs?: number, maintenant?: () => number }} options
 */
export function creerRelaisCoffre(options) {
  const delai = options.delaiMs ?? DELAI_COFFRE_MS;
  const maintenant = options.maintenant ?? Date.now;
  /** Les appels en attente du PC : ce qu'il faut faire de sa réponse, et la valeur à lui donner une fois. */
  const attentes = new Map();

  /** Le Coffre de ce serveur (coffre-serveur.mjs) : les outils y répondent, sans le PC et sans le journal. */
  async function appelerIci(appelant, nom, args) {
    const local = options.local;
    const entree = args && typeof args === "object" && !Array.isArray(args) ? args : {};
    try {
      switch (nom) {
        case "coffre_lister":
          return texte(texteListe(local.pourAgents(), []));
        case "coffre_demander": {
          const demande = lireDemandeSecret(entree);
          if (!demande) return texte("Donne un nom de variable en lettres, chiffres et _ (ex. STRIPE_SECRET_KEY).", true);
          if (!demande.raison) return texte("Dis en une phrase pourquoi tu en as besoin (raison).", true);
          return texte(texteDemande(demande, local.pourAgents().some((s) => s.variable === demande.variable)));
        }
        case "coffre_enregistrer":
          return texte(texteEnregistre(local.ajouter({ ...entree, agents: true }, { par: "agent", roleId: appelant.agent ?? "principal", chatId: appelant.conversation })));
        case "coffre_ecrire_fichier": {
          const cible = await verifierCible(entree, { racine: options.home, interdits: [options.donnees] });
          return texte(await ecrireCible(cible, local.valeurPourAgents(cible.variable)));
        }
        default:
          return texte("Outil inconnu.", true);
      }
    } catch (e) {
      return texte(e instanceof Error ? e.message : String(e), true);
    }
  }

  /** Appelle l'outil, ici ou par le PC ; rend toujours un résultat MCP (une erreur aussi). */
  async function appeler(appelant, nom, args) {
    if (!estOutilCoffre(nom)) return texte("Outil inconnu.", true);
    if (!appelant?.conversation) return texte("Conversation inconnue : le coffre ne s'utilise que depuis une conversation.", true);
    if (options.local) return appelerIci(appelant, nom, args);
    if (!options.ecouteurs()) return texte("L'app KLYRA n'est pas ouverte sur l'ordinateur de la personne : son coffre n'est pas joignable. Dis-lui de l'ouvrir, ou fais sans ce secret.", true);
    const entree = args && typeof args === "object" && !Array.isArray(args) ? { ...args } : {};
    let cible = null;
    let valeur = null;
    try {
      if (nom === "coffre_ecrire_fichier") cible = await verifierCible(entree, { racine: options.home, interdits: [options.donnees] });
      if (nom === "coffre_enregistrer") {
        normaliserVariable(entree.variable);
        valeur = validerValeur(entree.valeur);
        delete entree.valeur;
      }
    } catch (e) {
      return texte(e instanceof Error ? e.message : String(e), true);
    }
    const id = randomUUID();
    return new Promise((resoudre) => {
      const minuteur = setTimeout(() => {
        attentes.delete(id);
        resoudre(texte("L'ordinateur de la personne n'a pas répondu à temps (coffre de KLYRA).", true));
      }, delai);
      attentes.set(id, {
        valeur,
        cible,
        finir: (r) => {
          clearTimeout(minuteur);
          attentes.delete(id);
          resoudre(r);
        },
      });
      options.publier(id, { type: "coffre", id, nom, arguments: entree, agent: appelant.agent ?? "principal", conversation: appelant.conversation, expire: maintenant() + delai }, null);
    });
  }

  /** Le PC lit la valeur d'un secret qu'un agent range : une seule fois, pour un appel en attente. */
  function lireValeur(id) {
    const attente = typeof id === "string" ? attentes.get(id) : undefined;
    if (!attente || typeof attente.valeur !== "string") return null;
    const v = attente.valeur;
    attente.valeur = null;
    return v;
  }

  /**
   * La réponse du PC : `resultat` ({ texte, erreur }) et, pour un fichier, `valeur`, écrite ici.
   * Faux si l'appel n'attend plus (déjà répondu, expiré).
   */
  async function repondre(id, corps) {
    const attente = typeof id === "string" ? attentes.get(id) : undefined;
    if (!attente) return false;
    const r = corps?.resultat;
    const erreur = r?.erreur === true;
    if (attente.cible && !erreur) {
      const valeur = corps?.valeur;
      if (typeof valeur !== "string" || !valeur || valeur.length > VALEUR_MAX) {
        attente.finir(texte("Réponse illisible du coffre de l'ordinateur.", true));
        return true;
      }
      try {
        attente.finir(texte(await ecrireCible(attente.cible, valeur)));
      } catch (e) {
        attente.finir(texte(e instanceof Error ? e.message : String(e), true));
      }
      return true;
    }
    const t = typeof r?.texte === "string" && r.texte ? r.texte.slice(0, 20_000) : "Réponse illisible du coffre de l'ordinateur.";
    attente.finir(texte(t, erreur || typeof r?.texte !== "string"));
    return true;
  }

  return { appeler, repondre, lireValeur, enAttente: () => attentes.size };
}
