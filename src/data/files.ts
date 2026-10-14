import type { FileNode } from "@/types/domain";

/**
 * Arborescences factices des projets, à la forme de ce que l'app lira sur le
 * disque (via Electron) : tout le dossier du projet, pas seulement `src/`.
 * Les dossiers d'abord, puis les fichiers, chacun par ordre alphabétique.
 */

type Arbre = (string | [string, Arbre])[];

function construire(arbre: Arbre, parent = ""): FileNode[] {
  const noeuds = arbre.map((entree): FileNode => {
    if (typeof entree === "string") {
      return { name: entree, path: parent + entree, kind: "fichier" };
    }
    const [nom, enfants] = entree;
    const path = parent + nom;
    return { name: nom, path, kind: "dossier", children: construire(enfants, `${path}/`) };
  });
  return noeuds.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) : a.kind === "dossier" ? -1 : 1,
  );
}

/** Un site Next.js du studio, comme klyra.fr ou Bizwhoo. */
const SITE_NEXT: Arbre = [
  [".claude", [["agents", ["dev.md", "designer.md"]], "settings.json"]],
  [".storybook", ["main.ts", "preview.ts"]],
  ["content", [["blog", ["refonte-du-site.mdx", "nos-outils.mdx"]]]],
  ["docs-site", ["architecture.md", "deploiement.md"]],
  ["figma-export", ["hero.png", "offres.png"]],
  ["public", [["brand", ["logo.svg", "logo-white.svg"]], ["images", ["hero.jpg", "equipe.jpg"]], "favicon.ico", "robots.txt"]],
  ["scripts", ["export-figma.mjs", "seed.ts"]],
  [
    "src",
    [
      ["app", ["globals.css", "layout.tsx", "page.tsx", ["offres", ["page.tsx"]], ["contact", ["page.tsx"]]]],
      ["components", ["footer.tsx", "hero.tsx", "navbar.tsx"]],
      ["lib", ["schemas.ts", "utils.ts"]],
    ],
  ],
  ".gitignore",
  ".mcp.json",
  ".npmrc",
  "AUDIT-SEO.md",
  "CLAUDE.md",
  "design-system.md",
  "eslint.config.mjs",
  "next-env.d.ts",
  "next.config.mjs",
  "package.json",
  "pnpm-lock.yaml",
  "postcss.config.mjs",
  "README.md",
];

/** Un outil interactif (lead magnet) avec sa base de données. */
const OUTIL: Arbre = [
  [".claude", ["settings.json"]],
  ["drizzle", ["0000_init.sql", "0001_scores.sql"]],
  ["public", ["favicon.ico", ["illustrations", ["etape-1.svg", "etape-2.svg"]]]],
  ["scripts", ["seed.ts"]],
  [
    "src",
    [
      ["app", ["layout.tsx", "page.tsx", ["diagnostic", ["page.tsx"]], ["api", [["score", ["route.ts"]]]]]],
      ["components", ["etape.tsx", "score.tsx"]],
      ["db", ["schema.ts"]],
    ],
  ],
  ".env.example",
  ".gitignore",
  "CLAUDE.md",
  "drizzle.config.ts",
  "package.json",
  "README.md",
];

/** Cette app : Electron + Next.js. */
const APP_BUREAU: Arbre = [
  [".claude", ["settings.json"]],
  ["docs", ["JOURNAL.md"]],
  ["electron", ["main.ts", "tsconfig.json"]],
  ["public", [["brand", ["logo-signe-white.svg", "logotype-generic.svg"]]]],
  [
    "src",
    [
      ["app", ["globals.css", "layout.tsx", "page.tsx"]],
      ["components", [["chat", ["Composer.tsx", "MessageThread.tsx"]], ["shell", ["AppShell.tsx"]]]],
      ["data", ["agents.ts", "mock.ts"]],
      ["lib", ["workspace.tsx"]],
    ],
  ],
  "CLAUDE.md",
  "next.config.ts",
  "package.json",
  "README.md",
];

export const PROJECT_FILES = {
  siteNext: () => construire(SITE_NEXT),
  outil: () => construire(OUTIL),
  appBureau: () => construire(APP_BUREAU),
};
