// Généré par scripts/serveur-genere.mjs depuis electron/connaissances-agent.ts : ne pas modifier à la main.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nomsCoupes, skillRecue, validerSkillsParAgent } from "./skills-par-agent.mjs";
export const INDEX = "MEMORY.md";
/** Ce que Claude Code lit de l'index à chaque appel. */
export const LIGNES_INDEX = 200;
const NOM_AGENT = /^[a-z0-9][a-z0-9-]*$/;
/** Au-delà, la liste est coupée (et le dit) : une mémoire n'a pas des milliers de fichiers. */
const MAX_SOUVENIRS = 500;
export class ErreurConnaissances extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
/** Le dossier de la mémoire d'un agent, d'après sa portée et le dossier de travail de la conversation. */
export function dossierMemoire(agent, portee, dossierTravail, configClaude) {
    if (!NOM_AGENT.test(agent))
        throw new ErreurConnaissances("nom-invalide", `Nom d’agent invalide : « ${agent} ».`);
    switch (portee) {
        case "user":
            return path.join(configClaude, "agent-memory", agent);
        case "project":
            return path.join(dossierTravail, ".claude", "agent-memory", agent);
        case "local":
            return path.join(dossierTravail, ".claude", "agent-memory-local", agent);
        case "auto":
            // Comme `sessionsDuDossier` (atelier.ts) : chaque signe hors lettres et chiffres en « - ».
            return path.join(configClaude, "projects", dossierTravail.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
        default:
            throw new ErreurConnaissances("portee-invalide", "Portée de mémoire inconnue.");
    }
}
export const porteeValide = (p) => p === "user" || p === "project" || p === "local" || p === "auto";
/** La portée de la mémoire d'une fiche (`memory` de son en-tête) ; null : l'agent n'a pas de mémoire. */
export function porteeDeLaFiche(contenu) {
    const p = champ(contenu, "memory");
    return p === "user" || p === "project" || p === "local" ? p : null;
}
/** Un en-tête YAML simple : `cle: valeur` (entre guillemets ou non). */
function champ(contenu, cle) {
    const entete = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contenu)?.[1] ?? "";
    const ligne = new RegExp(`^${cle}:\\s*(.*)$`, "m").exec(entete)?.[1]?.trim() ?? "";
    return ligne.replace(/^(["'])([\s\S]*)\1$/, "$2");
}
/** Le texte sans son en-tête YAML. */
function corps(contenu) {
    return contenu.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
/** La première ligne de texte (ni titre, ni liste vide, ni séparateur), raccourcie. */
function premiereLigne(texte) {
    for (const brute of texte.split(/\r?\n/)) {
        const ligne = brute.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim();
        if (ligne && !/^[-=*_]{3,}$/.test(ligne))
            return ligne.length > 160 ? `${ligne.slice(0, 159)}…` : ligne;
    }
    return "";
}
function souvenirDe(dossier, id) {
    const fichier = path.join(dossier, id);
    const contenu = readFileSync(fichier, "utf8");
    const stat = statSync(fichier);
    if (id === INDEX) {
        const lignes = contenu.split(/\r?\n/).filter((l) => l.trim()).length;
        return {
            id,
            titre: "Index de la mémoire",
            description: lignes ? `${lignes} ligne${lignes > 1 ? "s" : ""}${lignes > LIGNES_INDEX ? `, les ${LIGNES_INDEX} premières lues` : ""}` : "Vide",
            toujours: true,
            modifieLe: stat.mtimeMs,
        };
    }
    const texte = corps(contenu);
    const titre = champ(contenu, "name") || /^#\s+(.+)$/m.exec(texte)?.[1]?.trim() || id.replace(/\.md$/i, "").split("/").pop();
    return { id, titre, description: champ(contenu, "description") || premiereLigne(texte.replace(/^#\s+.+$/m, "")), toujours: false, modifieLe: stat.mtimeMs };
}
/** Les fichiers `.md` de la mémoire (deux niveaux de dossiers au plus), l'index d'abord puis les plus récents. */
export function lireMemoire(portee, dossier) {
    const ids = [];
    let coupee = false;
    const parcourir = (relatif, profondeur) => {
        let entrees;
        try {
            entrees = readdirSync(path.join(dossier, relatif), { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entrees) {
            if (e.name.startsWith("."))
                continue;
            const id = relatif ? `${relatif}/${e.name}` : e.name;
            if (e.isDirectory() && profondeur < 2)
                parcourir(id, profondeur + 1);
            else if (e.isFile() && /\.md$/i.test(e.name)) {
                if (ids.length >= MAX_SOUVENIRS)
                    coupee = true;
                else
                    ids.push(id);
            }
        }
    };
    parcourir("", 0);
    const souvenirs = ids
        .map((id) => {
        try {
            return souvenirDe(dossier, id);
        }
        catch {
            return null;
        }
    })
        .filter((s) => s !== null)
        .sort((a, b) => Number(b.toujours) - Number(a.toujours) || b.modifieLe - a.modifieLe);
    return { portee, dossier, souvenirs, coupee };
}
/** Le chemin d'un souvenir, gardé dans le dossier de la mémoire (ni `..`, ni chemin absolu, ni autre chose qu'un `.md`). */
export function cheminSouvenir(dossier, id) {
    if (typeof id !== "string" || !/\.md$/i.test(id) || path.isAbsolute(id) || id.includes("\0"))
        throw new ErreurConnaissances("chemin-invalide", "Ce souvenir n’est pas dans la mémoire de l’agent.");
    const fichier = path.resolve(dossier, id);
    const relatif = path.relative(path.resolve(dossier), fichier);
    if (!relatif || relatif.startsWith("..") || path.isAbsolute(relatif))
        throw new ErreurConnaissances("chemin-invalide", "Ce souvenir n’est pas dans la mémoire de l’agent.");
    return fichier;
}
export function lireSouvenir(dossier, id) {
    const fichier = cheminSouvenir(dossier, id);
    if (!existsSync(fichier))
        throw new ErreurConnaissances("introuvable", "Ce souvenir n’existe plus.");
    return { contenu: readFileSync(fichier, "utf8"), modifieLe: statSync(fichier).mtimeMs };
}
/** Réécrit un souvenir ; refuse si le fichier a changé depuis sa lecture (`attendu`, en ms). */
export function ecrireSouvenir(dossier, id, contenu, attendu) {
    const fichier = cheminSouvenir(dossier, id);
    if (!existsSync(fichier))
        throw new ErreurConnaissances("introuvable", "Ce souvenir n’existe plus.");
    if (attendu !== null && Math.abs(statSync(fichier).mtimeMs - attendu) > 1)
        throw new ErreurConnaissances("conflit", "Le souvenir a changé pendant ta modification (l’agent l’a peut-être mis à jour). Rouvre-le : rien n’a été écrasé.");
    writeFileSync(fichier, contenu.endsWith("\n") ? contenu : `${contenu}\n`, "utf8");
    return { modifieLe: statSync(fichier).mtimeMs };
}
/** « Réunion du 3 nov. » → `reunion-du-3-nov` (minuscules, sans accents). */
export function nomDeFichier(titre) {
    const base = titre
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
    return base || "souvenir";
}
const yaml = (v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s*\n\s*/g, " ")}"`;
/**
 * Un nouveau souvenir, comme Claude Code les écrit : un fichier avec `name` et `description` en
 * en-tête, et sa ligne dans l'index (créé au besoin), pour que l'agent sache qu'il existe.
 * Jamais d'écrasement : un nom déjà pris reçoit un suffixe.
 */
export function creerSouvenir(dossier, titre, contenu) {
    const propre = titre.trim().replace(/\s+/g, " ");
    if (!propre || !contenu.trim())
        throw new ErreurConnaissances("vide", "Donne un titre et un contenu au souvenir.");
    mkdirSync(dossier, { recursive: true });
    const base = nomDeFichier(propre);
    let id = `${base}.md`;
    for (let i = 2; existsSync(path.join(dossier, id)) || id === INDEX; i += 1)
        id = `${base}-${i}.md`;
    const description = premiereLigne(contenu);
    writeFileSync(path.join(dossier, id), `---\nname: ${yaml(propre)}\ndescription: ${yaml(description)}\n---\n\n${contenu.trim()}\n`, { encoding: "utf8", flag: "wx" });
    const index = path.join(dossier, INDEX);
    const avant = existsSync(index) ? readFileSync(index, "utf8") : "";
    const ligne = `- [${propre.replace(/[[\]]/g, "")}](${id})${description ? ` — ${description}` : ""}`;
    writeFileSync(index, `${avant}${avant && !avant.endsWith("\n") ? "\n" : ""}${ligne}\n`, "utf8");
    return souvenirDe(dossier, id);
}
/** La liste `skills` d'un en-tête de fiche : `skills: a, b`, `skills: [a, b]` ou une liste YAML sur plusieurs lignes. */
export function skillsDeLaFiche(contenu) {
    const entete = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contenu)?.[1];
    if (!entete)
        return [];
    const lignes = entete.split(/\r?\n/);
    const i = lignes.findIndex((l) => /^skills:/.test(l));
    if (i < 0)
        return [];
    const enLigne = lignes[i].replace(/^skills:\s*/, "").trim();
    const nettoyer = (v) => v.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
    if (enLigne)
        return enLigne
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map(nettoyer)
            .filter(Boolean);
    const liste = [];
    for (const l of lignes.slice(i + 1)) {
        const m = /^\s+-\s+(.+)$/.exec(l);
        if (!m)
            break;
        liste.push(nettoyer(m[1]));
    }
    return liste.filter(Boolean);
}
function lireSkills(dossier) {
    let noms;
    try {
        noms = readdirSync(dossier);
    }
    catch {
        return [];
    }
    const liste = [];
    for (const nom of noms) {
        if (nom.startsWith("."))
            continue;
        const fichier = path.join(dossier, nom, "SKILL.md");
        let contenu;
        try {
            contenu = readFileSync(fichier, "utf8");
        }
        catch {
            continue;
        }
        liste.push({ nom: champ(contenu, "name") || nom, description: champ(contenu, "description"), version: champ(contenu, "version") || null, dossier: path.join(dossier, nom) });
    }
    return liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
const lireJson = (fichier) => {
    try {
        const v = JSON.parse(readFileSync(fichier, "utf8"));
        return v && typeof v === "object" ? v : null;
    }
    catch {
        return null;
    }
};
/**
 * Les skills des plugins de Claude Code activés, comme Claude Code les trouve (vérifié avec Claude Code
 * 2.1.317 et `claude plugin install`, le 03/11/2026) : les plugins dont `enabledPlugins` vaut vrai dans
 * les réglages de la personne (et du projet), installés d'après `plugins/installed_plugins.json` (v2,
 * `installPath`), leurs skills dans `<installPath>/skills/<nom>/SKILL.md`, appelées `<plugin>:<nom>`.
 */
export function lireSkillsPlugins(configClaude, dossierProjet) {
    const actives = new Set();
    for (const reglages of [path.join(configClaude, "settings.json"), ...(dossierProjet ? [path.join(dossierProjet, ".claude", "settings.json")] : [])]) {
        const enabled = lireJson(reglages)?.enabledPlugins;
        if (enabled && typeof enabled === "object")
            for (const [id, actif] of Object.entries(enabled))
                if (actif === true)
                    actives.add(id);
    }
    const installes = (lireJson(path.join(configClaude, "plugins", "installed_plugins.json"))?.plugins ?? {});
    const liste = [];
    for (const id of actives) {
        const entrees = Array.isArray(installes[id]) ? installes[id] : [];
        const dossier = entrees.map((e) => e?.installPath).find((p) => typeof p === "string" && !!p);
        if (!dossier)
            continue;
        const plugin = id.split("@")[0];
        for (const s of lireSkills(path.join(dossier, "skills")))
            liste.push({ ...s, nom: `${plugin}:${s.nom}` });
    }
    return liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
/**
 * Les skills personnelles. La bibliothèque de l'app, une fois créée au premier lancement.
 * Sans elle (test, session d'avant la copie) : le dossier du poste passé par l'appelant.
 * Sur le VPS, `KLYRA_USER_DATA` est le dossier de données du serveur : la bibliothèque reçue est lue comme sur le PC.
 */
function dossierSkillsPersonnelles(configClaude) {
    const donnees = process.env.KLYRA_USER_DATA;
    if (!donnees)
        return path.join(configClaude, "skills");
    const bibliotheque = path.join(donnees, "bibliotheque-skills");
    return existsSync(bibliotheque) ? bibliotheque : path.join(configClaude, "skills");
}
/** Ce que l'agent sait faire : les skills de sa fiche (retrouvées dans le projet, l'app ou un plugin), puis celles de l'app, du projet et des plugins. */
export function lireCompetences(contenuFiche, configClaude, dossierProjet) {
    const poste = lireSkills(dossierSkillsPersonnelles(configClaude));
    const projet = dossierProjet ? lireSkills(path.join(dossierProjet, ".claude", "skills")) : [];
    const plugins = lireSkillsPlugins(configClaude, dossierProjet);
    const trouver = (liste, nom) => liste.find((s) => s.nom === nom || path.basename(s.dossier ?? "") === nom);
    const fiche = skillsDeLaFiche(contenuFiche ?? "").map((nom) => trouver(projet, nom) ?? trouver(poste, nom) ?? plugins.find((s) => s.nom === nom) ?? { nom, description: "", version: null, dossier: null });
    return { fiche, poste, projet, plugins };
}
/* ─── Skills dans une session ─────────────────────────────────── */
/*
 * Ce que l'app fait pour que les skills marchent comme dans Claude Code (vérifié avec Claude Code
 * 2.1.317 et un faux fournisseur, le 03/11/2026) :
 * - une commande `/<skill>` n'est reconnue qu'en tout début du message ; l'app, qui écrit le contexte
 *   avant le message de la personne, la remet donc en tête (le reste devient ses arguments) ;
 * - Claude Code précharge les `skills` d'une fiche pour un sous-agent, mais pas pour un agent lancé
 *   seul (`--agent`, la conversation directe et les fils de l'app) : l'app les lui donne elle-même.
 */
/** Une commande de Claude Code que l'app traite à part : jamais prise pour une skill. */
const COMMANDES_A_PART = new Set(["compact"]);
/** Le nom de la skill demandée en tête d'un message (« /rangement range le dossier » → « rangement ») ; null sinon. */
export function skillEnTete(texte) {
    const nom = /^\/([a-z0-9][a-z0-9:_-]{0,63})(?=\s|$)/i.exec(texte.trimStart())?.[1] ?? null;
    return nom && !COMMANDES_A_PART.has(nom.toLowerCase()) ? nom : null;
}
/** Les noms des skills que Claude Code trouvera (bibliothèque de l'app, ou poste, et projet), par leur nom et par leur dossier. */
export function skillsConnues(configClaude, dossier) {
    const noms = new Set();
    for (const s of [...lireSkills(dossierSkillsPersonnelles(configClaude)), ...(dossier ? lireSkills(path.join(dossier, ".claude", "skills")) : [])]) {
        noms.add(s.nom);
        if (s.dossier)
            noms.add(path.basename(s.dossier));
    }
    // Celles des plugins activés, par leur nom complet (`<plugin>:<skill>`).
    for (const s of lireSkillsPlugins(configClaude, dossier))
        noms.add(s.nom);
    return noms;
}
/** Les noms des skills de l'app (ou du poste) et du projet, pour le choix par agent. */
export function nomsSkills(configClaude, dossier) {
    return {
        poste: lireSkills(dossierSkillsPersonnelles(configClaude)).map((s) => s.nom),
        projet: dossier ? lireSkills(path.join(dossier, ".claude", "skills")).map((s) => s.nom) : [],
    };
}
/** Nom et description, pour les interrupteurs de Réglages › Agents. */
export function catalogueSkills(configClaude, dossier) {
    const court = (s) => ({ nom: s.nom, description: s.description });
    return {
        poste: lireSkills(dossierSkillsPersonnelles(configClaude)).map(court),
        projet: dossier ? lireSkills(path.join(dossier, ".claude", "skills")).map(court) : [],
    };
}
/**
 * Ce que cet agent reçoit vraiment, parmi les skills du poste et du projet.
 * `garder` sert au préchargement, à Codex et à la commande `/<skill>`.
 */
export function filtreSkills(choix, agent, configClaude, dossier) {
    const etat = validerSkillsParAgent(choix ?? null);
    const { poste, projet } = nomsSkills(configClaude, dossier);
    const duPoste = new Set(poste);
    return {
        coupes: nomsCoupes(etat, agent, poste, projet),
        garder: (nom) => skillRecue(etat, agent, nom, duPoste.has(nom) ? "poste" : "projet"),
    };
}
/**
 * Le message envoyé à Claude Code quand la personne a tapé `/<skill>` : la commande en tête, puis tout
 * le message construit par l'app (contexte, conversation, son texte), que Claude Code passe en arguments.
 * Une skill inconnue (ou une commande de Claude Code) : le message tel quel.
 */
export function promptAvecSkill(prompt, skill, connues) {
    if (!skill || skillEnTete(`/${skill}`) !== skill || !connues.has(skill))
        return prompt;
    if (skillEnTete(prompt) === skill)
        return prompt;
    return `/${skill}\n\n${prompt}`;
}
/** Le texte d'une skill sans son en-tête YAML. */
const sansEnteteYaml = (contenu) => contenu.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
/** Au-delà, une skill préchargée est coupée (et l'agent le sait) : elle entre dans chaque appel. */
export const MAX_PRECHARGE = 40_000;
/**
 * Les skills que la fiche précharge, à ajouter aux consignes d'un agent lancé seul (`--agent`) :
 * leur texte, comme Claude Code le donne à un sous-agent. `texte` est null sans skill dans la fiche.
 */
export function competencesPrechargees(contenuFiche, configClaude, dossier, garder) {
    const fiche = lireCompetences(contenuFiche, configClaude, dossier).fiche.filter((s) => !garder || garder(s.nom));
    if (!fiche.length)
        return { noms: [], texte: null };
    const blocs = [];
    const absentes = [];
    for (const s of fiche) {
        let contenu = null;
        try {
            contenu = s.dossier ? sansEnteteYaml(readFileSync(path.join(s.dossier, "SKILL.md"), "utf8")) : null;
        }
        catch {
            contenu = null;
        }
        if (contenu === null) {
            absentes.push(s.nom);
            continue;
        }
        const coupe = contenu.length > MAX_PRECHARGE;
        blocs.push(`<competence nom="${s.nom}">\nDossier de la compétence : ${s.dossier}\n\n${coupe ? `${contenu.slice(0, MAX_PRECHARGE)}\n\n[Coupée ici : lis la suite dans ${path.join(s.dossier, "SKILL.md")}.]` : contenu}\n</competence>`);
    }
    const lignes = [
        "Compétences préchargées par ta fiche (`skills`) : leurs consignes sont ci-dessous, suis-les quand la tâche s’y prête, sans les recharger avec l’outil Skill.",
        ...blocs,
    ];
    if (absentes.length)
        lignes.push(`Introuvables sur ce poste, donc absentes : ${absentes.join(", ")}. Ne fais pas comme si tu les avais.`);
    return { noms: fiche.map((s) => s.nom), texte: blocs.length || absentes.length ? lignes.join("\n\n") : null };
}
/* ─── Skills pour Codex ───────────────────────────────────────── */
/*
 * Codex a ses propres skills (vérifié avec Codex 0.166, le 03/11/2026) : il lit `.codex/skills` et
 * `.agents/skills` du projet et du dossier personnel, mais pas `.claude/skills`, et `[[skills.config]]`
 * n'ajoute pas de dossier. Il présente chaque skill au modèle par son nom, sa description et son fichier,
 * que le modèle lit quand la tâche s'y prête. L'app présente donc les skills de Claude de la même façon,
 * sans rien écrire dans les dossiers de la personne.
 */
/** Les skills de Claude (poste, puis projet) que l'app présente à un agent qui travaille avec Codex. */
function skillsDeClaude(configClaude, dossier) {
    const vues = new Set();
    return [...(dossier ? lireSkills(path.join(dossier, ".claude", "skills")) : []), ...lireSkills(dossierSkillsPersonnelles(configClaude)), ...lireSkillsPlugins(configClaude, dossier)].filter((s) => {
        if (vues.has(s.nom))
            return false;
        vues.add(s.nom);
        return true;
    });
}
/** La consigne qui donne à Codex les skills de Claude, et le texte de celles que la fiche précharge ; null sans skill. */
export function consigneSkillsCodex(contenuFiche, configClaude, dossier, garder) {
    const skills = skillsDeClaude(configClaude, dossier).filter((s) => !garder || garder(s.nom));
    const precharge = competencesPrechargees(contenuFiche, configClaude, dossier, garder);
    if (!skills.length && !precharge.texte)
        return { noms: [], texte: null };
    const liste = skills.map((s) => `- ${s.nom}: ${s.description || "sans description"} (fichier : ${path.join(s.dossier, "SKILL.md")})`);
    const texte = [
        ...(skills.length
            ? [
                `Compétences de la personne (ses skills de Claude Code) : chacune est un SKILL.md à lire puis suivre quand la tâche s'y prête, comme tes propres skills. Lis le fichier avant d'appliquer la compétence ; n'en invente pas le contenu.\n${liste.join("\n")}`,
            ]
            : []),
        ...(precharge.texte ? [precharge.texte] : []),
    ].join("\n\n");
    return { noms: [...skills.map((s) => s.nom), ...precharge.noms.map((n) => `fiche:${n}`)], texte };
}
/** Le message pour Codex quand la personne a tapé `/<skill>` : la compétence à lire d'abord, puis le message de l'app. */
export function promptAvecSkillCodex(prompt, skill, configClaude, dossier, garder) {
    if (!skill || skillEnTete(`/${skill}`) !== skill || (garder && !garder(skill)))
        return prompt;
    const trouvee = skillsDeClaude(configClaude, dossier).find((s) => s.nom === skill || path.basename(s.dossier ?? "") === skill);
    if (!trouvee?.dossier)
        return prompt;
    return `[La personne demande la compétence « ${trouvee.nom} » : lis ${path.join(trouvee.dossier, "SKILL.md")} avant de répondre, et suis-la.]\n\n${prompt}`;
}
