import type { NextConfig } from "next";

/**
 * L'app tourne dans Electron : Next.js est exporté en fichiers statiques (`out/`)
 * qu'Electron charge sans serveur. Conséquences :
 * - pas de Server Actions, de route handlers dynamiques ni de proxy ;
 * - les identifiants (chat, projet) passent en paramètre d'URL (`/chat?id=…`),
 *   car une route `[id]` exportée ne connaît que les id présents au build.
 * `cacheComponents` est désactivé : il demande un serveur Node.
 */
const nextConfig: NextConfig = {
  output: "export",
  transpilePackages: ["klyra-ui"],
  images: { unoptimized: true },
  /* Le « N » de Next en bas à gauche recouvrait ton avatar dans le menu. */
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
