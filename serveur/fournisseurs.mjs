// Généré par scripts/serveur-genere.mjs depuis src/lib/fournisseurs.ts : ne pas modifier à la main.
/**
 * Les fournisseurs qui font travailler les agents (cf. electron/moteurs) : ce que tu choisis
 * (« ChatGPT », « Grok »), et le moteur que l'app lance (« codex », « grok »). Claude Code reste celui par défaut.
 */
export const FOURNISSEURS = [
    { id: "claude", nom: "Claude", moteur: "Claude Code", initiale: "C" },
    { id: "codex", nom: "ChatGPT", moteur: "Codex", initiale: "G" },
    { id: "grok", nom: "Grok", moteur: "Grok Build", initiale: "X" },
];
export const PAR_DEFAUT = "claude";
export function fournisseur(id) {
    return FOURNISSEURS.find((f) => f.id === id) ?? FOURNISSEURS[0];
}
/** Le moteur qui répond dans cette conversation, sur ce PC comme sur un VPS. */
export function moteurDe(chat) {
    return chat.fournisseur || PAR_DEFAUT;
}
/**
 * La conversation passe sur un autre moteur. Une session n'existe que dans le moteur qui l'a créée :
 * celles d'ici restent de côté, celles que la conversation avait laissées là-bas reviennent
 * (comme `changerDeLieu`). Ce que l'agent n'a pas vu lui est redonné avec le message (cf. `aReprendre`).
 */
export function changerDeMoteur(chat, moteur) {
    const avant = chat.fournisseur || PAR_DEFAUT;
    if (avant === moteur)
        return chat;
    const { [moteur]: reprises = {}, ...autres } = chat.sessionsParMoteur ?? {};
    const laissees = Object.keys(chat.sessions).length ? { ...autres, [avant]: chat.sessions } : autres;
    const suivant = { ...chat, fournisseur: moteur, sessions: reprises, sessionsParMoteur: laissees };
    if (moteur === PAR_DEFAUT)
        delete suivant.fournisseur;
    if (!Object.keys(laissees).length)
        delete suivant.sessionsParMoteur;
    return suivant;
}
/** Le moteur qui a écrit un message d'agent. */
export const moteurDuMessage = (m) => m.moteur || PAR_DEFAUT;
/**
 * Ce que l'agent n'a pas encore vu avec ce moteur : tout ce qui suit sa dernière réponse écrite
 * avec lui. Jamais répondu avec ce moteur : toute la conversation, pour qu'il la reprenne.
 * Un résumé (`compaction`) n'est pas une réponse : ce qui le précède sans avoir été lu reste à lire.
 */
export function aReprendre(fil, roleId, moteur) {
    const derniere = fil.findLastIndex((m) => m.author.kind === "role" && m.author.roleId === roleId && moteurDuMessage(m) === moteur && !m.compaction);
    return fil.slice(derniere + 1);
}
/** Au-delà, les plus anciens messages repris sont laissés de côté. */
export const REPRISE_MAX = 30_000;
/** Garde les dernières lignes dans la limite, et dit combien sont laissées. */
export function limiterReprise(lignes, max = REPRISE_MAX) {
    let total = 0;
    let debut = lignes.length;
    while (debut > 0 && total + lignes[debut - 1].length <= max)
        total += lignes[--debut].length;
    if (debut === 0)
        return lignes;
    return [`[… ${debut} message${debut > 1 ? "s" : ""} plus ancien${debut > 1 ? "s" : ""} non repris]`, ...lignes.slice(debut)];
}
/** Les efforts de réflexion, du plus léger au plus poussé (Codex en a plus que Claude Code). */
export const EFFORTS = [
    { id: "none", nom: "Aucun" },
    { id: "minimal", nom: "Minimal" },
    { id: "low", nom: "Bas" },
    { id: "medium", nom: "Moyen" },
    { id: "high", nom: "Élevé" },
    { id: "xhigh", nom: "Très élevé" },
    { id: "max", nom: "Max" },
    { id: "ultra", nom: "Ultra" },
];
export const nomEffort = (id) => EFFORTS.find((e) => e.id === id)?.nom ?? id ?? "";
