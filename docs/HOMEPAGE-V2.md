# Homepage v2

Port de la version approuvée dans [projet-du-soir #22](https://github.com/CorentinQueuche/projet-du-soir/pull/22), commit source `14a5b1b9a998c42e8e4bb164fbd0894457479ef3`.

Le contenu HTML fixe est dans `site/components/homepage/contenu.ts`. La démo et les Canvas sont initialisés au montage de cette seule route. Les écouteurs, délais et images d’animation sont arrêtés au démontage. Les styles sont limités à `.klyra-homepage`, y compris le mode statique sous 1180 px. Le mouvement réduit affiche les conversations complètes, sans boucle d’animation continue. Les démonstrations sont signalées comme fictives.

Le changelog et ses accès restent disponibles. Le lien historique `/#fonctionnalites` est conservé ; le téléchargement reste au pied de page. Le formulaire simulé a été remplacé par un lien qui ouvre une demande dans l’application mail de la personne, vers le [contact public de KLYRA](https://klyra.fr/mentions-legales). Aucun mail ni inscription n’est envoyé par le site.

## Réserves vérifiées

- Google Sans Flex : [licence officielle OFL 1.1](https://github.com/googlefonts/googlesans-flex/blob/eef18c0047731c893e52add623f41169fe5cfc52/OFL.txt), notice et marques conservées dans `site/public/homepage/fonts/LICENSE.txt`. Les fichiers de la maquette, non modifiés, sont servis localement.
- Claude Opus 5.5 est attesté par `src/components/chat/ChoixModele.tsx`. Les versions précises de ChatGPT et Grok ont été retirées : leurs modèles sont découverts à l’exécution. OpenCode a été retiré du texte public puisqu’il n’est pas enregistré dans `electron/moteurs/index.ts` à la base de cette PR.
- Offre sur invitation et titre approuvé conservés. Aucun prix ni témoignage ajouté.

## Vérifier

```sh
pnpm site:build
pnpm exec tsc -p site/tsconfig.json --noEmit
node --test scripts/test-homepage-export.mjs
pnpm build
pnpm build:electron
pnpm typecheck
pnpm lint
```

Les commandes ci-dessus et le smoke Electron isolé passent chez l’auteur. Le build de l’app conserve son avertissement CSS préexistant sur `::highlight(klyra-recherche)` ; le build du site ne produit pas cet avertissement.

Contrôles navigateur : 375, 390, 768 et 1440 px, absence de débordement horizontal, changement d’exemple au clic et à Entrée, mouvement réduit puis retour normal, conservation des cartes au redimensionnement, navigation de la séquence et lien d’accès final. Le mailto est inspecté sans déclencher d’envoi. Le changelog et le retour vers l’accueil sont vérifiés. La validation visuelle par la direction du design reste un passage distinct avant publication.

## Archive et restauration

L’archive a son propre commit préalable `0371a48b0dc075765e7961b6a35dfbc704e4bf4c`, et conserve le main d’origine `5b57953668fc2b9e0078f4ff6814a63e40b5d229`. [Consulter, vérifier les empreintes et restaurer](../archives/homepage-2026-11-06/README.md). Elle est hors de l’export public. Aucun rétablissement de données de l’app n’est nécessaire.
