// Généré par scripts/serveur-genere.mjs depuis electron/utilisation.ts : ne pas modifier à la main.
/**
 * L'utilisation de l'abonnement d'un fournisseur (Claude par Claude Code, ChatGPT par Codex), dans une
 * seule forme : une fenêtre de 5 h, une de 7 jours, et si la limite est atteinte. Module pur, sans
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
