# Prise en main de KLYRA

Un profil neuf est accompagné jusqu’à sa première réponse : assistant, IA, accès, demande, conversation.
Le guide concerne cet ordinateur. Les invitations et un serveur actif conservent leur parcours ; aucun moteur local ne leur est imposé.

## Direction retenue avec Corentin

Marque : identité KLYRA existante, composants et tokens du studio.
Police : Google Sans Flex ; monospace réservé aux métadonnées.
Accent : `#003fe4` (bleu K1, contraste blanc dessus : 7,42:1), bouton Principal noir à écran de points.
Densité : calme, corps 15 px, contrôles d’au moins 44 px.
Mode : clair, comme l’app actuelle.
Divergence : le même assistant prend son nom, accompagne la préparation de son IA et rejoint la vraie conversation.

Les petites cartes de la scène illustrent les usages ; elles ne prétendent pas montrer un travail en cours. Les transitions d’étape durent 200 ms ; le suivi du pointeur et les entrées s’effacent avec la préférence de mouvement réduit.

## État et reprise

### Rejouer le parcours soi-même

Dans l’app de bureau : **Réglages → Général → Tester l’onboarding → Lancer le mode test**. La recherche des réglages trouve aussi « onboarding », « premier lancement » et « simulation ».

Le mode test reprend les écrans du vrai guide. Donner un nom, installer puis connecter une IA, choisir les accès et rédiger une demande se fait uniquement en mémoire. La dernière étape montre la demande et une réponse explicitement simulée : aucun message n’est envoyé, aucun programme installé, aucun compte connecté. Pour Grok, saisir seulement une clé fictive.

Le bandeau indique le mode test sur chaque écran. **Échap**, **Quitter le mode test** ou **Revenir à mon espace** rendent les réglages avec le focus sur le bouton de lancement. **Recommencer le test** repart du début ; fermer l’app abandonne la simulation. Les conversations, le nom réel, les accès et la progression du véritable premier lancement restent intacts.

Le test de non-régression `scripts/test-mode-onboarding.mjs` parcourt l’interface exportée avec de vrais IPC sur un profil temporaire. Il vérifie la conservation des fichiers, l’absence d’appel aux comptes et aux mutations du guide, la navigation et la sortie au clavier. Il est inclus dans `test:onboarding` ; la connexion réelle et l’adaptateur restent exercés séparément par le scénario du premier lancement.

`prise-en-main.json` vit dans le `userData` de ce poste. Il est indépendant du nom de l’assistant et des conversations. Les écritures sont sérialisées puis remplacées atomiquement.

- Fichier absent et assistant jamais nommé sur un profil neuf : nouveau parcours.
- Fichier absent sur une installation existante : déjà terminé ; aucune remise à zéro de l’équipe ou de l’historique.
- Fichier présent : reprise de l’étape, du fournisseur et du brouillon, y compris après le nommage.
- Fichier illisible : erreur et nouvelle tentative ; le fichier est conservé.
- Exploration : le guide reste inachevé et l’accueil offre sa reprise. Un serveur actif n’affiche pas la reprise locale.

Le choix d’IA réutilise `moteurs` : liste, compte, installation, connexion et progression. Une action explicite déclenche chaque installation ou connexion. Le retour de focus permet de relire l’état du fournisseur. La connexion est vérifiée à la sortie du choix d’IA puis avant le premier envoi.

Claude Code rejoint les moteurs installables depuis le registre officiel, avec le même contrôle d’intégrité que Codex et Grok. Sa copie gérée par KLYRA est préférée aux installations détectées sur le poste, sans les modifier. Une mise à jour de cette copie passe également par l’installeur géré.

Le fournisseur choisi est enregistré dans les préférences de l’assistant, repris dans ses nouveaux échanges et explicitement appliqué à la conversation de départ. Une IA non prête ne déclenche pas de repli silencieux vers Claude.

## Première réponse

Les suggestions préremplissent la demande sans envoi. Le brouillon est gardé après une courte pause et à l’envoi. La première conversation utilise l’identifiant local stable `dm-principal` et le fournisseur sélectionné.

Le guide se poursuit au-dessus du vrai fil, sans masquer les étapes de travail. Sa dernière action n’est proposée qu’après une réponse textuelle terminée de l’assistant, postérieure au début de cette conversation guidée. Une erreur ou un arrêt laisse la possibilité de revoir l’IA avec la demande conservée.

Le niveau d’accès existant est expliqué, sans être présenté comme une isolation des fichiers. Le pilotage de l’ordinateur et les intégrations restent séparés et facultatifs. Le compte d’équipe KLYRA n’est pas un prérequis à une demande locale.

## Vérifier

Prérequis : les dépendances du projet et les outils système déjà disponibles. Aucun compte réel requis par ces scénarios.

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm build:electron
pnpm test:moteurs
xvfb-run -a pnpm test:onboarding --no-sandbox
xvfb-run -a pnpm test:agents --no-sandbox
```

`test:onboarding` vérifie les contrats de stockage puis exécute l’export réel, le vrai IPC et l’adaptateur Codex devant un registre et un petit programme de test locaux : empreinte refusée puis nouvelle tentative, connexion, brouillon après fermeture, connexion expirée avant envoi, fournisseur réellement choisi, réponse et fin du parcours, exploration et reprise.

`KLYRA_TEST_PREUVES=/chemin` garde les captures. Elles montrent le vrai rendu avec un fournisseur simulé et ne prouvent pas une connexion à un compte commercial. Le scénario d’interface utilise un binaire de test Unix ; les contrats de stockage sont indépendants du système. Les confirmations d’authentification et installations réelles restent à vérifier sur Mac et Windows.

Les scénarios d’interface historiques préparent un parcours déjà terminé dans leurs profils fictifs pour rester centrés sur leur fonctionnalité. Le scénario dédié demande `priseEnMain: true` au pilote et n’écrit pas ce marqueur.
