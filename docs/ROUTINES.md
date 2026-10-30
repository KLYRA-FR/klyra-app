# Routines — moteur et écarts avec OpenBot

Une routine = **un agent, une consigne autonome, un déclencheur, un historique d’exécutions**. Ce n’est pas un workflow : pas de nœuds, conditions, branches ni approbations (le moteur des workflows, `src/lib/workflows/`, n’est pas touché).

Référence : relevé d’OpenBot par Tempo (`Shared/klyra-app/routines-2026-10-30/RELEVE-OPENBOT.md`), état détaillé dans `ETAT-IMPLEMENTATION.md` (même dossier).

## Où vit quoi

| Fichier | Rôle |
|---|---|
| `electron/routines/schedule.ts` | Échéances : 9 plannings d’OpenBot (`once`, `hourly`, `daily`, `weekdays`, `weekly`, `monthly`, `interval`, `advanced`, `custom` cron 5 champs) + `manual` (propre à KLYRA). Heures lues dans le fuseau IANA de la routine, échéances en UTC. Cadence minimum 3 min (cron vérifié sur 200 occurrences). |
| `electron/routines/store.ts` | `userData/routines/routines.json`, écrit d’un bloc (fichier temporaire, fsync, renommage). Une échéance planifiée = une exécution au plus. 100 exécutions gardées par routine. Fichier illisible : rien n’est exécuté, il n’est jamais écrasé. Verrou `routines.lock` contre un second process. |
| `electron/routines/engine.ts` | Le planificateur : un seul `setTimeout` (plafonné à 24,8 jours) vers la prochaine échéance, rattrapage, file par agent, comptes rendus. Sans Electron (testé en Node). |
| `electron/routines/index.ts` | IPC `routines:*`, veille/réveil (`powerMonitor`), l’hôte = la fenêtre qui a appelé `routines:pret`. |
| `electron/routines/migration.ts` | Reprise, une fois, des routines de l’ancien minuteur (`conversations.json`) ; identifiants gardés. |
| `src/lib/routines-livraison.ts` | Côté interface : poste l’exécution dans la conversation de l’agent par `envoyer` (file d’attente comprise), suit la réponse (`routineRun` sur les deux messages), renvoie `queued / running / succeeded / failed`. |

## Comportement

- **Exécution** : la consigne part comme un message de la personne (`Routine « Nom »\n\nconsigne`) dans `dm-<agent>`, ou dans `routine-<id>` si la routine a un projet ou des relais (comme avant). La réponse de l’agent est le résultat ; l’exécution garde le début du texte et le lien conversation + message.
- **Instantanés** : chaque exécution copie le nom et la consigne ; modifier la routine ne réécrit pas l’historique.
- **Exécuter maintenant** : exécution `manual`, la programmation ne bouge pas ; refusée si la routine a déjà une exécution non terminée.
- **Pause** : plus d’exécution future, prochaines vides ; l’exécution en cours continue (l’interrompre est une action à part). **Reprise** : prochaine échéance recalculée depuis maintenant, sans rattrapage.
- **Une fois** : date future obligatoire ; après l’exécution, la routine passe en pause et garde sa date ; la réactiver demande une nouvelle date.
- **File** : une exécution de routine à la fois par agent ; au plus une exécution en attente par routine (une échéance de plus est résumée « l’exécution précédente attendait encore »). Dans la conversation, la file habituelle s’applique aussi (l’agent répond d’abord à ce qu’il fait).
- **App fermée, veille** : aucune exécution app fermée (pas d’autre hôte). Au retour, `skip` (défaut) enregistre une seule ligne « N non exécutées » ; `run-once` exécute la plus récente en retard et résume les autres. Une échéance dépassée de moins de 2 min part normalement. Compte plafonné à 999.
- **Arrêt brutal** : une exécution `running` devient `interrupted` au lancement suivant (Claude Code s’arrête avec l’app) ; une exécution confiée mais pas encore postée est renvoyée avec le même identifiant, et l’interface ne la poste jamais deux fois.
- **Erreurs lisibles** : réponse en erreur → `failed` avec le message ; agent introuvable → `failed`, rien n’est envoyé ; une routine dont le planning ne se calcule plus est mise de côté sans bloquer les autres.

## Écarts avec OpenBot (assumés ou à décider)

- **Pas encore branché sur l’écran** : actif seulement avec `KLYRA_ROUTINES=moteur`. Sans la variable, l’ancien minuteur de `workspace.tsx` (30 s, heure locale, sans unicité) reste seul.
- **Relais (chaîne entre agents)** : gardés dans les données, **pas exécutés** par le moteur (hors premier socle). À décider : les porter dans le moteur ou les retirer.
- **Signaux de fin** (`routine_no_update`, `routine_report_failure`) : pas encore d’outil MCP côté app ; l’état vient de la réponse (fait / erreur).
- **Quota du fournisseur** (`limitPolicy`) : absent ; une exécution lancée quand la limite Claude est atteinte finit en échec lisible.
- **Heure doublée à l’automne** pour un planning à heure fixe : deux passages (comportement inféré d’OpenBot, non vérifié). L’heure sautée au printemps : pas de passage ce jour-là. `once` : première minute valide / premier passage.
- **Changement de fuseau de l’utilisateur** : la routine garde son fuseau ; pas de proposition « Déplacer / Garder ».
- **Mise à jour de l’app** : pas de « hold » ; une mise à jour redémarre l’app, la règle de l’app fermée s’applique.
- **`needs-attention`** (agent qui attend une autorisation) : non distingué de `running`.
- **Liens, webhooks, scripts, destinations externes, calendrier** : hors socle.

## Tester

```
pnpm build:electron && pnpm test:routines
```

`test:routines` = 14 cas d’échéances + 26 du moteur (les 13 scénarios du relevé, veille, plafond, verrou, fichier illisible, reprise). Dossiers temporaires, horloge simulée, aucun agent lancé. En CI sous Linux, Windows et Mac.

Bout en bout, sans vrai agent : un faux `claude` qui répond en `stream-json` (`KLYRA_CLAUDE_PATH`), `HOME` et `KLYRA_USER_DATA` temporaires, `KLYRA_ROUTINES=moteur` et `KLYRA_SMOKE_TEST=1`, une routine due dans `routines/routines.json`.
