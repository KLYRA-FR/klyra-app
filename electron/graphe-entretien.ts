import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { lireSouvenirsGraphe, type RacinesSouvenirs, type SouvenirGraphe } from "./graphe-souvenirs";

/**
 * Entretien du graphe commun : ce que la personne accepte d'un clic (lien suggéré écrit dans un souvenir,
 * archivage, fusion), toujours après sa confirmation à l'écran. Chaque action est notée dans
 * `donnees/graphe-entretien.json` avec de quoi l'annuler ; rien n'est jamais supprimé (archiver déplace le
 * fichier dans `archive/` à côté de lui). Une action refuse un souvenir qui a changé depuis sa lecture.
 */

export interface OperationEntretien {
  id: string;
  type: "lien" | "archive" | "fusion";
  le: string;
  libelle: string;
  /** Contenus remplacés (pour annuler), avec l'empreinte du contenu écrit. */
  ecrits: { chemin: string; avant: string; apres: string }[];
  /** Fichiers déplacés. */
  deplaces: { de: string; vers: string }[];
  annuleLe?: string | null;
}
export interface EtatEntretien { refuses: string[]; operations: OperationEntretien[] }

const FICHIER = "graphe-entretien.json";
const GARDES = 200;
const empreinte = (s: string) => createHash("sha256").update(s).digest("hex");

export function lireEntretien(donnees: string): EtatEntretien {
  try {
    const v = JSON.parse(readFileSync(path.join(donnees, FICHIER), "utf8"));
    return { refuses: Array.isArray(v.refuses) ? v.refuses.filter((x: unknown) => typeof x === "string") : [], operations: Array.isArray(v.operations) ? v.operations : [] };
  } catch {
    return { refuses: [], operations: [] };
  }
}
function ecrireEntretien(donnees: string, e: EtatEntretien) {
  mkdirSync(donnees, { recursive: true });
  const fichier = path.join(donnees, FICHIER), tmp = `${fichier}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ refuses: e.refuses.slice(-2000), operations: e.operations.slice(-GARDES) }), { mode: 0o600 });
  renameSync(tmp, fichier);
}
function noter(donnees: string, op: Omit<OperationEntretien, "id" | "le">): OperationEntretien {
  const e = lireEntretien(donnees), complete = { ...op, id: randomUUID(), le: new Date().toISOString(), annuleLe: null };
  e.operations.push(complete);
  ecrireEntretien(donnees, e);
  return complete;
}

/** Un lien suggéré refusé ne revient plus (clé `a|b`, triée). */
export function refuserLien(donnees: string, cle: unknown): EtatEntretien {
  if (typeof cle !== "string" || cle.length > 400 || !cle.includes("|")) throw new Error("Lien invalide.");
  const e = lireEntretien(donnees);
  if (!e.refuses.includes(cle)) e.refuses.push(cle);
  ecrireEntretien(donnees, e);
  return e;
}

/** Le souvenir demandé, relu maintenant ; refusé s'il a changé depuis l'affichage (`attendu` = sa date). */
function souvenirInchange(r: RacinesSouvenirs, id: unknown, attendu: unknown): SouvenirGraphe {
  const s = lireSouvenirsGraphe(r).souvenirs.find((x) => x.id === id);
  if (!s) throw new Error("Ce souvenir n'existe plus à cet endroit.");
  if (s.date !== attendu) throw new Error(`« ${s.nom} » a changé depuis l'affichage : relis le graphe avant d'agir.`);
  return s;
}
function lire(chemin: string): string {
  return readFileSync(chemin, "utf8");
}
function ecrire(chemin: string, texte: string) {
  const tmp = `${chemin}.${process.pid}.tmp`;
  writeFileSync(tmp, texte, { mode: statSync(chemin).mode & 0o777 });
  renameSync(tmp, chemin);
}
/** Ajoute `[[cible]]` à la ligne « Voir aussi » de la fin du fichier (créée au besoin). */
export function avecLien(texte: string, cible: string): string {
  if (texte.includes(`[[${cible}]]`)) return texte;
  const lignes = texte.replace(/\s+$/, "").split("\n");
  const derniere = lignes[lignes.length - 1] ?? "";
  if (/^Voir aussi\s*:/.test(derniere)) lignes[lignes.length - 1] = `${derniere}, [[${cible}]]`;
  else lignes.push("", `Voir aussi : [[${cible}]]`);
  return `${lignes.join("\n")}\n`;
}

/** Écrit un lien accepté dans le souvenir `de` (vers le souvenir `vers`). */
export function accepterLien(r: RacinesSouvenirs, donnees: string, a: Record<string, unknown>): OperationEntretien {
  const de = souvenirInchange(r, a.de, a.attenduDe);
  const vers = lireSouvenirsGraphe(r).souvenirs.find((x) => x.id === a.vers);
  if (!vers) throw new Error("Le souvenir cible n'existe plus.");
  const avant = lire(de.chemin), apres = avecLien(avant, vers.nom);
  if (apres !== avant) ecrire(de.chemin, apres);
  return noter(donnees, { type: "lien", libelle: `Lien « ${de.nom} » → « ${vers.nom} »`, ecrits: [{ chemin: de.chemin, avant, apres: empreinte(apres) }], deplaces: [] });
}

/** Retire de MEMORY.md (à côté du souvenir) les lignes qui pointent vers ce fichier. */
function sansLigneIndex(chemin: string): { chemin: string; avant: string; apres: string } | null {
  const index = path.join(path.dirname(chemin), "MEMORY.md");
  if (!existsSync(index)) return null;
  const avant = lire(index), nom = path.basename(chemin);
  const apres = avant.split("\n").filter((l) => !l.includes(`(${nom})`) && !l.includes(`(./${nom})`)).join("\n");
  return apres === avant ? null : { chemin: index, avant, apres };
}
function archiverFichier(chemin: string): { deplace: { de: string; vers: string }; index: { chemin: string; avant: string; apres: string } | null } {
  const dossier = path.join(path.dirname(chemin), "archive"), vers = path.join(dossier, path.basename(chemin));
  if (existsSync(vers)) throw new Error(`Un fichier du même nom est déjà archivé : ${vers}`);
  const index = sansLigneIndex(chemin);
  mkdirSync(dossier, { recursive: true });
  renameSync(chemin, vers);
  if (index) ecrire(index.chemin, index.apres);
  return { deplace: { de: chemin, vers }, index };
}

/** Déplace le souvenir dans `archive/` (lu par personne, plus chargé par l'agent) et retire sa ligne de MEMORY.md. */
export function archiver(r: RacinesSouvenirs, donnees: string, a: Record<string, unknown>): OperationEntretien {
  const s = souvenirInchange(r, a.id, a.attendu);
  const { deplace, index } = archiverFichier(s.chemin);
  return noter(donnees, { type: "archive", libelle: `Archivé : « ${s.nom} »`, ecrits: index ? [{ ...index, apres: empreinte(index.apres) }] : [], deplaces: [deplace] });
}

/** Le corps d'un souvenir, sans son en-tête. */
function corpsDe(texte: string): string {
  return texte.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}
/** Note `remplace: <nom>` dans le bloc `metadata` de l'en-tête (s'il existe), sans toucher au reste. */
export function avecRemplace(texte: string, nom: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texte);
  if (!m || /^\s+remplace\s*:/m.test(m[1])) return texte;
  const entete = /^metadata:\s*$/m.test(m[1]) ? m[1].replace(/^metadata:\s*$/m, `metadata:\n  remplace: ${nom}`) : `${m[1]}\nmetadata:\n  remplace: ${nom}`;
  return texte.replace(m[1], entete);
}

/** Garde `garder`, y ajoute le corps de `retirer` sous un titre, puis archive `retirer`. Rien n'est réécrit autrement. */
export function fusionner(r: RacinesSouvenirs, donnees: string, a: Record<string, unknown>): OperationEntretien {
  const garder = souvenirInchange(r, a.garder, a.attenduGarder), retirer = souvenirInchange(r, a.retirer, a.attenduRetirer);
  if (garder.id === retirer.id) throw new Error("Choisis deux souvenirs différents.");
  const avant = lire(garder.chemin), corps = corpsDe(lire(retirer.chemin));
  const apres = `${avecRemplace(avant, retirer.nom).replace(/\s+$/, "")}\n\n## Repris de « ${retirer.nom} »\n\n${corps}\n`;
  ecrire(garder.chemin, apres);
  try {
    const { deplace, index } = archiverFichier(retirer.chemin);
    return noter(donnees, {
      type: "fusion", libelle: `Fusion : « ${retirer.nom} » dans « ${garder.nom} »`,
      ecrits: [{ chemin: garder.chemin, avant, apres: empreinte(apres) }, ...(index ? [{ ...index, apres: empreinte(index.apres) }] : [])],
      deplaces: [deplace],
    });
  } catch (e) {
    ecrire(garder.chemin, avant);
    throw e;
  }
}

/** Annule une action : seulement si les fichiers sont restés tels que l'action les a laissés. */
export function annuler(donnees: string, id: unknown): OperationEntretien {
  const e = lireEntretien(donnees), op = e.operations.find((o) => o.id === id);
  if (!op) throw new Error("Action introuvable.");
  if (op.annuleLe) throw new Error("Cette action est déjà annulée.");
  for (const w of op.ecrits) {
    if (!existsSync(w.chemin) || empreinte(lire(w.chemin)) !== w.apres) throw new Error(`${path.basename(w.chemin)} a changé depuis : annulation refusée pour ne rien perdre.`);
  }
  for (const d of op.deplaces) {
    if (!existsSync(d.vers) || existsSync(d.de)) throw new Error(`${path.basename(d.de)} ne peut pas revenir à sa place (fichier absent ou remplacé).`);
  }
  for (const d of op.deplaces) renameSync(d.vers, d.de);
  for (const w of op.ecrits) ecrire(w.chemin, w.avant);
  op.annuleLe = new Date().toISOString();
  ecrireEntretien(donnees, e);
  return op;
}

/** Ce que l'écran reçoit : refus et dernières actions, sans les contenus gardés pour annuler. */
export function resumeEntretien(donnees: string) {
  const e = lireEntretien(donnees);
  return {
    refuses: e.refuses,
    operations: e.operations.slice(-20).reverse().map((o) => ({ id: o.id, type: o.type, le: o.le, libelle: o.libelle, annuleLe: o.annuleLe ?? null })),
  };
}
