# Composio dans KLYRA

Ouvrir **Réglages → Composio**, après « Autres IA ». Cet espace utilise uniquement Composio. Il ne lit pas la session du CLI, les comptes d’un VPS, ni les connexions d’autres outils.

## Configuration sur chaque poste

1. Choisir d’abord son compte d’équipe KLYRA, ou rester sur le profil local. Les deux espaces sont distincts. Chaque membre et chaque installation reçoit un identifiant Composio aléatoire propre ; aucune connexion n’est copiée entre postes ou membres.
2. Dans la [console Composio](https://platform.composio.dev), préparer les configurations d’authentification des services autorisés. KLYRA ne crée ni configuration, ni permission fournisseur. Seuls les services ayant une configuration dans ce projet sont proposés.
3. Créer une **clé API de projet**, enregistrée dans un fichier privé contenant uniquement cette clé. Dans KLYRA, « Importer la clé du projet… » ouvre le sélecteur de fichier du système. La clé est chiffrée avec le coffre du système ; elle ne traverse pas le renderer. Après l’import, supprimer soi-même le fichier privé si souhaité. KLYRA ne le supprime pas.
4. « Connecter un service », choisir le service et, si nécessaire, sa configuration. « Continuer dans le navigateur » ouvre le lien officiel hébergé. Vérifier les permissions demandées par le fournisseur avant de consentir. Revenir puis **Actualiser** : l’ouverture du navigateur seule ne confirme rien.
5. Quand Composio confirme le compte actif, choisir explicitement **Utiliser pour tes agents**, ou le compte dans la liste du service. Une connexion ou reconnexion ne change jamais seule ce choix.

Une clé de projet peut donner des droits étendus dans Composio. La confier uniquement aux personnes autorisées à administrer ce projet ; pour des domaines de confiance différents, employer des projets distincts. L’isolement local des profils KLYRA n’est pas une restriction administrative de la clé dans la console Composio.

Permissions de projet nécessaires : lecture des configurations d’authentification et des toolkits ; lecture/écriture des comptes connectés (création de liens, suppression ciblée) ; lecture des outils et exécution d’outils. Aucun droit proxy, trigger ou session Tool Router n’est utilisé. Voir les [permissions de clés Composio](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions).

## Comptes et agents

- Un compte choisi par service, ou **Aucun**. Les autres comptes peuvent être connectés sans être utilisables par les agents.
- Le compte est relu avant chaque appel. S’il expire, disparaît, est désactivé, appartient à une autre identité ou si la source échoue, l’appel est refusé sans remplacement. Le choix absent reste visible comme « introuvable » jusqu’à un autre choix explicite.
- Le changement de compte, de clé ou d’identité invalide immédiatement les anciennes capacités de processus. Une demande déjà transmise au fournisseur ne peut pas être annulée rétroactivement ; son résultat n’est pas divulgué sous une autre identité.
- Les agents disposent de trois outils locaux : état, recherche des schémas, exécution. Le compte et la version d’outil vérifiée sont imposés par le process principal ; le modèle ne choisit pas un autre compte. S’il reçoit une demande sur un autre compte, il renvoie vers les Réglages.
- Chaque exécution Composio demande la carte existante en accès **Me demander** ou **Le projet en autonomie**, sauf accord de session « Toujours ». **Tout accepter** conserve son fonctionnement : les cartes sont acceptées automatiquement. Les règles métier des agents restent applicables ; une connexion ne vaut pas permission d’envoyer, publier, payer ou supprimer.
- Les MCP/CLI éventuellement installés séparément ne sont pas administrés par cet espace. Les consignes injectées interdisent le repli silencieux vers eux. Le contrôle du compte décrit ici porte sur les outils Composio de KLYRA.

## Actualiser, reconnecter, retirer

**Actualiser** relit Composio ; le retour dans l’app ou du réseau déclenche également une relecture, au plus une par dix secondes. Les listes ne sont pas gardées dans le stockage du renderer. Une erreur masque les anciens états connectés.

**Reconnecter** crée un nouveau parcours officiel. L’ancien compte et le choix des agents sont conservés. Après confirmation du nouveau compte, le choisir puis déconnecter l’ancien si souhaité.

**Déconnecter** demande confirmation et supprime la connexion chez Composio. Le choix local est retiré avant la requête pour empêcher sa réutilisation ; un échec distant est annoncé sans faux succès. Cette suppression ne garantit pas la révocation de l’autorisation chez le fournisseur : vérifier au besoin les applications autorisées dans le compte du service. [Contrat officiel de suppression](https://docs.composio.dev/reference/api-reference/connected-accounts/deleteConnectedAccountsByNanoid).

**Retirer/remplacer la clé** efface les choix locaux des agents, sans supprimer les comptes chez Composio. Le même identifiant de profil local est conservé, ce qui permet de retrouver ses comptes après réimport de la clé du même projet.

## Architecture et limites

Adaptateur REST limité à l’origine officielle `backend.composio.dev`, API v3.1, branché au serveur MCP local déjà présent dans KLYRA. Les endpoints directs utilisés sont encore documentés mais marqués legacy ; ce choix évite un second runtime ou un SDK complet pour ce périmètre. [Connexion officielle](https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink), [recherche des outils](https://docs.composio.dev/reference/api-reference/tools/getTools), [exécution avec compte et version](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteByToolSlug).

La clé reste dans main et dans un fichier chiffré `composio-<profil>.json` du dossier de données de l’app. Aucun jeton fournisseur, clé ni lien privé d’authentification ne passe par l’état public, les prompts ou les arguments du processus Claude. Le lien éphémère est ouvert directement dans le navigateur par main. Les réponses métier retirent les champs d’authentification usuels ; elles restent des données non fiables pour l’agent.

Sur Linux, le backend Electron `basic_text` est refusé : un vrai coffre doit être disponible. L’identité d’équipe est vérifiée par le backend KLYRA depuis main ; hors ligne, elle reste fermée sans repli sur le profil local. Un coffre inaccessible ou un fichier chiffré endommagé bloque l’accès : rétablir le coffre et conserver le fichier pour diagnostic, sans le remplacer par un secret en clair.

Ce lot ne prouve pas un OAuth réel ni les droits d’un compte fournisseur : les tests utilisent des services et identités synthétiques. Le test final sur compte réel nécessite une autorisation distincte pour la liaison et les permissions demandées. Il ne doit envoyer aucun message ni déclencher d’opération payante.

## Vérification et retour arrière

- `pnpm build && pnpm build:electron && pnpm typecheck && pnpm lint`
- `pnpm test:composio` : contrats API et contrôleur, aucune requête réseau.
- `pnpm test:composio:natif` : IPC, import, coffre sûr ou refus, identité locale/équipe simulée.
- `pnpm test:composio:runtime` : serveur MCP réel, fournisseur simulé. Le mode vrai Claude est documenté dans `scripts/test-composio-runtime.cjs` et impose un namespace réseau Linux sans route extérieure.

Avant fusion, conserver le SHA main et une branche `sauvegarde/main-avant-composio-20261030`. Pour revenir en arrière : créer une branche depuis main courant, annuler la PR Composio seule, valider et fusionner cette nouvelle PR. L’action App publie une version supérieure. Ne pas réinitialiser main ni remplacer une release existante. Garder les fichiers Composio chiffrés locaux ; ils ne sont plus utilisés par la version antérieure. Aucune connexion fournisseur n’est supprimée par ce retour arrière.
