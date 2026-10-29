#!/bin/sh
# Action GitHub, Mac : importe le certificat de signature (MAC_CERT_P12 en
# base64, MAC_CERT_PASSWORD) dans un trousseau temporaire, et donne à
# scripts/signer-mac.cjs son empreinte (KLYRA_MAC_SIGN_IDENTITY) et le
# trousseau (KLYRA_MAC_KEYCHAIN) par $GITHUB_ENV.
# Sans certificat : un avertissement, et l'app reste signée ad hoc.
set -eu

if [ -z "${MAC_CERT_P12:-}" ] || [ -z "${MAC_CERT_PASSWORD:-}" ]; then
  echo "::warning title=Signature ad hoc::Pas de certificat (secrets MAC_CERT_P12 et MAC_CERT_PASSWORD) : les Mac perdront leurs autorisations à cette mise à jour. Voir scripts/creer-certificat-mac.sh."
  exit 0
fi

TROUSSEAU="$RUNNER_TEMP/klyra-signature.keychain-db"
SECRET_TROUSSEAU="$(openssl rand -hex 16)"
P12="$RUNNER_TEMP/klyra-signature.p12"

printf '%s' "$MAC_CERT_P12" | base64 --decode > "$P12"
security create-keychain -p "$SECRET_TROUSSEAU" "$TROUSSEAU"
security set-keychain-settings -lut 3600 "$TROUSSEAU"
security unlock-keychain -p "$SECRET_TROUSSEAU" "$TROUSSEAU"
security import "$P12" -k "$TROUSSEAU" -P "$MAC_CERT_PASSWORD" -T /usr/bin/codesign
# codesign peut lire la clé sans fenêtre de confirmation.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$SECRET_TROUSSEAU" "$TROUSSEAU" >/dev/null
# Le trousseau dans la liste de recherche, à côté de ceux du système.
security list-keychains -d user -s "$TROUSSEAU" $(security list-keychains -d user | tr -d '"')
rm -f "$P12"

# Un certificat auto-signé n'est pas « valide » pour le système (-v l'écarterait) : on le prend par son empreinte.
EMPREINTE="$(security find-identity -p codesigning "$TROUSSEAU" | awk '/KLYRA signature/ { print $2; exit }')"
if [ -z "$EMPREINTE" ]; then
  echo "::error title=Certificat illisible::Le certificat importé n'apparaît pas comme identité de signature."
  exit 1
fi

echo "KLYRA_MAC_SIGN_IDENTITY=$EMPREINTE" >> "$GITHUB_ENV"
echo "KLYRA_MAC_KEYCHAIN=$TROUSSEAU" >> "$GITHUB_ENV"
echo "Certificat importé : ${EMPREINTE%"${EMPREINTE#????????}"}…"
