# Journal super-agent

Le journal est un fichier SQLite sur ce PC : `userData/superagent.sqlite`. Le process principal est le seul écrivain. L'écran et les agents ne l'ouvrent pas. Le renderer garde les conversations dans `conversations.json` et envoie des faits (identifiant de fil, message, statut).

## Ce qui est tenu

Un fil Klyra ouvert avec `ouvrir_fil` crée un travail, une politique limitée à cette conversation, et une occupation. Il y a trois places. La quatrième attend, le fil n'est pas gardé. Une précision (`ecrire_dans_fil`) rejoint le même travail. Un même message source ne crée pas un second travail. `arreter_fil` suspend : l'opération déjà partie reste en vol, elle est listée, elle n'est pas rejouée. `reprendre_fil` exige une référence de contrôle, y compris pour sortir d'une attente `waiting_machine`. Un travail terminé ou annulé ne reprend pas. `fermer_fil` refuse tant qu'une opération est à constater.

Une nouvelle consigne (`changement_objectif`) avance `objective_revision` et annule les intentions encore `planned`. Une opération `inflight` n'est ni annulée ni relancée : son motif devient `effet_deja_parti:controler`. Une priorité (`priorité : N` dans le résumé) est écrite sur le travail. Les deux se décident en code, sans appel de modèle.

La décision est du code, sans appel de modèle. Le routeur de l'app est `principal`. Un mail, une publication, un push sur `main`, un paiement ou une suppression est refusé. Le plafond de dépense absent bloque la préparation anticipée. `waiting_machine` est un état du journal. Il n'appelle aucun PC Windows et ne lève pas le point 33.

Le watchdog tourne dans l'app toutes les 15 minutes. `superagent:passage` appelle la même fonction, pour un contrôle qui ne peut pas attendre. Il écrit une alerte. Il ne relance pas, ne ferme pas, n'écrit pas dans le fil. La routine OpenBot de Tempo reste inactive.

L'écran d'un projet (`TravauxProjet`) lit les travaux, leurs preuves et les trois blocages. L'ouvrir ne lance rien.

## Sauvegarde et retour arrière

`sauvegarder` fait un `VACUUM INTO` vers un fichier qui n'existe pas. `restaurerVersNouveauFichier` copie cette sauvegarde vers un fichier neuf, jamais par-dessus le journal ouvert, puis `PRAGMA integrity_check` et `foreign_key_check`. Un journal en version 1 est copié avant de recevoir les tables de la version 2. Une version plus récente que le code est refusée, le fichier reste tel quel.

## Autorité et limites

L'atomicité prouvée est celle d'un fichier SQLite sur ce PC (`BEGIN IMMEDIATE`, WAL, `synchronous=FULL`) : deux process du composant de test, pas deux machines. Le transport de l'app constate que le message est déjà dans le fil et n'en écrit pas un second. Un arrêt entre l'ajout du message et l'IPC laisse l'effet inconnu jusqu'au rapprochement.

Le lien automatique vers OpenBot n'existe pas (point 15). Il n'y a pas de bascule vers le VPS ni vers Convex (point 32). La reprise d'un PC Windows hors ligne n'est pas établie (point 33). L'écran d'un projet les affiche. Aucun contenu de conversation, fichier, clé ou routine n'est envoyé à Convex. `convex/evenements.ts` n'est pas utilisé.

Les preuves T01, T02, T03, T04, T05, T07, T08 et T09 : `pnpm test:superagent`, sur un fichier jetable. T06 y est une simulation `waiting_machine`, chaque ligne est étiquetée SIMULATION. Le scénario d'un profil jetable de l'app : `xvfb-run -a node scripts/profil-superagent.mjs --no-sandbox`. Il ouvre un fil par le pont de l'app, pas par le composeur. T10 OpenBot n'est pas exécuté : il modifierait le serveur installé. Ces preuves ne couvrent pas un PC Windows, ni deux machines, ni un redémarrage du service OpenBot.
