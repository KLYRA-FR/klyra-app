import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    // Export préparé pour Vercel (scripts/sortie-vercel.mjs).
    ".vercel/**",
    "build/**",
    "next-env.d.ts",
    // Site vitrine (même construction, dossier à part) :
    "site/.next/**",
    "site/out/**",
    "site/next-env.d.ts",
    // Process principal Electron compilé :
    "dist-electron/**",
    // Généré par Convex :
    "convex/_generated/**",
  ]),
]);

export default eslintConfig;
