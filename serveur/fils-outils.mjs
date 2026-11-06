// Généré par scripts/serveur-genere.mjs depuis electron/fils-outils.ts : ne pas modifier à la main.
/**
 * Les fils pour les agents : une tâche = un fil, une conversation à part d'un agent qui tourne sans bloquer
 * celle d'où elle part. Module pur, le même sur ce PC et sur un VPS (généré en `serveur/fils-outils.mjs`) :
 * les outils et leurs textes, la consigne, ce que l'agent d'un fil lit en arrivant, le retour au lanceur.
 *
 * Sur ce PC, l'écran exécute les outils (`workspace.tsx`, il tient les conversations). Sur un VPS, l'appel
 * part à l'app ouverte sur le PC (`serveur/fils.mjs`, événement `fil`) ; PC fermé, le serveur les tient
 * lui-même dans son espace, avec les mêmes règles.
 */
const id = { type: "string", description: "L'identifiant du fil (klyra-fil-…)." };
/** Le préfixe des identifiants de fil. */
export const PREFIXE_FIL = "klyra-fil-";
export const OUTILS_FILS = [
    {
        name: "ouvrir_fil",
        description: "Confie une tâche à un agent de l'équipe (ou à toi-même) dans un nouveau fil : un onglet de son chat, qui travaille à part sans bloquer. Seulement pour un travail qui ne se règle pas tout de suite. Le fil ne voit pas cette conversation : le brief doit être complet (contexte, fichiers, attendu, critères de fin). Regarde d'abord avec lister_fils s'il n'en existe pas déjà un ouvert sur le même sujet. Quand l'agent a fini, sa réponse te revient automatiquement dans cette conversation. Le fil est un ticket, visible par la personne avec son état, sa priorité et son échéance.",
        inputSchema: {
            type: "object",
            properties: {
                agent: { type: "string", description: "L'identifiant de l'agent qui fait la tâche (ex. dev, designer), ou principal." },
                titre: { type: "string", description: "Un titre court : « Rapport hebdo »." },
                brief: { type: "string", description: "La consigne complète." },
                priorite: { type: "integer", minimum: 0, maximum: 3, description: "Facultatif : 0 aucune, 1 basse, 2 moyenne, 3 haute." },
                echeance: { type: "string", description: "Facultatif : le jour attendu, « 2026-11-05 »." },
                projet: { type: "string", description: "Facultatif : l'identifiant du projet concerné." },
            },
            required: ["agent", "titre", "brief"],
        },
    },
    {
        name: "lister_fils",
        description: "Liste les fils ouverts (les tickets pas encore fermés), avec leur agent, leur état (à faire, en cours, bloqué et pourquoi, à valider), leur priorité, leur échéance, leur projet et leur identifiant. Ce qui attend quelqu'un vient d'abord : bloqués, en cours, à valider, à faire.",
        inputSchema: {
            type: "object",
            properties: {
                agent: { type: "string", description: "Facultatif : seulement les fils de cet agent." },
                etat: { type: "string", enum: ["bloque", "en-cours", "a-valider"], description: "Facultatif : seulement les fils dans cet état." },
            },
        },
    },
    {
        name: "lire_fil",
        description: "Lit l'état d'un fil et sa dernière réponse (le résultat, quand il a fini).",
        inputSchema: { type: "object", properties: { id }, required: ["id"] },
    },
    {
        name: "ecrire_dans_fil",
        description: "Ajoute une précision ou une consigne dans un fil ; s'il travaille, elle attend son tour.",
        inputSchema: { type: "object", properties: { id, message: { type: "string" } }, required: ["id", "message"] },
    },
    {
        name: "mettre_a_jour_fil",
        description: "Met à jour l'état d'un ticket (un fil) : bloque (tu attends une réponse, un accès ou une décision : dis pourquoi dans raison), a-valider (le travail est fait, à relire), en-cours (tu continues, par exemple après une tâche de fond). Réservé à l'agent du fil et à celui qui l'a lancé. Sans cet outil, une réponse finie passe le fil « à valider ».",
        inputSchema: {
            type: "object",
            properties: {
                id,
                etat: { type: "string", enum: ["bloque", "a-valider", "en-cours"] },
                raison: { type: "string", description: "Pourquoi c'est bloqué, en une ligne. Obligatoire pour bloque." },
            },
            required: ["id", "etat"],
        },
    },
    {
        name: "arreter_fil",
        description: "Suspend le travail d'un fil, sans le fermer. Aucun nouveau départ tant qu'il n'est pas repris après contrôle.",
        inputSchema: { type: "object", properties: { id }, required: ["id"] },
    },
    {
        name: "reprendre_fil",
        description: "Reprend un fil suspendu, après un contrôle nommé dans controle. Un fil terminé ou annulé ne reprend pas.",
        inputSchema: { type: "object", properties: { id, controle: { type: "string", description: "La référence du contrôle qui autorise la reprise." } }, required: ["id", "controle"] },
    },
    {
        name: "fermer_fil",
        description: "Ferme un fil que tu as lancé, une fois le travail fait et vérifié : il est archivé (rien n'est effacé) et peut être rouvert. Vérifie d'abord que le travail est fini. Un fil ouvert par la personne ou par un autre agent, c'est lui qui le ferme : mets-le « à valider » avec mettre_a_jour_fil.",
        inputSchema: { type: "object", properties: { id }, required: ["id"] },
    },
];
export const NOMS_FILS = OUTILS_FILS.map((o) => o.name);
export function estOutilFil(nom) {
    return typeof nom === "string" && NOMS_FILS.includes(nom);
}
/** Comment un agent confie une tâche à un coéquipier : donnée à chaque session qui a les outils de l'app. */
export const CONSIGNE_FILS = `Dans cette app, une tâche = un fil : une conversation à part d'un agent, ouverte dans un onglet de son chat, qui tourne sans bloquer. Pour confier à un coéquipier (ou à toi-même) un travail qui ne se règle pas tout de suite, utilise l'outil ouvrir_fil avec un brief complet (le fil ne voit pas ta conversation), après avoir regardé avec lister_fils qu'il n'en existe pas déjà un sur le même sujet. Une tâche = un responsable. Quand le coéquipier a fini, sa réponse te revient d'elle-même : ne la surveille pas en boucle. Tu peux lire un fil (lire_fil), y ajouter une précision (ecrire_dans_fil), l'arrêter (arreter_fil), le reprendre après un contrôle (reprendre_fil, avec la référence du contrôle ; un fil terminé ou annulé ne reprend pas), et fermer (fermer_fil) un fil que tu as lancé une fois le travail fait et vérifié. Un fil est un ticket, que la personne voit avec son état : à faire, en cours, bloqué, à valider, terminé. Ta réponse finie le passe « à valider ». Si tu attends quelque chose (une réponse, un accès, une décision), dis-le avec mettre_a_jour_fil (bloque et la raison). Un fil ouvert par la personne, c'est elle qui le valide et le ferme. Cite toujours un fil avec son titre et son identifiant : Rapport hebdo (klyra-fil-…). Les fils d'un même agent partagent ses fichiers : évite que deux fils modifient les mêmes fichiers en même temps. Pour une petite recherche rapide, pas besoin de fil. Ne confie pas un travail long à un agent lancé en arrière-plan dans ta session : ouvre un fil, que la personne suit.`;
/** Ce que l'agent d'un fil lit en arrivant, avant le brief. */
export function contexteFil(fil) {
    const lignes = [
        `Tu travailles dans un fil, une tâche à part : « ${fil.titre} » (${fil.id}), ouvert par ${fil.par}. Ce fil ne voit pas les autres conversations : tout ce qu’il faut est dans le brief. Quand tu as fini, termine par le résultat, clairement${fil.retour ? ` : ta réponse revient à ${fil.par}` : ""}.` +
            ` Ce fil est un ticket : ta réponse finie le passe « à valider ». Si tu attends quelque chose (une réponse, un accès, une décision), dis-le avec mettre_a_jour_fil (bloque et la raison).`,
    ];
    if (fil.projet)
        lignes.push(`Projet du ticket : ${fil.projet}.`);
    if (fil.echeance)
        lignes.push(`Échéance du ticket : ${fil.echeance}.`);
    return lignes;
}
/** Le message qui rapporte la réponse d'un fil à l'agent qui l'a lancé, dans sa conversation. */
export function texteRetourFil(fil) {
    return `**${fil.ok ? "Fil terminé" : "Fil arrêté sur une erreur"} : ${fil.titre}** (${fil.id}) · ${fil.agent}\n\n${fil.texte || "Pas de texte dans la réponse."}`;
}
/** La réponse de `ouvrir_fil`. */
export function texteFilOuvert(titre, id, agent, retour) {
    return `Fil ouvert : ${titre || "sans titre"} (${id}). ${agent} y travaille, dans un onglet de son chat.${retour ? " Sa réponse te reviendra automatiquement dans cette conversation : inutile de la surveiller." : ""}`;
}
/** Cinq travaux ouverts à la fois, au plus : le suivant attend (comme le journal des travaux du PC). */
export const TRAVAUX_MAX = 5;
/** Le refus d'un travail de plus : le plafond, et les fils qui occupent les places (titre et identifiant). */
export function texteAttente(occupants = []) {
    const places = occupants.length ? ` Places prises : ${occupants.map((o) => `${o.titre || "sans titre"} (${o.id})`).join(", ")}.` : "";
    return `En attente : ${TRAVAUX_MAX} travaux sont déjà ouverts.${places} Celui-ci démarre quand une place se libère.`;
}
