// Généré par scripts/serveur-genere.mjs depuis src/types/workflows.ts : ne pas modifier à la main.
/**
 * Les workflows : un canevas de nœuds qu'un déclencheur lance. Chaque étape
 * passe sa sortie aux suivantes le long des liens. Les notes, textes et formes
 * sont pour les gens : une exécution ne passe jamais par eux.
 */
export const TYPES_NOEUD = [
    "declencheur",
    "prompt",
    "ressource",
    "agent",
    "llm",
    "image",
    "condition",
    "approbation",
    "sortie",
    "note",
    "texte",
    "forme",
];
export const ANNOTATIONS = ["note", "texte", "forme"];
/** Les types de port que chaque nœud reçoit et envoie. */
export const PORTS = {
    declencheur: { entree: [], sortie: ["texte"] },
    prompt: { entree: [], sortie: ["texte"] },
    ressource: { entree: [], sortie: ["fichier"] },
    agent: { entree: ["texte", "image", "fichier"], sortie: ["texte"] },
    llm: { entree: ["texte", "image", "fichier"], sortie: ["texte"] },
    image: { entree: ["texte", "image"], sortie: ["image"] },
    condition: { entree: ["texte"], sortie: ["texte"] },
    approbation: { entree: ["texte"], sortie: ["texte"] },
    sortie: { entree: ["texte", "image", "fichier"], sortie: [] },
    note: { entree: [], sortie: [] },
    texte: { entree: [], sortie: [] },
    forme: { entree: [], sortie: [] },
};
export function estEtape(type) {
    return !ANNOTATIONS.includes(type);
}
const MOTS_PORT = { texte: "du texte", image: "une image", fichier: "un fichier" };
/** Pourquoi on ne peut pas relier deux nœuds, ou null quand on peut. */
export function problemeLien(de, vers, liens, branche) {
    if (de.id === vers.id)
        return "Un nœud ne peut pas se relier à lui-même";
    if (!estEtape(de.type) || !estEtape(vers.type))
        return "Les notes, textes et formes ne se relient pas";
    const port = PORTS[de.type].sortie[0];
    if (!port)
        return "Ce nœud n’a pas de sortie";
    if (!PORTS[vers.type].entree.length)
        return "Ce nœud n’a pas d’entrée";
    if (!PORTS[vers.type].entree.includes(port))
        return `Reçoit ${PORTS[vers.type].entree.map((p) => MOTS_PORT[p]).join(" ou ")}, pas ${MOTS_PORT[port]}`;
    if (liens.some((l) => l.de === de.id && l.vers === vers.id && l.branche === branche))
        return "Déjà relié";
    return null;
}
/**
 * Les liens qui reviennent vers une étape d'avant et ferment une boucle. Un
 * parcours en profondeur depuis les nœuds où rien n'entre, puis les autres,
 * dans l'ordre du canevas : un lien vers un nœud qu'on est encore en train de
 * parcourir ferme une boucle. Sans eux, le graphe n'a pas de boucle.
 */
export function liensBoucle(noeuds, liens) {
    const suivants = new Map();
    const entres = new Set();
    for (const l of liens) {
        suivants.set(l.de, [...(suivants.get(l.de) ?? []), l]);
        entres.add(l.vers);
    }
    const boucles = new Set();
    const finis = new Set();
    const ouverts = new Set();
    const departs = [...noeuds.filter((n) => !entres.has(n.id)), ...noeuds.filter((n) => entres.has(n.id))];
    for (const { id } of departs) {
        if (finis.has(id))
            continue;
        const pile = [{ id, i: 0 }];
        ouverts.add(id);
        for (let haut = pile.at(-1); haut; haut = pile.at(-1)) {
            const l = suivants.get(haut.id)?.[haut.i];
            if (!l) {
                pile.pop();
                ouverts.delete(haut.id);
                finis.add(haut.id);
                continue;
            }
            haut.i += 1;
            if (ouverts.has(l.vers))
                boucles.add(l.id);
            else if (!finis.has(l.vers)) {
                ouverts.add(l.vers);
                pile.push({ id: l.vers, i: 0 });
            }
        }
    }
    return boucles;
}
export const GRAPHE_VIDE = { noeuds: [], liens: [], traits: [] };
