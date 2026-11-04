import { ajouterSecret, ecrireSecretDansFichier, secretsPourAgents, valeurPourAgents } from "./coffre";
import { CONSIGNE_COFFRE, estOutilCoffre, OUTILS_COFFRE, OUTILS_COFFRE_LIBRES, texteDemande, texteEnregistre, texteListe } from "./coffre-definitions";
import { lireDemandeSecret, normaliserVariable } from "./coffre-regles";
import { readConversations } from "./conversations";
import { listerCoffre } from "./navigateur/coffre";

/**
 * Les outils du Coffre pour les agents de ce PC (serveur MCP de l'app, `ia.ts`) et pour ceux d'un VPS
 * relié, dont les appels arrivent par le journal (`agents-distants.ts`, `serveur/coffre.mjs`). Les
 * définitions et les textes sont communs (`coffre-definitions.ts`). Un agent ne voit jamais une valeur.
 */

export { CONSIGNE_COFFRE, estOutilCoffre, OUTILS_COFFRE, OUTILS_COFFRE_LIBRES };

export interface AppelantCoffre {
  chatId: string;
  roleId: string;
}

export interface ReponseCoffre {
  texte: string;
  erreur?: boolean;
}

const echec = (e: unknown): ReponseCoffre => ({ texte: e instanceof Error ? e.message : String(e), erreur: true });

/** Exécute un outil du Coffre ; le texte rendu à l'agent ne contient jamais de valeur. */
export async function executerOutilCoffre(nom: string, args: Record<string, unknown>, appelant: AppelantCoffre): Promise<ReponseCoffre> {
  try {
    switch (nom) {
      case "coffre_lister":
        return { texte: texteListe(secretsPourAgents(), listerCoffre().filter((c) => c.agents)) };
      case "coffre_demander": {
        const demande = lireDemandeSecret(args);
        if (!demande) return { texte: "Donne un nom de variable en lettres, chiffres et _ (ex. STRIPE_SECRET_KEY).", erreur: true };
        if (!demande.raison) return { texte: "Dis en une phrase pourquoi tu en as besoin (raison).", erreur: true };
        return { texte: texteDemande(demande, secretsPourAgents().some((s) => s.variable === demande.variable)) };
      }
      case "coffre_enregistrer": {
        const s = await ajouterSecret(
          { variable: args.variable, nom: args.nom, genre: args.genre, service: args.service, note: args.note, valeur: args.valeur, agents: true },
          { par: "agent", roleId: appelant.roleId, chatId: appelant.chatId },
        );
        return { texte: texteEnregistre(s) };
      }
      case "coffre_ecrire_fichier":
        normaliserVariable(args.variable);
        return { texte: await ecrireSecretDansFichier({ variable: args.variable, chemin: args.chemin, format: args.format }) };
      default:
        return { texte: "Outil inconnu.", erreur: true };
    }
  } catch (e) {
    return echec(e);
  }
}

/** Un appel d'outil du Coffre venu d'un agent d'un VPS (cf. serveur/coffre.mjs), vérifié par `appelCoffreDe`. */
export interface AppelCoffre {
  id: string;
  nom: string;
  arguments: Record<string, unknown>;
  agent: string;
  conversation: string;
}

/**
 * Un outil du Coffre appelé par un agent d'un VPS relié, pour une conversation de ce serveur seulement.
 * Le coffre est ici, le fichier là-bas :
 * - `coffre_enregistrer` : la valeur n'est pas dans le journal ; ce PC la demande au VPS (`lireValeur`,
 *   par la route authentifiée) et la range ici ;
 * - `coffre_ecrire_fichier` : le VPS a déjà contrôlé son fichier ; ce PC vérifie que le secret est permis
 *   aux agents et rend la valeur au VPS (`valeur`), qui l'écrit. Elle ne va jamais à l'agent.
 */
export async function executerCoffrePourServeur(origine: string, appel: AppelCoffre, lireValeur: () => Promise<string>): Promise<{ resultat: ReponseCoffre; valeur?: string }> {
  const donnees = (await readConversations().catch(() => null)) as { chats?: { id?: unknown; lieu?: unknown }[] } | null;
  const chat = donnees?.chats?.find((c) => c.id === appel.conversation);
  if (!chat || chat.lieu !== origine) return { resultat: { texte: "Cette conversation n’est pas une conversation de ce serveur sur l’ordinateur de la personne.", erreur: true } };
  const appelant = { chatId: appel.conversation, roleId: appel.agent };
  try {
    if (appel.nom === "coffre_ecrire_fichier") {
      const valeur = valeurPourAgents(appel.arguments.variable);
      return { resultat: { texte: "Valeur rendue au serveur." }, valeur };
    }
    if (appel.nom === "coffre_enregistrer") return { resultat: await executerOutilCoffre(appel.nom, { ...appel.arguments, valeur: await lireValeur() }, appelant) };
    if (appel.nom === "coffre_lister" || appel.nom === "coffre_demander") return { resultat: await executerOutilCoffre(appel.nom, appel.arguments, appelant) };
    return { resultat: { texte: "Outil inconnu.", erreur: true } };
  } catch (e) {
    return { resultat: echec(e) };
  }
}
