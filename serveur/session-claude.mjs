// Généré par scripts/serveur-genere.mjs depuis electron/session-claude.ts : ne pas modifier à la main.
/**
 * Ce que l'app lit et demande à Claude Code pendant une conversation, au-delà du texte et des étapes : sa
 * réflexion, ses questions à choix, son plan, les modifications de fichiers (avant / après, pour les annuler),
 * la sortie d'une commande pendant qu'elle tourne, la taille du contexte et les commandes « / » de la session.
 * Pur et sans Electron : le même module sert à electron/claude.ts et au serveur d'un VPS (généré en
 * `serveur/session-claude.mjs`). Protocole vérifié avec Claude Code 2.1.319 face à un faux fournisseur :
 * - réflexion : `stream_event` `content_block_start` (`thinking`) puis `thinking_delta`, rendue lisible par
 *   `--thinking-display summarized` (sans lui, l'API peut l'omettre) ;
 * - questions : `can_use_tool` « AskUserQuestion » ; la réponse est `updatedInput` avec `answers`
 *   (« question » → libellé choisi), que Claude Code rend au modèle ;
 * - plan : en mode « plan », `can_use_tool` « ExitPlanMode » arrive sans le plan (`input` vide) : le plan est
 *   dans l'appel d'outil (`tool_use`), retenu par son id ;
 * - crochets : la requête `initialize` déclare des rappels `PreToolUse` / `PostToolUse` ; Claude Code envoie alors
 *   `hook_callback` (avec `tool_use_id`) avant et après chaque modification de fichier, et attend la réponse ;
 * - sortie : `task_started` (`task_id`, `tool_use_id`) puis `get_task_output` rend les derniers 8 Kio écrits,
 *   même pour une commande au premier plan ;
 * - `get_context_usage` (`detail: "summary"`) : la fenêtre et sa répartition ; la réponse à `initialize` et
 *   `commands_changed` : les commandes « / » de la session.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
/** La réflexion du modèle, résumée et lisible dans le flux (cf. `--thinking-display`). */
export const ARGS_REFLEXION = ["--thinking-display", "summarized"];
/** Les outils qui modifient un fichier : l'app garde ce qu'il y avait avant et après. */
export const OUTILS_MODIFICATION = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
export const CROCHET_AVANT = "klyra-avant";
export const CROCHET_APRES = "klyra-apres";
/** Ce que l'app demande à Claude Code juste après son lancement : les rappels autour des modifications. */
export function requeteInitialisation() {
    const matcher = OUTILS_MODIFICATION.join("|");
    return {
        subtype: "initialize",
        hooks: {
            PreToolUse: [{ matcher, hookCallbackIds: [CROCHET_AVANT] }],
            PostToolUse: [{ matcher, hookCallbackIds: [CROCHET_APRES] }],
        },
    };
}
/** Les outils dont la réponse revient toujours à la personne, même en accès complet : ils lui posent une question. */
export const OUTILS_A_LA_PERSONNE = new Set(["AskUserQuestion", "ExitPlanMode"]);
/* ─── Réflexion ───────────────────────────────────────────────── */
/** Un morceau de réflexion dans un `stream_event` ; `nouveau` : un nouveau bloc commence. */
export function morceauReflexion(ev) {
    const e = (ev ?? {});
    if (e.type === "content_block_start" && e.content_block?.type === "thinking") {
        return { texte: typeof e.content_block.thinking === "string" ? e.content_block.thinking : "", nouveau: true };
    }
    if (e.type === "content_block_delta" && e.delta?.type === "thinking_delta" && typeof e.delta.thinking === "string") {
        return { texte: e.delta.thinking, nouveau: false };
    }
    return null;
}
const texte = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** Les questions d'un appel `AskUserQuestion`, ou null si l'entrée n'en a pas de lisible. */
export function lireQuestions(entree) {
    if (!Array.isArray(entree.questions))
        return null;
    const questions = [];
    for (const brute of entree.questions.slice(0, 8)) {
        const q = (brute ?? {});
        const question = texte(q.question, 1000);
        if (!question || questions.some((x) => x.question === question))
            continue;
        const options = (Array.isArray(q.options) ? q.options : [])
            .slice(0, 12)
            .map((o) => {
            const opt = (o ?? {});
            return { libelle: texte(opt.label, 200), description: texte(opt.description, 600) };
        })
            .filter((o) => o.libelle);
        questions.push({ question, entete: texte(q.header, 60), options, multiple: q.multiSelect === true });
    }
    return questions.length ? questions : null;
}
/**
 * L'entrée à rendre à Claude Code avec les réponses de la personne : `answers`, question → réponse
 * (plusieurs choix séparés par des virgules, comme Claude Code les attend). Seules les questions posées.
 */
export function entreeAvecReponses(entree, reponses) {
    const questions = lireQuestions(entree);
    if (!questions || !reponses || typeof reponses !== "object" || Array.isArray(reponses))
        return null;
    const answers = {};
    for (const q of questions) {
        const r = reponses[q.question];
        const valeur = texte(r, 2000);
        if (valeur)
            answers[q.question] = valeur;
    }
    if (!Object.keys(answers).length)
        return null;
    return { ...entree, answers };
}
/* ─── Plan ────────────────────────────────────────────────────── */
/** Le plan d'un appel `ExitPlanMode` (Markdown), ou null. */
export function lirePlan(entree) {
    const plan = typeof entree?.plan === "string" ? entree.plan.trim() : "";
    return plan ? plan.slice(0, 60_000) : null;
}
/** La réponse à un plan : lancé (l'agent sort du mode plan et reprend l'accès de la conversation), ou à corriger. */
export function reponsePlan(accepte, entree, modeApres, message) {
    if (accepte)
        return { behavior: "allow", updatedInput: entree, updatedPermissions: [{ type: "setMode", mode: modeApres, destination: "session" }] };
    const consigne = message.trim().slice(0, 4000);
    return {
        behavior: "deny",
        message: consigne ? `La personne ne lance pas encore ce plan. Ce qu'elle demande de changer : ${consigne}\nReste en mode plan, corrige le plan et propose-le de nouveau.` : "La personne ne lance pas ce plan. Reste en mode plan et demande-lui ce qu'elle veut changer.",
    };
}
/* ─── Sortie d'une commande ───────────────────────────────────── */
/** Une commande lancée par l'agent (`task_started`) : son id pour en lire la sortie, l'appel d'outil qui l'a lancée. */
export function commandeLancee(msg) {
    if (msg.type !== "system" || msg.subtype !== "task_started" || msg.task_type !== "local_bash")
        return null;
    if (typeof msg.task_id !== "string" || typeof msg.tool_use_id !== "string" || !msg.task_id || !msg.tool_use_id)
        return null;
    return { tache: msg.task_id, appel: msg.tool_use_id, fond: msg.is_backgrounded === true };
}
/** La fin de la sortie d'une commande telle que `get_task_output` la rend, sans les séquences d'échappement. */
export function lireSortie(reponse) {
    const r = (reponse ?? {});
    if (typeof r.output !== "string")
        return null;
    return r.output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r(?!\n)/g, "\n").slice(-8192);
}
/** Ce que l'écran garde de la sortie d'une commande finie : la fin, comme dans un terminal. */
export const SORTIE_MAX = 8192;
export function sortieDe(contenu) {
    const brut = typeof contenu === "string" ? contenu : Array.isArray(contenu) ? contenu.map((c) => (c && typeof c === "object" && typeof c.text === "string" ? c.text : "")).join("\n") : "";
    return brut.length > SORTIE_MAX ? `…\n${brut.slice(-SORTIE_MAX)}` : brut;
}
/** La réponse de `get_context_usage` : la place prise, la fenêtre, et ce qui la remplit. */
export function lireUsageContexte(reponse) {
    const r = (reponse ?? {});
    if (typeof r.totalTokens !== "number" || typeof r.maxTokens !== "number" || r.maxTokens <= 0)
        return null;
    const categories = (Array.isArray(r.categories) ? r.categories : [])
        .slice(0, 30)
        .map((c) => {
        const x = (c ?? {});
        return { id: texte(x.id, 60), nom: texte(x.name, 80), jetons: typeof x.tokens === "number" ? Math.max(0, Math.round(x.tokens)) : 0, genre: texte(x.kind, 20) };
    })
        .filter((c) => c.nom && c.jetons > 0);
    return { total: Math.round(r.totalTokens), max: Math.round(r.maxTokens), categories };
}
/** La fenêtre du modèle d'après le `modelUsage` du résultat d'un tour, ou null. */
export function fenetreDe(modelUsage) {
    if (!modelUsage || typeof modelUsage !== "object")
        return null;
    const tailles = Object.values(modelUsage)
        .map((u) => (typeof u?.contextWindow === "number" ? u.contextWindow : 0))
        .filter((n) => n > 0);
    return tailles.length ? Math.max(...tailles) : null;
}
const NOM_COMMANDE = /^[a-z0-9][a-z0-9:_-]{0,63}$/i;
/**
 * Les commandes de Claude Code que le menu « / » de l'app ne propose pas : celles qu'elle fait à sa façon (résumer,
 * repartir à zéro, le modèle et l'effort, le contexte, l'utilisation, le nom) et celles d'un terminal ou du compte.
 */
export const COMMANDES_HORS_APP = new Set([
    "add-dir", "advisor", "agents", "autocompact", "bug", "clear", "color", "compact", "config", "context", "cost", "doctor", "effort", "exit",
    "export", "fast", "feedback", "focus", "goal", "help", "hooks", "ide", "import", "install-github-app", "login", "logout", "mcp", "memory",
    "model", "output-style", "permissions", "privacy-settings", "release-notes", "reload-plugins", "reload-skills", "rename", "resume", "status",
    "statusline", "terminal-setup", "theme", "upgrade", "usage", "vim",
]);
/**
 * Les commandes que la session annonce (réponse à `initialize`, `commands_changed`), sans celles de `COMMANDES_HORS_APP`
 * ni celles que Claude Code réserve au terminal (`terminal_slash_commands` de son message `init`).
 */
export function lireCommandes(liste, terminal = new Set()) {
    if (!Array.isArray(liste))
        return [];
    const vues = new Set();
    const commandes = [];
    for (const brute of liste.slice(0, 400)) {
        const c = (typeof brute === "string" ? { name: brute } : (brute ?? {}));
        const nom = typeof c.name === "string" ? c.name.replace(/^\//, "") : "";
        if (!NOM_COMMANDE.test(nom) || vues.has(nom) || COMMANDES_HORS_APP.has(nom) || terminal.has(nom))
            continue;
        vues.add(nom);
        commandes.push({ nom, description: texte(c.description, 300), indice: texte(c.argumentHint, 80) });
    }
    return commandes;
}
/* ─── Modifications de fichiers ───────────────────────────────── */
/** Au-delà, un fichier n'est pas gardé : sa modification se voit, mais ne s'annule pas depuis l'app. */
export const TAILLE_INSTANTANE_MAX = 2 * 1024 * 1024;
export const LIGNES_DIFF_MAX = 400;
const ID_SUR = /^[A-Za-z0-9_-]{1,100}$/;
/** Le texte d'un fichier, ou pourquoi il n'est pas gardé ; null : absent. */
function lireTexte(chemin) {
    try {
        const s = statSync(chemin);
        if (!s.isFile())
            return { contenu: null };
        if (s.size > TAILLE_INSTANTANE_MAX)
            return { contenu: null, illisible: "trop-gros" };
        const octets = readFileSync(chemin);
        if (octets.subarray(0, 8000).includes(0))
            return { contenu: null, illisible: "binaire" };
        return { contenu: octets.toString("utf8") };
    }
    catch {
        return { contenu: null };
    }
}
/** Le chemin du fichier visé par un outil de modification. */
export function cheminModifie(entree) {
    const e = (entree ?? {});
    const chemin = typeof e.file_path === "string" ? e.file_path : typeof e.notebook_path === "string" ? e.notebook_path : null;
    return chemin && path.isAbsolute(chemin) ? chemin : null;
}
/**
 * Le diff d'une modification, d'après ce que Claude Code rend dans le rappel d'après (`tool_response` :
 * `structuredPatch`, ou `content` pour un fichier créé). Rien n'est relu sur le disque.
 */
export function diffDeLaReponse(reponse) {
    const r = (reponse ?? {});
    const lignes = [];
    let ajouts = 0;
    let retraits = 0;
    const cree = r.type === "create" || (r.originalFile === null && typeof r.content === "string");
    const patch = Array.isArray(r.structuredPatch) ? r.structuredPatch : [];
    if (patch.length) {
        for (const bloc of patch) {
            const b = (bloc ?? {});
            lignes.push(`@@ -${Number(b.oldStart) || 0},${Number(b.oldLines) || 0} +${Number(b.newStart) || 0},${Number(b.newLines) || 0} @@`);
            for (const l of Array.isArray(b.lines) ? b.lines : []) {
                if (typeof l !== "string")
                    continue;
                if (l.startsWith("+"))
                    ajouts++;
                else if (l.startsWith("-"))
                    retraits++;
                lignes.push(l);
            }
        }
    }
    else if (cree && typeof r.content === "string") {
        const corps = r.content.replace(/\n$/, "").split("\n");
        lignes.push(`@@ -0,0 +1,${corps.length} @@`);
        for (const l of corps)
            lignes.push(`+${l}`);
        ajouts = corps.length;
    }
    else
        return null;
    const tronque = lignes.length > LIGNES_DIFF_MAX;
    return { lignes: tronque ? lignes.slice(0, LIGNES_DIFF_MAX).map((l) => l.slice(0, 2000)) : lignes.map((l) => l.slice(0, 2000)), ajouts, retraits, tronque, cree };
}
/**
 * Les modifications de fichiers d'une conversation, gardées sur la machine où l'agent travaille
 * (`<dossier>/<conversation>/<appel>.json`) : l'avant au rappel d'avant, l'après au rappel d'après.
 * L'écran ne donne jamais de chemin : il désigne des appels d'outil, et le fichier vient d'ici.
 */
export function creerInstantanes(dossier, options) {
    const maintenant = options.maintenant ?? Date.now;
    const fichier = (conversation, id) => (ID_SUR.test(conversation) && ID_SUR.test(id) ? path.join(dossier, conversation, `${id}.json`) : null);
    const lire = (conversation, id) => {
        const f = fichier(conversation, id);
        if (!f || !existsSync(f))
            return null;
        try {
            return JSON.parse(readFileSync(f, "utf8"));
        }
        catch {
            return null;
        }
    };
    const ecrire = (conversation, inst) => {
        const f = fichier(conversation, inst.id);
        if (!f)
            return;
        mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
        const temporaire = `${f}.tmp`;
        writeFileSync(temporaire, JSON.stringify(inst), { mode: 0o600 });
        renameSync(temporaire, f);
    };
    return {
        /** Le rappel d'avant : ce qu'il y a dans le fichier avant que l'outil y touche. */
        avant(conversation, entree) {
            const id = typeof entree.tool_use_id === "string" ? entree.tool_use_id : "";
            const chemin = cheminModifie(entree.tool_input);
            if (!chemin || !fichier(conversation, id))
                return;
            const { contenu, illisible } = lireTexte(chemin);
            ecrire(conversation, { id, outil: String(entree.tool_name ?? ""), chemin, le: maintenant(), avant: contenu, ...(illisible ? { illisible } : {}) });
        },
        /** Le rappel d'après : ce que l'outil a laissé ; rend ce que l'écran montre de la modification. */
        apres(conversation, entree) {
            const id = typeof entree.tool_use_id === "string" ? entree.tool_use_id : "";
            const chemin = cheminModifie(entree.tool_input);
            if (!chemin)
                return null;
            const inst = lire(conversation, id);
            const diff = diffDeLaReponse(entree.tool_response);
            let annulable = false;
            if (inst && inst.chemin === chemin && !inst.illisible) {
                const { contenu, illisible } = lireTexte(chemin);
                if (illisible)
                    ecrire(conversation, { ...inst, illisible });
                else {
                    ecrire(conversation, { ...inst, apres: contenu });
                    annulable = true;
                }
            }
            return {
                id,
                chemin,
                lignes: diff?.lignes ?? [],
                ajouts: diff?.ajouts ?? 0,
                retraits: diff?.retraits ?? 0,
                tronque: diff?.tronque ?? false,
                cree: diff?.cree ?? (inst ? inst.avant === null && !inst.illisible : false),
                annulable,
            };
        },
        lire,
        /**
         * Annule des modifications (des appels d'outil de cette conversation) : chaque fichier revient à son état
         * d'avant la première d'entre elles, s'il est encore tel que la dernière l'a laissé. Sinon, rien n'est
         * touché (`conflit`), sauf avec `forcer`. Un fichier créé par l'agent est retiré (`supprimer`).
         */
        annuler(conversation, ids, forcer = false) {
            const parFichier = new Map();
            const resultats = [];
            for (const id of [...new Set(ids)].slice(0, 2000)) {
                const inst = lire(conversation, id);
                if (!inst)
                    continue;
                if (inst.illisible || inst.apres === undefined) {
                    if (!resultats.some((r) => r.chemin === inst.chemin))
                        resultats.push({ chemin: inst.chemin, etat: "impossible", raison: inst.illisible === "trop-gros" ? "Fichier trop gros pour être gardé." : inst.illisible === "binaire" ? "Ce n’est pas un fichier texte." : "La modification n’a pas eu lieu." });
                    continue;
                }
                parFichier.set(inst.chemin, [...(parFichier.get(inst.chemin) ?? []), inst]);
            }
            for (const [chemin, liste] of parFichier) {
                const actives = liste.filter((i) => !i.annuleLe).sort((a, b) => a.le - b.le);
                const deja = resultats.findIndex((r) => r.chemin === chemin);
                if (deja !== -1)
                    resultats.splice(deja, 1);
                if (!actives.length) {
                    resultats.push({ chemin, etat: "deja" });
                    continue;
                }
                const premiere = actives[0];
                const derniere = actives[actives.length - 1];
                const actuel = lireTexte(chemin);
                if (actuel.illisible) {
                    resultats.push({ chemin, etat: "impossible", raison: "Le fichier n’est plus un fichier texte lisible." });
                    continue;
                }
                if (!forcer && actuel.contenu !== (derniere.apres ?? null)) {
                    resultats.push({ chemin, etat: "conflit", raison: "Le fichier a changé depuis." });
                    continue;
                }
                try {
                    if (premiere.avant === null) {
                        if (actuel.contenu !== null)
                            options.supprimer(chemin);
                    }
                    else {
                        mkdirSync(path.dirname(chemin), { recursive: true });
                        writeFileSync(chemin, premiere.avant);
                    }
                }
                catch (erreur) {
                    resultats.push({ chemin, etat: "impossible", raison: erreur instanceof Error ? erreur.message.slice(0, 200) : "Écriture impossible." });
                    continue;
                }
                const le = maintenant();
                for (const inst of actives)
                    ecrire(conversation, { ...inst, annuleLe: le });
                resultats.push({ chemin, etat: "annule" });
            }
            return { fichiers: resultats };
        },
        /** Oublie les modifications d'une conversation supprimée (les données de l'app, pas les fichiers de la personne). */
        oublier(conversation) {
            if (!ID_SUR.test(conversation))
                return;
            rmSync(path.join(dossier, conversation), { recursive: true, force: true });
        },
        /** Oublie les modifications de plus de `ageMax` (ms) : elles ne s'annulent plus depuis l'app. */
        nettoyer(ageMax) {
            if (!existsSync(dossier))
                return;
            const limite = maintenant() - ageMax;
            for (const conversation of readdirSync(dossier)) {
                if (!ID_SUR.test(conversation))
                    continue;
                const d = path.join(dossier, conversation);
                try {
                    const restants = readdirSync(d).filter((f) => {
                        const chemin = path.join(d, f);
                        if (statSync(chemin).mtimeMs >= limite)
                            return true;
                        rmSync(chemin, { force: true });
                        return false;
                    });
                    if (!restants.length)
                        rmSync(d, { recursive: true, force: true });
                }
                catch {
                    /* un dossier illisible reste */
                }
            }
        },
    };
}
/**
 * Retirer un fichier créé par l'agent, sans le détruire : il part dans `corbeille`, avec la date devant son nom.
 * Un autre disque : copié puis effacé.
 */
export function versCorbeille(corbeille) {
    return (chemin) => {
        mkdirSync(corbeille, { recursive: true, mode: 0o700 });
        const cible = path.join(corbeille, `${Date.now()}-${path.basename(chemin)}`);
        try {
            renameSync(chemin, cible);
        }
        catch {
            copyFileSync(chemin, cible);
            unlinkSync(chemin);
        }
    };
}
/* ─── Requêtes de contrôle avec réponse ───────────────────────── */
/**
 * Les requêtes de contrôle envoyées à un Claude Code qui attendent sa réponse (`control_response`, par
 * `request_id`). `ecrire` écrit une ligne sur son entrée ; au-delà de `delai`, la promesse échoue.
 */
export function creerControles(ecrire, nouvelId) {
    const attente = new Map();
    return {
        demander(request, delai = 15_000) {
            const id = nouvelId();
            return new Promise((ok, ko) => {
                const minuterie = setTimeout(() => {
                    attente.delete(id);
                    ko(new Error("Claude Code n’a pas répondu."));
                }, delai);
                attente.set(id, { ok, ko, minuterie });
                try {
                    ecrire({ type: "control_request", request_id: id, request });
                }
                catch (e) {
                    clearTimeout(minuterie);
                    attente.delete(id);
                    ko(e instanceof Error ? e : new Error(String(e)));
                }
            });
        },
        /** Une ligne `control_response` lue : vrai si elle répondait à une de nos demandes. */
        recevoir(msg) {
            if (msg.type !== "control_response")
                return false;
            const r = (msg.response ?? {});
            if (typeof r.request_id !== "string")
                return false;
            const a = attente.get(r.request_id);
            if (!a)
                return false;
            attente.delete(r.request_id);
            clearTimeout(a.minuterie);
            if (r.subtype === "error")
                a.ko(new Error(typeof r.error === "string" ? r.error : "Claude Code a refusé la demande."));
            else
                a.ok(r.response ?? null);
            return true;
        },
        /** Claude Code s'est arrêté : plus de réponse à attendre. */
        fermer() {
            for (const [id, a] of attente) {
                clearTimeout(a.minuterie);
                a.ko(new Error("Claude Code s’est arrêté."));
                attente.delete(id);
            }
        },
    };
}
/** La réponse à un rappel (`hook_callback`) : continuer, sans rien changer à la décision de Claude Code. */
export function reponseCrochet(requestId) {
    return { type: "control_response", response: { subtype: "success", request_id: requestId, response: { continue: true } } };
}
