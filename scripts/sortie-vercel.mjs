/**
 * Prépare l'export statique `out/` pour Vercel, sans que Vercel le reconstruise (`vercel deploy --prebuilt`) :
 * `.vercel/output/static/` reçoit les fichiers tels quels, et `config.json` (Build Output API v3) sert
 * chaque page sans extension (`/chats` → `chats.html`), garde le service worker frais et renvoie
 * `404.html` pour le reste. Utilisé par `.github/workflows/app-web.yml` (docs/APP-WEB.md).
 *   node scripts/sortie-vercel.mjs [dossier de l'export] [dossier de sortie]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Les pages de l'export, chemin relatif avec `/` : `chats.html`, `index.html`… (pas `_next`). */
export function pagesHtml(dossier, base = "") {
  const pages = [];
  for (const entree of readdirSync(path.join(dossier, base), { withFileTypes: true })) {
    const relatif = base ? `${base}/${entree.name}` : entree.name;
    if (entree.isDirectory()) {
      if (entree.name !== "_next") pages.push(...pagesHtml(dossier, relatif));
    } else if (entree.name.endsWith(".html")) pages.push(relatif);
  }
  return pages.sort();
}

/** La configuration de Vercel : une adresse sans extension par page, `/` pour `index.html`. */
export function configVercel(pages) {
  const overrides = {};
  for (const page of pages) {
    if (page === "index.html" || page === "404.html") continue;
    overrides[page] = { path: page.slice(0, -".html".length), contentType: "text/html; charset=utf-8" };
  }
  return {
    version: 3,
    routes: [
      /* Le service worker est relu à chaque visite : une nouvelle version de l'app passe tout de suite. */
      { src: "^/sw\\.js$", headers: { "Cache-Control": "no-cache" }, continue: true },
      { src: "^/_next/static/(.*)$", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
      { handle: "filesystem" },
      { src: "^/(.*)$", status: 404, dest: "/404.html" },
    ],
    overrides,
  };
}

export function preparer(export_, sortie) {
  if (!existsSync(path.join(export_, "index.html"))) throw new Error(`Pas d'export dans ${export_} : lance d'abord pnpm build.`);
  rmSync(sortie, { recursive: true, force: true });
  mkdirSync(sortie, { recursive: true });
  cpSync(export_, path.join(sortie, "static"), { recursive: true });
  const config = configVercel(pagesHtml(export_));
  writeFileSync(path.join(sortie, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const racine = path.resolve(import.meta.dirname, "..");
  const config = preparer(path.resolve(process.argv[2] ?? path.join(racine, "out")), path.resolve(process.argv[3] ?? path.join(racine, ".vercel", "output")));
  process.stdout.write(`${Object.keys(config.overrides).length} pages prêtes pour Vercel.\n`);
}
