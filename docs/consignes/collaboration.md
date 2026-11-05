# Travail d'agent par Issue et PR

Une Issue est une unité de travail. GitHub suffit pour reprendre : un agent de n'importe quel membre doit pouvoir continuer sans la conversation d'origine.

Ce circuit vaut pour tout projet de KLYRA-FR. Sa logique est dans `electron/collaboration/` et ne suppose ni langage ni CI particulière. Le runner qui l'exécute n'existe pas encore : ces conventions s'appliquent à la main.

## Trois cas

| Cas | Quand | Circuit |
|---|---|---|
| Recherche | Aucun fichier versionné | Un agent, résultat dans l'Issue |
| Simple | Périmètre clair, risque faible | Un agent, PR, vérifications |
| Complexe | Plusieurs zones, décision à prendre, risque moyen ou élevé | Spécification, Issue, exécution, PR, review |

Une review ne se relance que sur un nouveau commit, deux tours au plus.

## Risque

Il dépend des fichiers touchés. On peut le relever, jamais le baisser.

- **Élevé**, validation humaine : les chemins du `CODEOWNERS` du dépôt, plus un jeu par défaut pour tout projet (CI, dépendances, authentification, secrets, migrations).
- **Faible**, vérifications seules : documentation, tests, images.
- **Moyen**, review par un autre agent : tout le reste.

Le calcul est dans `electron/collaboration/risque.ts`.

## Déroulé

1. Lis l'Issue et sa carte. Ne charge pas tout le dépôt : cherche d'abord les chemins et les symboles.
2. Réserve : crée la branche `agent/issue-<n>`. Si elle existe, quelqu'un a déjà la tâche : ne travaille pas dessus sans son accord. Écris aussitôt la carte, avec un bail de 2 h, prolongé à chaque mise à jour.
3. Travaille dans un worktree à toi. Chaque commit porte `Agent: <id>`, `Pour: <compte du responsable>` et `Issue: #<n>`.
4. Vérifie (`verification.md`), puis ouvre une PR avec `Closes #<n>` : ce qui change, pourquoi, ce qui est vérifié, les limites.
5. Réécris la carte avant de finir.

Deux essais pour un même défaut, puis statut bloqué avec la preuve. Pas de délégation depuis une délégation, pas de force-push. Une PR d'agent est fusionnée par Corentin.

## La carte de passation

Un seul commentaire par Issue, **réécrit**, jamais ajouté en journal :

Son format est dans `electron/collaboration/carte.ts` : un JSON dans un commentaire HTML, lu par le code, puis le même contenu en clair :

```markdown
Statut : en-cours · Responsable : @compte · Agent : id · Bail : date et heure
Analyse valable sur : <sha> · Chemins : a/b.ts, c/
Résumé : 5 lignes au plus
Décisions : ...
Vérifié : ... · Non vérifié : ...
Prochain geste : ...
```

Seule une carte écrite par un membre ou une App du circuit compte.

Avant de refaire une analyse : `git diff --quiet <sha> HEAD -- <chemins>`. Sans changement, reprends le résumé.

## Ce qui reste privé

Ta mémoire et tes conversations ne vont jamais sur GitHub. N'y écris que ce qui sert à reprendre, et jamais ce qui est confidentiel : ce dépôt est public.
