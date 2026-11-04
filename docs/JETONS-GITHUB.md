# Jetons GitHub des agents

Quand un projet de l'app passe par le circuit des Issues, ses agents n'utilisent pas le compte de la personne : ils demandent un jeton d'une heure, limité au dépôt de ce projet. Cela vaut pour tout projet relié à GitHub, pas seulement pour klyra-app.

| App | Rôle | App ID | Code |
|---|---|---|---|
| `klyra-agents` | Exécuter : code, Issues, PR | 5618456 | Écriture |
| `klyra-reviewer` | Relire : Issues, PR | 5618483 | Lecture |

Aucune n'a `administration`, `workflows` ni `secrets`. Deux conditions pour qu'un jeton soit émis :

1. L'App est installée sur le compte qui possède le dépôt.
2. `accesDepots` accorde ce dépôt à la personne.

**La limite vient donc du code** : quelle que soit l'installation, chaque jeton ne vaut que pour un dépôt.

## Poser les clés

Une fois par App, sur le déploiement de production : tableau de bord Convex › Settings › Environment Variables.

| Variable | Valeur |
|---|---|
| `GITHUB_APP_AGENTS_CLE` | Tout le contenu du `.pem` de `klyra-agents` |
| `GITHUB_APP_REVIEWER_CLE` | Tout le contenu du `.pem` de `klyra-reviewer` |

Un retour à la ligne perdu au collage n'est pas un problème, la clé est reconstruite. Jamais de clé dans Git, une conversation ou une Issue.

## Accorder ou retirer un accès

Seulement depuis le tableau de bord Convex (Functions) ou `npx convex run` : aucun écran ni agent ne peut s'accorder un accès. La personne doit s'être connectée une fois à l'app.

```bash
npx convex run --prod jetonsDepot:accorder '{"email":"prenom@klyra.design","depot":"KLYRA-FR/klyra-app"}'
```

```bash
npx convex run --prod jetonsDepot:retirer '{"email":"prenom@klyra.design","depot":"KLYRA-FR/klyra-app"}'
```

## Demander un jeton

`jetonsDepotEnvoi:demander` avec `{ depot, role }`, par une session de l'app. Trente demandes par heure au plus, par personne. Chaque demande est tracée dans `demandesJetonDepot`, jamais le jeton.

| Refus | Sens |
|---|---|
| `depot_invalide` | Pas un nom de dépôt GitHub |
| `depot_non_autorise` | Accès non accordé à cette personne |
| `jetons_non_configures` | Clé absente, invalide, ou refusée par GitHub |
| `app_non_installee` | L'App n'a pas accès à ce dépôt |
| `github_indisponible` | GitHub ne répond pas ou est en erreur |
| `trop_tot` | Limite horaire atteinte |
