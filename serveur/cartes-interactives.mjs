// Généré par scripts/serveur-genere.mjs depuis electron/cartes-interactives.ts : ne pas modifier à la main.
/**
 * Les cartes interactives d'un agent, dans le fil : au lieu d'une liste de questions, une carte que
 * la personne remplit et envoie d'un clic (outil `proposer_carte`). Cinq genres : un formulaire
 * (brief à remplir), une comparaison (pistes à départager), une liste à valider, des créneaux, un
 * tableau à compléter (lignes ajoutées ou retirées par la personne).
 * Ce qu'elle envoie part comme un message d'elle, lisible tel quel : l'agent le reçoit à son tour
 * suivant, comme une réponse écrite.
 *
 * Module pur, le même pour ce PC (electron/ia.ts, l'écran par src/lib/cartes-interactives.ts) et
 * pour un VPS (généré en serveur/cartes-interactives.mjs par scripts/serveur-genere.mjs).
 */
/* ─── Les formes ──────────────────────────────────────────────────── */
export const GENRES = ["formulaire", "comparaison", "liste", "creneaux", "tableau"];
export const TYPES_CHAMP = ["texte", "long", "nombre", "date", "choix", "multiple", "interrupteur", "curseur"];
export const TYPES_COLONNE = ["texte", "nombre", "choix", "interrupteur"];
/** Au plus, dans un tableau. */
export const MAX_COLONNES = 6;
export const MAX_LIGNES = 20;
export const LIBELLES_GENRE = {
    formulaire: "À remplir",
    comparaison: "À départager",
    liste: "À valider",
    creneaux: "Un créneau à choisir",
    tableau: "À compléter",
};
/* ─── L'outil ─────────────────────────────────────────────────────── */
const tableau = (description) => ({ type: "array", items: { type: "string" }, description });
export const OUTIL_CARTE = {
    name: "proposer_carte",
    description: "Montre sous ta réponse une carte que la personne remplit et envoie d'un clic, au lieu de lui poser une liste de questions. genre « formulaire » : les informations dont tu as besoin (champs), pré-remplies avec ce que tu sais déjà ; « comparaison » : 2 à 4 pistes à départager, avec leurs pour et contre, au plus une recommandée ; « liste » : des éléments à garder ou retirer (un plan, des tâches, des destinataires) ; « creneaux » : 2 à 8 créneaux proposés ; « tableau » : des lignes à compléter (1 à 6 colonnes, des lignes pré-remplies, ajout: true si elle peut en ajouter). Ce qu'elle envoie t'arrive dans son prochain message : termine ta réponse juste après l'appel.",
    inputSchema: {
        type: "object",
        properties: {
            genre: { type: "string", enum: [...GENRES] },
            titre: { type: "string", description: "Ce que la carte demande, en quelques mots." },
            intro: { type: "string", description: "Une phrase de contexte, si besoin." },
            champs: {
                type: "array",
                description: "formulaire : 1 à 8 champs.",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        libelle: { type: "string" },
                        type: { type: "string", enum: [...TYPES_CHAMP], description: "texte, long (plusieurs lignes), nombre, date, choix (une réponse), multiple (plusieurs), interrupteur (oui/non), curseur (min, max, pas)." },
                        options: tableau("choix et multiple : 2 à 8 réponses."),
                        requis: { type: "boolean" },
                        aide: { type: "string" },
                        valeur: { description: "Valeur pré-remplie." },
                        min: { type: "number" },
                        max: { type: "number" },
                        pas: { type: "number" },
                        unite: { type: "string", description: "Ex. €, jours, %." },
                    },
                    required: ["libelle", "type"],
                },
            },
            options: {
                type: "array",
                description: "comparaison : 2 à 4 pistes.",
                items: {
                    type: "object",
                    properties: { id: { type: "string" }, titre: { type: "string" }, resume: { type: "string" }, pour: tableau("Ses atouts."), contre: tableau("Ses limites."), recommandee: { type: "boolean" } },
                    required: ["titre"],
                },
            },
            elements: {
                type: "array",
                description: "liste : 2 à 12 éléments, cochés par défaut sauf coche: false.",
                items: { type: "object", properties: { id: { type: "string" }, texte: { type: "string" }, coche: { type: "boolean" } }, required: ["texte"] },
            },
            creneaux: {
                type: "array",
                description: "creneaux : 2 à 8 créneaux.",
                items: { type: "object", properties: { date: { type: "string", description: "AAAA-MM-JJ" }, heure: { type: "string", description: "HH:MM" }, duree: { type: "number", description: "En minutes." } }, required: ["date", "heure"] },
            },
            colonnes: {
                type: "array",
                description: `tableau : 1 à ${MAX_COLONNES} colonnes.`,
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        titre: { type: "string" },
                        type: { type: "string", enum: [...TYPES_COLONNE] },
                        options: tableau("choix : 2 à 8 réponses."),
                        unite: { type: "string" },
                        requis: { type: "boolean" },
                        total: { type: "boolean", description: "nombre : montrer la somme." },
                    },
                    required: ["titre", "type"],
                },
            },
            lignes: {
                type: "array",
                description: `tableau : jusqu'à ${MAX_LIGNES} lignes pré-remplies, chacune un objet { id de colonne: valeur }.`,
                items: { type: "object" },
            },
            ajout: { type: "boolean", description: "tableau : elle peut ajouter et retirer des lignes (vrai par défaut)." },
        },
        required: ["genre", "titre"],
    },
};
export const OUTIL_CARTE_CLAUDE = `mcp__klyra__${OUTIL_CARTE.name}`;
/** Ce que chaque agent apprend des cartes, quand l'outil est là (ce PC, ou un VPS). */
export const CONSIGNE_CARTES = `Pour lui demander plusieurs informations ou une décision (un brief, des pistes à départager, une liste à valider, un créneau), montre une carte avec proposer_carte plutôt qu'une liste de questions, puis termine ta réponse.`;
export const RETOUR_CARTE = "Carte affichée sous ta réponse. Termine ta réponse maintenant : ce qu'elle remplit arrivera dans son prochain message.";
/* ─── Lecture ─────────────────────────────────────────────────────── */
const texte = (v, max) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const nombre = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const liste = (v, max, taille) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : [])
    .map((x) => texte(x, taille))
    .filter(Boolean)
    .slice(0, max);
/** Un identifiant court et stable : minuscules, chiffres et tirets ; sinon `prefixe` et son rang. */
function identifiant(v, prefixe, i, pris) {
    const brut = texte(v, 40)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    let id = brut || `${prefixe}${i + 1}`;
    for (let n = 2; pris.has(id); n++)
        id = `${brut || prefixe}-${n}`;
    pris.add(id);
    return id;
}
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
function lireValeur(type, v, options) {
    switch (type) {
        case "texte":
        case "long":
            return typeof v === "string" && v.trim() ? v.trim().slice(0, type === "long" ? 2000 : 300) : null;
        case "nombre":
        case "curseur":
            return nombre(typeof v === "string" ? Number(v.replace(",", ".")) : v);
        case "date":
            return typeof v === "string" && DATE.test(v) ? v : null;
        case "choix":
            return typeof v === "string" && options.includes(v.trim()) ? v.trim() : null;
        case "multiple": {
            const l = liste(v, 8, 120).filter((x) => options.includes(x));
            return l.length ? l : null;
        }
        case "interrupteur":
            return typeof v === "boolean" ? v : null;
    }
}
function lireChamps(v) {
    if (!Array.isArray(v))
        return [];
    const pris = new Set();
    return v
        .flatMap((x, i) => {
        if (!x || typeof x !== "object")
            return [];
        const o = x;
        const libelle = texte(o.libelle, 80);
        const type = TYPES_CHAMP.find((t) => t === o.type);
        if (!libelle || !type)
            return [];
        const options = type === "choix" || type === "multiple" ? [...new Set(liste(o.options, 8, 120))] : [];
        if ((type === "choix" || type === "multiple") && options.length < 2)
            return [];
        const min = nombre(o.min);
        const max = nombre(o.max);
        if (type === "curseur" && (min === null || max === null || max <= min))
            return [];
        return [
            {
                id: identifiant(o.id, "champ", i, pris),
                libelle,
                type,
                options,
                requis: o.requis === true,
                aide: texte(o.aide, 200),
                valeur: lireValeur(type, o.valeur, options),
                min,
                max,
                pas: nombre(o.pas) !== null && nombre(o.pas) > 0 ? nombre(o.pas) : null,
                unite: texte(o.unite, 12),
            },
        ];
    })
        .slice(0, 8);
}
function lireOptions(v) {
    if (!Array.isArray(v))
        return [];
    const pris = new Set();
    const options = v
        .flatMap((x, i) => {
        if (!x || typeof x !== "object")
            return [];
        const o = x;
        const titre = texte(o.titre, 80);
        if (!titre)
            return [];
        return [{ id: identifiant(o.id, "piste", i, pris), titre, resume: texte(o.resume, 300), pour: liste(o.pour, 4, 140), contre: liste(o.contre, 4, 140), recommandee: o.recommandee === true }];
    })
        .slice(0, 4);
    // Au plus une recommandée : la première.
    const premiere = options.findIndex((o) => o.recommandee);
    return options.map((o, i) => ({ ...o, recommandee: i === premiere }));
}
function lireElements(v) {
    if (!Array.isArray(v))
        return [];
    const pris = new Set();
    return v
        .flatMap((x, i) => {
        const o = (typeof x === "string" ? { texte: x } : x && typeof x === "object" ? x : {});
        const t = texte(o.texte, 200);
        return t ? [{ id: identifiant(o.id, "element", i, pris), texte: t, coche: o.coche !== false }] : [];
    })
        .slice(0, 12);
}
function lireCreneaux(v) {
    if (!Array.isArray(v))
        return [];
    const vus = new Set();
    return v
        .flatMap((x) => {
        if (!x || typeof x !== "object")
            return [];
        const o = x;
        const date = typeof o.date === "string" && DATE.test(o.date) ? o.date : "";
        const heure = typeof o.heure === "string" && HEURE.test(o.heure) ? o.heure : "";
        const duree = nombre(o.duree);
        if (!date || !heure || vus.has(`${date} ${heure}`))
            return [];
        vus.add(`${date} ${heure}`);
        return [{ date, heure, duree: duree !== null && duree >= 5 && duree <= 720 ? Math.round(duree) : 60 }];
    })
        .sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`))
        .slice(0, 8);
}
function lireColonnes(v) {
    if (!Array.isArray(v))
        return [];
    const pris = new Set();
    return v
        .flatMap((x, i) => {
        if (!x || typeof x !== "object")
            return [];
        const o = x;
        const titre = texte(o.titre, 40);
        const type = TYPES_COLONNE.find((t) => t === o.type);
        if (!titre || !type)
            return [];
        const options = type === "choix" ? [...new Set(liste(o.options, 8, 60))] : [];
        if (type === "choix" && options.length < 2)
            return [];
        return [{ id: identifiant(o.id, "colonne", i, pris), titre, type, options, unite: texte(o.unite, 12), requis: o.requis === true, total: type === "nombre" && o.total === true }];
    })
        .slice(0, MAX_COLONNES);
}
/** Une cellule, lue d'après le type de sa colonne ; null si vide ou invalide. */
export function lireCellule(colonne, v) {
    switch (colonne.type) {
        case "texte":
            return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : typeof v === "number" ? String(v) : null;
        case "nombre": {
            const n = typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : v;
            return typeof n === "number" && Number.isFinite(n) ? n : null;
        }
        case "choix":
            return typeof v === "string" && colonne.options.includes(v.trim()) ? v.trim() : null;
        case "interrupteur":
            return typeof v === "boolean" ? v : null;
    }
}
/** Des lignes nettoyées : seulement les colonnes connues et leurs valeurs valides ; ids stables et distincts. */
export function lireLignes(colonnes, v) {
    if (!Array.isArray(v))
        return [];
    const pris = new Set();
    return v
        .flatMap((x, i) => {
        if (!x || typeof x !== "object")
            return [];
        const o = x;
        // Une ligne de l'agent : { colonne: valeur } ; une ligne gardée par l'écran : { id, cellules }.
        const brut = (o.cellules && typeof o.cellules === "object" ? o.cellules : o);
        const cellules = Object.fromEntries(colonnes.flatMap((c) => {
            const valeur = lireCellule(c, brut[c.id] ?? brut[c.titre]);
            return valeur === null ? [] : [[c.id, valeur]];
        }));
        return [{ id: identifiant(o.cellules ? o.id : undefined, "ligne", i, pris), cellules }];
    })
        .slice(0, MAX_LIGNES);
}
/** La carte d'un appel à `proposer_carte`, ou la raison du refus. */
export function lireCarte(entree) {
    const genre = GENRES.find((g) => g === entree.genre);
    if (!genre)
        return { refus: `Donne un genre : ${GENRES.join(", ")}.` };
    const base = { titre: texte(entree.titre, 120), intro: texte(entree.intro, 300) };
    if (!base.titre)
        return { refus: "Donne un titre à la carte : ce qu'elle demande, en quelques mots." };
    switch (genre) {
        case "formulaire": {
            const champs = lireChamps(entree.champs);
            return champs.length ? { carte: { ...base, genre, champs } } : { refus: "Un formulaire a de 1 à 8 champs, chacun avec un libellé et un type (2 réponses au moins pour choix et multiple, min < max pour un curseur)." };
        }
        case "comparaison": {
            const options = lireOptions(entree.options);
            return options.length >= 2 ? { carte: { ...base, genre, options } } : { refus: "Une comparaison a de 2 à 4 pistes, chacune avec un titre." };
        }
        case "liste": {
            const elements = lireElements(entree.elements);
            return elements.length >= 2 ? { carte: { ...base, genre, elements } } : { refus: "Une liste a de 2 à 12 éléments." };
        }
        case "creneaux": {
            const creneaux = lireCreneaux(entree.creneaux);
            return creneaux.length >= 2 ? { carte: { ...base, genre, creneaux } } : { refus: "Propose de 2 à 8 créneaux distincts (date AAAA-MM-JJ, heure HH:MM)." };
        }
        case "tableau": {
            const colonnes = lireColonnes(entree.colonnes);
            if (!colonnes.length)
                return { refus: `Un tableau a de 1 à ${MAX_COLONNES} colonnes, chacune avec un titre et un type (2 réponses au moins pour choix).` };
            const ajout = entree.ajout !== false;
            const lignes = lireLignes(colonnes, entree.lignes);
            if (!ajout && !lignes.length)
                return { refus: "Un tableau sans ajout de lignes a besoin de lignes pré-remplies." };
            return { carte: { ...base, genre, colonnes, lignes, ajout } };
        }
    }
}
/** Un appel à `proposer_carte`, le même sur ce PC et sur un VPS : ce que l'outil répond. */
export function appelCarte(args) {
    const r = lireCarte(args);
    return "refus" in r ? { texte: r.refus, erreur: true } : { texte: RETOUR_CARTE, erreur: false };
}
/* ─── La réponse de la personne ───────────────────────────────────── */
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** « mardi 12 novembre » (le jour de la semaine se calcule sans fuseau : la date seule). */
export function dateLisible(date) {
    const [a, m, j] = date.split("-").map(Number);
    const jour = new Date(Date.UTC(a, m - 1, j)).getUTCDay();
    return `${JOURS[jour]} ${j === 1 ? "1er" : j} ${MOIS[m - 1]}`;
}
/** « 1 h 30 », « 45 min ». */
export function dureeLisible(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`;
}
const nombreLisible = (n) => String(n).replace(".", ",");
/** Une valeur, telle qu'elle s'écrit dans le message envoyé ; vide si rien. */
export function valeurLisible(champ, v) {
    if (v === null || v === undefined)
        return "";
    switch (champ.type) {
        case "interrupteur":
            return v === true ? "oui" : v === false ? "non" : "";
        case "multiple":
            return Array.isArray(v) ? v.join(", ") : "";
        case "date":
            return typeof v === "string" && DATE.test(v) ? dateLisible(v) : "";
        case "nombre":
        case "curseur":
            return typeof v === "number" ? `${nombreLisible(v)}${champ.unite ? ` ${champ.unite}` : ""}` : "";
        default:
            return typeof v === "string" ? v.trim() : "";
    }
}
/** La valeur de départ d'un champ : celle pré-remplie, sinon le milieu d'un curseur, faux pour un interrupteur. */
export function valeurDepart(champ) {
    if (champ.valeur !== null)
        return champ.valeur;
    if (champ.type === "curseur" && champ.min !== null && champ.max !== null)
        return champ.min + Math.round((champ.max - champ.min) / 2 / (champ.pas ?? 1)) * (champ.pas ?? 1);
    if (champ.type === "interrupteur")
        return false;
    return null;
}
/** Ce qui manque avant d'envoyer (vide : la carte peut partir). */
export function manquantsCarte(carte, r) {
    switch (carte.genre) {
        case "formulaire":
            return carte.champs.filter((c) => c.requis && !valeurLisible(c, r.valeurs?.[c.id] ?? null)).map((c) => c.libelle);
        case "comparaison":
            return carte.options.some((o) => o.id === r.choix) ? [] : ["une piste"];
        case "liste":
            return [];
        case "creneaux":
            return r.creneau !== undefined && carte.creneaux[r.creneau] ? [] : ["un créneau"];
        case "tableau": {
            const lignes = r.lignes ?? carte.lignes;
            if (!lignes.length)
                return ["au moins une ligne"];
            return carte.colonnes.filter((c) => c.requis && lignes.some((l) => l.cellules[c.id] === undefined || l.cellules[c.id] === "")).map((c) => `la colonne ${c.titre}`);
        }
    }
}
/** Une cellule telle qu'elle s'écrit : « oui », « 1 200 € » ; vide si rien. */
export function celluleLisible(c, v) {
    if (v === undefined || v === "")
        return "";
    if (c.type === "interrupteur")
        return v === true ? "oui" : "non";
    if (c.type === "nombre" && typeof v === "number")
        return `${nombreLisible(v)}${c.unite ? ` ${c.unite}` : ""}`;
    return String(v);
}
/** La somme d'une colonne de nombres. */
export const totalColonne = (c, lignes) => lignes.reduce((t, l) => t + (typeof l.cellules[c.id] === "number" ? l.cellules[c.id] : 0), 0);
/** Le message que la carte envoie en son nom : lisible tel quel, par l'agent comme dans le fil. */
export function texteReponse(carte, r) {
    const mot = r.mot?.trim() ? `\n\n${r.mot.trim().slice(0, 1000)}` : "";
    switch (carte.genre) {
        case "formulaire": {
            const lignes = carte.champs.map((c) => `- ${c.libelle} : ${valeurLisible(c, r.valeurs?.[c.id] ?? null) || "—"}`);
            return `${carte.titre}\n${lignes.join("\n")}${mot}`;
        }
        case "comparaison": {
            const o = carte.options.find((x) => x.id === r.choix);
            return `${carte.titre} : je choisis « ${o?.titre ?? "?"} ».${mot}`;
        }
        case "liste": {
            const gardes = carte.elements.filter((e) => r.coches?.includes(e.id) ?? e.coche);
            const retires = carte.elements.filter((e) => !gardes.includes(e));
            return [
                `${carte.titre} : ${gardes.length} sur ${carte.elements.length} gardés.`,
                gardes.length ? `Gardés :\n${gardes.map((e) => `- ${e.texte}`).join("\n")}` : "",
                retires.length ? `Retirés :\n${retires.map((e) => `- ${e.texte}`).join("\n")}` : "",
            ]
                .filter(Boolean)
                .join("\n")
                .concat(mot);
        }
        case "creneaux": {
            const c = r.creneau !== undefined ? carte.creneaux[r.creneau] : undefined;
            return `${carte.titre} : ${c ? `le ${dateLisible(c.date)} à ${c.heure} (${dureeLisible(c.duree)})` : "aucun"}.${mot}`;
        }
        case "tableau": {
            const lignes = r.lignes ?? carte.lignes;
            const cellule = (t) => t.replace(/\|/g, "\\|").replace(/\s+/g, " ") || "—";
            const entete = `| ${carte.colonnes.map((c) => cellule(c.titre)).join(" | ")} |`;
            const separation = `| ${carte.colonnes.map((c) => (c.type === "nombre" ? "---:" : "---")).join(" | ")} |`;
            const corps = lignes.map((l) => `| ${carte.colonnes.map((c) => cellule(celluleLisible(c, l.cellules[c.id]))).join(" | ")} |`);
            const totaux = carte.colonnes.filter((c) => c.total).map((c) => `Total ${c.titre} : ${celluleLisible(c, totalColonne(c, lignes))}`);
            return [`${carte.titre} (${lignes.length} ligne${lignes.length > 1 ? "s" : ""})`, "", entete, separation, ...corps, ...(totaux.length ? ["", ...totaux] : [])].join("\n").concat(mot);
        }
    }
}
/** La réponse à garder sur la carte, nettoyée (ce que l'écran note après l'envoi). */
export function reponseNette(carte, r) {
    switch (carte.genre) {
        case "formulaire":
            return { valeurs: Object.fromEntries(carte.champs.flatMap((c) => (r.valeurs?.[c.id] !== undefined && r.valeurs[c.id] !== null ? [[c.id, r.valeurs[c.id]]] : []))) };
        case "comparaison":
            return { choix: r.choix, ...(r.mot?.trim() ? { mot: r.mot.trim().slice(0, 1000) } : {}) };
        case "liste":
            return { coches: carte.elements.filter((e) => r.coches?.includes(e.id) ?? e.coche).map((e) => e.id) };
        case "creneaux":
            return { creneau: r.creneau, ...(r.mot?.trim() ? { mot: r.mot.trim().slice(0, 1000) } : {}) };
        case "tableau":
            return { lignes: lireLignes(carte.colonnes, r.lignes ?? carte.lignes) };
    }
}
