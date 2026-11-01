# Agents sur le VPS : plan

01/11/2026, pour Corentin. Ce plan ne contient pas de code. Il s'appuie sur `electron/claude.ts`, `electron/main.ts`, `electron/ia.ts`, `src/lib/workspace.tsx`, `serveur/klyra-serveur.mjs` et `serveur/lancer.sh`.

## En bref

- **Aujourd'hui, tout tourne sur le PC.** Rejoindre un VPS l'ajoute à l'écran Serveurs et vérifie qu'il répond, rien de plus : `carnet.actif` n'est lu que par cet écran, `streamAgent` lance toujours Claude Code sur le PC, et le serveur du VPS ne sait répondre qu'à `GET /klyra/v1/serveur`.
- **But** : comme dans OpenBot, un sélecteur en haut (« Ce PC » / « Klyra-VPS ») choisit où tourne une nouvelle conversation. Chaque conversation affiche où elle tourne et y reste. Sur le VPS, un agent continue quand le PC est fermé.
- **Le point dur est la sécurité.** Un serveur qui lance des agents, c'est un accès à la machine. L'invitation actuelle est affichée sur la page publique du serveur : elle ne protège rien. On remplace cet accès avant d'ajouter le moindre agent.
- **6 PR**, la sécurité d'abord. Les agents tournent sur le VPS à la PR 3.

## 1. Ce qui existe et ce qu'on réutilise

- **Un protocole déjà prêt** : l'interface ne parle à Claude Code que par `claude:stream` (options : agent, prompt, dossier, session, modèle, effort, accès), `claude:autoriser`, `claude:cancel`, et reçoit des `AgentEvent` (`session`, `texte`, `etape`, `etape-fin`, `jetons`, `autorisation`, `autorisation-fin`, `fin`) et des réponses spontanées (`claude:spontane`). Tout cela se sérialise en JSON. Le VPS reprend exactement ces messages : l'écran de conversation ne change pas.
- **Les sessions** : une conversation garde une session Claude Code par agent (`chat.sessions[roleId]`). Une session n'existe que sur la machine qui l'a créée. Une conversation ne peut donc pas changer de machine en cours de route.
- **Le serveur du VPS** (`klyra-serveur.mjs`) et sa commande (`lancer.sh`) existent. On les fait grandir au lieu d'écrire un deuxième serveur.
- **Ce VPS** a déjà Claude Code (`/var/lib/openbot/.local/bin/claude`) et Tailscale, qui relie ton PC Windows et le VPS (`openbot-vps`, vu le 01/11).

## 2. Sécurité (PR 1, avant tout le reste)

- **Fin de l'invitation publique.** La page `/` n'affiche plus de lien ni d'invitation. Le lien se montre seulement dans le terminal du VPS, au lancement.
- **Appairage par code à usage unique** : `lancer.sh` affiche un lien qui contient un code valable 10 minutes et une seule fois. L'app l'échange contre un **jeton d'appareil** (32 octets aléatoires). Le VPS ne garde que l'empreinte du jeton. Le PC le garde chiffré par `safeStorage`, comme les jetons du compte (`electron/compte.ts`).
- **Appareils révocables** : le VPS tient la liste des appareils appairés (nom, date, dernière visite). « Retirer » dans l'app révoque le jeton du côté du VPS. Une commande `lancer.sh --revoquer-tout` existe pour un appareil perdu.
- **Un utilisateur dédié** : aujourd'hui le serveur tourne en `root` (vu le 01/11). Il passe sous un utilisateur `klyra` sans sudo, avec son propre dossier. Les agents ne peuvent pas lire OpenBot, ni le reste de la machine au-delà des droits de cet utilisateur.
- **Toujours en marche** : un service systemd (`klyra-serveur`, `Restart=always`) remplace `nohup`. Le serveur redémarre avec le VPS.
- **Une adresse fixe**, puisqu'un appareil appairé doit retrouver le serveur (voir la question 1) :
  - **Tailscale** (recommandé pour toi) : `tailscale serve` donne une adresse https privée, stable, avec un vrai certificat. Le serveur n'est plus du tout sur Internet. Chaque personne doit rejoindre le réseau Tailscale de l'équipe.
  - **Tunnel Cloudflare nommé** sur un sous-domaine KLYRA (par exemple `vps.klyra.fr`) : adresse publique stable, sans rien installer chez les autres. Le serveur reste exposé, protégé seulement par le jeton.
  - Le tunnel gratuit actuel reste pour essayer, avec l'avertissement que l'adresse change.

## 3. Faire tourner un agent sur le VPS (PR 3)

- **Transport** : une connexion WebSocket par appareil, sur `/klyra/v1/session`, ouverte avec le jeton d'appareil. Elle porte les mêmes messages que l'IPC (`stream`, `autoriser`, `annuler` dans un sens ; `AgentEvent` et `spontane` dans l'autre). Le passage d'un WebSocket par Tailscale et par le tunnel Cloudflare est **à vérifier** sur le prototype.
- **Côté VPS** : le serveur lance Claude Code comme le fait `streamAgent` aujourd'hui (`claude -p --input-format stream-json`, un processus par conversation, gardé entre les messages). Le plus simple et le plus sûr : extraire de `electron/claude.ts` la partie qui ne dépend pas d'Electron (arguments, lecture du flux, tours, autorisations) dans un module partagé, utilisé par l'app et par le serveur. Les deux restent alignés.
- **Côté app** : `claude:stream` choisit la machine d'après la conversation. Sur le PC, rien ne change. Sur le VPS, le processus principal relaie par le WebSocket (comme `serveur:interroger` depuis la PR 50). Le rendu ne parle jamais directement au VPS.
- **Le PC fermé** : le VPS garde les événements de chaque réponse, numérotés, pendant 24 h. À la reconnexion, l'app demande « tout depuis le numéro N » et rattrape la réponse. Un agent qui demande une autorisation pendant que le PC est fermé attend ; la demande s'affiche à la réouverture.
- **Accès** : « demander », « projet » et « tout » gardent leur sens, mais sur le VPS, dans le dossier de l'utilisateur `klyra`. La fenêtre d'autorisation dit sur quelle machine l'agent agit.
- **Compte Claude sur le VPS** : Claude Code doit y être connecté. `lancer.sh` lance la connexion si besoin (`claude setup-token` donne un jeton longue durée lié à l'abonnement ; à vérifier sur ton offre). Les limites d'usage sont celles de l'abonnement, partagées avec le PC.
- **Consommation** : le VPS tient son propre journal (`consommation.jsonl`). Le Profil le lit par le serveur et affiche « sur le VPS » à part. Sans réponse du VPS, il le dit au lieu d'inventer un chiffre.

## 4. Le sélecteur et les conversations (PR 2)

- **En haut de la barre latérale**, comme dans OpenBot : « Ce PC » et chaque serveur rejoint, avec un point d'état (répond / ne répond pas). Le choix vaut pour les **nouvelles** conversations.
- **Chaque conversation porte sa machine** (`lieu: "pc" | <id du serveur>`, dans `conversations.json`). Un petit repère dans la liste et dans l'en-tête, seulement si au moins un serveur est rejoint.
- **Serveur injoignable** : ses conversations restent lisibles, le composeur dit « Klyra-VPS ne répond pas » au lieu d'envoyer.
- **« En cours » disparaît** de l'écran Serveurs : le choix se fait dans le sélecteur.
- Cette PR arrive avant les agents : sans PR 3, choisir le VPS est grisé avec « Bientôt ». On valide l'interface tôt.

## 5. Agents, projets et outils de l'app

- **Fiches d'agents (PR 4)** : le PC reste la source. À la connexion et à chaque modification, l'app envoie au VPS les fiches de Mes agents **actifs** (le même `preparerPublication` que la Bibliothèque : chemins personnels retirés, secret = refus). Le VPS les écrit dans `~klyra/.claude/agents`. Le refus des agents inactifs (`--disallowedTools Agent(…)`) s'applique de la même façon.
- **Projets (PR 5)** : un projet est soit un dossier du PC, soit un dossier du VPS. L'arbre et la visionneuse d'un projet du VPS passent par le serveur (lecture seule au départ). Aucun fichier n'est recopié d'une machine à l'autre.
- **Pas dans les premières versions** : outils des fils (`lister_fils`, `ecrire_dans_fil`…) et `proposer_agent`, Composio, Computer Use, dictée. Ils passent par le serveur MCP local de l'app (`demarrerServeurMcp`, `127.0.0.1`), que Claude Code sur le VPS ne peut pas joindre. Un agent du VPS les voit absents et le dit.
- **Routines (PR 6)** : c'est le vrai gain d'un VPS, qui tourne quand le PC dort. Une routine choisit sa machine. Celles du VPS sont tenues par le serveur, avec le même modèle de réservation que `electron/routines/`. À détailler dans un plan à part avant la PR.

## 6. Étapes (6 PR)

1. **Appairage sûr** : code à usage unique, jeton d'appareil, page publique sans invitation, utilisateur `klyra`, service systemd, adresse fixe. Tests : refus sans jeton, code réutilisé, jeton révoqué.
2. **Sélecteur et machine de chaque conversation** : interface seule, VPS grisé.
3. **Agents sur le VPS** : WebSocket, module Claude Code partagé, relais par le processus principal, rattrapage après coupure, autorisations à distance. Test de bout en bout avec un faux Claude Code (comme `scripts/test-delegation.mjs`), puis un essai réel sur ce VPS.
4. **Fiches d'agents envoyées au VPS.**
5. **Projets sur le VPS.**
6. **Routines sur le VPS**, après leur propre plan.

Chaque PR suit `docs/CONTRIBUER.md`. Retour arrière : une PR de revert. Les conversations sans `lieu` sont lues comme « Ce PC » : une version antérieure de l'app les lit sans erreur.

## Où on en est

- **PR 1 (appairage sûr)** : fusionnée (PR 52).
- **PR 2, 3 et 4 réunies** (sélecteur, agents sur le VPS, fiches) : une seule PR, pour ne pas publier un sélecteur grisé. Écarts au plan :
  - **Flux SSE plutôt que WebSocket** : `GET /klyra/v1/agent/evenements` (événements numérotés, rattrapage par `depuis` et `instance`), commandes en `POST` (`envoyer`, `autoriser`, `annuler`). Node n'a pas de serveur WebSocket sans dépendance ; le SSE passe par Tailscale et Cloudflare sans réglage.
  - **Pas de module partagé avec `electron/claude.ts`** : le serveur est livré en fichiers `.mjs` lus par `curl`. `serveur/agents.mjs` reprend la même logique (processus par conversation, tours, autorisations, refus des agents inactifs) ; un changement de `REGLES_COMMUNES` se fait des deux côtés.
  - **Le choix de la machine est dans l'en-tête de chaque conversation** (`ChoixLieu`), pas en haut de la barre : les conversations directes ont un identifiant fixe par agent (`dm-principal`). Le dernier choix sert aux nouvelles conversations.
  - **Fiches envoyées telles quelles** (le VPS est celui de la personne) : pas de `preparerPublication`, qui vit côté Convex.

## Décisions du 01/11

1. **Adresse fixe : Tailscale.** `tailscale serve` sur le VPS ; le serveur n'est plus sur Internet. Le tunnel gratuit reste seulement quand Tailscale n'est pas installé.
2. **Un VPS par personne.** Chacun relie son propre VPS depuis l'app ; un seul utilisateur `klyra` par VPS. Pas de partage d'un VPS entre membres de l'équipe pour l'instant.
3. **Compte Claude : l'abonnement de la personne**, limites partagées entre son PC et son VPS.
4. **Accès « tout » autorisé dès la PR 3**, limité aux droits de l'utilisateur `klyra`.
5. **KLYRA séparé d'OpenBot** sur la même machine (utilisateur, ports, dossiers), comme proposé.

## 7. Questions pour Corentin (tranchées le 01/11, ci-dessus)

1. **Adresse fixe** : Tailscale (privé, chacun rejoint le réseau) ou tunnel Cloudflare nommé sur un domaine KLYRA (public, rien à installer) ? Recommandation : Tailscale, puisque ton PC et le VPS y sont déjà.
2. **Qui utilise le VPS** : toi seul, ou aussi Pelin et Yanis ? Si plusieurs personnes : un utilisateur `klyra` commun, ou un par personne (leurs conversations et fichiers séparés) ?
3. **Compte Claude sur le VPS** : ton abonnement, au risque de partager tes limites avec ton PC ?
4. **Accès « tout » sur le VPS** : autorisé dès la PR 3, ou seulement « demander » et « projet » au début ?
5. **OpenBot** tourne sur la même machine. On garde KLYRA séparé (utilisateur, ports, dossiers) comme proposé ici ?
