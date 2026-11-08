// Généré par scripts/serveur-genere.mjs depuis electron/cerveau-service.ts : ne pas modifier à la main.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { ouvrirCerveau, sauvegarderCerveau } from "./cerveau.mjs";
import { cheminSouvenir, lireMemoire } from "./connaissances-agent.mjs";
import { actionDossier } from "./cerveau-dossiers.mjs";
import { chercherContenu, lireSouvenirsGraphe } from "./graphe-souvenirs.mjs";
import { accepterLien, alleger, annuler, archiver, fusionner, indexMemoires, refuserLien, resumeEntretien } from "./graphe-entretien.mjs";
import os from "node:os";
export const PROPRIETAIRE = { agentId: null, projetId: null, proprietaire: true };
/** Textes expressément choisis dans la boîte de fichiers du poste. Aucune ouverture d'un chemin reçu par HTTP. */
export function importerDocuments(cerveau, documents, projetId) {
    if (!Array.isArray(documents) || documents.length > 20)
        throw new Error("Importez au plus vingt documents à la fois.");
    let indexes = 0, inchanges = 0;
    for (const d of documents) {
        if (!d || typeof d.titre !== "string" || !/\.(md|markdown|txt|csv|json|log|pdf|png|jpe?g|gif|webp|mp3|flac|ogg|opus|wav)$/i.test(d.titre) || typeof d.contenu !== "string" || d.contenu.includes("\0") || typeof d.reference !== "string" || d.reference.length > 1024)
            throw new Error("Un import doit être un document identifié (Markdown, texte, CSV, JSON, journal, PDF, image ou son), dont le texte a été lu par l'ordinateur qui l'importe.");
        const origine = `document:${createHash("sha256").update(JSON.stringify([d.reference, projetId])).digest("hex")}`;
        const avant = cerveau.db.prepare("SELECT id FROM connaissance WHERE origine=?").get(origine);
        const liens = avant ? cerveau.note(String(avant.id), PROPRIETAIRE).liens : [];
        const r = cerveau.garder({ id: `doc-${origine.slice(9)}`, titre: d.titre.slice(0, 180), contenu: d.contenu, projetId, liens, source: null, creeLe: "", modifieLe: "" }, { origine, agentId: null });
        if (r.inchange)
            inchanges++;
        else
            indexes++;
    }
    return { indexes, inchanges };
}
/** Lecture ciblée du dossier déjà résolu par la mémoire existante ; aucun chemin fourni par le renderer. */
export async function indexerSouvenirs(cerveau, agent, memoire, projetId) {
    if (!memoire || !existsSync(memoire.dossier))
        return { indexes: 0, inchanges: 0, coupee: false, avertissements: ["Cette mémoire est vide ou n’existe pas encore."] };
    const base = realpathSync(memoire.dossier), inventaire = lireMemoire(memoire.portee, base, { limite: 20_000 });
    const prefixe = `souvenir:${createHash("sha256").update(JSON.stringify([base, agent, projetId])).digest("hex")}:`;
    let indexes = 0, inchanges = 0;
    const conserves = [], avertissements = [];
    for (const s of inventaire.souvenirs) {
        if ((indexes + inchanges) % 25 === 0)
            await new Promise((r) => setImmediate(r));
        if (s.toujours)
            continue; // L'index MEMORY.md est un sommaire, pas une copie de tout le corpus.
        try {
            const fichier = realpathSync(cheminSouvenir(base, s.id));
            if (!fichier.startsWith(base + path.sep) || statSync(fichier).size > 2_000_000)
                throw new Error("Source hors du dossier résolu ou supérieure à 2 Mo.");
            const origine = prefixe + s.id, contenu = readFileSync(fichier, "utf8");
            if (!contenu.trim())
                continue;
            const avant = cerveau.db.prepare("SELECT id FROM connaissance WHERE origine=?").get(origine);
            let liens = [];
            if (avant)
                liens = cerveau.db.prepare("SELECT b AS id FROM connexion WHERE a=? UNION SELECT a AS id FROM connexion WHERE b=?").all(avant.id, avant.id).map((r) => String(r.id));
            const note = { id: `souvenir-${createHash("sha256").update(origine).digest("hex")}`, titre: s.titre.slice(0, 180), contenu, projetId, liens, source: null, creeLe: "", modifieLe: "" };
            const r = cerveau.garder(note, { origine, agentId: agent });
            conserves.push(r.note.id);
            if (r.inchange)
                inchanges++;
            else
                indexes++;
        }
        catch {
            avertissements.push(`${s.id} : non indexé (source inaccessible, invalide ou trop volumineuse).`);
        }
    }
    cerveau.actualiserSources(prefixe, conserves, !inventaire.coupee && avertissements.length === 0);
    return { indexes, inchanges, coupee: inventaire.coupee, avertissements };
}
export function actionCerveau(donnees, action, args) {
    if (action === "graphe-souvenirs")
        return lireSouvenirsGraphe(racinesGraphe(donnees, args.projets));
    if (action.startsWith("graphe-entretien"))
        return entretien(donnees, action, args);
    if (action === "graphe-chercher")
        return chercherContenu(racinesGraphe(donnees, args.projets), args.requete, fichiersPublies(donnees, args.fichiers));
    const c = ouvrirCerveau(donnees);
    if (["digital-os-etat", "digital-os-demarrer", "digital-os-arreter", "digital-os-parcourir"].includes(action))
        return actionDossier(c, action, args);
    const projetId = typeof args.projetId === "string" ? args.projetId : null;
    const portee = typeof args.apercuAgent === "string" && args.apercuAgent ? { agentId: args.apercuAgent, projetId } : { ...PROPRIETAIRE, projetId };
    switch (action) {
        case "importer-documents": return importerDocuments(c, args.documents, typeof args.projetId === "string" ? args.projetId : null);
        case "lister": return c.lister(PROPRIETAIRE, args);
        case "note": return c.note(args.id, PROPRIETAIRE);
        case "garder": return c.garder(args.note).note;
        case "oublier":
            c.oublier(args.id, args.revision);
            return { oublie: true };
        case "chercher": return c.chercher(args.requete, portee, args.budgetOctets);
        case "lire": return c.lire(args.ids, portee, args.budgetOctets);
        case "sauvegarder": {
            const dest = typeof args.destination === "string" ? args.destination : path.join(donnees, "cerveau", "sauvegardes", `memoire-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
            return { fichier: sauvegarderCerveau(c, dest) };
        }
        default: throw new Error("Action de mémoire inconnue.");
    }
}
/** Où lire les souvenirs de chaque agent : la configuration de Claude Code, les dossiers préparés, les ateliers et les projets. */
function racinesGraphe(donnees, projets) {
    const home = os.homedir();
    const liste = Array.isArray(projets) ? projets.filter((p) => !!p && typeof p.id === "string" && typeof p.dossier === "string").slice(0, 500) : [];
    return { donnees, home, configClaude: process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), projets: liste };
}
/** Fichiers publiés connus : ceux que l'écran donne (copies de ce PC) et le registre du serveur (`rendus.json`). */
function fichiersPublies(donnees, fichiers) {
    const liste = Array.isArray(fichiers) ? fichiers.filter((f) => typeof f === "string") : [];
    try {
        const registre = JSON.parse(readFileSync(path.join(donnees, "rendus.json"), "utf8"));
        if (Array.isArray(registre))
            for (const r of registre)
                if (r && typeof r.chemin === "string" && !r.dossier)
                    liste.push(r.chemin);
    }
    catch { /* pas de registre sur ce poste */ }
    return liste;
}
/** Entretien du graphe : chaque écriture vient d'un clic confirmé à l'écran (cf. graphe-entretien.ts). */
function entretien(donnees, action, args) {
    const r = racinesGraphe(donnees, args.projets);
    switch (action) {
        case "graphe-entretien": return { ...resumeEntretien(donnees), memoires: indexMemoires(r) };
        case "graphe-entretien-refuser":
            refuserLien(donnees, args.cle);
            break;
        case "graphe-entretien-lien":
            accepterLien(r, donnees, args);
            break;
        case "graphe-entretien-archiver":
            archiver(r, donnees, args);
            break;
        case "graphe-entretien-fusionner":
            fusionner(r, donnees, args);
            break;
        case "graphe-entretien-annuler":
            annuler(donnees, args.id);
            break;
        case "graphe-entretien-alleger":
            alleger(r, donnees, args);
            break;
        default: throw new Error("Action de mémoire inconnue.");
    }
    return { ...resumeEntretien(donnees), memoires: indexMemoires(r) };
}
