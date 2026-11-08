// Généré par scripts/serveur-genere.mjs depuis electron/cerveau-liens.ts : ne pas modifier à la main.
import { cosinus, decoderEmpreinte, empreinte, extraireEntites, normaliserSens, wikiliens } from "./cerveau-sens.mjs";
const LIBELLES = { client: "client", personne: "personne", projet: "projet", decision: "décision", sujet: "sujet" };
export function analyserNote(titre, contenu, origine = "") {
    return { entites: extraireEntites(titre, contenu, origine), vecteur: empreinte(`${titre}\n${contenu}`), wikis: wikiliens(`${titre}\n${contenu}`) };
}
/**
 * Liens automatiques : un wiki, une entité partagée (client, personne, projet, décision, sujet net),
 * ou une empreinte très proche. Au plus huit. Les liens manuels et les refus sont appliqués par l’appelant.
 */
export function proposerLiens(titre, contenu, origine, autres) {
    const sujet = analyserNote(titre, contenu, origine);
    const titreNorm = normaliserSens(titre);
    const parTitre = new Map();
    for (const autre of autres) {
        const cle = normaliserSens(autre.titre);
        const liste = parTitre.get(cle) ?? [];
        liste.push(autre.id);
        parTitre.set(cle, liste);
    }
    const proposes = new Map();
    const retenir = (lien) => {
        const deja = proposes.get(lien.id);
        if (!deja || lien.score > deja.score)
            proposes.set(lien.id, lien);
    };
    for (const wiki of sujet.wikis)
        for (const id of parTitre.get(wiki) ?? [])
            retenir({ id, genre: "wiki", pourquoi: `Lien [[${wiki}]]`, score: 1 });
    if (titreNorm.length >= 2)
        for (const autre of autres) {
            if (sujet.wikis.includes(normaliserSens(autre.titre)) || wikiliens(autre.titre).includes(titreNorm))
                retenir({ id: autre.id, genre: "wiki", pourquoi: `Lien [[${autre.titre}]]`, score: 1 });
        }
    const index = new Map();
    for (const autre of autres)
        for (const e of autre.entites) {
            const cle = `${e.genre}:${e.valeur}`;
            const liste = index.get(cle) ?? [];
            liste.push(autre.id);
            index.set(cle, liste);
        }
    for (const e of sujet.entites) {
        if (e.genre === "sujet" && e.valeur.length < 8)
            continue;
        for (const id of index.get(`${e.genre}:${e.valeur}`) ?? []) {
            const nom = e.valeur.length > 48 ? `${e.valeur.slice(0, 47)}…` : e.valeur;
            retenir({ id, genre: "entite", pourquoi: `Même ${LIBELLES[e.genre] ?? e.genre} : ${nom}`, score: e.genre === "sujet" ? 0.74 : 0.92 });
        }
    }
    const proches = [];
    for (const autre of autres) {
        if (!autre.vecteur)
            continue;
        const score = cosinus(sujet.vecteur, autre.vecteur);
        if (score >= 0.86)
            proches.push({ id: autre.id, genre: "sens", pourquoi: `Sens proche (${score.toFixed(2).replace(".", ",")})`, score });
    }
    proches.sort((a, b) => b.score - a.score);
    for (const lien of proches.slice(0, 3))
        retenir(lien);
    return [...proposes.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}
export function vecteurDe(brut) {
    if (!brut || brut.byteLength < 8)
        return null;
    try {
        return decoderEmpreinte(brut);
    }
    catch {
        return null;
    }
}
export { empreinte };
