import { constants, copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Le journal du super-agent : une base SQLite sur l'ordinateur (module `node:sqlite` d'Electron,
 * aucune dépendance ajoutée). Autorité d'écriture unique : le process principal de ce PC.
 * Le renderer, le serveur VPS et Convex n'y écrivent jamais ; rien n'en part vers Convex
 * (`docs/CONVEX-PLAN.md` : conversations, fichiers, clés et routines restent sur l'ordinateur).
 *
 * Les garanties tiennent au moteur, pas au code qui l'appelle : clés UNIQUE, CHECK, clés étrangères,
 * index unique partiel, transactions `BEGIN IMMEDIATE` (un seul écrivain à la fois, même entre
 * process), journal WAL et `synchronous = FULL` (un COMMIT rendu est sur le disque).
 * Détail, sauvegarde et retour arrière : `docs/SUPERAGENT.md`.
 */

export const VERSION_SCHEMA = 2;
const ATTENTE_VERROU_MS = 10_000;

const SCHEMA_V1 = `
CREATE TABLE work (
  work_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  canonical_source_request TEXT NOT NULL UNIQUE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('klyra', 'openbot')),
  native_chat_id TEXT,
  external_task_id TEXT,
  state_ref TEXT NOT NULL CHECK (length(state_ref) > 0),
  titre TEXT NOT NULL DEFAULT '',
  owner_agent_id TEXT,
  owner_epoch INTEGER NOT NULL DEFAULT 0 CHECK (owner_epoch >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN
    ('active', 'waiting', 'waiting_machine', 'suspended', 'cancelled', 'done', 'blocked', 'reconciliation_required')),
  priority INTEGER NOT NULL DEFAULT 0,
  objective_revision INTEGER NOT NULL DEFAULT 1 CHECK (objective_revision >= 1),
  last_progress_at TEXT,
  deadline_at TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  CHECK ((target_kind = 'klyra' AND native_chat_id IS NOT NULL AND external_task_id IS NULL)
      OR (target_kind = 'openbot' AND external_task_id IS NOT NULL AND native_chat_id IS NULL)),
  CHECK ((owner_agent_id IS NULL) = (lease_until IS NULL))
);

CREATE TABLE decision_batch (
  decision_id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  seq_start INTEGER NOT NULL,
  seq_end INTEGER NOT NULL CHECK (seq_end >= seq_start),
  policy_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('deciding', 'decided', 'abandoned')),
  status_motif TEXT,
  started_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  output_ref TEXT
);
-- Une décision en cours par routeur : les arrivées suivantes attendent le lot suivant (point 12).
CREATE UNIQUE INDEX decision_une_en_cours ON decision_batch (router_id) WHERE status = 'deciding';

CREATE TABLE event (
  event_id TEXT PRIMARY KEY,
  ingest_seq INTEGER NOT NULL UNIQUE,
  source_app TEXT NOT NULL,
  source_account TEXT NOT NULL,
  source_conversation_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  type TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('natif', 'import_manuel', 'fixture')),
  occurred_at TEXT,
  occurred_at_motif TEXT,
  received_at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  work_id TEXT REFERENCES work (work_id),
  target_kind TEXT CHECK (target_kind IN ('klyra', 'openbot')),
  native_chat_id TEXT,
  native_message_id TEXT,
  external_task_id TEXT,
  source_url TEXT,
  local_ref TEXT,
  payload_ref TEXT,
  payload_hash TEXT NOT NULL,
  resume TEXT NOT NULL CHECK (length(CAST(resume AS BLOB)) <= 8192),
  trust TEXT NOT NULL CHECK (trust = 'external_data'),
  policy_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending', 'deciding', 'routed', 'ignored', 'waiting', 'quarantined')),
  status_motif TEXT,
  decision_id TEXT REFERENCES decision_batch (decision_id),
  revision_depassee INTEGER NOT NULL DEFAULT 0 CHECK (revision_depassee IN (0, 1)),
  UNIQUE (source_app, source_account, source_conversation_id, source_message_id, source_revision),
  CHECK ((occurred_at IS NULL) = (occurred_at_motif IS NOT NULL)),
  CHECK (source_url IS NOT NULL OR local_ref IS NOT NULL),
  CHECK (status <> 'pending' OR decision_id IS NULL),
  CHECK (status <> 'deciding' OR decision_id IS NOT NULL)
);
CREATE INDEX event_en_attente ON event (project_id, status, ingest_seq);

-- Chaque arrivée, acceptée ou non : motif et compteur de chaque décision du premier filtre (point 09).
CREATE TABLE reception (
  reception_id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  source_app TEXT,
  source_account TEXT,
  source_conversation_id TEXT,
  source_message_id TEXT,
  source_revision INTEGER,
  project_id TEXT,
  disposition TEXT NOT NULL CHECK (disposition IN
    ('accepte', 'doublon', 'conflit', 'rejete', 'quarantaine', 'ignore_technique')),
  motif TEXT NOT NULL,
  event_id TEXT REFERENCES event (event_id),
  CHECK ((disposition IN ('accepte', 'doublon', 'conflit')) = (event_id IS NOT NULL))
);

-- Un événement visant plusieurs travaux : plusieurs liens, jamais plusieurs copies (point 14).
CREATE TABLE event_work (
  event_id TEXT NOT NULL REFERENCES event (event_id),
  work_id TEXT NOT NULL REFERENCES work (work_id),
  disposition TEXT NOT NULL CHECK (disposition IN ('agir', 'repondre', 'attendre', 'ne_rien_faire')),
  decision_id TEXT NOT NULL REFERENCES decision_batch (decision_id),
  delivered_revision INTEGER NOT NULL,
  PRIMARY KEY (event_id, work_id)
);

CREATE TABLE subscription (
  subscription_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work (work_id),
  owner_epoch INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  source_app TEXT NOT NULL,
  source_account TEXT NOT NULL,
  source_conversation_id TEXT NOT NULL,
  event_types TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE (work_id, source_app, source_account, source_conversation_id, event_types)
);

-- Intentions d'action et outbox (points 14 et 22) : écrites avant l'effet, deux essais au plus.
CREATE TABLE operation (
  operation_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work (work_id),
  event_id TEXT REFERENCES event (event_id),
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  desired_effect TEXT NOT NULL,
  authorization_ref TEXT NOT NULL CHECK (length(authorization_ref) > 0),
  rollback_ref TEXT,
  owner_epoch INTEGER NOT NULL,
  objective_revision INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
  deadline_at TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN
    ('planned', 'inflight', 'succeeded', 'failed', 'unknown', 'reconciliation_required', 'blocked', 'cancelled')),
  status_motif TEXT,
  external_receipt_ref TEXT,
  effect_check_ref TEXT,
  next_check_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'succeeded' OR effect_check_ref IS NOT NULL)
);
CREATE INDEX operation_par_travail ON operation (work_id, status);

CREATE TABLE receipt (
  event_id TEXT NOT NULL REFERENCES event (event_id),
  work_id TEXT NOT NULL REFERENCES work (work_id),
  owner_epoch INTEGER NOT NULL,
  operation_id TEXT NOT NULL REFERENCES operation (operation_id),
  destinataire TEXT NOT NULL,
  acked_at TEXT NOT NULL,
  preuve_ref TEXT NOT NULL,
  PRIMARY KEY (event_id, work_id, owner_epoch)
);

-- Sémaphore : trois places numérotées, une quatrième est impossible pour le moteur (point 21).
CREATE TABLE occupation (
  slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 3),
  occupant_ref TEXT NOT NULL UNIQUE,
  work_id TEXT UNIQUE REFERENCES work (work_id),
  agent_id TEXT NOT NULL,
  owner_epoch INTEGER,
  acquired_at TEXT NOT NULL
);

-- Références typées d'un travail (point 26) : un chatId et un taskId identiques restent distincts.
CREATE TABLE lien_externe (
  work_id TEXT NOT NULL REFERENCES work (work_id),
  kind TEXT NOT NULL CHECK (kind IN ('klyra_chat', 'klyra_message', 'klyra_request', 'klyra_session',
    'openbot_task', 'digital_os_state', 'digital_os_project')),
  ref TEXT NOT NULL,
  PRIMARY KEY (kind, ref, work_id)
);

CREATE TABLE artefact (
  artifact_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work (work_id),
  operation_id TEXT REFERENCES operation (operation_id),
  decision_id TEXT REFERENCES decision_batch (decision_id),
  kind TEXT NOT NULL CHECK (kind IN ('resultat', 'preuve', 'etat')),
  ref TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Mesures (point 41) : une valeur a sa preuve, une valeur absente a son motif.
CREATE TABLE metric (
  metric_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work (work_id),
  event_id TEXT REFERENCES event (event_id),
  type TEXT NOT NULL,
  value REAL,
  unit TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  evidence_ref TEXT,
  motif TEXT,
  CHECK ((value IS NULL) = (motif IS NOT NULL)),
  CHECK (value IS NULL OR evidence_ref IS NOT NULL)
);

-- Index de pointeurs pour la recherche (point 27) : chemins et extraits, pas de copie des documents.
CREATE TABLE pointeur (
  pointeur_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'etat', 'travail', 'artefact')),
  identifiant TEXT NOT NULL,
  project_id TEXT NOT NULL,
  account TEXT NOT NULL,
  chemin TEXT NOT NULL,
  ligne INTEGER NOT NULL DEFAULT 0,
  date TEXT,
  extrait TEXT NOT NULL CHECK (length(extrait) <= 500),
  termes TEXT NOT NULL,
  hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  UNIQUE (kind, identifiant, chemin, ligne)
);

-- Politique d'un projet (point 11). Absente ou enabled = 0 : tout est refusé avant le modèle.
CREATE TABLE project_policy (
  project_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 0),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  document TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  approval_ref TEXT
);

-- Épisodes du watchdog (point 35). Une ligne n'est pas un message dans le fil surveillé.
CREATE TABLE alerte (
  alerte_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work (work_id),
  type TEXT NOT NULL,
  episode_key TEXT NOT NULL UNIQUE,
  preuve_ref TEXT NOT NULL,
  motif TEXT NOT NULL,
  prochain_geste TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

-- Première lecture d'une stagnation (W2) : l'alerte attend une seconde lecture, 15 minutes plus tard.
CREATE TABLE observation_progres (
  work_id TEXT PRIMARY KEY REFERENCES work (work_id),
  progress_sig TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);

-- Checkpoint métier. last_progress_at et l'heure du fichier n'en sont pas un.
CREATE TABLE checkpoint (
  checkpoint_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work (work_id),
  preuve_ref TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

-- Préparation anticipée (point 31) : une par révision, refusée si le plafond de dépense est absent.
CREATE TABLE preparation (
  preparation_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work (work_id),
  objective_revision INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  UNIQUE (work_id, objective_revision)
);

-- Essais d'une sortie de modèle invalide (point 10) : deux au plus, puis attente. Aucun appel payant.
CREATE TABLE essai_modele (
  decision_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 0 AND 2)
);
`;

/** Tables ajoutées en version 2. Un journal déjà en version 1 les reçoit sans perdre ses lignes. */
const TABLES_V2 = `
CREATE TABLE IF NOT EXISTS project_policy (
  project_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 0),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  document TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  approval_ref TEXT
);
CREATE TABLE IF NOT EXISTS alerte (
  alerte_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work (work_id),
  type TEXT NOT NULL,
  episode_key TEXT NOT NULL UNIQUE,
  preuve_ref TEXT NOT NULL,
  motif TEXT NOT NULL,
  prochain_geste TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS observation_progres (
  work_id TEXT PRIMARY KEY REFERENCES work (work_id),
  progress_sig TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkpoint (
  checkpoint_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work (work_id),
  preuve_ref TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preparation (
  preparation_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work (work_id),
  objective_revision INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  UNIQUE (work_id, objective_revision)
);
CREATE TABLE IF NOT EXISTS essai_modele (
  decision_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 0 AND 2)
);
`;

/** Ouvre (et crée au besoin) le journal. Une version de schéma inconnue est refusée plutôt qu'écrasée. */
export function ouvrirStockage(chemin: string, options: { sauvegardes?: string } = {}): DatabaseSync {
  mkdirSync(path.dirname(chemin), { recursive: true });
  const db = new DatabaseSync(chemin, { enableForeignKeyConstraints: true });
  try {
    // L'attente du verrou d'abord : passer en WAL demande lui-même le verrou.
    db.exec(`PRAGMA busy_timeout = ${ATTENTE_VERROU_MS}`);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA foreign_keys = ON");
    migrer(db, chemin, options.sauvegardes);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function versionDe(db: DatabaseSync): number {
  return Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
}

function migrer(db: DatabaseSync, chemin: string, dossierSauvegardes?: string) {
  const version = versionDe(db);
  if (version === VERSION_SCHEMA) return;
  if (version > VERSION_SCHEMA) {
    throw new Error(`Journal super-agent en version ${version}, plus récente que ce code (${VERSION_SCHEMA}) : conservé tel quel.`);
  }
  // Une base déjà remplie est copiée avant toute conversion. Un fichier vide part en version courante.
  if (version > 0) {
    const dossier = dossierSauvegardes ?? path.dirname(chemin);
    sauvegarder(db, path.join(dossier, `${path.basename(chemin)}.v${version}-avant-migration.sqlite`));
  }
  enTransaction(db, () => {
    const actuelle = versionDe(db);
    if (actuelle === VERSION_SCHEMA) return;
    if (actuelle === 0) db.exec(SCHEMA_V1);
    else if (actuelle === 1) db.exec(TABLES_V2);
    else throw new Error(`Journal super-agent en version ${actuelle} : migration non prévue.`);
    db.exec(`PRAGMA user_version = ${VERSION_SCHEMA}`);
  });
}

const profondeurs = new WeakMap<DatabaseSync, number>();

/**
 * Exécute `travail` dans une transaction `BEGIN IMMEDIATE` : le verrou d'écriture est pris d'emblée,
 * donc ce qu'on lit dedans ne peut pas changer avant le COMMIT, même depuis un autre process.
 * Une exception annule tout. Un appel imbriqué rejoint la transaction en cours.
 */
export function enTransaction<T>(db: DatabaseSync, travail: () => T): T {
  const profondeur = profondeurs.get(db) ?? 0;
  if (profondeur > 0) return travail();
  db.exec("BEGIN IMMEDIATE");
  profondeurs.set(db, 1);
  try {
    const resultat = travail();
    db.exec("COMMIT");
    return resultat;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // SQLite a déjà annulé la transaction (disque plein…) : rien à défaire.
    }
    throw error;
  } finally {
    profondeurs.set(db, 0);
  }
}

/** Copie cohérente de la base ouverte (`VACUUM INTO`), vers un fichier qui ne doit pas exister. */
export function sauvegarder(db: DatabaseSync, cible: string): string {
  if (existsSync(cible)) throw new Error(`La sauvegarde ${cible} existe déjà : elle n'est pas écrasée.`);
  mkdirSync(path.dirname(cible), { recursive: true });
  db.prepare("VACUUM INTO ?").run(cible);
  return cible;
}

/** Restaure une sauvegarde vers un fichier neuf, jamais par-dessus le journal en place, puis la contrôle. */
export function restaurerVersNouveauFichier(sauvegarde: string, cible: string): DatabaseSync {
  mkdirSync(path.dirname(cible), { recursive: true });
  copyFileSync(sauvegarde, cible, constants.COPYFILE_EXCL);
  const db = ouvrirStockage(cible);
  const controle = verifierIntegrite(db);
  if (controle !== "ok") {
    db.close();
    throw new Error(`Sauvegarde restaurée invalide : ${controle}`);
  }
  return db;
}

export function verifierIntegrite(db: DatabaseSync): string {
  const integrite = String(db.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
  if (integrite !== "ok") return integrite;
  const cles = db.prepare("PRAGMA foreign_key_check").all();
  return cles.length === 0 ? "ok" : `${cles.length} clé(s) étrangère(s) orpheline(s)`;
}

/* Lecture typée : les colonnes portent les noms des types de `types.ts`. */
export function un<T>(db: DatabaseSync, sql: string, ...parametres: (string | number | null)[]): T | undefined {
  return db.prepare(sql).get(...parametres) as unknown as T | undefined;
}

export function tous<T>(db: DatabaseSync, sql: string, ...parametres: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...parametres) as unknown as T[];
}

export function ecrire(db: DatabaseSync, sql: string, ...parametres: (string | number | null)[]): number {
  return Number(db.prepare(sql).run(...parametres).changes);
}
