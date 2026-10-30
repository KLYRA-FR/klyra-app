import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/* Des clés de session jetables, propres à chaque lancement des tests (cf. scripts/cles-convex-auth.mjs). */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["convex/**/*.test.ts", "src/lib/fichiers.test.tsx", "src/lib/identite.test.ts", "src/lib/collage.test.ts", "src/lib/recherche.test.ts", "src/lib/report.test.ts", "src/lib/maj-modele.test.ts", "src/lib/modeles-klyra.test.ts", "src/lib/suppression-rappels.test.ts"],
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
