/**
 * Embarque les fiches de `agents-equipe/*.md` dans l'app
 * (`src/data/agent-templates.generated.ts`) : la collection « Modèles KLYRA »,
 * et leurs versions précédentes (`agents-equipe/versions-precedentes/<nom>.v<N>.md`),
 * qui permettent de reconnaître une fiche déjà installée et de proposer la mise à jour
 * sans écraser ce que la personne y a changé.
 *
 * Avant de modifier une fiche, copier sa version actuelle dans
 * `versions-precedentes/<nom>.v<N>.md` (N = sa version actuelle). Puis :
 *   pnpm agents:equipe
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const racine = path.resolve(import.meta.dirname, "..");
const dossier = path.join(racine, "agents-equipe");
const dossierPrecedentes = path.join(dossier, "versions-precedentes");
const sortie = path.join(racine, "src/data/agent-templates.generated.ts");

/* Fins de ligne LF, quel que soit le système qui a extrait le dépôt (Windows : CRLF). */
const lire = (fichier) => readFileSync(fichier, "utf8").replace(/\r\n/g, "\n");

const noms = readdirSync(dossier)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => f.slice(0, -3));

const fichiersPrecedents = existsSync(dossierPrecedentes) ? readdirSync(dossierPrecedentes).filter((f) => f.endsWith(".md")) : [];
for (const f of fichiersPrecedents) {
  const m = f.match(/^([a-z0-9-]+)\.v(\d+)\.md$/);
  if (!m || !noms.includes(m[1])) throw new Error(`versions-precedentes/${f} : attendu <nom>.v<N>.md pour une fiche de agents-equipe.`);
}

const precedents = {};
const fiches = noms.map((name) => {
  const content = lire(path.join(dossier, `${name}.md`));
  const versions = fichiersPrecedents
    .map((f) => f.match(new RegExp(`^${name}\\.v(\\d+)\\.md$`)))
    .filter(Boolean)
    .map((m) => ({ version: Number(m[1]), content: lire(path.join(dossierPrecedentes, m[0])) }))
    .sort((a, b) => a.version - b.version);
  versions.forEach((v, i) => {
    if (v.version !== i + 1) throw new Error(`${name} : versions précédentes à numéroter sans trou depuis v1 (trouvé v${v.version} en position ${i + 1}).`);
  });
  if (versions.length && versions.at(-1).content === content) {
    throw new Error(`${name} : identique à sa version précédente v${versions.length}. N’archive une version que si la fiche change.`);
  }
  if (versions.length) precedents[name] = versions;
  return { name, version: versions.length + 1, content };
});

writeFileSync(
  sortie,
  `/* GÉNÉRÉ par scripts/agents-equipe.mjs depuis agents-equipe/ — ne pas éditer à la main. */

/** Fiches de l'équipe KLYRA, texte intégral, à leur version actuelle. */
export const AGENT_TEMPLATES: { name: string; version: number; content: string }[] = ${JSON.stringify(fiches, null, 2)};

/** Versions précédentes de chaque modèle, texte intégral : pour reconnaître une fiche installée et la mettre à jour sans perte. */
export const AGENT_TEMPLATES_PRECEDENTS: Record<string, { version: number; content: string }[]> = ${JSON.stringify(precedents, null, 2)};
`,
);
console.log(`${fiches.length} fiches (${Object.values(precedents).flat().length} versions précédentes) → ${path.relative(racine, sortie)}`);
