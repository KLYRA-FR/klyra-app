/**
 * Ce que devient un lien d'un document ouvert dans la visionneuse : une adresse
 * web ou un e-mail s'ouvrent hors de l'app, un chemin relatif ouvre un autre
 * fichier du projet, une ancre fait défiler le document. Tout le reste
 * (javascript:, data:, file:, chemin qui sort du projet) est ignoré.
 * Le process principal refuse de toute façon un chemin hors du projet.
 */
export type CibleLien =
  | { type: "externe"; url: string }
  | { type: "fichier"; chemin: string; ancre: string | null }
  | { type: "ancre"; ancre: string }
  | { type: "ignore" };

function decoder(texte: string): string {
  try {
    return decodeURIComponent(texte);
  } catch {
    return texte;
  }
}

/** `cheminCourant` : chemin du document dans le projet (« 00_CONTROL/DASHBOARD.md »). */
export function cibleLien(href: string, cheminCourant: string): CibleLien {
  const brut = href.trim();
  if (!brut) return { type: "ignore" };
  // Les blancs et caractères de contrôle cachés ne déguisent pas un « java\nscript: ».
  const compact = [...brut].filter((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f).join("");
  const schema = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1].toLowerCase();
  if (schema) {
    if (schema === "mailto") return /^mailto:[^\s]+$/i.test(brut) ? { type: "externe", url: brut } : { type: "ignore" };
    if (schema !== "http" && schema !== "https") return { type: "ignore" };
    try {
      return { type: "externe", url: new URL(brut).href };
    } catch {
      return { type: "ignore" };
    }
  }
  if (compact.startsWith("//") || compact.startsWith("\\\\")) return { type: "ignore" };
  const diese = brut.indexOf("#");
  const ancre = diese >= 0 ? decoder(brut.slice(diese + 1)) || null : null;
  const chemin = decoder((diese >= 0 ? brut.slice(0, diese) : brut).split("?")[0]).replace(/\\/g, "/");
  if (!chemin) return ancre ? { type: "ancre", ancre } : { type: "ignore" };

  const morceaux = chemin.startsWith("/") ? [] : cheminCourant.split("/").slice(0, -1);
  for (const m of chemin.split("/")) {
    if (!m || m === ".") continue;
    if (m === "..") {
      if (!morceaux.length) return { type: "ignore" };
      morceaux.pop();
    } else morceaux.push(m);
  }
  if (!morceaux.length || morceaux.some((m) => m.includes("\0"))) return { type: "ignore" };
  return { type: "fichier", chemin: morceaux.join("/"), ancre };
}

/** L'identifiant d'un titre, comme GitHub : « Actifs et en revue » → « actifs-et-en-revue ». */
export function ancreDe(texte: string): string {
  return texte
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}
