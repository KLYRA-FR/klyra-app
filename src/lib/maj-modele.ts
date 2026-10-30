import { getField, parseAgentFile } from "@/lib/agent-file";
import { AGENT_TEMPLATES, AGENT_TEMPLATES_PRECEDENTS } from "@/data/agent-templates.generated";

/**
 * Mettre à jour une fiche installée depuis un modèle KLYRA sans perdre ce que la personne y a changé.
 *
 * Une fiche se découpe en parties : « Quand l'appeler » (la description de l'en-tête), la présentation
 * (titre et texte avant la première section), puis chaque section « ## ». La base est la version du
 * modèle d'où vient la fiche : celle dont elle garde le plus de parties telles quelles. Pour chaque partie :
 * - inchangée chez soi depuis la base : la version du modèle est reprise ;
 * - changée seulement chez soi : elle est gardée ;
 * - changée des deux côtés : un conflit, « la mienne » par défaut, au choix de la personne.
 * Le reste de l'en-tête (identifiant, prénom, modèle d'IA, mémoire, outils…) n'est jamais touché.
 */

export type Choix = "mienne" | "modele";

interface Partie {
  cle: string;
  titre: string;
  texte: string;
}

/** Une partie changée : son titre, et si elle apparaît ou disparaît. */
export interface Changement {
  titre: string;
  etat: "modifiee" | "ajoutee" | "retiree";
}

export interface Conflit {
  cle: string;
  titre: string;
  /** null : la partie n'existe pas (retirée de ce côté). */
  mienne: string | null;
  modele: string | null;
}

export interface Comparaison {
  /** La version actuelle du modèle, embarquée dans l'app. */
  version: number;
  /** La version du modèle dont la fiche a exactement la consigne, ou null si elle a été modifiée. */
  identiqueA: number | null;
  /** La version la plus proche : la base de la fusion. */
  base: number;
}

export interface Fusion {
  /** La fiche complète après la mise à jour. */
  contenu: string;
  base: number;
  version: number;
  /** Repris du modèle : ce que la personne n'avait pas touché. */
  reprises: Changement[];
  /** Gardé tel quel : ce que la personne a changé et que le modèle n'a pas touché. */
  gardees: Changement[];
  conflits: Conflit[];
}

const normal = (texte: string) =>
  texte
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();

const egal = (a: string | undefined, b: string | undefined) => (a === undefined || b === undefined ? a === b : normal(a) === normal(b));

function partiesDe(contenu: string): Partie[] {
  const { frontmatter, body } = parseAgentFile(contenu);
  const parties: Partie[] = [];
  const description = getField(frontmatter, "description");
  if (description !== undefined) parties.push({ cle: "description", titre: "Quand l’appeler", texte: description });
  const vus = new Map<string, number>();
  let courante = { cle: "presentation", titre: "Présentation", lignes: [] as string[] };
  const fermer = () => {
    const texte = courante.lignes.join("\n").trim();
    if (texte) parties.push({ cle: courante.cle, titre: courante.titre, texte });
  };
  let dansCode = false;
  for (const ligne of body.replace(/\r\n/g, "\n").split("\n")) {
    if (ligne.trim().startsWith("```")) dansCode = !dansCode;
    const h2 = !dansCode && ligne.match(/^##\s+(.+?)\s*$/);
    if (!h2) {
      courante.lignes.push(ligne);
      continue;
    }
    fermer();
    const titre = h2[1];
    const rang = (vus.get(titre) ?? 0) + 1;
    vus.set(titre, rang);
    courante = { cle: `section:${titre}${rang > 1 ? `#${rang}` : ""}`, titre, lignes: [ligne] };
  }
  fermer();
  return parties;
}

const carte = (parties: Partie[]) => new Map(parties.map((p) => [p.cle, p]));

/** Toutes les versions connues d'un modèle, de la plus ancienne à l'actuelle ; vide si le modèle n'existe pas. */
export function versionsDuModele(nom: string): { version: number; content: string }[] {
  const actuel = AGENT_TEMPLATES.find((t) => t.name === nom);
  if (!actuel) return [];
  return [...(AGENT_TEMPLATES_PRECEDENTS[nom] ?? []), { version: actuel.version, content: actuel.content }];
}

/** Où en est une fiche installée par rapport au modèle `nom` ; null si ce modèle n'existe plus. */
export function comparerAuModele(nom: string, contenu: string): Comparaison | null {
  const versions = versionsDuModele(nom);
  if (!versions.length) return null;
  const locales = carte(partiesDe(contenu));
  let identiqueA: number | null = null;
  let base = versions[versions.length - 1].version;
  let meilleur = -1;
  for (const v of versions) {
    const parties = partiesDe(v.content);
    const communes = parties.filter((p) => egal(locales.get(p.cle)?.texte, p.texte)).length;
    if (communes === parties.length && parties.length === locales.size) identiqueA = v.version;
    // À égalité, la plus ancienne : mieux vaut montrer un conflit que taire une correction.
    if (communes > meilleur) {
      meilleur = communes;
      base = v.version;
    }
  }
  return { version: versions[versions.length - 1].version, identiqueA, base: identiqueA ?? base };
}

/** L'en-tête de la fiche locale, tel quel, avec seulement la description remplacée (et `name` si elle n'en avait pas). */
function enTete(local: string, id: string, description: string | null): string {
  const m = local.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?/);
  const lignes = m ? m[1].split("\n") : [];
  if (!lignes.some((l) => /^name:/.test(l))) lignes.unshift(`name: ${id}`);
  if (description !== null) {
    const valeur = `description: "${description.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const i = lignes.findIndex((l) => /^description:/.test(l));
    if (i < 0) lignes.push(valeur);
    else {
      // Une description sur plusieurs lignes (YAML) part avec ses lignes de suite.
      let fin = i + 1;
      while (fin < lignes.length && /^\s+\S/.test(lignes[fin])) fin++;
      lignes.splice(i, fin - i, valeur);
    }
  }
  return `---\n${lignes.join("\n")}\n---`;
}

function assembler(local: string, id: string, parties: Partie[]): string {
  const locale = carte(partiesDe(local)).get("description")?.texte;
  const description = parties.find((p) => p.cle === "description")?.texte;
  const corps = parties.filter((p) => p.cle !== "description").map((p) => p.texte);
  const nouvelleDescription = description !== undefined && !egal(description, locale) ? description : null;
  return `${enTete(local, id, nouvelleDescription)}\n\n${corps.join("\n\n")}\n`;
}

/** Les clés de la fiche fusionnée, dans l'ordre du modèle ; une partie à soi reste après celle qui la précédait. */
function ordre(locales: Partie[], modele: Partie[]): string[] {
  const cles = modele.map((p) => p.cle);
  locales.forEach((p, i) => {
    if (cles.includes(p.cle)) return;
    let j = i - 1;
    while (j >= 0 && !cles.includes(locales[j].cle)) j--;
    cles.splice(j >= 0 ? cles.indexOf(locales[j].cle) + 1 : 0, 0, p.cle);
  });
  return cles;
}

/**
 * La fiche mise à jour vers la version actuelle du modèle `nom`, en gardant ce que la personne a changé.
 * `choix` tranche les conflits (« la mienne » par défaut). null si le modèle n'existe plus.
 */
export function fusionnerAvecModele(nom: string, id: string, local: string, choix: Record<string, Choix> = {}): Fusion | null {
  const comparaison = comparerAuModele(nom, local);
  if (!comparaison) return null;
  const versions = versionsDuModele(nom);
  const base = carte(partiesDe(versions.find((v) => v.version === comparaison.base)!.content));
  const modeleParties = partiesDe(versions[versions.length - 1].content);
  const modele = carte(modeleParties);
  const localesParties = partiesDe(local);
  const locales = carte(localesParties);

  const resultat: Partie[] = [];
  const reprises: Changement[] = [];
  const gardees: Changement[] = [];
  const conflits: Conflit[] = [];
  const etat = (avant: string | undefined, apres: string | undefined): Changement["etat"] =>
    avant === undefined ? "ajoutee" : apres === undefined ? "retiree" : "modifiee";

  for (const cle of ordre(localesParties, modeleParties)) {
    const b = base.get(cle)?.texte;
    const l = locales.get(cle);
    const n = modele.get(cle);
    const titre = (l ?? n)!.titre;
    if (egal(l?.texte, n?.texte)) {
      if (l) resultat.push(l);
    } else if (egal(l?.texte, b)) {
      reprises.push({ titre, etat: etat(l?.texte, n?.texte) });
      if (n) resultat.push(n);
    } else if (egal(n?.texte, b)) {
      gardees.push({ titre, etat: etat(b, l?.texte) });
      if (l) resultat.push(l);
    } else {
      conflits.push({ cle, titre, mienne: l?.texte ?? null, modele: n?.texte ?? null });
      const retenue = (choix[cle] ?? "mienne") === "mienne" ? l : n;
      if (retenue) resultat.push(retenue);
    }
  }
  return { contenu: assembler(local, id, resultat), base: comparaison.base, version: comparaison.version, reprises, gardees, conflits };
}

/** La consigne du modèle actuel à la place de celle de la fiche, avec l'en-tête de la fiche (prénom, modèle d'IA…) gardé. */
export function remplacerParModele(nom: string, id: string, local: string): string | null {
  const versions = versionsDuModele(nom);
  if (!versions.length) return null;
  return assembler(local, id, partiesDe(versions[versions.length - 1].content));
}
