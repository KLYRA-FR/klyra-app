# Journal super-agent

Le journal est un fichier SQLite sur ce PC : `userData/superagent.sqlite`. Le process principal est le seul écrivain. L'écran lit une projection par IPC et n'ouvre pas le fichier. Les agents ne l'ouvrent pas non plus. Le renderer garde les conversations dans `conversations.json` et envoie des faits (identifiant de fil, message, statut). Un outil appelé avec l'identifiant d'un autre fil le lit (`lister_fils`, `lire_fil`).

## Ce qui est tenu

Un fil Klyra ouvert avec `ouvrir_fil` crée un travail, une politique limitée à cette conversation, et une occupation. Il y a trois places. La quatrième attend, le fil n'est pas gardé. Une précision (`ecrire_dans_fil`) rejoint le même travail. Plusieurs messages du même fil restent un seul travail. Un même message source ne crée pas un second travail. `arreter_fil` suspend : l'opération déjà partie reste en vol, elle est listée, elle n'est pas rejouée. `reprendre_fil` exige une référence de contrôle, y compris pour sortir d'une attente `waiting_machine`. Un travail terminé ou annulé ne reprend pas. `fermer_fil` refuse tant qu'une opération est à constater.

Une nouvelle consigne (`changement_objectif`) avance `objective_revision` et annule les intentions encore `planned`. Une opération `inflight` n'est ni annulée ni relancée : son motif devient `effet_deja_parti:controler`. Une priorité (`priorité : N` dans le résumé) est écrite sur le travail. Les deux se décident en code, sans appel de modèle.

La décision est du code, sans appel de modèle. Le routeur de l'app est `principal`. Un mail, une publication, un push sur `main`, un paiement ou une suppression est refusé. Le plafond de dépense absent bloque la préparation anticipée.

`waiting_machine` est un état du journal. Une machine de l'app absente attend : le travail ne part pas sur une autre machine. Au retour, un seul départ, après un contrôle de la consigne. Le transport déjà là est `electron/agents-distants.ts`, le VPS de la personne. Une coupure de son flux est réessayée de 1 s à 30 s. Sans jeton, l'envoi refuse. Ce transport ne dit pas au journal qu'une machine est absente. T06 simule l'état `waiting_machine`. Aucun accès nouveau, aucune prise de contrôle d'un PC.

Le watchdog tourne dans l'app toutes les 15 minutes. `superagent:passage` appelle la même fonction, pour un contrôle qui ne peut pas attendre. Il écrit une alerte. Il ne relance pas, ne ferme pas, n'écrit pas dans le fil. La routine Tempo reste inactive.

L'écran d'un projet (`TravauxProjet`) lit les travaux et leurs preuves. La liste des blocages est vide. L'ouvrir ne lance rien.

## Sauvegarde et retour arrière

`sauvegarder` fait un `VACUUM INTO` vers un fichier qui n'existe pas. `restaurerVersNouveauFichier` copie cette sauvegarde vers un fichier neuf, jamais par-dessus le journal ouvert, puis `PRAGMA integrity_check` et `foreign_key_check`. Un journal en version 1 est copié avant de recevoir les tables de la version 2. Une version plus récente que le code est refusée, le fichier reste tel quel.

## Autorité et limites

L'atomicité prouvée est celle d'un fichier SQLite sur ce PC (`BEGIN IMMEDIATE`, WAL, `synchronous=FULL`) : deux process du composant de test, pas deux machines. Le transport de l'app constate que le message est déjà dans le fil et n'en écrit pas un second. Un arrêt entre l'ajout du message et l'IPC laisse l'effet inconnu jusqu'au rapprochement.

Aucun contenu de conversation, fichier, clé ou routine n'est envoyé à Convex. `convex/evenements.ts` n'est pas utilisé. L'écriture de ce SQLite reste sur ce PC. Le VPS sert aux agents distants déjà dans l'app.

Les preuves T01, T02, T03, T04, T05, T07, T08 et T09 : `pnpm test:superagent`, sur un fichier jetable. T06 y est une simulation d'une machine de l'app absente (`waiting_machine`), chaque ligne est étiquetée SIMULATION. Le scénario d'un profil jetable de l'app : `xvfb-run -a node scripts/profil-superagent.mjs --no-sandbox`. Il ouvre un fil par le pont de l'app, pas par le composeur, et vérifie que l'écran du projet ne montre plus les trois mentions retirées. Ces preuves couvrent un fichier sur ce PC. L'atomicité entre machines n'est pas acquise. Pas de fusion : merger `main` publie une version.
