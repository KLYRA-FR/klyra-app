// Généré par scripts/serveur-genere.mjs depuis electron/utilisation.ts : ne pas modifier à la main.
/**
 * L'utilisation de l'abonnement d'un fournisseur (Claude par Claude Code, ChatGPT par Codex, Grok par
 * Grok Build), dans une seule forme : une fenêtre de 5 h, une de 7 jours, celle du mois (les crédits de
 * Grok), et si la limite est atteinte. Module pur, sans
 * processus ni Electron : le PC (electron/claude.ts, electron/moteurs/codex.ts) et le VPS
 * (`serveur/utilisation.mjs`, généré par scripts/serveur-genere.mjs) lisent les mêmes événements avec lui.
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
const objetDe = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
/** Un montant de Grok : `{ val }` (en cents, parfois en chaîne), ou un nombre. */
function montant(v) {
    const brut = objetDe(v)?.val ?? v;
    const n = typeof brut === "string" && brut.trim() !== "" ? Number(brut) : brut;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
}
/** Une date de Grok : ISO, secondes ou millisecondes, ou `{ seconds }` (horodatage protobuf). */
function dateDe(v) {
    if (typeof v === "string" && v) {
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : null;
    }
    if (typeof v === "number" && Number.isFinite(v) && v > 0)
        return v < 1e12 ? v * 1000 : v;
    const s = objetDe(v)?.seconds;
    return s !== undefined ? dateDe(typeof s === "string" ? Number(s) : s) : null;
}
/**
 * Lit la réponse de `_x.ai/billing` (méthode d'extension ACP de Grok Build, celle de sa commande
 * `/usage`) : les crédits inclus dans l'abonnement pour la période de facturation en cours. Forme vue
 * dans Grok Build 0.1.220 : `monthlyLimit`, `usage.includedUsed` (et `onDemandUsed`, `totalUsed`),
 * `billingCycle.billingPeriodEnd`, `onDemandCap`, `on_demand_enabled`, éventuellement sous `config`.
 * La forme plus récente du proxy de Grok (`creditUsagePercent`, `currentPeriod.end`) est lue aussi.
 * Jamais de chiffre estimé : sans plafond ni pourcentage donné, rien (null).
 */
export function lireUtilisationGrok(brut, maintenant = Date.now()) {
    const racine = objetDe(brut);
    if (!racine)
        return null;
    /* Les données peuvent être à la racine ou enveloppées (`config`, `billing`, `data`). */
    const candidats = [racine, objetDe(racine.config), objetDe(racine.billing), objetDe(racine.data), objetDe(objetDe(racine.billing)?.config), objetDe(objetDe(racine.data)?.config)].filter((c) => !!c);
    const champ = (cle) => candidats.map((c) => c[cle]).find((v) => v !== undefined && v !== null);
    const usage = objetDe(champ("usage"));
    const cycle = objetDe(champ("billingCycle"));
    const periode = objetDe(champ("currentPeriod"));
    let utilise = null;
    const pourcent = montant(champ("creditUsagePercent"));
    const limite = montant(champ("monthlyLimit"));
    const consomme = montant(usage?.includedUsed) ?? montant(champ("includedUsed")) ?? montant(champ("used")) ?? montant(usage?.totalUsed) ?? montant(champ("totalUsed"));
    if (pourcent !== null)
        utilise = pourcent / 100;
    else if (limite !== null && limite > 0 && consomme !== null)
        utilise = consomme / limite;
    if (utilise === null)
        return null;
    utilise = Math.max(0, Math.min(1, utilise));
    const reinitialiseA = dateDe(periode?.end) ?? dateDe(cycle?.billingPeriodEnd) ?? dateDe(champ("billingPeriodEnd"));
    /* Crédits inclus épuisés : la limite n'est atteinte que si le paiement à l'usage ne prend pas le relais. */
    const plafond = montant(champ("onDemandCap"));
    const usageDemande = montant(usage?.onDemandUsed) ?? montant(champ("onDemandUsed")) ?? 0;
    const aLaDemande = champ("on_demand_enabled") !== false && plafond !== null && plafond > usageDemande;
    const echue = reinitialiseA !== null && reinitialiseA <= maintenant;
    const statut = utilise >= 1 && !aLaDemande && !echue ? "rejected" : "allowed";
    return { session: null, semaine: null, mois: { utilise, reinitialiseA }, statut, misAJour: maintenant };
}
