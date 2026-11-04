/**
 * Les outils des workflows pour les agents : lister, lire, construire (créer ou modifier) et lancer
 * un workflow de la page Workflows. Les workflows vivent sur l'ordinateur de la personne (écran et
 * moteur, `src/lib/workspace.tsx`) : sur ce PC, `electron/ia.ts` relaie l'appel à l'écran ; sur un
 * VPS, `serveur/workflows.mjs` le relaie au PC par le journal, comme le navigateur. Les mêmes
 * définitions des deux côtés : module pur, généré pour le serveur par `scripts/serveur-genere.mjs`
 * (`serveur/workflows-outils.mjs`).
 *
 * `construire_workflow` s'écrit en direct : l'app lit son entrée pendant que le modèle l'écrit
 * (`input_json_delta`, cf. `electron/json-partiel.ts`) et la page Workflows montre chaque étape
 * posée, avant même l'appel.
 */

const workflow = { type: "string", description: "L'identifiant du workflow (lister_workflows)." };

export const OUTIL_LISTER_WORKFLOWS = {
  name: "lister_workflows",
  description:
    "Liste les workflows de la page Workflows de l'app : identifiant, titre, nombre d'étapes, projet et dernière exécution. Un workflow enchaîne des étapes (agents, appels au modèle, conditions, approbations, sorties) qu'un déclencheur lance.",
  inputSchema: { type: "object", properties: {} },
};

export const OUTIL_LIRE_WORKFLOW = {
  name: "lire_workflow",
  description:
    "Lit un workflow : ses étapes (identifiant, type, champs), ses liens, ce qui l'empêcherait de tourner, et sa dernière exécution (ou celle donnée) étape par étape, avec les résultats et les erreurs. Pour suivre une exécution lancée par lancer_workflow.",
  inputSchema: {
    type: "object",
    properties: {
      workflow,
      execution: { type: "string", description: "Facultatif : l'identifiant d'une exécution ; sinon la dernière." },
    },
    required: ["workflow"],
  },
};

const etape = {
  type: "object",
  properties: {
    id: { type: "string", description: "Identifiant court, en minuscules (ex. maquette) ; celui d'une étape existante la modifie." },
    type: {
      type: "string",
      enum: ["declencheur", "prompt", "ressource", "agent", "llm", "condition", "approbation", "sortie", "note"],
      description: "Obligatoire pour une nouvelle étape ; une étape existante garde le sien.",
    },
    nom: { type: "string", description: "Le titre de la carte (ex. « Maquette »)." },
    declencheur: { type: "string", enum: ["manuel", "planifie", "webhook"] },
    frequence: {
      type: "object",
      description: "Pour un déclencheur planifie : { type: heure | jour | jours-ouvres | semaine | mois, heure: \"09:00\", jour: 1-7 (semaine, 1 = lundi) ou 1-28 (mois) }.",
    },
    agent: { type: "string", description: "Étape agent : l'identifiant d'un agent actif (ex. dev), ou principal." },
    tache: { type: "string", description: "Étape agent : ce qu'il fait avec ce qu'il reçoit." },
    texte: { type: "string", description: "Prompt : le texte passé aux étapes suivantes. Note : son texte." },
    chemins: { type: "string", description: "Ressource : des chemins de fichiers, un par ligne." },
    prompt: { type: "string", description: "Étape llm : la demande." },
    systeme: { type: "string", description: "Étape llm : la consigne système, facultative." },
    modele: { type: "string", enum: ["haiku", "sonnet", "opus", "fable"] },
    regle: { type: "string", description: "Condition : quand prendre la branche oui." },
    question: { type: "string", description: "Approbation : ce que la personne valide." },
    cible: { type: "string", enum: ["notification", "conversation", "fichier"], description: "Sortie : où va le résultat." },
    titre: { type: "string", description: "Sortie : titre de la notification ou de la conversation." },
    chemin: { type: "string", description: "Sortie fichier : chemin absolu, « ~/… » ou relatif aux Documents." },
  },
  required: ["id"],
};

export const OUTIL_CONSTRUIRE_WORKFLOW = {
  name: "construire_workflow",
  description:
    "Crée un workflow (sans workflow) ou modifie celui donné, sur la page Workflows : la personne te voit le construire en direct, étape par étape. Écris les étapes dans l'ordre du flux, puis les liens. Une étape dont l'id existe est modifiée (seuls les champs donnés changent) ; sinon elle est ajoutée et placée seule sur le canevas. Une condition a deux sorties : ses liens portent branche oui ou non ; un lien vers une étape d'avant fait une boucle (5 tours au plus). Une approbation attend la personne, jamais toi. Un déclencheur planifie ou webhook part tout seul : seulement si la personne l'a demandé. Une version est gardée avant chaque modification. Ne lance rien : c'est lancer_workflow.",
  inputSchema: {
    type: "object",
    properties: {
      workflow: { type: "string", description: "Facultatif : l'identifiant du workflow à modifier ; sans lui, un nouveau workflow." },
      titre: { type: "string", description: "Le titre (obligatoire pour un nouveau workflow)." },
      projet: { type: "string", description: "Facultatif : l'identifiant du projet où ses agents travaillent." },
      etapes: { type: "array", items: etape, description: "Les étapes à ajouter ou modifier, dans l'ordre du flux." },
      liens: {
        type: "array",
        items: {
          type: "object",
          properties: { de: { type: "string" }, vers: { type: "string" }, branche: { type: "string", enum: ["oui", "non"] } },
          required: ["de", "vers"],
        },
        description: "Les liens à ajouter : la sortie de de entre dans vers.",
      },
      retirer: { type: "array", items: { type: "string" }, description: "Les étapes à retirer, avec leurs liens." },
      delier: {
        type: "array",
        items: { type: "object", properties: { de: { type: "string" }, vers: { type: "string" } }, required: ["de", "vers"] },
        description: "Les liens à retirer.",
      },
    },
  },
};

export const OUTIL_LANCER_WORKFLOW = {
  name: "lancer_workflow",
  description:
    "Lance un workflow, comme « Lancer le workflow » : la personne suit l'exécution en direct sur sa page. Rend tout de suite l'identifiant de l'exécution ; suis-la avec lire_workflow. Les étapes agent travaillent dans la conversation du workflow, une approbation attend la personne. Tu ne lances pas le workflow dans lequel tu travailles.",
  inputSchema: {
    type: "object",
    properties: {
      workflow,
      entree: { type: "string", description: "Facultatif : le texte que reçoit le déclencheur (comme le corps d'un webhook)." },
      declencheur: { type: "string", description: "Facultatif : l'id du déclencheur qui part ; sinon tout le workflow." },
    },
    required: ["workflow"],
  },
};

export const OUTILS_WORKFLOWS = [OUTIL_LISTER_WORKFLOWS, OUTIL_LIRE_WORKFLOW, OUTIL_CONSTRUIRE_WORKFLOW, OUTIL_LANCER_WORKFLOW];

/** Lire et construire ne lancent rien (une version est gardée) : libres en accès « projet ». Lancer suit la règle de l'accès. */
export const OUTILS_WORKFLOWS_LIBRES = [OUTIL_LISTER_WORKFLOWS.name, OUTIL_LIRE_WORKFLOW.name, OUTIL_CONSTRUIRE_WORKFLOW.name];

export function estOutilWorkflow(nom: string): boolean {
  return OUTILS_WORKFLOWS.some((o) => o.name === nom);
}
