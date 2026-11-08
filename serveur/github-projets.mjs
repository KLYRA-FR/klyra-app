// Généré par scripts/serveur-genere.mjs depuis electron/github-projets.ts : ne pas modifier à la main.
import { rmSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { diffFichierGit, etatGit } from "./git.mjs";
/** N'accepte que les noms GitHub, jamais une URL, un chemin ou une option de commande. */
export function validerNomDepot(v) {
    if (typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(v) || /\/(?:\.|\.\.)$/.test(v))
        throw new Error("Dépôt GitHub invalide.");
    return v;
}
export function validerBranche(v) {
    if (typeof v !== "string" || !v || v.length > 255 || v.startsWith("-") || v.startsWith("/") || v.endsWith("/") || /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(v) || v.includes("..") || v.includes("@{") || v.split("/").some((s) => !s || s.startsWith(".") || s.endsWith(".lock") || s.endsWith(".")))
        throw new Error("Branche GitHub invalide.");
    return v;
}
/** Un texte venu de GitHub, sur une ligne, sans caractère de contrôle, coupé à `max`. */
function texteCourt(v, max) {
    if (typeof v !== "string")
        return null;
    const t = v.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
    if (!t)
        return null;
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
/**
 * Ce que GitHub dit d'un dépôt dans sa liste : la description, le site, le langage et le dernier envoi.
 * Le site n'est gardé qu'en http(s) (jamais `javascript:` ni un identifiant dans l'adresse).
 */
export function infosDepot(r) {
    let site = null;
    const brut = texteCourt(r.homepage, 500);
    if (brut) {
        try {
            const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(brut) ? brut : `https://${brut}`);
            if ((u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password && u.hostname.includes("."))
                site = u.href;
        }
        catch {
            /* adresse illisible : pas de site */
        }
    }
    const pousse = typeof r.pushed_at === "string" && !Number.isNaN(Date.parse(r.pushed_at)) ? new Date(r.pushed_at).toISOString() : null;
    return { description: texteCourt(r.description, 300), site, langage: texteCourt(r.language, 40), pousseLe: pousse };
}
const objet = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const liste = (v) => (Array.isArray(v) ? v.map(objet) : []);
const texte = (v, max = 200) => texteCourt(v, max) ?? "";
const entier = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const date = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
/** Une adresse de github.com seulement : jamais une autre page envoyée à l'écran ou à un agent. */
const urlGithub = (v) => {
    if (typeof v !== "string")
        return null;
    try {
        const u = new URL(v);
        return u.protocol === "https:" && u.hostname === "github.com" && !u.username && !u.password ? u.href : null;
    }
    catch {
        return null;
    }
};
/** Les vérifications d'un commit (check runs) en un état : échec dès qu'une échoue, en cours tant qu'une tourne. */
export function resumerTests(reponse) {
    const runs = liste(objet(reponse).check_runs);
    let reussis = 0, echecs = 0, enCours = 0;
    const echouees = [];
    for (const r of runs) {
        if (r.status !== "completed")
            enCours++;
        else if (["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(String(r.conclusion))) {
            echecs++;
            if (echouees.length < 10)
                echouees.push({ nom: texte(r.name, 120) || "Vérification", url: urlGithub(r.html_url) ?? urlGithub(r.details_url) });
        }
        else
            reussis++;
    }
    const total = runs.length;
    return { etat: !total ? "aucun" : echecs ? "echec" : enCours ? "en-cours" : "reussi", total, reussis, echecs, enCours, echouees };
}
export function lirePullRequests(reponse) {
    return liste(reponse).filter((p) => typeof p.number === "number").map((p) => ({
        numero: entier(p.number),
        titre: texte(p.title, 200),
        auteur: texte(objet(p.user).login, 60),
        branche: texte(objet(p.head).ref, 255),
        brouillon: p.draft === true,
        url: urlGithub(p.html_url) ?? "",
        majLe: date(p.updated_at),
    }));
}
export function lireCommits(reponse) {
    return liste(reponse).filter((c) => typeof c.sha === "string").map((c) => {
        const commit = objet(c.commit);
        return {
            sha: String(c.sha).slice(0, 7),
            message: texte(String(commit.message ?? "").split("\n")[0], 160),
            auteur: texte(objet(c.author).login, 60) || texte(objet(commit.author).name, 60),
            date: date(objet(commit.author).date),
            url: urlGithub(c.html_url) ?? "",
        };
    });
}
export class GithubProjets {
    login = null;
    vue = { compte: null, connexion: null, enCours: false, erreur: null };
    generation = 0;
    loginDossier = null;
    clones = new Set();
    d;
    constructor(d) { this.d = d; }
    env(jeton, config) {
        const env = { ...process.env };
        // Aucune identité GitHub héritée du terminal ou des agents.
        for (const k of Object.keys(env))
            if (/^(GH_|GITHUB_|GIT_CONFIG_|GIT_TRACE|GIT_CURL_VERBOSE|GIT_ASKPASS|SSH_ASKPASS|DEBUG$)/.test(k))
                delete env[k];
        return { ...env, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_NO_EXTENSION_UPDATE_NOTIFIER: "1", NO_COLOR: "1", LANG: "C", LC_ALL: "C", ...(jeton ? { GH_TOKEN: jeton } : {}), ...(config ? { GH_CONFIG_DIR: config } : {}) };
    }
    async commande(exe, args, env, cwd, timeout = 60_000) {
        return new Promise((resolve, reject) => execFile(exe, args, { env, cwd, timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (e, out) => {
            // Ni stderr (peut contenir une adresse authentifiée), ni les variables du processus dans l'erreur.
            if (e)
                reject(new Error(e.code === "ENOENT" ? `${exe === "git" ? "Git" : "GitHub CLI"} est introuvable sur cette machine.` : "GitHub n’a pas confirmé l’opération. Vérifie la connexion et les droits sur ce dépôt."));
            else
                resolve(out);
        }));
    }
    async etat() {
        try {
            const c = await this.d.lire();
            return { ...this.vue, compte: c?.compte ?? null };
        }
        catch {
            return { ...this.vue, compte: null, erreur: "La connexion GitHub ne peut plus être lue. Reconnecte GitHub." };
        }
    }
    async connecter() {
        if (this.vue.enCours)
            return this.etat();
        const generation = ++this.generation;
        this.vue = { compte: null, connexion: null, enCours: true, erreur: null };
        let dossier;
        try {
            this.d.verifier?.();
            await this.commande(this.d.gh, ["--version"], this.env());
            dossier = await mkdtemp(path.join(os.tmpdir(), "klyra-github-"));
        }
        catch (e) {
            if (generation === this.generation)
                this.vue.enCours = false;
            throw e;
        }
        if (generation !== this.generation) {
            await rm(dossier, { recursive: true, force: true });
            return this.etat();
        }
        // stdin/stdout en pipes : gh affiche le code et attend l'autorisation, sans ouvrir
        // de navigateur sur la machine qui clone (notamment le VPS).
        this.loginDossier = dossier;
        const env = this.env(undefined, dossier);
        const enfant = spawn(this.d.gh, ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web", "--insecure-storage", "--scopes", "repo"], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        this.login = enfant;
        enfant.stdin?.end("\n");
        let sortie = "";
        let termine = false;
        const timer = setTimeout(() => enfant.kill(), 16 * 60_000);
        const fini = async (code) => {
            if (termine)
                return;
            termine = true;
            clearTimeout(timer);
            try {
                if (code !== 0)
                    throw new Error("Connexion GitHub annulée ou expirée. Réessaie.");
                const jeton = (await this.commande(this.d.gh, ["auth", "token", "--hostname", "github.com"], this.env(undefined, dossier))).trim();
                if (!jeton || /\s/.test(jeton))
                    throw new Error("Connexion GitHub illisible.");
                const utilisateur = JSON.parse(await this.commande(this.d.gh, ["api", "--method", "GET", "/user"], this.env(jeton)));
                if (typeof utilisateur.login !== "string" || !/^[a-zA-Z0-9-]{1,39}$/.test(utilisateur.login))
                    throw new Error("Compte GitHub illisible.");
                if (generation === this.generation)
                    await this.d.ecrire({ jeton, compte: utilisateur.login });
            }
            catch (e) {
                if (generation === this.generation)
                    this.vue.erreur = e instanceof Error ? e.message : "Connexion GitHub échouée.";
            }
            finally {
                await rm(dossier, { recursive: true, force: true });
                if (this.loginDossier === dossier)
                    this.loginDossier = null;
                if (generation === this.generation) {
                    this.login = null;
                    this.vue.enCours = false;
                    this.vue.connexion = null;
                }
            }
        };
        enfant.once("error", () => void fini(1));
        enfant.once("close", (code) => void fini(code));
        const lire = (b) => {
            sortie = (sortie + b.toString("utf8")).slice(-8000);
            const code = sortie.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1];
            if (code && generation === this.generation)
                this.vue.connexion = { code, url: "https://github.com/login/device" };
        };
        enfant.stderr?.on("data", lire);
        enfant.stdout?.on("data", lire);
        return this.etat();
    }
    /** Ferme une autorisation en attente, sans déconnecter le compte déjà enregistré. */
    fermer() {
        ++this.generation;
        this.login?.kill();
        this.login = null;
        if (this.loginDossier) {
            try {
                rmSync(this.loginDossier, { recursive: true, force: true });
            }
            catch { /* le callback close réessaie */ }
            this.loginDossier = null;
        }
        this.vue.enCours = false;
        this.vue.connexion = null;
    }
    async deconnecter() {
        this.fermer();
        this.vue = { compte: null, connexion: null, enCours: false, erreur: null };
        await this.d.ecrire(null);
        return this.etat();
    }
    async connexion() {
        const c = await this.d.lire();
        if (!c)
            throw new Error("Connecte GitHub sur cette machine pour choisir un dépôt.");
        return c;
    }
    async pages(endpoint) {
        const c = await this.connexion();
        const pages = JSON.parse(await this.commande(this.d.gh, ["api", "--method", "GET", "--paginate", "--slurp", endpoint], this.env(c.jeton)));
        if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p)))
            throw new Error("Liste GitHub illisible.");
        return pages.flat().filter((x) => !!x && typeof x === "object");
    }
    async depots() {
        return (await this.pages("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member")).map((r) => ({
            nom: validerNomDepot(r.full_name),
            prive: r.private === true,
            branche: typeof r.default_branch === "string" ? r.default_branch : "",
            archive: r.archived === true,
            ...infosDepot(r),
        }));
    }
    async branches(depot) {
        const nom = validerNomDepot(depot);
        return (await this.pages(`/repos/${nom}/branches?per_page=100`)).map((b) => validerBranche(b.name));
    }
    /**
     * Git dans un clone, sans jeton : la configuration passée ici l'emporte sur celle du dépôt (qu'un agent peut
     * écrire) ; ni crochets, ni fsmonitor, ni proxy, ni TLS désactivé. Pour add, commit, merge.
     */
    gitEnvLocal(extra = []) {
        const cles = [
            ["core.hooksPath", path.join(this.d.racine, ".hooks-desactives")],
            ["core.fsmonitor", "false"],
            ["core.askPass", ""],
            ["credential.helper", ""],
            ["http.followRedirects", "false"],
            ["http.sslVerify", "true"],
            ["http.proxy", ""],
            ["http.https://github.com/.sslVerify", "true"],
            ["http.https://github.com/.proxy", ""],
            ...extra,
        ];
        const env = { ...this.env(), GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_CONFIG_COUNT: String(cles.length) };
        cles.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
        return env;
    }
    /** La même chose avec le jeton, seulement pour parler à GitHub (clone, fetch, push) : jamais pour une commande qui exécute du contenu du dépôt (filtres, checkout). */
    gitEnv(jeton) {
        return this.gitEnvLocal([["http.https://github.com/.extraheader", `Authorization: Basic ${Buffer.from(`x-access-token:${jeton}`).toString("base64")}`]]);
    }
    /** `git config`, avec son code de sortie (1 : rien trouvé ; toute autre erreur compte comme un refus). */
    configGit(cible, args) {
        return new Promise((resolve) => execFile("git", args, { env: this.env(), cwd: cible, timeout: 30_000, windowsHide: true }, (e, out) => {
            const code = e ? (typeof e.code === "number" ? e.code : -1) : 0;
            resolve({ code, sortie: String(out ?? "") });
        }));
    }
    /**
     * Le dépôt d'un clone, vérifié avant de parler à GitHub : son origine doit être le dépôt attendu (celui du projet
     * enregistré, quand on le connaît). Puis ce qui décide où part le jeton, dans toute la configuration lue par git
     * (fichiers inclus compris) : dans les fichiers du dépôt (`.git/config`, `.git/config.worktree`), qu'un agent peut
     * écrire depuis le projet, aucun réglage d'adresses (`url.*`), de réseau (`http.*`), d'identifiants, d'inclusion ni
     * d'`askPass` ; ailleurs (réglages de la personne, où un proxy d'entreprise ou un gestionnaire d'identifiants sont
     * normaux), aucun réglage HTTP propre à github.com (il l'emporterait sur ce que l'app impose). Refusé, jamais contourné.
     */
    async depotVerifie(cible, attendu) {
        const nom = await this.depotDe(cible);
        if (typeof attendu === "string" && attendu && attendu.toLowerCase() !== nom.toLowerCase())
            throw new Error("Ce dossier ne pointe plus vers le dépôt du projet : rien n’a été lu ni envoyé.");
        const r = await this.configGit(cible, ["config", "--includes", "--show-scope", "--name-only", "--get-regexp", "^(url|http|include|includeif|credential)\\.|^core\\.(askpass|gitproxy|sshcommand)$"]);
        if (r.code !== 0 && r.code !== 1)
            throw new Error("La configuration git de ce dossier n’a pas pu être vérifiée : rien n’est envoyé à GitHub.");
        const risques = r.sortie.split("\n").filter(Boolean).filter((ligne) => {
            const [portee, cle = ""] = ligne.split("\t");
            return portee === "local" || portee === "worktree" || /^http\.https?:\/\/([^/]*@)?github\.com([:/]|$)/i.test(cle);
        });
        if (risques.length)
            throw new Error("La configuration git de ce dossier change les adresses, le réseau ou les identifiants : rien n’est envoyé à GitHub depuis ce dossier.");
        return nom;
    }
    async racine(creer) {
        const base = path.resolve(this.d.base ?? path.dirname(this.d.racine));
        const relatif = path.relative(base, path.resolve(this.d.racine));
        if (!relatif || relatif.startsWith("..") || path.isAbsolute(relatif))
            throw new Error("Racine GitHub invalide.");
        let dossier = await realpath(base);
        for (const segment of relatif.split(path.sep)) {
            dossier = path.join(dossier, segment);
            if (creer)
                await mkdir(dossier).catch((e) => { if (e.code !== "EEXIST")
                    throw e; });
            if (await realpath(dossier) !== dossier)
                throw new Error("Le dossier GitHub est un lien : ouverture refusée.");
        }
        return dossier;
    }
    async ouvrir(depot, branche) {
        const nom = validerNomDepot(depot);
        validerBranche(branche);
        const compte = await this.connexion();
        const generation = this.generation;
        // Vérifier l'accès avec le compte choisi, avant de toucher au disque.
        if (!(await this.branches(nom)).includes(branche))
            throw new Error("Cette branche n’existe plus sur GitHub.");
        const racine = await this.racine(true);
        const [owner, repo] = nom.split("/");
        const parent = path.join(racine, owner);
        await mkdir(parent, { recursive: true });
        if (await realpath(parent) !== parent)
            throw new Error("Le dossier du dépôt est un lien : ouverture refusée.");
        const cible = path.join(parent, `${repo}-${createHash("sha256").update(branche).digest("hex").slice(0, 12)}`);
        if (this.clones.has(cible))
            throw new Error("Ce dépôt est déjà en cours d’ouverture.");
        this.clones.add(cible);
        let tmp = null;
        try {
            const existant = await realpath(cible).catch(() => null);
            if (existant) {
                if (existant !== cible)
                    throw new Error("Le dossier du dépôt est un lien : ouverture refusée.");
                const origine = (await this.commande("git", ["config", "--get", "remote.origin.url"], this.env(), cible)).trim();
                const tete = (await this.commande("git", ["branch", "--show-current"], this.env(), cible)).trim();
                const sommet = (await this.commande("git", ["rev-parse", "--show-toplevel"], this.env(), cible)).trim();
                if (path.resolve(sommet) !== cible || origine !== `https://github.com/${nom}.git` || tete !== branche)
                    throw new Error("Ce dossier appartient déjà à un autre dépôt ou à une autre branche. Rien n’a été changé.");
                return { dossier: cible, depot: nom, deja: true };
            }
            tmp = await mkdtemp(path.join(parent, ".klyra-clone-"));
            await this.commande("git", ["clone", "--no-recurse-submodules", "--branch", branche, "--", `https://github.com/${nom}.git`, tmp], this.gitEnv(compte.jeton), undefined, 5 * 60_000);
            if (generation !== this.generation)
                throw new Error("Le compte GitHub a changé pendant le clonage. Rouvre le dépôt avec le compte voulu.");
            await rename(tmp, cible);
            tmp = null;
            return { dossier: cible, depot: nom, deja: false };
        }
        finally {
            this.clones.delete(cible);
            if (tmp)
                await rm(tmp, { recursive: true, force: true });
        }
    }
    async dossier(dossier) {
        if (typeof dossier !== "string" || !path.isAbsolute(dossier))
            throw new Error("Dossier GitHub invalide.");
        const racine = await this.racine(false);
        const cible = await realpath(dossier);
        const rel = path.relative(racine, cible);
        if (!rel || rel.startsWith("..") || path.isAbsolute(rel))
            throw new Error("Ce projet n’est pas un dépôt GitHub de cette machine.");
        return cible;
    }
    async etatDepot(dossier) {
        return etatGit(await this.dossier(dossier));
    }
    /** Le dépôt GitHub d'un clone de cette machine, d'après son origine (jamais d'après l'écran ou un agent). */
    async depotDe(cible) {
        const origine = (await this.commande("git", ["config", "--get", "remote.origin.url"], this.env(), cible)).trim();
        const match = origine.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\.git$/);
        if (!match)
            throw new Error("Ce projet n’est pas relié à GitHub.");
        return validerNomDepot(match[1]);
    }
    /** Une réponse de l'API GitHub (une page), avec le jeton de cette machine. */
    async api(endpoint, c) {
        return JSON.parse(await this.commande(this.d.gh, ["api", "--method", "GET", endpoint], this.env(c.jeton)));
    }
    /** Un fichier changé, avant et après, pour l'onglet Git. */
    async diff(dossier, chemin, ancien) {
        return diffFichierGit(await this.dossier(dossier), chemin, ancien);
    }
    /**
     * Commit de ce qui a changé puis envoi de la branche en cours sur GitHub, avec le jeton de cette machine.
     * Sans identité git sur la machine (un VPS), le commit est signé du compte GitHub connecté (adresse noreply).
     * Les crochets git du dépôt ne tournent pas (comme au clonage) ; jamais de `--force`.
     */
    async publier(dossier, message, depotAttendu) {
        const c = await this.connexion();
        const cible = await this.dossier(dossier);
        const nom = await this.depotVerifie(cible, depotAttendu);
        const texteCommit = typeof message === "string" ? message.trim().slice(0, 5000) : "";
        const etat = await etatGit(cible);
        if (!etat.branche)
            throw new Error("Aucune branche : rien à publier.");
        const branche = validerBranche(etat.branche);
        if (etat.fichiers.length && !texteCommit)
            throw new Error("Écris ce qui change avant de publier.");
        if (!etat.fichiers.length && etat.enAvance === 0 && etat.suivie)
            return { ok: true, commit: null, branche, sortie: "Rien à publier : tout est déjà sur GitHub." };
        const env = this.gitEnv(c.jeton);
        if (etat.fichiers.length) {
            const identite = (await this.commande("git", ["config", "user.email"], this.env(), cible).catch(() => "")).trim() ? [] : await this.identite(c);
            // Sans le jeton : add et commit passent par les filtres du dépôt.
            const local = this.gitEnvLocal();
            try {
                await this.commande("git", [...identite, "add", "-A"], local, cible);
                await this.commande("git", [...identite, "commit", "--no-verify", "-m", texteCommit], local, cible);
            }
            catch {
                throw new Error("Le commit n’a pas abouti sur cette machine (un fichier verrouillé, ou l’identité git). Rien n’a été envoyé.");
            }
        }
        try {
            // Vers l'adresse du dépôt vérifié, jamais vers ce que l'origine du dossier dirait (`pushurl`).
            await this.commande("git", ["push", `https://github.com/${nom}.git`, `HEAD:refs/heads/${branche}`], env, cible, 5 * 60_000);
            // Un envoi vers une adresse ne met pas à jour la branche suivie : on la pose, l'état dit « à jour ».
            await this.commande("git", ["update-ref", `refs/remotes/origin/${branche}`, "HEAD"], this.gitEnvLocal(), cible).catch(() => "");
            if (!etat.suivie)
                await this.commande("git", ["branch", "--set-upstream-to", `origin/${branche}`], this.gitEnvLocal(), cible).catch(() => "");
        }
        catch {
            // Pas de sortie de git (elle peut porter une adresse) : on dit ce qu'on sait vérifier.
            await this.commande("git", ["fetch", `https://github.com/${nom}.git`, `+refs/heads/${branche}:refs/remotes/origin/${branche}`], env, cible, 5 * 60_000).catch(() => "");
            const apres = await etatGit(cible).catch(() => null);
            throw new Error((apres?.enRetard ?? 0) > 0
                ? `La branche ${branche} a avancé sur GitHub : récupère les nouveautés, puis publie. Ton commit est gardé ici.`
                : `GitHub a refusé l’envoi sur ${branche} (branche protégée, ou droits insuffisants sur ${nom}). Ton commit est gardé ici.`);
        }
        const sha = (await this.commande("git", ["rev-parse", "--short", "HEAD"], this.env(), cible).catch(() => "")).trim();
        return { ok: true, commit: sha || null, branche, sortie: `Publié sur ${nom}, branche ${branche}.` };
    }
    /** Le compte GitHub connecté, pour signer un commit quand la machine n'a pas d'identité git. */
    async identite(c) {
        const u = objet(await this.api("/user", c));
        const login = texte(u.login, 39).replace(/[^A-Za-z0-9-]/g, "") || c.compte;
        const id = entier(u.id);
        const email = id ? `${id}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com`;
        const nom = texte(u.name, 100).replace(/[<>\n]/g, "") || login;
        return ["-c", `user.name=${nom}`, "-c", `user.email=${email}`];
    }
    /**
     * Ce que GitHub dit du dépôt d'un projet de cette machine : pull requests ouvertes, tests de la branche en
     * cours, derniers commits. Chaque partie peut manquer (droits, réseau) sans faire échouer les autres.
     */
    async activite(dossier, depotAttendu) {
        const c = await this.connexion();
        const cible = await this.dossier(dossier);
        const nom = await this.depotVerifie(cible, depotAttendu);
        const branche = (await etatGit(cible)).branche;
        const ref = branche ? encodeURIComponent(validerBranche(branche)) : null;
        const essai = (f) => f().catch(() => null);
        const [pulls, tests, commits] = await Promise.all([
            essai(async () => lirePullRequests(await this.api(`/repos/${nom}/pulls?state=open&sort=updated&direction=desc&per_page=20`, c))),
            ref ? essai(async () => resumerTests(await this.api(`/repos/${nom}/commits/${ref}/check-runs?per_page=100`, c))) : Promise.resolve(null),
            essai(async () => lireCommits(await this.api(`/repos/${nom}/commits?per_page=8${ref ? `&sha=${ref}` : ""}`, c))),
        ]);
        return { depot: nom, url: `https://github.com/${nom}`, branche, pullRequests: pulls, tests, commits };
    }
    /** Une pull request du dépôt du projet, en détail : description, fichiers, avis, tests. */
    async pullRequest(dossier, numero, depotAttendu) {
        const n = typeof numero === "number" ? numero : Number(numero);
        if (!Number.isInteger(n) || n < 1 || n > 10_000_000)
            throw new Error("Numéro de pull request invalide.");
        const c = await this.connexion();
        const cible = await this.dossier(dossier);
        const nom = await this.depotVerifie(cible, depotAttendu);
        const p = objet(await this.api(`/repos/${nom}/pulls/${n}`, c));
        const [resume] = lirePullRequests([p]);
        if (!resume)
            throw new Error(`La pull request n° ${n} est introuvable sur ${nom}.`);
        const sha = typeof objet(p.head).sha === "string" ? String(objet(p.head).sha) : null;
        const essai = (f) => f().catch(() => null);
        const [fichiers, avis, tests] = await Promise.all([
            essai(async () => liste(await this.api(`/repos/${nom}/pulls/${n}/files?per_page=100`, c))),
            essai(async () => liste(await this.api(`/repos/${nom}/pulls/${n}/reviews?per_page=100`, c))),
            sha && /^[0-9a-f]{7,64}$/.test(sha) ? essai(async () => resumerTests(await this.api(`/repos/${nom}/commits/${sha}/check-runs?per_page=100`, c))) : Promise.resolve(null),
        ]);
        const dernierAvis = new Map();
        for (const a of avis ?? [])
            if (a.state && a.state !== "COMMENTED" && a.state !== "PENDING")
                dernierAvis.set(texte(objet(a.user).login, 60), String(a.state));
        return {
            ...resume,
            etat: p.merged === true || p.merged_at ? "fusionnee" : p.state === "closed" ? "fermee" : "ouverte",
            base: texte(objet(p.base).ref, 255),
            description: typeof p.body === "string" ? p.body.slice(0, 6000) : "",
            fusionnable: typeof p.mergeable_state === "string" ? p.mergeable_state : null,
            commentaires: entier(p.comments) + entier(p.review_comments),
            ajouts: entier(p.additions),
            suppressions: entier(p.deletions),
            fichiers: (fichiers ?? []).slice(0, 100).map((f) => ({ chemin: texte(f.filename, 300), statut: texte(f.status, 20), ajouts: entier(f.additions), suppressions: entier(f.deletions) })),
            avis: [...dernierAvis].map(([auteur, etat]) => ({ auteur, etat })),
            tests,
        };
    }
    async recuperer(dossier, depotAttendu) {
        const c = await this.connexion();
        const cible = await this.dossier(dossier);
        const nom = await this.depotVerifie(cible, depotAttendu);
        // La branche suivie sur GitHub (son nom peut différer de la branche locale), sinon la branche locale.
        const suivie = (await this.commande("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], this.env(), cible).catch(() => "")).trim();
        const branche = validerBranche(suivie.startsWith("origin/") ? suivie.slice("origin/".length) : ((await etatGit(cible)).branche ?? ""));
        // Le jeton pour la seule récupération ; l'avance rapide, sans lui (elle extrait des fichiers, donc des filtres).
        // git refuse les conflits ; aucun stash, reset ni merge automatique.
        await this.commande("git", ["fetch", `https://github.com/${nom}.git`, `+refs/heads/${branche}:refs/remotes/origin/${branche}`], this.gitEnv(c.jeton), cible, 5 * 60_000);
        await this.commande("git", ["merge", "--ff-only", `refs/remotes/origin/${branche}`], this.gitEnvLocal(), cible, 5 * 60_000);
        return etatGit(cible);
    }
}
