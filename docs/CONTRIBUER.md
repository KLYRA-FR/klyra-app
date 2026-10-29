# Contribuer à l’app KLYRA

## Une branche, une pull request

1. Une branche par sujet, partie de `main` à jour :
   ```bash
   git switch main && git pull
   git switch -c fix/dictee-windows
   ```
2. Avant de pousser, les commandes de « Vérifier avant de livrer » du [README](../README.md).
3. Une pull request vers `main`, remplie avec le modèle (quoi, pourquoi, comment c’est vérifié).
4. La **Vérification** (onglet Checks) doit être verte : lint, build, types et démarrage de l’app, sur Ubuntu. Elle repart à chaque push sur la branche et ne publie rien.
5. Verte : tu fusionnes toi-même, puis tu supprimes la branche.

Jamais de push direct sur `main`, jamais de secret dans le code ni dans la PR.

## Fusionner, c’est publier

Chaque fusion sur `main` lance l’action **App** : elle fabrique l’app pour Mac et pour Windows, vérifie qu’elle démarre et que la dictée se lance, puis publie la version `0.1.<n>` dans [KLYRA-FR/klyra-app-versions](https://github.com/KLYRA-FR/klyra-app-versions/releases). **Toutes les apps installées la téléchargent dans l’heure** et l’installent quand on les quitte.

- Ne fusionne que ce qui est prêt pour tout le monde.
- Deux fusions rapprochées : la publication en cours est annulée, seule la dernière sort. C’est normal.
- Une publication en échec (rouge dans l’onglet Actions) ne publie rien : chacun garde sa version.

## Relancer une publication

Onglet **Actions** → **App** → **Run workflow** → branche **`main`** → **Run workflow**.

L’action refait le build et les tests Mac et Windows, puis publie un nouveau numéro de version. Choisis toujours `main` : lancée depuis une autre branche, elle publierait cette branche pour tout le monde.

Le dépôt des versions et le secret `VERSIONS_TOKEN` sont gérés par Corentin. Si la publication échoue sur « Le jeton de publication est configuré », c’est à lui de le renouveler.
