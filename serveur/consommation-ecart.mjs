// Généré par scripts/serveur-genere.mjs depuis electron/consommation-ecart.ts : ne pas modifier à la main.
/*
 * Ce qu'un tour de Claude Code a consommé, d'après son `modelUsage` : un module pur, le même pour les
 * sessions de ce PC (consommation.ts) et celles d'un VPS (compilé en serveur/consommation-ecart.mjs),
 * pour que l'Utilisation d'un agent compte de la même façon où qu'il travaille.
 */
const nombre = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const ZERO = { entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0, cout: 0 };
/**
 * L'écart entre deux `modelUsage` d'un même processus, modèle par modèle. Claude Code donne des totaux
 * cumulés pour tout le processus (vérifié : le 2e résultat d'une session contient le 1er) ; un compteur
 * qui recule veut dire un nouveau processus : on repart de zéro. Rend le nouveau cumul et les lignes
 * non vides.
 */
export function ecartModelUsage(usage, precedent) {
    if (!usage || typeof usage !== "object")
        return { cumul: precedent, lignes: [] };
    const cumul = { ...precedent };
    const lignes = [];
    for (const [modele, u] of Object.entries(usage)) {
        const maintenant = {
            entree: nombre(u?.inputTokens),
            sortie: nombre(u?.outputTokens),
            cacheLu: nombre(u?.cacheReadInputTokens),
            cacheEcrit: nombre(u?.cacheCreationInputTokens),
            cout: nombre(u?.costUSD),
        };
        const avant = precedent[modele] ?? ZERO;
        const recul = maintenant.entree < avant.entree || maintenant.sortie < avant.sortie;
        const base = recul ? ZERO : avant;
        const jetons = {
            entree: maintenant.entree - base.entree,
            sortie: maintenant.sortie - base.sortie,
            cacheLu: Math.max(0, maintenant.cacheLu - base.cacheLu),
            cacheEcrit: Math.max(0, maintenant.cacheEcrit - base.cacheEcrit),
        };
        const coutUsd = maintenant.cout - base.cout > 0 ? maintenant.cout - base.cout : null;
        if (jetons.entree + jetons.sortie + jetons.cacheLu + jetons.cacheEcrit > 0 || coutUsd)
            lignes.push({ modele, jetons, coutUsd });
        cumul[modele] = maintenant;
    }
    return { cumul, lignes };
}
/** Une ligne reçue d'un VPS, vérifiée champ par champ (null si elle ne tient pas). */
export function ligneValide(brut) {
    if (!brut || typeof brut !== "object")
        return null;
    const l = brut;
    if (typeof l.modele !== "string" || !l.modele || l.modele.length > 120 || !l.jetons || typeof l.jetons !== "object")
        return null;
    const jetons = { entree: nombre(l.jetons.entree), sortie: nombre(l.jetons.sortie), cacheLu: nombre(l.jetons.cacheLu), cacheEcrit: nombre(l.jetons.cacheEcrit) };
    const coutUsd = nombre(l.coutUsd) || null;
    return jetons.entree + jetons.sortie + jetons.cacheLu + jetons.cacheEcrit > 0 || coutUsd ? { modele: l.modele, jetons, coutUsd } : null;
}
