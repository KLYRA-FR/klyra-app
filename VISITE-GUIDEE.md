# Visite guidée des pages de KLYRA

Intégration préparée sur `main` au commit `af9b934`.

## Comportement

- Après une première conversation terminée et la clôture de l’onboarding, proposer la visite. Les profils historiques sans conversation d’onboarding ne sont pas interrompus.
- Présenter les onze espaces : Accueil, Chats, Mes agents, Tickets, Planning, Automatisations, Artefacts, Projets, Connexions, Serveurs et Réglages.
- Naviguer sur les vraies pages et mettre un repère en lumière, sans lancer d’action métier.
- Précédent/Suivant, flèches gauche/droite, Échap, fermeture et interruption ; retour à la page de départ. Piège de focus natif du dialogue et retour au bouton d’aide.
- Conserver la progression dans le stockage local du profil de bureau, sous `klyra:visite-guidee:v1`. Une visite interrompue se reprend à la demande, une visite terminée peut être rejouée.
- Point d’entrée permanent : Réglages → Général → Aide et découverte. Indexé dans la recherche des réglages.
- Si le stockage est indisponible, garder la progression en mémoire et l’annoncer. Une donnée illisible est ignorée.

## Design

Charte existante KLYRA : Google Sans Flex, bleu K1 `#003fe4`, surfaces claires et tokens existants. Carte de lecture, corps 15 px, repères et boutons 13 px, cibles de 44 px. La distinction vient de la visite des pages réelles et de la voix directe du produit. Aucune dépendance ajoutée, aucun écran de configuration reproduit.

Contrastes calculés : texte secondaire sur blanc 7,00:1 ; texte principal sur fond clair 12,54:1 ; blanc sur bleu K1 7,42:1.

## Validation effectuée

- Build Next exporté et compilation Electron : réussis.
- `npm run typecheck` : réussi.
- `npm run lint` : zéro erreur, neuf avertissements dans le fichier inchangé `electron/navigateur/chrome-poste.ts`. Fichiers générés du serveur à jour.
- `scripts/test-visite-guidee.mjs` dans Electron sous Xvfb : navigation des onze pages, repères, retour arrière, Tab, Échap, focus, reprise après rechargement, fin persistée, largeurs 1280/768/375 px, absence d’exception JavaScript et profil préservé.
- `scripts/test-prise-en-main.mjs` : parcours complet avec fournisseur factice et invitation de visite après sa clôture, puis parcours d’exploration.
- `scripts/test-mode-onboarding.mjs` : simulation existante, sans modification des comptes ni du profil.
- Relecture visuelle des captures Accueil, Connexions, Réglages et petite fenêtre. Liens de l’aperçu vérifiés.

Les tests utilisent des profils jetables et des fournisseurs simulés. Le pilote de test tolère désormais les réponses CDP sans résultat pendant un rechargement. Le build conserve l’avertissement CSS préexistant sur `::highlight(klyra-recherche)`.

## Limites et intégration

Implémentation pour la coque de bureau uniquement. Le rendu étroit est contrôlé dans Electron, pas dans la coque téléphone. Ni paquet signé macOS/Windows, ni validation sur ces systèmes, ni déploiement. La progression est locale au profil, sans synchronisation entre appareils. La livraison suit le circuit PR → Vérification → fusion → workflow App décrit dans `docs/CONTRIBUER.md`.

