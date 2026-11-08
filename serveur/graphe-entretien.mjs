// Généré par scripts/serveur-genere.mjs depuis electron/graphe-entretien.ts : ne pas modifier à la main.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dossiersSouvenirs, lireSouvenirsGraphe } from "./graphe-souvenirs.mjs";
const FICHIER = "graphe-entretien.json";
const GARDES = 200;
const empreinte = (s) => createHash("sha256").update(s).digest("hex");
export function lireEntretien(donnees) {
    try {
        const v = JSON.parse(readFileSync(path.join(donnees, FICHIER), "utf8"));
        return { refuses: Array.isArray(v.refuses) ? v.refuses.filter((x) => typeof x === "string") : [], operations: Array.isArray(v.operations) ? v.operations : [] };
    }
    catch {
        return { refuses: [], operations: [] };
    }
}
function ecrireEntretien(donnees, e) {
    mkdirSync(donnees, { recursive: true });
    const fichier = path.join(donnees, FICHIER), tmp = `${fichier}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ refuses: e.refuses.slice(-2000), operations: e.operations.slice(-GARDES) }), { mode: 0o600 });
    renameSync(tmp, fichier);
}
function noter(donnees, op) {
    const e = lireEntretien(donnees), complete = { ...op, id: randomUUID(), le: new Date().toISOString(), annuleLe: null };
    e.operations.push(complete);
    ecrireEntretien(donnees, e);
    return complete;
}
/** Un lien suggéré refusé ne revient plus (clé `a|b`, triée). */
export function refuserLien(donnees, cle) {
    if (typeof cle !== "string" || cle.length > 400 || !cle.includes("|"))
        throw new Error("Lien invalide.");
    const e = lireEntretien(donnees);
    if (!e.refuses.includes(cle))
        e.refuses.push(cle);
    ecrireEntretien(donnees, e);
    return e;
}
/** Le souvenir demandé, relu maintenant ; refusé s'il a changé depuis l'affichage (`attendu` = sa date). */
function souvenirInchange(r, id, attendu) {
    const s = lireSouvenirsGraphe(r).souvenirs.find((x) => x.id === id);
    if (!s)
        throw new Error("Ce souvenir n'existe plus à cet endroit.");
    if (s.date !== attendu)
        throw new Error(`« ${s.nom} » a changé depuis l'affichage : relis le graphe avant d'agir.`);
    return s;
}
function lire(chemin) {
    return readFileSync(chemin, "utf8");
}
function ecrire(chemin, texte) {
    const tmp = `${chemin}.${process.pid}.tmp`;
    writeFileSync(tmp, texte, { mode: statSync(chemin).mode & 0o777 });
    renameSync(tmp, chemin);
}
/** Ajoute `[[cible]]` à la ligne « Voir aussi » de la fin du fichier (créée au besoin). */
export function avecLien(texte, cible) {
    if (texte.includes(`[[${cible}]]`))
        return texte;
    const lignes = texte.replace(/\s+$/, "").split("\n");
    const derniere = lignes[lignes.length - 1] ?? "";
    if (/^Voir aussi\s*:/.test(derniere))
        lignes[lignes.length - 1] = `${derniere}, [[${cible}]]`;
    else
        lignes.push("", `Voir aussi : [[${cible}]]`);
    return `${lignes.join("\n")}\n`;
}
/** Écrit un lien accepté dans le souvenir `de` (vers le souvenir `vers`). */
export function accepterLien(r, donnees, a) {
    const de = souvenirInchange(r, a.de, a.attenduDe);
    const vers = lireSouvenirsGraphe(r).souvenirs.find((x) => x.id === a.vers);
    if (!vers)
        throw new Error("Le souvenir cible n'existe plus.");
    const avant = lire(de.chemin), apres = avecLien(avant, vers.nom);
    if (apres !== avant)
        ecrire(de.chemin, apres);
    return noter(donnees, { type: "lien", libelle: `Lien « ${de.nom} » → « ${vers.nom} »`, ecrits: [{ chemin: de.chemin, avant, apres: empreinte(apres) }], deplaces: [] });
}
/** Retire de MEMORY.md (à côté du souvenir) les lignes qui pointent vers ce fichier. */
function sansLigneIndex(chemin) {
    const index = path.join(path.dirname(chemin), "MEMORY.md");
    if (!existsSync(index))
        return null;
    const avant = lire(index), nom = path.basename(chemin);
    const apres = avant.split("\n").filter((l) => !l.includes(`(${nom})`) && !l.includes(`(./${nom})`)).join("\n");
    return apres === avant ? null : { chemin: index, avant, apres };
}
function archiverFichier(chemin) {
    const dossier = path.join(path.dirname(chemin), "archive"), vers = path.join(dossier, path.basename(chemin));
    if (existsSync(vers))
        throw new Error(`Un fichier du même nom est déjà archivé : ${vers}`);
    const index = sansLigneIndex(chemin);
    mkdirSync(dossier, { recursive: true });
    renameSync(chemin, vers);
    if (index)
        ecrire(index.chemin, index.apres);
    return { deplace: { de: chemin, vers }, index };
}
/** Déplace le souvenir dans `archive/` (lu par personne, plus chargé par l'agent) et retire sa ligne de MEMORY.md. */
export function archiver(r, donnees, a) {
    const s = souvenirInchange(r, a.id, a.attendu);
    const { deplace, index } = archiverFichier(s.chemin);
    return noter(donnees, { type: "archive", libelle: `Archivé : « ${s.nom} »`, ecrits: index ? [{ ...index, apres: empreinte(index.apres) }] : [], deplaces: [deplace] });
}
/** Le corps d'un souvenir, sans son en-tête. */
function corpsDe(texte) {
    return texte.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}
/** Note `remplace: <nom>` dans le bloc `metadata` de l'en-tête (s'il existe), sans toucher au reste. */
export function avecRemplace(texte, nom) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texte);
    if (!m || /^\s+remplace\s*:/m.test(m[1]))
        return texte;
    const entete = /^metadata:\s*$/m.test(m[1]) ? m[1].replace(/^metadata:\s*$/m, `metadata:\n  remplace: ${nom}`) : `${m[1]}\nmetadata:\n  remplace: ${nom}`;
    return texte.replace(m[1], entete);
}
/** Garde `garder`, y ajoute le corps de `retirer` sous un titre, puis archive `retirer`. Rien n'est réécrit autrement. */
export function fusionner(r, donnees, a) {
    const garder = souvenirInchange(r, a.garder, a.attenduGarder), retirer = souvenirInchange(r, a.retirer, a.attenduRetirer);
    if (garder.id === retirer.id)
        throw new Error("Choisis deux souvenirs différents.");
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
    }
    catch (e) {
        ecrire(garder.chemin, avant);
        throw e;
    }
}
/* ─── MEMORY.md allégé ─────────────────────────────────────────────────── */
/** Tête d'un MEMORY.md allégé : lue à chaque appel, elle dit à l'agent où sont les autres souvenirs. */
export const MARQUEUR_ALLEGE = "> Index allégé par KLYRA : les autres souvenirs restent dans ce dossier. Pour les retrouver, appelle l’outil memoire_graphe (sans argument : ta liste ; souvenir : son texte et ses liens ; requete : une recherche).";
/** En dessous (lignes retirées, octets gagnés), on ne propose pas d'alléger : le gain ne vaut pas le changement. */
export const LIGNES_RETIREES_MIN = 4;
export const OCTETS_GAGNES_MIN = 500;
const GARDEES_MAX = 25;
/** Types de souvenirs dont la ligne reste dans l'index : la façon de travailler de la personne et ses retours. */
const TYPES_GARDES = new Set(["user", "feedback"]);
/**
 * Le MEMORY.md allégé : les lignes qui pointent vers un souvenir de type `project` ou `reference` partent
 * (le souvenir reste dans son fichier, `memoire_graphe` le retrouve) ; celles de `user` et `feedback`, d'un type
 * inconnu ou vers un fichier absent restent (25 au plus), comme le texte libre. Un titre resté vide part.
 */
export function memoireAllegee(texte, types) {
    const lignes = texte.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() !== MARQUEUR_ALLEGE);
    let gardees = 0, retirees = 0;
    const restent = [];
    for (const l of lignes) {
        const m = /\]\((?:\.\/)?([^)\s]+\.md)\)/.exec(l);
        const fichier = m ? path.basename(m[1]) : null;
        if (!fichier || !types.has(fichier)) {
            restent.push(l);
            continue;
        }
        const type = types.get(fichier) ?? null;
        if ((type === null || TYPES_GARDES.has(type)) && gardees < GARDEES_MAX) {
            restent.push(l);
            gardees++;
        }
        else
            retirees++;
    }
    // Un titre suivi d'un autre titre (ou de rien) n'annonce plus rien.
    const propres = [];
    for (let i = 0; i < restent.length; i++) {
        if (/^#{2,6}\s/.test(restent[i])) {
            const suite = restent.slice(i + 1).find((x) => x.trim() !== "");
            if (suite === undefined || /^#{1,6}\s/.test(suite))
                continue;
        }
        propres.push(restent[i]);
    }
    const titre = propres.findIndex((l) => /^#\s/.test(l));
    propres.splice(titre >= 0 ? titre + 1 : 0, 0, ...(titre >= 0 ? ["", MARQUEUR_ALLEGE] : [MARQUEUR_ALLEGE, ""]));
    return { texte: `${propres.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\s+$/, "")}\n`, gardees, retirees };
}
const idDossier = (dossier) => `memoire:${createHash("sha256").update(dossier).digest("hex").slice(0, 16)}`;
function indexDe(r) {
    const souvenirs = lireSouvenirsGraphe(r).souvenirs;
    return dossiersSouvenirs(r).flatMap((d) => {
        const chemin = path.join(d.dossier, "MEMORY.md");
        if (!existsSync(chemin))
            return [];
        let texte, st;
        try {
            texte = lire(chemin);
            st = statSync(chemin);
        }
        catch {
            return [];
        }
        const types = new Map(souvenirs.filter((s) => path.dirname(s.chemin) === d.dossier).map((s) => [path.basename(s.chemin), s.type]));
        return [{ d, chemin, texte, date: st.mtime.toISOString(), allege: memoireAllegee(texte, types) }];
    });
}
/** Les MEMORY.md de chaque agent et ce qu'un allègement y changerait, pour l'écran de l'entretien. */
export function indexMemoires(r) {
    return indexDe(r).map(({ d, texte, date, allege }) => {
        const octets = Buffer.byteLength(texte, "utf8"), octetsApres = Buffer.byteLength(allege.texte, "utf8");
        return {
            id: idDossier(d.dossier), agent: d.agent, date, octets, octetsApres,
            lignes: texte.split("\n").filter((l) => l.trim()).length, gardees: allege.gardees, retirees: allege.retirees,
            allege: texte.includes(MARQUEUR_ALLEGE),
            utile: allege.retirees >= LIGNES_RETIREES_MIN && octets - octetsApres >= OCTETS_GAGNES_MIN,
        };
    });
}
/** Écrit le MEMORY.md allégé (refusé s'il a changé depuis l'affichage), noté pour l'annuler. */
export function alleger(r, donnees, a) {
    const cible = indexDe(r).find((x) => idDossier(x.d.dossier) === a.id);
    if (!cible)
        throw new Error("Ce MEMORY.md n'existe plus à cet endroit.");
    if (cible.date !== a.attendu)
        throw new Error("Ce MEMORY.md a changé depuis l'affichage : relis le graphe avant d'agir.");
    if (!cible.allege.retirees || Buffer.byteLength(cible.allege.texte, "utf8") >= Buffer.byteLength(cible.texte, "utf8"))
        throw new Error("Rien à alléger dans ce MEMORY.md.");
    ecrire(cible.chemin, cible.allege.texte);
    return noter(donnees, {
        type: "allege", libelle: `MEMORY.md de ${cible.d.agent} allégé (${cible.allege.retirees} lignes)`,
        ecrits: [{ chemin: cible.chemin, avant: cible.texte, apres: empreinte(cible.allege.texte) }], deplaces: [],
    });
}
/** Annule une action : seulement si les fichiers sont restés tels que l'action les a laissés. */
export function annuler(donnees, id) {
    const e = lireEntretien(donnees), op = e.operations.find((o) => o.id === id);
    if (!op)
        throw new Error("Action introuvable.");
    if (op.annuleLe)
        throw new Error("Cette action est déjà annulée.");
    for (const w of op.ecrits) {
        if (!existsSync(w.chemin) || empreinte(lire(w.chemin)) !== w.apres)
            throw new Error(`${path.basename(w.chemin)} a changé depuis : annulation refusée pour ne rien perdre.`);
    }
    for (const d of op.deplaces) {
        if (!existsSync(d.vers) || existsSync(d.de))
            throw new Error(`${path.basename(d.de)} ne peut pas revenir à sa place (fichier absent ou remplacé).`);
    }
    for (const d of op.deplaces)
        renameSync(d.vers, d.de);
    for (const w of op.ecrits)
        ecrire(w.chemin, w.avant);
    op.annuleLe = new Date().toISOString();
    ecrireEntretien(donnees, e);
    return op;
}
/** Ce que l'écran reçoit : refus et dernières actions, sans les contenus gardés pour annuler. */
export function resumeEntretien(donnees) {
    const e = lireEntretien(donnees);
    return {
        refuses: e.refuses,
        operations: e.operations.slice(-20).reverse().map((o) => ({ id: o.id, type: o.type, le: o.le, libelle: o.libelle, annuleLe: o.annuleLe ?? null })),
    };
}
