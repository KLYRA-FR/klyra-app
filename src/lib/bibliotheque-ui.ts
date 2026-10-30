import { appliquerDependances, ESPACE_RESERVE, type Dependance, type SecretTrouve } from "../../convex/model/definitions";
import { DEFAULT_META } from "@/data/agents";
import { findColleagues, getField, parseAgentFile, parseBody } from "@/lib/agent-file";
import { ROLE_TEINTES, type RoleTeinte } from "@/types/domain";

/**
 * Règles pures des écrans de la Bibliothèque KLYRA (`src/components/bibliotheque/`) : couleurs,
 * textes lisibles d'une définition, collègues cités, aperçu d'un secret, chemins abrégés.
 */

/** Même calcul que `teinteParDefaut` (`src/lib/agents.tsx`) : la couleur que l'app tire d'un identifiant. */
export function teinteDuNom(nom: string): RoleTeinte {
  const palette = ROLE_TEINTES.filter((t) => t !== "bleu-k1");
  const hash = [...nom].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return palette[hash % palette.length];
}

/** Le pastel d'une définition : celui de `DEFAULT_META` pour un modèle KLYRA, sinon celui du nom. La couleur de l'auteur ne part jamais. */
export function teinteDefinition(slug: string, modele: boolean): RoleTeinte {
  return (modele ? DEFAULT_META[slug]?.teinte : undefined) ?? teinteDuNom(slug);
}

/** Chaque `{{chemin:cle}}` écrit en clair, par le nom de sa dépendance (« Dossier clients »). */
export function avecLibelles(contenu: string, dependances: Dependance[]): string {
  return contenu.replace(ESPACE_RESERVE, (_tout, cle: string) => {
    const libelle = libelleDe(cle, dependances);
    return libelle.includes("«") ? libelle : `« ${libelle} »`;
  });
}

/** Le texte d'une définition tel qu'on le lit sur cet ordinateur : dossiers choisis, puis les autres en clair. */
export function lisible(contenu: string, valeurs: Record<string, string>, dependances: Dependance[]): string {
  return avecLibelles(appliquerDependances(contenu, valeurs).contenu, dependances);
}

/** Le nom d'une dépendance, ou celui que l'app donne par défaut à une clé (comme `preparerPublication`). */
export function libelleDe(cle: string, dependances: Dependance[]): string {
  return dependances.find((d) => d.cle === cle)?.libelle?.trim() || `Dossier « ${cle} »`;
}

/** Les clés `{{chemin:…}}` d'un texte, dans l'ordre où elles apparaissent. */
export function clesDe(contenu: string): string[] {
  return [...new Set([...contenu.matchAll(ESPACE_RESERVE)].map((m) => m[1]))];
}

/** Le nom proposé pour un chemin remplacé : son dernier dossier (« /Users/pelin/Clients » → « Dossier clients »). */
export function libelleInitial(chemin: string): string {
  const segment = chemin.replace(/[\\/.:]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  if (!segment || segment === "~") return "Dossier";
  if (/\.[A-Za-z0-9]{1,5}$/.test(segment)) return `Fichier ${segment}`.slice(0, 80);
  // « Clients » → « clients » ; un sigle ou un nom composé garde sa casse (« DIGITAL-OS »).
  const mot = /^\p{Lu}[\p{Ll}\s]*$/u.test(segment) ? segment.charAt(0).toLowerCase() + segment.slice(1) : segment;
  return `Dossier ${mot}`.slice(0, 80);
}

export interface CollegueCite {
  name: string;
  id: string;
}

/**
 * Les collègues à qui la fiche passe la main (« → Iris (designer) »), hors du bloc commun
 * « Parler en équipe », qui cite toute l'équipe d'origine.
 */
export function colleguesCites(contenu: string, saufId?: string): CollegueCite[] {
  const { body } = parseAgentFile(contenu);
  const { pitch, sections } = parseBody(body);
  const textes = [pitch, ...sections.filter((s) => !/^Parler en équipe/i.test(s.title)).map((s) => s.body)];
  const vus = new Map<string, CollegueCite>();
  for (const ligne of textes.join("\n").split("\n")) {
    const cible = ligne.split("→").slice(1).join("→");
    if (!cible) continue;
    for (const c of findColleagues(cible)) if (c.id !== saufId && !vus.has(c.id)) vus.set(c.id, c);
  }
  return [...vus.values()];
}

/** Les outils demandés dans l'en-tête (`tools`), un par un. */
export function outilsDemandes(contenu: string): string[] {
  const brut = getField(parseAgentFile(contenu).frontmatter, "tools") ?? "";
  return brut
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** La ligne d'un secret, masquée après ses premiers caractères : « api_ke•••• ». Jamais le secret entier. */
export function ligneMasquee(contenu: string, secret: SecretTrouve): string {
  const ligne = contenu.replace(/\r\n/g, "\n").split("\n")[secret.ligne - 1] ?? "";
  const debut = secret.extrait.replace(/…$/, "");
  const i = debut ? ligne.indexOf(debut) : -1;
  if (i < 0) return `${debut}••••`;
  const avant = ligne.slice(Math.max(0, i - 40), i).trimStart();
  return `${i > 40 ? "…" : ""}${avant}${debut}••••`;
}

/** Un chemin du dossier personnel abrégé en `~` (le dossier des agents dit où il est). */
export function abreger(chemin: string, dossierAgents: string | null): string {
  const m = dossierAgents?.match(/^(.*?)[\\/]\.claude[\\/]agents[\\/]?$/);
  const maison = m?.[1];
  if (!maison) return chemin;
  if (chemin === maison) return "~";
  return chemin.startsWith(maison + "/") || chemin.startsWith(maison + "\\") ? `~${chemin.slice(maison.length)}` : chemin;
}

/** Un nom libre à partir de celui proposé : « Juriste », puis « Juriste 2 », « Juriste 3 »… */
export function nomLibre(nom: string, pris: (n: string) => boolean): string {
  if (!pris(nom)) return nom;
  for (let n = 2; n < 100; n++) if (!pris(`${nom} ${n}`)) return `${nom} ${n}`;
  return nom;
}

/** « Juriste », « Juriste et Iris », « Juriste, Iris et Hugo ». */
export function enumerer(noms: string[]): string {
  if (noms.length <= 1) return noms[0] ?? "";
  return `${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}`;
}

/** Une raison d'erreur à glisser dans une phrase, après « : » : sans majuscule (sauf sigle) ni point final. */
export function raison(e: unknown): string {
  const message = (e instanceof Error ? e.message : String(e)).trim().replace(/[.\s]+$/, "");
  return /^\p{Lu}\p{Ll}/u.test(message) ? message.charAt(0).toLowerCase() + message.slice(1) : message;
}

const DATE_COURTE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

/** « 29 oct. » */
export function dateCourte(instant: number): string {
  return DATE_COURTE.format(instant);
}

/** « opus » → « Opus ». */
export function nomModele(modele: string): string {
  return modele.charAt(0).toUpperCase() + modele.slice(1);
}

/** L'en-tête et le corps d'un texte de fiche, tels quels (pour montrer le texte exact qui part). */
export function decouperFiche(contenu: string): { entete: string; corps: string } {
  const normal = contenu.replace(/\r\n/g, "\n");
  const m = normal.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? { entete: m[0].trim(), corps: normal.slice(m[0].length).replace(/^\n+/, "") } : { entete: "", corps: normal };
}
