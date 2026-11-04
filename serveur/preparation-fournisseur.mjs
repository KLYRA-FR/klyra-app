// Généré par scripts/serveur-genere.mjs depuis electron/preparation-fournisseur.ts : ne pas modifier à la main.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
/**
 * Ce que KLYRA prépare pour un fournisseur, à part du poste.
 *
 * Claude Code lit `CLAUDE_CONFIG_DIR` à la place de `~/.claude` (prouvé le 04/11/2026,
 * Claude Code 2.1.306, faux fournisseur) : les agents et les skills de ce dossier,
 * pas ceux du poste. Le CLAUDE.md de ce dossier est un lien vers celui du poste :
 * une copie perd les imports `@./` (prouvé le 04/11/2026, Claude Code 2.1.306).
 * Le CLAUDE.md du projet et les skills du projet restent lus depuis le dossier de travail.
 * `--setting-sources project,local` retire AUSSI ce dossier (agents, skills, CLAUDE.md) :
 * on ne le combine pas avec lui.
 *
 * La connexion et les sessions restent celles du poste : un lien vers `.credentials.json`,
 * `projects` et `sessions`, jamais une copie, jamais une suppression.
 * Les skills personnelles copiées viennent de `userData/bibliotheque-skills` dès que ce dossier
 * existe (la copie du premier lancement). Sans lui, elles viennent encore du poste.
 * Rien ici n'écrit dans le dossier du poste.
 */
const ID_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NOM_DOSSIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;
function dans(racine, cible) {
    const base = path.resolve(racine);
    const resolu = path.resolve(cible);
    return resolu === base || resolu.startsWith(base + path.sep);
}
function nomSkill(contenu, dossier) {
    const entete = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contenu)?.[1] ?? "";
    const brut = /^name:\s*(.*)$/m.exec(entete)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
    return brut || path.basename(dossier);
}
/** Les skills d'un dossier (`<racine>/<nom>/SKILL.md`), par le nom de leur en-tête. */
export function listerSkills(racine) {
    let noms;
    try {
        noms = readdirSync(racine);
    }
    catch {
        return [];
    }
    const liste = [];
    for (const nom of noms) {
        if (nom.startsWith(".") || !NOM_DOSSIER.test(nom))
            continue;
        const source = path.join(racine, nom);
        let contenu;
        try {
            if (!lstatSync(source).isDirectory())
                continue;
            contenu = readFileSync(path.join(source, "SKILL.md"), "utf8");
        }
        catch {
            continue;
        }
        liste.push({ nom: nomSkill(contenu, source), source });
    }
    return liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
/** Pose un lien vers un fichier ou un dossier du poste. Ne remplace rien qui existe déjà. */
function lier(source, lien) {
    if (!source || !existsSync(source))
        return;
    try {
        const st = lstatSync(lien);
        if (st.isSymbolicLink() && path.resolve(path.dirname(lien), readlinkSync(lien)) === path.resolve(source))
            return;
        return;
    }
    catch (error) {
        if (error.code !== "ENOENT")
            return;
    }
    symlinkSync(source, lien);
}
function ecrireFiches(dossier, fiches) {
    const agents = path.join(dossier, "agents");
    mkdirSync(agents, { recursive: true });
    const gardes = new Set();
    for (const fiche of fiches) {
        if (!ID_AGENT.test(fiche.id))
            continue;
        const cible = path.join(agents, `${fiche.id}.md`);
        if (!dans(agents, cible))
            continue;
        writeFileSync(cible, fiche.contenu, "utf8");
        gardes.add(`${fiche.id}.md`);
    }
    for (const nom of readdirSync(agents)) {
        if (!nom.endsWith(".md") || gardes.has(nom))
            continue;
        const cible = path.join(agents, nom);
        if (dans(agents, cible))
            rmSync(cible, { force: true });
    }
}
function ecrireSkills(dossier, skills) {
    const racine = path.join(dossier, "skills");
    mkdirSync(racine, { recursive: true });
    const gardes = new Set();
    for (const skill of skills) {
        const base = path.basename(skill.source);
        if (!NOM_DOSSIER.test(base) || !existsSync(path.join(skill.source, "SKILL.md")))
            continue;
        const cible = path.join(racine, base);
        if (!dans(racine, cible) || dans(skill.source, cible))
            continue;
        rmSync(cible, { recursive: true, force: true });
        cpSync(skill.source, cible, { recursive: true, dereference: true });
        gardes.add(base);
    }
    for (const nom of readdirSync(racine)) {
        if (nom.startsWith(".") || gardes.has(nom))
            continue;
        const cible = path.join(racine, nom);
        if (dans(racine, cible))
            rmSync(cible, { recursive: true, force: true });
    }
}
/** Pose un lien vers le CLAUDE.md du poste. Remplace le fichier de CE dossier, jamais celui du poste. */
function poserClaudeMd(dossier, source) {
    const cible = path.join(dossier, "CLAUDE.md");
    if (!source || !existsSync(source) || !dans(dossier, cible)) {
        try {
            if (!lstatSync(cible).isDirectory())
                rmSync(cible, { force: true });
        }
        catch {
            /* absent */
        }
        return;
    }
    try {
        const st = lstatSync(cible);
        if (st.isSymbolicLink() && path.resolve(path.dirname(cible), readlinkSync(cible)) === path.resolve(source))
            return;
        if (st.isDirectory())
            return;
        rmSync(cible, { force: true });
    }
    catch (error) {
        if (error.code !== "ENOENT")
            return;
    }
    symlinkSync(source, cible);
}
/**
 * Remplit le dossier que Claude Code lira (`CLAUDE_CONFIG_DIR`).
 * `claudeMd` null retire le CLAUDE.md de CE dossier (pas celui du poste).
 */
export function preparerClaude(dossier, entree) {
    mkdirSync(dossier, { recursive: true });
    ecrireFiches(dossier, entree.fiches);
    ecrireSkills(dossier, entree.skills);
    poserClaudeMd(dossier, entree.claudeMd);
    lier(entree.identifiants, path.join(dossier, ".credentials.json"));
    lier(entree.projects, path.join(dossier, "projects"));
    lier(entree.sessions, path.join(dossier, "sessions"));
}
/**
 * Prépare le dossier de l'agent et le rend. null : pas de dossier d'app
 * (la session reste sur le poste, comme avant).
 */
export function preparerSessionClaude(session) {
    if (!session.userData)
        return null;
    const id = session.agent && ID_AGENT.test(session.agent) ? session.agent : "principal";
    const dossier = path.join(session.userData, "preparation", id);
    const poste = session.poste || path.join(session.home, ".claude");
    const fiches = [];
    for (const agent of session.idsActifs) {
        if (!ID_AGENT.test(agent))
            continue;
        try {
            fiches.push({ id: agent, contenu: readFileSync(path.join(session.dossierAgents, `${agent}.md`), "utf8") });
        }
        catch {
            /* fiche absente : on ne l'invente pas */
        }
    }
    const skills = listerSkills(dossierSkillsSession(session.userData, poste)).filter((s) => session.garder(s.nom));
    const claudeMd = path.join(poste, "CLAUDE.md");
    preparerClaude(dossier, {
        fiches,
        skills,
        claudeMd: existsSync(claudeMd) ? claudeMd : null,
        identifiants: path.join(poste, ".credentials.json"),
        projects: path.join(poste, "projects"),
        sessions: path.join(poste, "sessions"),
    });
    return { dossier, skills: skills.map((s) => s.nom) };
}
/** La bibliothèque de l'app si elle existe, sinon les skills du poste. */
function dossierSkillsSession(userData, poste) {
    const bibliotheque = path.join(userData, "bibliotheque-skills");
    return existsSync(bibliotheque) ? bibliotheque : path.join(poste, "skills");
}
function copierSiAbsent(source, dest) {
    if (existsSync(dest) || !existsSync(source))
        return false;
    mkdirSync(path.dirname(dest), { recursive: true });
    const st = lstatSync(source);
    if (st.isSymbolicLink())
        return false;
    if (st.isDirectory())
        cpSync(source, dest, { recursive: true, dereference: true });
    else
        writeFileSync(dest, readFileSync(source));
    return true;
}
/**
 * Copie les fiches et les skills du poste dans le dossier de l'app, une fois,
 * seulement là où il n'y a encore rien. Ne supprime et ne modifie rien du poste.
 */
export function migrerCopies(opts) {
    const fiches = [];
    let noms = [];
    try {
        noms = readdirSync(opts.fichesPoste);
    }
    catch {
        noms = [];
    }
    for (const nom of noms) {
        if (!nom.endsWith(".md"))
            continue;
        const id = nom.slice(0, -3);
        if (!ID_AGENT.test(id))
            continue;
        const dest = path.join(opts.fichesDest, nom);
        if (!dans(opts.fichesDest, dest))
            continue;
        if (copierSiAbsent(path.join(opts.fichesPoste, nom), dest))
            fiches.push(id);
    }
    const skills = [];
    mkdirSync(opts.skillsDest, { recursive: true });
    for (const skill of listerSkills(opts.skillsPoste)) {
        const base = path.basename(skill.source);
        const dest = path.join(opts.skillsDest, base);
        if (!dans(opts.skillsDest, dest))
            continue;
        if (copierSiAbsent(skill.source, dest))
            skills.push(skill.nom);
    }
    return { fiches, skills };
}
const triNoms = (noms) => [...noms].sort((a, b) => a.localeCompare(b, "fr"));
/**
 * Copie dans la bibliothèque de l'app les skills d'un dossier choisi.
 * Si ce dossier contient `SKILL.md`, c'est une skill. Sinon, ce sont ses sous-dossiers.
 * Un nom ou un dossier déjà présent n'est pas écrasé. Rien n'est supprimé, ni à la source, ni dans la bibliothèque.
 * Un lien n'est pas pris comme dossier de skill.
 */
export function importerSkills(source, dest) {
    const ajoutees = [];
    const dejaLa = [];
    const ignorees = [];
    const racine = path.resolve(source);
    let info;
    try {
        info = lstatSync(racine);
    }
    catch {
        return { ajoutees, dejaLa, ignorees: [path.basename(racine) || racine] };
    }
    if (!info.isDirectory() || info.isSymbolicLink())
        return { ajoutees, dejaLa, ignorees: [path.basename(racine) || racine] };
    const garder = [];
    const enfants = listerSkills(racine);
    if (enfants.length) {
        garder.push(...enfants);
    }
    else {
        const fiche = path.join(racine, "SKILL.md");
        try {
            const fichier = lstatSync(fiche);
            if (fichier.isFile() && !fichier.isSymbolicLink()) {
                const base = path.basename(racine);
                if (!NOM_DOSSIER.test(base))
                    ignorees.push(base);
                else
                    garder.push({ nom: nomSkill(readFileSync(fiche, "utf8"), racine), source: racine });
            }
        }
        catch {
            /* ce dossier n'est pas une skill */
        }
    }
    const bibliotheque = path.resolve(dest);
    mkdirSync(bibliotheque, { recursive: true });
    const presentes = listerSkills(bibliotheque);
    const noms = new Set(presentes.map((s) => s.nom));
    const dossiers = new Set(presentes.map((s) => path.basename(s.source)));
    for (const skill of garder) {
        const base = path.basename(skill.source);
        const cible = path.join(bibliotheque, base);
        if (!NOM_DOSSIER.test(base) || !dans(bibliotheque, cible)) {
            ignorees.push(skill.nom);
            continue;
        }
        if (path.resolve(skill.source) === path.resolve(cible) || existsSync(cible) || noms.has(skill.nom) || dossiers.has(base)) {
            dejaLa.push(skill.nom);
            continue;
        }
        if (dans(skill.source, cible)) {
            ignorees.push(skill.nom);
            continue;
        }
        let st;
        try {
            st = lstatSync(skill.source);
        }
        catch {
            ignorees.push(skill.nom);
            continue;
        }
        if (st.isSymbolicLink() || !st.isDirectory()) {
            ignorees.push(skill.nom);
            continue;
        }
        cpSync(skill.source, cible, { recursive: true, dereference: true });
        ajoutees.push(skill.nom);
        noms.add(skill.nom);
        dossiers.add(base);
    }
    return { ajoutees: triNoms(ajoutees), dejaLa: triNoms(dejaLa), ignorees: triNoms(ignorees) };
}
/** Le compte rendu déjà écrit, ou null. */
export function lireReprise(fichier) {
    try {
        const brut = JSON.parse(readFileSync(fichier, "utf8"));
        const noms = (v) => (Array.isArray(v) ? v.filter((n) => typeof n === "string") : []);
        return { fiches: noms(brut.fiches), skills: noms(brut.skills) };
    }
    catch {
        return null;
    }
}
