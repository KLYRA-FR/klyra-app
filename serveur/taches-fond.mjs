// Généré par scripts/serveur-genere.mjs depuis electron/taches-fond.ts : ne pas modifier à la main.
/**
 * Ce qu'un agent fait en arrière-plan quand sa réponse est rendue : les commandes et agents qu'il a lancés
 * en fond, et la reprise quand l'un d'eux revient (Claude Code le fait reparler de lui-même). Lu dans les
 * messages `system` de Claude Code, vérifiés avec la version 2.1.318 :
 * - `task_started` (`task_id`, `tool_use_id`, `description`, `task_type` : `local_bash`, `local_agent`…,
 *   `is_backgrounded`) ;
 * - `background_tasks_changed` : la liste complète des tâches de fond encore en cours (`tasks`) ;
 * - `task_notification` : une tâche finie (elle quitte la liste) ;
 * - `status` `requesting` : Claude Code appelle le modèle, même sans réponse ouverte dans l'app (la reprise),
 *   jusqu'au `result` de ce tour.
 * L'écran en tire « Iris continue en arrière-plan » sous la conversation. Pur et sans dépendance : le même
 * suivi sert à electron/claude.ts et au serveur d'un VPS (généré en `serveur/taches-fond.mjs`).
 */
export const nouveauSuiviFond = () => ({ taches: new Map(), reprise: false, debuts: new Map() });
const genreDe = (type) => (type === "local_bash" ? "commande" : type === "local_agent" ? "agent" : "autre");
const texte = (v, defaut) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : defaut);
export const evenementFond = (suivi) => ({
    type: "fond",
    taches: [...suivi.taches.values()].sort((a, b) => a.debut - b.debut),
    reprise: suivi.reprise,
});
/**
 * Lit un message de Claude Code. Renvoie l'événement à montrer quand ce qui tourne en fond change, sinon null.
 * `reponseOuverte` : l'app attend déjà une réponse de cet agent (la reprise ne se dit alors pas).
 */
export function suivreFond(suivi, msg, maintenant, reponseOuverte) {
    if (msg.type !== "result" && msg.type !== "system")
        return null;
    /* La liste et le début d'une tâche arrivent tous deux (`background_tasks_changed`, `task_started`) : dit une fois. */
    const avant = JSON.stringify(evenementFond(suivi));
    const evt = lire(suivi, msg, maintenant, reponseOuverte);
    return evt && JSON.stringify(evt) !== avant ? evt : null;
}
function lire(suivi, msg, maintenant, reponseOuverte) {
    if (msg.type === "result") {
        if (!suivi.reprise)
            return null;
        suivi.reprise = false;
        return evenementFond(suivi);
    }
    if (msg.type !== "system")
        return null;
    if (msg.subtype === "status" && msg.status === "requesting") {
        /* Avec une réponse ouverte, c'est la réponse à un message, que l'écran montre déjà. */
        if (reponseOuverte || suivi.reprise)
            return null;
        suivi.reprise = true;
        return evenementFond(suivi);
    }
    if (msg.subtype === "task_started" && typeof msg.task_id === "string") {
        if (!suivi.debuts.has(msg.task_id))
            suivi.debuts.set(msg.task_id, maintenant);
        if (msg.is_backgrounded !== true)
            return null;
        suivi.taches.set(msg.task_id, {
            id: msg.task_id,
            description: texte(msg.description, "Tâche de fond"),
            genre: genreDe(msg.task_type),
            debut: suivi.debuts.get(msg.task_id),
        });
        return evenementFond(suivi);
    }
    if (msg.subtype === "background_tasks_changed" && Array.isArray(msg.tasks)) {
        const taches = new Map();
        for (const t of msg.tasks) {
            if (!t || typeof t.task_id !== "string")
                continue;
            const debut = suivi.debuts.get(t.task_id) ?? suivi.taches.get(t.task_id)?.debut ?? maintenant;
            suivi.debuts.set(t.task_id, debut);
            taches.set(t.task_id, { id: t.task_id, description: texte(t.description, "Tâche de fond"), genre: genreDe(t.task_type), debut });
        }
        suivi.taches = taches;
        /* Une tâche au premier plan peut passer en fond plus tard : son début est gardé, dans une limite. */
        for (const id of suivi.debuts.keys())
            if (suivi.debuts.size > 200 && !taches.has(id))
                suivi.debuts.delete(id);
        return evenementFond(suivi);
    }
    if (msg.subtype === "task_notification" && typeof msg.task_id === "string") {
        suivi.debuts.delete(msg.task_id);
        if (!suivi.taches.delete(msg.task_id))
            return null;
        return evenementFond(suivi);
    }
    return null;
}
/** Claude Code s'est arrêté : plus rien ne tourne en fond. Null s'il n'y avait rien à dire. */
export function finSuiviFond(suivi) {
    if (!suivi.taches.size && !suivi.reprise)
        return null;
    suivi.taches.clear();
    suivi.debuts.clear();
    suivi.reprise = false;
    return evenementFond(suivi);
}
