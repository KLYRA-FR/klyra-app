// Généré par scripts/serveur-genere.mjs depuis electron/cerveau-dossiers.ts : ne pas modifier à la main.
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { extraireContenu, natureDe, TAILLE_EXTRACTION_MAX, texteIndexable } from "./extraction-fichiers.mjs";
const SCHEMA = `CREATE TABLE IF NOT EXISTS dossier_source(
 id TEXT PRIMARY KEY,nom TEXT NOT NULL,racine TEXT NOT NULL,etat TEXT NOT NULL,scan TEXT,
 fichiers INTEGER NOT NULL DEFAULT 0,indexes INTEGER NOT NULL DEFAULT 0,inchanges INTEGER NOT NULL DEFAULT 0,
 reperes INTEGER NOT NULL DEFAULT 0,proteges INTEGER NOT NULL DEFAULT 0,techniques INTEGER NOT NULL DEFAULT 0,
 erreurs INTEGER NOT NULL DEFAULT 0,octets INTEGER NOT NULL DEFAULT 0,espaces TEXT NOT NULL DEFAULT '{}',
 debut TEXT,fin TEXT,message TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS dossier_fichier(
 source_id TEXT NOT NULL REFERENCES dossier_source(id),relatif TEXT NOT NULL,genre TEXT NOT NULL,
 etat TEXT NOT NULL,taille INTEGER NOT NULL,mtime REAL NOT NULL,note_id TEXT,scan TEXT NOT NULL,
 PRIMARY KEY(source_id,relatif));
CREATE INDEX IF NOT EXISTS dossier_fichier_note ON dossier_fichier(note_id);
CREATE INDEX IF NOT EXISTS dossier_fichier_scan ON dossier_fichier(source_id,scan);`;
const TECHNIQUES = new Set([".git", "node_modules", ".next", "dist", "build", "__pycache__", ".venv", "venv", "graphify-out"]);
const PROTEGES = new Set([".ssh", ".aws", ".gnupg", ".npmrc", ".pypirc", ".netrc", "credentials.json", ".credentials.json", "secrets.json", "token.json", "auth.json", "coffre.json"]);
const TEXTES = new Set(".md .markdown .txt .csv .json .jsonl .yaml .yml .toml .ini .rst .adoc .org .tex .html .htm .xml .svg .css .scss .sass .less .js .jsx .ts .tsx .mjs .cjs .py .sql .sh .bash .ps1 .bat .go .rs .java .c .cpp .h .hpp .cs .php .rb .vue .svelte .prisma .graphql .gql .log".split(" "));
const travaux = new WeakMap();
const initialiser = (c) => c.db.exec(SCHEMA);
const vide = () => ({ fichiers: 0, indexes: 0, inchanges: 0, reperes: 0, proteges: 0, techniques: 0, erreurs: 0, octets: 0, espaces: {} });
const cle = (s) => createHash("sha256").update(s).digest("hex");
/** Garde locale de signatures connues : on ne renvoie et ne journalise jamais la valeur détectée. */
function signatureConfidentielle(contenu) {
    return /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(contenu)
        || /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-|ant-[A-Za-z0-9-]*-)?[A-Za-z0-9_-]{28,}|AKIA[A-Z0-9]{16})\b/.test(contenu);
}
function restriction(relatif) {
    const morceaux = relatif.split("/"), nom = morceaux.at(-1).toLowerCase();
    if (morceaux.some((m) => PROTEGES.has(m.toLowerCase())) || /^\.env(?:\.|$)/i.test(nom) || /\.(pem|key|p12|pfx|kdbx)$/i.test(nom) || /^id_(rsa|ed25519)(?:\.|$)/.test(nom))
        return "protege";
    if (morceaux.some((m) => TECHNIQUES.has(m)) || relatif.startsWith(".claude/worktrees/") || relatif === ".claude/worktrees")
        return "technique";
    return null;
}
export function etatDossier(c) {
    initialiser(c);
    const r = c.db.prepare("SELECT * FROM dossier_source WHERE id='digital-os'").get();
    if (!r)
        return null;
    return { id: "digital-os", nom: String(r.nom), racine: String(r.racine), etat: String(r.etat), debut: r.debut, fin: r.fin, message: String(r.message), fichiers: Number(r.fichiers), indexes: Number(r.indexes), inchanges: Number(r.inchanges), reperes: Number(r.reperes), proteges: Number(r.proteges), techniques: Number(r.techniques), erreurs: Number(r.erreurs), octets: Number(r.octets), espaces: JSON.parse(String(r.espaces)) };
}
export async function connecterDigitalOs(c, racine) {
    initialiser(c);
    if (travaux.has(c))
        throw new Error("Arrêtez le scan en cours avant de changer la source.");
    const reel = await realpath(racine), stat = await lstat(reel);
    if (!stat.isDirectory())
        throw new Error("DIGITAL-OS doit être un dossier existant.");
    const avant = etatDossier(c);
    if (avant && avant.racine !== reel)
        throw new Error("Une autre racine DIGITAL-OS est déjà connectée dans cet espace. Elle n’a pas été remplacée.");
    c.db.prepare("INSERT OR IGNORE INTO dossier_source(id,nom,racine,etat) VALUES('digital-os','DIGITAL-OS',?,'pret')").run(reel);
    return etatDossier(c);
}
/** Ce navigateur ne lit que les métadonnées. Jamais un chemin absolu fourni par un agent. */
export async function parcourirDossier(c, relatif = "", offset = 0) {
    const source = etatDossier(c);
    if (!source)
        throw new Error("Connectez d’abord le dossier DIGITAL-OS.");
    const rel = typeof relatif === "string" ? relatif.replace(/\\/g, "/") : "";
    if (path.isAbsolute(rel) || rel.split("/").some((p) => p === "..") || rel.includes("\0") || restriction(rel))
        throw new Error("Ce dossier n’est pas accessible depuis cette source.");
    const cible = path.join(source.racine, rel), reel = await realpath(cible);
    if (reel !== source.racine && !reel.startsWith(source.racine + path.sep))
        throw new Error("Ce lien sort de la source DIGITAL-OS.");
    const tous = (await readdir(reel, { withFileTypes: true })).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const debut = typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
    const entrees = [];
    for (const e of tous.slice(debut, debut + 100)) {
        const id = rel ? `${rel}/${e.name}` : e.name;
        const r = c.db.prepare("SELECT etat,taille,note_id FROM dossier_fichier WHERE source_id='digital-os' AND relatif=?").get(id);
        entrees.push({ nom: e.name, relatif: id, genre: e.isSymbolicLink() ? "lien" : e.isDirectory() ? "dossier" : "fichier", etat: restriction(id) ?? (e.isSymbolicLink() ? "lien-non-suivi" : r ? String(r.etat) : "non-indexe"), noteId: r?.note_id ?? null, taille: Number(r?.taille ?? 0) });
    }
    return { relatif: rel, entrees, total: tous.length, suite: debut + entrees.length < tous.length ? debut + entrees.length : null };
}
function publierProgression(c, compteurs) {
    c.db.prepare("UPDATE dossier_source SET fichiers=?,indexes=?,inchanges=?,reperes=?,proteges=?,techniques=?,erreurs=?,octets=?,espaces=? WHERE id='digital-os'").run(compteurs.fichiers, compteurs.indexes, compteurs.inchanges, compteurs.reperes, compteurs.proteges, compteurs.techniques, compteurs.erreurs, compteurs.octets, JSON.stringify(compteurs.espaces));
}
/** Scan par lots, annulable. L'original reste l'autorité ; le contenu des agents n'est jamais préchargé. */
export async function scannerDossier(c, options = {}) {
    const source = etatDossier(c);
    if (!source)
        throw new Error("Connectez d’abord DIGITAL-OS.");
    const racine = await realpath(source.racine), scan = cle(`${Date.now()}-${Math.random()}`), compteurs = vide();
    const conserves = [], prefixe = "dossier:digital-os:";
    c.db.prepare("UPDATE dossier_source SET etat='indexation',scan=?,debut=?,fin=NULL,message='' WHERE id='digital-os'").run(scan, new Date().toISOString());
    publierProgression(c, compteurs);
    const sauver = (rel, genre, etat, taille, mtime, noteId = null) => c.db.prepare("INSERT INTO dossier_fichier VALUES('digital-os',?,?,?,?,?,?,?) ON CONFLICT(source_id,relatif) DO UPDATE SET genre=excluded.genre,etat=excluded.etat,taille=excluded.taille,mtime=excluded.mtime,note_id=excluded.note_id,scan=excluded.scan").run(rel, genre, etat, taille, mtime, noteId, scan);
    const garderRepere = (rel, etat, taille, mtime, raison = "") => {
        const origine = prefixe + rel;
        const avant = c.db.prepare("SELECT id FROM connaissance WHERE origine=?").get(origine);
        const id = avant ? String(avant.id) : `dos-${cle(origine).slice(0, 32)}`;
        const liens = avant ? c.db.prepare("SELECT b AS id FROM connexion WHERE a=? UNION SELECT a AS id FROM connexion WHERE b=?").all(id, id).map((r) => String(r.id)) : [];
        const long = `DIGITAL-OS · repère / ${rel}`;
        const titre = long.length <= 180 ? long : `${long.slice(0, 96)}…${long.slice(-80)}`;
        const contenu = `[Repère de fichier — contenu non extrait]\nChemin : DIGITAL-OS/${rel}\nÉtat : ${etat}. Taille du fichier : ${taille} octets.${raison ? `\n${raison}` : ""}\nCe repère confirme seulement la présence du fichier dans la source ; il ne permet aucune conclusion sur son contenu.`;
        const r = c.garder({ id, titre, contenu, projetId: null, liens, source: null, creeLe: "", modifieLe: "" }, { origine, agentId: "principal" });
        sauver(rel, "fichier", etat, taille, mtime, r.note.id);
        conserves.push(r.note.id);
        compteurs.reperes++;
    };
    async function visiter(rel) {
        if (options.arrete?.())
            return;
        let entrees;
        try {
            entrees = await readdir(path.join(racine, rel), { withFileTypes: true });
        }
        catch {
            compteurs.erreurs++;
            return;
        }
        for (const e of entrees) {
            if (options.arrete?.())
                return;
            const id = rel ? `${rel}/${e.name}` : e.name, fichier = path.join(racine, id);
            const interdit = restriction(id), genre = e.isDirectory() ? "dossier" : "fichier";
            if (interdit) {
                sauver(id, genre, interdit, 0, 0);
                if (interdit === "protege")
                    compteurs.proteges++;
                else
                    compteurs.techniques++;
                continue;
            }
            if (e.isSymbolicLink()) {
                sauver(id, "lien", "lien-non-suivi", 0, 0);
                compteurs.reperes++;
                continue;
            }
            if (e.isDirectory()) {
                sauver(id, "dossier", "catalogue", 0, 0);
                await visiter(id);
                continue;
            }
            if (!e.isFile())
                continue;
            compteurs.fichiers++;
            const espace = id.includes("/") ? id.split("/")[0] : "(racine)";
            compteurs.espaces[espace] = (compteurs.espaces[espace] ?? 0) + 1;
            try {
                const stat = await lstat(fichier);
                compteurs.octets += stat.size;
                if (stat.isSymbolicLink()) {
                    sauver(id, "lien", "lien-non-suivi", 0, 0);
                    compteurs.reperes++;
                    continue;
                }
                const avant = c.db.prepare("SELECT * FROM dossier_fichier WHERE source_id='digital-os' AND relatif=?").get(id);
                const texte = TEXTES.has(path.extname(e.name).toLowerCase()) || /^(README|LICENSE|MAKEFILE|DOCKERFILE)$/i.test(e.name);
                const nature = texte ? null : natureDe(e.name);
                const limite = nature ? TAILLE_EXTRACTION_MAX : 2_000_000;
                if ((!texte && !nature) || stat.size > limite) {
                    garderRepere(id, stat.size > limite ? "volume-non-indexe" : "repere-seul", stat.size, stat.mtimeMs);
                    continue;
                }
                if (!options.forcer && avant?.etat === "indexe" && Number(avant.mtime) === stat.mtimeMs && Number(avant.taille) === stat.size && typeof avant.note_id === "string") {
                    const note = c.db.prepare("SELECT id FROM connaissance WHERE id=? AND obsolete=0").get(avant.note_id);
                    if (note) {
                        sauver(id, "fichier", "indexe", stat.size, stat.mtimeMs, avant.note_id);
                        conserves.push(avant.note_id);
                        compteurs.inchanges++;
                        continue;
                    }
                }
                const reel = await realpath(fichier);
                if (!reel.startsWith(racine + path.sep))
                    throw new Error("Hors source");
                // PDF, image, son : leur texte lisible ; sans texte (scanné, protégé, sans étiquette), un repère qui dit pourquoi.
                const extrait = nature ? extraireContenu(e.name, await readFile(reel)) : null;
                if (nature && !extrait?.texte) {
                    garderRepere(id, "repere-seul", stat.size, stat.mtimeMs, extrait?.note ?? "");
                    continue;
                }
                const contenu = extrait ? texteIndexable(e.name, extrait) : await readFile(reel, "utf8");
                if (signatureConfidentielle(contenu)) {
                    sauver(id, "fichier", "protege", stat.size, stat.mtimeMs);
                    compteurs.proteges++;
                    continue;
                }
                if (!contenu.trim() || contenu.includes("\0")) {
                    garderRepere(id, "repere-seul", stat.size, stat.mtimeMs);
                    continue;
                }
                const origine = prefixe + id;
                const existante = c.db.prepare("SELECT id FROM connaissance WHERE origine=?").get(origine);
                const noteId = existante ? String(existante.id) : `dos-${cle(origine).slice(0, 32)}`;
                const liens = existante ? c.db.prepare("SELECT b AS id FROM connexion WHERE a=? UNION SELECT a AS id FROM connexion WHERE b=?").all(noteId, noteId).map((r) => String(r.id)) : [];
                const titreLong = `DIGITAL-OS / ${id}`, titre = titreLong.length <= 180 ? titreLong : `${titreLong.slice(0, 96)}…${titreLong.slice(-80)}`;
                const r = c.garder({ id: noteId, titre, contenu, projetId: null, liens, source: null, creeLe: "", modifieLe: "" }, { origine, agentId: "principal" });
                sauver(id, "fichier", "indexe", stat.size, stat.mtimeMs, r.note.id);
                conserves.push(r.note.id);
                if (r.inchange)
                    compteurs.inchanges++;
                else
                    compteurs.indexes++;
            }
            catch {
                sauver(id, "fichier", "erreur", 0, 0);
                compteurs.erreurs++;
            }
            finally {
                if (compteurs.fichiers % 25 === 0) {
                    publierProgression(c, compteurs);
                    await new Promise((r) => setImmediate(r));
                }
            }
        }
    }
    try {
        await visiter("");
        publierProgression(c, compteurs);
        const interrompu = options.arrete?.() === true;
        if (!interrompu && compteurs.erreurs === 0) {
            c.actualiserSources(prefixe, conserves, true);
            c.db.prepare("UPDATE dossier_fichier SET etat='disparu' WHERE source_id='digital-os' AND scan<>?").run(scan);
        }
        c.db.prepare("UPDATE dossier_source SET etat=?,fin=?,message=? WHERE id='digital-os'").run(interrompu ? "interrompu" : compteurs.erreurs ? "partiel" : "termine", new Date().toISOString(), interrompu ? "Scan interrompu ; une nouvelle indexation peut le reprendre." : compteurs.erreurs ? "Certaines sources n’ont pas été lues. Les données précédentes restent conservées." : "Catalogue complet dans le périmètre annoncé ; les pièces non textuelles sont repérées, pas extraites.");
    }
    catch (e) {
        c.db.prepare("UPDATE dossier_source SET etat='erreur',message=? WHERE id='digital-os'").run(e instanceof Error ? e.message : "Scan impossible.");
        throw e;
    }
}
export function lancerScan(c, forcer) {
    if (travaux.has(c))
        return etatDossier(c);
    const source = etatDossier(c);
    if (!source)
        throw new Error("Connectez d’abord DIGITAL-OS.");
    const travail = { arret: false, promesse: Promise.resolve() };
    travaux.set(c, travail);
    c.db.prepare("UPDATE dossier_source SET etat='indexation' WHERE id='digital-os'").run();
    travail.promesse = scannerDossier(c, { forcer, arrete: () => travail.arret }).catch(() => { }).finally(() => travaux.delete(c));
    return etatDossier(c);
}
export function actionDossier(c, action, args) {
    if (action === "digital-os-etat") {
        const source = etatDossier(c);
        if (source?.etat === "indexation" && !travaux.has(c)) {
            c.db.prepare("UPDATE dossier_source SET etat='interrompu',message='Le processus précédent a été arrêté ; relancez le scan.' WHERE id='digital-os'").run();
            return etatDossier(c);
        }
        return source;
    }
    if (action === "digital-os-demarrer")
        return lancerScan(c, args.forcer === true);
    if (action === "digital-os-arreter") {
        const t = travaux.get(c);
        if (t)
            t.arret = true;
        return etatDossier(c);
    }
    if (action === "digital-os-parcourir")
        return parcourirDossier(c, args.relatif, args.offset);
    throw new Error("Action de dossier inconnue.");
}
