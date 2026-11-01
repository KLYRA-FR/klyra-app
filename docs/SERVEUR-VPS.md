# Serveur sur le VPS

Le téléphone ajoute un VPS qui existe déjà, par son adresse. Ce programme est ce qui répond. Sans lui, l’adresse ne mène nulle part. On ne le lance pas depuis ici : l’adresse du VPS n’est pas dans ce dépôt, et on n’en invente pas.

## Ce qui doit tourner

Sur le VPS, avec Node 22 ou plus récent, depuis ce dépôt :

```sh
KLYRA_SERVEUR_NOM="le nom choisi sur le VPS" \
KLYRA_SERVEUR_HOTE=0.0.0.0 \
KLYRA_SERVEUR_PORT=8787 \
KLYRA_SERVEUR_INVITATION="une invitation choisie sur le VPS" \
KLYRA_SERVEUR_CERT=/chemin/certificat.pem \
KLYRA_SERVEUR_CLE=/chemin/cle.pem \
node serveur/klyra-serveur.mjs
```

- `KLYRA_SERVEUR_NOM` est le nom affiché. Il se change ici, pas dans le téléphone.
- Sans `KLYRA_SERVEUR_HOTE`, le programme n’écoute que `127.0.0.1` : le téléphone ne peut pas l’atteindre.
- L’invitation est facultative. Si elle est posée, le téléphone doit la coller. Elle n’est pas dans le dépôt.
- Le certificat et la clé vont ensemble. Le téléphone est en https : l’adresse collée doit l’être aussi, avec un certificat que l’iPhone accepte. Un certificat signé par le VPS lui-même est refusé par Safari. On peut aussi laisser ce programme en http sur `127.0.0.1` et faire suivre le https par ce qui termine déjà le certificat sur le VPS. Le téléphone appelle alors l’adresse publique.

Il répond à `GET /klyra/v1/serveur`. S’il est arrêté, la connexion échoue.

## Sur le téléphone

Safari ouvre l’adresse d’essai qui finit par `/serveurs`. La première fois, « Continuer dans le navigateur ». On colle `https://…` (ou `klyra://rejoindre?adresse=https%3A%2F%2F…&invitation=…`), puis Rejoindre. Ajouter un serveur recommence le même geste pour un autre VPS. Depuis le compte déjà ouvert : Plus, puis Serveurs. Quitter laisse la ligne. Retirer l’enlève de ce téléphone.

Rien à acheter, aucune machine créée.
