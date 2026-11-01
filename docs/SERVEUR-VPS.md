# Serveur sur le VPS

Le téléphone rejoint un VPS déjà en marche, comme OpenBot : un QR affiché par le serveur, ou un lien `klyra://rejoindre`. On ne colle pas l’IP, et on n’achète rien.

## Ce qui tourne à côté d’OpenBot

Sur la machine, avec Node 22 ou plus récent, depuis ce dépôt, sans root et sans toucher au service OpenBot :

```sh
KLYRA_SERVEUR_NOM="Klyra-VPS" \
KLYRA_SERVEUR_HOTE=127.0.0.1 \
KLYRA_SERVEUR_PORT=8791 \
node serveur/klyra-serveur.mjs
```

Le port 8791 est un exemple de port libre. On ne prend pas 22, 3077, 3417, 50959, ni un port déjà occupé par OpenBot. 443 et 8787 restent fermés. L’invitation est créée au lancement et n’est pas écrite dans le dépôt. L’écoute reste sur `127.0.0.1` : le téléphone passe par le https qui présente cette page, il ne reçoit pas une IP à taper.

La page `/` montre le QR et le lien. Elle répond aussi à `GET /klyra/v1/serveur`. S’il est arrêté, la connexion échoue.

## Sur l’iPhone

Safari ouvre la page https du serveur. Le QR est sur cette page. Toucher Rejoindre relie ce serveur. Depuis un autre écran, la caméra de l’iPhone scanne le même QR. Dans l’app, Plus puis Serveurs : coller le lien pour celui-ci, puis le lien d’un autre VPS. Quitter laisse la ligne. Retirer l’enlève de ce téléphone.

Arrêter seulement ce programme : le processus `node serveur/klyra-serveur.mjs`. Le service OpenBot ne s’arrête pas.
