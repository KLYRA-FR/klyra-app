/**
 * Notes de version de l’app de bureau KLYRA, la plus récente d’abord.
 *
 * Une version = une publication de KLYRA-FR/klyra-app-versions (`publiee` : sa
 * date de publication, en UTC). Les notes sont écrites pour les personnes qui
 * utilisent l’app : ce qui change pour elles, sans chemin de code ni nom
 * interne. Le dépôt des versions est public : rien de confidentiel ici.
 *
 * Mise en forme permise dans un texte : **gras** et `code`.
 */

export type TypeGroupe = "nouveau" | "ameliore" | "retire" | "corrige";

export interface Version {
  version: string;
  publiee: string;
  /** Une phrase quand la version ne change rien de visible. */
  intro?: string;
  groupes: Partial<Record<TypeGroupe, string[]>>;
}

export const ORDRE_GROUPES: TypeGroupe[] = ["nouveau", "ameliore", "retire", "corrige"];

export const LIBELLES_GROUPES: Record<TypeGroupe, string> = {
  nouveau: "Nouveau",
  ameliore: "Amélioré",
  retire: "Retiré",
  corrige: "Corrigé",
};

export const DEPOT_VERSIONS = "https://github.com/KLYRA-FR/klyra-app-versions";
export const LIEN_TELECHARGER = `${DEPOT_VERSIONS}/releases/latest`;

/** L’annonce en tête de la landing : une version marquante, pas forcément la dernière. */
export const ANNONCE = { version: "0.1.65", texte: "Les tickets arrivent dans KLYRA" };

export const VERSIONS: Version[] = [
  {
    version: "0.1.67",
    publiee: "2026-11-02T15:12:27Z",
    groupes: {
      nouveau: [
        "L’app pour téléphone, en entier : chats et fil, recherche, planning et rappels, agents et leur fiche, projets et visionneuse, routines et workflows, artefacts et réglages. Elle s’installe depuis le navigateur et marche aussi sur tablette.",
        "Le téléphone demande à ton ordinateur ouvert de faire un geste (ouvrir un fichier, renommer, épingler…) et reçoit la réponse. Les pièces jointes passent par ton compte et sont effacées une fois écrites sur l’ordinateur.",
        "Quand ton ordinateur est fermé, une conversation qui tourne sur ton VPS part directement au VPS, en accès « demander ». À sa réouverture, l’ordinateur range l’échange dans la conversation.",
        "Les notifications sur le téléphone, et **Me prévenir à l’ouverture** quand ton ordinateur est fermé.",
      ],
      corrige: [
        "Un ordinateur qui ne répond plus passe « fermé » sur le téléphone au bout de 35 secondes. Avant, il pouvait rester affiché « ouvert ».",
      ],
    },
  },
  {
    version: "0.1.66",
    publiee: "2026-11-02T15:03:45Z",
    groupes: {
      nouveau: [
        "**Confier à un agent** depuis une ligne de rappel : un fil s’ouvre avec le rappel pour brief, son titre, sa priorité et son échéance. Le rappel affiche « Confié à … », avec un lien vers le fil.",
        "Fermer le fil coche le rappel. Supprimer le fil ne coche rien.",
        "Les onglets des fils portent une pastille : orange quand le ticket est bloqué, verte quand il attend ta validation.",
      ],
    },
  },
  {
    version: "0.1.65",
    publiee: "2026-11-02T14:37:42Z",
    groupes: {
      nouveau: [
        "Une page **Tickets** rassemble le travail confié aux agents, en tableau : À moi, À faire, En cours, Bloqué, À valider et Terminé. Terminé montre les 7 derniers jours, puis tout sur demande.",
        "Chaque carte montre l’agent, le projet, la priorité, l’échéance, la progression et la raison d’un blocage. **Valider et fermer** termine un ticket depuis sa carte.",
        "Filtrer les tickets par agent, par projet ou par origine.",
        "L’entrée Tickets du rail affiche le nombre de tickets qui attendent ta validation.",
      ],
    },
  },
  {
    version: "0.1.64",
    publiee: "2026-11-02T12:13:14Z",
    groupes: {
      ameliore: [
        "Les agents passent maintenant par un registre de moteurs, Claude Code en premier. C’est la base pour choisir bientôt ChatGPT, Grok ou OpenCode pour un agent ou une conversation. Rien ne change à l’écran : l’app lance Claude Code comme avant.",
      ],
    },
  },
  {
    version: "0.1.63",
    publiee: "2026-11-02T11:57:32Z",
    groupes: {
      ameliore: [
        "Chaque fil devient un ticket tenu par son agent, avec une étape (à faire, en cours, bloqué, à valider), une priorité, une échéance et un projet. L’étape suit la réponse de l’agent : elle passe en cours quand il répond, à valider quand il a fini, bloqué sur une erreur ou un arrêt.",
        "Rien ne change encore à l’écran : la page Tickets arrive dans une prochaine version.",
      ],
    },
  },
  {
    version: "0.1.62",
    publiee: "2026-11-02T11:06:23Z",
    groupes: {
      nouveau: [
        "**Réglages › Mobile** montre par où passe ton téléphone (ton compte, ce poste, puis l’agent, sur le poste ou sur le VPS relié) et l’état du poste tel que le téléphone le voit : ouvert, fermé depuis une heure donnée, ou hors ligne.",
        "Voir chaque téléphone ou navigateur connecté à ton compte, avec sa date de connexion et sa dernière visite, et le **Déconnecter** à distance. Les nouvelles sessions apparaissent sans recharger la page.",
        "Relier un téléphone avec l’adresse de l’app web et son QR code.",
      ],
      corrige: [
        "L’app ne lance plus un vieux Claude Code resté dans une extension d’éditeur. Sous Windows, elle trouve aussi le Claude Code installé par npm. Avant, le chat pouvait afficher « error: unknown option '--permission-prompts' ».",
        "Quand Claude Code refuse une option au lancement, l’app affiche un message clair qui nomme le programme utilisé, au lieu de sa sortie brute.",
      ],
    },
  },
  {
    version: "0.1.60",
    publiee: "2026-11-02T10:58:39Z",
    groupes: {
      ameliore: [
        "Le guide de l’écran Serveurs commence par expliquer comment se connecter au VPS : ouvrir un terminal (PowerShell sous Windows, Terminal sur Mac) et taper `ssh root@ADRESSE_DU_VPS`, avec un bouton Copier. Il prévient du « yes » de la première connexion et du mot de passe qui ne s’affiche pas.",
        "L’installation passe en étape 2, dans le même terminal, et le lien à coller en étape 3.",
      ],
    },
  },
  {
    version: "0.1.59",
    publiee: "2026-11-02T10:16:17Z",
    groupes: {
      corrige: [
        "Les anneaux d’utilisation de Claude, en bas du rail et dans Réglages › Claude, se remplissent de nouveau avec les versions récentes de Claude Code. Avant, ils restaient vides alors que le compte était connecté.",
        "Un événement de Claude Code sans chiffre n’efface plus la dernière utilisation connue.",
      ],
    },
  },
  {
    version: "0.1.58",
    publiee: "2026-11-02T10:11:06Z",
    groupes: {
      ameliore: [
        "La page Projets dit à quoi sert un projet : ouvrir un dossier de ton poste pour parcourir ton code et laisser les agents y travailler.",
        "L’écran vide explique les deux usages, parcourir ses fichiers comme dans un éditeur et écrire à un agent qui lit et modifie le code, et rappelle que les fichiers restent sur le poste : rien n’est déplacé ni copié.",
      ],
    },
  },
  {
    version: "0.1.57",
    publiee: "2026-11-02T10:06:20Z",
    groupes: {
      nouveau: [
        "Un sélecteur de serveur sous le logo du rail montre la machine active, ce poste ou un VPS relié, avec un point d’état : bleu s’il répond, rouge s’il ne répond pas, gris pendant la vérification.",
        "Son menu liste ce poste et chaque VPS relié, avec l’état de Claude Code, et permet d’ajouter un serveur, d’ouvrir ses réglages ou de retirer le serveur actif.",
      ],
      ameliore: [
        "Changer de machine fait passer tes conversations directes avec les agents sur la machine choisie. Les fils et les conversations de projet restent sur leur machine.",
        "Chaque conversation garde la session de ses agents sur chaque machine : un aller-retour entre le poste et le VPS ne fait plus perdre la mémoire de la conversation.",
        "Les nouveaux projets et les nouvelles routines prennent la machine active par défaut.",
      ],
    },
  },
  {
    version: "0.1.56",
    publiee: "2026-11-01T22:24:49Z",
    groupes: {
      nouveau: [
        "Une routine peut tourner sur le VPS, même quand ton ordinateur est éteint. Le formulaire propose la machine à la création, et les projets proposés sont ceux de cette machine.",
        "Exécuter, interrompre et l’historique d’une routine du VPS passent par le serveur. L’ordinateur l’affiche sans jamais la lancer lui-même.",
      ],
    },
  },
  {
    version: "0.1.55",
    publiee: "2026-11-01T22:10:47Z",
    groupes: {
      nouveau: [
        "Un projet peut vivre sur le VPS. À la création, choisis la machine : ce poste ou un VPS relié. Sur le VPS, le serveur crée le dossier d’après le nom du projet.",
        "L’arbre des fichiers et la visionneuse lisent les projets du VPS par le serveur, avec les mêmes règles que sur le poste.",
      ],
    },
  },
  {
    version: "0.1.54",
    publiee: "2026-11-01T22:08:08Z",
    groupes: {
      nouveau: [
        "Les agents peuvent tourner sur le VPS relié, et chaque conversation dit où ils travaillent. Les autorisations, les agents inactifs refusés et le niveau d’accès marchent comme sur le poste.",
        "La commande d’installation du serveur installe et connecte aussi Claude Code sur le VPS.",
      ],
    },
  },
  {
    version: "0.1.53",
    publiee: "2026-11-01T21:40:28Z",
    groupes: {
      nouveau: [
        "Relier un VPS de façon sûre : le serveur donne un code à usage unique valable 10 minutes, que l’app échange contre un jeton propre à l’appareil. Le jeton est chiffré sur le poste et n’apparaît jamais à l’écran.",
        "Retirer un appareil d’un VPS, ou tous les appareils d’un coup depuis le serveur.",
      ],
      retire: ["La page d’accueil du serveur ne montre plus le lien d’invitation."],
    },
  },
  {
    version: "0.1.52",
    publiee: "2026-11-01T21:35:54Z",
    intro: "Aucun changement dans l’app. Cette version accompagne le plan pour faire tourner les agents sur un VPS.",
    groupes: {},
  },
  {
    version: "0.1.51",
    publiee: "2026-11-01T21:02:29Z",
    groupes: {
      corrige: [
        "L’app de bureau joint de nouveau le VPS après l’ajout d’un serveur. L’appel part maintenant de l’app elle-même et non de sa fenêtre, ce qui évite les refus du navigateur intégré.",
      ],
    },
  },
  {
    version: "0.1.50",
    publiee: "2026-11-01T18:55:49Z",
    groupes: {
      nouveau: [
        "Lancer le serveur KLYRA sur un VPS Linux en une seule commande, sans compte administrateur. Elle installe ce qu’il faut, ouvre un tunnel sécurisé et affiche le lien à coller dans l’app. Relancer la commande garde la même invitation.",
      ],
      ameliore: [
        "L’écran Serveurs vide passe à deux étapes : coller la commande sur le VPS, puis coller ici le lien qu’elle affiche.",
      ],
    },
  },
  {
    version: "0.1.49",
    publiee: "2026-11-01T18:52:11Z",
    intro: "Correctif des vérifications automatiques de l’app. Rien ne change pour toi.",
    groupes: {},
  },
  {
    version: "0.1.48",
    publiee: "2026-11-01T18:39:57Z",
    groupes: {
      nouveau: [
        "Se connecter à Composio par le navigateur, avec ton compte, sans clé de projet. Les jetons sont chiffrés sur le poste et renouvelés avant leur expiration.",
      ],
      ameliore: [
        "Si Composio refuse le renouvellement, l’app te déconnecte et le dit clairement, au lieu de laisser les agents échouer.",
      ],
    },
  },
  {
    version: "0.1.47",
    publiee: "2026-11-01T18:32:54Z",
    groupes: {
      nouveau: [
        "Sans serveur ajouté, l’écran Serveurs n’est plus vide : il montre les gestes pour rejoindre un VPS, avec la commande à copier.",
      ],
    },
  },
  {
    version: "0.1.46",
    publiee: "2026-11-01T18:22:46Z",
    groupes: {
      nouveau: [
        "Coller la clé API de Composio directement dans la fenêtre de connexion. Importer un fichier de clé reste possible.",
        "Les logos officiels de Composio, GitHub, Linear, Supabase, Neon, Stripe et des apps connectées par Composio.",
      ],
      corrige: [
        "Fermer la fenêtre de choix de fichier sans rien choisir n’affiche plus « Composio est connecté ».",
      ],
    },
  },
  {
    version: "0.1.45",
    publiee: "2026-11-01T18:06:40Z",
    groupes: {
      nouveau: [
        "Une page **Marketplace**, ouverte depuis le rail, pour brancher des outils aux agents.",
        "Composio en une connexion : une carte, un bouton, puis la liste des apps branchées et de leur compte.",
        "GitHub, Linear, Supabase, Neon et Stripe en direct par leur serveur MCP officiel, avec un jeton. Une carte **Autre serveur MCP** accepte n’importe quel serveur HTTP. Les jetons sont chiffrés sur le poste et ne reviennent jamais à l’écran.",
      ],
      retire: ["La section Composio quitte les Réglages : tout se passe dans Marketplace."],
    },
  },
  {
    version: "0.1.44",
    publiee: "2026-11-01T16:19:45Z",
    groupes: {
      nouveau: [
        "Rejoindre un VPS depuis l’app de bureau, sous Windows et sur Mac : une nouvelle colonne **Serveurs**, avec le même geste que sur le téléphone.",
      ],
    },
  },
  {
    version: "0.1.43",
    publiee: "2026-11-01T10:43:45Z",
    groupes: {
      nouveau: [
        "Un calendrier commun à l’équipe dans l’Agenda : événements, participants et couleur de l’organisateur, à côté de tes routines.",
        "Chacun ne voit que les événements qu’il organise ou auxquels il participe. Les créneaux des autres restent invisibles.",
      ],
    },
  },
  {
    version: "0.1.42",
    publiee: "2026-10-31T12:58:16Z",
    groupes: {
      nouveau: [
        "Assigner un rappel à quelqu’un de l’équipe, sur le compte. Il passe en retard, notifie la personne et lui envoie un e-mail si son app est fermée.",
        "Chacun ne voit que les rappels qu’il a créés ou qu’on lui a assignés. Tes rappels locaux peuvent être importés sur le compte.",
      ],
    },
  },
  {
    version: "0.1.41",
    publiee: "2026-10-31T08:31:46Z",
    groupes: {
      nouveau: [
        "La visionneuse d’un projet met en forme les documents (Markdown, CSV, JSON, Word, Excel) et lit le code comme un éditeur, en lecture seule, avec la coloration et les numéros de ligne.",
        "Basculer entre l’aperçu et la source d’un document.",
      ],
      corrige: [
        "L’arbre des fichiers montre tous les dossiers d’un gros projet. Avant, la fin de la liste pouvait disparaître.",
      ],
    },
  },
  {
    version: "0.1.40",
    publiee: "2026-10-31T08:02:25Z",
    groupes: {
      ameliore: [
        "L’onglet Routines affiche les agents à gauche et, pour l’agent choisi, un canevas avec une carte par routine reliée à sa carte agent. Le formulaire et les exécutions tiennent dans un seul panneau à droite.",
        "Déplacer le fond, zoomer et garder sa place dans l’adresse de la page.",
      ],
    },
  },
  {
    version: "0.1.39",
    publiee: "2026-10-31T00:07:42Z",
    groupes: {
      nouveau: [
        "**Exporter en Markdown…** depuis le menu d’une conversation : équipe, directe ou fil. Le fichier garde le texte, les auteurs et les dates, et s’enregistre où tu veux. Rien n’est envoyé ailleurs.",
      ],
    },
  },
  {
    version: "0.1.38",
    publiee: "2026-10-30T23:13:24Z",
    groupes: {
      nouveau: [
        "Épingler une conversation d’équipe en haut du panneau Chats et de la liste du projet, au survol ou depuis le menu de son en-tête. Les épinglées sont classées par date de pose, puis viennent les autres par activité.",
      ],
    },
  },
  {
    version: "0.1.37",
    publiee: "2026-10-30T22:29:30Z",
    groupes: {
      nouveau: [
        "Supprimer un rappel affiche « Rappel supprimé — Annuler » pendant 8 secondes. Annuler rend le même rappel, à sa place, avec tous ses réglages. Plusieurs suppressions de suite reviennent ensemble.",
        "Le message se met en pause au survol ou quand la fenêtre est cachée. `Ctrl+Z` (`⌘Z` sur Mac) annule aussi dans le Planning.",
      ],
    },
  },
  {
    version: "0.1.36",
    publiee: "2026-10-30T21:22:55Z",
    groupes: {
      nouveau: [
        "Planifier un agent : une routine associe un agent actif, une consigne et un planning. Suis ses exécutions et ses résultats.",
        "Automatisations sépare maintenant les Routines et les Workflows.",
      ],
    },
  },
  {
    version: "0.1.35",
    publiee: "2026-10-30T20:59:19Z",
    groupes: {
      corrige: [
        "Déconnecter un compte Composio le retire aux agents tout de suite, même hors ligne. Si la déconnexion échoue côté Composio, l’app garde le compte, affiche l’erreur et propose de réessayer.",
      ],
    },
  },
  {
    version: "0.1.34",
    publiee: "2026-10-30T20:47:37Z",
    groupes: {
      nouveau: [
        "Un espace Composio dans les Réglages : connecter ses services, choisir le compte de chaque service et le déconnecter. Les agents utilisent toujours le compte choisi.",
      ],
      ameliore: [
        "Partout dans l’app, un agent est représenté par le visuel de sa fiche, à la taille de chaque emplacement. Il n’y a plus d’initiale.",
      ],
    },
  },
  {
    version: "0.1.32",
    publiee: "2026-10-30T19:22:11Z",
    groupes: {
      ameliore: [
        "Dans la barre Chats, chaque agent montre en petit l’illustration de sa fiche, avec sa couleur et ses formes, au lieu de son initiale.",
      ],
    },
  },
  {
    version: "0.1.31",
    publiee: "2026-10-30T18:46:05Z",
    groupes: {
      ameliore: [
        "Les 11 modèles d’agents KLYRA et l’assistant suivent de nouvelles règles de conduite : l’auteur vérifie lui-même son travail, la relecture ne vient que sur ta demande, et chacun ne confie du travail qu’aux agents actifs.",
      ],
      retire: [
        "Les circuits « Qui passe la main à qui » de Mes agents et des fiches. Ils étaient écrits à la main et ne suivaient pas les vrais agents.",
      ],
    },
  },
  {
    version: "0.1.29",
    publiee: "2026-10-30T17:20:11Z",
    groupes: {
      nouveau: [
        "Un nouveau profil démarre avec un seul assistant, que tu nommes. **Mes agents** ne contient que les agents que tu choisis, et l’assistant ne délègue qu’à eux.",
        "La **Bibliothèque KLYRA** : partager la définition d’un agent avec l’équipe, ajouter celle d’un collègue et recevoir ses nouvelles versions en proposition, jamais appliquées seules.",
        "Les 11 fiches KLYRA deviennent une collection facultative de la Bibliothèque, ajoutée une fiche à la fois.",
      ],
    },
  },
  {
    version: "0.1.28",
    publiee: "2026-10-30T15:34:05Z",
    groupes: {
      corrige: [
        "Les cartes Équipe affichent « Aucune conversation », « 1 conversation » ou « N conversations », sans ratio ni barre de progression trompeuse.",
      ],
    },
  },
  {
    version: "0.1.27",
    publiee: "2026-10-30T15:17:36Z",
    groupes: {
      nouveau: [
        "Reporter un rappel en un clic : **Dans 1 h**, **Demain matin** ou **Lundi**, avec la nouvelle échéance affichée avant le choix. Le rappel garde son contenu, sa catégorie et ses réglages.",
      ],
    },
  },
  {
    version: "0.1.26",
    publiee: "2026-10-30T13:46:53Z",
    groupes: {
      nouveau: [
        "Rechercher dans les conversations avec `⌘K` (`Ctrl+K` sous Windows) ou le bouton du rail. Un résultat ouvre la conversation sur le bon message, centré et surligné.",
        "Chercher partout, dans les agents, dans les projets ou dans la conversation ouverte. Échap referme la fenêtre sans changer de conversation.",
      ],
    },
  },
  {
    version: "0.1.25",
    publiee: "2026-10-30T12:24:53Z",
    groupes: {
      nouveau: [
        "Coller une capture d’écran dans le champ d’un chat avec `Ctrl+V` (`⌘V` sur Mac). Des fichiers copiés depuis le Finder ou l’Explorateur sont joints comme par un glisser-déposer.",
      ],
    },
  },
  {
    version: "0.1.24",
    publiee: "2026-10-30T11:16:11Z",
    groupes: {
      ameliore: [
        "Une même adresse reçoit au plus un lien de connexion par minute, et cinq par heure. L’écran affiche le temps à attendre avant d’en redemander un.",
      ],
    },
  },
  {
    version: "0.1.23",
    publiee: "2026-10-30T10:38:00Z",
    groupes: {
      ameliore: [
        "Une seule identité entre le profil de l’ordinateur et le compte d’équipe. Connecté, ton nom et ton rôle viennent du compte ; ta photo et tes réglages restent sur le poste.",
      ],
    },
  },
  {
    version: "0.1.22",
    publiee: "2026-10-30T10:04:05Z",
    groupes: {
      nouveau: [
        "Le « … » de l’en-tête d’une conversation d’équipe ouvre un menu : **Renommer** en place et **Ouvrir le projet**. Il se pilote entièrement au clavier.",
      ],
    },
  },
  {
    version: "0.1.21",
    publiee: "2026-10-30T08:10:09Z",
    groupes: {
      corrige: [
        "Sous Windows, les pièces jointes affichent leur nom (`résumé final.pdf`) et non leur chemin complet, dans le composeur, les messages, le panneau Fichiers et la visionneuse.",
      ],
    },
  },
  {
    version: "0.1.20",
    publiee: "2026-10-30T07:39:43Z",
    groupes: {
      nouveau: [
        "Chaque thème de sons devient une panoplie complète : un son pour le clic, l’ouverture, la fermeture et la sélection, sur toute l’app, en plus des événements.",
      ],
    },
  },
  {
    version: "0.1.19",
    publiee: "2026-10-29T23:16:35Z",
    groupes: {
      nouveau: [
        "Les comptes d’équipe : connexion par un lien envoyé par e-mail, valable 15 minutes et une seule fois. Sur invitation seulement.",
        "**Réglages › Équipe** : inviter, voir les membres et leurs rôles, admin ou membre. Retirer quelqu’un ferme ses sessions.",
      ],
    },
  },
  {
    version: "0.1.18",
    publiee: "2026-10-29T23:04:31Z",
    groupes: {
      nouveau: [
        "Des sons dans l’app, dans **Réglages › Notifications** : un son à la fin d’une tâche, et cinq thèmes pour les actions (Silence, Chaleureux, Mécanique, Pétillant, Clavier), avec un aperçu et le volume.",
      ],
    },
  },
  {
    version: "0.1.17",
    publiee: "2026-10-29T22:18:48Z",
    intro: "Préparation des comptes d’équipe. Rien ne change dans l’app.",
    groupes: {},
  },
  {
    version: "0.1.16",
    publiee: "2026-10-29T20:47:42Z",
    groupes: {
      nouveau: [
        "La dictée s’écrit en direct dans le champ pendant que tu parles : en gris d’abord, puis remplacée par le texte définitif.",
        "Le niveau sonore, la durée et le moteur utilisé s’affichent pendant l’écoute. Entrée ou Échap arrêtent la dictée sans envoyer.",
        "ElevenLabs Scribe si tu enregistres une clé dans **Réglages › Voix**, sinon Whisper sur l’ordinateur.",
      ],
    },
  },
  {
    version: "0.1.15",
    publiee: "2026-10-29T19:19:29Z",
    groupes: {
      ameliore: [
        "Première couche de Computer Use : capture d’écran, clavier et souris, coupés tant que l’interrupteur des Réglages est éteint. Aucun agent ne s’en sert encore.",
      ],
    },
  },
  {
    version: "0.1.14",
    publiee: "2026-10-29T19:09:58Z",
    groupes: {
      ameliore: [
        "Le Profil compte toute la consommation Claude Code de l’ordinateur, terminal et éditeur compris, sur un an, et plus seulement celle de l’app.",
        "Voir l’usage et le coût réels d’une organisation Claude avec une clé Admin, facultative et chiffrée.",
      ],
      corrige: [
        "Sur Mac, l’app garde ses autorisations du système d’une version à l’autre. Avant, chaque mise à jour les perdait.",
      ],
    },
  },
  {
    version: "0.1.12",
    publiee: "2026-10-29T17:42:47Z",
    groupes: {
      nouveau: [
        "Une pastille **Mettre à jour** apparaît dans le rail dès qu’une nouvelle version est prête. Un clic l’installe et relance l’app.",
        "**Réglages › Mises à jour** : version installée, dernière version disponible, progression du téléchargement et **Rechercher maintenant**.",
      ],
      ameliore: ["Des messages d’erreur clairs quand le dépôt des versions ne répond pas."],
    },
  },
  {
    version: "0.1.11",
    publiee: "2026-10-29T17:04:49Z",
    groupes: {
      nouveau: [
        "Ta consommation dans le Profil : jetons, jour record, messages, séries et une carte de chaleur de ton activité sur un an.",
        "Une entrée Computer Use dans les Réglages, coupée par défaut.",
      ],
      ameliore: [
        "Dans le Planning, la demi-heure sous la souris s’éclaire et affiche son heure. Un clic crée l’événement à ce créneau.",
      ],
      corrige: ["Le message commencé et ses pièces jointes restent dans leur conversation quand tu changes d’onglet."],
    },
  },
  {
    version: "0.1.8",
    publiee: "2026-10-29T16:54:10Z",
    groupes: {
      ameliore: [
        "Sous Windows, l’app parle de « ce PC » et de l’Explorateur, affiche les raccourcis Windows et des barres de défilement fines.",
      ],
    },
  },
  {
    version: "0.1.7",
    publiee: "2026-10-29T16:48:15Z",
    groupes: {
      nouveau: [
        "Les Réglages passent à une barre latérale, une section par entrée, avec **Rechercher dans les réglages…** en haut.",
      ],
      ameliore: [
        "Les listes déroulantes et les fenêtres sont celles de l’app, et non plus celles du système : même style partout, au clavier comme à la souris.",
      ],
    },
  },
  {
    version: "0.1.5",
    publiee: "2026-10-29T15:38:00Z",
    intro: "Première version publiée de l’app de bureau KLYRA, pour Mac et Windows.",
    groupes: {
      nouveau: [
        "Les agents répondent en direct dans les conversations, avec leurs étapes, les mentions @, une file d’attente et Stop.",
        "Les fils : une tâche, un fil, dans un onglet du chat de l’agent. Les agents ouvrent, lisent et relancent eux-mêmes leurs fils.",
        "Projets : ajouter un dossier, parcourir ses fichiers et prévisualiser le site du projet.",
        "Planning en jour, semaine et mois, rappels en catégories et « Ma journée » à l’accueil.",
        "Workflows en nœuds, avec déclencheurs, conditions, approbations et historique des exécutions.",
        "Autorisations des agents dans la conversation : Autoriser, Toujours ou Refuser, et un niveau d’accès au choix.",
        "Dictée transcrite sur l’ordinateur par Whisper, intégré à l’app.",
        "Mises à jour automatiques : l’app vérifie au démarrage puis toutes les heures, et s’installe quand tu la quittes.",
      ],
    },
  },
];
