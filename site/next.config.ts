import path from "node:path";
import type { NextConfig } from "next";

/**
 * Site vitrine de l'app (landing et changelog), exporté en fichiers statiques
 * (`site/out/`), hébergeable n'importe où. Même construction que l'app : Next.js
 * en export statique, Tailwind passé par Turbopack, et le design system pris à
 * la source dans `../src` (tokens, police, logo, icônes, boutons), jamais copié.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  /* Pages en dossiers (`/changelog/index.html`) : un hébergement statique les sert sans réglage. */
  trailingSlash: true,
  devIndicators: false,
  turbopack: {
    /* La racine du dépôt : le site lit `src/` et les node_modules de l'app. */
    root: path.join(__dirname, ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
