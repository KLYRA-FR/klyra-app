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
    version: "0.1.182",
    publiee: "2026-11-06T15:07:14Z",
    groupes: {
      nouveau: [
        "Sur le téléphone, la feuille du modèle montre aussi les comptes Claude connectés sur la machine de la conversation, avec leur adresse et leur abonnement. Le compte choisi vaut pour cette conversation, sur ton ordinateur comme sur ton VPS.",
      ],
    },
  },
  {
    version: "0.1.181",
    publiee: "2026-11-06T14:37:40Z",
    groupes: {
      corrige: [
        "La connexion à un compte Google passe dans le navigateur de KLYRA. Les sites voient un navigateur Chromium ordinaire, sans le nom de l’app.",
      ],
    },
  },
  {
    version: "0.1.180",
    publiee: "2026-11-06T14:15:23Z",
    groupes: {
      nouveau: [
        "Avec plusieurs comptes Claude connectés, le choix du modèle d’une conversation a une section **Compte** : celui de tes agents par défaut, ou un autre compte, gardé pour cette conversation. Ça marche aussi pour une conversation sur ton VPS.",
        "Changer de compte reprend la conversation là où elle en était. Les limites lues pendant l’échange vont à l’anneau de ce compte.",
      ],
    },
  },
  {
    version: "0.1.179",
    publiee: "2026-11-06T12:15:31Z",
    groupes: {
      nouveau: [
        "**Réglages › Navigateur › Où s’ouvrent les pages** : le navigateur intégré, ou le Google Chrome de ton poste, avec un profil KLYRA à part. Les agents y travaillent de la même façon.",
        "Pour te connecter à un site dans Chrome, l’app te l’ouvre sans pilotage : tu te connectes, l’agent attend, puis reprend avec ta session.",
      ],
    },
  },
  {
    version: "0.1.178",
    publiee: "2026-11-06T10:02:19Z",
    groupes: {
      nouveau: [
        "Les agents d’un VPS peuvent ouvrir des fils, comme ceux de ton ordinateur. Ordinateur fermé, le serveur tient lui-même les fils : il lance l’agent, met le ticket à jour et rapporte la réponse à la conversation qui l’a lancé.",
      ],
      corrige: [
        "Un agent confié en arrière-plan reste « Confié à » jusqu’à son vrai retour. Avant, il passait « Rendu par » dès son lancement.",
      ],
    },
  },
  {
    version: "0.1.177",
    publiee: "2026-11-06T09:48:03Z",
    groupes: {
      ameliore: [
        "Sur la page de connexion Google, un agent n’agit plus dans le navigateur de KLYRA : il te passe la main pour que tu te connectes toi-même.",
      ],
      corrige: [
        "Premier correctif de la connexion à Google dans le navigateur de KLYRA, qui la refusait.",
      ],
    },
  },
  {
    version: "0.1.176",
    publiee: "2026-11-06T09:09:02Z",
    groupes: {
      corrige: [
        "Une image collée ou un fichier joint dans une conversation sur un VPS part au serveur avant le message. Avant, l’agent recevait un chemin de ton ordinateur qu’il ne pouvait pas lire. Jusqu’à 10 fichiers et 20 Mo ; un envoi raté s’arrête en disant pourquoi.",
      ],
    },
  },
  {
    version: "0.1.175",
    publiee: "2026-11-06T08:23:36Z",
    intro: "Nouvelle page d’accueil pour le site de KLYRA. Rien ne change dans l’app.",
    groupes: {},
  },
  {
    version: "0.1.174",
    publiee: "2026-11-05T21:59:28Z",
    groupes: {
      nouveau: [
        "**Les cartes à remplir** : au lieu d’une liste de questions, un agent peut poser sous sa réponse une carte que tu remplis et envoies d’un clic. Un formulaire, une comparaison de pistes (pour, contre, celle qu’il recommande), une liste à valider, des créneaux ou un tableau à compléter avec ses totaux.",
        "Ce que tu envoies part comme ton message, lisible tel quel, et la carte se fige. Elle ne fait rien d’elle-même : elle sert seulement à répondre.",
        "Les créneaux proposés sont croisés avec ton planning, sur l’ordinateur comme sur le téléphone.",
        "**Créer une équipe** avec l’assistant : il compose plusieurs agents d’un coup avec toi, tu gardes, ajustes ou laisses de côté chacun, puis **Créer l’équipe** les ajoute tous. Depuis l’Accueil ou le menu « Créer un agent ».",
        "Les cartes et l’atelier d’une équipe marchent aussi sur un VPS et sur le téléphone.",
      ],
    },
  },
  {
    version: "0.1.173",
    publiee: "2026-11-05T21:14:44Z",
    groupes: {
      nouveau: [
        "Un anneau d’utilisation de plus dans le rail pour chaque compte Claude supplémentaire, avec son adresse au survol. Ses limites se relisent au clic.",
        "Les réglages d’un VPS listent aussi ses comptes Claude : ajouter, vérifier, déconnecter. La page de connexion s’ouvre sur ton ordinateur et tu colles dans l’app le code affiché à la fin.",
      ],
    },
  },
  {
    version: "0.1.172",
    publiee: "2026-11-05T18:16:55Z",
    groupes: {
      nouveau: [
        "**Réglages › Claude** : connecter plusieurs comptes Claude sur ton poste, sans déconnecter les autres. Chaque compte montre son état, son abonnement et sa facturation. Tes agents gardent le compte qu’ils utilisent déjà.",
      ],
    },
  },
  {
    version: "0.1.171",
    publiee: "2026-11-05T17:29:54Z",
    groupes: {
      ameliore: [
        "Sur le téléphone, le composeur d’un fil est plus simple : plus de puce de serveur ni de bandeau, seulement « Écris à … » et le choix du modèle.",
        "La feuille du modèle reprend celle de l’ordinateur : les fournisseurs installés, puis leurs modèles et niveaux d’effort. Le choix vaut pour ce fil et part avec le prochain message.",
      ],
    },
  },
  {
    version: "0.1.169",
    publiee: "2026-11-05T16:17:44Z",
    groupes: {
      corrige: [
        "La poignée élargit de nouveau le panneau d’aperçu. Avant, il restait bloqué à sa largeur minimale.",
      ],
    },
  },
  {
    version: "0.1.168",
    publiee: "2026-11-05T14:51:24Z",
    groupes: {
      nouveau: [
        "Une image collée montre sa vignette avant l’envoi, avec son nom et son poids. Dans le fil, un clic l’ouvre en grand dans le panneau de droite.",
        "Coller une image marche aussi depuis l’Accueil.",
      ],
    },
  },
  {
    version: "0.1.167",
    publiee: "2026-11-05T14:42:09Z",
    groupes: {
      ameliore: [
        "Sur le téléphone, l’agent et le modèle s’affichent au bas du fil, et le bouton Retour revient toujours à la bonne page.",
        "Sur le téléphone, un message simple à un agent du VPS part directement au VPS, même ordinateur ouvert.",
      ],
      corrige: [
        "Deux appareils ouverts sur le même VPS ne se réécrivent plus l’un l’autre. **Repartir à zéro** tient aussi d’un appareil à l’autre.",
        "Un bloc de code aux longues lignes ne fait plus déborder la bulle quand la conversation est étroite : il défile dans son cadre.",
      ],
    },
  },
  {
    version: "0.1.163",
    publiee: "2026-11-05T13:52:25Z",
    groupes: {
      ameliore: [
        "Sur le téléphone, **Plus**, **Réglages** et **Serveurs** sont redessinés : la carte de ton ordinateur, les réglages par groupes avec leur recherche, le serveur affiché choisi en un geste.",
        "Sur un VPS, un réglage qui demande ton ordinateur reste grisé et dit pourquoi.",
      ],
    },
  },
  {
    version: "0.1.162",
    publiee: "2026-11-05T13:12:55Z",
    groupes: {
      ameliore: [
        "Sur le téléphone, **Automatisations** et **Artefacts** sont redessinés. L’aperçu d’un artefact occupe toute la page.",
        "Routines, workflows et artefacts suivent le serveur choisi sur le téléphone.",
      ],
    },
  },
  {
    version: "0.1.161",
    publiee: "2026-11-05T12:53:43Z",
    groupes: {
      ameliore: [
        "Sur le téléphone, les **Projets** sont redessinés, avec la fiche du projet et ses travaux en cours. Ils suivent le serveur choisi.",
      ],
    },
  },
  {
    version: "0.1.160",
    publiee: "2026-11-05T12:19:36Z",
    groupes: {
      ameliore: [
        "Sur le téléphone, les **Agents** sont redessinés : cartes à la couleur de chaque agent, fiche, menu avec actions rapides (Écrire, Nouveau fil, Épingler, Sourdine), souvenirs, compétences et utilisation en lecture.",
        "Quand ton ordinateur est fermé, une action qui en a besoin reste grisée et dit pourquoi.",
      ],
    },
  },
  {
    version: "0.1.159",
    publiee: "2026-11-05T12:06:38Z",
    groupes: {
      nouveau: [
        "**Plus › Serveurs** sur le téléphone choisit le serveur affiché, pour ce téléphone seulement. Chats, recherche, projets, routines, workflows et agents suivent. Rappels et calendrier restent communs.",
      ],
    },
  },
  {
    version: "0.1.158",
    publiee: "2026-11-05T11:59:03Z",
    groupes: {
      nouveau: [
        "Les workflows d’un VPS tournent sur le serveur, même ordinateur éteint, planifiés ou lancés par un webhook. L’app suit leur avancée en direct. Un serveur pas encore à jour les laisse tourner dans l’app, et la page le dit.",
        "**Tickets** sur le téléphone : la liste, le détail et la validation. La notification de fin de réponse ouvre le ticket à valider.",
        "Sur le téléphone, confier un rappel à un agent depuis son menu ou sa fiche.",
      ],
    },
  },
  {
    version: "0.1.156",
    publiee: "2026-11-05T11:50:06Z",
    groupes: {
      ameliore: [
        "Ton ordinateur fermé, le VPS range lui-même la réponse d’un agent dans la conversation. N’importe quel appareil la retrouve, même plus de 24 heures après. Si l’app revient à temps, elle reprend la réponse complète.",
        "Ton message part sur le serveur dès l’envoi.",
      ],
      corrige: [
        "La conversation directe avec un agent d’un VPS est acceptée par le téléphone et reprend bien sa session.",
      ],
    },
  },
  {
    version: "0.1.155",
    publiee: "2026-11-05T11:35:39Z",
    groupes: {
      nouveau: [
        "**Chaque serveur a son équipe** : le VPS garde ses fiches d’agents et leurs préférences, et l’écran Agents montre l’équipe du serveur affiché. Un serveur neuf reçoit une fois une copie de tes agents actifs, puis plus rien n’est écrasé. **Copier vers …** copie un agent sur un autre serveur.",
        "**Chaque serveur garde son espace** : conversations, messages, tickets, projets, workflows et livrables restent sur le serveur où ils sont nés. Un second appareil les retrouve, et ton ordinateur en garde une copie : un serveur qui ne répond pas ne fait rien perdre.",
        "**Chaque serveur a son Coffre** : ses agents se servent de ses secrets sans ton ordinateur et n’en voient jamais la valeur. Un secret de ton ordinateur n’y arrive que copié un par un, à ta demande.",
        "**Chaque serveur a son compte Composio** : la connexion se fait sur ton ordinateur, sans rien y garder, puis le serveur garde ses accès chiffrés et ses agents s’en servent seuls.",
        "Les réglages des agents (accès, configuration KLYRA, compétences par agent) suivent le serveur affiché. Computer Use et le Navigateur disent qu’ils agissent sur cet ordinateur.",
        "L’app te prévient quand le code d’un VPS a du retard sur elle, avec la commande à relancer sur le serveur.",
      ],
      corrige: [
        "Après une mise à jour du serveur, l’app lui renvoie l’équipe sans attendre d’être relancée. Avant, le Coffre pouvait manquer aux agents du VPS jusqu’au redémarrage de l’app.",
        "Réglages › Agents d’un VPS montre les réglages qu’il applique vraiment, plus ceux par défaut.",
        "L’installation d’un serveur télécharge tous les fichiers dont il a besoin.",
      ],
    },
  },
  {
    version: "0.1.154",
    publiee: "2026-11-05T11:06:11Z",
    groupes: {
      ameliore: [
        "Sur le téléphone, **Chats** commence par ta journée, les agents au travail et ce qui est à traiter, puis tes conversations. Supprimer un fil laisse quelques secondes pour annuler.",
        "Le fil et le composeur du téléphone sont refaits : répondre en citant un message, réactions, conseil quand la conversation devient lourde, compétences avec « / », accords à donner. Renommer et choisir le modèle suivent la même mise en page.",
        "Le **Planning** du téléphone sépare ce qui vient de ton compte et de ton ordinateur tant que ce dernier n’a pas répondu : jamais « Tout est fait » sans toutes les sources. Menu d’un rappel, notifications et fiches en lignes.",
      ],
      corrige: [
        "Hors ligne, le téléphone ne dit plus qu’un accord a expiré ou qu’il est en cours.",
      ],
    },
  },
  {
    version: "0.1.153",
    publiee: "2026-11-05T10:59:59Z",
    groupes: {
      ameliore: [
        "**Chaque serveur a ses tickets** : le tableau, le nombre « à valider » du rail, les projets et les chiffres de Mes agents suivent le serveur affiché. Rappels, calendrier et « À moi » restent communs : ils sont à toi.",
        "**Chaque serveur a ses workflows** : la page et les agents ne voient que ceux du serveur où ils ont été créés, et leur travail reste sur ce serveur.",
      ],
    },
  },
  {
    version: "0.1.152",
    publiee: "2026-11-05T10:51:56Z",
    groupes: {
      nouveau: [
        "**Repartir à zéro** dans le chat d’un agent, aussi dans le menu « … » : les messages restent lisibles au-dessus d’un séparateur, l’agent ne les relit plus. Les fils gardent **Nouveau fil**.",
      ],
      corrige: [
        "Après **Repartir à zéro** ou **Effacer et repartir**, l’agent ne reprend plus son ancienne session, sur ton ordinateur comme sur un VPS, et le conseil mis de côté avec « Plus tard » repart lui aussi.",
      ],
    },
  },
  {
    version: "0.1.151",
    publiee: "2026-11-05T10:42:05Z",
    groupes: {
      corrige: [
        "L’anneau d’utilisation de Grok lit de nouveau les crédits du mois. Avant, il restait vide.",
      ],
    },
  },
  {
    version: "0.1.150",
    publiee: "2026-11-05T08:42:48Z",
    intro: "Fin du retrait du circuit GitHub côté serveur. Rien ne change pour toi.",
    groupes: {},
  },
  {
    version: "0.1.149",
    publiee: "2026-11-05T07:59:49Z",
    groupes: {
      retire: [
        "Le circuit GitHub de l’écran d’un projet est retiré : l’app ne prend plus de tickets GitHub pour ouvrir des pull requests.",
      ],
    },
  },
  {
    version: "0.1.147",
    publiee: "2026-11-04T22:44:11Z",
    groupes: {
      nouveau: [
        "Sur l’écran d’un projet relié à GitHub, un circuit à activer : ton poste prend les tickets marqués prêts, les confie à un agent dans un fil à part, puis ouvre la pull request. L’agent n’a aucun accès à GitHub et rien n’est fusionné sans toi. Sur ton ordinateur seulement.",
      ],
    },
  },
  {
    version: "0.1.146",
    publiee: "2026-11-04T22:38:09Z",
    intro: "Préparation d’un circuit entre les tickets GitHub et les agents. Rien ne change dans l’app.",
    groupes: {},
  },
  {
    version: "0.1.145",
    publiee: "2026-11-04T22:16:45Z",
    intro: "Préparation des accès des agents aux dépôts GitHub. Rien ne change dans l’app.",
    groupes: {},
  },
  {
    version: "0.1.143",
    publiee: "2026-11-04T21:16:27Z",
    groupes: {
      nouveau: [
        "Sur le téléphone, regarde un agent construire un workflow en direct : un bandeau à sa couleur, ses étapes qui arrivent une à une, celle qu’il écrit mise en avant. Le workflow apparaît en tête de la liste avant même d’exister, en lecture seule tant qu’il écrit.",
      ],
    },
  },
  {
    version: "0.1.142",
    publiee: "2026-11-04T20:41:41Z",
    groupes: {
      nouveau: [
        "Un **Coffre** dans les Réglages, sous Agents : tes clés API, jetons et mots de passe, chiffrés par le trousseau du système, avec les connexions de sites du Navigateur au même endroit. **Copier** passe par le presse-papiers, qui se vide après 30 secondes.",
        "Un agent peut te demander un secret : une carte sécurisée s’ouvre dans la conversation, tu y colles la valeur, et l’agent ne reçoit que son nom. Il peut aussi l’écrire dans un fichier de configuration de ton projet, avec ton accord, jamais dans un fichier suivi par Git.",
        "Les agents d’un VPS se servent aussi du Coffre de ton ordinateur, sans jamais voir une valeur.",
      ],
    },
  },
  {
    version: "0.1.141",
    publiee: "2026-11-04T19:50:30Z",
    groupes: {
      nouveau: [
        "Les agents construisent, modifient et lancent tes workflows. La page Workflows s’ouvre sur le chantier : les étapes arrivent en pointillés à la couleur de l’agent, les liens se tracent, la vue suit. Pendant une exécution, l’étape en cours et ce qu’écrit son agent s’affichent, et l’historique dit qui l’a lancée.",
        "Un anneau d’utilisation pour l’abonnement Grok, avec les crédits du mois.",
        "Une règle des largeurs au-dessus de l’aperçu d’une page : paliers d’écran et largeur réelle, mise à jour quand tu élargis le panneau ou passes en vue téléphone.",
      ],
      corrige: [
        "Une étape d’agent d’un workflow part de nouveau quand un agent vient de répondre juste avant.",
      ],
    },
  },
  {
    version: "0.1.138",
    publiee: "2026-11-04T18:24:22Z",
    groupes: {
      ameliore: [
        "L’app du téléphone a une nouvelle base : grand titre qui passe dans la barre, barre d’onglets refaite, transitions entre les pages (un simple fondu si tu réduis les animations), feuilles qu’on fait glisser vers le bas, listes et cartes au style du bureau, une seule annonce à la fois, appui long et tirer pour relire.",
        "Champs et interrupteurs plus contrastés sur le téléphone, pour mieux se lire.",
      ],
    },
  },
  {
    version: "0.1.137",
    publiee: "2026-11-04T17:50:02Z",
    groupes: {
      nouveau: [
        "**Grok** fait travailler les agents, par ton abonnement xAI, à côté de Claude et ChatGPT. Il se connecte sur ton ordinateur ou sur un VPS (par un code), ou avec une clé de console en repli.",
        "Le rail montre un anneau d’utilisation par fournisseur connecté, Claude et ChatGPT, pour le serveur affiché.",
      ],
    },
  },
  {
    version: "0.1.136",
    publiee: "2026-11-04T17:43:45Z",
    groupes: {
      nouveau: [
        "Une page HTML partagée à l’équipe s’ouvre dans une fenêtre isolée, sans accès au réseau, avec sa vignette dessinée dans l’app.",
      ],
      ameliore: [
        "Le Navigateur s’ouvre dans le panneau de la conversation, plus en plein écran : la conversation reste visible à côté, et tu élargis le panneau à la poignée.",
      ],
      corrige: [
        "Échap tapé dans le message ne ferme plus la page du Navigateur.",
        "L’en-tête du panneau d’un agent s’aligne sur celui des fils.",
        "Sur le téléphone : « Aucun ordinateur relié » au lieu de « fermé » quand il n’y en a pas, la dernière vue gardée en lecture seule quand ton ordinateur est fermé, plus d’identifiant interne à l’écran, un retour qui fait comme celui du système, l’onglet de la page reste allumé et des boutons plus faciles à toucher.",
        "Sur le téléphone, les rappels de ton compte s’affichent sans catégories vides quand ton ordinateur est fermé, et l’agenda ne montre qu’un seul bandeau « Vus à ».",
      ],
    },
  },
  {
    version: "0.1.132",
    publiee: "2026-11-04T14:40:52Z",
    groupes: {
      corrige: [
        "Tu restes connecté à ton compte d’équipe après une mise à jour. Avant, une seule écriture ratée de ta session (fichier tenu un instant par un antivirus, disque plein…) bloquait les suivantes, et l’app pouvait se retrouver déconnectée au lancement suivant.",
        "Une session que le trousseau du système ne sait pas relire n’efface plus les autres, et un trousseau pas encore prêt au démarrage ne fait plus croire qu’aucune session n’existe.",
        "En fermant l’app, elle attend que ta session soit bien enregistrée.",
      ],
    },
  },
  {
    version: "0.1.131",
    publiee: "2026-11-04T14:23:06Z",
    groupes: {
      nouveau: [
        "**Partager à l’équipe** une page HTML depuis Artefacts : elle apparaît dans l’onglet Équipe. **Ne plus partager** la retire.",
      ],
      ameliore: [
        "Mes artefacts et le panneau d’une conversation ne montrent que les livrables de l’espace choisi, ce poste ou un VPS.",
        "Un livrable d’un agent du VPS reste sur le serveur : il n’est plus recopié sur ton poste.",
        "Partager deux fois la même page ne crée plus deux cartes : la seconde remplace la première. Un autre membre qui la partage crée sa propre carte, sans reprendre la tienne.",
      ],
      corrige: [
        "La confirmation de « Ne plus partager » ne se replie plus mot à mot dans la carte : le texte est au-dessus, les deux boutons en dessous.",
      ],
    },
  },
  {
    version: "0.1.130",
    publiee: "2026-11-04T13:37:56Z",
    groupes: {
      corrige: [
        "**Nouveau fil** depuis une conversation sur un VPS ouvre le fil sur ce même serveur. Avant, il partait sur ce poste et l’app affichait « Cette conversation est sur Ce PC, pas sur le serveur affiché ».",
      ],
    },
  },
  {
    version: "0.1.129",
    publiee: "2026-11-04T12:57:30Z",
    intro: "Préparation du partage des pages HTML avec l’équipe. Rien ne change encore dans l’app.",
    groupes: {},
  },
  {
    version: "0.1.128",
    publiee: "2026-11-04T12:01:50Z",
    groupes: {
      corrige: [
        "L’adresse du téléphone (et son QR code) ne reste plus morte quand l’app web de ton poste s’arrête : elle est relancée toute seule, sans changer d’adresse.",
      ],
    },
  },
  {
    version: "0.1.127",
    publiee: "2026-11-04T11:55:44Z",
    groupes: {
      nouveau: [
        "Les agents peuvent lire le code d’un de tes artefacts claude.ai : l’app l’ouvre avec ta connexion à claude.ai et le leur donne à lire.",
      ],
    },
  },
  {
    version: "0.1.126",
    publiee: "2026-11-04T11:32:32Z",
    groupes: {
      corrige: [
        "Le lien **Voir le changelog** des Réglages, sur l’ordinateur comme sur le téléphone, ouvre le site publié.",
      ],
    },
  },
  {
    version: "0.1.125",
    publiee: "2026-11-04T11:06:17Z",
    groupes: {
      ameliore: [
        "Un agent appelé par un autre ne voit que ses propres compétences, celles que tu as allumées pour lui, et plus celles de l’agent qui l’a appelé.",
      ],
    },
  },
  {
    version: "0.1.124",
    publiee: "2026-11-04T10:44:21Z",
    groupes: {
      nouveau: [
        "Glisser un agent dans la barre des chats a maintenant du mouvement : la ligne se soulève et suit le pointeur, les autres s’écartent pour lui faire place, puis elle se pose. **Échap** annule. Alt + ↑/↓ fait de même au clavier.",
      ],
      ameliore: [
        "Partager un artefact avec l’équipe passe par une fenêtre de confirmation, au lieu d’un texte serré dans la carte.",
        "Les routines suivent l’ordre des agents que tu as choisi dans la barre des chats.",
        "Avec ChatGPT, chaque agent ne reçoit que les compétences allumées pour lui.",
      ],
    },
  },
  {
    version: "0.1.120",
    publiee: "2026-11-04T10:13:19Z",
    groupes: {
      ameliore: [
        "Les compétences allumées pour au moins un agent partent sur ton VPS avec l’équipe : ses agents les utilisent comme sur ton poste. Une compétence éteinte pour tout le monde ne part pas, et rien n’est supprimé.",
      ],
    },
  },
  {
    version: "0.1.119",
    publiee: "2026-11-04T09:47:58Z",
    groupes: {
      corrige: [
        "Sur Mac, les agents répondaient « Not logged in » alors que Claude était connecté. C’est réparé.",
        "Les agents peuvent relire les livrables publiés dans Artefacts.",
      ],
    },
  },
  {
    version: "0.1.118",
    publiee: "2026-11-04T09:19:05Z",
    groupes: {
      nouveau: [
        "Réglages › Agents : importer un dossier de compétences, ou reprendre avec **Importer depuis le poste** celles ajoutées depuis à Claude Code. Une compétence importée reste éteinte tant que tu ne l’allumes pas, et aucune n’est écrasée.",
      ],
      ameliore: [
        "Les fiches de tes agents et tes compétences sont gardées dans le dossier de KLYRA. L’éditeur n’écrit plus dans le dossier de Claude Code de ton poste, et rien n’y est supprimé.",
        "Les plugins que tu as activés dans Claude Code se chargent aussi pour les agents de l’app.",
      ],
    },
  },
  {
    version: "0.1.117",
    publiee: "2026-11-04T08:23:59Z",
    groupes: {
      ameliore: [
        "Claude Code, lancé par l’app, ne voit que tes agents actifs et les compétences que tu as allumées. Ta configuration de Claude Code sur le poste n’est ni modifiée ni vidée.",
      ],
    },
  },
  {
    version: "0.1.116",
    publiee: "2026-11-04T08:10:22Z",
    groupes: {
      nouveau: [
        "Quand un agent pilote ton ordinateur, le panneau **Navigateur** montre la fenêtre qu’il utilise : une seule fenêtre, jamais l’écran entier.",
      ],
      ameliore: [
        "Le pilotage de l’ordinateur ouvre ton navigateur habituel (Chrome, Edge, Firefox, Safari ou Brave) dans une nouvelle fenêtre, avec ton profil, sans y toucher.",
      ],
    },
  },
  {
    version: "0.1.115",
    publiee: "2026-11-04T07:52:10Z",
    groupes: {
      ameliore: [
        "Un clic sur une vignette du navigateur ouvre la page en grand. **Échap** ou **Retour** ramène aux vignettes.",
      ],
    },
  },
  {
    version: "0.1.114",
    publiee: "2026-11-04T07:38:25Z",
    groupes: {
      nouveau: [
        "Choisir les compétences de chaque agent dans Réglages › Agents : un agent ne reçoit que celles allumées pour lui.",
        "Tes agents actuels gardent les compétences qu’ils avaient. Une nouvelle compétence, ou un nouvel agent, n’en reçoit pas tant que tu ne l’allumes pas.",
      ],
    },
  },
  {
    version: "0.1.113",
    publiee: "2026-11-04T06:47:32Z",
    groupes: {
      nouveau: [
        "Le **Navigateur de KLYRA** : un onglet Navigateur dans le panneau de chaque conversation. Tes agents ouvrent de vraies pages web, les lisent, cliquent et tapent, et tu les vois faire en direct.",
        "**Prendre la main** à tout moment, puis la rendre. Un agent ne tape jamais de mot de passe, de code ni de numéro de carte : il te passe la main pour te connecter.",
        "Un coffre de mots de passe pour tes sites, chiffré sur ton poste : **Remplir** pose la connexion dans la page, et un agent autorisé peut la remplir sans jamais voir le mot de passe.",
        "Les agents envoient aussi des fichiers dans une page, lisent les cadres intégrés, et le clic droit dans une page ouvre le menu de l’app.",
        "Les agents de ton VPS utilisent le navigateur de ton poste, quand l’app y est ouverte.",
        "Réglages › Navigateur : couper les outils du navigateur pour les agents, et effacer les données de navigation.",
      ],
    },
  },
  {
    version: "0.1.112",
    publiee: "2026-11-04T06:30:22Z",
    groupes: {
      nouveau: [
        "L’atelier d’un agent sur le téléphone : la carte de l’agent s’affiche dans la conversation, et tu peux choisir sa couleur, lancer son épreuve, ajouter la correction proposée et le créer, ordinateur ouvert.",
        "Les réponses toutes prêtes de l’assistant se touchent aussi depuis le téléphone.",
      ],
    },
  },
  {
    version: "0.1.111",
    publiee: "2026-11-03T23:18:04Z",
    groupes: {
      nouveau: [
        "Créer un agent en parlant avec l’assistant : il te pose une question à la fois, avec des réponses toutes prêtes à cliquer, et la carte de l’agent se remplit dans la conversation pendant qu’il écrit (visuel, cinq piliers, poids de la fiche, fiche au verso, couleur).",
        "L’épreuve : trois demandes (une normale, une floue, une hors de son métier) auxquelles l’agent répond pour de vrai, jugées une à une. Si c’est raté, la phrase qui manque est proposée : **Ajouter à sa fiche et rejouer**.",
        "**Créer l’agent** l’ajoute à Mes agents, actif, avec une petite animation jusqu’à la barre. Ensuite, tu peux lui confier une routine, à relire avant de l’enregistrer, ou le partager avec l’équipe.",
        "L’assistant signale les agents que tu as déjà qui font une partie du même travail. Une barre en haut du fil ramène à la carte quand elle sort de l’écran.",
        "Tout marche aussi pour une conversation sur ton VPS.",
      ],
    },
  },
  {
    version: "0.1.110",
    publiee: "2026-11-03T23:04:38Z",
    groupes: {
      nouveau: [
        "Réagir d’un émoji à une réponse d’agent. La réaction s’affiche sous la réponse et se retire d’un clic ; l’agent ne la reçoit pas.",
        "**Répondre** à une réponse précise : le message cité s’affiche au-dessus du champ, puis au-dessus de ta bulle. Un clic dessus ramène au message cité.",
        "Réordonner les agents de la barre des chats en les glissant, ou avec Alt + ↑/↓. L’assistant reste en tête et les épinglés au-dessus.",
        "Sur le téléphone, la page Mises à jour a un lien **Nouveautés** vers ce changelog.",
      ],
      ameliore: [
        "L’aperçu du dernier message, dans la barre des chats, met le texte en forme au lieu d’afficher ses marques (`**`, `#`…).",
        "Dans la conversation d’un agent, un clic sur son avatar ou son prénom ouvre ses réglages dans le panneau de droite.",
      ],
    },
  },
  {
    version: "0.1.107",
    publiee: "2026-11-03T22:35:21Z",
    groupes: {
      nouveau: [
        "Sur un VPS : le diagnostic de ce que le serveur ajoute à chaque appel (Réglages du serveur › Général), et **Ajouter les consignes KLYRA** sur l’écran d’un projet du serveur.",
        "Les livrables des agents de ton VPS arrivent dans Artefacts, comme ceux de ton poste.",
        "Les compétences des plugins activés dans Claude Code apparaissent dans le panneau Compétences et la liste « / ».",
      ],
      ameliore: [
        "Avec ChatGPT, les agents connaissent aussi tes compétences : celles demandées par « / » et celles que leur fiche précharge. Sur ton poste comme sur un VPS.",
      ],
    },
  },
  {
    version: "0.1.106",
    publiee: "2026-11-03T22:08:18Z",
    groupes: {
      nouveau: [
        "L’onglet Réglages du panneau d’un agent est réorganisé : description modifiable sur place, puis **Souvenirs**, **Compétences**, **Routines** et **Utilisation**, chacun dans sa vue.",
        "**Souvenirs** : la mémoire de l’agent, avec recherche, lecture, modification et nouveau souvenir. Rien n’est supprimé.",
        "**Utilisation** : ce que l’agent a consommé sur 7 jours, 30 jours ou un an.",
        "Taper « / » au début d’un message propose les compétences, et la compétence choisie est bien chargée par l’agent.",
        "Dans **Compétences**, choisir celles qu’un agent charge d’office.",
        "Tout marche aussi pour une conversation sur ton VPS : souvenirs, compétences, utilisation et configuration KLYRA.",
      ],
      corrige: [
        "Enregistrer une fiche dans l’app ne perd plus ses listes, comme ses compétences.",
        "Les compétences d’une fiche sont aussi chargées quand tu parles directement à l’agent ou dans un fil.",
      ],
    },
  },
  {
    version: "0.1.105",
    publiee: "2026-11-03T21:29:53Z",
    groupes: {
      nouveau: [
        "Réglages › Mises à jour : **Voir le changelog** ouvre les nouveautés de chaque version. La ligne se trouve aussi dans la recherche des réglages.",
      ],
    },
  },
  {
    version: "0.1.104",
    publiee: "2026-11-03T20:43:05Z",
    groupes: {
      corrige: [
        "Le menu du choix du modèle n’est plus coupé dans le panneau Réglages d’un agent : il s’affiche en entier, aligné sur son bouton.",
      ],
    },
  },
  {
    version: "0.1.103",
    publiee: "2026-11-03T19:59:51Z",
    groupes: {
      ameliore: [
        "Les infobulles du rail, de ton avatar et des boutons à icône prennent le style de KLYRA.",
      ],
    },
  },
  {
    version: "0.1.102",
    publiee: "2026-11-03T19:49:12Z",
    groupes: {
      ameliore: [
        "Le bouton qui ouvre une nouvelle conversation, en haut des Chats, a une icône de bulle avec un plus. Celui de Mes agents s’appelle **Nouvel agent**.",
      ],
    },
  },
  {
    version: "0.1.101",
    publiee: "2026-11-03T18:53:33Z",
    groupes: {
      nouveau: [
        "Un menu du clic droit sur les agents de la barre, les conversations d’équipe, les messages, les onglets des fils et les tickets. Il se pose sous le pointeur et se pilote entièrement au clavier : flèches, Début, Fin, → et ← pour les sous-menus.",
        "Sur un agent : nouveau fil, épingler, sourdine, ouvrir sa fiche, marquer comme lu, l’arrêter, aller à ses tickets ou ses routines, copier sa mention, le masquer ou le désactiver.",
        "**Masquer** range un agent sous « N agents masqués » dans la barre : il reste actif et appelable. En **sourdine**, ses réponses finies ne te préviennent plus, ses erreurs si.",
        "Sur un message : copier (ta sélection d’abord), citer, en faire un fil, créer une branche, réessayer. Sur un ticket : ouvrir, changer la priorité, remettre à faire, fermer, supprimer.",
        "Sous la fiche d’un agent, son poids estimé en jetons. Au-delà de 1 500, un conseil dit ce qu’il faut garder pour la raccourcir.",
      ],
      ameliore: [
        "Un nouvel agent est créé sans mémoire par défaut : environ 4 000 jetons de moins à chaque appel. L’aide de la mémoire dit ce qu’elle coûte.",
        "Les modèles KLYRA passent en version 3 : leur bloc « Parler en équipe » ne garde que ce que l’app ne donne pas déjà aux agents. Environ 800 jetons de moins à chaque appel d’un agent installé depuis un modèle.",
      ],
      corrige: [
        "Dans les rappels, la rangée de cartes défile au lieu de couper la dernière carte.",
      ],
    },
  },
  {
    version: "0.1.97",
    publiee: "2026-11-03T18:04:00Z",
    groupes: {
      retire: [
        "L’entrée Serveurs quitte le menu de l’avatar : le sélecteur de serveur du rail mène déjà à **Tous les serveurs** et à **Ajouter un serveur**.",
      ],
    },
  },
  {
    version: "0.1.96",
    publiee: "2026-11-03T17:50:39Z",
    groupes: {
      nouveau: [
        "**Ajouter les consignes KLYRA** sur un projet de ton poste : l’app te montre d’abord ce qu’elle va écrire, puis crée un `AGENTS.md` court à remplir (le but du projet, les commandes de vérification, où sont les choses, les règles) et un `CLAUDE.md` qui l’importe. Claude Code et Codex le lisent une seule fois.",
        "Rien n’est écrasé : un `CLAUDE.md` existant reçoit seulement l’import en tête.",
      ],
    },
  },
  {
    version: "0.1.95",
    publiee: "2026-11-03T17:37:52Z",
    groupes: {
      nouveau: [
        "Un diagnostic du poste dans **Réglages › Agents** : ce que ta configuration personnelle de Claude Code ajoute à chaque appel (ton `CLAUDE.md` et ses imports, tes skills, la présentation des agents, les plugins, les serveurs MCP), estimé en jetons, avec un conseil et le fichier à ouvrir.",
        "Le diagnostic ne fait que lire : rien n’est modifié sur ton poste.",
      ],
    },
  },
  {
    version: "0.1.94",
    publiee: "2026-11-03T17:11:15Z",
    groupes: {
      nouveau: [
        "**Résumé automatique** des conversations lourdes, en option dans la configuration KLYRA, désactivé par défaut. L’app résume elle-même avant ton message quand les échanges dépassent 80 000 jetons, ou pendant une pause de plus de 25 minutes au-delà de 40 000. Jamais pendant qu’un agent travaille.",
      ],
      ameliore: [
        "Un résumé ne t’envoie plus de notification et ne change plus l’étape du ticket d’un fil.",
      ],
    },
  },
  {
    version: "0.1.93",
    publiee: "2026-11-03T16:53:13Z",
    groupes: {
      nouveau: [
        "**Configuration KLYRA** : une configuration pour que les agents consomment moins, proposée sur l’Accueil et dans **Réglages › Agents**. Elle s’adopte en un clic, se modifie et se retire, et ne touche qu’aux sessions lancées par l’app.",
        "Elle ajoute les **consignes KLYRA** à chaque session, avec Claude comme avec ChatGPT. Tu peux modifier leur texte ; un texte resté tel quel suit les nouvelles versions.",
        "Elle peut couper la mémoire des agents : environ 4 000 jetons de moins à chaque appel d’un agent qui en a une, sans toucher à sa fiche.",
      ],
      ameliore: [
        "Les consignes KLYRA passent en version 2 : elles laissent l’agent chercher l’outil de vérification du projet au lieu de l’en empêcher. Mesuré sur du code : 19 % de coût en moins, résultat égal.",
      ],
    },
  },
  {
    version: "0.1.91",
    publiee: "2026-11-03T16:01:32Z",
    groupes: {
      ameliore: [
        "Chaque session d’un agent coûte environ 2 800 jetons de moins : les skills livrées avec Claude Code et des outils sans usage dans l’app sont retirés, sur ton poste comme sur ton VPS. Tes propres skills restent.",
        "Les informations du poste passent dans le premier message : le cache est partagé entre les sessions.",
      ],
    },
  },
  {
    version: "0.1.90",
    publiee: "2026-11-03T15:20:49Z",
    groupes: {
      nouveau: [
        "Un espace par serveur : le sélecteur de serveur change ce que tu vois au lieu de déplacer les conversations. La barre latérale, l’Accueil, Projets, Routines et la recherche ne montrent que ce qui est sur le serveur choisi.",
        "Une conversation directe par agent et par serveur. Changer de serveur depuis une conversation ouvre celle du même agent sur l’autre serveur. Le menu Serveurs montre les non-lus des autres serveurs.",
        "Au-dessus du composeur, un conseil quand une conversation devient lourde : **Résumer la conversation**, ou ouvrir un nouveau fil quand tu reprends après plus d’une heure.",
      ],
      retire: [
        "Le choix de la machine d’une conversation, et le champ Machine des projets et des routines : ils prennent le serveur affiché.",
      ],
      corrige: [
        "`/compact` se termine enfin, sur ton poste comme sur ton VPS.",
      ],
    },
  },
  {
    version: "0.1.88",
    publiee: "2026-11-03T14:29:43Z",
    groupes: {
      ameliore: [
        "Un clic sur ton avatar ouvre un menu **Réglages** et **Serveurs**. Serveurs montre Ce PC et tes VPS reliés, l’ajout, les réglages du serveur et le retrait.",
        "Un globe sur l’avatar montre qu’un VPS est actif.",
        "Au clavier : ↑ ouvre le menu, → et ← entrent dans les serveurs et en sortent, Échap referme.",
      ],
    },
  },
  {
    version: "0.1.87",
    publiee: "2026-11-03T13:27:44Z",
    groupes: {
      ameliore: [
        "L’assistant confie un livrable entier à un seul agent, jamais en relais, et demande le travail en fichiers avec un compte rendu court. Il vérifie par les preuves, sans tout relire.",
        "Les agents n’inventent plus de faits : ce qui manque est marqué « [à compléter] ».",
        "Des outils de Claude Code sans usage dans l’app sont retirés de chaque session : environ 4 500 jetons de moins à chaque tour.",
      ],
    },
  },
  {
    version: "0.1.86",
    publiee: "2026-11-03T13:03:38Z",
    groupes: {
      nouveau: [
        "Au-dessus du composeur, les agents qui travaillent en arrière-plan, avec leur étape et leur avancement.",
        "Computer Use : les agents peuvent piloter l’ordinateur, seulement quand l’interrupteur des Réglages est allumé. **Réglages › Computer Use** montre l’état du pilote, avec **Vérifier à nouveau**.",
        "Un choix « Pour » sur chaque rappel le donne à un membre de l’équipe.",
      ],
      ameliore: [
        "Le menu s’allège : plus de recherche (elle reste sur ⌘K, `Ctrl+K` sous Windows), ni de sélecteur de machine. Les projets épinglés, ou les 3 récents, y tiennent en deux lettres.",
        "Marketplace passe dans les Réglages.",
      ],
      retire: [
        "La barre d’assignation des rappels d’équipe.",
      ],
    },
  },
  {
    version: "0.1.84",
    publiee: "2026-11-03T12:29:28Z",
    groupes: {
      corrige: [
        "Tout fichier que tu demandes à un agent est publié dans Artefacts avant qu’il dise « livré », quel que soit son format. Avant, un simple fichier texte demandé par un fil était créé sans être publié.",
      ],
    },
  },
  {
    version: "0.1.82",
    publiee: "2026-11-03T12:10:42Z",
    groupes: {
      ameliore: [
        "Les nouvelles conversations et les fils reçoivent un vrai titre de 2 à 6 mots, tiré de ta demande. Le début du message sert de titre le temps qu’il arrive. Un titre que tu as renommé est gardé.",
      ],
    },
  },
  {
    version: "0.1.81",
    publiee: "2026-11-03T11:30:07Z",
    groupes: {
      corrige: [
        "Tes artefacts claude.ai se lisent maintenant dans leur galerie, avec la session claude.ai de l’app. Avant, la liste ne se chargeait pas. Sans session, session expirée ou galerie vide, l’écran dit pourquoi.",
      ],
    },
  },
  {
    version: "0.1.80",
    publiee: "2026-11-03T11:12:10Z",
    groupes: {
      corrige: [
        "Pendant une dictée, un seul bouton stop. Avant, celui de la dictée et celui de l’agent s’affichaient côte à côte. Celui de l’agent revient dès que la dictée est finie.",
      ],
    },
  },
  {
    version: "0.1.79",
    publiee: "2026-11-03T11:07:15Z",
    groupes: {
      nouveau: [
        "Les livrables des agents arrivent dans l’écran **Artefacts** : page web, maquette, capture, vidéo, PDF ou tout fichier demandé, avec un aperçu, l’agent, le projet et la date. Un clic l’ouvre.",
        "L’app copie chaque livrable dans l’espace de son agent : retirer un artefact supprime la copie, jamais l’original. **Enregistrer dans…** le copie dans le dossier de ton choix.",
        "Le panneau Fichiers d’une conversation montre ses livrables.",
        "Hors projet, chaque agent travaille dans son propre dossier.",
      ],
      ameliore: [
        "Les artefacts claude.ai deviennent une source facultative, relue à l’ouverture de l’écran.",
      ],
    },
  },
  {
    version: "0.1.78",
    publiee: "2026-11-03T10:51:54Z",
    groupes: {
      nouveau: [
        "Le **Planning** devient le planning des agents : chaque départ de routine est un bloc de la couleur de l’agent, en pointillés à venir, puis marqué de son résultat (réussie, échec, interrompue…). Les routines fréquentes tiennent sur une ligne par jour.",
        "Filtrer le Planning par agent.",
        "Un clic sur un créneau propose une routine, déjà remplie pour ce jour et cette heure chaque semaine, ou un rendez-vous.",
      ],
      ameliore: [
        "Les rendez-vous restent, en gris.",
      ],
    },
  },
  {
    version: "0.1.77",
    publiee: "2026-11-03T10:30:48Z",
    groupes: {
      ameliore: [
        "L’écran Artefacts relit tes artefacts claude.ai tout seul à son ouverture, au plus toutes les 10 minutes. Le bouton reste pour relire à la main.",
      ],
      corrige: [
        "Quand la liste des artefacts ne peut pas être lue, l’écran dit pourquoi (pas connecté, erreur, délai dépassé…) au lieu d’un message général.",
      ],
    },
  },
  {
    version: "0.1.76",
    publiee: "2026-11-03T10:24:41Z",
    groupes: {
      nouveau: [
        "Tous les fournisseurs sur ton VPS, comme sur ce poste : ChatGPT y fait travailler les agents, s’installe et se met à jour depuis **Réglages du serveur › Fournisseurs**, et se connecte par la page d’OpenAI, par un code ou par une clé.",
        "Les autres IA (Gemini, Mistral, DeepSeek…) s’ajoutent aussi sur le VPS, et ses agents peuvent les consulter.",
        "Dans une conversation sur ton VPS, le choix rapide propose les fournisseurs installés là-bas.",
      ],
    },
  },
  {
    version: "0.1.75",
    publiee: "2026-11-03T09:43:48Z",
    groupes: {
      nouveau: [
        "L’écran Artefacts a deux onglets : **Mes artefacts** et **Équipe**. Partage un lien claude.ai avec ton équipe ; seule la personne qui l’a partagé peut le modifier ou le retirer.",
      ],
      retire: [
        "Le design system KLYRA n’est plus ajouté d’office à ta liste d’artefacts : il se partage comme les autres.",
      ],
    },
  },
  {
    version: "0.1.73",
    publiee: "2026-11-03T09:21:18Z",
    groupes: {
      ameliore: [
        "Chaque fournisseur a son logo officiel dans la page Fournisseurs et dans le choix rapide de la conversation : Claude, ChatGPT, Gemini, Mistral, DeepSeek, Grok, OpenRouter.",
        "Les autres IA rejoignent **Fournisseurs**, en une seule liste : Claude et ChatGPT font travailler les agents, les autres sont à consulter, ajoutées avec leur clé depuis leur ligne, puis testées ou retirées.",
        "Agents et Computer Use reviennent dans les Réglages de l’app : ils règlent cet ordinateur, pas un serveur. Le fournisseur de chaque agent se choisit dans Agents.",
      ],
    },
  },
  {
    version: "0.1.72",
    publiee: "2026-11-03T08:56:32Z",
    groupes: {
      nouveau: [
        "Des onglets dans l’aperçu, comme dans un navigateur : chacun garde sa page, **+** en ouvre un autre.",
      ],
      ameliore: [
        "L’assistant principal porte l’icône KLYRA.",
      ],
    },
  },
  {
    version: "0.1.71",
    publiee: "2026-11-03T06:23:54Z",
    intro: "Préparation du suivi des travaux confiés aux agents, tenu sur ton ordinateur. Rien ne change à l’écran.",
    groupes: {},
  },
  {
    version: "0.1.70",
    publiee: "2026-11-03T06:19:43Z",
    groupes: {
      nouveau: [
        "Un agent peut travailler avec **ChatGPT**, sur ce poste. Connecte ton compte ChatGPT dans le navigateur, ou une clé API.",
        "Dans l’en-tête d’une conversation, le choix rapide : les fournisseurs prêts sur ce poste, leurs modèles avec une recherche, puis l’effort. Changer de fournisseur ne change que cette conversation, et le nouveau reprend ce qui s’y est dit.",
        "**Réglages du serveur**, depuis le menu du serveur : une page Fournisseurs avec ceux qui sont connectés et les autres, et pour chacun son compte, sa clé, sa version, **Installer** ou **Mettre à jour**.",
        "Un fournisseur par défaut pour chaque agent : ses nouvelles conversations, ses fils et sa conversation directe.",
      ],
      ameliore: [
        "Dans le fil, une réponse écrite avec ChatGPT le dit à côté du nom de l’agent.",
      ],
    },
  },
  {
    version: "0.1.69",
    publiee: "2026-11-02T16:07:57Z",
    intro: "L’app pour téléphone est maintenant mise en ligne à chaque version. Rien ne change dans l’app de bureau.",
    groupes: {},
  },
  {
    version: "0.1.68",
    publiee: "2026-11-02T15:26:48Z",
    intro: "Le site de KLYRA ouvre, avec ce journal des versions. Rien ne change dans l’app.",
    groupes: {},
  },
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
