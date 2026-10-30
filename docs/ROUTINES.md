# Routines — fonctionnement, migration et vérification

Une routine appartient à **un agent actif**, avec une consigne autonome, un planning et un historique. Les workflows restent des chaînes distinctes : leur moteur, leur canevas, leurs données et leurs routes ne changent pas.

Références : relevé de Tempo et spécification d’Iris dans `Shared/klyra-app/routines-2026-10-30/`. Le suivi de livraison et ses limites sont dans `ETAT-IMPLEMENTATION.md` et `LIVRAISON.md`.

## Parcours

Menu **Automatisations**, onglet **Routines** (par défaut). L’onglet **Workflows** garde l’écran existant à `/routines?vue=workflows`. Les anciens liens `?vue=calendrier` et Planning → routines redirigent vers le nouvel écran.

Créer une routine : nom, agent actif, consigne, fréquence, fuseau IANA, comportement au retour, conversation directe ou projet. Huit fréquences simples : manuelle, une fois, horaire, quotidienne, jours ouvrés, hebdomadaire, mensuelle, intervalle. Les plannings avancés et cron déjà présents sont affichés, conservés et exécutés ; un remplacement par une fréquence simple est volontaire. L’aperçu des prochaines dates vient du moteur. Le brouillon local survit à une navigation hors de l’écran ; abandonner demande confirmation.

Le détail présente la prochaine exécution, les cinq prochains départs de la semaine, la consigne, le run actuel et l’historique. Les actions **Exécuter maintenant**, **Pause/Reprendre**, **Modifier**, **Interrompre** et **Supprimer** ont des effets séparés. Une suppression volontaire retire routine et historique, jamais les messages. Un run actif doit d’abord être interrompu. Les liens ouvrent la conversation sur la réponse concernée. Une permission en attente propose de répondre dans la conversation.

## Architecture et hôte

| Fichier | Responsabilité |
|---|---|
| `electron/routines/schedule.ts` | Neuf formes OpenBot + manuel ; calcul UTC depuis le fuseau IANA. Intervalle minimum 3 minutes. |
| `electron/routines/store.ts` | `userData/routines/routines.json`, transaction atomique avec fsync/rename, unicité routine/échéance, verrou de process. Historique conservé sans purge automatique, affiché progressivement par 50. |
| `electron/routines/engine.ts` | Minuteur unique, rattrapage, file par agent, états et réservation durable avant lancement. |
| `electron/routines/index.ts` | IPC, veille/réveil, observation des événements réels de l’agent, reprises d’écritures en erreur. |
| `src/lib/routines-livraison.ts` + `workspace.tsx` | Livraison à la conversation et à sa file habituelle. Messages déterministes par run ; sauvegarde immédiate avant le lancement. |
| `src/lib/routines.ts`, `routines-passages.ts` | Lectures/abonnements du moteur pour l’écran, l’agenda, l’accueil et la fiche agent. |
| `src/components/routines/` | Liste/détail, formulaire, planning. Aucun minuteur d’exécution. |

Le moteur est actif dans l’app installée : aucun flag de développement, aucun ancien minuteur de routine en secours. Il s’exécute uniquement **sur cet ordinateur, app ouverte** ; Convex ne lance aucun agent et ne synchronise pas ce fichier. App fermée, machine arrêtée ou en veille : rien ne part. Copier manuellement les données sur un deuxième ordinateur n’en fait pas un hôte partagé : chacun serait autonome.

## Règles d’exécution

- Une récurrence à heure civile fixe ne part qu’une fois lorsque cette minute se répète à l’automne. L’heure inexistante au printemps est sautée ; pour une exécution unique, elle est déplacée à la première minute valide. Les intervalles restent des durées absolues.
- Exécuter maintenant ne modifie pas l’échéance. Une routine ne peut avoir deux runs actifs. Un agent déjà occupé dans une autre conversation garde la routine en file.
- La pause concerne les futurs départs. Interrompre arrête le run actuel (ou annule son départ encore en file). Reprendre recalcule depuis maintenant sans rattrapage.
- Une exécution unique exige une date future. À l’échéance, elle passe en pause ; reprendre après la date demande une nouvelle date.
- Au retour, `skip` résume les échéances manquées en une ligne ; `run-once` lance seulement la dernière et résume les autres. Pas de rafale. Moins de cinq minutes de retard : lancement normal. Comptage plafonné à 999.
- Chaque run conserve nom, consigne, agent, projet et échéance. Réaffecter ou modifier la routine ne réécrit pas le run déjà créé.
- L’agent doit être actif et sa fiche présente à la création, à la reprise, à la mise en file et juste avant le lancement. Aucun agent n’est réactivé. L’assistant renommé garde l’id `principal`.
- États observables : `queued`, `running`, `needs-attention`, `succeeded`, `failed`, `interrupted`, `cancelled`. Le renderer ne peut pas prouver un succès. Une permission reçue maintient le run actif jusqu’à réponse/interruption.
- `routine_no_update` et `routine_report_failure` ne sont exposés qu’au contexte exact d’un run réellement lancé. Le premier supprime la notification, pas l’historique. Le second rend le run et la réponse en échec, même si le transport se termine sans erreur.
- Aucune interprétation du texte libre ne peut prouver que le travail métier est accompli : sans signal explicite, le succès signifie que l’agent a terminé son tour sans erreur observable.

## Livraison et redémarrage sans doublon

Avant l’appel à Claude, les deux messages sont écrits puis le main réserve le run sur disque (`claim`). Un second appel du même run, même après rechargement dans les 400 ms, est refusé. Les messages utilisent des identifiants stables ; une livraison non encore réclamée peut être reprise sans créer une deuxième consigne.

Un crash **entre la réservation et l’envoi effectif** laisse une exécution interrompue, jamais retentée automatiquement : on privilégie l’absence de doublon à une garantie de livraison. Une exécution en cours au redémarrage devient interrompue. Recharger la fenêtre arrête ses agents en cours et interrompt uniquement les runs de cette fenêtre ; un retry disque ne touche pas les runs lancés ensuite.

Une erreur de réservation n’appelle pas l’agent et finit le run en échec dès que le disque revient. Un résultat/état de permission non enregistrable est conservé en mémoire et retenté ; si l’app s’arrête avant réparation, le prochain démarrage marque le run interrompu. Le fichier précédent reste intact après erreur. Une lecture invalide bloque l’exécution et n’active aucune sauvegarde d’un workspace vide.

## Migration sans perte

À la première ouverture, le fichier complet `conversations.json` est copié vers `userData/routines/conversations-avant-migration.json` avant conversion atomique. La source est conservée, identifiants et échéances précédentes repris. Une entrée invalide fait échouer l’ensemble sans importer partiellement ni écraser la source ; le problème est visible. L’historique historique reste dans la sauvegarde et les conversations, sans inventer de statuts absents de l’ancien format.

Une ancienne chaîne contenant des relais reste stockée, **bloquée et en pause**. Le détail montre ses relais et propose explicitement « Garder seulement [agent] » avec confirmation. Cette action supprime les relais de la routine courante et reprend avec la première consigne ; leur sauvegarde reste intacte. Aucune conversion automatique vers un workflow.

## Écarts de parité assumés

Pas de webhooks/scripts externes, chaînage multi-agents, destinations de publication, calendrier externe ni quota `limitPolicy`. Les neuf formes de planning sont supportées par le moteur ; l’éditeur ne crée que les huit formes simples, les deux formes avancées existantes restent lisibles et exécutables. Le fuseau de la routine reste explicite et stable lorsque l’utilisateur voyage. Pas de service permanent ni d’exécution ordinateur arrêté.

## Vérifications

L’intégration avec Composio conserve ses capacités et son compte choisi dans le même contexte MCP que le run. La signature du processus dépend des deux. `test-routine-claude.cjs` vérifie ce renouvellement sans clé fournisseur, et `test-composio-runtime.cjs` vérifie sur le vrai serveur MCP les deux familles d’outils, le refus des signaux hors run et le maintien du compte choisi.

```bash
pnpm build:electron
pnpm test:routines
pnpm typecheck
pnpm lint
pnpm build
```

Les tests routines utilisent des dossiers temporaires, des horloges et des événements simulés, sans agent ou fournisseur réel. Ils couvrent les treize scénarios de Tempo, DST Paris/Lord Howe, file, pause, reprise, migration, rechargement, permissions et erreurs disque. Les CI existantes les exécutent sur Linux, Windows et Mac. Les preuves datées de parcours visuel, smoke et publication sont séparées dans le bilan partagé ; un test simulé ne vaut pas un essai de veille physique ou un parcours natif Windows/Mac.

## Retour arrière

Garder le SHA de main avant fusion et les sauvegardes de migration. Un correctif de retour arrière doit passer par une PR puis une nouvelle version, sans supprimer les données.

**Ne pas simplement réinstaller une ancienne version avec des routines historiques actives** : elle relirait l’ancien minuteur et ses échéances. Le retour sûr conserve les fichiers, désactive les départs dans le moteur et laisse l’ancien minuteur retiré ; le parcours précédent peut être rétabli séparément. Si l’on teste une version antérieure, utiliser une copie isolée des sauvegardes. Les nouvelles routines et l’historique restent dans `routines.json` pour une reprise ultérieure.
