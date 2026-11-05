# Serveur sur le VPS

Le téléphone rejoint un VPS déjà en marche, comme OpenBot : un QR affiché par le serveur, ou un lien `klyra://rejoindre`. On ne colle pas l’IP, et on n’achète rien.

## Lancer le serveur, en une commande

Sur le VPS (Linux, x64 ou arm64, systemd) :

```sh
curl -fsSL https://raw.githubusercontent.com/KLYRA-FR/klyra-app/main/serveur/lancer.sh | sudo sh
```

`serveur/lancer.sh` :
- crée l’utilisateur système `klyra` (dossier `/var/lib/klyra`, sans sudo) ; le code va dans `/var/lib/klyra/serveur` et appartient à root, les données dans `/var/lib/klyra/donnees` ;
- installe Node 22 si la machine n’en a pas, puis le service `klyra-serveur` (systemd, redémarre avec le VPS, `ProtectSystem=strict`, `ProtectHome`, OpenBot et `/root` inaccessibles) qui écoute sur `127.0.0.1:8791` ;
- publie le serveur par **Tailscale** (`tailscale serve --https=8791`) si le VPS y est connecté : adresse privée et fixe, `https://<machine>.<réseau>.ts.net:8791`. Sinon, service `klyra-tunnel` (tunnel Cloudflare gratuit, adresse qui change au redémarrage) ;
- affiche un lien `klyra://rejoindre?adresse=…&code=…` et son QR, valables **10 minutes et une seule fois**.

Relancer la commande met le serveur à jour et donne un nouveau lien ; les appareils déjà reliés le restent (elle redémarre le service : un agent en plein travail s’arrête). Tout oublier : `curl … | sudo sh -s -- revoquer-tout`. Arrêter : `sudo systemctl disable --now klyra-serveur klyra-tunnel`. Le service OpenBot ne s’arrête pas.

Réglages facultatifs : `KLYRA_SERVEUR_NOM` (nom de la machine par défaut) et `KLYRA_SERVEUR_PORT` (8791), passés après `sudo` : `… | sudo KLYRA_SERVEUR_NOM="Klyra-VPS" sh`.

## Un serveur en retard

L’app se met à jour seule, pas le serveur : il garde son code jusqu’à ce qu’on relance la commande. Le protocole (`PROTOCOLE`, 1) ne bouge presque jamais, il ne révèle donc pas cet écart.

- **La version du code** : `VERSION_CODE_SERVEUR` (`electron/version-serveur.ts`, généré en `serveur/version-code.mjs`), un entier distinct du protocole, renvoyé en `versionCode` par `GET /klyra/v1/serveur` et par l’appairage. `version` reste pour les apps qui l’exigent encore.
- **Elle suit le code tout seul** : `node scripts/serveur-genere.mjs` la monte quand l’empreinte de `serveur/*.mjs` et de `lancer.sh` change (`scripts/empreinte-serveur.mjs`, sans les tests). `pnpm lint` et `test:serveur` échouent si elle n’a pas suivi. Deux PR qui touchent au serveur entrent en conflit sur ce fichier : relancer le script, il repart de la plus haute version et écrit un fichier propre.
- **Côté app** : `serveurEnRetard` (`src/lib/serveur-vps.ts`). Plus ancien que la version attendue, ou pas de version lisible : en retard. Plus récent : rien à faire sur le VPS, c’est l’app qui n’a pas encore pris sa mise à jour. Un serveur qui ne répond pas n’a pas d’âge connu.
- **Ce qu’on voit** : Réglages du serveur › Général donne l’avis et la commande (`AvisMiseAJour`), le sélecteur, l’écran Serveurs et Réglages › Mobile disent « Répond · à mettre à jour ». L’avis tombe de lui-même à la sonde suivante (une minute au plus). L’app ne met jamais le VPS à jour elle-même.
- Test : `xvfb-run -a pnpm test:avis-serveur` (vrai serveur local dont le code est copié sans la version, puis relancé à jour).

## Appairage

- `node klyra-serveur.mjs appairer` écrit un code à usage unique (10 min). L’app l’échange contre un **jeton d’appareil** (`POST /klyra/v1/appairer`), envoyé ensuite en `Authorization: Bearer`.
- Le serveur ne garde que les empreintes (SHA-256) des codes et des jetons (`donnees/codes.json`, `donnees/appareils.json`). Cinq codes faux de suite font tomber les codes en attente.
- Dans la fenêtre PC, le jeton reste dans le processus principal, chiffré par le trousseau du système (`serveurs.json` dans le dossier de l’app). Sur le téléphone, il reste dans le navigateur.
- « Retirer » dans l’app : `DELETE /klyra/v1/appareil`, puis l’app oublie le jeton (même si le serveur ne répond pas).
- La page `/` ne montre ni lien ni code.

### À la main

Avec Node 22 ou plus récent, depuis ce dépôt : `KLYRA_SERVEUR_NOM="Klyra-VPS" KLYRA_SERVEUR_DONNEES=./donnees node serveur/klyra-serveur.mjs`, avec son propre https devant (`KLYRA_SERVEUR_CERT` et `KLYRA_SERVEUR_CLE`, ou un proxy), puis `node serveur/klyra-serveur.mjs appairer` pour un code.

## Agents sur le VPS

- `lancer.sh` installe Claude Code pour `klyra` (`/var/lib/klyra/.local/bin/claude`) et le connecte à l’abonnement de la personne : `claude setup-token`, jeton collé dans le terminal, gardé dans `donnees/claude-token`. Plus tard : `curl … | sudo sh -s -- connecter-claude`.
- `GET /klyra/v1/serveur` dit `agents: "pret" | "non-connecte" | "absent"`.
- `serveur/agents.mjs` lance Claude Code comme l’app (un processus par conversation, `--permission-prompt-tool stdio`), dans `/var/lib/klyra/atelier`, avec les agents actifs de l’équipe du serveur. Ou Codex pour ChatGPT, quand la conversation le demande (`moteur: "codex"`, `serveur/codex.mjs`). Ni fils, ni Composio, ni planning, ni pièces jointes. L’app renvoie à un VPS ce qu’il a perdu ou qu’une mise à jour n’a pas gardé : elle lit l’empreinte qu’il annonce avant chaque envoi et à l’ouverture du flux.
- Événements numérotés, gardés 24 h : `GET /klyra/v1/agent/evenements?depuis=N&instance=…` (SSE). Commandes : `POST /klyra/v1/agent/envoyer | autoriser | annuler`.
- Dans l’app, `electron/agents-distants.ts` garde un flux par VPS relié (ouvert au démarrage, curseur dans `serveurs-curseurs.json`) et rend les mêmes événements que les agents du PC. Une réponse finie pendant que l’app était fermée s’ouvre à la réouverture.
- **Le sélecteur de serveur** (menu de l’avatar › Serveurs, comme dans OpenBot) choisit **l’espace affiché** : « Ce PC » ou un VPS relié, avec son état (répond, ne répond pas, Claude Code à connecter), interrogé chaque minute et à l’ouverture du menu, et les réponses non lues de chaque autre serveur. Chaque serveur a ses conversations, ses projets et ses routines : la barre latérale, l’accueil, Projets, Routines, Tickets (tableau et nombre du rail), les chiffres de Mes agents et la recherche ne montrent que ceux du serveur choisi (`dansEspace`, `src/lib/lieux.ts`). Les outils des fils ne voient que le serveur de l’agent qui les appelle, et `planning.md` que ce PC. Les rappels et le calendrier sont à la personne : ils restent communs (la colonne « À moi » aussi). Ce qu’on crée va sur ce serveur. Une conversation ne change jamais de machine : le choix par conversation (`ChoixLieu`) n’existe plus, et un travail en cours continue sur sa machine pendant qu’on regarde un autre serveur.
- **Chaque serveur a son équipe** (`serveur/equipe.mjs`, `POST /klyra/v1/equipe/<méthode>`, `pontAgents` dans `src/lib/agents-pont.ts`) : fiches dans `donnees/equipe/`, Mes agents et préférences dans `donnees/`, agents actifs copiés dans `~/.claude/agents`. Un serveur qui recevait les fiches du PC les garde comme son équipe ; un serveur neuf reçoit une copie des agents actifs du PC, une seule fois. Ensuite le PC n’écrase plus rien ; « Copier vers … » (menu d’un agent) copie un agent sur un autre serveur. Un serveur pas à jour garde l’équipe du PC, et l’écran le dit.
- **Chaque serveur a ses réglages d’agents** (Réglages › Agents, sur le serveur affiché) : l’accès (`accesParServeur`, repli sur celui de ce PC), la configuration KLYRA et les skills par agent, gardés sur le VPS (`reglages`, `reglages-ecrire`, `skills`). L’app n’y envoie plus que ce que ce PC peut lui servir (navigateur, Coffre). « Envoyer les skills allumées de ce PC » ajoute des skills à sa bibliothèque sans en retirer. Computer Use reste à cet ordinateur.
- **Chaque serveur a son Coffre** (`serveur/coffre-serveur.mjs`, `POST /klyra/v1/coffre/<méthode>`, `donnees/coffre.json`) : les agents du VPS s’en servent sans le PC, et ne voient jamais une valeur. Rien n’y arrive d’office : on le remplit sur ce serveur, ou on y copie un secret de ce PC, un par un. Sans trousseau, les valeurs sont chiffrées avec une clé gardée à côté (`donnees/coffre.cle`, 600) : un agent du même utilisateur qui viserait exprès cette clé pourrait les lire, et l’écran le dit. Les connexions de sites restent dans le navigateur de ce PC. 
- **Chaque serveur a son compte Composio** (`serveur/composio-serveur.mjs`, `POST /klyra/v1/composio/<méthode>`) : Marketplace, sur le VPS. Il n’a pas de navigateur : l’app fait la connexion sur cet ordinateur sans rien garder, puis lui donne les jetons, chiffrés comme son Coffre, qu’il renouvelle lui-même. Ses agents Claude Code joignent le serveur MCP de Composio sans le PC. Aucune connexion n’est copiée d’un serveur à l’autre. Les apps directes et le mode développeur (clé de projet) restent à cet ordinateur.
- **Une conversation directe par agent et par serveur** : `dm-<agent>` sur ce PC, `dm-<agent>@<hôte>` sur un VPS (`idDirect`, `useIdDirect`). Une conversation d’avant cette règle garde son id et reste sur la machine où elle était ; si `dm-<agent>` est restée sur un VPS, celle de ce PC prend `dm-<agent>@pc`. Changer de serveur depuis une conversation ouvre celle du même agent sur l’autre serveur ; un lien vers une conversation d’un autre serveur propose d’y passer.
- **Les workflows d’un serveur tournent sur lui**, PC éteint (`serveur/workflows-moteur.mjs`, même moteur que l’app, `POST /klyra/v1/workflows/<lancer|arreter|decider>`) : agents, appels au modèle et fichiers du serveur, déclencheurs planifiés (`donnees/workflows-prochaines.json`) et webhooks (`POST /klyra/v1/webhook/<secret>`, l’adresse affichée est alors celle du serveur). L’app suit l’avancée par le journal (`execution`). Une approbation attend la décision de l’app ; une exécution en cours au redémarrage du serveur est dite arrêtée, jamais relancée. Un travail sans personne suit l’accès choisi pour ce serveur. Sans app ouverte, un agent peut lister, lire et lancer ses workflows ; construire en attend une, puisque ça se regarde se faire. Un serveur pas à jour laisse tourner ses workflows dans l’app, et la page le dit.
- **Chaque serveur garde son espace** (`serveur/espace.mjs`, `POST /klyra/v1/espace/<lire|ecrire>`, `useEspaceServeurs`, `src/lib/espace-sync.ts`) : ses conversations et leurs messages (donc ses tickets), ses projets, ses workflows et leurs exécutions, ses livrables, un fichier par élément sous `donnees/espace/`. L’app le relit au démarrage et chaque minute, y envoie ce qui change, et le premier passage y envoie ce que ce PC avait pour lui. Le plus récent gagne ; un élément retiré le reste pour les autres appareils. Le PC garde sa copie dans `conversations.json` : un serveur qui ne répond pas ne fait rien perdre, et ses conversations restent lisibles.
- **PC fermé, le VPS range lui-même la réponse** dans sa conversation (`noterReponse`), pour n’importe quel appareil et au-delà des 24 h du journal. Son texte seul : si l’app revient dans les 24 h, le journal rejoue la réponse complète et la remplace (`ecritParServeur`). Une app qui écoute écrit elle-même.
- **Le téléphone choisit son serveur** (Plus › Serveurs, `useLieuActif`, un choix par appareil) : ses Chats, sa recherche, ses projets, ses routines et ses workflows suivent (`src/lib/telephone/espace.ts`), ses agents sont lus sur le VPS avec son jeton (`lireEquipeServeur`). Ses rappels et son calendrier restent communs. Modifier un agent d’un VPS se fait depuis l’app de bureau pour l’instant. Le lot Tickets du téléphone devra filtrer par `useConversationsEspace`.

## Fournisseurs sur le VPS

Les mêmes que sur Ce PC, dans Réglages du serveur › Fournisseurs (l’app passe `lieu` aux IPC `moteurs:*` et `ia:*`, cf. `electron/fournisseurs-vps.ts`).

- **Moteurs** (`serveur/moteurs.mjs`) : `GET /klyra/v1/moteurs`, puis `/klyra/v1/moteurs/<claude|codex>/compte | modeles | version-disponible` (GET) et `installer | mettre-a-jour | connecter | connecter-cle | deconnecter | retour` (POST). Installer et mettre à jour lancent un travail : la réponse part tout de suite, l’app relit `travail` (étape, octets, erreur).
- **Codex** s’installe depuis npm comme sur le PC (`serveur/installation.mjs` : paquet de la plateforme, empreinte sha512, `/var/lib/klyra/.klyra/moteurs/codex/<version>`). Connexion au compte ChatGPT comme sur le PC : la page d’OpenAI s’ouvre dans le navigateur du PC, qui revient sur `http://127.0.0.1:1455/auth/callback` ; l’app écoute ce port sur le PC le temps de la connexion et relaie le retour au VPS (`retour`), où Codex l’attend sur la même adresse. Port déjà pris sur le PC : code d’appareil (lien + code montré dans l’app). Ou une clé API d’OpenAI.
- **Claude Code** reste posé et connecté par `lancer.sh` (`connecter-claude`) ; la page le dit, et « Mettre à jour » lance `claude update` sur le VPS.
- **IA à consulter** (`serveur/ia.mjs`) : `GET /klyra/v1/ia` (catalogue et liste, jamais de clé), `POST /klyra/v1/ia/ajouter | retirer | tester`. Les clés sont dans `donnees/ia.json` (600, utilisateur klyra ; le VPS n’a pas de trousseau). Les agents du VPS (Claude Code et Codex) les interrogent par l’outil `demander_ia` d’un serveur MCP sur 127.0.0.1, avec un jeton tiré à chaque démarrage.
- La session de Codex est retenue par conversation à part de celle de Claude Code (`conversation|agent|codex`). Une session d’un autre moteur : la conversation repart sur un nouveau fil.
- Test : `KLYRA_CODEX_PATH=/chemin/codex pnpm test:serveur-fournisseurs` (vrai serveur et vrai Codex face au faux OpenAI de `scripts/faux-openai.cjs`).

## Projets sur le VPS

- À la création d’un projet, « Machine » choisit ce PC ou un VPS relié (pas modifiable ensuite). Sur le VPS, le dossier est un chemin sous `/var/lib/klyra/projets/`, créé s’il n’existe pas (`POST /klyra/v1/fichiers/dossier`).
- L’arbre (`GET /klyra/v1/fichiers/arbre`, un niveau à la fois) et la visionneuse (`GET /klyra/v1/fichiers/lire`, octets bruts) passent par `electron/projets-vps.ts` ; l’aperçu se fait sur le PC (`contenuFichier`, le même que pour un projet local). Pas d’« Ouvrir avec l’app par défaut » ni de gestionnaire de fichiers pour un fichier du VPS.
- Le serveur refuse tout chemin hors de `/var/lib/klyra` (arbre, lecture, création, dossier de travail d’un agent).
- Les conversations d’un projet du VPS y tournent, dans son dossier.

## Routines sur le VPS

- « Machine » dans le formulaire d’une routine (à la création). Le VPS la lance même quand le PC est éteint ; sa réponse s’ouvre dans la conversation « Routine « … » » à la réouverture de l’app.
- `PUT /klyra/v1/routines` (liste complète, envoyée après chaque changement), `POST /klyra/v1/routines/executer | interrompre`, `GET /klyra/v1/routines/historique`.
- `serveur/horaires.mjs`, `serveur/codex-protocole.mjs` et `serveur/ia-catalogue.mjs` sont générés : `node scripts/serveur-genere.mjs` après tout changement de `electron/routines/schedule.ts`, `electron/moteurs/codex-protocole.ts` ou `electron/ia-catalogue.ts` (`test:serveur` vérifie qu’ils sont à jour).

## Dans l’app

La fenêtre PC a le sélecteur en haut du rail et l’écran Serveurs. Le téléphone (moins de 760 px) l’a dans Plus, puis Serveurs. Les deux collent le lien, quittent ou retirent un serveur. Sans serveur, l’écran montre deux gestes : coller la commande sur le VPS, coller le lien qu’elle affiche. Dans Electron, un lien `klyra://rejoindre` déjà copié remplit le champ vide. Electron ouvre `klyra://rejoindre` et arrive sur cet écran, comme il ouvre `klyra://connexion`.

La fenêtre appelle le https du lien depuis le processus principal, et seulement cette origine (http seulement sur la machine locale). La politique `connect-src` de la fenêtre reste l’app et le compte Convex. Le téléphone, hors Electron, continue d’appeler en fetch.

Le téléphone scanne le QR affiché dans le terminal du VPS. Chaque appareil a son propre lien : relancer la commande en donne un nouveau.

Le QR du terminal porte `klyra://rejoindre` : l’app web d’un iPhone ne reçoit pas ce schéma (aucune app installée ne le déclare). Sur le téléphone, copier le lien et le coller dans Plus › Serveurs. Les conversations du téléphone passent par le compte, puis par le PC (Réglages › Mobile). Exception : PC fermé, une conversation directe qui tourne sur un VPS relié au téléphone part au VPS lui-même (`src/lib/telephone/vps-direct.ts`), en accès « demander » : chaque outil attend l’accord donné sur le téléphone. Le VPS garde la conversation et le message avec la réponse (`contexte.telephone`) ; à sa réouverture, le PC range l’échange dans la conversation (`electron/contexte-distant.ts`). Les sessions Claude ne passent pas par le compte : le PC dit au VPS la conversation de chaque message (`options.conversation`), le VPS retient la session de chaque agent par conversation (`donnees/sessions-conversations.json`) et la reprend pour le téléphone. Le flux `GET /klyra/v1/agent/evenements?requete=…` ne rend que les événements d’une réponse. Un appareil perdu se retire avec `revoquer-tout`, qui délie aussi le PC ; une route de liste et de retrait par appareil reste à faire dans le parcours VPS.

Arrêter seulement ce programme : le processus `node serveur/klyra-serveur.mjs`. Le service OpenBot ne s’arrête pas.
