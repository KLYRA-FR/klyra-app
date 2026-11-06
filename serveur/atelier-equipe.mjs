// Généré par scripts/serveur-genere.mjs depuis electron/atelier-equipe.ts : ne pas modifier à la main.
import { appliquerMaj, BROUILLON_VIDE, comparable, identifiantDe, identifiantPropre, jetonsBrouillon, lireMajAtelier, manques, nomPropre, piliersRemplis, PILIERS, } from "./atelier-agent.mjs";
export const EQUIPE_VIDE = { nom: "", but: "", taches: [], groupes: [], membres: [], existants: [], exemples: [] };
/** Au plus, pour que la table reste lisible. */
export const MAX_TACHES = 20;
/** Au-delà, une équipe se pilote mal : l'assistant ne confie que cinq travaux à la fois (`TRAVAUX_MAX`). */
export const MAX_MEMBRES = 6;
/* ─── L'outil de l'assistant ──────────────────────────────────────── */
const tableau = (description) => ({ type: "array", items: { type: "string" }, description });
export const OUTIL_EQUIPE = {
    name: "proposer_equipe",
    description: "Montre et complète, dans la conversation, l'atelier d'une équipe d'agents à composer avec la personne, en partant de ses tâches (après lui avoir posé tes questions, proposer_choix). Trois temps : 1) taches : ce qui revient dans sa semaine, avec ses mots (pourElle: true pour ce qu'elle garde ; origine \"assistant\" et pourquoi pour une tâche que tu ajoutes, qu'elle gardera ou retirera) ; 2) quand elle a validé ses tâches : groupes, et le groupe de chaque tâche ; 3) quand elle a validé les groupes : un membre par groupe (id et groupe), sans nom tant qu'elle n'a pas choisi (suggère-en dans prenoms), ses piliers tirés de ce qu'elle a dit ; recopie dans proposes le texte exact de chaque ligne que tu ajoutes toi-même. Appelle-le après chaque réponse utile, avec seulement ce qui change : chaque élément complète celui du même id, retirer: true l'enlève. Elle crée l'équipe d'un clic sur la carte : rien n'est créé par cet outil. Phrases courtes. N'y répète pas ce que l'app donne déjà à chaque agent.",
    inputSchema: {
        type: "object",
        properties: {
            nouveau: { type: "boolean", description: "true pour commencer la carte d'une autre équipe." },
            nom: { type: "string", description: "Le nom de l'équipe (ex. Studio contenu)." },
            but: { type: "string", description: "Ce que l'équipe fait pour elle, en une phrase." },
            taches: {
                type: "array",
                description: `Ses tâches, ${MAX_TACHES} au plus, avec ses mots.`,
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "Identifiant court et stable (minuscules, tirets)." },
                        texte: { type: "string", description: "La tâche telle qu'elle l'a dite." },
                        origine: { type: "string", enum: ["personne", "assistant"], description: "assistant : une tâche que tu ajoutes, sans qu'elle l'ait dite." },
                        pourquoi: { type: "string", description: "Pour une tâche que tu ajoutes : pourquoi, en une phrase." },
                        pourElle: { type: "boolean", description: "true : elle la garde pour elle." },
                        groupe: { type: "string", description: "L'id de son groupe (temps 2)." },
                        retirer: { type: "boolean" },
                    },
                },
            },
            groupes: {
                type: "array",
                description: `Les groupes de tâches (temps 2), ${MAX_MEMBRES} au plus : chacun deviendra un agent. Leur nombre vient de ses tâches.`,
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        nom: { type: "string", description: "Ce que le groupe couvre, en quelques mots (ex. Les textes)." },
                        pourquoi: { type: "string", description: "Pourquoi ces tâches vont ensemble, en une phrase courte." },
                        retirer: { type: "boolean" },
                    },
                    required: ["id"],
                },
            },
            membres: {
                type: "array",
                description: `Les agents à créer (temps 3), un par groupe, ${MAX_MEMBRES} au plus.`,
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "Identifiant stable : minuscules, chiffres et tirets." },
                        groupe: { type: "string", description: "L'id du groupe dont il naît." },
                        nom: { type: "string", description: "Son prénom, seulement celui qu'elle a choisi." },
                        prenoms: tableau("Deux ou trois prénoms à lui suggérer."),
                        role: { type: "string", description: "Son rôle court." },
                        mission: { type: "string", description: "Sa mission, en une phrase, d'après ses tâches." },
                        declencheurs: tableau("Quand l'appeler (ses tâches de ce groupe, avec ses mots)."),
                        livrables: tableau("Ce qu'il rend."),
                        methode: tableau("Comment il travaille : 3 à 5 règles."),
                        limites: tableau("Ce qu'il ne fait pas, ou seulement avec l'accord de la personne."),
                        verification: tableau("Comment il vérifie son travail."),
                        proposes: tableau("Le texte exact de chaque ligne ci-dessus que tu ajoutes sans qu'elle l'ait dite."),
                        modele: { type: "string", enum: ["opus", "sonnet", "haiku"], description: "Seulement si la personne l'a choisi." },
                        retirer: { type: "boolean", description: "true pour le retirer de l'équipe." },
                    },
                    required: ["id"],
                },
            },
            existants: {
                type: "array",
                description: "Ses agents actifs qui font partie de cette équipe, tels quels.",
                items: { type: "object", properties: { id: { type: "string" }, raison: { type: "string", description: "Ce qu'il y fait, en une phrase." } }, required: ["id", "raison"] },
            },
            exemples: {
                type: "array",
                description: "Seulement sans taches : 3 à 5 de ses vraies demandes, chacune avec l'agent qui en serait seul responsable (id d'un membre, d'un agent actif, ou principal pour toi).",
                items: { type: "object", properties: { demande: { type: "string" }, membre: { type: "string" } }, required: ["demande", "membre"] },
            },
        },
    },
};
/** Ce que l'assistant apprend de l'atelier d'équipe, avec celui d'un agent (CONSIGNE_ATELIER). */
export const CONSIGNE_EQUIPE = `Pour composer une équipe (plusieurs agents d'un coup), pars de ses tâches, jamais d'agents tout faits : d'abord des questions ouvertes, une à la fois (proposer_choix), sur ce qui revient dans sa semaine et ce qu'elle garde pour elle ; pose ses tâches avec ses mots (proposer_equipe, taches) ; quand elle les valide, propose des groupes, sans nombre fixé, et demande si elle veut un agent ou plusieurs ; quand elle valide les groupes, un membre par groupe, sans prénom (suggère-en), et demande ce que tu ne sais pas au lieu de l'inventer. Ce que tu ajoutes de toi-même est marqué (origine assistant, proposes). Un appel par retouche, avec seulement ce qui change. Elle crée l'équipe sur la carte ; un membre s'affine dans son propre atelier (proposer_agent, même id).`;
/* ─── Lecture de l'outil ──────────────────────────────────────────── */
const texte = (v, max) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : undefined);
const textes = (v, n, max) => Array.isArray(v)
    ? v
        .map((x) => texte(x, max) ?? "")
        .filter(Boolean)
        .slice(0, n)
    : typeof v === "string" && v.trim()
        ? [texte(v, max)]
        : undefined;
const objets = (v) => (Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? x : {})) : null);
/** La clé d'un membre : son identifiant, sinon tiré de son prénom. */
export const cleMembre = (m) => (m.id ? identifiantPropre(m.id) : "") || (m.nom ? identifiantDe(m.nom) : "");
/** La clé d'une tâche : son identifiant, sinon tiré de son texte. */
export const cleTache = (t) => (t.id ? identifiantPropre(t.id) : "") || (t.texte ? identifiantDe(t.texte).slice(0, 40) : "");
function lireMembre(v) {
    if (!v || typeof v !== "object")
        return null;
    const o = v;
    // Les champs d'un agent, lus comme dans son atelier (sans ce qui n'a pas sa place dans une équipe).
    const { nouveau: _n, epreuve: _e, voisins: _v, routine: _r, consignes: _c, ...champs } = lireMajAtelier(o) ?? {};
    void _n;
    void _e;
    void _v;
    void _r;
    void _c;
    const membre = { ...champs, ...(o.retirer === true ? { retirer: true } : {}) };
    const groupe = texte(o.groupe, 64);
    if (groupe)
        membre.groupe = identifiantPropre(groupe);
    const prenoms = textes(o.prenoms, 4, 40);
    if (prenoms)
        membre.prenoms = prenoms;
    const proposes = textes(o.proposes, 30, 300);
    if (proposes)
        membre.proposes = proposes;
    return cleMembre(membre) ? membre : null;
}
function lireTache(o) {
    const t = {};
    const id = texte(o.id, 64);
    if (id)
        t.id = identifiantPropre(id);
    const tx = texte(o.texte, 200);
    if (tx)
        t.texte = tx;
    if (o.origine === "personne" || o.origine === "assistant")
        t.origine = o.origine;
    const pourquoi = texte(o.pourquoi, 200);
    if (pourquoi !== undefined)
        t.pourquoi = pourquoi;
    if (typeof o.pourElle === "boolean")
        t.pourElle = o.pourElle;
    const groupe = texte(o.groupe, 64);
    if (groupe !== undefined)
        t.groupe = identifiantPropre(groupe);
    if (o.retirer === true)
        t.retirer = true;
    return cleTache(t) ? t : null;
}
/** Ce qu'un appel à `proposer_equipe` apprend ; `null` s'il n'apprend rien. */
export function lireMajEquipe(entree) {
    const maj = {};
    if (entree.nouveau === true)
        maj.nouveau = true;
    const nom = texte(entree.nom, 60);
    if (nom !== undefined)
        maj.nom = nom;
    const but = texte(entree.but, 300);
    if (but !== undefined)
        maj.but = but;
    const taches = objets(entree.taches)
        ?.map(lireTache)
        .filter((t) => !!t)
        .slice(0, MAX_TACHES * 2);
    if (taches?.length)
        maj.taches = taches;
    const groupes = objets(entree.groupes)
        ?.map((x) => {
        const id = identifiantPropre(texte(x.id, 64) ?? "");
        if (!id)
            return null;
        const g = { id };
        const n = texte(x.nom, 60);
        if (n !== undefined)
            g.nom = n;
        const pq = texte(x.pourquoi, 200);
        if (pq !== undefined)
            g.pourquoi = pq;
        if (x.retirer === true)
            g.retirer = true;
        return g;
    })
        .filter((g) => !!g)
        .slice(0, MAX_MEMBRES * 2);
    if (groupes?.length)
        maj.groupes = groupes;
    if (Array.isArray(entree.membres)) {
        const membres = entree.membres.map(lireMembre).filter((m) => !!m);
        if (membres.length)
            maj.membres = membres.slice(0, MAX_MEMBRES * 2);
    }
    if (Array.isArray(entree.existants)) {
        maj.existants = entree.existants
            .map((x) => (x && typeof x === "object" ? x : {}))
            .map((x) => ({ id: identifiantPropre(texte(x.id, 64) ?? ""), raison: texte(x.raison, 200) ?? "" }))
            .filter((x) => x.id && x.raison)
            .slice(0, 6);
    }
    if (Array.isArray(entree.exemples)) {
        maj.exemples = entree.exemples
            .map((x) => (x && typeof x === "object" ? x : {}))
            .map((x) => ({ demande: texte(x.demande, 200) ?? "", membre: texte(x.membre, 64) ?? "" }))
            .filter((x) => x.demande && x.membre)
            .slice(0, 6);
    }
    return Object.keys(maj).length ? maj : null;
}
/* ─── La carte après un appel ─────────────────────────────────────── */
/** Le membre que désigne une clé ou un prénom. */
function trouverMembre(membres, m) {
    const cle = cleMembre(m);
    const parCle = membres.findIndex((x) => x.cle === cle);
    if (parCle !== -1 || m.id)
        return parCle;
    const nom = m.nom ? comparable(m.nom) : "";
    return nom ? membres.findIndex((x) => comparable(x.agent.nom) === nom) : -1;
}
/** Le responsable d'un exemple, ramené à une clé connue (membre, agent actif, assistant) si possible. */
function cleResponsable(b, membre) {
    const cible = comparable(membre);
    const parCle = identifiantPropre(membre);
    const m = b.membres.find((x) => x.cle === parCle || comparable(x.agent.nom) === cible);
    if (m)
        return m.cle;
    return parCle;
}
/** Les champs d'une carte d'une version précédente (sans tâches ni groupes) : rien ne manque. */
const complet = (b) => ({
    ...b,
    taches: b.taches ?? [],
    groupes: b.groupes ?? [],
    membres: b.membres.map((m) => ({ ...m, groupe: m.groupe ?? "", prenoms: m.prenoms ?? [], proposes: m.proposes ?? [] })),
});
function appliquerTaches(taches, majs) {
    let suite = taches;
    for (const t of majs) {
        const cle = cleTache(t);
        const i = suite.findIndex((x) => x.id === cle);
        if (t.retirer) {
            if (i !== -1)
                suite = suite.filter((_, j) => j !== i);
            continue;
        }
        const avant = i === -1 ? { id: cle, texte: "", origine: "personne", pourquoi: "", pourElle: false, groupe: "", gardee: false } : suite[i];
        const apres = {
            ...avant,
            texte: t.texte ?? avant.texte,
            origine: t.origine ?? avant.origine,
            pourquoi: t.pourquoi ?? avant.pourquoi,
            // Rangée dans un groupe : elle n'est plus pour elle, sauf si l'appel le redit.
            pourElle: t.pourElle ?? (t.groupe ? false : avant.pourElle),
            groupe: t.pourElle ? "" : (t.groupe ?? avant.groupe),
        };
        if (!apres.texte)
            continue;
        suite = i === -1 ? [...suite, apres] : suite.map((x, j) => (j === i ? apres : x));
    }
    return suite;
}
function appliquerGroupes(groupes, majs) {
    let suite = groupes;
    for (const g of majs) {
        const i = suite.findIndex((x) => x.id === g.id);
        if (g.retirer) {
            if (i !== -1)
                suite = suite.filter((_, j) => j !== i);
            continue;
        }
        const apres = { id: g.id, nom: g.nom ?? suite[i]?.nom ?? "", pourquoi: g.pourquoi ?? suite[i]?.pourquoi ?? "" };
        suite = i === -1 ? [...suite, apres] : suite.map((x, j) => (j === i ? apres : x));
    }
    return suite;
}
/** La carte après un appel : chaque élément donné complète le sien, `nouveau` repart de zéro. */
export function appliquerMajEquipe(brouillon, maj) {
    const depart = maj.nouveau ? EQUIPE_VIDE : complet(brouillon);
    let membres = depart.membres;
    for (const m of maj.membres ?? []) {
        const i = trouverMembre(membres, m);
        if (m.retirer) {
            if (i !== -1)
                membres = membres.filter((_, j) => j !== i);
            continue;
        }
        const { retirer: _r, groupe, prenoms, proposes, ...champs } = m;
        void _r;
        if (i === -1) {
            const cle = cleMembre(m);
            membres = [...membres, { cle, agent: { ...appliquerMaj(BROUILLON_VIDE, champs), id: cle }, groupe: groupe ?? "", prenoms: prenoms ?? [], proposes: proposes ?? [] }];
        }
        else {
            // L'identifiant d'un membre ne change plus : un autre id donné n'en fait pas un autre agent.
            const { id: _id, ...reste } = champs;
            void _id;
            membres = membres.map((x, j) => j === i ? { ...x, agent: { ...appliquerMaj(x.agent, reste), id: x.cle }, groupe: groupe ?? x.groupe, prenoms: prenoms ?? x.prenoms, proposes: proposes ?? x.proposes } : x);
        }
    }
    const groupes = appliquerGroupes(depart.groupes, maj.groupes ?? []);
    // Une tâche dont le groupe a disparu n'est plus rangée.
    const taches = appliquerTaches(depart.taches, maj.taches ?? []).map((t) => (t.groupe && !groupes.some((g) => g.id === t.groupe) ? { ...t, groupe: "" } : t));
    const suite = {
        nom: maj.nom ?? depart.nom,
        but: maj.but ?? depart.but,
        taches,
        groupes,
        membres,
        existants: maj.existants ?? depart.existants,
        exemples: depart.exemples,
    };
    const exemples = maj.exemples ?? depart.exemples;
    return { ...suite, exemples: exemples.map((e) => ({ ...e, membre: cleResponsable(suite, e.membre) })) };
}
/** La place d'une tâche qu'elle garde pour elle, et d'une tâche qu'elle confiera (pas encore rangée). */
export const ELLE = "elle";
export const A_CONFIER = "a-confier";
const LISTES_AGENT = ["declencheurs", "livrables", "methode", "limites", "verification"];
export function appliquerChoix(brouillon, choix) {
    if (!choix)
        return brouillon;
    const b = complet(brouillon);
    const taches = b.taches
        .filter((t) => choix.taches?.[t.id] !== false)
        .map((t) => {
        const place = choix.places?.[t.id];
        const suite = choix.taches?.[t.id] === true ? { ...t, gardee: true } : t;
        if (place === ELLE)
            return { ...suite, pourElle: true, groupe: "" };
        if (place === A_CONFIER)
            return { ...suite, pourElle: false };
        if (place && b.groupes.some((g) => g.id === place))
            return { ...suite, pourElle: false, groupe: place };
        return suite;
    });
    const membres = b.membres.map((m) => {
        const prenom = nomPropre(choix.prenoms?.[m.cle] ?? "");
        const lignes = choix.lignes?.[m.cle] ?? {};
        const retirees = new Set(Object.keys(lignes).filter((t) => lignes[t] === false).map(comparable));
        const tranchees = new Set(Object.keys(lignes).map(comparable));
        const agent = { ...m.agent, ...(prenom ? { nom: prenom } : {}) };
        for (const cle of LISTES_AGENT)
            agent[cle] = agent[cle].filter((x) => !retirees.has(comparable(x)));
        return { ...m, agent, proposes: m.proposes.filter((x) => !tranchees.has(comparable(x))) };
    });
    return { ...b, taches, membres };
}
/** Deux choix notés sur le même appel : le second complète le premier. */
export function fusionnerChoix(a, c) {
    const lignes = { ...(a?.lignes ?? {}) };
    for (const [cle, l] of Object.entries(c.lignes ?? {}))
        lignes[cle] = { ...(lignes[cle] ?? {}), ...l };
    return {
        taches: { ...(a?.taches ?? {}), ...(c.taches ?? {}) },
        places: { ...(a?.places ?? {}), ...(c.places ?? {}) },
        prenoms: { ...(a?.prenoms ?? {}), ...(c.prenoms ?? {}) },
        lignes,
    };
}
export const etapeEquipe = (b) => (b.membres.length ? "equipe" : (b.groupes ?? []).length ? "groupes" : "taches");
/** Une tâche que l'assistant propose et qu'elle n'a pas encore gardée. */
export const tacheProposee = (t) => t.origine === "assistant" && !t.gardee;
/** Les tâches d'un groupe, dans l'ordre de la carte. */
export const tachesDuGroupe = (b, groupe) => (b.taches ?? []).filter((t) => !t.pourElle && t.groupe === groupe);
/** Une ligne d'un membre encore proposée (à garder ou retirer). */
export const ligneProposee = (m, ligne) => (m.proposes ?? []).some((x) => comparable(x) === comparable(ligne));
/**
 * L'agent tel que sa fiche sera écrite : sans les lignes proposées qu'elle n'a pas gardées, et quand
 * l'assistant n'a rien écrit dans « Quand l'appeler », les tâches de son groupe (dites ou gardées).
 */
export function agentDuMembre(b, m) {
    const proposes = new Set((m.proposes ?? []).map(comparable));
    const agent = { ...m.agent };
    for (const cle of LISTES_AGENT)
        agent[cle] = agent[cle].filter((x) => !proposes.has(comparable(x)));
    if (!agent.declencheurs.length && m.groupe)
        agent.declencheurs = tachesDuGroupe(b, m.groupe).filter((t) => !tacheProposee(t)).map((t) => t.texte);
    return agent;
}
/** Les jetons de toutes les fiches de l'équipe (chacune relue quand son agent est appelé). */
export const jetonsEquipe = (b, membres = b.membres) => membres.reduce((t, m) => t + jetonsBrouillon(agentDuMembre(b, m)), 0);
/** Comment la carte nomme un membre sans prénom. */
export const nomMembre = (m) => nomPropre(m.agent.nom) || m.agent.role || m.cle;
/** Ce qui manque à un membre pour naître (vide : il peut naître). */
export const manquesMembre = (b, m) => manques(agentDuMembre(b, m));
/** Ce qui manque à l'équipe pour naître, avec les membres choisis. */
export function manquesEquipe(b, choisis) {
    if (!choisis.length)
        return [b.membres.length ? "au moins un agent gardé" : "au moins un agent"];
    return choisis.flatMap((m) => {
        const manque = manquesMembre(b, m);
        return manque.length ? [`${manque.join(", ")} à ${nomPropre(m.agent.nom) || `l’agent ${m.agent.role ? `« ${m.agent.role} »` : m.cle}`}`] : [];
    });
}
/* ─── Vérifier un appel, suivre une conversation ──────────────────── */
const nomsPris = (equipe, nom) => {
    const cible = comparable(nom);
    return cible ? (equipe.find((m) => [m.id, ...m.noms].some((n) => comparable(n) === cible)) ?? null) : null;
};
/**
 * Ce qui refuse un appel : un membre nouveau dont l'identifiant ou le prénom est déjà dans Mes agents
 * (il va dans `existants`), deux membres du même prénom, un agent cité hors de l'équipe, un groupe
 * inconnu, trop de membres, de groupes ou de tâches. Un membre déjà sur la carte reste accepté s'il a
 * été créé entre-temps par sa propre carte.
 */
export function refusEquipe(maj, avant, apres, equipe) {
    const deja = new Set((maj.nouveau ? EQUIPE_VIDE : avant).membres.map((m) => m.cle));
    for (const m of maj.membres ?? []) {
        if (m.retirer)
            continue;
        const i = trouverMembre(apres.membres, m);
        const cle = i === -1 ? cleMembre(m) : apres.membres[i].cle;
        if (deja.has(cle))
            continue;
        if (equipe.some((e) => e.id === cle))
            return `« ${cle} » est déjà dans Mes agents : mets-le dans existants, ou donne un autre id.`;
        const pris = m.nom ? nomsPris(equipe, m.nom) : null;
        if (pris)
            return `Elle a déjà un agent qui s’appelle ${pris.noms[0] ?? pris.id} : mets-le dans existants, ou propose un autre prénom.`;
    }
    if (apres.membres.length > MAX_MEMBRES)
        return `${MAX_MEMBRES} agents au plus dans une équipe : regroupe des métiers, ou retire un membre.`;
    if (apres.groupes.length > MAX_MEMBRES)
        return `${MAX_MEMBRES} groupes au plus : chacun deviendra un agent.`;
    if (apres.taches.length > MAX_TACHES)
        return `${MAX_TACHES} tâches au plus sur la table : regroupe celles qui se ressemblent.`;
    const groupeConnu = (g) => apres.groupes.some((x) => x.id === g);
    const tacheHors = (maj.taches ?? []).find((t) => !t.retirer && t.groupe && !groupeConnu(t.groupe));
    if (tacheHors)
        return `Le groupe « ${tacheHors.groupe} » n’existe pas : crée-le d’abord dans groupes.`;
    const membreHors = (maj.membres ?? []).find((m) => !m.retirer && m.groupe && !groupeConnu(m.groupe));
    if (membreHors)
        return `Le groupe « ${membreHors.groupe} » n’existe pas : donne à chaque membre l’id d’un groupe de la carte.`;
    const vus = new Map();
    for (const m of apres.membres) {
        const nom = comparable(m.agent.nom);
        if (!nom)
            continue;
        if (vus.has(nom))
            return `Deux agents s’appellent ${nomPropre(m.agent.nom)} : donne-leur deux prénoms.`;
        vus.set(nom, m.cle);
    }
    const inconnu = apres.existants.find((v) => !equipe.some((e) => e.id === v.id));
    if (inconnu)
        return `« ${inconnu.id} » n’est pas un de ses agents actifs : ne cite dans existants que ceux de Mes agents.`;
    const connus = new Set(["principal", ...apres.membres.map((m) => m.cle), ...equipe.map((e) => e.id)]);
    const perdu = apres.exemples.find((e) => !connus.has(e.membre));
    if (perdu)
        return `« ${perdu.membre} » n’est ni un membre de l’équipe ni un de ses agents : donne pour chaque exemple l’id de son responsable.`;
    return null;
}
/** Ce que l'outil répond à l'assistant : où en est l'équipe, ce qu'il reste à faire, sans jamais la dire créée. */
export function retourEquipe(brouillon) {
    const b = complet(brouillon);
    const etape = etapeEquipe(b);
    const taches = b.taches.map((t) => `${t.id} « ${t.texte} »${t.pourElle ? " (pour elle)" : t.groupe ? ` → ${t.groupe}` : ""}${tacheProposee(t) ? " (ta proposition, en attente de sa réponse)" : ""}`);
    const membres = b.membres.map((m) => {
        const agent = agentDuMembre(b, m);
        const remplis = piliersRemplis(agent);
        const reste = PILIERS.filter((p) => !remplis.has(p.cle)).map((p) => p.titre.toLowerCase());
        return `${nomPropre(m.agent.nom) || "sans prénom"} (${m.cle}${m.groupe ? `, groupe ${m.groupe}` : ""}${m.agent.role ? `, ${m.agent.role}` : ""}) ${remplis.size}/5${reste.length ? `, reste : ${reste.join(", ")}` : ""}${m.proposes.length ? `, ${m.proposes.length} ligne${m.proposes.length > 1 ? "s" : ""} proposée${m.proposes.length > 1 ? "s" : ""} à son choix` : ""}`;
    });
    const manque = b.membres.flatMap((m) => {
        const l = manquesMembre(b, m);
        return l.length ? [`${nomMembre(m)} : ${l.join(", ")}`] : [];
    });
    const sansGroupe = b.taches.filter((t) => !t.pourElle && !t.groupe);
    const groupesSansMembre = b.groupes.filter((g) => !b.membres.some((m) => m.groupe === g.id));
    return [
        `Équipe${b.nom ? ` « ${b.nom} »` : ""} à jour : ${b.membres.length} agent${b.membres.length > 1 ? "s" : ""}${membres.length ? ` — ${membres.join(" ; ")}` : ""}.`,
        taches.length ? `Tâches : ${taches.join(" ; ")}.` : "",
        b.groupes.length ? `Groupes : ${b.groupes.map((g) => `${g.id} « ${g.nom} »`).join(" ; ")}.` : "",
        b.existants.length ? `Avec ses agents actifs : ${b.existants.map((e) => e.id).join(", ")}.` : "",
        b.membres.length ? `Fiches estimées à ~${jetonsEquipe(b)} jetons en tout, chacune relue quand son agent est appelé.` : "",
        etape === "taches" ? "Attends qu’elle valide ses tâches sur la carte avant de proposer des groupes." : "",
        etape === "groupes" && sansGroupe.length ? `À ranger : ${sansGroupe.map((t) => t.id).join(", ")}.` : "",
        etape === "groupes" ? "Attends qu’elle valide les groupes avant de composer les agents ; demande-lui si elle veut un agent ou plusieurs." : "",
        etape === "equipe" && groupesSansMembre.length ? `Groupes sans agent : ${groupesSansMembre.map((g) => g.id).join(", ")}.` : "",
        manque.length ? `Pour naître, il manque : ${manque.join(" ; ")}.` : "",
        b.membres.some((m) => !nomPropre(m.agent.nom)) ? "Le prénom est le sien : suggère-en dans prenoms, elle choisit sur la carte." : "",
        !b.taches.length && b.membres.length >= 2 && b.exemples.length < 3 ? "Ajoute 3 à 5 de ses vraies demandes dans exemples, chacune avec son responsable." : "",
        "Elle choisit et crée l’équipe sur la carte : ne dis pas qu’elle est créée avant qu’elle l’ait fait.",
    ]
        .filter(Boolean)
        .join(" ");
}
/**
 * L'agent d'un membre est maintenant dans l'équipe (créé sur le PC, par la carte d'équipe ou la
 * sienne). Un membre sans prénom (choisi sur le PC, que le serveur ne voit pas) se reconnaît à son
 * identifiant : un membre nouveau ne peut pas prendre celui d'un agent déjà là (refusEquipe).
 */
export const membreNe = (m, equipe) => equipe.some((e) => e.id === m.cle && (!m.agent.nom || e.noms.some((n) => comparable(n) === comparable(m.agent.nom))));
/**
 * Un appel de plus dans une conversation suivie par un serveur (un VPS n'a pas le fil) : la carte
 * repart de zéro avec `nouveau`, ou quand un de ses agents est maintenant dans l'équipe (créée sur le PC).
 */
export function suivreEquipe(suivi, maj, equipe) {
    const nee = suivi.membres.some((m) => membreNe(m, equipe));
    return appliquerMajEquipe(nee ? EQUIPE_VIDE : suivi, maj);
}
const REFUS_VIDE = "Rien à mettre sur la carte : donne au moins un champ (nom, but, taches, groupes, membres, existants, exemples).";
/**
 * Un appel à `proposer_equipe`, le même sur ce PC et sur un VPS : ce que l'outil répond à l'assistant,
 * refus compris, et la carte suivie après l'appel (les réponses toutes prêtes restent à appelAtelier).
 */
export function appelEquipe(args, suivi, equipe) {
    const maj = lireMajEquipe(args);
    if (!maj)
        return { texte: REFUS_VIDE, erreur: true, suivi };
    const apres = suivreEquipe(suivi, maj, equipe);
    const avant = suivi.membres.some((m) => membreNe(m, equipe)) ? EQUIPE_VIDE : complet(suivi);
    const refus = refusEquipe(maj, avant, apres, equipe);
    if (refus)
        return { texte: refus, erreur: true, suivi };
    return { texte: retourEquipe(apres), erreur: false, suivi: apres };
}
export const OUTIL_EQUIPE_CLAUDE = `mcp__klyra__${OUTIL_EQUIPE.name}`;
