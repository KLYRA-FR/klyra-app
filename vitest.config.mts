import { generateKeyPairSync } from "node:crypto";
import { defineConfig } from "vitest/config";

/* Des clés de session jetables, propres à chaque lancement des tests (cf. scripts/cles-convex-auth.mjs). */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

export default defineConfig({
  test: {
    include: ["convex/**/*.test.ts"],
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    env: {
      KLYRA_COURRIEL_SIMULE: "1",
      SITE_URL: "https://essai.convex.site/connexion",
      CONVEX_SITE_URL: "https://essai.convex.site",
      JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString().trimEnd().replace(/\n/g, " "),
      JWKS: JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...publicKey.export({ format: "jwk" }) }] }),
    },
  },
});
