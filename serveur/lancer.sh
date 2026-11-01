#!/bin/sh
# Lance le serveur KLYRA sur un VPS Linux, en une commande :
#   curl -fsSL https://raw.githubusercontent.com/KLYRA-FR/klyra-app/main/serveur/lancer.sh | sh
# Sans root, sans domaine ni certificat : un tunnel Cloudflare gratuit donne l'adresse https.
# Tout va dans ~/.klyra-serveur. Relancer la commande redémarre le serveur et affiche un nouveau lien.
set -eu

DOSSIER="${KLYRA_SERVEUR_DOSSIER:-$HOME/.klyra-serveur}"
PORT="${KLYRA_SERVEUR_PORT:-8791}"
NOM="${KLYRA_SERVEUR_NOM:-$(hostname 2>/dev/null || echo KLYRA)}"
SOURCE="${KLYRA_SERVEUR_SOURCE:-https://raw.githubusercontent.com/KLYRA-FR/klyra-app/main/serveur}"
NODE_VERSION="22.12.0"

dire() { printf '%s\n' "$*"; }
echouer() { printf 'Erreur : %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || echouer "ce script tourne sur un VPS Linux."
case "$(uname -m)" in
  x86_64 | amd64) ARCH_NODE="x64"; ARCH_CF="amd64" ;;
  aarch64 | arm64) ARCH_NODE="arm64"; ARCH_CF="arm64" ;;
  *) echouer "processeur $(uname -m) non pris en charge." ;;
esac
command -v curl >/dev/null || echouer "curl est nécessaire."

mkdir -p "$DOSSIER"
chmod 700 "$DOSSIER"
cd "$DOSSIER"

# Node 22 ou plus récent : celui de la machine, sinon une copie dans le dossier.
NODE=""
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ]; then
  NODE="$(command -v node)"
elif [ -x "$DOSSIER/node/bin/node" ]; then
  NODE="$DOSSIER/node/bin/node"
else
  dire "Téléchargement de Node $NODE_VERSION…"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH_NODE.tar.gz" -o node.tar.gz
  rm -rf node && mkdir node
  tar -xzf node.tar.gz -C node --strip-components=1
  rm node.tar.gz
  NODE="$DOSSIER/node/bin/node"
fi

if [ ! -x "$DOSSIER/cloudflared" ]; then
  dire "Téléchargement du tunnel…"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH_CF" -o cloudflared
  chmod 700 cloudflared
fi

dire "Téléchargement du serveur KLYRA…"
curl -fsSL "$SOURCE/klyra-serveur.mjs" -o klyra-serveur.mjs
curl -fsSL "$SOURCE/qr.mjs" -o qr.mjs

# L'invitation est créée une fois et gardée : relancer ne change que l'adresse.
if [ ! -s invitation ]; then
  (umask 077 && "$NODE" -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("base64url"))' > invitation)
fi
INVITATION="$(cat invitation)"

# Arrête le lancement précédent, seulement si le numéro est encore le sien.
arreter() {
  if [ -s "$1" ]; then
    pid="$(cat "$1")"
    if grep -q "$2" "/proc/$pid/cmdline" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
    rm -f "$1"
  fi
}
arreter serveur.pid klyra-serveur
arreter tunnel.pid cloudflared
sleep 1

KLYRA_SERVEUR_NOM="$NOM" KLYRA_SERVEUR_HOTE=127.0.0.1 KLYRA_SERVEUR_PORT="$PORT" KLYRA_SERVEUR_INVITATION="$INVITATION" \
  nohup "$NODE" klyra-serveur.mjs < /dev/null > serveur.log 2>&1 &
echo $! > serveur.pid

nohup ./cloudflared tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate < /dev/null > tunnel.log 2>&1 &
echo $! > tunnel.pid

dire "Ouverture du tunnel…"
ADRESSE=""
i=0
while [ $i -lt 60 ]; do
  ADRESSE="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log 2>/dev/null | head -n 1 || true)"
  [ -n "$ADRESSE" ] && break
  kill -0 "$(cat serveur.pid)" 2>/dev/null || echouer "le serveur s'est arrêté. Détail dans $DOSSIER/serveur.log"
  i=$((i + 1))
  sleep 1
done
[ -n "$ADRESSE" ] || echouer "le tunnel n'a pas donné d'adresse. Détail dans $DOSSIER/tunnel.log"

LIEN="$("$NODE" -e 'const l = new URL("klyra://rejoindre"); l.searchParams.set("adresse", process.argv[1]); l.searchParams.set("invitation", process.argv[2]); process.stdout.write(l.toString())' "$ADRESSE" "$INVITATION")"

dire ""
dire "Le serveur KLYRA tourne."
dire ""
dire "Copie ce lien et colle-le dans l'app, écran Serveurs :"
dire ""
dire "  $LIEN"
dire ""
dire "Sur un téléphone, ouvre $ADRESSE et scanne le QR."
dire "Après un redémarrage du VPS, relance la même commande : elle donne un nouveau lien."
