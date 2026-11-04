/**
 * Le risque d'un changement se calcule en code, d'après les fichiers touchés. Un modèle peut le relever,
 * jamais le baisser. Module pur, sans rien de propre à un projet : les chemins sensibles viennent du
 * `CODEOWNERS` du dépôt, et d'un jeu par défaut valable pour tout projet.
 */
export type Risque = "faible" | "moyen" | "eleve";

const ORDRE: Record<Risque, number> = { faible: 0, moyen: 1, eleve: 2 };

/** Toujours sensibles : CI, dépendances, authentification, secrets, migrations. */
const SENSIBLES_PAR_DEFAUT = [
  ".github/",
  ".env*",
  "**/.env*",
  "**/migrations/",
  "**/auth*",
  "**/*secret*",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "composer.json",
  "composer.lock",
  "requirements.txt",
  "pyproject.toml",
  "Dockerfile",
];

/** Rien qui s'exécute en production : documentation, tests, images. */
const FAIBLES = [/\.(md|mdx|txt|png|jpe?g|gif|svg|webp|avif|ico)$/i, /(^|\/)(docs?|tests?|__tests__)\//i, /\.(test|spec)\.[a-z]+$/i];

/** Les motifs d'un `CODEOWNERS` : ce fichier dit ce qui demande une personne. */
export function motifsCodeowners(texte: string): string[] {
  return texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => l.split(/\s+/)[0])
    .filter((m): m is string => Boolean(m));
}

function versRegex(motif: string): RegExp {
  const ancre = motif.startsWith("/") || motif.startsWith("**/");
  const corps = motif.replace(/^\//, "");
  const dossier = corps.endsWith("/");
  const echappe = corps
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?");
  /* Comme gitignore : un `/` en fin de motif ne l'ancre pas, un `/` au milieu si. */
  const prefixe = ancre || corps.replace(/\/$/, "").includes("/") ? "^" : "(?:^|/)";
  return new RegExp(`${prefixe}${echappe}${dossier ? "" : "(?:$|/)"}`);
}

export function correspond(chemin: string, motif: string): boolean {
  return versRegex(motif).test(chemin);
}

export function risqueDesChemins(chemins: string[], codeowners = ""): Risque {
  const motifs = [...SENSIBLES_PAR_DEFAUT, ...motifsCodeowners(codeowners)];
  if (chemins.some((c) => motifs.some((m) => correspond(c, m)))) return "eleve";
  if (chemins.length > 0 && chemins.every((c) => FAIBLES.some((f) => f.test(c)))) return "faible";
  return "moyen";
}

/** Le plus élevé des deux : un avis ne baisse jamais un risque. */
export function relever(a: Risque, b: Risque): Risque {
  return ORDRE[a] >= ORDRE[b] ? a : b;
}

export function risqueDesLabels(labels: string[]): Risque | null {
  if (labels.includes("risque:élevé")) return "eleve";
  if (labels.includes("risque:moyen")) return "moyen";
  if (labels.includes("risque:faible")) return "faible";
  return null;
}
