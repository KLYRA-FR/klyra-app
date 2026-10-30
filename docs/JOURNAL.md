# Journal du projet — app KLYRA

> Historique des décisions et de l’avancement, pour reprendre le travail depuis n’importe quel ordi.
> **À Claude, en début de session : lis ce fichier et `CLAUDE.md` avant toute chose, puis mets à jour ce journal à la fin de chaque session.**

---

## L’objectif

Remplacer VS Code par **notre propre outil** pour travailler avec l’IA, en plus simple :
- un chat façon iMessage (bulles), où l’on parle à des **rôles** : Principal (l’interlocuteur qui répartit le travail), Dev, UX/UI, DA ;
- les chats récents et les projets toujours visibles ;
- l’aperçu du site en direct pendant qu’on « vibe code » ;
- un navigateur de fichiers façon Finder, pour retrouver ses images même mal nommées.

## Décisions prises

| Date | Décision | Pourquoi |
|---|---|---|
| 07/10/2026 | Desktop uniquement, noir et blanc pour l’instant | On valide la structure avant la couleur |
| 08/10/2026 | **App de bureau** (validé par le patron) | Elle doit piloter des terminaux en local (Claude Code, etc.), impossible en web |
| 08/10/2026 | **Electron** plutôt que Tauri | Les terminaux et le SDK Claude sont en JavaScript/Node : tout en TypeScript, pas de Rust |
| 08/10/2026 | Front d’abord, avec des données factices ayant la forme du futur back | On peaufine l’interface directement dans le code, puis on branche le back |
| 08/10/2026 | Une seule police : Google Sans Flex | Règle du design system KLYRA |
| 07/10/2026 | Fichiers façon **Finder** (grille de miniatures à faire défiler + panneau d’infos), **pas** de vue image par image avec des flèches | Beaucoup de captures, on veut scroller et cliquer |
| 07/10/2026 | L’IA renomme et étiquette les fichiers à l’import (on peut annuler) | Les fichiers sont souvent nommés 1, 2, 3… |
| 14/10/2026 | **Les rôles = les 11 sous-agents Claude Code** (Hugo, Iris, Jules, Agathe, Thomas, Mathilde, Sacha, Olivier, Val, Diego, Lou) + le Principal qui orchestre | L’app pilote les vrais agents du studio |
| 14/10/2026 | **Fin du noir et blanc** : l’app prend les couleurs, icônes et composants du design system KLYRA | Elle doit ressembler à un vrai produit, pas à une maquette |
| 29/10/2026 | **Code dans `KLYRA-FR/klyra-app`, versions dans `KLYRA-FR/klyra-app-versions`** ; une PR par sujet, vérifiée avant fusion (`docs/CONTRIBUER.md`) | Corentin gère le dépôt des versions ; une fusion sur main publie pour tous |
| 29/10/2026 | **Plus de listes ni de fenêtres du système** : `ListeDeroulante` remplace tous les `<select>`, `Modale` / `useConfirmation` remplacent `confirm` | Demande de Corentin : la liste native (fond blanc, surlignage bleu Windows) sortait de la DA |
| 29/10/2026 | **Réglages par section**, barre latérale et recherche : Général, Profil, Claude, Agents, Autres IA, Notifications, Voix, Mises à jour. Aucun réglage factice : ni thème (pas de mode sombre), ni langue (français seul). Computer Use, Facturation et Appli mobile attendent la décision de Corentin | Demande de Corentin, sur le modèle des Réglages d’OpenBot |
| 29/10/2026 | Décision de Corentin : **pas de Facturation ni d’Appli mobile, pas de mode sombre pour l’instant**. La consommation va dans **Profil** (jetons, messages, séries, activité de l’année, modèles, coéquipiers, coût indicatif), tirée d’un journal tenu à partir de cette version. **Computer Use** : interrupteur et autorisations seulement ; plan dans `docs/COMPUTER-USE-PLAN.md`, à valider avant tout code | Profil d’OpenBot comme référence ; chiffres réels uniquement |
| 29/10/2026 | Profil : **toute la consommation Claude Code du poste** (terminal, IDE, app), rattrapée dans ses transcriptions locales, avec la vue « Seulement KLYRA » ; limites de l’abonnement (5 h, semaine) ; ce qui ne peut pas être compté écrit en clair (claude.ai, autres ordinateurs). Clé Admin d’Anthropic facultative pour le coût réel d’une organisation Console (API Usage and Cost Analytics, bêta) | Profil vide chez Corentin : le journal ne comptait qu’à partir de la 0.1.11 |
| 29/10/2026 | **Dictée en direct** : ElevenLabs Scribe v2 Realtime avec la clé des Réglages, sinon Whisper sur l’ordinateur (whisper-server gardé en mémoire, modèle « Rapide » sur PC, « Précis » sur Mac). Chaque moteur dans son module (`electron/dictee-elevenlabs.ts`, `src/lib/dictee/moteur-*.ts`) | Corentin voulait voir le texte s’écrire pendant qu’il parle ; la fin de phrase passe de ~12 s à ~0,3 s (en ligne) ou ~0,7 s (PC sans carte graphique) |
| 30/10/2026 | **Sons en panoplies** : chaque thème a aussi clic, ouvrir, fermer et sélection, branchés sur toute l’app (`src/lib/sons/interactions.ts`) ; « moins d’animations » ne coupe plus les sons, seuls les sons de l’interface coupés par le système | Corentin : l’interface était muette, seuls 10 événements rares sonnaient |
| 29/10/2026 | **Convex pour les données partagées** (comptes et équipe, rappels assignés, calendrier commun), à la place de Neon + Drizzle. Conversations, fichiers et clés restent sur l’ordinateur. Connexion par lien magique (e-mails PostShiba depuis `notifications.klyra.fr`) ; équipe de départ : Corentin, Pelin, Yanis, admins. Plan dans `docs/CONVEX-PLAN.md`, à valider avant tout code | Décision de Corentin : travailler à plusieurs sur les mêmes rappels et le même agenda |

## Maquettes (Figma)

Fichier : https://www.figma.com/design/YEmyuRbNcN1t0GkHktxQET/claude

- **Veille** des interfaces de chat IA (Grok Bot, dots d’OpenAI, Meta Muse, Poke, ChatGPT, Claude, Gemini, Perplexity, Vibe, DeepSeek, Claude Cowork, Copilot…) et motifs à retenir : node `478-13`
- **Wireframes desktop** (section complète) : node `480-94`
  - 01 Accueil `481-1161` · 02 Conversation `480-1413` · 03 Projets `482-1305`
  - 04 Fiche projet `483-1458` · 05 Équipe `484-1619` · 06 Attribuer les rôles `484-1903`
  - 07 Fichiers `488-1984` · 08 Mémoire du projet `490-2117` · 09 Palette ⌘K `491-2311`
  - Composant Sidebar `480-360` · icônes et avatars `480-95`

Lien direct vers un écran : `https://www.figma.com/design/YEmyuRbNcN1t0GkHktxQET/claude?node-id=<node>`

## Fonctionnalités définies

- **Rôles** : Principal (orchestre, interlocuteur unique possible), Dev, UX/UI, DA ; création de rôles personnalisés (rédacteur, SEO, QA…).
- **Mode de travail par projet** : « le Principal répartit » ou « je parle à chaque rôle ».
- **Autonomie par rôle** : propose seulement / valide avec moi / livre en autonomie.
- **Dans le fil** : répartition des tâches, livrables à choisir (options), journal de travail (fichiers modifiés), actions (« lance le build »).
- **Aperçu** du site à droite (ordinateur / téléphone), zone modifiée encadrée.
- **Fichiers** : Récents, captures importées automatiquement, dossiers du projet, étiquettes, recherche par description, statut retenu / à valider / écarté, « utilisé dans ».
- **Mémoire du projet** : préférences, décisions, infos projet ; chaque ligne dit d’où elle vient ; modifiable.
- **Palette ⌘K** : fichiers, chats et actions au clavier.

### Idées en attente (pas encore décidées)

- Frise de versions en captures (revenir en arrière d’un clic)
- Boîte « À valider » qui regroupe tout ce qui attend une décision
- Commenter directement sur l’aperçu du site (cliquer un élément et écrire)

## Où on en est

### Fait
- [x] Veille et wireframes Figma (9 écrans)
- [x] Dépôt `pelin-klyra/klyra-app` : Electron + Next.js 16 + `klyra-ui` en noir et blanc
- [x] Modèle de données + données factices + store unique (`src/lib/workspace.tsx`)
- [x] Barre latérale
- [x] Écran de conversation (fil multi-rôles, envoi de message, @mention, réponses simulées, aperçu)
- [x] Passage au design system KLYRA : tokens, icônes officielles, logo, Bouton / BoutonIcone / BoutonPrincipal, Onglets, PixelCheck
- [x] Planning, vues Jour et Semaine : survol de la demi-heure sous la souris (« + 10:30 », heure en valeur dans la marge), un clic crée l’événement à cette heure. Survol écrit dans le DOM (`useSurvolCreneau`), sans re-rendu de la grille.
- [x] Sons de l’app (29/10) : Réglages → Notifications → Sons (fin de tâche à part, 5 thèmes en cartes de pixels, volume). Sons synthétisés en Web Audio, sans fichier (`src/lib/sons/`). Test : `pnpm test:sons`.
- [x] Panoplies de sons (30/10) : clic, ouvrir, fermer, sélection dans chaque thème, sur tous les contrôles de l’app ; l’aperçu d’une carte fait entendre la panoplie.

### À faire, dans l’ordre
1. [x] Accueil de l’IA (inspiration Figma `544-2769`) : titre d’accueil, composeur commun (`PromptBox`, puces projet et rôle), suggestions par rôle, projets à reprendre. Envoyer ouvre un nouveau chat.
2. [x] Mode projet (inspiration Figma `546-2777`) : dans un chat ou sur `/projet?id=`, le menu devient un rail noir, un panneau blanc montre les projets et tout le dossier du projet (fichiers modifiés par les agents en K1), puis chat et aperçu. Panneau replié d’office sous 1280 px. Page projet : brief, nouveau chat, chats du projet.
   [ ] Projets (tableau de tous les projets)
   [ ] Lire la vraie arborescence sur le disque (Electron) à la place de `src/data/files.ts`
3. [x] Équipe : les 11 sous-agents de `~/.claude/agents/` (données dans `src/data/agents.ts`), cartes à halo pixel (inspiration Figma `544-2770`), fiche complète par agent (`/equipe?agent=<id>`), circuits de passation
   [x] Agents réels (14/10) : l’app lit, surveille et écrit `~/.claude/agents/*.md` ; installation de l’équipe sur un poste vierge ; modifier une fiche (historique + détection des conflits) ; créer un agent (présenté aux autres fiches) ; « Modifier avec Lou » via Claude Code en local, avec avant / après. Test : `pnpm test:agents`.
   [ ] Fenêtre « Attribuer les rôles »
4. [ ] Fichiers façon Finder
5. [ ] Mémoire du projet
6. [ ] Palette ⌘K
7. [ ] Puis le back : données partagées sur Convex (`docs/CONVEX-PLAN.md` : comptes, rappels assignés, calendrier commun), vrais agents (SDK Claude) et terminaux en local
   [x] Convex installé (dépendance, `convex/schema.ts` vide, `pnpm dev:convex`, fichiers ai), sans déploiement
   [x] Plan validé par Corentin (29/10) : Irlande, PostShiba gardé, chacun ne voit que ce qui le concerne (admins compris), e-mail d'assignation si l'app est fermée, v1 hors ligne en lecture
   [x] PR 2 Comptes : Convex Auth (lien magique PostShiba), invitations, rôles, Réglages › Équipe, liens `klyra://`, jetons dans le trousseau, déploiement Convex dans l'action App, `pnpm test:convex`
   [ ] PR 3 Rappels assignés, puis calendrier commun, puis hors ligne (cf. plan)
8. [ ] Fichier d’installation .dmg pour l’équipe (compte développeur Apple, 99 $ par an)

### Points ouverts
- **`klyra-ui` en retard sur le design system** : `Button` en pilule, survols bleus codés en dur. L’app utilise ses propres `Bouton` / `Onglets` en attendant. À signaler à Corentin.
- **À ajouter au design system** : la variante `discret` du Bouton (action d’outil sans fond au repos) et la bulle de chat (K1 pour Pelin, gris pour les rôles) n’y existent pas encore.
- Bulle de l’utilisateur en noir (`klyra-surface-sombre`), bulle d’agent en gris : à valider avec Pelin.
- Accès des agents : fichiers du dossier du projet en lecture et écriture (`acceptEdits`), et seulement les commandes de `COMMANDES_AUTORISEES` (electron/claude.ts). Pelin voulait l’accès complet ; `--dangerously-skip-permissions` a été refusé par le contrôle des permissions de Claude Code. Élargir la liste au besoin.
- Dossiers des projets d’exemple : seuls klyra.fr et l’app interne existent sur le disque ; Bizwhoo et Diagnostic répondent « dossier introuvable » tant que leur vrai chemin n’est pas renseigné.
- **Noms de fichiers Windows corrigés (30/10)** : `nomFichier` (`src/lib/fichiers.ts`) accepte « / » et « \\ » pour les pièces jointes, extensions, étapes, rail, panneau latéral, visionneuse et ressources de workflow. Les chemins utilisés pour lire/ouvrir les fichiers restent intacts. `FileTree` est vérifié : ses producteurs fournissent déjà `name` et des chemins relatifs en « / », même sous Windows ; son découpage ouvre les dossiers parents, sans extraire le nom. Le repérage des fichiers modifiés (`useModifiedFiles`) reste un sujet distinct.
- **Compte d'équipe facultatif** : l'app marche sans compte ; la connexion est dans Réglages › Équipe. Profil de l'ordinateur et compte unifiés le 30/10 (règles dans `src/lib/identite.ts`, voir l'historique).
- **Liens `klyra://` en développement** : seule l'app installée les reçoit (`enregistrerProtocole`). Avec `pnpm desktop`, coller le lien dans Réglages › Équipe.
- **Barre de titre sous Windows** : celle du système (choix de Pelin). Un `titleBarOverlay` aux couleurs de l’app (fond `fond-page`, boutons du système dessinés par Electron) donnerait le même cadre que sur Mac : à décider.

## Reprendre sur un autre Mac

```bash
gh auth login                       # avec un compte membre de KLYRA-FR
gh repo clone KLYRA-FR/klyra-app
cd klyra-app
pnpm install
pnpm desktop
```

Puis, dans Claude : « Lis `docs/JOURNAL.md` et `CLAUDE.md`, on continue l’app KLYRA. »

## Historique des sessions

- **30/10/2026 — Coller une capture dans le chat (point 5)** : Ctrl+V (Cmd+V sur Mac, par le menu Édition d’Electron) dans le champ d’une conversation d’équipe ou directe joint l’image du presse-papiers. Seul le geste de collage la lit (`onPaste` du champ, `src/lib/collage.ts`) : du texte se colle comme avant (un tableau copié depuis un tableur apporte aussi son image : on garde le texte) ; des fichiers copiés dans le Finder ou l’Explorateur sont joints par leur chemin, comme un glisser ; une image sans fichier est écrite par le process principal dans `collages/` du dossier de l’app (`electron/collages.ts`), nommée `capture-AAAA-MM-JJ-HHMMSS-<empreinte>.png` (PNG, JPEG, GIF, WebP, 20 Mo au plus, signature vérifiée), puis suit le circuit des pièces jointes (carte, retrait, brouillon, 10 au plus, envoi). Une seule image par geste, et la même image recollée réutilise le même fichier : pas de doublon. Échec (format, taille, lecture) : le message habituel sous le composeur, texte et pièces intacts. Dans le fil, une capture affiche « Capture collée » au lieu de son emplacement. Les captures restent dans `collages/` (elles servent aux messages envoyés). Tests : `pnpm test:collage` (règles) et `pnpm test:coller` (Electron dans xvfb-run, presse-papiers de l’écran virtuel, images synthétiques ; Ctrl+V réel sous Linux, Cmd+V simulé). Sauvegarde avant fusion : branche `sauvegarde/main-avant-coller-capture-20261030`, commit `868f349708f9703c646e646c6b55f51066a0ada4` (version publiée précédente : `v0.1.24`). Retour arrière : une PR de revert de ce seul point depuis le main courant, vérifiée puis fusionnée ; l’action App republie sous un numéro supérieur. Aucune donnée à restaurer : les captures déjà jointes restent des fichiers ordinaires.
- **30/10/2026 — Délai entre deux liens de connexion (point 4)** : un lien par minute et cinq par heure au plus pour une même adresse (normalisée comme l’auth), sur l’horloge du serveur ; choisi d’après la durée du lien (15 min) et la limite PostShiba de l’équipe (90 e-mails par heure, `courriels.ts`), qu’une seule adresse ne doit pas pouvoir épuiser. L’app appelle `connexion:demanderLien` : même réponse pour toute adresse, invitée, membre, retirée ou inconnue (`acceptee`, `attenteMs`), envoi programmé seulement pour une adresse admise ; une mutation, donc deux demandes simultanées se suivent et un seul e-mail part. Les appels directs à `auth:signIn` (anciennes versions) passent par le même délai dans `createOrUpdateUser`, avant tout nouveau code : un lien déjà envoyé reste valable. Réglages › Équipe : « Renvoyer dans 42 s » désactivé, puis « Renvoyer », et la règle écrite ; un double clic ne fait qu’une demande ; l’attente survit au rechargement et au redémarrage (l’horloge de l’ordinateur ne sert qu’à l’affichage). Tables `demandesLien` et `ticketsLien`, vidées toutes seules (1 h, 5 min). Tests : `convex/limites.test.ts` (horloge simulée), `pnpm test:liens` (Electron, backend Convex local jetable). Sauvegarde avant fusion : branche `sauvegarde/main-avant-limite-liens-20261030`, commit `e13242695e8eb7711b4cc10ab6ebd65f76f819b7` (version publiée précédente : `v0.1.23`). Retour arrière : une PR de revert de ce seul point qui **garde la déclaration des tables `demandesLien` et `ticketsLien` dans `convex/schema.ts`** (leurs lignes peuvent exister au moment du revert, et leurs nettoyages programmés n’existeraient plus), vérifiée puis fusionnée ; l’action App republie sous un numéro supérieur. Aucune donnée de compte à restaurer.
- **30/10/2026 — Profil de l’ordinateur et compte d’équipe unifiés (point 3)** : une seule identité, `moi` (`useWorkspace().moi`, règles dans `src/lib/identite.ts`). Sans compte (déconnecté, session en cours de vérification ou sans réseau, compte retiré) : le profil de l’ordinateur, comme avant. Connecté et membre actif : nom, rôle et couleur du compte, lus sur le serveur avec la session (`equipe:moi`), partout (rail, accueil, Profil, Équipe, contexte des agents, planning des agents) ; la photo et les réglages restent ceux de l’ordinateur. Le profil du compte n’est gardé qu’en mémoire (`profilCompte`), jamais sur le disque : déconnecté ou sous un autre compte, rien du précédent ne s’affiche. Rien n’est recopié tout seul : un écart (première connexion, profil d’équipe incomplet, modification faite hors ligne) s’affiche dans Profil et Équipe avec les deux versions, et l’on choisit « Utiliser celui de cet ordinateur » ou « Garder celui de l’équipe », avec « Annuler » juste après. Modifier son nom connecté écrit le compte (le serveur valide), puis l’ordinateur ; Profil et Réglages › Équipe passent par le même `useMonIdentite().enregistrer`. Aucune fonction Convex modifiée ; nouveaux tests Convex des refus entre comptes, de la déconnexion et d’un membre retiré. `pnpm test:identite` (règles) et `pnpm test:profil` (Electron, profil temporaire ; avec un backend Convex local et jetable pour la partie compte : `KLYRA_TEST_CONVEX_URL`, `KLYRA_TEST_CONVEX_ADMIN_KEY`, `KLYRA_TEST_CONVEX_SERVEUR`). En développement seulement, `KLYRA_CONVEX_URL` accepte `http://127.0.0.1:<port>` (jamais l’app installée). Limite : l’auteur affiché sur un workflow reste le prénom de l’ordinateur (écran des workflows hors de ce point). Sauvegarde avant fusion : branche `sauvegarde/main-avant-profil-compte-20261030`, commit `72cda0aef9ae930b8631548758a4bfbc8fad8cf3` (version publiée précédente : `v0.1.22`). Retour arrière : une PR de revert de ce seul point depuis le main courant, vérifiée puis fusionnée ; l’action App republie sous un numéro supérieur. Aucune donnée à restaurer : le schéma Convex et `conversations.json` gardent leur forme ; un nom choisi entre-temps reste tel quel des deux côtés.
- **30/10/2026 — « Plus d’options » des conversations d’équipe (point 2)** : le « … » de l’en-tête (`ChatHeader.tsx`) ouvre un menu maison (`MenuConversation.tsx`, même style que les menus des fils et des réponses, jamais de menu système) : « Renommer » (titre en place, même typo et même place que le titre pour que l’en-tête ne bouge pas : Entrée ou clic ailleurs garde, Échap annule, titre vide ignoré, 80 caractères ; enregistré par `renommerChat` dans `conversations.json`) et « Ouvrir le projet » (seulement si le projet existe encore : sinon « Renommer » seul, sans séparateur). Choix validés par Iris. Clavier : Entrée ou flèche bas ouvre, flèches en boucle, Début/Fin, Échap et Tab ferment et rendent le focus au bouton ; clic ailleurs ferme. Rien de destructif ; épinglage et export viendront avec leurs points. Les conversations directes ne changent pas. `pnpm test:conversation` (Electron sur l’export, profil temporaire, vrais gestes clavier et souris, redémarrage ; aussi en CI Ubuntu) vérifie aussi que messages, sessions, brouillon et conversation directe restent intacts. Sauvegarde avant fusion : branche `sauvegarde/main-avant-plus-options-20261030`, commit `711334eacf88a26459119a332f83e501a83fcfae` (version publiée précédente : `v0.1.21`). Retour arrière : une PR de revert de ce seul point depuis le main courant, vérifiée puis fusionnée ; l’action App republie sous un numéro supérieur, puis contrôler les jobs Mac/Windows et les cinq artefacts. Ne pas réinitialiser main ; aucune donnée à restaurer (un titre déjà renommé reste tel quel).
- **30/10/2026 — Noms de fichiers Windows (point 1)** : extraction commune du nom d'affichage dans huit modules, sans toucher aux chemins disque, aux URL, aux données enregistrées ni aux parcours. Les extensions sont calculées sur le nom seul (un `README` dans `dossier.v2` reste sans extension). `pnpm test:fichiers` couvre Windows/UNC, Unix, chemins relatifs/mixtes, espaces, accents, plusieurs points, fichiers sans extension, rendu des pièces jointes et arguments des actions montrer/retirer ; lancé aussi par la CI Ubuntu et Windows. Sauvegarde avant fusion : branche `sauvegarde/main-avant-noms-windows-20261030`, commit `af355f96a291be3cba9c4fc3e68ab528adc3a5ff` (version publiée précédente : `v0.1.20`). Retour arrière : une nouvelle branche depuis le main courant, annuler uniquement la PR de ce point, vérifier puis fusionner une PR de revert ; l'action App republie le code rétabli sous un numéro supérieur, puis contrôler les jobs Mac/Windows et les cinq artefacts de release. Ne pas réinitialiser main ni republier un ancien numéro ; aucune donnée à restaurer.

- **07/10/2026** — Veille des interfaces de chat IA, 9 wireframes desktop noir et blanc dans Figma.
- **08/10/2026** — Choix app de bureau (Electron). Création du dépôt, fondations, barre latérale et écran de conversation. Police unique Google Sans Flex.
- **14/10/2026** — Sortie du noir et blanc : tokens, icônes, logo et composants du design system KLYRA ; lucide-react retiré. Nouveau cadre d’après l’inspiration Figma `543-2765` : barre du haut (logo, recherche, actions), menu sur le fond de page (élément actif sombre, Projets, Réglages, carte utilisateur), contenu dans un panneau blanc arrondi. « Chats récents » retiré du menu.
- **21/10/2026** — Conversation à la façon d’OpenBot : les agents répondent pour de vrai (Claude Code en `stream-json`, session reprise par agent et par conversation), étapes repliables, passations (« Confié à Iris »), « Hugo réfléchit… 12 s », Stop, file d’attente, liste @. Barre latérale en messagerie : Équipe (une ligne par agent : rond pastel, rôle, dernier message, statut), Projets, Conversations d’équipe. Conversations directes `dm-<agent>`, conversations gardées dans `userData/conversations.json`.
- **29/10/2026** — Dépôt passé dans l’organisation KLYRA-FR. Les versions sont publiées dans `KLYRA-FR/klyra-app-versions` (action App et `electron/maj.ts`) ; les apps installées avant ce changement interrogent encore `pelin-klyra/klyra-app-versions` et doivent être réinstallées une fois depuis le nouveau dépôt. Vérification à chaque PR (`verification.yml`, Ubuntu) ; la publication échoue avec un message clair si `VERSIONS_TOKEN` manque.
  Windows : les textes suivent le système (`src/lib/plateforme.ts` : « ce Mac » ou « ce PC », Finder ou Explorateur, ⌘ ou Ctrl dans les raccourcis du canevas) ; barres de défilement fines et sans flèches hors Mac (`data-plateforme` sur la racine).
  Sons de l’app : un seul AudioContext, sons rendus une fois puis rejoués ; `jouer("envoi")`, `jouer("fin-de-tache")`… Silence si le système demande moins d’animations ou a coupé les sons de l’interface, pendant l’écoute de la dictée (sauf début et fin), et quand la notification du système sonne déjà.
  Convex (PR 2) : comptes d'équipe en ligne sur Convex (Irlande).
- **30/10/2026** — Sons en panoplies : 4 microinteractions par thème (clic, ouvrir, fermer, sélection), plus brèves et plus basses que les autres sons. `interactions.ts` suit les gestes (pointeur, clavier) et ce qu’ils ouvrent ou ferment (rôles `menu`, `dialog`, `listbox`, `aria-expanded`), un seul son par geste, le plus parlant ; rien au survol, au défilement, pendant la frappe, ni sans geste. L’AudioContext attend d’être reparti avant de jouer et se recrée s’il est fermé. Silence seulement si le système a coupé les sons de l’interface, et Réglages › Notifications › Sons dit où les remettre. La fenêtre Événement du planning a maintenant `role="dialog"`. Déploiements `calculating-cuttlefish-710` (production, app installée) et `coordinated-ox-134` (développement, `pnpm desktop`). Connexion par lien magique de 15 min envoyé par PostShiba (`connexion@notifications.klyra.fr`) ; page relais `…convex.site/connexion` qui ouvre `klyra://connexion?code=…`. Sur invitation seulement ; Corentin, Pelin et Yanis admins. Les fonctions Convex sont déployées par l'action App avant chaque publication.
