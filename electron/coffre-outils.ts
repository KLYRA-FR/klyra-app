import { ajouterSecret, ecrireSecretDansFichier, secretsPourAgents } from "./coffre";
import { FORMATS_FICHIER, GENRES_SECRET, lireDemandeSecret, normaliserVariable } from "./coffre-regles";
import { listerCoffre } from "./navigateur/coffre";

/**
 * Les outils du Coffre pour les agents (serveur MCP de l'app, `ia.ts`). Un agent ne voit jamais une
 * valeur : il liste les noms, demande un secret à la personne (une carte sécurisée dans la
 * conversation, `coffre_demander`), range ce qu'il a obtenu, et l'écrit dans un fichier hors de Git.
 */

const genre = { type: "string", enum: Object.keys(GENRES_SECRET), description: "cle-api, jeton, mot-de-passe ou autre." };
const variable = { type: "string", description: "Le nom de variable du secret, en MAJUSCULES (ex. STRIPE_SECRET_KEY)." };

export const OUTILS_COFFRE = [
  {
    name: "coffre_lister",
    description:
      "Liste ce que le coffre de la personne te permet d'utiliser : clés API, jetons et mots de passe (nom de variable et description, jamais la valeur) et les connexions de sites du navigateur (site et identifiant). Regarde-le avant de demander un secret.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "coffre_demander",
    description:
      "Demande à la personne un secret dont tu as besoin (clé API, jeton, mot de passe), parce que la tâche l'exige ou qu'elle te le propose. Une carte sécurisée s'affiche dans la conversation : elle y colle la valeur, qui va droit dans le coffre chiffré, sans passer par la conversation ni par toi. Termine ensuite ta réponse : elle te dira quand c'est rangé. Ne demande jamais un secret en clair dans la conversation.",
    inputSchema: {
      type: "object",
      properties: {
        variable,
        nom: { type: "string", description: "Ce que c'est, pour elle (ex. « Clé secrète Stripe, mode test »)." },
        genre,
        service: { type: "string", description: "Le site ou le service (ex. dashboard.stripe.com)." },
        raison: { type: "string", description: "Pourquoi tu en as besoin, en une phrase." },
        ou_trouver: { type: "string", description: "Où elle la trouve, si tu le sais (ex. Développeurs › Clés API)." },
      },
      required: ["variable", "nom", "raison"],
    },
  },
  {
    name: "coffre_enregistrer",
    description:
      "Range dans le coffre un secret que tu as obtenu ou créé (clé générée, jeton rendu par une commande, mot de passe créé pour la personne), plutôt que de le laisser dans un fichier ou la conversation. Un nom déjà pris est refusé : un secret du coffre n'est jamais écrasé par un agent.",
    inputSchema: {
      type: "object",
      properties: {
        variable,
        nom: { type: "string", description: "Ce que c'est, pour la personne." },
        genre,
        service: { type: "string", description: "Le site ou le service." },
        valeur: { type: "string", description: "La valeur du secret." },
        note: { type: "string", description: "Ce qu'il faut savoir (droits, expiration…), sans la valeur." },
      },
      required: ["variable", "nom", "valeur"],
    },
  },
  {
    name: "coffre_ecrire_fichier",
    description:
      "Écrit un secret du coffre dans un fichier de ce poste, sans que tu voies sa valeur. format « env » : ajoute ou remplace la ligne VARIABLE=valeur (ex. .env.local) ; « modele » : remplace chaque {{coffre:VARIABLE}} du fichier ; « brut » : un fichier qui ne contient que la valeur. Refusé dans un fichier suivi par Git (ajoute-le d'abord au .gitignore). Ensuite, lis la variable depuis ce fichier dans tes commandes, sans l'afficher.",
    inputSchema: {
      type: "object",
      properties: {
        variable,
        chemin: { type: "string", description: "Le chemin complet du fichier." },
        format: { type: "string", enum: FORMATS_FICHIER, description: "env (par défaut), modele ou brut." },
      },
      required: ["variable", "chemin"],
    },
  },
];

export const estOutilCoffre = (nom: string) => OUTILS_COFFRE.some((o) => o.name === nom);

/** Lister, demander et ranger ne demandent pas d'accord ; écrire dans un fichier suit l'accès de l'agent. */
export const OUTILS_COFFRE_LIBRES = ["coffre_lister", "coffre_demander", "coffre_enregistrer"];

/** La consigne : courte, elle pèse sur chaque appel. */
export const CONSIGNE_COFFRE =
  "Secrets (clés API, jetons, mots de passe) : jamais en clair dans la conversation ni dans un fichier suivi par Git. Regarde le coffre (coffre_lister) ; s'il te manque un secret, demande-le avec coffre_demander (la personne le colle dans une carte sécurisée) puis termine ta réponse ; range ce que tu obtiens avec coffre_enregistrer ; utilise-le par coffre_ecrire_fichier, sans jamais afficher sa valeur.";

export interface AppelantCoffre {
  chatId: string;
  roleId: string;
}

/** Exécute un outil du Coffre ; le texte rendu à l'agent ne contient jamais de valeur. */
export async function executerOutilCoffre(nom: string, args: Record<string, unknown>, appelant: AppelantCoffre): Promise<{ texte: string; erreur?: boolean }> {
  try {
    switch (nom) {
      case "coffre_lister": {
        const secrets = secretsPourAgents();
        const connexions = listerCoffre().filter((c) => c.agents);
        const lignes = [
          secrets.length ? "Secrets :" : "Aucun secret permis aux agents dans le coffre.",
          ...secrets.map((s) => `- ${s.variable} : ${s.nom} (${GENRES_SECRET[s.genre]}${s.service ? `, ${s.service}` : ""})${s.note ? ` — ${s.note}` : ""}`),
          connexions.length ? "Connexions de sites (navigateur_agir, action remplir_connexion) :" : "",
          ...connexions.map((c) => `- ${c.hote} : ${c.identifiant || "sans identifiant"}`),
        ].filter(Boolean);
        return { texte: lignes.join("\n") };
      }
      case "coffre_demander": {
        const demande = lireDemandeSecret(args);
        if (!demande) return { texte: "Donne un nom de variable en lettres, chiffres et _ (ex. STRIPE_SECRET_KEY).", erreur: true };
        if (!demande.raison) return { texte: "Dis en une phrase pourquoi tu en as besoin (raison).", erreur: true };
        const deja = secretsPourAgents().find((s) => s.variable === demande.variable);
        if (deja) return { texte: `${demande.variable} est déjà dans le coffre et t'est permis : utilise coffre_ecrire_fichier. La carte le dit aussi à la personne, qui peut le remplacer.` };
        return {
          texte: `Demande affichée dans la conversation : une carte sécurisée où la personne colle « ${demande.nom} » (${demande.variable}). Termine ta réponse maintenant, en une phrase ; elle te dira quand c'est rangé, et tu t'en serviras avec coffre_ecrire_fichier.`,
        };
      }
      case "coffre_enregistrer": {
        const s = await ajouterSecret(
          { variable: args.variable, nom: args.nom, genre: args.genre, service: args.service, note: args.note, valeur: args.valeur, agents: true },
          { par: "agent", roleId: appelant.roleId, chatId: appelant.chatId },
        );
        return { texte: `Rangé dans le coffre : ${s.variable} (« ${s.nom} »). Ne le recopie nulle part ailleurs ; supprime-le des fichiers où il traînait et utilise coffre_ecrire_fichier quand il le faut.` };
      }
      case "coffre_ecrire_fichier":
        normaliserVariable(args.variable);
        return { texte: await ecrireSecretDansFichier({ variable: args.variable, chemin: args.chemin, format: args.format }) };
      default:
        return { texte: "Outil inconnu.", erreur: true };
    }
  } catch (e) {
    return { texte: e instanceof Error ? e.message : String(e), erreur: true };
  }
}
