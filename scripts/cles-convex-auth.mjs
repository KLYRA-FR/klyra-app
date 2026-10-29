// Les clés de signature des sessions de Convex Auth, pour un déploiement (dev ou prod).
// Écrit JWT_PRIVATE_KEY et JWKS dans deux fichiers d'un dossier privé, sans rien afficher :
//
//   node scripts/cles-convex-auth.mjs /chemin/vers/dossier-prive
//   npx convex env set JWT_PRIVATE_KEY < /chemin/vers/dossier-prive/JWT_PRIVATE_KEY
//   npx convex env set JWKS < /chemin/vers/dossier-prive/JWKS
//   rm -r /chemin/vers/dossier-prive
//
// Changer ces clés déconnecte tout le monde : une seule fois par déploiement.
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dossier = process.argv[2];
if (!dossier) {
  console.error("Usage : node scripts/cles-convex-auth.mjs <dossier>");
  process.exit(1);
}
mkdirSync(dossier, { recursive: true, mode: 0o700 });

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
/* Convex Auth accepte la clé PKCS#8 sur une ligne, les retours à la ligne remplacés par des espaces. */
const prive = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...publicKey.export({ format: "jwk" }) }] });

writeFileSync(path.join(dossier, "JWT_PRIVATE_KEY"), prive, { mode: 0o600 });
writeFileSync(path.join(dossier, "JWKS"), jwks, { mode: 0o600 });
console.log(`Clés écrites dans ${dossier} (JWT_PRIVATE_KEY, JWKS).`);
