// Généré par scripts/serveur-genere.mjs depuis electron/cerveau-synchro.ts : ne pas modifier à la main.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
const PAGE = 400;
export function hashSynchro(n) {
    return createHash("sha256").update(JSON.stringify([n.titre.trim(), n.contenu, n.projetId ?? null, n.source ?? null, [...n.liens].sort()])).digest("hex");
}
function manuelles(c) {
    return new Set(c.db.prepare("SELECT id FROM connaissance WHERE origine IS NULL AND agent_id IS NULL").all().map((r) => String(r.id)));
}
function noteSynchro(c, r, ids) {
    const id = String(r.id);
    const liens = c.db.prepare("SELECT b AS id FROM connexion WHERE a=? UNION SELECT a AS id FROM connexion WHERE b=?").all(id, id).map((x) => String(x.id)).filter((l) => ids.has(l)).sort();
    const base = { id, titre: String(r.titre), contenu: String(r.contenu), projetId: r.projet_id ?? null, source: r.source ? JSON.parse(String(r.source)) : null, liens };
    return { ...base, hash: hashSynchro(base), modifieLe: String(r.modifie_le) };
}
/** L'empreinte actuelle d'une note écrite à la main ici, ou null si elle n'y est pas. */
export function hashLocal(c, id, ids = manuelles(c)) {
    const r = c.db.prepare("SELECT * FROM connaissance WHERE id=? AND origine IS NULL AND agent_id IS NULL").get(id);
    return r ? noteSynchro(c, r, ids).hash : null;
}
/** Ce qui a changé ici depuis `depuis` (horloge de cette machine), par pages de 400 notes. */
export function exporterNotes(c, depuis, apres = null) {
    const maintenant = new Date().toISOString();
    const d = typeof depuis === "string" ? depuis : "", a = typeof apres === "string" ? apres : "";
    const ids = manuelles(c);
    const lignes = c.db.prepare("SELECT * FROM connaissance WHERE origine IS NULL AND agent_id IS NULL AND modifie_le>=? AND (modifie_le || '|' || id)>? ORDER BY modifie_le,id LIMIT ?").all(d, a, PAGE + 1);
    const page = lignes.slice(0, PAGE);
    const effacees = a ? [] : c.db.prepare("SELECT id, le FROM note_effacee WHERE le>=? ORDER BY le LIMIT 5000").all(d).map((r) => ({ id: String(r.id), le: String(r.le) }));
    const derniere = page[page.length - 1];
    return { maintenant, notes: page.map((r) => noteSynchro(c, r, ids)), effacees, suite: lignes.length > PAGE && derniere ? `${derniere.modifie_le}|${derniere.id}` : null };
}
/** Écrit une note venue d'un autre appareil sous son identifiant (liens posés ensuite, quand toutes existent). */
function ecrireNote(c, n, avecLiens) {
    const avant = c.db.prepare("SELECT revision, origine, agent_id FROM connaissance WHERE id=?").get(n.id);
    if (avant && (avant.origine !== null || avant.agent_id !== null))
        throw new Error("Identifiant déjà pris par une source indexée.");
    const existants = avecLiens ? n.liens.filter((l) => c.db.prepare("SELECT id FROM connaissance WHERE id=?").get(l)) : [];
    c.garder({ id: n.id, titre: n.titre, contenu: n.contenu, projetId: n.projetId, source: n.source, liens: existants, liensAuto: [], revision: avant ? Number(avant.revision) : undefined, creeLe: "", modifieLe: "" });
    c.db.prepare("DELETE FROM note_effacee WHERE id=?").run(n.id);
}
function effacerNote(c, id) {
    const r = c.db.prepare("SELECT revision FROM connaissance WHERE id=? AND origine IS NULL AND agent_id IS NULL").get(id);
    if (r)
        c.oublier(id, Number(r.revision));
}
function valide(n) {
    const x = n;
    return !!x && typeof x.id === "string" && /^[a-zA-Z0-9_.:@-]{1,160}$/.test(x.id) && typeof x.titre === "string" && typeof x.contenu === "string"
        && (x.projetId === null || typeof x.projetId === "string") && Array.isArray(x.liens) && x.liens.every((l) => typeof l === "string");
}
/**
 * Applique ce qu'un autre appareil envoie. Chaque écriture porte l'empreinte qu'elle s'attend à trouver ici
 * (null : absente) ; sinon elle est refusée et l'appareil la renverra. Les liens sont posés en second passage.
 */
export function appliquerSynchro(c, ops) {
    const o = (ops ?? {});
    const ecrire = Array.isArray(o.ecrire) ? o.ecrire.filter(valide).slice(0, 2000) : [];
    const effacer = Array.isArray(o.effacer) ? o.effacer.filter((e) => e && typeof e.id === "string").slice(0, 5000) : [];
    const refuses = [];
    let appliques = 0;
    const ids = manuelles(c);
    const gardes = [];
    for (const n of ecrire) {
        const attendu = n.attendu ?? null;
        if (hashLocal(c, n.id, ids) !== attendu) {
            refuses.push(n.id);
            continue;
        }
        try {
            ecrireNote(c, { ...n, hash: hashSynchro(n) }, false);
            gardes.push(n);
            appliques++;
        }
        catch {
            refuses.push(n.id);
        }
    }
    for (const n of gardes) {
        try {
            ecrireNote(c, n, true);
        }
        catch { /* lien vers une note absente : posé au tour suivant */ }
    }
    const apres = manuelles(c);
    for (const e of effacer) {
        if (hashLocal(c, e.id, apres) !== (e.attendu ?? null)) {
            refuses.push(e.id);
            continue;
        }
        try {
            effacerNote(c, e.id);
            appliques++;
        }
        catch {
            refuses.push(e.id);
        }
    }
    return { refuses, appliques };
}
const FICHIER = "cerveau-synchro.json";
export const ETAT_VIDE = { actif: false, marqueLocale: null, marqueDistante: null, base: {}, aRenvoyer: [], dernier: null };
export function lireEtatsSynchro(donnees) {
    try {
        const v = JSON.parse(readFileSync(path.join(donnees, FICHIER), "utf8"));
        return v && typeof v === "object" ? v : {};
    }
    catch {
        return {};
    }
}
export function ecrireEtatSynchro(donnees, lieu, etat) {
    const tous = lireEtatsSynchro(donnees);
    tous[lieu] = etat;
    mkdirSync(donnees, { recursive: true });
    const fichier = path.join(donnees, FICHIER), tmp = `${fichier}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(tous), { mode: 0o600 });
    renameSync(tmp, fichier);
}
async function toutExporter(source, depuis) {
    const notes = [];
    let effacees = [], maintenant = "", apres = null;
    for (let tour = 0; tour < 200; tour++) {
        const p = await source(depuis, apres);
        if (!maintenant) {
            maintenant = p.maintenant;
            effacees = p.effacees;
        }
        notes.push(...p.notes);
        if (!p.suite)
            break;
        apres = p.suite;
    }
    return { maintenant, notes, effacees };
}
const LOT_OCTETS = 3_500_000;
function lots(ecrire, effacer) {
    const out = [];
    let courant = { ecrire: [], effacer: [] }, taille = 0;
    for (const n of ecrire) {
        const poids = Buffer.byteLength(JSON.stringify(n), "utf8");
        if (taille + poids > LOT_OCTETS && courant.ecrire.length) {
            out.push(courant);
            courant = { ecrire: [], effacer: [] };
            taille = 0;
        }
        courant.ecrire.push(n);
        taille += poids;
    }
    courant.effacer = effacer;
    if (courant.ecrire.length || courant.effacer.length)
        out.push(courant);
    return out;
}
const idConflit = (id, hash) => `${id.slice(0, 140)}.serveur-${hash.slice(0, 8)}`;
/**
 * Un tour d'échange entre ce PC (`c`) et un serveur (`appeler` : ses actions `synchro-exporter` et
 * `synchro-appliquer`). Rend l'état à garder pour ce serveur.
 */
export async function synchroniser(c, appeler, avant, nomServeur = "serveur") {
    const etat = { ...ETAT_VIDE, ...avant, base: { ...avant.base }, aRenvoyer: [...(avant.aRenvoyer ?? [])] };
    const distant = await toutExporter(async (d, a) => (await appeler("synchro-exporter", { depuis: d, apres: a })), etat.marqueDistante);
    const debutLocal = new Date().toISOString();
    const local = await toutExporter((d, a) => exporterNotes(c, d, a), etat.marqueLocale);
    const ids = manuelles(c);
    // Ce qui a vraiment changé : une empreinte différente de celle du dernier accord.
    const R = new Map(), L = new Map();
    for (const n of distant.notes)
        if (etat.base[n.id] !== n.hash)
            R.set(n.id, n);
    for (const e of distant.effacees)
        if (etat.base[e.id] !== undefined && !R.has(e.id))
            R.set(e.id, null);
    for (const n of local.notes)
        if (etat.base[n.id] !== n.hash)
            L.set(n.id, n);
    for (const e of local.effacees)
        if (etat.base[e.id] !== undefined && !L.has(e.id) && hashLocal(c, e.id, ids) === null)
            L.set(e.id, null);
    for (const id of etat.aRenvoyer)
        if (!L.has(id)) {
            const r = c.db.prepare("SELECT * FROM connaissance WHERE id=? AND origine IS NULL AND agent_id IS NULL").get(id);
            L.set(id, r ? noteSynchro(c, r, ids) : null);
        }
    const ecrireLa = [], effacerLa = [];
    const recuesIci = [], effaceesIci = [];
    let conflits = 0;
    // Empreinte côté serveur que chaque envoi s'attend à trouver.
    const laBas = (id) => (R.has(id) ? R.get(id)?.hash ?? null : etat.base[id] ?? null);
    for (const [id, r] of R) {
        const l = L.get(id);
        if (!L.has(id)) {
            if (r)
                recuesIci.push(r);
            else
                effaceesIci.push(id);
            continue;
        }
        if (r && l && r.hash === l.hash) {
            etat.base[id] = r.hash;
            L.delete(id);
            continue;
        }
        if (!r && !l) {
            delete etat.base[id];
            L.delete(id);
            continue;
        }
        if (r && !l) {
            recuesIci.push(r);
            L.delete(id);
            continue;
        } // oubliée ici, modifiée là-bas : on la garde.
        if (r && l) {
            // Modifiée des deux côtés : la version du serveur reste ici en copie, et part aussi là-bas.
            conflits++;
            const copie = { ...r, id: idConflit(id, r.hash), titre: `${r.titre.slice(0, 150)} (version ${nomServeur})`.slice(0, 180), liens: [] };
            recuesIci.push({ ...copie, hash: hashSynchro(copie) });
            ecrireLa.push({ ...copie, hash: hashSynchro(copie), attendu: null });
        }
        // Oubliée là-bas, modifiée ici (ou conflit) : la version d'ici repart.
    }
    for (const [id, l] of L) {
        if (l)
            ecrireLa.push({ ...l, attendu: laBas(id) });
        else
            effacerLa.push({ id, attendu: laBas(id) });
    }
    // Ici d'abord (aucune perte possible), puis là-bas.
    const appliquesIci = appliquerSynchro(c, {
        ecrire: recuesIci.map((n) => ({ ...n, attendu: hashLocal(c, n.id, ids) })),
        effacer: effaceesIci.filter((id) => hashLocal(c, id, ids) === (etat.base[id] ?? null)).map((id) => ({ id, attendu: hashLocal(c, id, ids) })),
    });
    for (const n of recuesIci)
        if (!appliquesIci.refuses.includes(n.id))
            etat.base[n.id] = n.hash;
    for (const id of effaceesIci)
        if (hashLocal(c, id) === null)
            delete etat.base[id];
    // Par lots (la route du serveur lit 5 Mo au plus) ; les copies de conflit partent avant les liens qui les visent.
    const refuses = new Set();
    for (const lot of lots(ecrireLa, effacerLa)) {
        const reponse = (await appeler("synchro-appliquer", { ecrire: lot.ecrire, effacer: lot.effacer }));
        for (const x of Array.isArray(reponse.refuses) ? reponse.refuses : [])
            if (typeof x === "string")
                refuses.add(x);
    }
    for (const n of ecrireLa)
        if (!refuses.has(n.id))
            etat.base[n.id] = n.hash;
    for (const e of effacerLa)
        if (!refuses.has(e.id))
            delete etat.base[e.id];
    etat.aRenvoyer = [...refuses];
    etat.marqueLocale = debutLocal;
    etat.marqueDistante = distant.maintenant || etat.marqueDistante;
    etat.dernier = { le: new Date().toISOString(), envoyees: ecrireLa.length + effacerLa.length - refuses.size, recues: recuesIci.length + effaceesIci.length - appliquesIci.refuses.length, conflits, erreur: null };
    return etat;
}
/** Les actions que le serveur sert (même module) : export et application, rien d'autre. */
export function actionSynchro(c, action, args) {
    if (action === "synchro-exporter")
        return exporterNotes(c, args.depuis ?? null, args.apres ?? null);
    if (action === "synchro-appliquer")
        return appliquerSynchro(c, args);
    throw new Error("Action de synchronisation inconnue.");
}
