// Généré par scripts/serveur-genere.mjs depuis electron/utilisation.ts : ne pas modifier à la main.
/**
 * L'utilisation de l'abonnement d'un fournisseur (Claude par Claude Code, ChatGPT par Codex, Grok par
 * Grok Build), dans une seule forme : une fenêtre de 5 h, une de 7 jours, les crédits du mois (Grok), et
 * si la limite est atteinte. Module pur, sans processus ni Electron : le PC (electron/claude.ts,
 * electron/moteurs/codex.ts, electron/moteurs/grok.ts) et le VPS (`serveur/utilisation.mjs`, généré par
 * scripts/serveur-genere.mjs) lisent les mêmes réponses avec lui.
 * Jamais de chiffre estimé : une fenêtre que le fournisseur n'a pas donnée reste null.
 */
/* ─── Claude Code ──────────────────────────────────────────────── */
function fenetreClaude(brut) {
    const f = brut;
    if (!f || typeof f.utilization !== "number")
        return null;
    return { utilise: f.utilization, reinitialiseA: typeof f.resetsAt === "number" ? f.resetsAt * 1000 : null };
}
/**
 * Lit un `rate_limit_info` de Claude Code. Deux formes : `unifiedWindows`
 * (les deux fenêtres d'un coup, champ interne que toutes les versions
 * n'envoient pas) et la forme publique, une seule fenêtre nommée par
 * `rateLimitType`. Une fenêtre absente de l'événement garde sa dernière
 * valeur connue : un événement sans chiffre n'efface rien.
 */
export function lireUtilisation(info, precedente, maintenant = Date.now()) {
    const i = info;
    if (!i || typeof i !== "object")
        return precedente;
    const seule = fenetreClaude(i);
    const lue = (type) => fenetreClaude(i.unifiedWindows?.[type]) ?? (i.rateLimitType === type ? seule : null);
    return {
        session: lue("five_hour") ?? precedente?.session ?? null,
        semaine: lue("seven_day") ?? precedente?.semaine ?? null,
        statut: typeof i.status === "string" ? i.status : (precedente?.statut ?? "allowed"),
        misAJour: maintenant,
    };
}
/* ─── Codex (ChatGPT) ──────────────────────────────────────────── */
/** Au-delà d'un jour, la fenêtre est celle de la semaine (Codex donne sa durée en minutes). */
const UN_JOUR_MIN = 24 * 60;
function fenetreCodex(brut) {
    const f = brut;
    if (!f || typeof f.usedPercent !== "number" || !Number.isFinite(f.usedPercent))
        return null;
    return {
        fenetre: { utilise: Math.max(0, Math.min(1, f.usedPercent / 100)), reinitialiseA: typeof f.resetsAt === "number" ? f.resetsAt * 1000 : null },
        minutes: typeof f.windowDurationMins === "number" ? f.windowDurationMins : null,
    };
}
/**
 * Lit un `RateLimitSnapshot` de Codex (`account/rateLimits/read`, ou la notification
 * `account/rateLimits/updated`, qui ne donne que ce qui a changé). `primary` est la fenêtre courte
 * (5 h) et `secondary` la semaine, sauf si leur durée dit le contraire. Une réponse de lecture qui a
 * plusieurs compteurs : celui de Codex (`rateLimitsByLimitId.codex`) d'abord. Comme pour Claude, une
 * fenêtre absente garde sa dernière valeur ; `rateLimitReachedType` posé = limite atteinte.
 */
export function lireUtilisationCodex(brut, precedente, maintenant = Date.now()) {
    const enveloppe = brut;
    if (!enveloppe || typeof enveloppe !== "object")
        return precedente;
    const snapshot = (enveloppe.rateLimitsByLimitId?.codex ?? enveloppe.rateLimits ?? enveloppe);
    if (!snapshot || typeof snapshot !== "object")
        return precedente;
    const lues = [fenetreCodex(snapshot.primary), fenetreCodex(snapshot.secondary)];
    let session = null;
    let semaine = null;
    lues.forEach((lue, rang) => {
        if (!lue)
            return;
        const longue = lue.minutes !== null ? lue.minutes > UN_JOUR_MIN : rang === 1;
        if (longue)
            semaine ??= lue.fenetre;
        else
            session ??= lue.fenetre;
    });
    const atteinte = typeof snapshot.rateLimitReachedType === "string";
    if (!session && !semaine && !atteinte)
        return precedente;
    const fusion = { session: session ?? precedente?.session ?? null, semaine: semaine ?? precedente?.semaine ?? null };
    /* Une mise à jour partielle peut ne pas redire `rateLimitReachedType` : les fenêtres tranchent alors
       (une fenêtre pleine dont la remise à zéro est passée ne compte plus). */
    const pleine = (f) => !!f && f.utilise >= 1 && (f.reinitialiseA === null || f.reinitialiseA > maintenant);
    const statut = atteinte || pleine(fusion.session) || pleine(fusion.semaine) ? "rejected" : "allowed";
    return { ...fusion, statut, misAJour: maintenant };
}
const objet = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
/** Un nombre de Grok : nombre, ou texte qui en est un (« 37.5 »). */
function nombre(v) {
    if (typeof v === "number" && Number.isFinite(v))
        return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v)))
        return Number(v);
    return null;
}
/** Une date de Grok en millisecondes : texte ISO, ou nombre en secondes ou en millisecondes. */
function dateGrok(brut) {
    if (typeof brut === "string" && brut.trim() && !Number.isFinite(Number(brut))) {
        const ms = Date.parse(brut);
        return Number.isFinite(ms) ? ms : null;
    }
    const n = nombre(brut);
    return n !== null && n > 0 ? (n < 1e12 ? n * 1000 : n) : null;
}
/** La configuration de facturation, là où Grok la met : `config`, ou sous une enveloppe (`billing`, `result`, `data`). */
function configGrok(reponse) {
    const enveloppes = [reponse, objet(reponse.billing), objet(reponse.result), objet(reponse.data)].filter((e) => !!e);
    for (const enveloppe of enveloppes) {
        for (const config of [objet(enveloppe.config), objet(enveloppe.billingConfig), enveloppe]) {
            if (config && ("creditUsagePercent" in config || "monthlyLimit" in config || "currentPeriod" in config))
                return { config, enveloppe };
        }
    }
    return null;
}
/**
 * La part utilisée, de 0 à 100 : `creditUsagePercent` quand Grok la donne ; sinon ce qui a été utilisé
 * dans la période en cours (`history`, `includedUsed` puis `totalUsed`) rapporté à `monthlyLimit`, deux
 * chiffres de Grok. Rien d'autre : sans eux, null.
 */
function pourcentGrok(config) {
    const direct = nombre(config.creditUsagePercent);
    if (direct !== null)
        return direct;
    const limite = nombre(config.monthlyLimit);
    const historique = Array.isArray(config.history) ? config.history.map(objet).filter((h) => !!h) : [];
    const courant = historique.at(-1);
    const utilise = courant ? (nombre(courant.includedUsed) ?? nombre(courant.totalUsed)) : null;
    return limite !== null && limite > 0 && utilise !== null ? (utilise / limite) * 100 : null;
}
/**
 * Lit la réponse de `x.ai/billing` de Grok Build (`BillingConfigResponse` : `config`, `on_demand_enabled`,
 * `subscription_tier`). L'abonnement donne des crédits par période de facturation : la part utilisée
 * (`pourcentGrok`) et `config.currentPeriod.end` (remise à zéro) font la fenêtre du mois. Sans chiffre
 * lisible, rien n'est inventé : la précédente reste. La limite n'est atteinte que si le paiement à l'usage
 * n'est pas activé : sinon les agents continuent, facturés à part.
 */
export function lireUtilisationGrok(brut, precedente, maintenant = Date.now()) {
    const reponse = objet(brut);
    const trouve = reponse ? configGrok(reponse) : null;
    if (!trouve)
        return precedente;
    const pourcent = pourcentGrok(trouve.config);
    if (pourcent === null)
        return precedente;
    const periode = objet(trouve.config.currentPeriod);
    const mois = { utilise: Math.max(0, Math.min(1, pourcent / 100)), reinitialiseA: dateGrok(periode?.end) };
    const aLUsage = [trouve.enveloppe, reponse].some((o) => o.on_demand_enabled === true || o.onDemandEnabled === true);
    const pleine = mois.utilise >= 1 && (mois.reinitialiseA === null || mois.reinitialiseA > maintenant);
    return { session: null, semaine: null, mois, statut: pleine && !aLUsage ? "rejected" : "allowed", misAJour: maintenant };
}
/**
 * La forme d'une réponse, pour dire ce que Grok a répondu quand rien n'y est lisible : les noms des champs et
 * leur type, jamais leurs valeurs (« config{creditUsagePercent:null, monthlyLimit:number} »).
 */
export function formeReponse(brut, profondeur = 0) {
    if (brut === null)
        return "null";
    if (Array.isArray(brut))
        return `liste(${brut.length})`;
    const o = objet(brut);
    if (!o)
        return typeof brut;
    if (profondeur >= 2)
        return "objet";
    const champs = Object.entries(o).slice(0, 12).map(([cle, v]) => (objet(v) ? `${cle}${formeReponse(v, profondeur + 1)}` : `${cle}:${formeReponse(v, profondeur + 1)}`));
    return `{${champs.join(", ")}${Object.keys(o).length > 12 ? ", …" : ""}}`;
}
/**
 * L'utilisation de Grok après une lecture de `x.ai/billing` (sa réponse, ou l'erreur de la demande) : les
 * crédits du mois quand ils sont lisibles ; sinon une utilisation sans fenêtre qui dit pourquoi (`note`,
 * montrée au survol de l'anneau), sauf si des crédits ont déjà été lus : un échec passager ne les efface pas.
 */
export function utilisationGrok(lecture, precedente, maintenant = Date.now()) {
    if ("reponse" in lecture) {
        const lue = lireUtilisationGrok(lecture.reponse, null, maintenant);
        if (lue)
            return lue;
    }
    if (precedente?.mois)
        return precedente;
    const note = "erreur" in lecture ? `Grok a répondu : ${lecture.erreur}` : `réponse sans crédits lisibles ${formeReponse(lecture.reponse)}`;
    return { session: null, semaine: null, mois: null, statut: "allowed", misAJour: maintenant, note: note.slice(0, 400) };
}
