import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { analyserNote, proposerLiens, vecteurDe, type AutreNote } from "./cerveau-liens";
import { cosinus, empreinte, encoderEmpreinte, extraireEntites, type EntiteCerveau } from "./cerveau-sens";
import type { EtatCerveau, NoteCerveau, PageCerveau, PointeurCerveau, PorteeCerveau, ResultatCerveau } from "./cerveau-types";

/** Index inversé SQLite ordinaire : ne dépend pas de FTS5, absent de certains runtimes livrés. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS connaissance(id TEXT PRIMARY KEY, titre TEXT NOT NULL, contenu TEXT NOT NULL,
 projet_id TEXT, agent_id TEXT, source TEXT, origine TEXT UNIQUE, hash TEXT NOT NULL,
 revision INTEGER NOT NULL, cree_le TEXT NOT NULL, modifie_le TEXT NOT NULL, octets INTEGER NOT NULL, obsolete INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS connaissance_portee ON connaissance(projet_id,agent_id,modifie_le);
CREATE INDEX IF NOT EXISTS connaissance_hash ON connaissance(hash);
CREATE INDEX IF NOT EXISTS connaissance_recherche ON connaissance(id,obsolete,agent_id,projet_id,titre,revision,origine,modifie_le);
CREATE TABLE IF NOT EXISTS connexion(a TEXT NOT NULL REFERENCES connaissance(id) ON DELETE CASCADE,
 b TEXT NOT NULL REFERENCES connaissance(id) ON DELETE CASCADE, PRIMARY KEY(a,b), CHECK(a<>b));
CREATE TABLE IF NOT EXISTS passage(id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES connaissance(id) ON DELETE CASCADE,
 rang INTEGER NOT NULL, texte TEXT NOT NULL, debut INTEGER NOT NULL, fin INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS passage_note ON passage(note_id,rang);
CREATE INDEX IF NOT EXISTS passage_recherche ON passage(id,note_id,rang);
CREATE TABLE IF NOT EXISTS terme(mot TEXT NOT NULL, passage_id TEXT NOT NULL REFERENCES passage(id) ON DELETE CASCADE,
 frequence INTEGER NOT NULL, PRIMARY KEY(mot,passage_id));
CREATE INDEX IF NOT EXISTS terme_passage ON terme(passage_id);
CREATE INDEX IF NOT EXISTS terme_recherche ON terme(mot,passage_id,frequence);`;
const MOTS_OUTILS = new Set("a au aux avec ce ces cette dans de des du en et est il ils je la le les leur ma mais me mes mon ne nos nous on ou par pas plus pour que qui sa sans se ses son sur ta te tes ton tu un une vos votre vous".split(" "));
const hashDe = (s: string) => createHash("sha256").update(s).digest("hex");
const octets = (s: string) => Buffer.byteLength(s, "utf8");
export function termesCerveau(s: string): string[] {
  return (s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[\p{L}\p{N}_-]{2,80}/gu) ?? []).filter((m) => !MOTS_OUTILS.has(m));
}
/** Coupe des lignes longues sans couper un caractère Unicode. Aucun appel à un modèle. */
export function decouperCerveau(texte: string): { texte: string; debut: number; fin: number }[] {
  const morceaux: { texte: string; debut: number; fin: number }[] = [];
  let tampon = "", taille = 0, debut = 1, ligne = 1;
  for (const caractere of texte) {
    const poids = octets(caractere);
    if (taille + poids > 1800) { morceaux.push({ texte: tampon, debut, fin: ligne }); tampon = ""; taille = 0; debut = ligne; }
    tampon += caractere; taille += poids; if (caractere === "\n") ligne++;
  }
  if (tampon.trim()) morceaux.push({ texte: tampon, debut, fin: ligne });
  return morceaux;
}
const borner = (n: unknown, defaut: number, min: number, max: number) => typeof n === "number" && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : defaut;
function sortieBornee(elements: PointeurCerveau[], budget: unknown): ResultatCerveau {
  const budgetOctets = borner(budget, 4096, 1024, 16384);
  const resultat: ResultatCerveau = { elements: [...elements], tronque: false, budgetOctets, octets: 0, jetonsEstimes: 0, comptage: "estimation-octets-divises-par-3", moteur: "hybride-local" };
  for (let i = 0; i < elements.length + 16; i++) {
    const taille = octets(JSON.stringify(resultat));
    if (taille > budgetOctets) { resultat.elements.pop(); resultat.tronque = true; continue; }
    if (resultat.octets === taille && resultat.jetonsEstimes === Math.ceil(taille / 3)) return resultat;
    resultat.octets = taille; resultat.jetonsEstimes = Math.ceil(taille / 3);
  }
  throw new Error("Impossible de respecter le budget de contexte.");
}
type Ligne = Record<string, string | number | bigint | Uint8Array | null>;
const identifiant = (v: unknown, facultatif = false): string | null => {
  if (facultatif && (v === null || v === undefined || v === "")) return null;
  if (typeof v !== "string" || !/^[a-zA-Z0-9_.:@-]{1,160}$/.test(v)) throw new Error("Identifiant de mémoire invalide.");
  return v;
};

export class Cerveau {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version > 2) throw new Error("Cette mémoire provient d’une version plus récente de KLYRA.");
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    db.exec(SCHEMA);
    preparerSens(db);
    db.exec("PRAGMA user_version=2;");
  }
  private filtre(portee: PorteeCerveau, alias = "n"): { sql: string; valeurs: (string | null)[] } {
    if (portee.proprietaire === true) return portee.projetId
      ? { sql: `${alias}.obsolete=0 AND (${alias}.projet_id IS NULL OR ${alias}.projet_id=?)`, valeurs: [portee.projetId] }
      : { sql: `${alias}.obsolete=0`, valeurs: [] };
    return { sql: `${alias}.obsolete=0 AND (${alias}.agent_id IS NULL OR ${alias}.agent_id=?) AND (${alias}.projet_id IS NULL OR ${alias}.projet_id=?)`, valeurs: [portee.agentId, portee.projetId] };
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  private voisins(id: string, table: "connexion" | "lien_auto" | "lien_bloque"): string[] {
    return this.db.prepare(`SELECT b AS id FROM ${table} WHERE a=? UNION SELECT a AS id FROM ${table} WHERE b=?`).all(id, id).map((r) => String(r.id));
  }
  private noteDe(n: Ligne, contenu: boolean): NoteCerveau {
    const liensManuels = this.voisins(String(n.id), "connexion");
    const liensAuto = this.voisins(String(n.id), "lien_auto");
    const liens = [...new Set([...liensManuels, ...liensAuto])];
    return { id: String(n.id), titre: String(n.titre), contenu: contenu ? String(n.contenu) : "", projetId: n.projet_id as string | null,
      agentId: n.agent_id as string | null, origine: n.origine as string | null, source: n.source ? JSON.parse(String(n.source)) : null,
      revision: Number(n.revision), creeLe: String(n.cree_le), modifieLe: String(n.modifie_le), liens, liensManuels, liensAuto };
  }
  etat(portee: PorteeCerveau): EtatCerveau {
    const f = this.filtre(portee);
    const r = this.db.prepare(`SELECT count(*) AS notes, coalesce(sum(n.octets),0) AS octets, max(n.modifie_le) AS dernier FROM connaissance n WHERE ${f.sql}`).get(...f.valeurs)!;
    const p = this.db.prepare(`SELECT count(*) AS nombre FROM passage p JOIN connaissance n ON n.id=p.note_id WHERE ${f.sql}`).get(...f.valeurs)!;
    return { notes: Number(r.notes), passages: Number(p.nombre), octetsSources: Number(r.octets), dernierChangement: r.dernier as string | null };
  }
  note(id: unknown, portee: PorteeCerveau): NoteCerveau {
    const f = this.filtre(portee);
    const r = this.db.prepare(`SELECT n.* FROM connaissance n WHERE n.id=? AND ${f.sql}`).get(identifiant(id), ...f.valeurs);
    if (!r) throw new Error("Note introuvable dans ce périmètre.");
    return this.noteDe(r, true);
  }
  lister(portee: PorteeCerveau, options: { projetId?: unknown; recherche?: unknown; offset?: unknown; limite?: unknown; centreId?: unknown } = {}): PageCerveau {
    const f = this.filtre(portee), valeurs = [...f.valeurs];
    let filtre = f.sql;
    if (options.centreId) {
      const id = identifiant(options.centreId);
      filtre += " AND (n.id=? OR n.id IN (SELECT b FROM connexion WHERE a=? UNION SELECT a FROM connexion WHERE b=? UNION SELECT b FROM lien_auto WHERE a=? UNION SELECT a FROM lien_auto WHERE b=?))";
      valeurs.push(id, id, id, id, id);
    }
    if (options.projetId === "sans-projet") filtre += " AND n.projet_id IS NULL";
    else if (options.projetId) { filtre += " AND n.projet_id=?"; valeurs.push(identifiant(options.projetId)); }
    const termes = [...new Set(termesCerveau(String(options.recherche ?? "").slice(0, 1000)))].slice(0, 20);
    if (termes.length) {
      const sem = this.idsSemantiques(String(options.recherche ?? ""), portee).map((s) => s.id);
      const morceaux = [`n.id IN (SELECT p.note_id FROM passage p JOIN terme t ON t.passage_id=p.id WHERE t.mot IN (${termes.map(() => "?").join(",")}))`];
      valeurs.push(...termes);
      if (sem.length) { morceaux.push(`n.id IN (${sem.map(() => "?").join(",")})`); valeurs.push(...sem); }
      filtre += ` AND (${morceaux.join(" OR ")})`;
    }
    const total = Number(this.db.prepare(`SELECT count(*) AS n FROM connaissance n WHERE ${filtre}`).get(...valeurs)!.n);
    const limite = borner(options.limite, 80, 1, 150), offset = borner(options.offset, 0, 0, 1_000_000);
    // Les gros contenus et les extraits des sources ne traversent pas la liste du graphe.
    const notes = this.db.prepare(`SELECT n.id,n.titre,n.projet_id,n.agent_id,n.origine,NULL AS source,n.revision,n.cree_le,n.modifie_le FROM connaissance n WHERE ${filtre} ORDER BY n.modifie_le DESC,n.id LIMIT ? OFFSET ?`).all(...valeurs, limite, offset).map((n) => this.noteDe(n, false));
    return { notes, total, limite, suite: offset + notes.length < total ? offset + notes.length : null, etat: this.etat(portee) };
  }
  garder(entree: NoteCerveau, importation?: { origine: string; agentId: string | null }): { note: NoteCerveau; inchange: boolean } {
    if (!entree || typeof entree.titre !== "string" || !entree.titre.trim() || entree.titre.length > 180 || typeof entree.contenu !== "string" || !entree.contenu.trim() || octets(entree.contenu) > 2_000_000) throw new Error("Titre et contenu requis ; une note texte est limitée à 2 Mo.");
    const id = identifiant(entree.id || randomUUID())!, projet = identifiant(entree.projetId, true);
    const liens = [...new Set((Array.isArray(entree.liens) ? entree.liens : []).map((l) => identifiant(l)!))].filter((l) => l !== id);
    if (liens.length > 200) throw new Error("Une note ne peut pas avoir plus de 200 liens explicites.");
    let source = null;
    if (entree.source) {
      const s = entree.source;
      if (![s.chatId, s.messageId, s.titre, s.extrait].every((v) => typeof v === "string") || octets(JSON.stringify(s)) > 100_000) throw new Error("Source de note invalide.");
      source = JSON.stringify(s);
    }
    return this.transaction(() => {
      const avant = importation ? this.db.prepare("SELECT * FROM connaissance WHERE origine=?").get(importation.origine) : this.db.prepare("SELECT * FROM connaissance WHERE id=?").get(id);
      if (avant?.origine && !importation) throw new Error("Cette note vient d’une source indexée : modifiez la source puis réindexez-la.");
      if (avant && !importation && Number(entree.revision) !== Number(avant.revision)) throw new Error("Cette note a changé depuis son ouverture. Rechargez-la avant de la modifier.");
      const reel = avant ? String(avant.id) : id, agent = importation ? identifiant(importation.agentId, true) : null;
      const avantAuto = avant ? new Set(this.voisins(reel, "lien_auto")) : new Set<string>();
      // Une réindexation ne transmet que les liens manuels. Une édition transmet les liens
      // automatiques encore cochés, et ceux qu’elle montrait (`liensAuto`) : seul un lien vu puis
      // décoché est un refus. Un lien apparu pendant l’édition n’est pas effacé.
      const manuels = (importation ? liens : liens.filter((l) => !avantAuto.has(l))).sort();
      const connus = Array.isArray(entree.liensAuto) ? new Set(entree.liensAuto) : avantAuto;
      const aBloquer = importation || !avant ? [] : [...avantAuto].filter((l) => connus.has(l) && !liens.includes(l));
      const hash = hashDe(JSON.stringify([entree.titre.trim(), entree.contenu, projet, agent, source, manuels]));
      if (!avant && !importation) {
        const doublon = this.db.prepare("SELECT * FROM connaissance WHERE hash=? AND agent_id IS NULL AND obsolete=0").get(hash);
        if (doublon) return { note: this.noteDe(doublon, true), inchange: true };
      }
      if (avant?.hash === hash) {
        if (aBloquer.length || !memeEnsemble(manuels, this.voisins(reel, "connexion"))) { this.poserLiens(reel, manuels, aBloquer); this.relier(reel); }
        this.db.prepare("UPDATE connaissance SET obsolete=0 WHERE id=?").run(reel);
        return { note: this.note(reel, { projetId: null, agentId: null, proprietaire: true }), inchange: true };
      }
      const maintenant = new Date().toISOString(), revision = Number(avant?.revision ?? 0) + 1;
      for (const l of manuels) if (!this.db.prepare("SELECT id FROM connaissance WHERE id=?").get(l)) throw new Error("Une connexion vise une note absente. Rechargez les notes.");
      this.db.prepare(`INSERT INTO connaissance(id,titre,contenu,projet_id,agent_id,source,origine,hash,revision,cree_le,modifie_le,octets) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET titre=excluded.titre,contenu=excluded.contenu,projet_id=excluded.projet_id,source=excluded.source,hash=excluded.hash,revision=excluded.revision,modifie_le=excluded.modifie_le,octets=excluded.octets,obsolete=0`).run(reel, entree.titre.trim(), entree.contenu, projet, agent, source, importation?.origine ?? null, hash, revision, avant ? String(avant.cree_le) : maintenant, maintenant, octets(entree.contenu));
      this.poserLiens(reel, manuels, aBloquer);
      this.db.prepare("DELETE FROM passage WHERE note_id=?").run(reel);
      decouperCerveau(entree.contenu).forEach((p, rang) => {
        // Une référence compacte évite de renvoyer de longs chemins ou hashes à chaque lecture.
        const passageId = `p-${createHash("sha256").update(JSON.stringify([reel, revision, rang, hash])).digest("base64url").slice(0, 22)}`;
        this.db.prepare("INSERT INTO passage VALUES(?,?,?,?,?,?)").run(passageId, reel, rang, p.texte, p.debut, p.fin);
        const freq = new Map<string, number>();
        for (const mot of termesCerveau(p.texte)) freq.set(mot, (freq.get(mot) ?? 0) + 1);
        const contexte = importation?.origine.startsWith("dossier:") ? ` ${importation.origine} ${importation.origine.replace(/[_\/-]/g, " ")}` : "";
        for (const mot of termesCerveau(entree.titre + contexte)) freq.set(mot, (freq.get(mot) ?? 0) + 5);
        const inserer = this.db.prepare("INSERT INTO terme VALUES(?,?,?)");
        for (const [mot, n] of freq) inserer.run(mot, passageId, n);
      });
      this.relier(reel);
      return { note: this.note(reel, { projetId: null, agentId: null, proprietaire: true }), inchange: false };
    });
  }
  /** Recalcule entités, empreinte et liens automatiques des notes encore sans empreinte. */
  completerLiens(limite = 40): number {
    const ids = this.db.prepare("SELECT c.id FROM connaissance c LEFT JOIN vecteur v ON v.note_id=c.id WHERE c.obsolete=0 AND v.note_id IS NULL LIMIT ?").all(Math.max(1, Math.min(200, limite))) as Ligne[];
    let n = 0;
    for (const row of ids) { this.transaction(() => this.relier(String(row.id))); n++; }
    return n;
  }
  private poserLiens(id: string, manuels: string[], bloquer: string[]): void {
    this.db.prepare("DELETE FROM connexion WHERE a=? OR b=?").run(id, id);
    for (const l of manuels) { const paire = [id, l].sort(); this.db.prepare("INSERT OR IGNORE INTO connexion(a,b) VALUES(?,?)").run(...paire); }
    for (const l of bloquer) {
      const paire = [id, l].sort();
      this.db.prepare("DELETE FROM lien_auto WHERE a=? AND b=?").run(...paire);
      this.db.prepare("INSERT OR IGNORE INTO lien_bloque(a,b) VALUES(?,?)").run(...paire);
    }
  }
  private autres(id: string): AutreNote[] {
    const titres = this.db.prepare("SELECT id, titre FROM connaissance WHERE id!=? AND obsolete=0").all(id) as Ligne[];
    const entites = new Map<string, EntiteCerveau[]>();
    for (const e of this.db.prepare("SELECT note_id, genre, valeur FROM entite WHERE note_id!=?").all(id) as Ligne[]) {
      const liste = entites.get(String(e.note_id)) ?? [];
      if (liste.length < 40) liste.push({ genre: String(e.genre) as EntiteCerveau["genre"], valeur: String(e.valeur) });
      entites.set(String(e.note_id), liste);
    }
    const vecteurs = new Map<string, Float32Array>();
    for (const v of this.db.prepare("SELECT note_id, empreinte FROM vecteur WHERE note_id!=?").all(id) as Ligne[]) {
      const vec = vecteurDe(v.empreinte instanceof Uint8Array ? v.empreinte : null);
      if (vec) vecteurs.set(String(v.note_id), vec);
    }
    return titres.map((n) => ({ id: String(n.id), titre: String(n.titre), entites: entites.get(String(n.id)) ?? [], vecteur: vecteurs.get(String(n.id)) ?? null }));
  }
  private relier(id: string): void {
    const row = this.db.prepare("SELECT titre, contenu, origine FROM connaissance WHERE id=?").get(id) as Ligne | undefined;
    if (!row) return;
    const titre = String(row.titre), contenu = String(row.contenu), origine = row.origine ? String(row.origine) : "";
    const analyse = analyserNote(titre, contenu, origine);
    this.db.prepare("DELETE FROM entite WHERE note_id=?").run(id);
    const ins = this.db.prepare("INSERT OR IGNORE INTO entite(note_id,genre,valeur) VALUES(?,?,?)");
    for (const e of analyse.entites) ins.run(id, e.genre, e.valeur);
    this.db.prepare("INSERT INTO vecteur(note_id,empreinte) VALUES(?,?) ON CONFLICT(note_id) DO UPDATE SET empreinte=excluded.empreinte").run(id, encoderEmpreinte(analyse.vecteur));
    const bloques = new Set(this.voisins(id, "lien_bloque"));
    const manuels = new Set(this.voisins(id, "connexion"));
    this.db.prepare("DELETE FROM lien_auto WHERE a=? OR b=?").run(id, id);
    const ajouter = this.db.prepare("INSERT OR IGNORE INTO lien_auto(a,b,genre,pourquoi,score) VALUES(?,?,?,?,?)");
    for (const lien of proposerLiens(titre, contenu, origine, this.autres(id))) {
      if (bloques.has(lien.id) || manuels.has(lien.id) || !this.db.prepare("SELECT id FROM connaissance WHERE id=? AND obsolete=0").get(lien.id)) continue;
      const paire = [id, lien.id].sort();
      ajouter.run(paire[0], paire[1], lien.genre, lien.pourquoi.slice(0, 180), lien.score);
    }
  }
  private idsSemantiques(requete: string, portee: PorteeCerveau): { id: string; score: number }[] {
    const texte = requete.slice(0, 1000);
    if (texte.trim().length < 2) return [];
    const f = this.filtre(portee), scores = new Map<string, number>(), vecteur = empreinte(texte);
    for (const e of extraireEntites("", texte)) {
      for (const l of this.db.prepare(`SELECT n.id FROM connaissance n JOIN entite e ON e.note_id=n.id WHERE e.genre=? AND e.valeur=? AND ${f.sql} LIMIT 20`).all(e.genre, e.valeur, ...f.valeurs) as Ligne[]) {
        scores.set(String(l.id), Math.max(scores.get(String(l.id)) ?? 0, e.genre === "sujet" ? 0.7 : 0.95));
      }
    }
    for (const l of this.db.prepare(`SELECT v.note_id, v.empreinte FROM vecteur v JOIN connaissance n ON n.id=v.note_id WHERE ${f.sql} LIMIT 4000`).all(...f.valeurs) as Ligne[]) {
      const vec = vecteurDe(l.empreinte instanceof Uint8Array ? l.empreinte : null);
      if (!vec) continue;
      const score = cosinus(vecteur, vec);
      if (score >= 0.42) scores.set(String(l.note_id), Math.max(scores.get(String(l.note_id)) ?? 0, score));
    }
    return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, 12);
  }
  oublier(id: unknown, revision: unknown): void {
    const cle = identifiant(id);
    const r = this.db.prepare("DELETE FROM connaissance WHERE id=? AND revision=?").run(cle, borner(revision, -1, -1, Number.MAX_SAFE_INTEGER));
    if (!Number(r.changes)) throw new Error("La note est absente ou a changé depuis son ouverture.");
  }
  actualiserSources(prefixe: string, conserves: string[], complet: boolean): void {
    if (!complet) return;
    this.transaction(() => {
      this.db.prepare("UPDATE connaissance SET obsolete=1 WHERE origine LIKE ?").run(`${prefixe}%`);
      for (const id of conserves) this.db.prepare("UPDATE connaissance SET obsolete=0 WHERE id=? AND origine LIKE ?").run(id, `${prefixe}%`);
    });
  }
  chercher(requete: unknown, portee: PorteeCerveau, budget?: unknown): ResultatCerveau {
    const mots = [...new Set(termesCerveau(String(requete ?? "").slice(0, 1000)))].slice(0, 20);
    if (!mots.length) return sortieBornee([], budget);
    const f = this.filtre(portee);
    // Classer sur des index de métadonnées, avant de charger le texte des passages retenus.
    // La clé unique (mot,passage_id) rend COUNT(*) équivalent à COUNT(DISTINCT mot).
    const lignes = this.db.prepare(`WITH scores AS MATERIALIZED (
      SELECT passage_id,COUNT(*) AS couverture,SUM(frequence) AS score FROM terme INDEXED BY terme_recherche
      WHERE mot IN (${mots.map(() => "?").join(",")}) GROUP BY passage_id)
      SELECT p.id,p.note_id FROM scores s
      JOIN passage p INDEXED BY passage_recherche ON p.id=s.passage_id
      JOIN connaissance n INDEXED BY connaissance_recherche ON n.id=p.note_id
      WHERE ${f.sql}
      ORDER BY s.couverture DESC,CASE WHEN n.origine LIKE 'dossier:%:90_ARCHIVES/%' OR n.origine LIKE 'dossier:%/90_ARCHIVES/%' THEN 1 ELSE 0 END,CASE WHEN n.titre LIKE 'DIGITAL-OS · repère /%' THEN 1 ELSE 0 END,s.score DESC,n.modifie_le DESC,p.rang,p.id LIMIT 60`).all(...mots, ...f.valeurs);
    const parNote = new Map<string, number>();
    const lire = this.db.prepare(`SELECT p.id,p.note_id,p.texte,p.debut,p.fin,n.titre,n.revision,n.agent_id,n.projet_id,n.origine
      FROM passage p JOIN connaissance n ON n.id=p.note_id WHERE p.id=? AND ${f.sql}`);
    const elements = lignes.filter((r) => { const id = String(r.note_id), n = parNote.get(id) ?? 0; parNote.set(id, n + 1); return n < 2; }).slice(0, 8).flatMap((r) => {
      // Revalider la portée et l’existence : un indexeur concurrent peut avoir remplacé un passage.
      const actuel = lire.get(String(r.id), ...f.valeurs);
      return actuel ? [this.pointeur(actuel, true)] : [];
    });
    const connus = new Set(elements.map((e) => e.noteId));
    const premier = this.db.prepare(`SELECT p.id,p.note_id,p.texte,p.debut,p.fin,n.titre,n.revision,n.agent_id,n.projet_id,n.origine
      FROM passage p JOIN connaissance n ON n.id=p.note_id WHERE p.note_id=? AND ${f.sql} ORDER BY p.rang LIMIT 1`);
    for (const proche of this.idsSemantiques(String(requete ?? ""), portee)) {
      if (connus.has(proche.id) || elements.length >= 12) continue;
      const actuel = premier.get(proche.id, ...f.valeurs);
      if (actuel) { elements.push(this.pointeur(actuel, true)); connus.add(proche.id); }
    }
    const resultat = sortieBornee(elements, budget);
    if (lignes.length >= 60 || elements.length < lignes.length) resultat.tronque = true;
    // Recalcule la taille après le marqueur de troncature (true est plus court que false).
    return sortieBorneeAvecTroncature(resultat);
  }
  private pointeur(r: Ligne, court: boolean): PointeurCerveau {
    const origine = typeof r.origine === "string" ? origineLisible(r.origine) : null;
    return { id: String(r.id), noteId: String(r.note_id), titre: String(r.titre), extrait: court ? String(r.texte).slice(0, 180) : String(r.texte), lignes: [Number(r.debut), Number(r.fin)], revision: Number(r.revision), agentId: r.agent_id as string | null, projetId: r.projet_id as string | null, origine, ...(origine && /(?:^|\/)90_ARCHIVES\//.test(origine) ? { historique: true } : {}) };
  }
  lire(ids: unknown, portee: PorteeCerveau, budget?: unknown): ResultatCerveau {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || ids.some((id) => typeof id !== "string" || id.length > 200)) throw new Error("Demandez de un à huit passages identifiés par la recherche.");
    const f = this.filtre(portee), elements: PointeurCerveau[] = [];
    for (const id of new Set(ids)) {
      const r = this.db.prepare(`SELECT p.*,p.note_id,n.titre,n.revision,n.agent_id,n.projet_id,n.origine FROM passage p JOIN connaissance n ON n.id=p.note_id WHERE p.id=? AND ${f.sql}`).get(id, ...f.valeurs);
      if (r) elements.push(this.pointeur(r, false));
    }
    return sortieBornee(elements, budget);
  }
  fermer(): void { this.db.close(); }
}
function origineLisible(origine: string): string {
  if (origine.startsWith("dossier:")) return `DIGITAL-OS/${origine.split(":").slice(2).join(":")}`;
  if (origine.startsWith("souvenir:")) return `souvenir:${origine.split(":").slice(2).join(":")}`;
  if (origine.startsWith("conversation:")) return "conversation";
  if (origine.startsWith("rendu:") || origine.startsWith("atelier:")) return "fichier d’agent";
  return "document importé";
}
function colonne(db: DatabaseSync, table: string, nom: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Ligne[]).some((r) => r.name === nom);
}
/** Ajoute les tables du sens sans toucher aux notes déjà là (une base v1 s’ouvre telle quelle). */
function preparerSens(db: DatabaseSync): void {
  if (!colonne(db, "connexion", "genre")) db.exec("ALTER TABLE connexion ADD COLUMN genre TEXT NOT NULL DEFAULT 'manuel'");
  if (!colonne(db, "connexion", "pourquoi")) db.exec("ALTER TABLE connexion ADD COLUMN pourquoi TEXT NOT NULL DEFAULT ''");
  if (!colonne(db, "connexion", "score")) db.exec("ALTER TABLE connexion ADD COLUMN score REAL NOT NULL DEFAULT 1");
  db.exec(`CREATE TABLE IF NOT EXISTS lien_auto(
 a TEXT NOT NULL REFERENCES connaissance(id) ON DELETE CASCADE, b TEXT NOT NULL REFERENCES connaissance(id) ON DELETE CASCADE,
 genre TEXT NOT NULL, pourquoi TEXT NOT NULL DEFAULT '', score REAL NOT NULL DEFAULT 0, PRIMARY KEY(a,b), CHECK(a<>b));
CREATE TABLE IF NOT EXISTS lien_bloque(
 a TEXT NOT NULL REFERENCES connaissance(id) ON DELETE CASCADE, b TEXT NOT NULL REFERENCES connaissance(id) ON DELETE CASCADE,
 PRIMARY KEY(a,b), CHECK(a<>b));
CREATE TABLE IF NOT EXISTS entite(
 note_id TEXT NOT NULL REFERENCES connaissance(id) ON DELETE CASCADE, genre TEXT NOT NULL, valeur TEXT NOT NULL,
 PRIMARY KEY(note_id, genre, valeur));
CREATE INDEX IF NOT EXISTS entite_valeur ON entite(genre, valeur);
CREATE TABLE IF NOT EXISTS vecteur(note_id TEXT PRIMARY KEY REFERENCES connaissance(id) ON DELETE CASCADE, empreinte BLOB NOT NULL);`);
}
function memeEnsemble(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(b);
  return a.every((x) => s.has(x));
}
/** Copie cohérente du fichier SQLite. Le fichier d’origine n’est pas modifié. Un nom déjà pris est refusé. */
export function sauvegarderCerveau(cerveau: Cerveau, destination: string): string {
  if (!path.isAbsolute(destination) || destination.includes("\0") || destination.includes("'")) throw new Error("Chemin de sauvegarde invalide.");
  if (existsSync(destination)) throw new Error("Un fichier de sauvegarde porte déjà ce nom. Rien n’a été écrasé.");
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  cerveau.db.exec(`VACUUM INTO '${destination}'`);
  chmodSync(destination, 0o600);
  return destination;
}
function sortieBorneeAvecTroncature(r: ResultatCerveau): ResultatCerveau {
  for (let i = 0; i < 8; i++) { const n = octets(JSON.stringify(r)); if (n === r.octets && r.jetonsEstimes === Math.ceil(n / 3)) break; r.octets = n; r.jetonsEstimes = Math.ceil(n / 3); }
  return r;
}
const ouverts = new Map<string, Cerveau>();
export function ouvrirCerveau(donnees: string): Cerveau {
  const dossier = path.join(donnees, "cerveau"), fichier = path.join(dossier, "connaissances.sqlite");
  const connu = ouverts.get(fichier); if (connu) return connu;
  let Sqlite: typeof import("node:sqlite");
  try { Sqlite = createRequire(path.join(process.cwd(), "cerveau-runtime.cjs"))("node:sqlite"); }
  catch { throw new Error("Ce runtime ne fournit pas SQLite. Sous Node 22, démarrer le serveur avec --experimental-sqlite ; aucune installation n’a été effectuée."); }
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const db = new Sqlite.DatabaseSync(fichier);
  try { const cerveau = new Cerveau(db); if (existsSync(fichier)) chmodSync(fichier, 0o600); ouverts.set(fichier, cerveau); return cerveau; }
  catch (e) { db.close(); throw e; }
}
