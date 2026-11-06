# Landing remplacée le 6 novembre 2026

Archive créée avant toute modification de la homepage. Référence source :
`5b57953668fc2b9e0078f4ff6814a63e40b5d229` (main).

- `source.tar.gz` : snapshot complet des fichiers suivis de ce commit.
- `site-export.tar.gz` : ancien site construit avec `pnpm site:build`, autonome,
  avec HTML, styles, scripts, polices, logos et changelog.
- `SHA256SUMS` : empreintes des deux archives.

Ce dossier est hors de `site/public` et de `site/app` : il n'est ni publié
ni proposé à l'indexation comme deuxième accueil.

## Consulter l'ancienne page

Depuis la racine du dépôt :

```sh
sha256sum -c archives/homepage-2026-11-06/SHA256SUMS
mkdir -p /tmp/klyra-landing-20261106
tar -xzf archives/homepage-2026-11-06/site-export.tar.gz -C /tmp/klyra-landing-20261106
python3 -m http.server 8796 --directory /tmp/klyra-landing-20261106
```

Ouvrir `http://localhost:8796/` (et `/changelog/`). Aucun fournisseur,
compte, base ou dépendance réseau n'est nécessaire pour cet export.

## Restaurer

Sur une branche depuis le main courant, ouvrir une PR qui annule seulement
les changements d'intégration de la homepage v2. Conserver ce dossier d'archive.
Ne pas réinitialiser main et ne pas annuler les PR suivantes. Si les commits
de cette PR sont conservés, annuler dans l'ordre inverse les commits qui
suivent le commit d'archive `0371a48` (sans annuler ce dernier). En cas de
squash, annuler le commit fusionné en conservant ce dossier dans la PR de retour.

Vérifier `pnpm site:build`, `pnpm typecheck`, `pnpm lint`, le démarrage
de l'app et les deux routes. Faire fusionner selon les protections en vigueur.
La connexion Git de Vercel republie alors main. Vérifier l'URL de production,
les liens et `/changelog/`. Aucune donnée de l'app n'est à restaurer.

Le snapshot source permet aussi de reconstruire à l'identique dans un autre
dossier (`pnpm install --frozen-lockfile`, `pnpm site:build`). En cas de besoin
immédiat, l'export archivé est le point de retour statique ; son déploiement
doit passer par le responsable du projet Vercel et les autorisations en vigueur.
