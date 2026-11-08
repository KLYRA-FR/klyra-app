// Généré par scripts/serveur-genere.mjs depuis electron/cerveau-sens.ts : ne pas modifier à la main.
import { createHash } from "node:crypto";
/**
 * Sens local du second cerveau : entités (client, personne, projet, décision, sujet),
 * liens `[[wiki]]`, et une empreinte déterministe. Aucun appel réseau, aucun modèle :
 * le corpus ne quitte pas la machine. L’empreinte rapproche les formulations proches
 * (mots, morphologie, synonymes usuels) ; elle ne remplace pas un modèle neuronal.
 */
export const DIMENSION_EMPREINTE = 96;
const BANALS = new Set("note notes memoire souvenir fichier document projet projets client clients personne personnes decision decisions sujet sujets digital klyra test exemple demo introduction conclusion resume".split(" "));
const AMORCES = new Set("cette cet cette ces dans pour avec une des les sur par chez tout votre notre leur entre apres avant comme quand".split(" "));
const SYNONYMES = {
    compte: "client", customer: "client", client: "client",
    decision: "decision", choix: "decision", arbitrage: "decision",
    dossier: "projet", mission: "projet", projet: "projet",
    devis: "facture", invoice: "facture", facture: "facture",
    reunion: "reunion", meeting: "reunion", point: "reunion",
};
const GENRES_LIBELLES = {
    client: "client", compte: "client", customer: "client",
    personne: "personne", contact: "personne",
    projet: "projet", mission: "projet", dossier: "projet",
    decision: "decision", choix: "decision", arbitrage: "decision",
    sujet: "sujet", theme: "sujet",
};
export function normaliserSens(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "'").replace(/\s+/g, " ").trim();
}
export function contientSecret(contenu) {
    return /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(contenu)
        || /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-|ant-[A-Za-z0-9-]*-)?[A-Za-z0-9_-]{28,}|AKIA[A-Z0-9]{16})\b/.test(contenu);
}
/** Un passage de conversation qui vaut d’être gardé sans bouton manuel. */
export function texteAGarder(texte) {
    const t = texte.trim();
    if (t.length < 80 || t.length > 20_000 || contientSecret(t))
        return false;
    if (/\b(d[ée]cision|on retient|on d[ée]cide|choix retenu|[àa] retenir|valid[ée] que|prochaine [ée]tape|on part sur|retenu\s*:)\b/i.test(t))
        return true;
    if (/\[\[[^\]]{2,80}\]\]/.test(t))
        return true;
    return /^(?:client|compte|projet|personne|d[ée]cision)\s*[:：]/im.test(t);
}
export function wikiliens(texte) {
    const vus = new Set();
    for (const m of texte.matchAll(/\[\[([^\]|#]{1,120})(?:\|[^\]]{0,80})?\]\]/g)) {
        const v = normaliserSens(m[1]);
        if (v.length >= 2 && !BANALS.has(v))
            vus.add(v);
    }
    return [...vus];
}
function ajouter(entites, genre, brut) {
    const valeur = normaliserSens(brut).replace(/^[-–—:：\s]+|[-–—:：\s]+$/g, "").slice(0, 80);
    if (valeur.length < 4 || BANALS.has(valeur) || /^\d+$/.test(valeur))
        return;
    entites.set(`${genre}:${valeur}`, { genre, valeur });
}
/** Entités explicites et noms propres. Le texte est borné : un gros fichier ne bloque pas l’index. */
export function extraireEntites(titre, contenu, origine = "") {
    const texte = `${titre}\n${contenu}`.slice(0, 20_000);
    const entites = new Map();
    for (const m of texte.matchAll(/^(?:client|compte|customer|projet|mission|dossier|personne|contact|d[ée]cision|choix|arbitrage|sujet|th[èe]me)\s*[:：]\s*(.{2,80})$/gim)) {
        const genre = GENRES_LIBELLES[normaliserSens(m[0].split(/[:：]/)[0])];
        if (genre)
            ajouter(entites, genre, m[1]);
    }
    for (const m of texte.matchAll(/(?:client|compte)\s+[«"“]?([A-ZÉÈÀÂÊÎÔÛÇ][\p{L}'’-]+(?:\s+[A-ZÉÈÀÂÊÎÔÛÇ][\p{L}'’-]+){0,3})/gu))
        ajouter(entites, "client", m[1]);
    for (const m of texte.matchAll(/(?<![\p{L}\d])([A-ZÉÈÀÂÊÎÔÛÇ][\p{Ll}'’-]{2,}(?:\s+(?:de|du|des|la|le|von|van))?\s+[A-ZÉÈÀÂÊÎÔÛÇ][\p{Ll}'’-]{2,})/gu)) {
        const premier = normaliserSens(m[1].split(/\s+/)[0]);
        if (!AMORCES.has(premier))
            ajouter(entites, "personne", m[1]);
    }
    for (const m of texte.matchAll(/^#{1,3}\s+(.{3,80})$/gm))
        ajouter(entites, "sujet", m[1]);
    const chemin = origine.startsWith("dossier:") ? origine.split(":").slice(2).join(":") : origine;
    const client = /(?:^|\/)(?:\d+_CLIENTS?|clients)\/([^/]+)/i.exec(chemin);
    if (client)
        ajouter(entites, "client", client[1].replace(/[_-]+/g, " "));
    return [...entites.values()].slice(0, 40);
}
function seau(token) {
    const h = createHash("sha256").update(token).digest();
    return { i: h.readUInt16LE(0) % DIMENSION_EMPREINTE, signe: h[2] & 1 ? 1 : -1 };
}
function racine(mot) {
    if (mot.length < 6)
        return mot;
    return mot.replace(/(?:ement|ations|ation|ement|entes|ente|ers|er|ees|ee|es|e|s)$/u, "") || mot;
}
function jetons(texte) {
    return normaliserSens(texte).match(/[\p{L}\p{N}_-]{2,40}/gu) ?? [];
}
/** Empreinte L2, 96 dimensions, stable d’une machine à l’autre. */
export function empreinte(texte) {
    const v = new Float32Array(DIMENSION_EMPREINTE);
    const mots = jetons(texte).slice(0, 800).map(racine);
    const ajouterPoids = (token, poids) => {
        if (!token)
            return;
        const s = seau(token);
        v[s.i] += s.signe * poids;
        const syn = SYNONYMES[token];
        if (syn && syn !== token) {
            const c = seau(`syn:${syn}`);
            v[c.i] += c.signe * poids * 0.55;
        }
    };
    for (const mot of mots) {
        ajouterPoids(mot, 1);
        if (mot.length >= 4)
            for (let i = 0; i < mot.length - 2; i++)
                ajouterPoids(`#${mot.slice(i, i + 3)}`, 0.22);
    }
    for (let i = 0; i < mots.length - 1; i++)
        ajouterPoids(`${mots[i]}_${mots[i + 1]}`, 1.35);
    let norme = 0;
    for (const x of v)
        norme += x * x;
    norme = Math.sqrt(norme);
    if (norme > 0)
        for (let i = 0; i < v.length; i++)
            v[i] /= norme;
    return v;
}
export function cosinus(a, b) {
    const n = Math.min(a.length, b.length);
    let s = 0;
    for (let i = 0; i < n; i++)
        s += a[i] * b[i];
    return s;
}
export function encoderEmpreinte(v) {
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
export function decoderEmpreinte(brut) {
    const copie = new ArrayBuffer(brut.byteLength);
    new Uint8Array(copie).set(brut);
    return new Float32Array(copie);
}
