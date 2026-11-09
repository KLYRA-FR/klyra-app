// Généré par scripts/serveur-genere.mjs depuis electron/mcp-sante.ts : ne pas modifier à la main.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { nettoyerAnsi } from "./terminal.mjs";
/**
 * La veille des serveurs MCP des agents : prévenir AVANT qu'un agent bute sur une connexion expirée, et la
 * renouveler en un clic, sans terminal. Le 09/11/2026, le MCP Qonto de Camille était en « Needs authentication »
 * et la reconnexion demandait un terminal interactif.
 *
 * Chaque agent lit sa configuration de Claude Code dans son dossier préparé (`CLAUDE_CONFIG_DIR`,
 * `<données>/preparation/<agent>`, dont le `.claude.json` porte ses serveurs MCP) : la veille lance
 * `claude mcp list` avec ce dossier (le même contrôle de santé que Claude Code), garde pour chaque MCP son état et
 * depuis quand, et signale chaque changement une seule fois. « Reconnecter » lance
 * `claude mcp login <nom> --no-browser` dans un vrai PTY (module `terminal`, PR #258), rend le lien d'autorisation,
 * reçoit l'adresse de retour (localhost, qui ne s'ouvre pas quand l'agent tourne sur un VPS), la tape dans le PTY,
 * puis revérifie.
 *
 * Secrets : on ne garde de `claude mcp list` que le nom et l'état, jamais la cible (une commande ou une URL peut
 * porter une clé). L'adresse de retour porte un code d'autorisation à usage unique : elle va droit au PTY, masquée
 * dans sa sortie, n'est jamais écrite sur le disque ni dans un message d'erreur.
 *
 * Module pur : ni Electron ni disque (la lecture et l'écriture de l'état sont données). Généré en
 * `serveur/mcp-sante.mjs` pour un VPS.
 */
/** Toutes les heures, et au lancement (après `PREMIER_DELAI_MS`, que l'app ait fini de démarrer). */
export const INTERVALLE_MS = 60 * 60_000;
export const PREMIER_DELAI_MS = 30_000;
/** Une demande de vérification moins de 2 min après la dernière rend celle-ci (sauf `forcer`). */
export const FRAICHEUR_MS = 2 * 60_000;
/** Le temps laissé pour autoriser dans le navigateur avant de fermer le login. */
export const RECONNEXION_MAX_MS = 15 * 60_000;
/** La conversation à laquelle appartiennent les terminaux de reconnexion : aucun fil ne la voit. */
export const CONVERSATION_VEILLE = "klyra-veille-mcp";
const NOM_MCP = /^[A-Za-z0-9][A-Za-z0-9._:@ -]{0,99}$/;
export const ID_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** L'état d'après le texte que Claude Code met après le dernier « - ». */
function etatDe(statut) {
    if (/needs authentication/i.test(statut))
        return "authentification";
    if (/\bconnected\b/i.test(statut) && !/not connected|disconnected/i.test(statut))
        return "connecte";
    if (/pending approval/i.test(statut))
        return "attente";
    if (/fail|error|timed? ?out|disconnected|not connected/i.test(statut))
        return "echec";
    return "inconnu";
}
/**
 * Lit la sortie de `claude mcp list` (2.1.319) : une ligne `nom: cible - ✔ Connected` par serveur. La cible
 * n'est jamais gardée.
 */
export function lireListeMcp(sortie) {
    const lignes = [];
    for (const brute of nettoyerAnsi(sortie).split("\n")) {
        const ligne = brute.trim();
        const deuxPoints = ligne.indexOf(": ");
        const tiret = ligne.lastIndexOf(" - ");
        if (deuxPoints <= 0 || tiret <= deuxPoints)
            continue;
        const nom = ligne.slice(0, deuxPoints);
        if (!NOM_MCP.test(nom))
            continue;
        const cible = ligne.slice(deuxPoints + 2, tiret);
        const statut = ligne.slice(tiret + 3);
        const distant = /\((HTTP|SSE)\)\s*$/i.test(cible) || /^claude\.ai\b/i.test(nom);
        if (lignes.some((l) => l.nom === nom))
            continue;
        lignes.push({ nom, etat: etatDe(statut), distant });
    }
    return lignes;
}
export const enDefaut = (etat) => etat === "authentification" || etat === "echec";
/** `claude mcp list` avec le dossier de l'agent (le contrôle de santé de Claude Code), 60 s au plus. */
export function listerMcp(claude, d, delaiMs = 60_000) {
    if (!claude)
        return Promise.reject(new Error("Claude Code est introuvable sur cette machine."));
    const env = { ...process.env, CLAUDE_CONFIG_DIR: d.dossier, NO_COLOR: "1" };
    delete env.ELECTRON_RUN_AS_NODE;
    return new Promise((ok, ko) => {
        execFile(claude, ["mcp", "list"], { cwd: d.cwd, env, timeout: delaiMs, maxBuffer: 1024 * 1024, windowsHide: true }, (erreur, stdout) => {
            if (erreur && !stdout)
                ko(new Error(erreur.killed ? "Claude Code n'a pas répondu à temps." : "Claude Code n'a pas pu lister les serveurs MCP."));
            else
                ok(String(stdout));
        });
    });
}
const cle = (agent, mcp) => `${agent}\u0000${mcp}`;
/** Ce qu'on accepte de l'état gardé : des entrées bien formées, rien d'autre. */
export function etatGarde(brut) {
    const o = brut && typeof brut === "object" ? brut : {};
    const etats = ["connecte", "authentification", "echec", "attente", "inconnu"];
    const entrees = (Array.isArray(o.entrees) ? o.entrees : []).flatMap((e) => {
        const x = e && typeof e === "object" ? e : {};
        if (typeof x.agent !== "string" || !ID_AGENT.test(x.agent) || typeof x.mcp !== "string" || !NOM_MCP.test(x.mcp))
            return [];
        if (!etats.includes(x.etat) || typeof x.depuis !== "number" || !Number.isFinite(x.depuis))
            return [];
        return [{ agent: x.agent, mcp: x.mcp, etat: x.etat, distant: x.distant === true, depuis: x.depuis }];
    });
    return { entrees, verifieLe: typeof o.verifieLe === "number" && Number.isFinite(o.verifieLe) ? o.verifieLe : null };
}
/** Le texte d'une erreur, sans adresse (une URL peut porter un code ou un jeton). */
export function sansAdresse(texte) {
    return texte.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[adresse]").replace(/\s+/g, " ").trim().slice(0, 240);
}
/** La veille d'un poste ou d'un serveur : un seul par process. */
export function creerVeilleMcp(options) {
    const maintenant = options.maintenant ?? Date.now;
    const garde = etatGarde(options.lire?.());
    const entrees = new Map(garde.entrees.map((e) => [cle(e.agent, e.mcp), e]));
    let verifieLe = garde.verifieLe;
    let erreurs = [];
    let enCours = null;
    const ecouteurs = new Set();
    let minuterie = null;
    let premier = null;
    const etat = () => ({
        entrees: [...entrees.values()].sort((a, b) => a.agent.localeCompare(b.agent) || a.mcp.localeCompare(b.mcp)),
        verifieLe,
        enCours: enCours !== null,
        erreurs: [...erreurs],
    });
    /** Range la liste d'un agent : un changement d'état date l'entrée et part une fois aux écouteurs. */
    function ranger(agent, lignes, t, changements) {
        const vus = new Set();
        for (const l of lignes) {
            const k = cle(agent, l.nom);
            vus.add(k);
            const avant = entrees.get(k);
            if (avant && avant.etat === l.etat) {
                entrees.set(k, { ...avant, distant: l.distant });
                continue;
            }
            entrees.set(k, { agent, mcp: l.nom, etat: l.etat, distant: l.distant, depuis: t });
            changements.push({ agent, mcp: l.nom, avant: avant?.etat ?? null, apres: l.etat, depuis: t });
        }
        for (const [k, e] of [...entrees]) {
            if (e.agent !== agent || vus.has(k))
                continue;
            entrees.delete(k);
            changements.push({ agent, mcp: e.mcp, avant: e.etat, apres: null, depuis: t });
        }
    }
    async function executer(seulement) {
        const changements = [];
        const liste = options.agents().filter((d) => ID_AGENT.test(d.agent) && (!seulement || d.agent === seulement));
        const nouvellesErreurs = seulement ? erreurs.filter((e) => e.agent !== seulement) : [];
        for (const d of liste) {
            try {
                ranger(d.agent, lireListeMcp(await options.lister(d)), maintenant(), changements);
            }
            catch (e) {
                // L'état d'avant reste : on ne sait rien de neuf sur cet agent.
                nouvellesErreurs.push({ agent: d.agent, message: sansAdresse(e instanceof Error ? e.message : String(e)) || "Vérification impossible." });
            }
        }
        if (!seulement) {
            // Un agent qui n'est plus là (désactivé, retiré) : ses entrées partent, sans alerte.
            const presents = new Set(liste.map((d) => d.agent));
            for (const [k, e] of [...entrees])
                if (!presents.has(e.agent))
                    entrees.delete(k);
        }
        erreurs = nouvellesErreurs;
        verifieLe = maintenant();
        options.ecrire?.({ entrees: [...entrees.values()], verifieLe });
        if (changements.length)
            for (const f of ecouteurs)
                f(changements);
        return etat();
    }
    /** Vérifie maintenant (un agent, ou tous). Une vérification en cours est rejointe ; une toute fraîche est rendue. */
    async function verifier(o = {}) {
        const seulement = o.agent && ID_AGENT.test(o.agent) ? o.agent : null;
        if (enCours) {
            await enCours.catch(() => undefined);
            if (!seulement && !o.forcer)
                return etat();
        }
        if (!seulement && !o.forcer && verifieLe !== null && maintenant() - verifieLe < FRAICHEUR_MS)
            return etat();
        enCours = executer(seulement);
        try {
            return await enCours;
        }
        finally {
            enCours = null;
        }
    }
    function demarrer() {
        if (minuterie)
            return;
        premier = setTimeout(() => void verifier({ forcer: true }).catch(() => undefined), options.premierDelaiMs ?? PREMIER_DELAI_MS);
        minuterie = setInterval(() => void verifier({ forcer: true }).catch(() => undefined), options.intervalleMs ?? INTERVALLE_MS);
        premier.unref?.();
        minuterie.unref?.();
    }
    function arreter() {
        if (premier)
            clearTimeout(premier);
        if (minuterie)
            clearInterval(minuterie);
        premier = null;
        minuterie = null;
    }
    return {
        etat,
        verifier,
        demarrer,
        arreter,
        surChangement: (f) => {
            ecouteurs.add(f);
            return () => ecouteurs.delete(f);
        },
    };
}
/* ─── Alertes : une par changement d'état ─── */
/** La clé d'une alerte : le même défaut, depuis la même date, n'alerte qu'une fois. */
export const cleAlerte = (lieu, e) => `${lieu ?? ""}|${e.agent}|${e.mcp}|${e.etat}|${e.depuis}`;
/**
 * Les défauts pas encore signalés, et les clés à garder (celles des défauts encore là : les autres sont oubliées,
 * pour qu'un retour en défaut plus tard alerte de nouveau).
 */
export function alertesNouvelles(lieu, entrees, dejaVues) {
    const defauts = entrees.filter((e) => enDefaut(e.etat));
    const cles = defauts.map((e) => cleAlerte(lieu, e));
    return { nouvelles: defauts.filter((e, i) => !dejaVues.has(cles[i])), cles };
}
const guillemets = (s) => `'${s.replace(/'/g, "'\\''")}'`;
/** La commande tapée dans le PTY : le dossier de l'agent, puis le login sans navigateur. */
export function commandeLogin(claude, dossier, mcp) {
    return `CLAUDE_CONFIG_DIR=${guillemets(dossier)} exec ${guillemets(claude)} mcp login ${guillemets(mcp)} --no-browser`;
}
/** Le lien d'autorisation que Claude Code écrit (« Visit this URL to authorize: »), ou null. */
export function lienAutorisation(sortie) {
    const texte = nettoyerAnsi(sortie);
    const apres = texte.split(/visit this url[^\n]*\n/i)[1] ?? texte;
    const m = apres.match(/https?:\/\/[^\s"'<>]+/);
    if (!m)
        return null;
    try {
        const u = new URL(m[0]);
        const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
        return u.protocol === "https:" || (u.protocol === "http:" && local) ? u.toString() : null;
    }
    catch {
        return null;
    }
}
/**
 * L'adresse de retour que la personne colle : http(s) vers localhost ou 127.0.0.1, avec un `code`, sur une ligne.
 * Renvoie l'adresse telle quelle, ou null.
 */
export function adresseRetour(brut) {
    if (typeof brut !== "string")
        return null;
    const v = brut.trim();
    if (!v || v.length > 4096 || /[\s\x00-\x1f\x7f]/.test(v))
        return null;
    try {
        const u = new URL(v);
        if (u.protocol !== "http:" && u.protocol !== "https:")
            return null;
        if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1")
            return null;
        if (!u.searchParams.get("code") && !u.searchParams.get("error"))
            return null;
        return v;
    }
    catch {
        return null;
    }
}
const reussi = (texte) => /authenticated with|authentication successful|successfully authenticated/i.test(texte);
/** La dernière ligne utile d'un login raté, sans adresse. */
function raisonEchec(texte) {
    const lignes = texte.split("\n").map((l) => l.trim()).filter((l) => l && !/^https?:\/\//.test(l) && !/paste the redirect/i.test(l));
    return sansAdresse(lignes.at(-1) ?? "") || "La connexion n'a pas abouti.";
}
/** Les reconnexions en cours d'un poste ou d'un serveur. */
export function creerReconnexions(options) {
    const maintenant = options.maintenant ?? Date.now;
    const attente = options.attenteMs ?? 20_000;
    const enCours = new Map();
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const vue = (r) => ({ id: r.id, agent: r.agent, mcp: r.mcp, etat: r.etat, lien: r.lien, message: r.message });
    const sortie = (r) => nettoyerAnsi(options.terminaux.flux(r.terminal, 0)?.donnees ?? "");
    function clore(r) {
        options.terminaux.fermer(r.terminal);
    }
    /** Après la fin du login : la veille revérifie l'agent ; seul « Connected » vaut réussite. */
    function verifierApres(r, texte) {
        if (r.verification)
            return r.verification;
        r.verification = (async () => {
            clore(r);
            const apres = await options.veille.verifier({ agent: r.agent, forcer: true });
            const e = apres.entrees.find((x) => x.agent === r.agent && x.mcp === r.mcp);
            if (e?.etat === "connecte") {
                r.etat = "connecte";
                r.message = "Connecté.";
            }
            else {
                r.etat = "echec";
                r.message = reussi(texte) ? "Claude Code dit être connecté, mais le serveur ne répond pas encore : réessaie dans un instant." : raisonEchec(texte);
            }
        })();
        return r.verification;
    }
    /** Relit le terminal : lien apparu, login fini (seul, si le navigateur a pu joindre localhost), ou trop long. */
    async function suivre(id) {
        const r = typeof id === "string" ? enCours.get(id) : undefined;
        if (!r)
            return null;
        if (r.etat !== "attente")
            return vue(r);
        const f = options.terminaux.flux(r.terminal, 0);
        const texte = nettoyerAnsi(f?.donnees ?? "");
        if (!r.lien)
            r.lien = lienAutorisation(texte);
        if (!f || f.fini)
            await verifierApres(r, texte);
        else if (maintenant() - r.ouvertLe > RECONNEXION_MAX_MS) {
            clore(r);
            r.etat = "echec";
            r.message = "Trop long : la demande d'autorisation a été fermée. Relance « Reconnecter ».";
        }
        return vue(r);
    }
    async function demarrer(agent, mcp) {
        if ((options.plateforme ?? process.platform) === "win32")
            throw new Error("La reconnexion sans terminal n'existe pas encore sous Windows.");
        if (typeof agent !== "string" || !ID_AGENT.test(agent) || typeof mcp !== "string")
            throw new Error("Demande invalide.");
        const d = options.agents().find((x) => x.agent === agent);
        if (!d)
            throw new Error("Cet agent n'est pas sur cette machine.");
        const e = options.veille.etat().entrees.find((x) => x.agent === agent && x.mcp === mcp);
        if (!e)
            throw new Error("Ce serveur MCP n'est pas dans la configuration de cet agent : relance la vérification.");
        if (!e.distant)
            throw new Error("Ce serveur MCP tourne sur la machine (commande) : il ne se reconnecte pas par le navigateur.");
        const claude = options.claude();
        if (!claude)
            throw new Error("Claude Code est introuvable sur cette machine.");
        // Une seule à la fois par MCP : la précédente est fermée.
        for (const autre of [...enCours.values()]) {
            if (autre.agent === agent && autre.mcp === mcp) {
                clore(autre);
                enCours.delete(autre.id);
            }
        }
        const t = options.terminaux.ouvrir({ conversation: CONVERSATION_VEILLE, agent }, { commande: commandeLogin(claude, d.dossier, mcp), dossier: d.cwd, titre: `Reconnecter ${mcp}` });
        const r = { id: `mcpr-${randomBytes(6).toString("hex")}`, agent, mcp, terminal: t.id, ouvertLe: maintenant(), etat: "attente", lien: null, message: "Ouvre le lien, connecte-toi, puis colle l'adresse de la page qui ne s'ouvre pas.", verification: null };
        enCours.set(r.id, r);
        const fin = Date.now() + attente;
        while (Date.now() < fin) {
            await suivre(r.id);
            if (r.lien || r.etat !== "attente")
                break;
            await pause(150);
        }
        if (r.etat === "attente" && !r.lien) {
            const texte = sortie(r);
            clore(r);
            r.etat = "echec";
            r.message = raisonEchec(texte);
        }
        return vue(r);
    }
    /** L'adresse de retour collée : tapée dans le PTY (masquée dans sa sortie), puis on attend la fin et on revérifie. */
    async function retour(id, adresse) {
        const r = typeof id === "string" ? enCours.get(id) : undefined;
        if (!r)
            throw new Error("Cette demande de connexion n'existe plus : relance « Reconnecter ».");
        if (r.etat !== "attente")
            return vue(r);
        const url = adresseRetour(adresse);
        if (!url)
            throw new Error("Ce n'est pas l'adresse de retour : colle toute l'adresse de la page qui ne s'ouvre pas (elle commence par http://localhost).");
        if (!options.terminaux.saisir(r.terminal, url, { secret: true }) || !options.terminaux.saisir(r.terminal, "\r")) {
            await verifierApres(r, sortie(r));
            return vue(r);
        }
        const fin = Date.now() + attente;
        while (Date.now() < fin) {
            const f = options.terminaux.flux(r.terminal, 0);
            if (!f || f.fini || reussi(nettoyerAnsi(f.donnees)))
                break;
            await pause(150);
        }
        await verifierApres(r, sortie(r));
        return vue(r);
    }
    function annuler(id) {
        const r = typeof id === "string" ? enCours.get(id) : undefined;
        if (!r)
            return false;
        clore(r);
        enCours.delete(r.id);
        return true;
    }
    function fermerTout() {
        for (const r of enCours.values())
            clore(r);
        enCours.clear();
    }
    return { demarrer, suivre, retour, annuler, fermerTout };
}
