// Généré par scripts/serveur-genere.mjs depuis electron/skills-par-agent.ts : ne pas modifier à la main.
/**
 * Quelles skills un agent lancé par KLYRA reçoit.
 *
 * Liste d'exclusion figée, pas un déplacement de fichiers : rien n'est retiré du poste.
 * Tant que `fige` est faux (réglage absent, ancienne installation) chaque agent reçoit tout,
 * comme avant. Le premier lancement fige le choix : les skills personnelles alors présentes
 * restent reçues par les agents alors présents. Ensuite, une skill personnelle nouvelle,
 * ou un agent nouveau, ne la reçoit pas tant qu'on ne l'allume pas. Une skill de projet
 * reste reçue tant qu'on ne la coupe pas.
 *
 * Claude Code : `skillOverrides` à `off` dans le `--settings` de la session (prouvé le
 * 04/11/2026, Claude Code 2.1.306, faux fournisseur). Les agents du poste et les CLAUDE.md
 * restent. La valeur s'applique à toute la session : un agent appelé dedans reçoit les
 * skills de celui qui l'a lancé, pas les siennes. Codex ne lit pas `.claude/skills` :
 * l'app filtre la liste qu'elle lui donne.
 */
export const SKILLS_PAR_DEFAUT = {
    fige: false,
    personnellesConnues: [],
    agentsConnus: [],
    coupees: {},
    activees: {},
};
const ID_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NOM_SKILL = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,80}$/;
const tri = (noms, motif) => [...new Set(noms.filter((n) => motif.test(n)))].sort((a, b) => a.localeCompare(b, "fr"));
function carte(brut) {
    if (!brut || typeof brut !== "object")
        return {};
    const sortie = {};
    for (const [id, noms] of Object.entries(brut)) {
        if (!ID_AGENT.test(id) || !Array.isArray(noms))
            continue;
        const liste = tri(noms.filter((n) => typeof n === "string"), NOM_SKILL);
        if (liste.length)
            sortie[id] = liste;
    }
    return sortie;
}
/** Garde seulement les clés connues. Un réglage absent ou pas encore figé reçoit tout. */
export function validerSkillsParAgent(brut) {
    const b = (brut ?? {});
    const fige = b.fige === true;
    return {
        fige,
        personnellesConnues: tri(Array.isArray(b.personnellesConnues) ? b.personnellesConnues.filter((n) => typeof n === "string") : [], NOM_SKILL),
        agentsConnus: tri(Array.isArray(b.agentsConnus) ? b.agentsConnus.filter((n) => typeof n === "string") : [], ID_AGENT),
        coupees: fige ? carte(b.coupees) : {},
        activees: fige ? carte(b.activees) : {},
    };
}
/** Cet agent reçoit-il cette skill ? `agent` null : l'assistant (`principal`). */
export function skillRecue(choix, agent, nom, origine) {
    if (!choix.fige)
        return true;
    const id = agent && ID_AGENT.test(agent) ? agent : "principal";
    if (choix.activees[id]?.includes(nom))
        return true;
    if (choix.coupees[id]?.includes(nom))
        return false;
    if (origine === "projet")
        return true;
    return choix.agentsConnus.includes(id) && choix.personnellesConnues.includes(nom);
}
/**
 * Fige le choix actuel : les skills personnelles données sont reçues par les agents donnés.
 * Un choix déjà figé n'est pas recalculé (les coupures et les allumages restent).
 */
export function figerChoix(choix, agents, personnelles) {
    if (choix.fige)
        return choix;
    return validerSkillsParAgent({
        fige: true,
        personnellesConnues: [...personnelles],
        agentsConnus: [...agents],
        coupees: {},
        activees: {},
    });
}
const sansNom = (carte, agent, nom) => {
    const suivant = { ...carte };
    const liste = (suivant[agent] ?? []).filter((n) => n !== nom);
    if (liste.length)
        suivant[agent] = liste;
    else
        delete suivant[agent];
    return suivant;
};
/**
 * Allume ou coupe une skill pour un agent. Le choix doit déjà être figé
 * (`figerChoix`, avec la liste complète des agents et des skills personnelles).
 */
export function definirSkill(choix, agent, nom, origine, recue) {
    if (!choix.fige)
        throw new Error("Le choix des skills n’est pas encore figé.");
    if (!ID_AGENT.test(agent) || !NOM_SKILL.test(nom))
        throw new Error("Agent ou skill invalide.");
    const nu = { ...choix, coupees: sansNom(choix.coupees, agent, nom), activees: sansNom(choix.activees, agent, nom) };
    if (recue === skillRecue(nu, agent, nom, origine))
        return validerSkillsParAgent(nu);
    const cible = recue ? "activees" : "coupees";
    return validerSkillsParAgent({ ...nu, [cible]: { ...nu[cible], [agent]: [...(nu[cible][agent] ?? []), nom] } });
}
/** Les noms à retirer de la session de cet agent, parmi les skills du poste et du projet. */
export function nomsCoupes(choix, agent, poste, projet) {
    const vus = new Set();
    const coupes = [];
    for (const nom of poste) {
        if (vus.has(nom))
            continue;
        vus.add(nom);
        if (!skillRecue(choix, agent, nom, "poste"))
            coupes.push(nom);
    }
    for (const nom of projet) {
        if (vus.has(nom))
            continue;
        vus.add(nom);
        if (!skillRecue(choix, agent, nom, "projet"))
            coupes.push(nom);
    }
    return coupes.sort((a, b) => a.localeCompare(b, "fr"));
}
/**
 * Le JSON de `--settings`. Sans skill coupée, la clé `skillOverrides` est absente :
 * la requête reste celle d'avant. `base` est l'objet déjà passé (permissions).
 */
export function reglagesSession(base, coupes) {
    if (!coupes.length)
        return JSON.stringify(base);
    const skillOverrides = {};
    for (const nom of [...coupes].sort((a, b) => a.localeCompare(b, "fr")))
        skillOverrides[nom] = "off";
    return JSON.stringify({ ...base, skillOverrides });
}
