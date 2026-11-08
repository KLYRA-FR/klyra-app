# Page Mémoire de klyra-app

> Ce document décrit le premier prototype local. La V2 durable et sa recherche progressive sont décrites dans `SECOND-CERVEAU.md`.

Prototype sur la branche `prototype/memoire-a07e528f`, à partir de `35f82d3`.
La version installée de KLYRA et le serveur ne sont pas modifiés.

## Parcours livré

- Entrée **Mémoire** dans la navigation native, route statique `/memoire`.
- Graphe SVG sur fond sombre : points lumineux, liens explicites, sélection d’un voisin, déplacement du fond, zoom et recentrage.
- Lecture d’une note dans le panneau latéral ; recherche dans les titres, contenus et titres des sources ; filtre par projet.
- Création, modification, liens entre notes et suppression avec confirmation.
- Menu d’un message → **Garder en mémoire** → relecture et confirmation → nœud.
- Un extrait d’origine reste attaché à la note. **Revenir au message** utilise la navigation et la mise en évidence existantes de KLYRA.
- Démonstration explicitement signalée, en mémoire temporaire, séparée des notes conservées.

Le graphe représente des connexions choisies par la personne. Il ne prétend pas inférer des relations sémantiques ou représenter un réseau neuronal d’IA.

## Stockage et limites

`localStorage`, clé versionnée `klyra:memoire:prototype:v1:<lieu encodé>` : une mémoire par poste ou serveur sélectionné. Les notes restent physiquement dans le profil local de l’app, même pour un serveur. Aucune écriture sur le VPS ni synchronisation entre appareils. Un autre profil ou une suppression du stockage local ne retrouve pas ces notes.

Aucun appel de modèle, lecture automatique des notes par les agents, import Obsidian, recherche vectorielle ou génération automatique de liens. La suppression d’une note conserve le message d’origine. Un stockage corrompu ou d’une version inconnue est signalé et ne peut pas être écrasé par le formulaire. Si le stockage est plein, le formulaire conserve le texte et affiche l’erreur.

Le placement par forces est déterministe et adapté à ce petit prototype. Les performances d’un grand corpus n’ont pas été validées. Un message disparu conserve son extrait dans la note et le retour à la source explique son indisponibilité.

## Interface

- Identité, police Google Sans Flex, bleu `#003fe4` et navigation existants de KLYRA.
- Interface claire ; graphe sombre, éclairage bleu monochrome, aucune animation permanente.
- Densité de l’app conservée. Les styles sont limités au préfixe `.memoire-`.
- Différenciation : les notes et leurs sources constituent la constellation ; aucune connexion décorative présentée comme une connaissance.
- Contrastes calculés : texte secondaire/blanc 7,00 ; blanc/bleu 7,42 ; texte du graphe/fond 11,50 ; légende/fond 10,55 ; bleu sombre/fond teinté 8,32.
- Cibles de nœuds agrandies par un trait transparent qui ne change pas de largeur avec le zoom. Navigation des nœuds au clavier, focus visible et état vide dédiés.

## Vérification et reproduction

Dans le projet avec les dépendances déjà présentes :

```sh
npm run build
npm run build:electron
npm run lint
node_modules/.bin/vitest run src/lib/memoire.test.ts
xvfb-run -a node scripts/test-memoire.mjs --no-sandbox
node scripts/apercu-memoire.mjs /chemin/vers/apercu-memoire
```

Sous Linux, ajouter au PATH le Node disponible sur le poste ; `--no-sandbox` est réservé au harnais de test de ce VPS. Aucun téléchargement ni installation n’est nécessaire pour les contrôles effectués ici.

Les tests Electron utilisent un profil, un HOME et une conversation jetables : navigation réelle, démonstration, clavier, zoom, recherche, capture par le menu réel, relecture, persistance après rechargement, retour au message exact avec focus, connexion de deux notes, modification, suppression, largeurs 1440/768/390 et échec de stockage. Le test vérifie aussi l’absence d’appel à un modèle ou de connexion de compte.

Les cinq tests unitaires couvrent la séparation des lieux, la relecture, le refus d’écrasement d’un stockage invalide, les erreurs d’écriture, les arêtes explicites et leur nettoyage, la recherche sans accents et le placement déterministe.

L’aperçu autonome utilise **le même composant `MemoireVue`** ; sa coque est réduite aux deux parcours de démonstration. La capture Electron montre la page dans la vraie coque de klyra-app. Aucun contrôle de performance à grande échelle, lecteur d’écran ou déploiement sur l’ordinateur de Corentin n’a été effectué.

Le lint complet passe avec neuf avertissements préexistants dans `electron/navigateur/chrome-poste.ts`. Aucun avertissement dans les fichiers ajoutés ou modifiés pour la mémoire. Repérage des sources par recherches ciblées ; graphify absent du poste, aucune installation effectuée.
