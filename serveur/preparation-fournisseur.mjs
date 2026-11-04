// Généré par scripts/serveur-genere.mjs depuis electron/preparation-fournisseur.ts : ne pas modifier à la main.
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { skillRecue } from "./skills-par-agent.mjs";
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
 * Les plugins et `settings.json` du poste sont des liens : Claude Code les charge comme avant.
 * Rien ici n'écrit dans le dossier du poste.
 *
 * Le PC envoie au VPS les dossiers des skills allumées pour au moins un agent.
 * Le VPS les écrit dans sa bibliothèque (`donnees/bibliotheque-skills`). Une skill
 * éteinte pour tout le monde ne part pas. Rien n'est supprimé sur le poste, ni dans
 * `~/.claude` du VPS : seule cette bibliothèque est remplacée par l'envoi.
 *
 * Codex ne lit pas `.claude/skills`. Chaque agent a son `CODEX_HOME`
 * (`userData/preparation-codex/<agent>`) : les skills allumées pour lui, et des liens
 * vers `config.toml` et `auth.json` du Codex du poste. Son `HOME` est vide de skills,
 * pour que `~/.agents/skills` du poste ne passe pas. Le processus du compte n'a pas ce dossier.
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
/**
 * Lien vers le poste, même si le dossier préparé a déjà un fichier ou un dossier de ce nom.
 * Ce qui est remplacé est dans le dossier préparé, jamais le poste.
 */
function lierEnRemplacant(dossier, source, lien) {
    if (!source || !existsSync(source) || !dans(dossier, lien))
        return;
    try {
        const st = lstatSync(lien);
        if (st.isSymbolicLink() && path.resolve(path.dirname(lien), readlinkSync(lien)) === path.resolve(source))
            return;
        rmSync(lien, { recursive: true, force: true });
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
    lierEnRemplacant(dossier, entree.plugins ?? null, path.join(dossier, "plugins"));
    lierEnRemplacant(dossier, entree.reglages ?? null, path.join(dossier, "settings.json"));
    lierEnRemplacant(dossier, entree.reglagesLocaux ?? null, path.join(dossier, "settings.local.json"));
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
        plugins: path.join(poste, "plugins"),
        reglages: path.join(poste, "settings.json"),
        reglagesLocaux: path.join(poste, "settings.local.json"),
    });
    return { dossier, skills: skills.map((s) => s.nom) };
}
/**
 * Prépare le `CODEX_HOME` de cet agent : seulement ses skills allumées.
 * Ne modifie ni le poste, ni le dossier Codex d'origine.
 */
export function preparerSessionCodex(session) {
    const id = session.agent && ID_AGENT.test(session.agent) ? session.agent : "principal";
    const codexHome = path.join(session.userData, "preparation-codex", id);
    const home = path.join(codexHome, "home");
    mkdirSync(home, { recursive: true });
    const skills = session.dossiers.filter((d) => {
        const base = path.basename(d.source);
        return NOM_DOSSIER.test(base) && existsSync(path.join(d.source, "SKILL.md"));
    });
    ecrireSkills(codexHome, skills.map((d) => ({ nom: d.nom, source: d.source })));
    const poste = session.codexPoste ? path.resolve(session.codexPoste) : null;
    if (poste && poste !== path.resolve(codexHome) && !dans(codexHome, poste) && !dans(poste, codexHome)) {
        lier(path.join(poste, "config.toml"), path.join(codexHome, "config.toml"));
        lier(path.join(poste, "auth.json"), path.join(codexHome, "auth.json"));
    }
    const noms = skills.map((d) => path.basename(d.source)).sort((a, b) => a.localeCompare(b, "fr"));
    return { codexHome, home, skills: skills.map((d) => d.nom), empreinte: noms.join("\n") };
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
const NOM_FICHIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;
const FICHIER_MAX = 400_000;
const FICHIERS_MAX = 40;
const SKILLS_MAX = 80;
const TOTAL_MAX = 4_000_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
function cheminRelatif(chemin) {
    if (!chemin || chemin.includes("\\") || chemin.startsWith("/") || chemin.includes("\0"))
        return null;
    const parts = chemin.split("/");
    if (!parts.length || parts.some((p) => !NOM_FICHIER.test(p) || p === "." || p === ".."))
        return null;
    return parts;
}
/** Les fichiers d'un dossier de skill. null : pas de SKILL.md, ou ce fichier ne tient pas dans l'envoi. */
function lireFichiersSkill(racine) {
    const fichiers = [];
    const visiter = (absolu, relatif) => {
        let noms;
        try {
            noms = readdirSync(absolu).sort((a, b) => a.localeCompare(b, "en"));
        }
        catch {
            return relatif !== "";
        }
        for (const nom of noms) {
            if (nom.startsWith(".") || nom === "node_modules" || nom === ".git")
                continue;
            if (!NOM_FICHIER.test(nom))
                continue;
            const chemin = relatif ? `${relatif}/${nom}` : nom;
            const cible = path.join(absolu, nom);
            let st;
            try {
                st = lstatSync(cible);
            }
            catch {
                continue;
            }
            if (st.isSymbolicLink())
                continue;
            if (st.isDirectory()) {
                if (!visiter(cible, chemin))
                    return false;
                continue;
            }
            if (!st.isFile())
                continue;
            if (fichiers.length >= FICHIERS_MAX)
                return false;
            let buf;
            try {
                buf = readFileSync(cible);
            }
            catch {
                continue;
            }
            const binaire = buf.includes(0);
            const contenu = binaire ? buf.toString("base64") : buf.toString("utf8");
            if (contenu.length > FICHIER_MAX) {
                if (chemin === "SKILL.md")
                    return false;
                continue;
            }
            fichiers.push(binaire ? { chemin, contenu, binaire: true } : { chemin, contenu });
        }
        return true;
    };
    if (!visiter(racine, ""))
        return null;
    if (!fichiers.some((f) => f.chemin === "SKILL.md" && !f.binaire && f.contenu.length > 0))
        return null;
    fichiers.sort((a, b) => a.chemin.localeCompare(b.chemin, "en"));
    return fichiers;
}
/**
 * Les dossiers à envoyer : une skill du poste (ou de la bibliothèque) allumée pour
 * au moins un agent. `actifs` : les agents actifs, en plus de ceux déjà connus du choix.
 * Une skill éteinte pour tout le monde n'est pas dans la liste. Un lien, `node_modules`
 * ou `.git` n'est pas lu. Si `SKILL.md` ne tient pas, la skill ne part pas.
 */
export function skillsAEnvoyer(choix, actifs, sources) {
    const ids = new Set(["principal"]);
    for (const id of [...actifs, ...choix.agentsConnus, ...Object.keys(choix.activees), ...Object.keys(choix.coupees)]) {
        if (id === "principal" || ID_AGENT.test(id))
            ids.add(id);
    }
    const envoyees = [];
    let total = 0;
    for (const source of sources) {
        if (![...ids].some((id) => skillRecue(choix, id === "principal" ? null : id, source.nom, "poste")))
            continue;
        if (envoyees.length >= SKILLS_MAX)
            break;
        const dossier = path.basename(source.source);
        if (!NOM_DOSSIER.test(dossier))
            continue;
        const fichiers = lireFichiersSkill(source.source);
        if (!fichiers)
            continue;
        const poids = fichiers.reduce((n, f) => n + f.contenu.length, 0);
        if (total + poids > TOTAL_MAX)
            continue;
        envoyees.push({ nom: source.nom, dossier, fichiers });
        total += poids;
    }
    return envoyees.sort((a, b) => a.dossier.localeCompare(b.dossier, "en") || a.nom.localeCompare(b.nom, "fr"));
}
/** Empreinte du contenu envoyé : une édition de SKILL.md change l'envoi, sans changer le choix des interrupteurs. */
export function empreinteSkills(skills) {
    return createHash("sha256").update(JSON.stringify(skills)).digest("hex");
}
function octetsDe(fichier) {
    if (!fichier.binaire)
        return Buffer.from(fichier.contenu, "utf8");
    const contenu = fichier.contenu;
    if (contenu.length % 4 !== 0 || !BASE64.test(contenu))
        throw new Error("skills");
    const octets = Buffer.from(contenu, "base64");
    if (octets.length > FICHIER_MAX || octets.toString("base64") !== contenu)
        throw new Error("skills");
    return octets;
}
/** Vérifie l'envoi. Lève si un chemin sort du dossier, ou si un fichier est trop gros. N'écrit rien. */
export function normaliserSkillsRecues(brut) {
    if (!Array.isArray(brut) || brut.length > SKILLS_MAX)
        throw new Error("skills");
    const vus = new Set();
    const skills = [];
    let total = 0;
    for (const entree of brut) {
        const e = (entree ?? {});
        const dossier = typeof e.dossier === "string" ? e.dossier : "";
        const nom = typeof e.nom === "string" && e.nom.length <= 80 ? e.nom : dossier;
        if (!NOM_DOSSIER.test(dossier) || vus.has(dossier) || !Array.isArray(e.fichiers) || e.fichiers.length > FICHIERS_MAX)
            throw new Error("skills");
        const chemins = new Set();
        const fichiers = [];
        for (const fichier of e.fichiers) {
            const f = (fichier ?? {});
            if (typeof f.chemin !== "string" || typeof f.contenu !== "string" || !cheminRelatif(f.chemin) || chemins.has(f.chemin))
                throw new Error("skills");
            if (f.contenu.length > FICHIER_MAX || (f.binaire !== undefined && f.binaire !== true))
                throw new Error("skills");
            const recu = f.binaire === true ? { chemin: f.chemin, contenu: f.contenu, binaire: true } : { chemin: f.chemin, contenu: f.contenu };
            octetsDe(recu);
            chemins.add(f.chemin);
            fichiers.push(recu);
            total += f.contenu.length;
        }
        if (total > TOTAL_MAX)
            throw new Error("skills");
        if (!fichiers.some((f) => f.chemin === "SKILL.md" && !f.binaire && f.contenu.length > 0))
            throw new Error("skills");
        vus.add(dossier);
        skills.push({ nom, dossier, fichiers });
    }
    return skills;
}
/**
 * Écrit la bibliothèque de l'app : exactement les dossiers reçus.
 * Un dossier absent de l'envoi est retiré de CETTE bibliothèque seulement.
 * Un lien est retiré, pas la cible. Le poste et `~/.claude` ne sont pas des arguments ici.
 */
export function ecrireBibliotheque(dest, brut) {
    const skills = normaliserSkillsRecues(brut);
    const bibliotheque = path.resolve(dest);
    try {
        if (lstatSync(bibliotheque).isSymbolicLink())
            throw new Error("skills");
    }
    catch (error) {
        if (error.code !== "ENOENT" && error.message !== "skills")
            throw error;
        if (error.message === "skills")
            throw error;
    }
    mkdirSync(bibliotheque, { recursive: true, mode: 0o700 });
    const gardes = new Set();
    for (const skill of skills) {
        const cible = path.join(bibliotheque, skill.dossier);
        if (!dans(bibliotheque, cible))
            throw new Error("skills");
        try {
            const st = lstatSync(cible);
            if (st.isSymbolicLink())
                rmSync(cible, { force: true });
            else
                rmSync(cible, { recursive: true, force: true });
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
        mkdirSync(cible, { recursive: true, mode: 0o700 });
        for (const fichier of skill.fichiers) {
            const parts = cheminRelatif(fichier.chemin);
            if (!parts)
                throw new Error("skills");
            const fichierCible = path.join(cible, ...parts);
            if (!dans(cible, fichierCible))
                throw new Error("skills");
            mkdirSync(path.dirname(fichierCible), { recursive: true, mode: 0o700 });
            writeFileSync(fichierCible, octetsDe(fichier), { mode: 0o600 });
        }
        gardes.add(skill.dossier);
    }
    for (const nom of readdirSync(bibliotheque)) {
        if (gardes.has(nom))
            continue;
        const cible = path.join(bibliotheque, nom);
        if (!dans(bibliotheque, cible))
            continue;
        const st = lstatSync(cible);
        if (st.isSymbolicLink())
            rmSync(cible, { force: true });
        else
            rmSync(cible, { recursive: true, force: true });
    }
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
