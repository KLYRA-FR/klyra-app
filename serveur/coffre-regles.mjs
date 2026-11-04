// Généré par scripts/serveur-genere.mjs depuis electron/coffre-regles.ts : ne pas modifier à la main.
/**
 * Les règles du Coffre de KLYRA, sans Electron ni disque : partagées par le process principal
 * (`coffre.ts`, `coffre-outils.ts`) et l'écran (la carte sécurisée d'une conversation, Réglages › Coffre).
 *
 * Un secret du coffre a un nom de variable (STRIPE_SECRET_KEY) : c'est par lui qu'un agent le demande,
 * le retrouve et l'écrit dans un fichier, sans jamais en voir la valeur.
 */
export const GENRES_SECRET = {
    "cle-api": "Clé API",
    jeton: "Jeton d’accès",
    "mot-de-passe": "Mot de passe",
    autre: "Autre secret",
};
export const estGenreSecret = (v) => typeof v === "string" && v in GENRES_SECRET;
/** Une valeur : pas vide, 10 000 caractères au plus (une clé privée PEM y tient). */
export const VALEUR_MAX = 10_000;
export const FORMATS_FICHIER = ["env", "modele", "brut"];
/** Le texte sans accents, pour en tirer un nom de variable. */
function sansAccents(t) {
    return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
/**
 * Le nom de variable d'un secret : MAJUSCULES, chiffres et _, commence par une lettre, 2 à 64
 * caractères. « stripe-secret key » devient STRIPE_SECRET_KEY ; un nom vide ou illisible est refusé.
 */
export function normaliserVariable(v) {
    const brut = typeof v === "string" ? sansAccents(v).trim() : "";
    const nom = brut
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64)
        .replace(/_+$/, "");
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(nom))
        throw new Error("Donne un nom de variable en lettres, chiffres et _, qui commence par une lettre (ex. STRIPE_SECRET_KEY).");
    return nom;
}
/** Un nom de variable proposé d'après ce que la personne tape (« Clé API Stripe » → CLE_API_STRIPE), ou "" . */
export function variableProposee(nom) {
    try {
        return normaliserVariable(nom);
    }
    catch {
        return "";
    }
}
/** Un texte court d'un champ (nom, service, note, raison) : une ligne, coupé à `max`. */
export function texteCourt(v, max) {
    return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
/** La valeur d'un secret : refusée vide ou trop longue. Les espaces autour, collés par mégarde, partent. */
export function validerValeur(v) {
    const valeur = typeof v === "string" ? v.replace(/^[\s\u200b\ufeff]+|[\s\u200b\ufeff]+$/g, "") : "";
    if (!valeur)
        throw new Error("La valeur est vide.");
    if (valeur.length > VALEUR_MAX)
        throw new Error("La valeur dépasse 10 000 caractères.");
    return valeur;
}
/** La ligne `VARIABLE=valeur` d'un fichier .env, entre guillemets si la valeur en a besoin. */
export function ligneEnv(variable, valeur) {
    if (/[\r\n]/.test(valeur))
        throw new Error("Une valeur sur plusieurs lignes ne va pas dans un fichier .env : utilise le format « brut ».");
    if (/^[A-Za-z0-9_\-.:/+=@~,%]+$/.test(valeur))
        return `${variable}=${valeur}`;
    return `${variable}="${valeur.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
}
/**
 * Le contenu d'un fichier .env avec la ligne du secret : la ligne existante de cette variable est
 * remplacée (son `export ` gardé), sinon la ligne est ajoutée à la fin. Rien d'autre ne change.
 */
export function ecrireDansEnv(contenu, variable, valeur) {
    const ligne = ligneEnv(variable, valeur);
    const motif = new RegExp(`^(\\s*export\\s+)?${variable}\\s*=.*$`);
    const lignes = contenu.split("\n");
    let remplace = false;
    const nouvelles = lignes.map((l) => {
        const m = l.match(motif);
        if (!m || remplace)
            return l;
        remplace = true;
        return `${m[1] ? "export " : ""}${ligne}`;
    });
    if (remplace)
        return { contenu: nouvelles.join("\n"), remplace };
    const base = contenu && !contenu.endsWith("\n") ? `${contenu}\n` : contenu;
    return { contenu: `${base}${ligne}\n`, remplace };
}
/** La marque qu'un fichier modèle porte à la place du secret. */
export const marqueModele = (variable) => `{{coffre:${variable}}}`;
/** Le contenu d'un fichier modèle où chaque `{{coffre:VARIABLE}}` devient la valeur. */
export function remplacerModele(contenu, variable, valeur) {
    const marque = marqueModele(variable);
    const morceaux = contenu.split(marque);
    return { contenu: morceaux.join(valeur), n: morceaux.length - 1 };
}
export function lireDemandeSecret(entree) {
    let variable;
    try {
        variable = normaliserVariable(entree.variable);
    }
    catch {
        return null;
    }
    const nom = texteCourt(entree.nom, 120) || variable;
    return {
        variable,
        nom,
        genre: estGenreSecret(entree.genre) ? entree.genre : "cle-api",
        service: texteCourt(entree.service, 200),
        raison: texteCourt(entree.raison, 400),
        ouTrouver: texteCourt(entree.ou_trouver, 300),
    };
}
/** Ce que la personne répond, dans la conversation, une fois la carte sécurisée remplie (jamais la valeur). */
export function messageReponseCoffre(etat, d) {
    if (etat === "rangee")
        return `C’est rangé dans le coffre : « ${d.nom} » (${d.variable}). Tu peux t’en servir sans voir sa valeur.`;
    if (etat === "permise")
        return `« ${d.nom} » (${d.variable}) est déjà dans le coffre : tu peux t’en servir sans voir sa valeur.`;
    return `Je ne te donne pas « ${d.nom} » (${d.variable}). Continue sans, ou dis-moi ce qu’il te faudrait d’autre.`;
}
