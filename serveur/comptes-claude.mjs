// Généré par scripts/serveur-genere.mjs depuis electron/comptes-claude.ts : ne pas modifier à la main.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { lireUtilisation } from "./utilisation.mjs";
/** Les pages de connexion d'Anthropic : la seule adresse qu'un serveur peut faire ouvrir au PC. */
const HOTES_CONNEXION = new Set(["claude.com", "claude.ai", "platform.claude.com", "console.anthropic.com"]);
export function urlConnexionValide(brut) {
    if (typeof brut !== "string" || brut.length > 4_000)
        return null;
    try {
        const url = new URL(brut);
        return url.protocol === "https:" && HOTES_CONNEXION.has(url.hostname) && /\/oauth\/authorize$/.test(url.pathname) && !url.username && !url.password ? url.toString() : null;
    }
    catch {
        return null;
    }
}
/** Le code affiché par Anthropic à la fin de la connexion (`code#state`) : rien d'autre ne part vers Claude Code. */
export function codeConnexionValide(brut) {
    if (typeof brut !== "string")
        return null;
    const code = brut.trim();
    return code.length >= 8 && code.length <= 2_000 && /^[A-Za-z0-9._~#-]+$/.test(code) ? code : null;
}
/** La requête qui fait donner ses limites à Claude Code : la plus petite possible, sans outil, MCP ni session gardée. */
export const ARGS_SONDE = ["-p", "Réponds seulement : ok", "--model", "haiku", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--strict-mcp-config", "--tools", ""];
/** Les limites d'une sortie `stream-json` : chaque `rate_limit_event`, dans l'ordre. */
export function utilisationDeSortie(sortie, precedente, maintenant = Date.now()) {
    let u = precedente;
    for (const ligne of sortie.split("\n")) {
        try {
            const msg = JSON.parse(ligne);
            if (msg?.type === "rate_limit_event")
                u = lireUtilisation(msg.rate_limit_info, u, maintenant) ?? u;
        }
        catch {
            /* ligne qui n'est pas du JSON */
        }
    }
    return u;
}
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** Un compte supplémentaire : son identifiant (« poste » désigne le compte des agents, pas un dossier). */
export function idCompteSupplementaire(brut) {
    return typeof brut === "string" && ID.test(brut) ? brut : null;
}
/**
 * Le dossier de connexion d'un compte supplémentaire, pour une session d'agent : sous `racine` (`claude-comptes`
 * des données de l'app, ou du serveur), jamais un lien. Une erreur lisible s'il n'existe plus.
 */
export function dossierCompteClaude(racine, id) {
    if (!ID.test(id))
        throw new Error("Compte Claude invalide.");
    const base = path.resolve(racine);
    const dossier = path.join(base, id);
    let stat;
    try {
        stat = lstatSync(dossier);
    }
    catch {
        throw new Error("Ce compte Claude n’est plus connecté ici. Choisis un autre compte dans le choix du modèle.");
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(dossier) !== path.join(realpathSync(base), id)) {
        throw new Error("Le dossier de ce compte Claude n’est pas isolé.");
    }
    return dossier;
}
/**
 * L'environnement d'une session d'agent qui travaille avec un compte supplémentaire. `CLAUDE_CONFIG_DIR` reste le
 * dossier préparé (fiches, skills, CLAUDE.md, sessions) ; Claude Code lit la connexion dans
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR` (`<dossier>/.credentials.json`, ou l'entrée du trousseau du Mac nommée d'après ce
 * dossier : celle que `claude auth login` a écrite avec le même environnement ; lu dans Claude Code 2.1.318).
 * Un jeton ou une clé du poste passerait devant : ils sont retirés, l'adresse du fournisseur reste.
 */
export function environnementAvecCompte(env, dossier) {
    const propre = Object.fromEntries(Object.entries(env).filter(([nom]) => !/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_SESSION_ACCESS_TOKEN$|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)$|CLAUDE_SECURESTORAGE_CONFIG_DIR$)/i.test(nom)));
    return { ...propre, CLAUDE_SECURESTORAGE_CONFIG_DIR: dossier };
}
/** Rien du compte du terminal parent ne doit masquer celui du dossier isolé. */
export function environnementCompte(env, dossier) {
    const propre = Object.fromEntries(Object.entries(env).filter(([nom]) => !/^(ANTHROPIC_|CLAUDE_(CONFIG_DIR|SECURESTORAGE_CONFIG_DIR)$|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_SESSION_ACCESS_TOKEN$|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)$)/i.test(nom)));
    return { ...propre, CLAUDE_CONFIG_DIR: dossier, CLAUDE_SECURESTORAGE_CONFIG_DIR: dossier };
}
function commande(home) {
    return (bin, args, env, delai) => new Promise((resolve, reject) => {
        const child = spawn(bin, args, { cwd: home, env, windowsHide: true });
        let sortie = "";
        let depasse = false;
        // La sortie de connexion peut contenir une URL d'autorisation : elle ne quitte pas main.
        child.stdout.on("data", (d) => { sortie = (sortie + d.toString()).slice(-256_000); });
        child.stderr.on("data", () => { });
        const timeout = setTimeout(() => { depasse = true; child.kill(); }, delai);
        child.once("error", () => { clearTimeout(timeout); reject(new Error("Impossible de lancer Claude Code.")); });
        child.once("close", (code) => {
            clearTimeout(timeout);
            if (depasse)
                reject(new Error("Claude Code n’a pas répondu à temps. Réessaie la connexion."));
            else
                resolve({ code, sortie });
        });
        child.stdin.end();
    });
}
function lancerProcessus(home) {
    return (bin, args, env) => {
        const child = spawn(bin, args, { cwd: home, env, windowsHide: true });
        const abonnes = [];
        child.stdout.on("data", (d) => abonnes.forEach((cb) => cb(d.toString())));
        child.stderr.on("data", () => { });
        const fin = new Promise((resolve) => {
            child.once("error", () => resolve(null));
            child.once("close", (code) => resolve(code));
        });
        return {
            surSortie: (cb) => { abonnes.push(cb); },
            ecrire: (texte) => { if (child.stdin.writable)
                child.stdin.write(texte); },
            fin,
            arreter: () => { child.kill(); },
        };
    };
}
/**
 * Un dossier de connexion par compte claude.ai. Aucune copie de credentials ni changement de process.env :
 * les agents gardent le compte du poste, sauf dans une conversation où la personne choisit ce compte
 * (choix du modèle) : sa session lit alors la connexion de ce dossier (`environnementAvecCompte`).
 * https://code.claude.com/docs/en/authentication#log-in-with-multiple-accounts
 */
export class ComptesClaude {
    action = false;
    executer;
    lancer;
    options;
    /** La connexion en deux temps en cours : une seule à la fois. */
    attente = null;
    utilisations = null;
    sondes = new Map();
    constructor(options) {
        this.options = options;
        this.executer = options.executer ?? commande(options.home);
        this.lancer = options.lancer ?? lancerProcessus(options.home);
    }
    async dossier(id) {
        if (!ID.test(id))
            throw new Error("Compte Claude invalide.");
        const racine = path.resolve(this.options.dossier);
        const dossier = path.join(racine, id);
        const stat = await lstat(dossier).catch(() => { throw new Error("Ce compte Claude n’existe plus."); });
        if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(dossier) !== path.join(await realpath(racine), id)) {
            throw new Error("Le dossier de ce compte Claude n’est pas isolé.");
        }
        return dossier;
    }
    vide(id) {
        const bin = this.options.binaire();
        return {
            id, poste: false, installe: !!bin, chemin: bin, version: null, connecte: false,
            methode: null, email: null, organisation: null, abonnement: null, verifieLe: Date.now(),
        };
    }
    async lireIsole(id) {
        const dossier = await this.dossier(id);
        const vide = this.vide(id);
        const bin = vide.chemin;
        if (!bin)
            return vide;
        const env = environnementCompte(this.options.environnement(), dossier);
        const [version, statut] = await Promise.all([
            this.executer(bin, ["--version"], env, 15_000),
            this.executer(bin, ["auth", "status", "--json"], env, 15_000),
        ]);
        let s;
        try {
            s = JSON.parse(statut.sortie.slice(statut.sortie.indexOf("{")));
            if (!s || typeof s.loggedIn !== "boolean")
                throw new Error();
        }
        catch {
            throw new Error("Impossible de vérifier ce compte Claude. Réessaie.");
        }
        const texte = (v) => typeof v === "string" && v ? v : null;
        return {
            ...vide, version: version.sortie.match(/\d+\.\d+\.\d+/)?.[0] ?? null,
            connecte: s.loggedIn === true, methode: texte(s.authMethod), email: texte(s.email),
            organisation: texte(s.orgName), abonnement: texte(s.subscriptionType),
        };
    }
    async lire(id) {
        if (id === "poste")
            return { ...await this.options.poste.lire(), id, poste: true };
        const compte = await this.lireIsole(id);
        return this.attente?.id === id && !compte.connecte ? { ...compte, attenteCode: true } : compte;
    }
    async lister() {
        let entrees;
        try {
            entrees = await readdir(this.options.dossier, { withFileTypes: true });
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
            entrees = [];
        }
        const ids = entrees.filter((e) => e.isDirectory() && !e.isSymbolicLink() && ID.test(e.name)).map((e) => e.name).sort();
        return Promise.all([this.lire("poste"), ...ids.map((id) => this.lire(id).catch(() => ({
                ...this.vide(id), erreur: "Impossible de vérifier ce compte Claude. Réessaie.",
            })))]);
    }
    /** Les mutations sont sérialisées aussi côté main, même avec plusieurs fenêtres. */
    async modifier(agir) {
        if (this.action)
            throw new Error("Une connexion ou une déconnexion Claude est déjà en cours.");
        this.action = true;
        try {
            return await agir();
        }
        finally {
            this.action = false;
        }
    }
    connecter(id) {
        return this.modifier(async () => {
            if (!this.options.binaire())
                throw new Error("Claude Code est introuvable sur ce poste.");
            if (id !== undefined) {
                if ((await this.lire(id)).connecte)
                    throw new Error("Ce compte Claude est déjà connecté. Ajoute un autre compte.");
            }
            else {
                id = randomUUID();
                await mkdir(this.options.dossier, { recursive: true, mode: 0o700 });
                await mkdir(path.join(this.options.dossier, id), { mode: 0o700 });
            }
            if (id === "poste")
                return { ...await this.options.poste.connecter(), id, poste: true };
            const dossier = await this.dossier(id);
            const r = await this.executer(this.options.binaire(), ["auth", "login", "--claudeai"], environnementCompte(this.options.environnement(), dossier), 5 * 60_000);
            if (r.code !== 0)
                throw new Error("La connexion Claude n’a pas abouti. Réessaie depuis le navigateur.");
            const compte = await this.lire(id);
            if (!compte.connecte)
                throw new Error("La connexion Claude n’a pas abouti. Réessaie depuis le navigateur.");
            return compte;
        });
    }
    deconnecter(id) {
        return this.modifier(async () => {
            if (id === "poste")
                return { ...await this.options.poste.deconnecter(), id, poste: true };
            const dossier = await this.dossier(id);
            if (this.attente?.id === id)
                this.abandonner();
            const bin = this.options.binaire();
            if (!bin)
                throw new Error("Claude Code est introuvable sur ce poste.");
            const r = await this.executer(bin, ["auth", "logout"], environnementCompte(this.options.environnement(), dossier), 30_000);
            if (r.code !== 0)
                throw new Error("Ce compte Claude n’a pas pu être déconnecté. Réessaie.");
            const compte = await this.lire(id);
            if (compte.connecte)
                throw new Error("Ce compte Claude est encore connecté. Réessaie.");
            await this.garderUtilisation(id, null);
            return compte;
        });
    }
    /* ─── Connexion en deux temps (serveur sans navigateur) ───────── */
    abandonner() {
        if (!this.attente)
            return;
        clearTimeout(this.attente.minuteur);
        this.attente.processus.arreter();
        this.attente = null;
    }
    /**
     * Lance `claude auth login` sans navigateur et rend l'adresse de la page Anthropic, que l'app ouvre sur le PC.
     * Claude Code attend ensuite le code affiché à la fin de cette page (`terminerConnexion`). Redemandée pour le
     * compte déjà en attente, elle rend la même page. Une autre connexion en attente est abandonnée.
     */
    commencerConnexion(id) {
        return this.modifier(async () => {
            if (!this.options.binaire())
                throw new Error("Claude Code est introuvable sur ce poste.");
            if (id === "poste")
                return { compte: { ...await this.options.poste.connecter(), id, poste: true }, url: null };
            if (id !== undefined && this.attente?.id === id)
                return { compte: await this.lire(id), url: this.attente.url };
            if (id !== undefined) {
                if ((await this.lire(id)).connecte)
                    throw new Error("Ce compte Claude est déjà connecté. Ajoute un autre compte.");
            }
            else {
                id = randomUUID();
                await mkdir(this.options.dossier, { recursive: true, mode: 0o700 });
                await mkdir(path.join(this.options.dossier, id), { mode: 0o700 });
            }
            this.abandonner();
            const dossier = await this.dossier(id);
            const processus = this.lancer(this.options.binaire(), ["auth", "login", "--claudeai"], environnementCompte(this.options.environnement(), dossier));
            const url = await new Promise((resolve, reject) => {
                let sortie = "";
                const delai = setTimeout(() => { processus.arreter(); reject(new Error("Claude Code n’a pas donné la page de connexion à temps. Réessaie.")); }, this.options.delais?.url ?? 30_000);
                processus.surSortie((texte) => {
                    sortie = (sortie + texte).slice(-16_000);
                    const lue = urlConnexionValide(sortie.match(/https:\/\/[^\s"'<>]+\/oauth\/authorize\?[^\s"'<>]+/)?.[0]);
                    if (lue) {
                        clearTimeout(delai);
                        resolve(lue);
                    }
                });
                void processus.fin.then(() => { clearTimeout(delai); reject(new Error("La connexion Claude n’a pas pu commencer. Réessaie.")); });
            });
            const minuteur = setTimeout(() => { if (this.attente?.processus === processus)
                this.abandonner(); }, this.options.delais?.attente ?? 10 * 60_000);
            this.attente = { id, url, processus, minuteur };
            void processus.fin.then(() => { if (this.attente?.processus === processus) {
                clearTimeout(minuteur);
                this.attente = null;
            } });
            return { compte: { ...await this.lire(id), attenteCode: true }, url };
        });
    }
    /** Donne à Claude Code le code collé par la personne, attend la fin de la connexion et relit le compte. */
    terminerConnexion(id, brut) {
        return this.modifier(async () => {
            const attente = this.attente;
            if (!attente || attente.id !== id)
                throw new Error("Cette connexion a expiré. Relance « Se connecter ».");
            const code = codeConnexionValide(brut);
            if (!code)
                throw new Error("Ce code n’a pas la bonne forme. Copie le code entier affiché par Anthropic.");
            attente.processus.ecrire(`${code}\n`);
            let delai;
            const fin = await Promise.race([
                attente.processus.fin,
                new Promise((resolve) => { delai = setTimeout(() => resolve("delai"), this.options.delais?.code ?? 90_000); }),
            ]).finally(() => clearTimeout(delai));
            if (this.attente === attente) {
                clearTimeout(attente.minuteur);
                this.attente = null;
            }
            if (fin === "delai")
                attente.processus.arreter();
            if (fin !== 0)
                throw new Error("Ce code n’a pas été accepté. Relance « Se connecter » pour en obtenir un nouveau.");
            const compte = await this.lire(id);
            if (!compte.connecte)
                throw new Error("La connexion Claude n’a pas abouti. Relance « Se connecter ».");
            return compte;
        });
    }
    /* ─── Limites de l'abonnement de chaque compte ───────────────── */
    get fichierUtilisations() {
        return path.join(this.options.dossier, "utilisations.json");
    }
    lireUtilisations() {
        this.utilisations ??= readFile(this.fichierUtilisations, "utf8")
            .then((brut) => {
            const lu = JSON.parse(brut);
            return lu && typeof lu === "object" && !Array.isArray(lu) ? Object.fromEntries(Object.entries(lu).filter(([id]) => ID.test(id))) : {};
        })
            .catch(() => ({}));
        return this.utilisations;
    }
    async garderUtilisation(id, u) {
        const toutes = { ...await this.lireUtilisations() };
        if (u)
            toutes[id] = u;
        else if (!(id in toutes))
            return;
        else
            delete toutes[id];
        this.utilisations = Promise.resolve(toutes);
        await mkdir(this.options.dossier, { recursive: true, mode: 0o700 });
        const temporaire = `${this.fichierUtilisations}.${process.pid}.tmp`;
        await writeFile(temporaire, JSON.stringify(toutes), { mode: 0o600 });
        await rename(temporaire, this.fichierUtilisations);
    }
    /** Les limites qu'une session d'agent de ce compte vient de recevoir (`rate_limit_event`) : gardées comme une lecture. */
    async noterLimites(id, info) {
        if (!ID.test(id))
            return null;
        const precedente = (await this.lireUtilisations())[id] ?? null;
        const u = lireUtilisation(info, precedente);
        if (u && u !== precedente)
            await this.garderUtilisation(id, u).catch(() => { });
        return u;
    }
    /**
     * Les limites d'un compte : la dernière lue, ou relue (`actualiser`) par une toute petite requête faite avec
     * ce compte seulement. Rien ne les relit d'office ; une conversation qui travaille avec ce compte les note au passage.
     */
    async utilisation(id, actualiser) {
        if (id === "poste")
            return (await this.options.poste.utilisation?.(actualiser)) ?? null;
        const dossier = await this.dossier(id);
        const precedente = (await this.lireUtilisations())[id] ?? null;
        const bin = this.options.binaire();
        if (!actualiser || !bin)
            return precedente;
        const enCours = this.sondes.get(id);
        if (enCours)
            return enCours;
        const sonde = (async () => {
            const r = await this.executer(bin, ARGS_SONDE, environnementCompte(this.options.environnement(), dossier), 60_000).catch(() => null);
            const u = r ? utilisationDeSortie(r.sortie, precedente) : precedente;
            if (u && u !== precedente)
                await this.garderUtilisation(id, u).catch(() => { });
            return u;
        })().finally(() => this.sondes.delete(id));
        this.sondes.set(id, sonde);
        return sonde;
    }
}
