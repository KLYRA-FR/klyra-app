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

Relancer la commande met le serveur à jour et donne un nouveau lien ; les appareils déjà reliés le restent. Tout oublier : `curl … | sudo sh -s -- revoquer-tout`. Arrêter : `sudo systemctl disable --now klyra-serveur klyra-tunnel`. Le service OpenBot ne s’arrête pas.

Réglages facultatifs : `KLYRA_SERVEUR_NOM` (nom de la machine par défaut) et `KLYRA_SERVEUR_PORT` (8791), passés après `sudo` : `… | sudo KLYRA_SERVEUR_NOM="Klyra-VPS" sh`.

## Appairage

- `node klyra-serveur.mjs appairer` écrit un code à usage unique (10 min). L’app l’échange contre un **jeton d’appareil** (`POST /klyra/v1/appairer`), envoyé ensuite en `Authorization: Bearer`.
- Le serveur ne garde que les empreintes (SHA-256) des codes et des jetons (`donnees/codes.json`, `donnees/appareils.json`). Cinq codes faux de suite font tomber les codes en attente.
- Dans la fenêtre PC, le jeton reste dans le processus principal, chiffré par le trousseau du système (`serveurs.json` dans le dossier de l’app). Sur le téléphone, il reste dans le navigateur.
- « Retirer » dans l’app : `DELETE /klyra/v1/appareil`, puis l’app oublie le jeton (même si le serveur ne répond pas).
- La page `/` ne montre ni lien ni code.

### À la main

Avec Node 22 ou plus récent, depuis ce dépôt : `KLYRA_SERVEUR_NOM="Klyra-VPS" KLYRA_SERVEUR_DONNEES=./donnees node serveur/klyra-serveur.mjs`, avec son propre https devant (`KLYRA_SERVEUR_CERT` et `KLYRA_SERVEUR_CLE`, ou un proxy), puis `node serveur/klyra-serveur.mjs appairer` pour un code.

## Dans l’app

La fenêtre PC (1100 px et plus) a la colonne Serveurs. Le téléphone (moins de 760 px) l’a dans Plus, puis Serveurs. Les deux collent le lien, quittent ou retirent un serveur. Sans serveur, l’écran montre deux gestes : coller la commande sur le VPS, coller le lien qu’elle affiche. Dans Electron, un lien `klyra://rejoindre` déjà copié remplit le champ vide. Electron ouvre `klyra://rejoindre` et arrive sur cet écran, comme il ouvre `klyra://connexion`.

La fenêtre appelle le https du lien depuis le processus principal, et seulement cette origine (http seulement sur la machine locale). La politique `connect-src` de la fenêtre reste l’app et le compte Convex. Le téléphone, hors Electron, continue d’appeler en fetch.

Le téléphone scanne le QR affiché dans le terminal du VPS. Chaque appareil a son propre lien : relancer la commande en donne un nouveau.

Arrêter seulement ce programme : le processus `node serveur/klyra-serveur.mjs`. Le service OpenBot ne s’arrête pas.
