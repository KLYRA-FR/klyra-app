import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { empreinte } from "./enveloppe";
import { ecrire, enTransaction, tous } from "./stockage";
import { lireTravail } from "./travaux";
import { iso, type Horloge } from "./types";

/**
 * Recherche dans les anciens travaux et décisions (point 27) : un index de pointeurs dans le journal
 * (chemin, ligne, date, extrait court, termes), pas une copie des documents. Lecture des fichiers
 * seulement sous des racines autorisées. Chaque résultat garde son compte d'origine et n'apparaît
 * qu'aux comptes autorisés. Gratuit et local : pas d'embeddings ni de service.
 * Ne remplace pas la recherche des conversations (`src/lib/recherche.ts`, en mémoire).
 */

export const NON_RECHERCHE = [
  "Historique OpenBot : non recherché. Seul un agent le lit, dans sa propre conversation et depuis son dernier reset (history_search).",
  "Messages des conversations de l'app : non recherchés ici (recherche des conversations, en mémoire).",
];

/** Minuscules, sans accents ni ponctuation superflue : « Décision » et « decision » se trouvent. */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_/.:#]+/gu, " ")
    .trim();
}

const LIGNE_DECISION = /^\|\s*(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\s*\|(.*)\|\s*$/;

function dateIso(date: string): string {
  if (date.includes("-")) return date;
  const [jour, mois, annee] = date.split("/");
  return `${annee}-${mois}-${jour}`;
}

/**
 * Indexe les lignes datées d'un `decisions.md` (tableau `| Date | Sujet | Choix | … |`). Réindexer le
 * même fichier remplace ses pointeurs. Identifiant d'une décision : `<projet>/decisions.md#L<ligne>`.
 */
export function indexerDecisions(
  db: DatabaseSync,
  d: { chemin: string; contenu: string; project_id: string; account: string },
  maintenant: Horloge = Date.now,
): number {
  return enTransaction(db, () => {
    ecrire(db, "DELETE FROM pointeur WHERE kind = 'decision' AND chemin = ?", d.chemin);
    let n = 0;
    d.contenu.split(/\r?\n/).forEach((ligne, i) => {
      const m = LIGNE_DECISION.exec(ligne);
      if (!m) return;
      const cellules = m[2].split("|").map((c) => c.trim());
      const texte = cellules.join(" — ");
      const identifiant = `${d.project_id}/decisions.md#L${i + 1}`;
      ecrire(
        db,
        `INSERT INTO pointeur (pointeur_id, kind, identifiant, project_id, account, chemin, ligne, date, extrait, termes, hash, indexed_at)
         VALUES (?, 'decision', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        identifiant,
        d.project_id,
        d.account,
        d.chemin,
        i + 1,
        dateIso(m[1]),
        texte.length > 500 ? `${texte.slice(0, 499)}…` : texte,
        normaliser(`${identifiant} ${d.project_id} ${texte}`),
        empreinte(ligne),
        iso(maintenant()),
      );
      n++;
    });
    return n;
  });
}

/** Lit puis indexe un `decisions.md`, seulement s'il est sous une des racines autorisées (liens résolus). */
export function indexerFichierDecisions(
  db: DatabaseSync,
  d: { chemin: string; racines_autorisees: string[]; project_id: string; account: string },
  maintenant: Horloge = Date.now,
): number {
  const reel = realpathSync(d.chemin);
  const autorise = d.racines_autorisees.some((racine) => {
    const relatif = path.relative(realpathSync(racine), reel);
    return relatif !== "" && !relatif.startsWith("..") && !path.isAbsolute(relatif);
  });
  if (!autorise) throw new Error(`${d.chemin} : hors des dossiers autorisés.`);
  return indexerDecisions(db, { ...d, chemin: reel, contenu: readFileSync(reel, "utf8") }, maintenant);
}

/** Pointeur d'un travail : ses identifiants et son état, retrouvables par work_id, PRJ ou taskId. */
export function indexerTravail(db: DatabaseSync, t: { work_id: string; account: string }, maintenant: Horloge = Date.now): void {
  const travail = lireTravail(db, t.work_id);
  if (!travail) throw new Error(`Travail ${t.work_id} inconnu.`);
  const references = tous<{ ref: string }>(db, "SELECT ref FROM lien_externe WHERE work_id = ?", t.work_id).map((r) => r.ref);
  const extrait = `${travail.titre} — ${travail.status} — ${travail.state_ref}`;
  ecrire(
    db,
    `INSERT INTO pointeur (pointeur_id, kind, identifiant, project_id, account, chemin, ligne, date, extrait, termes, hash, indexed_at)
     VALUES (?, 'travail', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, identifiant, chemin, ligne) DO UPDATE SET extrait = excluded.extrait, termes = excluded.termes,
       hash = excluded.hash, indexed_at = excluded.indexed_at`,
    randomUUID(),
    travail.work_id,
    travail.project_id,
    t.account,
    travail.state_ref,
    travail.created_at.slice(0, 10),
    extrait.slice(0, 500),
    normaliser(`${travail.work_id} ${travail.project_id} ${references.join(" ")} ${extrait}`),
    empreinte(extrait),
    iso(maintenant()),
  );
}

export interface ResultatRecherche {
  kind: string;
  identifiant: string;
  project_id: string;
  chemin: string;
  ligne: number;
  date: string | null;
  extrait: string;
}

const echapperLike = (texte: string) => texte.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Cherche par identifiant exact ou par termes (tous présents), pour les seuls comptes autorisés.
 * Sans compte autorisé : aucun résultat. `non_recherche` dit ce qui n'a pas été parcouru.
 */
export function chercher(
  db: DatabaseSync,
  q: { requete: string; comptes_autorises: string[]; projets_autorises?: string[]; limite?: number },
): { resultats: ResultatRecherche[]; non_recherche: string[] } {
  const comptes = q.comptes_autorises.filter(Boolean);
  const termes = normaliser(q.requete).split(" ").filter(Boolean);
  if (comptes.length === 0 || termes.length === 0) return { resultats: [], non_recherche: NON_RECHERCHE };
  const parametres: (string | number)[] = [...comptes];
  let sql = `SELECT kind, identifiant, project_id, chemin, ligne, date, extrait FROM pointeur
             WHERE account IN (${comptes.map(() => "?").join(", ")})`;
  if (q.projets_autorises) {
    if (q.projets_autorises.length === 0) return { resultats: [], non_recherche: NON_RECHERCHE };
    sql += ` AND project_id IN (${q.projets_autorises.map(() => "?").join(", ")})`;
    parametres.push(...q.projets_autorises);
  }
  sql += ` AND (identifiant = ? OR (${termes.map(() => "termes LIKE ? ESCAPE '\\'").join(" AND ")}))`;
  parametres.push(q.requete.trim(), ...termes.map((t) => `%${echapperLike(t)}%`));
  sql += " ORDER BY (identifiant = ?) DESC, date DESC, chemin, ligne LIMIT ?";
  parametres.push(q.requete.trim(), q.limite ?? 20);
  return { resultats: tous<ResultatRecherche>(db, sql, ...parametres), non_recherche: NON_RECHERCHE };
}
