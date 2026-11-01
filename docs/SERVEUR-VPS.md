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

## Dans l’app

La fenêtre PC (1100 px et plus) a la colonne Serveurs. Le téléphone (moins de 760 px) l’a dans Plus, puis Serveurs. Les deux collent le lien, quittent ou retirent un serveur. Electron ouvre `klyra://rejoindre` et arrive sur cet écran, comme il ouvre `klyra://connexion`.

La fenêtre appelle le https du lien depuis le processus principal, et seulement cette origine (http seulement sur la machine locale). La politique `connect-src` de la fenêtre reste l’app et le compte Convex. Le téléphone, hors Electron, continue d’appeler en fetch.

Safari ouvre aussi la page https du programme, sur le VPS. Le QR et le lien y sont affichés. Toucher Rejoindre relie ce serveur. Depuis un autre écran, la caméra scanne le même QR. Un autre VPS se rejoint avec son propre lien.

Arrêter seulement ce programme : le processus `node serveur/klyra-serveur.mjs`. Le service OpenBot ne s’arrête pas.
