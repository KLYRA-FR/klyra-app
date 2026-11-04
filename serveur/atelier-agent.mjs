// Généré par scripts/serveur-genere.mjs depuis electron/atelier-agent.ts : ne pas modifier à la main.
import { PILIERS_LISTE } from "./epreuve.mjs";
/* ─── Petits outils, recopiés de l'écran (un test vérifie qu'ils restent égaux) ─── */
/** Comme `comparable` de src/lib/noms-agents.ts : sans accents, minuscules, espaces réduits. */
export const comparable = (texte) => texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export const nomPropre = (nom) => nom.trim().replace(/\s+/g, " ");
export const identifiantDe = (nom) => comparable(nom)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
/** Comme src/lib/poids-fiche.ts : 2,75 caractères par jeton, conseil au-delà de 1 500. */
export const CARACTERES_PAR_JETON = 2.75;
export const SEUIL_FICHE_LONGUE = 1500;
const jetonsEstimes = (texte) => Math.round(texte.length / CARACTERES_PAR_JETON);
/** Comme `serializeAgentFile` de src/lib/agent-file.ts, pour un en-tête neuf. */
function serialiser(entete, corps) {
    const echapper = (v) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const valeur = (k, v) => k === "description" ? `"${echapper(v)}"` : /^[A-Za-z0-9 _.\-À-ÿ’]+$/.test(v) && v.trim() === v && v !== "" ? v : `"${echapper(v).replace(/\n/g, "\\n")}"`;
    const tete = entete.filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${valeur(k, v)}`);
    return `---\n${tete.join("\n")}\n---\n\n${corps.trim()}\n`;
}
/* ─── Les outils de l'assistant ───────────────────────────────────── */
/**
 * L'atelier d'un agent, dans la conversation  : l'assistant complète la
 * carte à chaque réponse, la personne la crée d'un clic ou l'ajuste dans l'éditeur (ou non).
 */
const tableau = (description) => ({ type: "array", items: { type: "string" }, description });
export const OUTIL_PROPOSER = {
    name: "proposer_agent",
    description: "Montre et complète, dans la conversation, la carte d'un agent à créer avec la personne. Appelle-le après chaque réponse utile, avec seulement ce que tu viens d'apprendre : chaque champ donné remplace le précédent, les autres restent. La carte montre ses cinq piliers (mission, quand l'appeler, ce qu'il livre, ses limites, comment il vérifie) et le poids de sa fiche. C'est la personne qui le crée d'un clic sur la carte, ou l'ajuste dans l'éditeur : rien n'est créé par cet outil. Phrases courtes, écrites comme la fiche les dira (« Envoyer au client : jamais sans ton accord. »). N'y répète pas ce que l'app donne déjà à chaque agent (agents actifs, fils, QA sur demande, accès qui n'est pas un accord, livrables en fichiers).",
    inputSchema: {
        type: "object",
        properties: {
            nouveau: { type: "boolean", description: "true pour commencer la carte d'un autre agent." },
            nom: { type: "string", description: "Son prénom (ex. Nina)." },
            role: { type: "string", description: "Son rôle court (ex. Commercial)." },
            id: { type: "string", description: "Identifiant voulu : minuscules, chiffres et tirets. Sinon tiré du prénom." },
            mission: { type: "string", description: "Sa mission, en une phrase." },
            declencheurs: tableau("Quand l'appeler : une situation par élément."),
            livrables: tableau("Ce qu'il rend : un livrable par élément."),
            methode: tableau("Comment il travaille : 3 à 5 règles."),
            limites: tableau("Ce qu'il ne fait pas, ou seulement avec l'accord de la personne : une phrase par élément."),
            verification: tableau("Comment il vérifie son travail avant de le rendre."),
            modele: { type: "string", enum: ["opus", "sonnet", "haiku"], description: "Seulement si la personne l'a choisi." },
            epreuve: {
                type: "object",
                description: "Trois demandes réalistes, tirées de ce qu'elle t'a dit, pour le mettre à l'épreuve avant de le créer : la carte les lui fait passer pour de vrai.",
                properties: { normal: { type: "string", description: "Une demande normale de son métier." }, floue: { type: "string", description: "Une demande à laquelle il manque l'essentiel." }, horsMetier: { type: "string", description: "Une demande qui relève d'un autre métier." } },
                required: ["normal", "floue", "horsMetier"],
            },
            voisins: {
                type: "array",
                description: "Ses agents actifs qui font déjà une partie de ce travail, s'il y en a.",
                items: { type: "object", properties: { id: { type: "string" }, raison: { type: "string", description: "Ce qu'il fait déjà, en une phrase." } }, required: ["id", "raison"] },
            },
            routine: {
                type: "object",
                description: "Une tâche qui revient à lui confier une fois créé, si elle en a parlé. Proposée, jamais créée d'office.",
                properties: {
                    nom: { type: "string" },
                    consigne: { type: "string" },
                    quand: {
                        type: "object",
                        properties: { type: { type: "string", enum: ["jour", "jours-ouvres", "semaine", "mois"] }, jour: { type: "number", description: "1 = lundi … 7 = dimanche ; ou le jour du mois (1 à 28)." }, heure: { type: "string", description: "HH:MM" } },
                        required: ["type", "heure"],
                    },
                },
                required: ["nom", "consigne", "quand"],
            },
            description: { type: "string", description: "La description de l'en-tête, si tu l'écris toi-même ; sinon l'app la compose." },
            consignes: { type: "string", description: "Le corps complet de la fiche en Markdown, seulement si tu l'écris d'un bloc ; sinon l'app le compose avec les champs." },
        },
    },
};
/** Des réponses toutes prêtes sous la question de l'assistant : un clic répond. */
export const OUTIL_CHOIX = {
    name: "proposer_choix",
    description: "Montre sous ta réponse des réponses toutes prêtes à la question que tu viens de poser : la personne clique pour répondre, ou écrit la sienne. 2 à 6 réponses courtes, tirées de ce qu'elle t'a dit. Termine ta réponse juste après : sa réponse arrivera dans son prochain message.",
    inputSchema: {
        type: "object",
        properties: {
            question: { type: "string", description: "La question, en quelques mots (déjà posée dans ton texte)." },
            options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6, description: "Les réponses proposées." },
            multiple: { type: "boolean", description: "true si plusieurs réponses vont ensemble : elle coche, puis envoie." },
        },
        required: ["options"],
    },
};
/** Ce que l'assistant apprend de l'atelier, quand ses outils sont là (ce PC, ou un VPS). */
export const CONSIGNE_ATELIER = `Pour créer un agent avec elle (elle le demande, ou un besoin revient qu'aucun de ses agents ne couvre), mène l'atelier ici, une question à la fois : d'abord la dernière fois qu'elle a fait cette tâche (ce qu'elle a fait, le temps passé, ce qui a coincé) ; puis son prénom, quand l'appeler, ce qu'il livre, ce qui demande son accord, comment il vérifie son travail. Propose à chaque question des réponses tirées de ce qu'elle t'a dit (proposer_choix), puis termine ta réponse. Après chaque réponse, complète sa carte avec proposer_agent ; à la fin, ajoute trois demandes pour l'épreuve. Un exemple de son travail joint : un modèle pour sa méthode, pas à recopier. Rien n'est créé par toi : elle le met à l'épreuve et le crée sur la carte.`;
/* ─── Lecture des outils ──────────────────────────────────────────── */
const texte = (v, max) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : undefined);
/** Une liste de phrases : 10 au plus, 300 caractères chacune. Une phrase seule compte comme une liste. */
function liste(v) {
    const brut = typeof v === "string" ? [v] : Array.isArray(v) ? v : undefined;
    if (!brut)
        return undefined;
    return brut
        .map((x) => texte(x, 300) ?? "")
        .filter(Boolean)
        .slice(0, 10);
}
/** L'identifiant proposé : minuscules, chiffres et tirets (comme l'éditeur). */
export const identifiantPropre = (v) => v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
const MODELES = ["opus", "sonnet", "haiku"];
function lireEpreuve(v) {
    if (!v || typeof v !== "object")
        return undefined;
    const o = v;
    const e = { normal: texte(o.normal, 300) ?? "", floue: texte(o.floue, 300) ?? "", horsMetier: texte(o.horsMetier, 300) ?? "" };
    return e.normal && e.floue && e.horsMetier ? e : undefined;
}
function lireVoisins(v) {
    if (!Array.isArray(v))
        return undefined;
    return v
        .map((x) => (x && typeof x === "object" ? x : {}))
        .map((x) => ({ id: identifiantPropre(texte(x.id, 64) ?? ""), raison: texte(x.raison, 200) ?? "" }))
        .filter((x) => x.id && x.raison)
        .slice(0, 3);
}
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
function lireRoutine(v) {
    if (!v || typeof v !== "object")
        return undefined;
    const o = v;
    const q = (o.quand && typeof o.quand === "object" ? o.quand : {});
    const type = q.type;
    const heure = typeof q.heure === "string" && HEURE.test(q.heure) ? q.heure : "09:00";
    const nom = texte(o.nom, 80) ?? "";
    const consigne = texte(o.consigne, 2000) ?? "";
    if (!nom || !consigne || (type !== "jour" && type !== "jours-ouvres" && type !== "semaine" && type !== "mois"))
        return undefined;
    const jour = typeof q.jour === "number" && Number.isInteger(q.jour) ? q.jour : 1;
    if (type === "semaine" && (jour < 1 || jour > 7))
        return undefined;
    if (type === "mois" && (jour < 1 || jour > 28))
        return undefined;
    return { nom, consigne, quand: type === "semaine" || type === "mois" ? { type, heure, jour } : { type, heure } };
}
/** Ce qu'un appel à `proposer_agent` apprend ; `null` s'il n'apprend rien. */
export function lireMajAtelier(entree) {
    const maj = {};
    if (entree.nouveau === true)
        maj.nouveau = true;
    const id = texte(entree.id, 64);
    if (id !== undefined)
        maj.id = identifiantPropre(id);
    const nom = texte(entree.nom, 60);
    if (nom !== undefined)
        maj.nom = nom;
    const role = texte(entree.role, 40);
    if (role !== undefined)
        maj.role = role;
    const mission = texte(entree.mission, 400);
    if (mission !== undefined)
        maj.mission = mission;
    const description = texte(entree.description, 1200);
    if (description !== undefined)
        maj.description = description;
    for (const cle of ["declencheurs", "livrables", "methode", "limites", "verification"]) {
        const l = liste(entree[cle]);
        if (l !== undefined)
            maj[cle] = l;
    }
    if (typeof entree.consignes === "string")
        maj.consignes = entree.consignes.trim().slice(0, 40_000);
    if (MODELES.includes(entree.modele))
        maj.modele = entree.modele;
    const epreuve = lireEpreuve(entree.epreuve);
    if (epreuve)
        maj.epreuve = epreuve;
    const voisins = lireVoisins(entree.voisins);
    if (voisins)
        maj.voisins = voisins;
    const routine = lireRoutine(entree.routine);
    if (routine)
        maj.routine = routine;
    return Object.keys(maj).length ? maj : null;
}
export const BROUILLON_VIDE = {
    id: "",
    nom: "",
    role: "",
    mission: "",
    description: "",
    declencheurs: [],
    livrables: [],
    methode: [],
    limites: [],
    verification: [],
    consignes: "",
    modele: "",
    epreuve: null,
    voisins: [],
    routine: null,
};
/** La carte après un appel : chaque champ donné remplace le précédent, `nouveau` repart de zéro. */
export function appliquerMaj(brouillon, maj) {
    const { nouveau, ...champs } = maj;
    const depart = nouveau ? BROUILLON_VIDE : brouillon;
    return { ...depart, ...Object.fromEntries(Object.entries(champs).filter(([, v]) => v !== undefined)) };
}
/** Les phrases ajoutées par la personne : à la suite de leur pilier, une seule fois, quoi que l'assistant écrive ensuite. */
export function appliquerAjouts(b, ajouts) {
    if (!ajouts.length)
        return b;
    const suite = { ...b };
    for (const { pilier, texte: t } of ajouts) {
        if (!suite[pilier].some((x) => comparable(x) === comparable(t)))
            suite[pilier] = [...suite[pilier], t];
    }
    return suite;
}
/* ─── Les cinq piliers ────────────────────────────────────────────── */
export const PILIERS = [
    { cle: "mission", titre: "Sa mission" },
    { cle: "declencheurs", titre: "Quand l’appeler" },
    { cle: "livrables", titre: "Ce qu’il livre" },
    { cle: "limites", titre: "Ses limites" },
    { cle: "verification", titre: "Comment il vérifie" },
];
/** Une fiche écrite d'un bloc par l'assistant : ses sections disent quels piliers elle couvre. */
const SECTIONS = {
    declencheurs: /^##\s+.*(quand|m[’']appeler)/im,
    livrables: /^##\s+.*(livr|je rends|ce que je produis)/im,
    limites: /^##\s+.*(ne fais pas|limites|accord)/im,
    verification: /^##\s+.*(crit[eè]res|v[ée]rifi)/im,
};
export function piliersRemplis(b) {
    const remplis = new Set();
    if (b.mission || b.description)
        remplis.add("mission");
    for (const cle of ["declencheurs", "livrables", "limites", "verification"]) {
        if (b[cle].length || SECTIONS[cle].test(b.consignes))
            remplis.add(cle);
    }
    return remplis;
}
/* ─── La fiche qui sera écrite ────────────────────────────────────── */
const minusculeInitiale = (s) => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const sansPoint = (s) => s.replace(/[.\s]+$/, "");
/** Le corps de la fiche : celui écrit par l'assistant, sinon composé avec les piliers. */
export function corpsFiche(b) {
    if (b.consignes)
        return b.consignes;
    const nom = nomPropre(b.nom) || "Nouvel agent";
    const blocs = [b.role ? `# ${nom} — ${b.role}` : `# ${nom}`];
    if (b.mission)
        blocs.push(b.mission);
    const section = (titre, items, numerotee = false) => {
        if (items.length)
            blocs.push(`## ${titre}\n\n${items.map((t, i) => (numerotee ? `${i + 1}. ${t}` : `- ${t}`)).join("\n")}`);
    };
    section("Quand m’appeler", b.declencheurs);
    section("Ce que je livre", b.livrables);
    section("Comment je travaille", b.methode, true);
    section("Ce que je ne fais pas", b.limites);
    section("Critères de sortie", b.verification);
    return blocs.join("\n\n");
}
/** La description de l'en-tête : ce que Claude lit pour choisir l'agent. */
export function descriptionFiche(b) {
    if (b.description)
        return b.description;
    const quand = b.declencheurs.length
        ? ` Appelle ${nomPropre(b.nom) || "cet agent"} : ${b.declencheurs.map((d) => minusculeInitiale(sansPoint(d))).join(" ; ")}.`
        : "";
    return `${b.role ? `${b.role} — ` : ""}${b.mission}${quand}`.trim();
}
/** L'identifiant qu'il recevrait, avant de vérifier qu'il est libre. */
export const identifiantPropose = (b) => b.id || identifiantDe(b.nom) || "agent";
/** Le fichier complet, tel que « Créer l'agent » l'écrira (sans mémoire, comme un nouvel agent de l'éditeur). */
export function ficheAgent(b, id) {
    return serialiser([
        ["name", id],
        ["displayName", nomPropre(b.nom)],
        ["description", descriptionFiche(b).replace(/\s*\n\s*/g, " ")],
        ["model", b.modele || "opus"],
    ], corpsFiche(b));
}
/** Le poids de la fiche, relue à chaque appel de l'agent (même estimation que l'éditeur). */
export const jetonsBrouillon = (b) => jetonsEstimes(ficheAgent(b, identifiantPropose(b)));
/** Ce qui manque pour créer l'agent ; vide : il peut naître. */
export function manques(b) {
    return [
        !nomPropre(b.nom) && "un prénom",
        !b.role && "un rôle court",
        !(b.mission || b.description) && "sa mission",
    ].filter((m) => !!m);
}
/** Ce que l'outil répond à l'assistant : où en est la carte, ce qu'il reste à demander. */
export function retourAtelier(b, ajouts = []) {
    const remplis = piliersRemplis(b);
    const reste = PILIERS.filter((p) => !remplis.has(p.cle)).map((p) => p.titre.toLowerCase());
    const jetons = jetonsBrouillon(b);
    const manque = manques(b);
    return [
        `Carte de ${nomPropre(b.nom) || "l’agent"} à jour : ${remplis.size}/5 piliers${reste.length ? ` (reste : ${reste.join(", ")})` : ""}.`,
        `Fiche estimée à ~${jetons} jetons, relus à chaque appel de l’agent${jetons > SEUIL_FICHE_LONGUE ? " : au-delà de 1 500, resserre-la" : ""}.`,
        ajouts.length ? `La personne a ajouté à la fiche (gardé, inutile de le répéter) : ${ajouts.map((a) => `« ${a.texte} »`).join(", ")}.` : "",
        remplis.size === 5 && !b.epreuve ? "Propose ensuite trois demandes pour la mettre à l’épreuve (epreuve : une normale, une floue, une hors de son métier)." : "",
        manque.length
            ? `Pour la créer, il manque : ${manque.join(", ")}.`
            : "Elle la met à l’épreuve et la crée sur la carte, ou l’ajuste dans l’éditeur : ne dis pas qu’il est créé avant qu’elle l’ait fait.",
    ]
        .filter(Boolean)
        .join(" ");
}
/* ─── L'épreuve et la suite ───────────────────────────────────────── */
/** Les trois demandes de l'épreuve, dans l'ordre. */
export function casEpreuve(b) {
    if (!b.epreuve)
        return null;
    return [
        { type: "normal", demande: b.epreuve.normal },
        { type: "floue", demande: b.epreuve.floue },
        { type: "hors-metier", demande: b.epreuve.horsMetier },
    ];
}
/** Les piliers dont un essai raté demande une correction pas encore ajoutée (leur étoile clignote). */
export function piliersEnAlerte(resultats, ajouts) {
    const alerte = new Set();
    for (const r of resultats ?? []) {
        if (r.verdict !== "ko" || !r.correction)
            continue;
        const { pilier, texte: t } = r.correction;
        if (pilier === "methode")
            continue;
        if (!ajouts.some((a) => a.pilier === pilier && comparable(a.texte) === comparable(t)))
            alerte.add(pilier);
    }
    return alerte;
}
export const estPilierListe = (p) => PILIERS_LISTE.includes(p);
/** Les réponses proposées par `proposer_choix` : 2 à 6, distinctes, 120 caractères au plus. */
export function lireChoix(entree) {
    if (!Array.isArray(entree.options))
        return null;
    const vues = new Set();
    const options = entree.options
        .map((o) => texte(o, 120) ?? "")
        .filter((o) => {
        const cle = comparable(o);
        if (!cle || vues.has(cle))
            return false;
        vues.add(cle);
        return true;
    });
    if (options.length < 2 || options.length > 6)
        return null;
    return { question: texte(entree.question, 300) ?? "", options, multiple: entree.multiple === true };
}
/** Le message envoyé quand on choisit : les réponses, dans l'ordre proposé. */
export const texteDuChoix = (choisies) => choisies.join(" · ");
/** Les options que la réponse de la personne reprend (pour les montrer choisies). */
export function optionsRetenues(options, reponse) {
    const r = comparable(reponse);
    return new Set(options.filter((o) => r.includes(comparable(o))));
}
/** Ce qui refuse un appel à `proposer_agent` : un identifiant ou un prénom déjà pris, un voisin hors de l'équipe. */
export function refusAtelier(maj, equipe) {
    if (maj.id && equipe.some((m) => m.id === maj.id))
        return `« ${maj.id} » est déjà dans Mes agents : propose un autre identifiant, ou un changement de sa fiche.`;
    const cible = maj.nom ? comparable(maj.nom) : "";
    const pris = cible ? equipe.find((m) => [m.id, ...m.noms].some((n) => comparable(n) === cible)) : null;
    if (pris)
        return `Elle a déjà un agent qui s’appelle ${pris.noms[0] ?? pris.id} : propose un autre prénom.`;
    const inconnu = maj.voisins?.find((v) => !equipe.some((m) => m.id === v.id));
    if (inconnu)
        return `« ${inconnu.id} » n’est pas un de ses agents actifs : ne cite dans voisins que ceux de Mes agents.`;
    return null;
}
export const SUIVI_VIDE = { brouillon: BROUILLON_VIDE, ajouts: [] };
/**
 * Un appel de plus dans une conversation suivie par un serveur : la carte repart de zéro avec
 * `nouveau`, ou quand l'agent de la carte précédente est maintenant dans l'équipe (créé sur le PC).
 */
export function suivreAtelier(suivi, maj, equipe) {
    const b = suivi.brouillon;
    const cree = !!b.nom && equipe.some((m) => m.id === identifiantPropose(b) && m.noms.some((n) => comparable(n) === comparable(b.nom)));
    const depart = maj.nouveau || cree ? SUIVI_VIDE : suivi;
    return { brouillon: appliquerMaj(depart.brouillon, maj), ajouts: depart.ajouts };
}
export const RETOUR_CHOIX = "Réponses affichées sous ta réponse. Termine ta réponse maintenant : la sienne arrivera dans son prochain message.";
const REFUS_CHOIX = "Propose de 2 à 6 réponses courtes et distinctes.";
const REFUS_VIDE = "Rien à mettre sur la carte : donne au moins un champ (prénom, rôle, mission, piliers…).";
/**
 * Un appel à un outil de l'atelier (`proposer_agent`, `proposer_choix`), le même sur ce PC et sur un
 * VPS : ce que l'outil répond à l'assistant, refus compris, et la carte suivie après l'appel.
 */
export function appelAtelier(nom, args, suivi, equipe) {
    if (nom === OUTIL_CHOIX.name)
        return lireChoix(args) ? { texte: RETOUR_CHOIX, erreur: false, suivi } : { texte: REFUS_CHOIX, erreur: true, suivi };
    const maj = lireMajAtelier(args);
    if (!maj)
        return { texte: REFUS_VIDE, erreur: true, suivi };
    const refus = refusAtelier(maj, equipe);
    if (refus)
        return { texte: refus, erreur: true, suivi };
    const suite = suivreAtelier(suivi, maj, equipe);
    return { texte: retourAtelier(appliquerAjouts(suite.brouillon, suite.ajouts), suite.ajouts), erreur: false, suivi: suite };
}
/** Les noms des outils de l'atelier, tels que Claude Code les voit. */
export const OUTILS_ATELIER = [`mcp__klyra__${OUTIL_PROPOSER.name}`, `mcp__klyra__${OUTIL_CHOIX.name}`];
