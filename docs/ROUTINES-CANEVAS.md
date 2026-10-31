# Routines sur le canevas — recette du 31 octobre 2026

Responsable : Noé. Suivi : klyra-app — routines sur le canevas (openbot-thread-76795551-020b-4902-85be-2b54c416d442).

Base relue sur origin/main avant création du worktree : `a2d320bd2fcccc8b19b8c9517e7f060533b55183`.
Référence : SPEC-CANEVAS.md d'Iris du 31/10, complétée par les comportements conservés de SPEC-ROUTINES.md du 30/10.

## Périmètre

La colonne des agents précède le canevas dans le DOM ; la barre occupe sa première ligne visuelle. Une routine reste une carte reliée à l'unique carte de son agent. Placement mesuré, déplacement du fond, zoom et focus sont propres à cette vue et ne sont pas enregistrés. Le formulaire existant apparaît dans un panneau de 380 px ; l'historique dans un panneau de 300 px. Un seul panneau est affiché.

Les fichiers du moteur, des types, de `src/lib/routines*.ts`, de FormulaireRoutine et PlanningRoutine sont inchangés. Aucun import des dossiers workflows ; les petites pièces visuelles sont recopiées. `DetailRoutine` est retiré. Les seules modifications à LignesBarre exportent ses trois constantes existantes. Les règles CSS ajoutées ciblent uniquement les classes `klyra-routines-*`.

## Banc de vérification

Les gestes passent par OpenBot Browser sur l'export de production, avec le preload compilé, le moteur, son adaptateur IPC et le stockage de conversations réels. Le fournisseur IA, Electron et les comptes sont simulés par le banc existant ; toutes les données sont dans des dossiers temporaires. Aucun compte fournisseur ni agent réel n'est appelé.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm build:electron
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test:routines
node scripts/routines-browser-fixture.cjs --self-test
node scripts/routines-browser-fixture.cjs --cas=canevas --self-test
node scripts/routines-browser-fixture.cjs --cas=canevas --moteur-arrete --self-test
node scripts/routines-browser-fixture.cjs --cas=canevas --port=3187
node scripts/routines-browser-fixture.cjs --cas=canevas --moteur-arrete --port=3188
```

Build web/Electron, typage et lint : réussis. 83 scénarios de routines : 16 programmation, 47 moteur, 11 IPC et 9 contexte Claude. Les trois self-tests du banc passent. L'avertissement CSS préexistant de Lightning CSS sur `::highlight(klyra-recherche)` reste au build ; aucun avertissement ESLint.

Démarrage natif vérifié sous Linux, fenêtre invisible, profil applicatif temporaire :

```bash
env -u ELECTRON_RUN_AS_NODE KLYRA_SMOKE_TEST=1 KLYRA_USER_DATA=/tmp/klyra-routines-canvas-smoke-20261031 timeout 120 xvfb-run -a corepack pnpm exec electron . --no-sandbox
```

Le smoke quitte avec 0 et rend le message de conversation absente du profil vide. Ce contrôle prouve le démarrage et le rendu ; les gestes des routines sont vérifiés dans le banc ci-dessus.

## Les 17 points du §12

| # | Vérification et résultat |
|---|---|
| 1 | Colonne et fond pointillé présents. Changement vers Workflows exercé ; fichiers workflows identiques à la base (preuve ci-dessous). |
| 2 | Premier agent avec routines : assistant fictif, trois cartes et une carte agent. Mesures DOM : les quatre cartes sont visibles dans la zone 812 × 715, zoom 0,6 ; trois liens décoratifs, sans chaîne d'agents. |
| 3 | Choix d'un autre agent par la colonne écrit `agent=dev` et réajuste la vue. Le lien contenant seulement `routine=canevas-attente` devient `agent=principal&routine=canevas-attente`. |
| 4 | Agent actif `sans-routine` choisi au clavier : carte vide et trois exemples. Entrée sur Point de la semaine ouvre le formulaire pour cet agent, avec consigne et planning hebdomadaire préremplis. |
| 5 | Création exercée avec l'assistant puis avec `sans-routine`. La carte brouillon suit le nom ; après enregistrement, carte choisie, URL complète, focus sur sa section, carte visible et brouillon local effacé. |
| 6 | Sortie vers Workflows et changement d'agent pendant une saisie modifiée : confirmation. Continuer conserve la saisie ; Abandonner autorise le changement. Rechargement : carte brouillon avec Reprendre et Abandonner ; reprise conserve le nom modifié. |
| 7 | Lancement depuis une carte, sans sélection préalable : En cours, pastille travaille, bordure `border-bleu-k2-500` et lien `stroke-bleu-k1-500`. La prochaine date du planning reste identique. Un second lancement sur le même agent occupé est affiché En attente. Permission : Attend ton accord et lien vers la demande. |
| 8 | Travail fictif long : confirmation puis Dernière : Interrompue. Second départ en file : confirmation puis Dernière : Annulée, avec Annulée avant son lancement. |
| 9 | Pause depuis le pied : En pause, Reprendre, tuile pause et trait pointillé. La conservation d'un run actif pendant la pause est couverte par les scénarios du moteur ; aucun appel d'interruption dans le geste pause. |
| 10 | Exécutions de la routine choisie : cinq dates, 50 lignes sur les 55 du banc, snapshots repliables et bouton des précédentes. L'URL du résultat contient l'id de conversation et celui du message durable du banc ; le transport et la conservation du lien sont vérifiés par le self-test. |
| 11 | Suppression au clavier depuis le menu : confirmation puis carte retirée et compteur passé de trois à deux. Refus pendant un run couvert par le moteur et par le bouton Supprimer indisponible de la carte. |
| 12 | Agent désactivé sous Hors de Mes agents ; état explicite sur sa carte ; Exécuter et Nouvelle routine indisponibles, motif visible. Clic droit puis Changer d'agent : formulaire ouvert, focus mesuré dans `data-champ=agentId`. Échap rend le focus au bouton d'actions de la carte. |
| 13 | Ancienne chaîne : carte bloquée, relais conservés avec noms affichés, un seul lien vers le propriétaire. Garder seulement l'assistant demande confirmation, retire les relais et rend la carte normale avec sa prochaine date. |
| 14 | Banc arrêté : colonne visible, erreur centrale et Réessayer ; Exécutions et Nouvelle routine indisponibles, aucune carte actionnable. |
| 15 | Entrée choisit l'agent, ouvre l'exemple, crée et ouvre le menu ; flèche haut atteint Supprimer ; Entrée ouvre sa confirmation. Exécutions s'ouvre au clavier et Échap le ferme avec retour du focus. Ordre DOM, caméra suivant le focus et contour de 2 px hors du monde mis à l'échelle relus. |
| 16 | Fenêtre 1100 px : panneau formulaire mesuré 380 px en position absolute, sans débordement. Équivalent de largeur CSS à 200 % : viewport 550 px, deviceScaleFactor 2 ; colonne masquée, combobox Agent visible, panneau et corps de mêmes dimensions (442 × 605,5), aucun débordement. Capture dans le fil de la tâche. |
| 17 | Diff des dossiers workflows et de tous les fichiers protégés vide. Aucune occurrence de `positions` ni import workflows dans `src/components/routines/`. |

Les contrôles vocaux avec lecteur d'écran et les gestes natifs sur Mac/Windows ne sont pas exécutés localement. Le viewport réduit vérifie les seuils CSS ; ce n'est pas une session Electron avec zoom système réel. Les scénarios moteur couvrent aussi veille, DST, reprise, permissions, absence d'agent et disque illisible ; ces cas ne sont pas reproduits sur des données utilisateur.

## Preuve d'isolation

```bash
git diff --exit-code a2d320bd2fcccc8b19b8c9517e7f060533b55183 -- src/components/workflows/ src/lib/workflows/ electron/routines/ 'src/lib/routines*.ts' src/types/routines.ts src/components/routines/FormulaireRoutine.tsx src/components/routines/PlanningRoutine.tsx
rg -n 'positions|from .*workflows' src/components/routines/
```

Le premier contrôle retourne 0 et ne produit aucun diff ; le second ne trouve rien. Arbres Git conservés pour les workflows :

- `src/components/workflows` : `6a0f47702570bfef20a68acd6997da18125c5370`
- `src/lib/workflows` : `cdc99e52ce0899d62657b82f791740112d5bc310`

## Publication et retour arrière

La PR peut être fusionnée uniquement après vérification verte de sa tête exacte. Avant : sauvegarder la tête distante de main sur une branche `sauvegarde/main-avant-canevas-routines-20261031`, puis fusionner avec garde sur le SHA de la PR. La fusion déclenche l'action App.

Après : contrôler le SHA du run App, les jobs Mac/Windows/Convex et la release correspondante dans klyra-app-versions, avec les cinq artefacts attendus (DMG, ZIP, setup Windows, latest-mac.yml, latest.yml). Aucun changement de données ou de schéma dans ce lot. Retour arrière : nouvelle PR qui annule uniquement ce changement, CI verte, fusion et nouvelle publication ; les routines restent lisibles par la version précédente. Ne pas restaurer ni supprimer leurs données.
