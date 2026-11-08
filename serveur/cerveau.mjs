// Généré par scripts/serveur-genere.mjs depuis electron/cerveau.ts : ne pas modifier à la main.
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
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
CREATE INDEX IF NOT EXISTS terme_recherche ON terme(mot,passage_id,frequence);
PRAGMA user_version=1;`;
const MOTS_OUTILS = new Set("a au aux avec ce ces cette dans de des du en et est il ils je la le les leur ma mais me mes mon ne nos nous on ou par pas plus pour que qui sa sans se ses son sur ta te tes ton tu un une vos votre vous".split(" "));
const hashDe = (s) => createHash("sha256").update(s).digest("hex");
const octets = (s) => Buffer.byteLength(s, "utf8");
export function termesCerveau(s) {
    return (s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[\p{L}\p{N}_-]{2,80}/gu) ?? []).filter((m) => !MOTS_OUTILS.has(m));
}
/** Coupe des lignes longues sans couper un caractère Unicode. Aucun appel à un modèle. */
export function decouperCerveau(texte) {
    const morceaux = [];
    let tampon = "", taille = 0, debut = 1, ligne = 1;
    for (const caractere of texte) {
        const poids = octets(caractere);
        if (taille + poids > 1800) {
            morceaux.push({ texte: tampon, debut, fin: ligne });
            tampon = "";
            taille = 0;
            debut = ligne;
        }
        tampon += caractere;
        taille += poids;
        if (caractere === "\n")
            ligne++;
    }
    if (tampon.trim())
        morceaux.push({ texte: tampon, debut, fin: ligne });
    return morceaux;
}
const borner = (n, defaut, min, max) => typeof n === "number" && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : defaut;
function sortieBornee(elements, budget) {
    const budgetOctets = borner(budget, 4096, 1024, 16384);
    const resultat = { elements: [...elements], tronque: false, budgetOctets, octets: 0, jetonsEstimes: 0, comptage: "estimation-octets-divises-par-3", moteur: "index-lexical-local" };
    for (let i = 0; i < elements.length + 16; i++) {
        const taille = octets(JSON.stringify(resultat));
        if (taille > budgetOctets) {
            resultat.elements.pop();
            resultat.tronque = true;
            continue;
        }
        if (resultat.octets === taille && resultat.jetonsEstimes === Math.ceil(taille / 3))
            return resultat;
        resultat.octets = taille;
        resultat.jetonsEstimes = Math.ceil(taille / 3);
    }
    throw new Error("Impossible de respecter le budget de contexte.");
}
const identifiant = (v, facultatif = false) => {
    if (facultatif && (v === null || v === undefined || v === ""))
        return null;
    if (typeof v !== "string" || !/^[a-zA-Z0-9_.:@-]{1,160}$/.test(v))
        throw new Error("Identifiant de mémoire invalide.");
    return v;
};
export class Cerveau {
    db;
    constructor(db) {
        this.db = db;
        const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
        if (version > 1)
            throw new Error("Cette mémoire provient d’une version plus récente de KLYRA.");
        db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
        db.exec(SCHEMA);
    }
    filtre(portee, alias = "n") {
        if (portee.proprietaire === true)
            return portee.projetId
                ? { sql: `${alias}.obsolete=0 AND (${alias}.projet_id IS NULL OR ${alias}.projet_id=?)`, valeurs: [portee.projetId] }
                : { sql: `${alias}.obsolete=0`, valeurs: [] };
        return { sql: `${alias}.obsolete=0 AND (${alias}.agent_id IS NULL OR ${alias}.agent_id=?) AND (${alias}.projet_id IS NULL OR ${alias}.projet_id=?)`, valeurs: [portee.agentId, portee.projetId] };
    }
    transaction(fn) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const r = fn();
            this.db.exec("COMMIT");
            return r;
        }
        catch (e) {
            this.db.exec("ROLLBACK");
            throw e;
        }
    }
    noteDe(n, contenu) {
        const liens = this.db.prepare("SELECT b AS id FROM connexion WHERE a=? UNION SELECT a AS id FROM connexion WHERE b=?").all(n.id, n.id).map((r) => String(r.id));
        return { id: String(n.id), titre: String(n.titre), contenu: contenu ? String(n.contenu) : "", projetId: n.projet_id,
            agentId: n.agent_id, origine: n.origine, source: n.source ? JSON.parse(String(n.source)) : null,
            revision: Number(n.revision), creeLe: String(n.cree_le), modifieLe: String(n.modifie_le), liens };
    }
    etat(portee) {
        const f = this.filtre(portee);
        const r = this.db.prepare(`SELECT count(*) AS notes, coalesce(sum(n.octets),0) AS octets, max(n.modifie_le) AS dernier FROM connaissance n WHERE ${f.sql}`).get(...f.valeurs);
        const p = this.db.prepare(`SELECT count(*) AS nombre FROM passage p JOIN connaissance n ON n.id=p.note_id WHERE ${f.sql}`).get(...f.valeurs);
        return { notes: Number(r.notes), passages: Number(p.nombre), octetsSources: Number(r.octets), dernierChangement: r.dernier };
    }
    note(id, portee) {
        const f = this.filtre(portee);
        const r = this.db.prepare(`SELECT n.* FROM connaissance n WHERE n.id=? AND ${f.sql}`).get(identifiant(id), ...f.valeurs);
        if (!r)
            throw new Error("Note introuvable dans ce périmètre.");
        return this.noteDe(r, true);
    }
    lister(portee, options = {}) {
        const f = this.filtre(portee), valeurs = [...f.valeurs];
        let filtre = f.sql;
        if (options.centreId) {
            const id = identifiant(options.centreId);
            filtre += " AND (n.id=? OR n.id IN (SELECT b FROM connexion WHERE a=? UNION SELECT a FROM connexion WHERE b=?))";
            valeurs.push(id, id, id);
        }
        if (options.projetId === "sans-projet")
            filtre += " AND n.projet_id IS NULL";
        else if (options.projetId) {
            filtre += " AND n.projet_id=?";
            valeurs.push(identifiant(options.projetId));
        }
        const termes = [...new Set(termesCerveau(String(options.recherche ?? "").slice(0, 1000)))].slice(0, 20);
        if (termes.length) {
            filtre += ` AND n.id IN (SELECT p.note_id FROM passage p JOIN terme t ON t.passage_id=p.id WHERE t.mot IN (${termes.map(() => "?").join(",")}))`;
            valeurs.push(...termes);
        }
        const total = Number(this.db.prepare(`SELECT count(*) AS n FROM connaissance n WHERE ${filtre}`).get(...valeurs).n);
        const limite = borner(options.limite, 80, 1, 150), offset = borner(options.offset, 0, 0, 1_000_000);
        // Les gros contenus et les extraits des sources ne traversent pas la liste du graphe.
        const notes = this.db.prepare(`SELECT n.id,n.titre,n.projet_id,n.agent_id,n.origine,NULL AS source,n.revision,n.cree_le,n.modifie_le FROM connaissance n WHERE ${filtre} ORDER BY n.modifie_le DESC,n.id LIMIT ? OFFSET ?`).all(...valeurs, limite, offset).map((n) => this.noteDe(n, false));
        return { notes, total, limite, suite: offset + notes.length < total ? offset + notes.length : null, etat: this.etat(portee) };
    }
    garder(entree, importation) {
        if (!entree || typeof entree.titre !== "string" || !entree.titre.trim() || entree.titre.length > 180 || typeof entree.contenu !== "string" || !entree.contenu.trim() || octets(entree.contenu) > 2_000_000)
            throw new Error("Titre et contenu requis ; une note texte est limitée à 2 Mo.");
        const id = identifiant(entree.id || randomUUID()), projet = identifiant(entree.projetId, true);
        const liens = [...new Set((Array.isArray(entree.liens) ? entree.liens : []).map((l) => identifiant(l)))].filter((l) => l !== id);
        if (liens.length > 200)
            throw new Error("Une note ne peut pas avoir plus de 200 liens explicites.");
        let source = null;
        if (entree.source) {
            const s = entree.source;
            if (![s.chatId, s.messageId, s.titre, s.extrait].every((v) => typeof v === "string") || octets(JSON.stringify(s)) > 100_000)
                throw new Error("Source de note invalide.");
            source = JSON.stringify(s);
        }
        return this.transaction(() => {
            const avant = importation ? this.db.prepare("SELECT * FROM connaissance WHERE origine=?").get(importation.origine) : this.db.prepare("SELECT * FROM connaissance WHERE id=?").get(id);
            if (avant?.origine && !importation)
                throw new Error("Cette note vient d’une source indexée : modifiez la source puis réindexez-la.");
            if (avant && !importation && Number(entree.revision) !== Number(avant.revision))
                throw new Error("Cette note a changé depuis son ouverture. Rechargez-la avant de la modifier.");
            const reel = avant ? String(avant.id) : id, agent = importation ? identifiant(importation.agentId, true) : null;
            const hash = hashDe(JSON.stringify([entree.titre.trim(), entree.contenu, projet, agent, source, liens.sort()]));
            if (!avant && !importation) {
                const doublon = this.db.prepare("SELECT * FROM connaissance WHERE hash=? AND agent_id IS NULL AND obsolete=0").get(hash);
                if (doublon)
                    return { note: this.noteDe(doublon, true), inchange: true };
            }
            if (avant?.hash === hash) {
                this.db.prepare("UPDATE connaissance SET obsolete=0 WHERE id=?").run(reel);
                return { note: this.noteDe(avant, true), inchange: true };
            }
            const maintenant = new Date().toISOString(), revision = Number(avant?.revision ?? 0) + 1;
            for (const l of liens)
                if (!this.db.prepare("SELECT id FROM connaissance WHERE id=?").get(l))
                    throw new Error("Une connexion vise une note absente. Rechargez les notes.");
            this.db.prepare(`INSERT INTO connaissance(id,titre,contenu,projet_id,agent_id,source,origine,hash,revision,cree_le,modifie_le,octets) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET titre=excluded.titre,contenu=excluded.contenu,projet_id=excluded.projet_id,source=excluded.source,hash=excluded.hash,revision=excluded.revision,modifie_le=excluded.modifie_le,octets=excluded.octets,obsolete=0`).run(reel, entree.titre.trim(), entree.contenu, projet, agent, source, importation?.origine ?? null, hash, revision, avant ? String(avant.cree_le) : maintenant, maintenant, octets(entree.contenu));
            this.db.prepare("DELETE FROM connexion WHERE a=? OR b=?").run(reel, reel);
            for (const l of liens) {
                const paire = [reel, l].sort();
                this.db.prepare("INSERT OR IGNORE INTO connexion(a,b) VALUES(?,?)").run(...paire);
            }
            this.db.prepare("DELETE FROM passage WHERE note_id=?").run(reel);
            decouperCerveau(entree.contenu).forEach((p, rang) => {
                // Une référence compacte évite de renvoyer de longs chemins ou hashes à chaque lecture.
                const passageId = `p-${createHash("sha256").update(JSON.stringify([reel, revision, rang, hash])).digest("base64url").slice(0, 22)}`;
                this.db.prepare("INSERT INTO passage VALUES(?,?,?,?,?,?)").run(passageId, reel, rang, p.texte, p.debut, p.fin);
                const freq = new Map();
                for (const mot of termesCerveau(p.texte))
                    freq.set(mot, (freq.get(mot) ?? 0) + 1);
                const contexte = importation?.origine.startsWith("dossier:") ? ` ${importation.origine} ${importation.origine.replace(/[_\/-]/g, " ")}` : "";
                for (const mot of termesCerveau(entree.titre + contexte))
                    freq.set(mot, (freq.get(mot) ?? 0) + 5);
                const inserer = this.db.prepare("INSERT INTO terme VALUES(?,?,?)");
                for (const [mot, n] of freq)
                    inserer.run(mot, passageId, n);
            });
            return { note: this.note(reel, { projetId: null, agentId: null, proprietaire: true }), inchange: false };
        });
    }
    oublier(id, revision) {
        const cle = identifiant(id);
        const r = this.db.prepare("DELETE FROM connaissance WHERE id=? AND revision=?").run(cle, borner(revision, -1, -1, Number.MAX_SAFE_INTEGER));
        if (!Number(r.changes))
            throw new Error("La note est absente ou a changé depuis son ouverture.");
    }
    actualiserSources(prefixe, conserves, complet) {
        if (!complet)
            return;
        this.transaction(() => {
            this.db.prepare("UPDATE connaissance SET obsolete=1 WHERE origine LIKE ?").run(`${prefixe}%`);
            for (const id of conserves)
                this.db.prepare("UPDATE connaissance SET obsolete=0 WHERE id=? AND origine LIKE ?").run(id, `${prefixe}%`);
        });
    }
    chercher(requete, portee, budget) {
        const mots = [...new Set(termesCerveau(String(requete ?? "").slice(0, 1000)))].slice(0, 20);
        if (!mots.length)
            return sortieBornee([], budget);
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
        const parNote = new Map();
        const lire = this.db.prepare(`SELECT p.id,p.note_id,p.texte,p.debut,p.fin,n.titre,n.revision,n.agent_id,n.projet_id,n.origine
      FROM passage p JOIN connaissance n ON n.id=p.note_id WHERE p.id=? AND ${f.sql}`);
        const elements = lignes.filter((r) => { const id = String(r.note_id), n = parNote.get(id) ?? 0; parNote.set(id, n + 1); return n < 2; }).slice(0, 12).flatMap((r) => {
            // Revalider la portée et l’existence : un indexeur concurrent peut avoir remplacé un passage.
            const actuel = lire.get(String(r.id), ...f.valeurs);
            return actuel ? [this.pointeur(actuel, true)] : [];
        });
        const resultat = sortieBornee(elements, budget);
        if (lignes.length >= 60 || elements.length < lignes.length)
            resultat.tronque = true;
        // Recalcule la taille après le marqueur de troncature (true est plus court que false).
        return sortieBorneeAvecTroncature(resultat);
    }
    pointeur(r, court) {
        const origine = typeof r.origine === "string" ? r.origine.startsWith("dossier:") ? `DIGITAL-OS/${r.origine.split(":").slice(2).join(":")}` : r.origine.startsWith("souvenir:") ? `souvenir:${r.origine.split(":").slice(2).join(":")}` : "document importé" : null;
        return { id: String(r.id), noteId: String(r.note_id), titre: String(r.titre), extrait: court ? String(r.texte).slice(0, 180) : String(r.texte), lignes: [Number(r.debut), Number(r.fin)], revision: Number(r.revision), agentId: r.agent_id, projetId: r.projet_id, origine, ...(origine && /(?:^|\/)90_ARCHIVES\//.test(origine) ? { historique: true } : {}) };
    }
    lire(ids, portee, budget) {
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || ids.some((id) => typeof id !== "string" || id.length > 200))
            throw new Error("Demandez de un à huit passages identifiés par la recherche.");
        const f = this.filtre(portee), elements = [];
        for (const id of new Set(ids)) {
            const r = this.db.prepare(`SELECT p.*,p.note_id,n.titre,n.revision,n.agent_id,n.projet_id,n.origine FROM passage p JOIN connaissance n ON n.id=p.note_id WHERE p.id=? AND ${f.sql}`).get(id, ...f.valeurs);
            if (r)
                elements.push(this.pointeur(r, false));
        }
        return sortieBornee(elements, budget);
    }
    fermer() { this.db.close(); }
}
function sortieBorneeAvecTroncature(r) {
    for (let i = 0; i < 8; i++) {
        const n = octets(JSON.stringify(r));
        if (n === r.octets && r.jetonsEstimes === Math.ceil(n / 3))
            break;
        r.octets = n;
        r.jetonsEstimes = Math.ceil(n / 3);
    }
    return r;
}
const ouverts = new Map();
export function ouvrirCerveau(donnees) {
    const dossier = path.join(donnees, "cerveau"), fichier = path.join(dossier, "connaissances.sqlite");
    const connu = ouverts.get(fichier);
    if (connu)
        return connu;
    let Sqlite;
    try {
        Sqlite = createRequire(path.join(process.cwd(), "cerveau-runtime.cjs"))("node:sqlite");
    }
    catch {
        throw new Error("Ce runtime ne fournit pas SQLite. Sous Node 22, démarrer le serveur avec --experimental-sqlite ; aucune installation n’a été effectuée.");
    }
    mkdirSync(dossier, { recursive: true, mode: 0o700 });
    const db = new Sqlite.DatabaseSync(fichier);
    try {
        const cerveau = new Cerveau(db);
        if (existsSync(fichier))
            chmodSync(fichier, 0o600);
        ouverts.set(fichier, cerveau);
        return cerveau;
    }
    catch (e) {
        db.close();
        throw e;
    }
}
