#!/bin/sh
# Installe et lance le serveur KLYRA sur un VPS Linux, en une commande :
#   curl -fsSL https://raw.githubusercontent.com/KLYRA-FR/klyra-app/main/serveur/lancer.sh | sudo sh
# Puis affiche un lien et un QR à usage unique (10 minutes) pour relier l'app.
#
# - Le serveur tourne sous l'utilisateur « klyra », sans sudo, en service systemd (redémarre avec le VPS).
# - Adresse : Tailscale si le VPS y est connecté (privée, fixe) ; sinon un tunnel Cloudflare gratuit,
#   dont l'adresse change à chaque redémarrage.
# - Relancer la commande met le serveur à jour et donne un nouveau lien. Les appareils déjà reliés le restent.
# - Tout oublier : curl … | sudo sh -s -- revoquer-tout
# - Connecter Claude Code (agents sur le VPS) : curl … | sudo sh -s -- connecter-claude
set -eu

PORT="${KLYRA_SERVEUR_PORT:-8791}"
NOM="${KLYRA_SERVEUR_NOM:-$(hostname 2>/dev/null || echo KLYRA)}"
SOURCE="${KLYRA_SERVEUR_SOURCE:-https://raw.githubusercontent.com/KLYRA-FR/klyra-app/main/serveur}"
NODE_VERSION="22.12.0"
UTILISATEUR="klyra"
# Le dossier de klyra (ses agents y travaillent) ; le code à part, à root : ni le serveur ni ses agents ne le réécrivent.
RACINE="/var/lib/klyra"
CODE_DIR="/opt/klyra-serveur"
DONNEES="$RACINE/donnees"
COMMANDE="${1:-}"

dire() { printf '%s\n' "$*"; }
echouer() { printf 'Erreur : %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || echouer "ce script tourne sur un VPS Linux."
[ "$(id -u)" -eq 0 ] || echouer "lance-la avec sudo : curl -fsSL $SOURCE/lancer.sh | sudo sh"
command -v systemctl >/dev/null || echouer "systemd est nécessaire."
command -v curl >/dev/null || echouer "curl est nécessaire."
case "$(uname -m)" in
  x86_64 | amd64) ARCH_NODE="x64"; ARCH_CF="amd64" ;;
  aarch64 | arm64) ARCH_NODE="arm64"; ARCH_CF="arm64" ;;
  *) echouer "processeur $(uname -m) non pris en charge." ;;
esac

en_klyra() { runuser -u "$UTILISATEUR" -- env HOME="$RACINE" KLYRA_SERVEUR_DONNEES="$DONNEES" "$@"; }

# ─── Utilisateur et dossiers ─────────────────────────────────────────
if ! id "$UTILISATEUR" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$RACINE" --shell /bin/bash "$UTILISATEUR"
fi
mkdir -p "$CODE_DIR" "$DONNEES"
chown root:root "$CODE_DIR"
chmod 755 "$CODE_DIR"
chown "$UTILISATEUR":"$UTILISATEUR" "$RACINE" "$DONNEES"
chmod 750 "$RACINE"
chmod 700 "$DONNEES"

# Claude Code, pour les agents du VPS : installé pour klyra, connecté à l'abonnement de la personne
# par un jeton longue durée (claude setup-token), gardé dans donnees/claude-token.
CLAUDE="$RACINE/.local/bin/claude"
installer_claude() {
  if [ ! -x "$CLAUDE" ]; then
    dire "Installation de Claude Code pour les agents du VPS…"
    en_klyra bash -c 'curl -fsSL https://claude.ai/install.sh | bash' >/dev/null 2>&1 || dire "Claude Code n'a pas pu s'installer : les agents du VPS ne répondront pas."
  fi
}
connecter_claude() {
  [ -x "$CLAUDE" ] || echouer "Claude Code n'est pas installé pour klyra."
  [ -r /dev/tty ] || echouer "il faut un terminal pour connecter Claude Code."
  dire ""
  dire "Connexion de Claude Code à ton abonnement : ouvre le lien qui s'affiche, valide, puis copie le jeton (sk-ant-oat…)."
  en_klyra "$CLAUDE" setup-token < /dev/tty > /dev/tty 2>&1 || true
  printf 'Colle le jeton ici, puis Entrée : ' > /dev/tty
  stty -echo < /dev/tty 2>/dev/null || true
  read -r JETON < /dev/tty || JETON=""
  stty echo < /dev/tty 2>/dev/null || true
  printf '\n' > /dev/tty
  case "$JETON" in
    sk-ant-*) ;;
    *) echouer "ce n'est pas un jeton Claude (il commence par sk-ant-). Relance : curl … | sudo sh -s -- connecter-claude" ;;
  esac
  (umask 077 && printf '%s' "$JETON" > "$DONNEES/claude-token")
  chown "$UTILISATEUR":"$UTILISATEUR" "$DONNEES/claude-token"
  dire "Claude Code est connecté : les agents peuvent tourner sur ce VPS."
}

if [ "$COMMANDE" = "revoquer-tout" ]; then
  [ -f "$CODE_DIR/klyra-serveur.mjs" ] || echouer "le serveur n'est pas installé."
  NODE="$(cat "$CODE_DIR/node-chemin")"
  en_klyra "$NODE" "$CODE_DIR/klyra-serveur.mjs" revoquer-tout
  exit 0
fi
if [ "$COMMANDE" = "connecter-claude" ]; then
  installer_claude
  connecter_claude
  exit 0
fi
[ -z "$COMMANDE" ] || echouer "commande inconnue : $COMMANDE (revoquer-tout ou connecter-claude)."

# ─── L'ancienne version, lancée en arrière-plan sans service ──────────
for ancien in /root/.klyra-serveur "${SUDO_USER:+$(getent passwd "$SUDO_USER" | cut -d: -f6)/.klyra-serveur}"; do
  [ -n "$ancien" ] && [ -d "$ancien" ] || continue
  for nom in serveur tunnel; do
    if [ -s "$ancien/$nom.pid" ]; then
      pid="$(cat "$ancien/$nom.pid")"
      if grep -qE "klyra-serveur|cloudflared" "/proc/$pid/cmdline" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
      rm -f "$ancien/$nom.pid"
    fi
  done
done

# ─── Node 22 ou plus récent ──────────────────────────────────────────
NODE=""
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ]; then
  NODE="$(command -v node)"
elif [ -x "$CODE_DIR/node/bin/node" ]; then
  NODE="$CODE_DIR/node/bin/node"
else
  dire "Téléchargement de Node $NODE_VERSION…"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH_NODE.tar.gz" -o "$CODE_DIR/node.tar.gz"
  rm -rf "$CODE_DIR/node" && mkdir "$CODE_DIR/node"
  tar -xzf "$CODE_DIR/node.tar.gz" -C "$CODE_DIR/node" --strip-components=1
  rm "$CODE_DIR/node.tar.gz"
  NODE="$CODE_DIR/node/bin/node"
fi
printf '%s' "$NODE" > "$CODE_DIR/node-chemin"
SQLITE_OPTION=""
if ! "$NODE" -e 'require("node:sqlite")' >/dev/null 2>&1; then
  "$NODE" --experimental-sqlite -e 'require("node:sqlite")' >/dev/null 2>&1 || echouer "ce Node ne fournit pas le stockage SQLite requis par la mémoire."
  SQLITE_OPTION="--experimental-sqlite"
fi

dire "Téléchargement du serveur KLYRA…"
curl -fsSL "$SOURCE/klyra-serveur.mjs" -o "$CODE_DIR/klyra-serveur.mjs"
curl -fsSL "$SOURCE/version-code.mjs" -o "$CODE_DIR/version-code.mjs"
curl -fsSL "$SOURCE/qr.mjs" -o "$CODE_DIR/qr.mjs"
curl -fsSL "$SOURCE/agents.mjs" -o "$CODE_DIR/agents.mjs"
curl -fsSL "$SOURCE/equipe.mjs" -o "$CODE_DIR/equipe.mjs"
curl -fsSL "$SOURCE/fichiers.mjs" -o "$CODE_DIR/fichiers.mjs"
curl -fsSL "$SOURCE/espace.mjs" -o "$CODE_DIR/espace.mjs"
curl -fsSL "$SOURCE/fournisseurs.mjs" -o "$CODE_DIR/fournisseurs.mjs"
curl -fsSL "$SOURCE/routines.mjs" -o "$CODE_DIR/routines.mjs"
curl -fsSL "$SOURCE/horaires.mjs" -o "$CODE_DIR/horaires.mjs"
curl -fsSL "$SOURCE/codex.mjs" -o "$CODE_DIR/codex.mjs"
curl -fsSL "$SOURCE/codex-protocole.mjs" -o "$CODE_DIR/codex-protocole.mjs"
curl -fsSL "$SOURCE/installation.mjs" -o "$CODE_DIR/installation.mjs"
curl -fsSL "$SOURCE/moteurs.mjs" -o "$CODE_DIR/moteurs.mjs"
curl -fsSL "$SOURCE/ia.mjs" -o "$CODE_DIR/ia.mjs"
curl -fsSL "$SOURCE/github-projets.mjs" -o "$CODE_DIR/github-projets.mjs"
curl -fsSL "$SOURCE/github-stockage.mjs" -o "$CODE_DIR/github-stockage.mjs"
curl -fsSL "$SOURCE/git.mjs" -o "$CODE_DIR/git.mjs"
curl -fsSL "$SOURCE/composio-serveur.mjs" -o "$CODE_DIR/composio-serveur.mjs"
curl -fsSL "$SOURCE/composio-relais.mjs" -o "$CODE_DIR/composio-relais.mjs"
curl -fsSL "$SOURCE/composio-connect.mjs" -o "$CODE_DIR/composio-connect.mjs"
curl -fsSL "$SOURCE/ia-catalogue.mjs" -o "$CODE_DIR/ia-catalogue.mjs"
curl -fsSL "$SOURCE/atelier.mjs" -o "$CODE_DIR/atelier.mjs"
curl -fsSL "$SOURCE/connaissances-agent.mjs" -o "$CODE_DIR/connaissances-agent.mjs"
curl -fsSL "$SOURCE/cerveau-types.mjs" -o "$CODE_DIR/cerveau-types.mjs"
curl -fsSL "$SOURCE/cerveau-sens.mjs" -o "$CODE_DIR/cerveau-sens.mjs"
curl -fsSL "$SOURCE/cerveau-liens.mjs" -o "$CODE_DIR/cerveau-liens.mjs"
curl -fsSL "$SOURCE/cerveau.mjs" -o "$CODE_DIR/cerveau.mjs"
curl -fsSL "$SOURCE/cerveau-ingest.mjs" -o "$CODE_DIR/cerveau-ingest.mjs"
curl -fsSL "$SOURCE/cerveau-veille.mjs" -o "$CODE_DIR/cerveau-veille.mjs"
curl -fsSL "$SOURCE/cerveau-service.mjs" -o "$CODE_DIR/cerveau-service.mjs"
curl -fsSL "$SOURCE/cerveau-dossiers.mjs" -o "$CODE_DIR/cerveau-dossiers.mjs"
curl -fsSL "$SOURCE/cerveau-synchro.mjs" -o "$CODE_DIR/cerveau-synchro.mjs"
curl -fsSL "$SOURCE/cerveau-outils.mjs" -o "$CODE_DIR/cerveau-outils.mjs"
curl -fsSL "$SOURCE/extraction-fichiers.mjs" -o "$CODE_DIR/extraction-fichiers.mjs"
curl -fsSL "$SOURCE/graphe-souvenirs.mjs" -o "$CODE_DIR/graphe-souvenirs.mjs"
curl -fsSL "$SOURCE/graphe-regles.mjs" -o "$CODE_DIR/graphe-regles.mjs"
curl -fsSL "$SOURCE/graphe-agent.mjs" -o "$CODE_DIR/graphe-agent.mjs"
curl -fsSL "$SOURCE/graphe-entretien.mjs" -o "$CODE_DIR/graphe-entretien.mjs"
curl -fsSL "$SOURCE/skills-par-agent.mjs" -o "$CODE_DIR/skills-par-agent.mjs"
curl -fsSL "$SOURCE/preparation-fournisseur.mjs" -o "$CODE_DIR/preparation-fournisseur.mjs"
curl -fsSL "$SOURCE/consommation-ecart.mjs" -o "$CODE_DIR/consommation-ecart.mjs"
curl -fsSL "$SOURCE/utilisation.mjs" -o "$CODE_DIR/utilisation.mjs"
curl -fsSL "$SOURCE/comptes-claude.mjs" -o "$CODE_DIR/comptes-claude.mjs"
curl -fsSL "$SOURCE/acp.mjs" -o "$CODE_DIR/acp.mjs"
curl -fsSL "$SOURCE/grok.mjs" -o "$CODE_DIR/grok.mjs"
curl -fsSL "$SOURCE/diagnostic-poste.mjs" -o "$CODE_DIR/diagnostic-poste.mjs"
curl -fsSL "$SOURCE/consignes-projet.mjs" -o "$CODE_DIR/consignes-projet.mjs"
curl -fsSL "$SOURCE/rendus.mjs" -o "$CODE_DIR/rendus.mjs"
curl -fsSL "$SOURCE/navigateur.mjs" -o "$CODE_DIR/navigateur.mjs"
curl -fsSL "$SOURCE/navigateur-definitions.mjs" -o "$CODE_DIR/navigateur-definitions.mjs"
curl -fsSL "$SOURCE/coffre.mjs" -o "$CODE_DIR/coffre.mjs"
curl -fsSL "$SOURCE/coffre-serveur.mjs" -o "$CODE_DIR/coffre-serveur.mjs"
curl -fsSL "$SOURCE/coffre-regles.mjs" -o "$CODE_DIR/coffre-regles.mjs"
curl -fsSL "$SOURCE/coffre-definitions.mjs" -o "$CODE_DIR/coffre-definitions.mjs"
curl -fsSL "$SOURCE/coffre-fichier.mjs" -o "$CODE_DIR/coffre-fichier.mjs"
curl -fsSL "$SOURCE/workflows.mjs" -o "$CODE_DIR/workflows.mjs"
curl -fsSL "$SOURCE/workflows-moteur.mjs" -o "$CODE_DIR/workflows-moteur.mjs"
curl -fsSL "$SOURCE/workflows-moteur-coeur.mjs" -o "$CODE_DIR/workflows-moteur-coeur.mjs"
curl -fsSL "$SOURCE/workflows-types.mjs" -o "$CODE_DIR/workflows-types.mjs"
curl -fsSL "$SOURCE/planning-passages.mjs" -o "$CODE_DIR/planning-passages.mjs"
curl -fsSL "$SOURCE/workflows-outils.mjs" -o "$CODE_DIR/workflows-outils.mjs"
curl -fsSL "$SOURCE/epreuve.mjs" -o "$CODE_DIR/epreuve.mjs"
curl -fsSL "$SOURCE/json-partiel.mjs" -o "$CODE_DIR/json-partiel.mjs"
curl -fsSL "$SOURCE/taches-fond.mjs" -o "$CODE_DIR/taches-fond.mjs"
curl -fsSL "$SOURCE/session-claude.mjs" -o "$CODE_DIR/session-claude.mjs"
curl -fsSL "$SOURCE/liste-fichiers.mjs" -o "$CODE_DIR/liste-fichiers.mjs"
curl -fsSL "$SOURCE/regles-projet.mjs" -o "$CODE_DIR/regles-projet.mjs"
curl -fsSL "$SOURCE/branche-travail.mjs" -o "$CODE_DIR/branche-travail.mjs"
curl -fsSL "$SOURCE/sessions-terminal.mjs" -o "$CODE_DIR/sessions-terminal.mjs"
curl -fsSL "$SOURCE/terminal.mjs" -o "$CODE_DIR/terminal.mjs"
curl -fsSL "$SOURCE/mcp-sante.mjs" -o "$CODE_DIR/mcp-sante.mjs"
curl -fsSL "$SOURCE/atelier-agent.mjs" -o "$CODE_DIR/atelier-agent.mjs"
curl -fsSL "$SOURCE/atelier-equipe.mjs" -o "$CODE_DIR/atelier-equipe.mjs"
curl -fsSL "$SOURCE/cartes-interactives.mjs" -o "$CODE_DIR/cartes-interactives.mjs"
curl -fsSL "$SOURCE/joints.mjs" -o "$CODE_DIR/joints.mjs"
curl -fsSL "$SOURCE/joints-vps.mjs" -o "$CODE_DIR/joints-vps.mjs"
curl -fsSL "$SOURCE/fils.mjs" -o "$CODE_DIR/fils.mjs"
curl -fsSL "$SOURCE/fils-outils.mjs" -o "$CODE_DIR/fils-outils.mjs"
curl -fsSL "$SOURCE/github-outils.mjs" -o "$CODE_DIR/github-outils.mjs"
curl -fsSL "$SOURCE/tickets.mjs" -o "$CODE_DIR/tickets.mjs"
chmod 644 "$CODE_DIR"/*.mjs "$CODE_DIR/node-chemin"

# GitHub CLI pour le sélecteur de dépôts : version et empreintes épinglées (github-cli.lock.json).
case "$(uname -m)" in
  x86_64) GH_ARCH=amd64; GH_SHA=4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d ;;
  aarch64|arm64) GH_ARCH=arm64; GH_SHA=ee32df2323c8847f5fac6cb6b4b69ca75828e9329a8f22f677021f7b3306ce63 ;;
  *) echouer "architecture non prise en charge par GitHub CLI" ;;
esac
GH_TMP=$(mktemp -d)
curl -fsSL "https://github.com/cli/cli/releases/download/v2.103.3/gh_2.103.3_linux_$GH_ARCH.tar.gz" -o "$GH_TMP/gh.tgz"
printf '%s  %s\n' "$GH_SHA" "$GH_TMP/gh.tgz" | sha256sum -c - >/dev/null || { rm -rf "$GH_TMP"; echouer "empreinte GitHub CLI incorrecte"; }
tar -xzf "$GH_TMP/gh.tgz" -C "$GH_TMP"
install -m 755 "$GH_TMP/gh_2.103.3_linux_$GH_ARCH/bin/gh" "$CODE_DIR/gh"
install -m 644 "$GH_TMP/gh_2.103.3_linux_$GH_ARCH/LICENSE" "$CODE_DIR/gh-LICENSE"
rm -rf "$GH_TMP"

# ─── Service ─────────────────────────────────────────────────────────
# Séparé d'OpenBot et du reste de la machine : seul son dossier est en écriture.
cat > /etc/systemd/system/klyra-serveur.service <<EOF
[Unit]
Description=Serveur KLYRA
After=network-online.target
Wants=network-online.target

[Service]
User=$UTILISATEUR
Environment=HOME=$RACINE
Environment=KLYRA_SERVEUR_NOM=$NOM
Environment=KLYRA_SERVEUR_PORT=$PORT
Environment=KLYRA_SERVEUR_HOTE=127.0.0.1
Environment=KLYRA_SERVEUR_DONNEES=$DONNEES
ExecStart=$NODE $SQLITE_OPTION $CODE_DIR/klyra-serveur.mjs
Restart=always
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$RACINE
InaccessiblePaths=-/var/lib/openbot -/opt/OpenBot -/root -/etc/sudoers.d

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable klyra-serveur >/dev/null 2>&1
systemctl restart klyra-serveur

i=0
until curl -fs -o /dev/null "http://127.0.0.1:$PORT/"; do
  i=$((i + 1))
  [ $i -lt 30 ] || echouer "le serveur ne démarre pas. Détail : journalctl -u klyra-serveur"
  sleep 1
done

# ─── Adresse ─────────────────────────────────────────────────────────
ADRESSE=""
if command -v tailscale >/dev/null && tailscale status >/dev/null 2>&1; then
  DNS="$(tailscale status --json 2>/dev/null | "$NODE" -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{try{process.stdout.write((JSON.parse(t).Self.DNSName||"").replace(/\.$/,""))}catch{}})')"
  if [ -n "$DNS" ] && tailscale serve --bg --https="$PORT" "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    ADRESSE="https://$DNS:$PORT"
    systemctl disable --now klyra-tunnel >/dev/null 2>&1 || true
  else
    dire "Tailscale est là, mais « tailscale serve » a refusé (HTTPS à activer dans la console Tailscale ?). Tunnel Cloudflare à la place."
  fi
fi

if [ -z "$ADRESSE" ]; then
  if [ ! -x "$CODE_DIR/cloudflared" ]; then
    dire "Téléchargement du tunnel…"
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH_CF" -o "$CODE_DIR/cloudflared"
    chmod 755 "$CODE_DIR/cloudflared"
  fi
  cat > /etc/systemd/system/klyra-tunnel.service <<EOF
[Unit]
Description=Tunnel du serveur KLYRA
After=klyra-serveur.service

[Service]
User=$UTILISATEUR
ExecStart=$CODE_DIR/cloudflared tunnel --url http://127.0.0.1:$PORT --no-autoupdate
StandardOutput=append:$DONNEES/tunnel.log
StandardError=append:$DONNEES/tunnel.log
Restart=always
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DONNEES

[Install]
WantedBy=multi-user.target
EOF
  : > "$DONNEES/tunnel.log"
  chown "$UTILISATEUR":"$UTILISATEUR" "$DONNEES/tunnel.log"
  systemctl daemon-reload
  systemctl enable klyra-tunnel >/dev/null 2>&1
  systemctl restart klyra-tunnel
  dire "Ouverture du tunnel…"
  i=0
  while [ -z "$ADRESSE" ] && [ $i -lt 60 ]; do
    ADRESSE="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$DONNEES/tunnel.log" 2>/dev/null | tail -n 1 || true)"
    i=$((i + 1))
    [ -n "$ADRESSE" ] || sleep 1
  done
  [ -n "$ADRESSE" ] || echouer "le tunnel n'a pas donné d'adresse. Détail : $DONNEES/tunnel.log"
fi

# ─── Claude Code pour les agents ─────────────────────────────────────
installer_claude
if [ -x "$CLAUDE" ] && [ ! -s "$DONNEES/claude-token" ] && [ ! -f "$RACINE/.claude/.credentials.json" ]; then
  if [ -r /dev/tty ]; then ( connecter_claude ) || dire "Claude Code n'est pas connecté. Plus tard : curl … | sudo sh -s -- connecter-claude"
  else dire "Claude Code n'est pas encore connecté. Pour les agents : curl … | sudo sh -s -- connecter-claude"
  fi
fi

# ─── Lien et QR à usage unique ───────────────────────────────────────
CODE="$(en_klyra "$NODE" "$CODE_DIR/klyra-serveur.mjs" appairer)"
LIEN="$("$NODE" -e 'const l = new URL("klyra://rejoindre"); l.searchParams.set("adresse", process.argv[1]); l.searchParams.set("code", process.argv[2]); process.stdout.write(l.toString())' "$ADRESSE" "$CODE")"

dire ""
dire "Le serveur KLYRA tourne : $ADRESSE"
dire ""
dire "Colle ce lien dans l'app, écran Serveurs (valable 10 minutes, une seule fois) :"
dire ""
dire "  $LIEN"
dire ""
"$NODE" --input-type=module -e "import { qrTerminal } from '$CODE_DIR/qr.mjs'; console.log(qrTerminal(process.argv[1]))" "$LIEN" 2>/dev/null || true
dire ""
case "$ADRESSE" in
  *trycloudflare.com) dire "Attention : cette adresse change si le VPS redémarre. Avec Tailscale sur le VPS, elle ne change plus." ;;
  *) dire "Cette adresse ne change pas. L'appareil doit être connecté au même réseau Tailscale." ;;
esac
dire "Un autre appareil : relance la commande pour un nouveau lien."
