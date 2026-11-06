import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/* Des clés de session jetables, propres à chaque lancement des tests (cf. scripts/cles-convex-auth.mjs). */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/components/reglages/sections/Claude.test.tsx", "src/components/chat/CarteUtilisation.test.tsx", "src/components/chat/ContenuChoixModele.test.tsx", "src/components/chat/reglages-agent/VueCompetences.test.tsx", "convex/**/*.test.ts", "src/lib/fichiers.test.tsx", "src/components/serveur/AvisMiseAJour.test.tsx", "src/lib/identite.test.ts", "src/lib/collage.test.ts", "src/lib/recherche.test.ts", "src/lib/report.test.ts", "src/lib/maj-modele.test.ts", "src/lib/modeles-klyra.test.ts", "src/lib/suppression-rappels.test.ts", "src/lib/rappel-compte.test.ts", "src/lib/epinglage.test.ts", "src/lib/export-conversation.test.ts", "src/lib/apercu/apercu.test.ts", "src/lib/poste-texte.test.ts", "src/lib/mobile.test.ts", "src/lib/copie-compte.test.ts", "src/lib/serveur-vps.test.ts", "src/lib/lieux.test.ts", "src/lib/espace-sync.test.ts", "src/lib/telephone/**/*.test.ts", "src/lib/telephone/**/*.test.tsx", "src/lib/coque.test.ts", "src/lib/push.test.ts", "src/lib/tickets.test.ts", "src/lib/planning-routines.test.ts", "src/lib/fournisseurs.test.ts", "src/lib/menu-flottant.test.ts", "src/lib/repondre.test.ts", "src/lib/rang-agents.test.ts", "src/lib/ordre-barre.test.ts", "src/lib/rendus.test.ts", "src/lib/rendus-espace.test.ts", "src/lib/contexte.test.ts", "src/lib/configuration-klyra.test.ts", "src/lib/poids-fiche.test.ts", "src/lib/infobulle.test.ts", "src/lib/agent-file.test.ts", "src/lib/skills.test.ts", "src/lib/atelier-agent.test.ts", "src/lib/workflows/**/*.test.ts", "src/lib/atelier-equipe.test.ts", "src/lib/cartes-interactives.test.ts"],
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
