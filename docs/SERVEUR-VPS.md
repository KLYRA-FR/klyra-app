# Serveur sur le VPS

Le téléphone rejoint un VPS déjà en marche, comme OpenBot : un QR affiché par le serveur, ou un lien `klyra://rejoindre`. On ne colle pas l’IP, et on n’achète rien.

## Lancer le serveur, en une commande

Sur le VPS (Linux, x64 ou arm64), sans root :

```sh
curl -fsSL https://raw.githubusercontent.com/KLYRA-FR/klyra-app/main/serveur/lancer.sh | sh
```

`serveur/lancer.sh` installe tout dans `~/.klyra-serveur` : Node 22 si la machine n’en a pas, `cloudflared`, `klyra-serveur.mjs` et `qr.mjs`. Il lance le serveur sur `127.0.0.1:8791`, ouvre un tunnel Cloudflare gratuit (adresse `https://….trycloudflare.com`, sans domaine ni certificat) et affiche le lien `klyra://rejoindre` à coller dans l’app. L’invitation est créée une fois (`~/.klyra-serveur/invitation`) et gardée.

Relancer la commande arrête l’ancien serveur et l’ancien tunnel, puis en ouvre un nouveau : l’adresse change, il faut recoller le lien. Même chose après un redémarrage du VPS. Pour une adresse fixe, il faudra un tunnel nommé sur un domaine KLYRA.

Réglages facultatifs : `KLYRA_SERVEUR_NOM` (nom de la machine par défaut), `KLYRA_SERVEUR_PORT` (8791), `KLYRA_SERVEUR_DOSSIER`. Ne pas prendre 22, 3077, 3417, 50959, ni un port d’OpenBot.

Arrêter : `kill $(cat ~/.klyra-serveur/serveur.pid ~/.klyra-serveur/tunnel.pid)`. Le service OpenBot ne s’arrête pas.

### À la main

Avec Node 22 ou plus récent, depuis ce dépôt : `KLYRA_SERVEUR_NOM="Klyra-VPS" KLYRA_SERVEUR_PORT=8791 node serveur/klyra-serveur.mjs`, avec son propre https devant (`KLYRA_SERVEUR_CERT` et `KLYRA_SERVEUR_CLE`, ou un proxy).

La page `/` montre le QR et le lien. Elle répond aussi à `GET /klyra/v1/serveur`. S’il est arrêté, la connexion échoue.

## Dans l’app

La fenêtre PC (1100 px et plus) a la colonne Serveurs. Le téléphone (moins de 760 px) l’a dans Plus, puis Serveurs. Les deux collent le lien, quittent ou retirent un serveur. Sans serveur, l’écran montre deux gestes : coller la commande sur le VPS, coller le lien qu’elle affiche. Dans Electron, un lien `klyra://rejoindre` déjà copié remplit le champ vide. Electron ouvre `klyra://rejoindre` et arrive sur cet écran, comme il ouvre `klyra://connexion`.

Safari ouvre aussi la page https du programme, sur le VPS. Le QR et le lien y sont affichés. Toucher Rejoindre relie ce serveur. Depuis un autre écran, la caméra scanne le même QR. Un autre VPS se rejoint avec son propre lien.

Arrêter seulement ce programme : le processus `node serveur/klyra-serveur.mjs`. Le service OpenBot ne s’arrête pas.
