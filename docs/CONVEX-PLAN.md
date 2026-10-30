# Données partagées de l'équipe sur Convex : plan

29/10/2026, pour Corentin. **Validé le 29/10** (décisions à la fin). PR 1 (installation) fusionnée ; PR 2 (comptes et équipe) faite, voir « Ce qui a été fait dans la PR 2 » à la fin.

## En bref

- **Ce qui passe en ligne** : les comptes et l'équipe, les rappels assignés, le calendrier commun. **Ce qui reste sur l'ordinateur** : les conversations avec les agents, les fichiers, les clés, les routines et `~/.klyra/planning/planning.md`, que les agents continuent de lire.
- **Connexion** : un lien magique par e-mail (ta décision), avec Convex Auth. Les e-mails partent par **PostShiba**, depuis `connexion@notifications.klyra.fr`, grâce à son composant Convex.
- **Accès** : seules les adresses invitées peuvent se connecter. Au départ : corentin@, pelin@ et yanis@klyra.design, tous les trois admins. Le rôle « membre » existe pour les personnes qui arriveront ensuite.
- **Règle de sécurité** : chaque fonction Convex retrouve la personne par sa session, jamais par un identifiant envoyé par l'app, et ne renvoie que ce qui la concerne.
- **Décidé** : Convex en Irlande, PostShiba gardé même hors d'Europe, chacun ne voit que ce qu'il a créé, ce qu'on lui a assigné et les événements auxquels il participe (admins compris), un e-mail quand on t'assigne un rappel et que ton app est fermée, une v1 hors ligne en lecture.

## 1. Comptes et équipe

**Fournisseur : Convex Auth** (`@convex-dev/auth`), avec un fournisseur e-mail personnalisé. Vérifié dans le code de la version 0.0.96 :
- le lien est l'adresse `redirectTo` suivie de `?code=…`, et une adresse non web est acceptée si le rappel `redirect` l'autorise ;
- la fonction d'envoi (`sendVerificationRequest`) reçoit le contexte Convex en second argument ; le `sendEmail` du composant PostShiba accepte ce contexte ;
- le code est effacé dès qu'il a servi (usage unique) ; il vaut 24 h par défaut, on le ramène à **15 minutes** (`maxAge`).

**Le risque** : Convex Auth est en bêta (« may change in backward-incompatible ways ») et ne documente que les apps React web et React Native, pas Electron [C16]. La PR 2 commence donc par un prototype de la connexion de bout en bout. S'il bloque, je reviens vers toi avant d'aller plus loin.

**Le parcours dans l'app de bureau**
1. Écran de connexion : la personne tape son adresse. L'app appelle `signIn("postshiba", { email, redirectTo })`.
2. Côté Convex, avant tout envoi, une requête interne vérifie que l'adresse est invitée ou déjà membre. Sinon, aucun e-mail ne part, et l'écran affiche le même message dans les deux cas (« Si cette adresse est invitée, un lien vient de partir »), pour ne pas révéler qui est dans l'équipe.
3. L'e-mail contient un lien `https://<déploiement>.convex.site/connexion?code=…`, servi par une action HTTP Convex. Cette page ouvre `klyra://connexion?code=…`, avec un bouton « Ouvrir KLYRA » en secours. Un lien `klyra://` direct risquerait de ne pas être cliquable dans tous les logiciels de mail (à vérifier sur Gmail) : la page relais l'évite sans hébergement en plus.
4. L'app déclare le protocole `klyra://` (`app.setAsDefaultProtocolClient`, `open-url` sur Mac, `second-instance` sous Windows). Le process principal passe le code à l'interface, qui termine la connexion avec `signIn("postshiba", { code })`.
5. Jetons de session : `ConvexAuthProvider` accepte un `storage` personnalisé, même asynchrone. On le branche sur `safeStorage` par le pont de l'app, comme la clé ElevenLabs, plutôt que sur le `localStorage`.

**Tables** (en plus de celles de Convex Auth)
- `invitations` : adresse (en minuscules), rôle (`admin` | `membre`), invitée par, date, statut. Remplie au départ par une mutation interne lancée une seule fois, avec les trois admins.
- `membres` : utilisateur, rôle, actif, date d'arrivée. Créé à la première connexion à partir de l'invitation.
- `profils` : utilisateur, nom, intitulé, couleur (une des teintes de `ROLE_TEINTES`). La photo reste sur l'ordinateur dans un premier temps.

**Gestion de l'équipe** : une section « Équipe » dans les Réglages. Tout le monde voit la liste (nom, couleur, rôle). Seuls les admins invitent, changent un rôle ou retirent quelqu'un. Retirer une personne passe `actif` à faux et ferme ses sessions. Le dernier admin ne peut pas être retiré.

**À changer dans l'app** : la CSP de `electron/main.ts` n'autorise aujourd'hui que `'self'` en `connect-src`. Il faut y ajouter l'adresse du déploiement, en `https://` et en `wss://`. Le profil local (`currentUser`) devient le profil du compte : fait le 30/10, règles dans `src/lib/identite.ts` (connecté, nom, rôle et couleur du compte ; photo et réglages de l'ordinateur ; aucun écart réglé sans choix explicite).

## 2. Rappels assignés

**Table `rappels`** : titre, notes, échéance (date et heure, ou jour entier), créé par, assigné à, statut (`a_faire` | `fait` | `en_retard`), fait le, priorité (0 à 3). Index : `by_assigneA_and_statut_and_echeance` et `by_creePar_and_echeance`. Un rappel personnel est un rappel qu'on s'assigne à soi-même.

**« En retard »** : une requête Convex ne doit pas lire l'heure (règle des guidelines). À la création, et à chaque changement d'échéance, une fonction est planifiée à l'heure de l'échéance (`ctx.scheduler.runAt`) ; elle passe le rappel en retard s'il n'est pas fait. Son identifiant est gardé sur le rappel pour l'annuler si l'échéance change.

**Notifications**
- Table `notifications` : destinataire, type (assigné, échéance, fait, modifié), rappel, lue. Elle est écrite dans la même mutation que le changement, ou par la fonction planifiée à l'échéance.
- Dans l'app : un compteur et la liste dans le Planning.
- Sur l'ordinateur : l'interface est abonnée aux notifications non lues et affiche une notification système (`new Notification`, comme aujourd'hui) pour celles que ce poste n'a pas encore montrées. Chaque poste garde la liste de ce qu'il a montré : si on a deux ordinateurs, les deux préviennent.
- **App fermée : un e-mail** (décision du 29/10). Quand on m'assigne un rappel et qu'aucune de mes apps n'est ouverte, un e-mail part de `rappels@notifications.klyra.fr` : titre, échéance, qui l'a assigné. Les notes ne sont pas dans l'e-mail. Pour savoir si une app est ouverte, on utilise le composant `@convex-dev/presence` : l'app signale qu'elle est là à intervalles réguliers, et le composant passe une personne hors ligne quand ces signaux s'arrêtent. Ce composant est conseillé par les guidelines de Convex plutôt qu'une table « vu à » faite à la main. Pas d'e-mail pour un rappel qu'on s'assigne à soi-même, ni à l'échéance. Dans l'app, les notifications attendent la prochaine ouverture.

**Vues** : « Mes rappels » (ceux qui me sont assignés) et « Ceux que j'ai assignés » (créés par moi pour quelqu'un d'autre), dans l'écran Rappels actuel. Les catégories (Perso, Clients, École…) restent personnelles. Un rappel reçu de quelqu'un arrive dans une colonne « Assignés par l'équipe », d'où on peut le ranger.

**Les rappels locaux** : à la première connexion, s'il y a des rappels dans `conversations.json`, l'app propose de les mettre dans le compte. L'envoi se fait par lots de 100 au plus. Chaque rappel garde son identifiant local (`origineLocale`), ce qui permet de relancer l'import sans doublon. Ils sont assignés à la personne, avec leurs catégories. La copie locale n'est pas effacée : elle sert de retour arrière.

## 3. Calendrier commun

- **Table `evenements`** : titre, notes, début, fin, jour entier, organisateur, « toute l'équipe » (oui ou non), répétition (aucune ou chaque semaine).
- **Table `participations`** : événement, participant, et la date de début recopiée pour chercher par période. Index `by_participant_and_debut` et `by_evenement`.
- **Une couleur par personne** : celle du profil. Dans le Planning, un événement prend la couleur de son organisateur. Des puces par personne filtrent les événements partagés selon qui les organise.
- **Ce qu'on voit** (décision du 29/10) : seulement les événements qu'on organise ou auxquels on participe. Les créneaux occupés des autres ne sont pas montrés. Un événement « toute l'équipe » compte tous les membres comme participants.
- **Dans le Planning actuel** : l'`Agenda` affiche les événements du compte à côté des routines des agents, qui restent locales. Le « Weekly KLYRA » codé en dur dans `src/lib/agenda-equipe.ts` devient un événement d'équipe répété chaque semaine. La notification 10 minutes avant reste calculée par l'app ouverte, comme aujourd'hui.
- **Google Agenda** : plus tard, dans une PR à part.

## 4. Droits

- Toute fonction publique commence par `exigerMembre(ctx)` : session valide et membre actif, sinon refus.
- **Rappels** : visibles par la personne qui l'a créé et celle à qui il est assigné. La première peut tout modifier et supprimer. La seconde change le statut et les notes.
- **Événements** : visibles par l'organisateur et les participants (tous les membres pour un événement d'équipe). Ni les autres événements ni les créneaux occupés ne sont visibles. L'organisateur modifie et supprime.
- **Équipe** : la liste est visible par tous les membres ; les invitations et les rôles, seulement par les admins.
- **Admins** : être admin ne donne pas accès aux rappels ni aux événements des autres (décision du 29/10). Un admin gère seulement l'équipe.
- Chaque PR ajoute des tests `convex-test` qui vérifient aussi les refus : un autre membre, une personne retirée, une personne sans session.

## 5. Hors ligne

**Ce que Convex fait déjà** : si le réseau tombe, le client se reconnecte tout seul [C5]. Il renvoie les mutations jusqu'à ce qu'elles soient écrites, et chacune ne s'exécute qu'une fois [C5], dans une seule file, dans l'ordre [C6]. Cela vaut tant que l'app reste ouverte. Les mises à jour optimistes affichent un changement tout de suite, avant la réponse du serveur [C7].

**Ce qu'il ne fait pas** : « Convex doesn't currently provide a full offline sync mechanism » [C8]. Son moteur local-first n'a jamais dépassé l'alpha, et son dépôt est archivé depuis le 24/09/2026 [C9]. Rien n'est gardé d'une ouverture de l'app à l'autre.

**Retenu pour la v1 (PR 5)**
1. **Copie locale en lecture** : les derniers résultats de mes rappels, de mes événements et de l'équipe sont écrits dans le dossier de l'app (`userData`), par le process principal. Au démarrage, l'app les affiche en attendant Convex. Sans réseau, un bandeau indique « Hors ligne · données du 29/10 à 10:42 ».
2. **Modifier sans réseau** : c'est permis tant que l'app reste ouverte, grâce à la file de Convex, avec un affichage optimiste. Une pastille montre ce qui attend d'être envoyé (`connectionState().inflightMutations`). Si l'on ferme l'app avec des envois en attente, une `Modale` prévient : « 2 changements ne sont pas encore partis ».
3. **Notifications** : celles des rappels déjà connus partent aussi depuis la copie locale.

Garder la file d'envoi sur le disque, pour fermer l'app sans rien perdre, demanderait bien plus de travail. Ce n'est pas prévu dans la v1.

## 6. Hébergement et coût

### Convex

**Région** : quatre régions, toutes chez AWS. En Europe, il y a seulement `aws-eu-west-1`, en Irlande, avec « 30% regional surcharge » [C2]. Toute l'infrastructure du déploiement est hébergée dans la région choisie [C2]. **Retenu : l'Irlande** (`aws-eu-west-1`).
- **Choix définitif** : la région se choisit à la création du déploiement, et « An existing deployment's region cannot be changed » [C2]. En changer plus tard, c'est créer un nouveau déploiement et y exporter les données.
- **Offre gratuite** : l'UE est ouverte à toutes les offres, gratuite comprise (annonce du 6/02/2026) [C3].
- **Hors de l'UE quand même** : le DPA autorise des transferts vers les États-Unis, avec les clauses contractuelles types [C10]. Les sous-traitants d'observabilité (Datadog, Sentry, PostHog…) sont aux États-Unis [C11]. Des journaux techniques peuvent donc sortir de l'UE : c'est une déduction, pas une information confirmée.
- **Conformité** : Convex se dit conforme au RGPD et certifié SOC 2 Type 2 [C12].

**Coût** (prix affichés en dollars, page des tarifs du 29/10) [C4] :

| | Free & Starter | Professional |
|---|---|---|
| Prix | « Free or $0/month and pay as you go » | « $25 per developer/month » |
| Développeurs | 1 à 6 | 1 à 20 |
| Appels de fonctions | 1M inclus, puis 2,20 $ par million | 25M inclus, puis 2 $ par million |
| Calcul des actions | 20 Go-heures, puis 0,33 $ par Go-heure | 250 Go-heures, puis 0,30 $ |
| Base de données | 0,5 Go, puis 0,22 $ par Go | 50 Go, puis 0,20 $ |
| Lectures et écritures en base | 1 Go, puis 0,22 $ par Go | 50 Go, puis 0,20 $ |
| Fichiers | 1 Go, puis 0,033 $ par Go | 100 Go, puis 0,03 $ |
| Données sortantes | 1 Go, puis 0,132 $ par Go | 50 Go, puis 0,12 $ |

- **Développeurs** : ce sont les membres de l'équipe Convex. Hugo et Noé passent par des clés de déploiement et ne prennent pas de place. Les utilisateurs de l'app ne sont pas comptés dans la grille, mais aucune page ne le dit en toutes lettres.
- **En Europe**, 30 % de plus sur les offres payantes. Et l'annonce de février précise : « the included usage for Starter and Pro plans (such as the 25M function calls a month) on US deployments does not apply to EU deployments, which are exclusively billed on demand as of now » [C3]. La page des tarifs dit aujourd'hui « Included amounts are shared across regions » [C4]. Les deux textes ne disent pas la même chose : **à faire confirmer par Convex** avant de passer à une offre payante.
- **Plafonds de l'offre gratuite** : une fois atteints, de nouvelles mutations peuvent échouer [C13]. Deux sauvegardes au plus par déploiement ; les sauvegardes régulières demandent l'offre Pro [C14]. Avant chaque changement de schéma risqué, on fait donc un export manuel.
- **Pour trois personnes**, des rappels et un calendrier restent loin de ces quotas. On le vérifiera dans le tableau de bord deux semaines après la mise en service.

**Auto-hébergement** : possible (code ouvert, licence FSL Apache 2.0), mais le support passe seulement par la communauté, et la doc prévient : « Self hosting is not for everyone » [C15]. Non proposé.

### PostShiba pour les e-mails

**PostShiba convient, avec des réserves. Gardé le 29/10** : Corentin accepte que les données des e-mails passent hors d'Europe.
- **Branchement** : composant `@postshiba/convex` (0.1.0), déclaré dans `convex/convex.config.ts`. Un fournisseur `Email` de Convex Auth appelle `postshiba.sendEmail(ctx, …)` dans sa fonction d'envoi. Le composant met l'e-mail en file dans la transaction, puis l'envoie depuis une action en arrière-plan, avec de nouvelles tentatives [P1]. Deux réglages à changer : `testMode` est à `true` par défaut (n'envoie qu'aux adresses `inbound.postshiba.com`), et `hourlyLimit` vaut 25 [P1].
- **Expéditeurs** : `connexion@notifications.klyra.fr` pour les liens de connexion, `rappels@notifications.klyra.fr` pour les notifications. Toute adresse d'un domaine vérifié peut envoyer, sans rien créer de plus [P3].
- **DNS** (zone `klyra.fr`, chez Hostinger, ajoutés par Cicco ; vérifiés le 29/10) :

  | Type | Nom | Valeur | Rôle |
  |---|---|---|---|
  | CNAME | `ps1._domainkey.notifications.klyra.fr` | `799.customers.postshiba.com` | DKIM |
  | CNAME | `rp.notifications.klyra.fr` | `rp.postshiba.com` | Chemin de retour |

  Pas de DMARC propre au sous-domaine : celui de `klyra.fr` le couvre, et PostShiba le dit facultatif [P2]. Il est en `p=reject` : un e-mail mal signé serait refusé, pas mis en indésirables. PostShiba n'envoie de toute façon rien avant que le DKIM soit vérifié [P2].
- **Clé** : une clé **Send only** par déploiement (dev et prod), qui ne peut qu'envoyer [P1]. Elle va dans les variables d'environnement Convex (`POSTSHIBA_API_KEY`, avec `POSTSHIBA_TEAM_ID` et `POSTSHIBA_CLUSTER_ID`), jamais dans le dépôt ni dans l'app [P1]. Elle passe par le formulaire sécurisé de Cicco.
- **Réserves** :
  - **Approbation** : chaque compte commence « en attente » et PostShiba l'approuve à la main, sans délai fixe. En attendant, il n'envoie qu'aux membres de l'équipe PostShiba [P4]. En y invitant Pelin et Yanis, les trois admins peuvent se connecter avant l'approbation ; les futurs invités devront l'attendre.
  - **Bêta et prix** : l'offre la plus petite, Nano, coûte 5 $ par mois pour 100 e-mails par heure et 600 sur 24 heures, « Available in beta ». Le premier cluster a 7 jours d'essai, et un moyen de paiement est demandé avant [P5].
  - **Données hors d'Europe** (accepté par Corentin le 29/10) : la page des tarifs renvoie aux règles de Bento (« Bento's privacy, terms, and security policies apply to PostShiba »), et « PostShiba is not covered by Bento's SOC 2 report » [P5]. La politique de Bento dit : « may be stored and processed in Australia, the United States, and other countries » [P6]. Les adresses, les liens de connexion et les titres des rappels envoyés par e-mail passent donc hors d'Europe. Le DPA est sur gdpr.bentonow.com [P6].
  - **Copies des e-mails** : PostShiba peut garder une copie des messages envoyés (0 à 365 jours) [P7]. Pour des liens de connexion, on la met à 0.

## 7. Découpage en PR

Chaque fusion publie l'app pour tout le monde dans l'heure (`docs/CONTRIBUER.md`). Les fonctions Convex sont donc déployées **avant** l'app (`npx convex deploy` dans l'action App, avec la clé de production), et chaque changement de schéma reste compatible avec la version précédente de l'app.

1. **Installation et plan** (cette PR) : `convex`, `convex/schema.ts` vide, script `dev:convex`, fichiers ai (`convex/_generated/ai/guidelines.md`, `.agents/skills`, `.claude/skills`, sections Convex de `AGENTS.md` et `CLAUDE.md`). Aucune fonction, aucun appel réseau.
2. **Comptes et équipe** : Convex Auth et PostShiba, invitations, profils, rôles, écran de connexion, Réglages › Équipe, protocole `klyra://`, CSP, déploiement Convex dans l'action App, tests. Nouvelles dépendances : `@convex-dev/auth`, `@auth/core`, `@postshiba/convex`, et pour les tests `convex-test`, `vitest`, `@edge-runtime/vm`.
3. **Rappels assignés** : table, statut en retard, notifications, vues, import des rappels locaux, e-mail quand l'app est fermée. Nouvelle dépendance : `@convex-dev/presence`.
4. **Calendrier commun** : événements, participants, couleurs, Weekly, intégration dans l'`Agenda`.
5. **Hors ligne** : copie locale et bandeau.
6. Plus tard : Google Agenda.

La PR 2 ne commence qu'une fois le projet Convex créé et les clés transmises par Cicco : `CONVEX_DEPLOY_KEY`, la clé de dev, et la clé PostShiba Send only.

## 8. Ce que tu fais de ton côté

**Convex**
1. Créer le compte et l'équipe Convex, puis un projet `klyra-app`, dans la région choisie (§ 6).
2. Créer une **clé de déploiement de production**, avec seulement la permission `deployment:deploy` [C1]. Elle va dans les secrets du dépôt `KLYRA-FR/klyra-app`, sous le nom `CONVEX_DEPLOY_KEY`.
3. Créer une **clé de développement** pour le déploiement de dev [C1]. Elle passe par le formulaire de Cicco, pour Hugo et Noé. Personne ne se connecte au compte Convex à leur place.
4. Donner l'adresse des déploiements (`https://….convex.cloud`) : elle n'est pas secrète et sera écrite dans l'app.

**PostShiba** (le domaine est déjà créé, et les DNS sont posés par Cicco)
5. Vérifier que `notifications.klyra.fr` apparaît comme vérifié et que le cluster est prêt à envoyer (`sending_ready`).
6. Inviter pelin@ et yanis@klyra.design dans l'équipe PostShiba, puis demander l'approbation de production.
7. Créer deux clés **Send only** (dev et prod) et les transmettre par le formulaire de Cicco, avec l'identifiant d'équipe et celui du cluster (page API keys).
8. Mettre la conservation des copies d'e-mails à 0 jour.

**Variables d'environnement Convex** : je pose celles du dev avec la clé de développement (`POSTSHIBA_*`, et `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` de Convex Auth, que je génère sans assistant interactif). Pour la production, il faut soit que tu les saisisses toi-même sur le tableau de bord Convex, soit une clé qui a le droit de les modifier.

## Décisions du 29/10

Corentin a répondu aux questions du plan (réponses transmises par Cicco) :
1. **Région** : l'Irlande (`aws-eu-west-1`). C'était la proposition du plan ; Corentin n'a pas répondu sur ce point, on la garde.
2. **Admins** : ils ne voient ni les rappels ni les agendas des autres. Chacun voit ce qu'il a créé ou ce qu'on lui a assigné.
3. **App fermée** : un e-mail part de `rappels@notifications.klyra.fr` quand on t'assigne un rappel.
4. **Calendrier** : les créneaux occupés des autres ne sont pas visibles. On ne voit que les événements auxquels on participe.
5. **PostShiba** : gardé. Corentin accepte que les données des e-mails passent hors d'Europe.
6. **Hors ligne** : une v1 en lecture seule, avec la file d'attente de Convex tant que l'app est ouverte. C'était la proposition du plan ; Corentin n'a pas répondu sur ce point, on la garde.

## Ce qui a été fait dans la PR 2

- **Connexion facultative** : l'app marche sans compte. La connexion et la gestion de l'équipe sont dans Réglages › Équipe ; aucun écran ne bloque l'app tant qu'aucune donnée partagée n'existe.
- **Refus avant tout envoi** : une adresse ni invitée ni membre est refusée dans `createOrUpdateUser` (`convex/model/connexion.ts`) : aucun compte créé, aucun e-mail. L'écran affiche le même message que pour un envoi. L'API répond quand même autrement (une erreur au lieu de `started`) : quelqu'un qui appelle Convex directement peut savoir si une adresse est invitée. Risque jugé faible pour trois adresses connues ; à revoir si l'équipe grandit.
- **Adresse** : l'app l'envoie en minuscules et sans espaces ; le serveur refuse toute autre forme, pour qu'une adresse ne donne jamais deux comptes.
- **Liens** : la page relais n'accepte qu'un code de 16 à 128 caractères alphanumériques ; le lien `klyra://` n'est reçu que par l'app installée (`app.setAsDefaultProtocolClient`, `protocols` d'electron-builder). Si l'app ne s'ouvre pas, on colle le lien dans Réglages › Équipe.
- **Jetons** : `compte.json` dans le dossier de l'app, chiffré par le trousseau du système ; sans trousseau, ils restent en mémoire et il faut se reconnecter au lancement suivant.
- **Variables d'environnement** : déclarées dans `convex/convex.config.ts`. PostShiba n'envoie que si `POSTSHIBA_API_KEY`, `POSTSHIBA_TEAM_ID` et `POSTSHIBA_CLUSTER_ID` sont posées ; sinon l'envoi échoue avec un message clair. `KLYRA_COURRIEL_SIMULE=1`, sur le développement seulement, garde les e-mails dans la table `courrielsSimules`.
- **PostShiba** : avec une clé Send only, `GET /users/me` donne l'identifiant d'équipe (`team_id`), pas celui du cluster, qui se lit sur la page API keys. Attention : `POST /emails` ne tient pas compte de `sandbox: true` et envoie vraiment (constaté le 29/10).

## Sources

- [C1] Convex, Deploy key types : https://docs.convex.dev/cli/deploy-key-types
- [C2] Convex, Regions : https://docs.convex.dev/production/regions
- [C3] Convex, « We finally got our EU visa » (6/02/2026) : https://news.convex.dev/we-finally-got-our-eu-visa
- [C4] Convex, Pricing : https://www.convex.dev/pricing
- [C5] Convex, React client : https://docs.convex.dev/client/react
- [C6] Convex, Mutations : https://docs.convex.dev/functions/mutation-functions
- [C7] Convex, Optimistic updates : https://docs.convex.dev/client/react/optimistic-updates
- [C8] Convex, Sync : https://www.convex.dev/sync
- [C9] get-convex/curvilinear (archivé) : https://github.com/get-convex/curvilinear
- [C10] Convex, DPA : https://www.convex.dev/legal/dpa
- [C11] Convex, Subprocessors : https://www.convex.dev/legal/subprocessors
- [C12] Convex, Security : https://www.convex.dev/security
- [C13] Convex, Limits : https://docs.convex.dev/production/state/limits
- [C14] Convex, Backup and restore : https://docs.convex.dev/database/backup-restore
- [C15] Convex, Self-hosting : https://docs.convex.dev/self-hosting
- [C16] Convex Auth : https://docs.convex.dev/auth et https://docs.convex.dev/auth/convex-auth
- [P1] PostShiba, Send emails with Convex : https://postshiba.com/docs/send-with-convex
- [P2] PostShiba, Add and verify a domain : https://postshiba.com/docs/add-a-domain
- [P3] PostShiba, Subdomain or root domain? : https://postshiba.com/docs/knowledge-base/is-it-better-to-send-emails-from-a-subdomain
- [P4] PostShiba, Does PostShiba require production approval? : https://postshiba.com/docs/knowledge-base/does-capsule-require-production-approval
- [P5] PostShiba, Pricing : https://postshiba.com/pricing
- [P6] Bento, Privacy Policy : https://bentonow.com/legal/privacy
- [P7] PostShiba, Outbound retention : https://postshiba.com/docs/api-reference/outbound-retention
- Code de `@convex-dev/auth` 0.0.96 (npm) : `dist/server/implementation/signIn.js`, `redirects.js`, `mutations/verifyCodeAndSignIn.js`
- Code de `@postshiba/convex` 0.1.0 (npm) : `dist/client/index.d.ts`
