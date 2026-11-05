/**
 * Les projets sur le téléphone (spec mobile T-10 à T-13) : la descente dans les dossiers, un niveau
 * par écran, les adresses de ces écrans, et la garde des chemins que l'ordinateur applique avant de
 * lire quoi que ce soit. Fonctions pures, partagées par le téléphone et par les gestes du poste.
 */

import type { ContenuFichier } from "@/lib/bridge";
import { nomFichier } from "@/lib/fichiers";
import { ErreurPoste } from "@/lib/poste/types";
import type { FileNode, ProjectStatus } from "@/types/domain";

/* ─── Ce que le poste renvoie ──────────────────────────────────── */

/** Un élément d'un dossier, avec ses marques (spec T-12). */
export interface ElementDossier {
  nom: string;
  /** Chemin relatif à la racine du projet. */
  chemin: string;
  type: "dossier" | "fichier";
  /** « Modifié par un agent ». */
  modifie: boolean;
  /** Un dossier : « Contient des fichiers modifiés ». */
  contientModifies: boolean;
}

/** Un niveau du dossier : ses premiers éléments et leur nombre total (coupure à l'affichage). */
export interface NiveauDossier {
  elements: ElementDossier[];
  total: number;
}

/** Un fichier lu par le poste, prêt à afficher. `surPoste` : faux pour un projet d'un VPS (rien à ouvrir sur l'ordinateur). */
export interface FichierLu {
  contenu: ContenuFichier;
  surPoste: boolean;
}

/** Ce qu'on modifie d'un projet depuis le téléphone ; le dossier reste choisi sur l'ordinateur. */
export interface ProjetModifiable {
  nom: string;
  accroche: string;
  brief: string;
  statut: ProjectStatus;
  epingle: boolean;
}

/** Au-delà, un niveau n'affiche que ses premiers éléments et le dit (même seuil qu'au bureau). */
export const ELEMENTS_MAX = 1000;

export const STATUTS: { valeur: ProjectStatus; libelle: string }[] = [
  { valeur: "en-cours", libelle: "En cours" },
  { valeur: "en-revue", libelle: "En revue" },
  { valeur: "livre", libelle: "Livré" },
];

export function statutValide(valeur: unknown): valeur is ProjectStatus {
  return STATUTS.some((s) => s.valeur === valeur);
}

export function libelleStatut(statut: string): string | null {
  return STATUTS.find((s) => s.valeur === statut)?.libelle ?? null;
}

/** La teinte de l'étiquette d'un statut (E6-01) : bleue en cours, orange en revue, neutre livré. */
export function tonStatut(statut: string): "bleue" | "orange" | "neutre" {
  return statut === "en-cours" ? "bleue" : statut === "en-revue" ? "orange" : "neutre";
}

/* ─── La garde des chemins (côté poste) ────────────────────────── */

const CHEMIN_MAX = 1024;
const SEGMENT_MAX = 255;

/**
 * Un chemin envoyé par le téléphone, ramené à « a/b/c » relatif au projet, ou refusé en clair.
 * Même règle que le bureau (`cheminDansProjet`, qui reste la garde du main) : rien d'absolu, pas de
 * lecteur Windows, pas de « .. », aucun caractère de contrôle. `racine` : "" désigne le projet lui-même.
 */
export function cheminDemande(valeur: unknown, { racine }: { racine: boolean }): string {
  if (typeof valeur !== "string" || valeur.length > CHEMIN_MAX) throw new ErreurPoste("arguments", "Demande illisible.");
  const hors = new ErreurPoste("chemin", "Ce chemin n’est pas dans le projet.");
  if (/[\u0000-\u001f\u007f]/.test(valeur)) throw hors;
  if (/^[\\/]/.test(valeur) || /^[a-z]:/i.test(valeur)) throw hors;
  const segments = valeur.split(/[\\/]/).filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === ".." || s.length > SEGMENT_MAX)) throw hors;
  if (!segments.length && !racine) throw hors;
  return segments.join("/");
}

/**
 * Ce que « Ouvrir sur ton Mac » ouvre depuis le téléphone : des documents, des images, des médias.
 * Jamais un programme, un script ou un raccourci (ni un fichier sans extension, qu'un Mac lance dans
 * le Terminal s'il est exécutable) : l'app par défaut l'exécuterait sur l'ordinateur, sans personne devant.
 */
const OUVRABLES = new Set(
  (
    "pdf md markdown mdx txt log rtf csv tsv json yaml yml xml html htm css scss ts tsx jsx " +
    "doc docx odt pages xls xlsx ods numbers ppt pptx odp key epub " +
    "png jpg jpeg gif webp avif heic svg bmp tif tiff ico psd ai fig sketch " +
    "mp3 wav m4a aac flac ogg mp4 mov m4v webm avi mkv"
  ).split(" "),
);

export function ouvrableADistance(chemin: string): boolean {
  const ext = /\.([^./\\]+)$/.exec(chemin)?.[1].toLowerCase();
  return !!ext && OUVRABLES.has(ext);
}

/**
 * L'erreur de lecture du système, dite au téléphone sans chemin de l'ordinateur. Les messages
 * déjà écrits pour une personne (main, VPS) passent tels quels.
 */
export function erreurLecture(message: string, quoi: "dossier" | "fichier", sur: string): ErreurPoste {
  const code = /^(E[A-Z]+):/.exec(message)?.[1] ?? null;
  const ce = quoi === "dossier" ? "Ce dossier" : "Ce fichier";
  if (code === "ENOENT") return new ErreurPoste("introuvable", `${ce} n’existe plus sur ${sur}.`);
  if (code === "EACCES" || code === "EPERM") return new ErreurPoste("acces", `KLYRA n’a pas le droit de lire ${ce.toLowerCase()} sur ${sur}.`);
  if (code === "ENOTDIR") return new ErreurPoste("introuvable", "Ce chemin mène à un fichier, pas à un dossier.");
  if (code) return new ErreurPoste("lecture", `${ce} n’a pas pu être lu sur ${sur}.`);
  return new ErreurPoste("lecture", message || `${ce} n’a pas pu être lu sur ${sur}.`);
}

/* ─── Un niveau du dossier ─────────────────────────────────────── */

/** Les dossiers qui mènent à un fichier modifié (comme l'arbre du bureau). */
function dossiersModifies(modifies: Set<string>): Set<string> {
  const dossiers = new Set<string>();
  for (const chemin of modifies) {
    const parts = chemin.split("/");
    for (let i = 1; i < parts.length; i++) dossiers.add(parts.slice(0, i).join("/"));
  }
  return dossiers;
}

/** Un niveau lu sur le disque, marqué, coupé à `ELEMENTS_MAX` : le reste est compté, pas envoyé. */
export function niveauDossier(noeuds: FileNode[], modifies: Set<string>): NiveauDossier {
  const contenants = dossiersModifies(modifies);
  return {
    total: noeuds.length,
    elements: noeuds.slice(0, ELEMENTS_MAX).map((n) => ({
      nom: n.name,
      chemin: n.path,
      type: n.kind,
      modifie: modifies.has(n.path),
      contientModifies: n.kind === "dossier" && contenants.has(n.path),
    })),
  };
}

/**
 * « Liste coupée : … » quand un niveau dépasse le seuil, sinon null. La phrase du bureau, avec « ton
 * Mac » (E6-15). Sans total lisible, on dit qu'il en reste sans fabriquer un compte.
 */
export function texteCoupure(niveau: Pick<NiveauDossier, "elements"> & { total?: number }, sur = "l’ordinateur"): string | null {
  if (typeof niveau.total !== "number" || !Number.isFinite(niveau.total)) {
    return niveau.elements.length >= ELEMENTS_MAX ? `D’autres éléments ne sont pas affichés. Ouvre le dossier sur ${sur} pour tout voir.` : null;
  }
  const reste = niveau.total - niveau.elements.length;
  if (reste <= 0) return null;
  return `Liste coupée : ${reste.toLocaleString("fr-FR")} autres éléments non affichés. Ouvre le dossier sur ${sur} pour tout voir.`;
}

/** Un élément caché : il se dit aussi par un libellé, pas seulement par une teinte (E6-13). */
export function estCache(nom: string): boolean {
  return nom.startsWith(".");
}

const EXT_IMAGES = new Set("png jpg jpeg gif webp avif heic svg bmp tif tiff ico".split(" "));
const EXT_CODE = new Set("json js jsx ts tsx mjs cjs css scss html htm yaml yml xml sh py rb go rs java php sql toml".split(" "));

/** L'icône d'un élément d'un dossier (E6-13) : du set officiel, d'après son type seulement. */
export function iconeElement(element: Pick<ElementDossier, "nom" | "type">): "folder" | "image-01" | "file-code" | "file-01" {
  if (element.type === "dossier") return "folder";
  const ext = /\.([^./\\]+)$/.exec(element.nom)?.[1].toLowerCase() ?? "";
  if (EXT_IMAGES.has(ext)) return "image-01";
  if (EXT_CODE.has(ext)) return "file-code";
  return "file-01";
}

/* ─── La descente : chemins et adresses ────────────────────────── */

/** Le dossier qui contient `chemin` : "" pour un élément de la racine, null pour la racine. */
export function parentDe(chemin: string): string | null {
  if (!chemin) return null;
  const i = chemin.lastIndexOf("/");
  return i < 0 ? "" : chemin.slice(0, i);
}

/** Le chemin en haut de l'écran : le projet, puis chaque dossier ; chaque segment ramène à son niveau. */
export function filAriane(nomProjet: string, chemin: string): { nom: string; chemin: string }[] {
  const segments = chemin.split("/").filter(Boolean);
  return [{ nom: nomProjet, chemin: "" }, ...segments.map((nom, i) => ({ nom, chemin: segments.slice(0, i + 1).join("/") }))];
}

/** Les trois segments d'un projet (E6-06, E6-13, E6-08). */
export type OngletProjet = "chats" | "fichiers" | "projet";

/** `/projet?id=…` : onglet Chats, Fichiers ou Projet. */
export function urlProjet(projetId: string, onglet: OngletProjet = "chats"): string {
  const params = new URLSearchParams({ id: projetId });
  if (onglet !== "chats") params.set("onglet", onglet);
  return `/projet?${params}`;
}

/** Un dossier (T-12). La racine est l'onglet Fichiers du projet. */
export function urlDossier(projetId: string, chemin: string): string {
  if (!chemin) return urlProjet(projetId, "fichiers");
  return `/projet?${new URLSearchParams({ id: projetId, dossier: chemin })}`;
}

/** Un fichier (T-13). `retour` : les fichiers ouverts avant celui-ci par des liens, le plus récent en dernier. */
export function urlFichier(projetId: string, chemin: string, { ancre = null, retour = [] }: { ancre?: string | null; retour?: string[] } = {}): string {
  const params = new URLSearchParams({ id: projetId, fichier: chemin });
  if (ancre) params.set("ancre", ancre);
  for (const precedent of retour) params.append("retour", precedent);
  return `/projet?${params}`;
}

/** « ‹ » de la visionneuse : remonte la pile des liens suivis, puis revient au dossier du fichier. */
export function urlRetourFichier(projetId: string, chemin: string, retour: string[]): string {
  const precedent = retour.at(-1);
  if (precedent) return urlFichier(projetId, precedent, { retour: retour.slice(0, -1) });
  return urlDossier(projetId, parentDe(chemin) ?? "");
}

/** ✕ de la visionneuse : le dossier d'où l'on est parti, quelle que soit la pile des liens suivis. */
export function urlFermerFichier(projetId: string, chemin: string, retour: string[]): string {
  return urlDossier(projetId, parentDe(retour[0] ?? chemin) ?? "");
}

/** Ce que l'adresse demande : la visionneuse, un dossier, ou un onglet du projet. Un chemin douteux est ignoré. */
export type VueProjet =
  | { vue: "fichier"; chemin: string; ancre: string | null; retour: string[] }
  | { vue: "dossier"; chemin: string }
  | { vue: "onglet"; onglet: OngletProjet };

function propre(valeur: string | null): string | null {
  if (valeur === null) return null;
  try {
    return cheminDemande(valeur, { racine: false });
  } catch {
    return null;
  }
}

export function vueProjet(params: { get: (cle: string) => string | null; getAll: (cle: string) => string[] }): VueProjet {
  const fichier = propre(params.get("fichier"));
  if (fichier) {
    const retour = params.getAll("retour").map(propre).filter((c): c is string => c !== null);
    return { vue: "fichier", chemin: fichier, ancre: params.get("ancre") || null, retour };
  }
  const dossier = propre(params.get("dossier"));
  if (dossier) return { vue: "dossier", chemin: dossier };
  const onglet = params.get("onglet");
  return { vue: "onglet", onglet: onglet === "fichiers" || onglet === "projet" ? onglet : "chats" };
}

/* ─── Affichage ────────────────────────────────────────────────── */

export function tailleLisible(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** Le dossier d'un fichier, pour la ligne sous le titre de la visionneuse (« 00_CONTROL · 21 Ko »). */
export function dossierAffiche(nomProjet: string, chemin: string): string {
  const parent = parentDe(chemin);
  return parent ? nomFichier(parent) : nomProjet;
}

const deux = (n: number) => String(n).padStart(2, "0");
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function jourDe(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** La ligne d'un projet : « modifié à 13:08 », « modifié hier », « modifié lundi », « modifié le 2 nov. ». Illisible : rien. */
export function libelleModifie(iso: string | null | undefined, maintenant: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const jours = Math.round((jourDe(new Date(maintenant)) - jourDe(d)) / 86_400_000);
  if (jours <= 0) return `modifié à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
  if (jours === 1) return "modifié hier";
  if (jours < 7) return `modifié ${JOURS[d.getDay()]}`;
  return `modifié le ${d.getDate()} ${MOIS[d.getMonth()]}`;
}

/** « 2 chats », « 1 chat », « Aucun chat ». */
export function compteChats(n: number): string {
  return n === 0 ? "Aucun chat" : `${n} chat${n > 1 ? "s" : ""}`;
}

/** « Montrer dans le Finder », selon le système du poste (jamais celui du téléphone). */
export function montrerDans(systeme: "mac" | "windows" | "autre" | null): string {
  if (systeme === "mac") return "Montrer dans le Finder";
  if (systeme === "windows") return "Montrer dans l’Explorateur";
  return "Montrer dans le gestionnaire de fichiers";
}

/* ─── Tirer vers le bas pour relire ────────────────────────────── */

/** Au-delà de ce tirage (en px, après résistance), relâcher relit la liste. */
export const SEUIL_TIRAGE = 64;
const TIRAGE_MAX = 96;

/** Le doigt descend de `distance` px depuis le haut de la liste : la hauteur de l'indicateur, et s'il suffit pour relire. */
export function etatTirage(distance: number): { hauteur: number; pret: boolean } {
  /* Socle § 7 : le doigt 1:1 jusqu'au seuil (64 px), résistance 0,5 au-delà, 96 px au plus. */
  const tire = Math.max(0, distance);
  const hauteur = Math.min(TIRAGE_MAX, tire <= SEUIL_TIRAGE ? tire : SEUIL_TIRAGE + (tire - SEUIL_TIRAGE) * 0.5);
  return { hauteur, pret: hauteur >= SEUIL_TIRAGE };
}
