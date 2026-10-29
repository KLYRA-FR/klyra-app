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
- **Chemins Windows** : plusieurs écrans coupent les chemins sur « / » seulement, donc sous Windows ils affichent le chemin entier au lieu du nom du fichier (`etapes.ts`, `RailMessages`, `PanneauLateral`, `PastilleExtension`, `FileTree`, `Visionneuse`, `NoeudVue`, `Composer`, `MessageParts`). Seul le nom proposé à l’ajout d’un projet est corrigé.
- **Compte d'équipe facultatif** : l'app marche sans compte ; la connexion est dans Réglages › Équipe. Le profil local (`currentUser`, photo comprise) n'est pas encore remplacé par celui du compte : à faire avec les rappels assignés (PR 3).
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

- **07/10/2026** — Veille des interfaces de chat IA, 9 wireframes desktop noir et blanc dans Figma.
- **08/10/2026** — Choix app de bureau (Electron). Création du dépôt, fondations, barre latérale et écran de conversation. Police unique Google Sans Flex.
- **14/10/2026** — Sortie du noir et blanc : tokens, icônes, logo et composants du design system KLYRA ; lucide-react retiré. Nouveau cadre d’après l’inspiration Figma `543-2765` : barre du haut (logo, recherche, actions), menu sur le fond de page (élément actif sombre, Projets, Réglages, carte utilisateur), contenu dans un panneau blanc arrondi. « Chats récents » retiré du menu.
- **21/10/2026** — Conversation à la façon d’OpenBot : les agents répondent pour de vrai (Claude Code en `stream-json`, session reprise par agent et par conversation), étapes repliables, passations (« Confié à Iris »), « Hugo réfléchit… 12 s », Stop, file d’attente, liste @. Barre latérale en messagerie : Équipe (une ligne par agent : rond pastel, rôle, dernier message, statut), Projets, Conversations d’équipe. Conversations directes `dm-<agent>`, conversations gardées dans `userData/conversations.json`.
- **29/10/2026** — Dépôt passé dans l’organisation KLYRA-FR. Les versions sont publiées dans `KLYRA-FR/klyra-app-versions` (action App et `electron/maj.ts`) ; les apps installées avant ce changement interrogent encore `pelin-klyra/klyra-app-versions` et doivent être réinstallées une fois depuis le nouveau dépôt. Vérification à chaque PR (`verification.yml`, Ubuntu) ; la publication échoue avec un message clair si `VERSIONS_TOKEN` manque.
  Windows : les textes suivent le système (`src/lib/plateforme.ts` : « ce Mac » ou « ce PC », Finder ou Explorateur, ⌘ ou Ctrl dans les raccourcis du canevas) ; barres de défilement fines et sans flèches hors Mac (`data-plateforme` sur la racine).
  Convex (PR 2) : comptes d'équipe en ligne sur Convex (Irlande). Déploiements `calculating-cuttlefish-710` (production, app installée) et `coordinated-ox-134` (développement, `pnpm desktop`). Connexion par lien magique de 15 min envoyé par PostShiba (`connexion@notifications.klyra.fr`) ; page relais `…convex.site/connexion` qui ouvre `klyra://connexion?code=…`. Sur invitation seulement ; Corentin, Pelin et Yanis admins. Les fonctions Convex sont déployées par l'action App avant chaque publication.
