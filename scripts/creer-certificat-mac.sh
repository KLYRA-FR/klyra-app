#!/bin/sh
# Crée le certificat auto-signé qui signe l'app Mac à chaque version, et le
# range dans les secrets GitHub du dépôt (MAC_CERT_P12, MAC_CERT_PASSWORD).
# À lancer UNE fois, par Corentin, sur un poste avec openssl et gh connecté :
#
#   sh scripts/creer-certificat-mac.sh
#
# Garde ensuite le fichier .p12 et son mot de passe dans ton gestionnaire de
# mots de passe : un nouveau certificat ferait perdre aux Mac leurs autorisations
# (Accessibilité, Enregistrement de l'écran) une dernière fois.
#
# --local DOSSIER : crée seulement le certificat dans DOSSIER, sans toucher aux
# secrets (utilisé par la vérification des PR, avec un certificat jetable).
set -eu

DEPOT="KLYRA-FR/klyra-app"
LOCAL=""
if [ "${1:-}" = "--local" ]; then
  LOCAL="${2:?Indique le dossier : --local DOSSIER}"
  mkdir -p "$LOCAL"
  DOSSIER="$LOCAL"
else
  DOSSIER="$(mktemp -d)"
fi

cat > "$DOSSIER/certificat.cnf" <<'CNF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = KLYRA signature
O = KLYRA
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
CNF

# Dix ans : la signature ne doit pas expirer entre deux versions.
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$DOSSIER/cle.pem" -out "$DOSSIER/certificat.pem" -config "$DOSSIER/certificat.cnf" 2>/dev/null

MOT_DE_PASSE="$(openssl rand -hex 24)"
# Le trousseau de macOS ne lit que les .p12 aux anciens algorithmes : -legacy avec OpenSSL 3.
LEGACY=""
if openssl pkcs12 -help 2>&1 | grep -q -- "-legacy"; then LEGACY="-legacy"; fi
openssl pkcs12 -export $LEGACY -name "KLYRA signature" \
  -inkey "$DOSSIER/cle.pem" -in "$DOSSIER/certificat.pem" \
  -out "$DOSSIER/klyra-signature.p12" -passout "pass:$MOT_DE_PASSE"
rm -f "$DOSSIER/cle.pem"

if [ -n "$LOCAL" ]; then
  printf '%s' "$MOT_DE_PASSE" > "$DOSSIER/mot-de-passe.txt"
  echo "Certificat jetable créé dans $DOSSIER."
  exit 0
fi

command -v gh >/dev/null || { echo "gh est introuvable : installe-le et connecte-toi (gh auth login)."; exit 1; }
base64 < "$DOSSIER/klyra-signature.p12" | tr -d '\n' | gh secret set MAC_CERT_P12 --repo "$DEPOT"
printf '%s' "$MOT_DE_PASSE" | gh secret set MAC_CERT_PASSWORD --repo "$DEPOT"

echo
echo "Les secrets MAC_CERT_P12 et MAC_CERT_PASSWORD sont enregistrés dans $DEPOT."
echo "À garder dans ton gestionnaire de mots de passe, puis à supprimer d'ici :"
echo "  fichier      : $DOSSIER/klyra-signature.p12"
echo "  mot de passe : $MOT_DE_PASSE"
