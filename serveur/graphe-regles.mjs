// Généré par scripts/serveur-genere.mjs depuis electron/graphe-regles.ts : ne pas modifier à la main.
/**
 * Les règles du graphe commun de la page Mémoire, partagées par l'écran (`src/lib/graphe-memoire.ts`), le
 * process principal et le serveur (outil `memoire_graphe` des agents, `electron/graphe-agent.ts`) : ce que voit
 * un agent est ce que montre la page. Un index recalculé à partir des sources (souvenirs des agents lus dans
 * leurs fichiers, fichiers publiés, fils, projets) ; rien n'y est écrit. Module pur, sans import.
 */
/** Clé de comparaison d'un nom de souvenir : `Fonctionnement modifications` = `fonctionnement-modifications`. */
export function cleNom(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\.md$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export const idAgent = (id) => `agent:${id}`;
export const idProjet = (id) => `projet:${id}`;
export const idFil = (id) => `fil:${id}`;
export const idFichier = (id) => `fichier:${id}`;
/** Construit le graphe commun. Les liens déduits sont ajoutés à part (`liensDeduits`), en pointillé. */
export function construireGraphe(s) {
    const noeuds = new Map(), aretes = [], vues = new Set();
    const arete = (de, vers, type) => {
        if (de === vers || !noeuds.has(de) || !noeuds.has(vers))
            return;
        const cle = `${type}|${de}|${vers}`;
        if (vues.has(cle))
            return;
        vues.add(cle);
        aretes.push({ de, vers, type });
    };
    const nomsAgents = new Map(s.agents.map((a) => [a.id, a]));
    const agentNoeud = (id) => {
        const nid = idAgent(id);
        if (!noeuds.has(nid)) {
            const a = nomsAgents.get(id);
            noeuds.set(nid, { id: nid, type: "agent", titre: a?.nom || id, resume: a?.titre ?? "Agent", agent: id, projetId: null, date: null, chemin: null, prive: false });
        }
        return nid;
    };
    for (const a of s.agents)
        agentNoeud(a.id);
    for (const p of s.projets) {
        noeuds.set(idProjet(p.id), { id: idProjet(p.id), type: "projet", titre: p.nom || "Projet", resume: "Projet", agent: null, projetId: p.id, date: p.date, chemin: null, prive: false });
    }
    for (const m of s.souvenirs) {
        noeuds.set(m.id, { id: m.id, type: "souvenir", titre: m.nom, resume: m.description, agent: m.agent, projetId: m.projetId, date: m.date, chemin: m.chemin, prive: m.prive, sousType: m.type });
    }
    for (const f of s.fils) {
        noeuds.set(idFil(f.id), { id: idFil(f.id), type: "fil", titre: f.titre || "Fil", resume: f.titre || "", agent: f.agent, projetId: f.projetId, date: f.date, chemin: null, prive: false, chatId: f.id });
    }
    for (const f of s.fichiers) {
        noeuds.set(idFichier(f.id), { id: idFichier(f.id), type: "fichier", titre: f.titre || f.chemin.split(/[\\/]/).pop() || "Fichier", resume: f.description, agent: f.agent, projetId: f.projetId, date: f.date, chemin: f.chemin, prive: false, chatId: f.chatId });
    }
    // Index des noms pour résoudre [[…]] et « remplace » : d'abord chez le même agent, sinon le premier trouvé.
    const parNom = new Map();
    for (const m of s.souvenirs) {
        for (const cle of new Set([cleNom(m.nom), cleNom(m.fichier)])) {
            if (!cle)
                continue;
            parNom.set(cle, [...(parNom.get(cle) ?? []), m]);
        }
    }
    const resoudre = (cible, agent) => {
        const liste = parNom.get(cleNom(cible)) ?? [];
        return (liste.find((x) => x.agent === agent) ?? liste[0])?.id ?? null;
    };
    for (const m of s.souvenirs) {
        arete(m.id, agentNoeud(m.agent), "produit-par");
        if (m.projetId)
            arete(m.id, idProjet(m.projetId), "concerne");
        for (const l of m.liens) {
            const c = resoudre(l, m.agent);
            if (c)
                arete(m.id, c, "lien");
        }
        for (const r of m.remplace) {
            const c = resoudre(r, m.agent);
            if (c)
                arete(m.id, c, "remplace");
        }
    }
    for (const f of s.fils) {
        arete(idFil(f.id), agentNoeud(f.agent), "produit-par");
        if (f.projetId)
            arete(idFil(f.id), idProjet(f.projetId), "concerne");
    }
    for (const f of s.fichiers) {
        const id = idFichier(f.id);
        arete(id, agentNoeud(f.agent), "produit-par");
        if (f.chatId)
            arete(id, idFil(f.chatId), "issu-de");
        if (f.projetId)
            arete(id, idProjet(f.projetId), "concerne");
    }
    return { noeuds: [...noeuds.values()], aretes };
}
/* ─── Liens déduits ────────────────────────────────────────────────────── */
const MOTS_VIDES = new Set(("avec dans des pour par sur une les est que qui pas plus sans ses son mais aux elle elles ils nous vous leur leurs " +
    "cette ces tout tous toute faire fait quand comme avant apres entre dont chaque depuis sous vers the and for with from this that " +
    "klyra fichier note page agent agents projet").split(" "));
export function motsCles(texte) {
    const mots = texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
    return new Set(mots.filter((m) => !MOTS_VIDES.has(m)));
}
/**
 * Liens que l'app propose sans les écrire : même sujet (mots en commun dans le titre et le résumé) et, pour
 * deux souvenirs d'agents différents, même projet. Au plus `parNoeud` par nœud, au-dessus de `seuil`.
 */
export function liensDeduits(g, opts = {}) {
    const seuil = opts.seuil ?? 0.25, parNoeud = opts.parNoeud ?? 3;
    const candidats = g.noeuds.filter((n) => n.type === "souvenir" || n.type === "fichier" || n.type === "fil");
    const explicites = new Set(g.aretes.map((a) => cleArete(a.de, a.vers)));
    const mots = new Map(candidats.map((n) => [n.id, motsCles(`${n.titre} ${n.resume}`)]));
    const index = new Map();
    for (const n of candidats)
        for (const m of mots.get(n.id))
            index.set(m, [...(index.get(m) ?? []), n.id]);
    const parId = new Map(candidats.map((n) => [n.id, n]));
    const propositions = new Map();
    const proposer = (a, b, confiance, raison) => {
        const cle = cleArete(a, b);
        if (explicites.has(cle) || opts.refuses?.has(cle))
            return;
        const avant = propositions.get(cle);
        if (!avant || (avant.confiance ?? 0) < confiance)
            propositions.set(cle, { de: a < b ? a : b, vers: a < b ? b : a, type: "deduit", confiance, raison });
    };
    for (const n of candidats) {
        const communs = new Map();
        for (const m of mots.get(n.id)) {
            const porteurs = index.get(m);
            if (porteurs.length > 40)
                continue; // Mot trop courant : il ne dit pas de quoi parle la note.
            for (const autre of porteurs)
                if (autre > n.id)
                    communs.set(autre, (communs.get(autre) ?? 0) + 1);
        }
        for (const [autre, nb] of communs) {
            const a = mots.get(n.id), b = mots.get(autre);
            const jaccard = nb / (a.size + b.size - nb);
            if (nb >= 2 && jaccard >= seuil) {
                const exemples = [...a].filter((m) => b.has(m)).slice(0, 3).join(", ");
                proposer(n.id, autre, Math.round(jaccard * 100) / 100, `Même sujet : ${exemples}`);
            }
        }
    }
    const parProjet = new Map();
    for (const n of candidats)
        if (n.type === "souvenir" && n.projetId)
            parProjet.set(n.projetId, [...(parProjet.get(n.projetId) ?? []), n]);
    for (const liste of parProjet.values()) {
        for (let i = 0; i < liste.length && i < 60; i++)
            for (let j = i + 1; j < liste.length && j < 60; j++) {
                if (liste[i].agent !== liste[j].agent)
                    proposer(liste[i].id, liste[j].id, 0.4, "Même projet");
            }
    }
    // Garde les meilleurs par nœud.
    const tries = [...propositions.values()].sort((x, y) => (y.confiance ?? 0) - (x.confiance ?? 0));
    const compte = new Map(), garde = [];
    for (const a of tries) {
        if ((compte.get(a.de) ?? 0) >= parNoeud || (compte.get(a.vers) ?? 0) >= parNoeud || !parId.has(a.de) || !parId.has(a.vers))
            continue;
        compte.set(a.de, (compte.get(a.de) ?? 0) + 1);
        compte.set(a.vers, (compte.get(a.vers) ?? 0) + 1);
        garde.push(a);
    }
    return garde;
}
export function cleArete(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}
/* ─── Périmètre, filtres, orphelins ────────────────────────────────────── */
/** `null` : Corentin (le propriétaire) voit tout ; sinon un agent ne voit pas les nœuds privés des autres. */
export function visiblePour(g, observateur) {
    if (observateur === null)
        return g;
    const noeuds = g.noeuds.filter((n) => !n.prive || n.agent === observateur);
    const ids = new Set(noeuds.map((n) => n.id));
    return { noeuds, aretes: g.aretes.filter((a) => ids.has(a.de) && ids.has(a.vers)) };
}
export const FILTRES_VIDES = { agents: [], types: [], projetId: null, periode: "tout", orphelins: false };
const JOURS = { tout: 0, "7j": 7, "30j": 30, "90j": 90 };
/** Souvenirs, fichiers et fils sans aucun lien hormis leur agent : à relier ou à revoir. */
export function orphelins(g) {
    const relies = new Set();
    for (const a of g.aretes)
        if (a.type !== "produit-par" && a.type !== "deduit") {
            relies.add(a.de);
            relies.add(a.vers);
        }
    return new Set(g.noeuds.filter((n) => (n.type === "souvenir" || n.type === "fichier" || n.type === "fil") && !relies.has(n.id)).map((n) => n.id));
}
/**
 * Applique les filtres. Les agents et projets restent visibles quand l'un de leurs nœuds l'est
 * (repères), sauf s'ils sont exclus par le filtre de type.
 */
export function filtrerGraphe(g, f, maintenant = Date.now()) {
    const seuil = JOURS[f.periode] ? maintenant - JOURS[f.periode] * 86_400_000 : 0;
    const seuls = f.orphelins ? orphelins(g) : null;
    const contenus = g.noeuds.filter((n) => {
        if (n.type === "agent" || n.type === "projet")
            return false;
        if (f.types.length && !f.types.includes(n.type))
            return false;
        if (f.agents.length && (!n.agent || !f.agents.includes(n.agent)))
            return false;
        if (f.projetId && n.projetId !== f.projetId)
            return false;
        if (seuil && (!n.date || Date.parse(n.date) < seuil))
            return false;
        if (seuls && !seuls.has(n.id))
            return false;
        return true;
    });
    const ids = new Set(contenus.map((n) => n.id));
    const reperes = new Set();
    for (const a of g.aretes) {
        if (a.type === "deduit")
            continue;
        if (ids.has(a.de))
            reperes.add(a.vers);
        if (ids.has(a.vers))
            reperes.add(a.de);
    }
    const garde = (n) => {
        if (ids.has(n.id))
            return true;
        if (n.type !== "agent" && n.type !== "projet")
            return false;
        if (f.types.length && !f.types.includes(n.type))
            return false;
        if (n.type === "agent" && f.agents.length && !f.agents.includes(n.agent ?? ""))
            return false;
        if (n.type === "projet" && f.projetId && n.projetId !== f.projetId)
            return false;
        // Sans filtre restrictif, un agent ou un projet seul reste affiché (état de départ).
        return reperes.has(n.id) || (!f.agents.length && !f.projetId && !seuil && !seuls && !f.types.length);
    };
    const noeuds = g.noeuds.filter(garde);
    const finaux = new Set(noeuds.map((n) => n.id));
    return { noeuds, aretes: g.aretes.filter((a) => finaux.has(a.de) && finaux.has(a.vers)) };
}
/** Voisins d'un nœud, avec la relation lue depuis ce nœud. */
export function voisins(g, id) {
    const parId = new Map(g.noeuds.map((n) => [n.id, n]));
    const out = [];
    for (const a of g.aretes) {
        const autre = a.de === id ? a.vers : a.vers === id ? a.de : null;
        const n = autre ? parId.get(autre) : undefined;
        if (n)
            out.push({ noeud: n, arete: a, sortant: a.de === id });
    }
    return out;
}
export function libelleRelation(a, sortant) {
    switch (a.type) {
        case "lien": return sortant ? "Cite" : "Cité par";
        case "produit-par": return sortant ? "Produit par" : "A produit";
        case "issu-de": return sortant ? "Issu du fil" : "A donné";
        case "concerne": return sortant ? "Concerne" : "Concerné par";
        case "remplace": return sortant ? "Remplace" : "Remplacé par";
        case "deduit": return `Lien suggéré (${Math.round((a.confiance ?? 0) * 100)} %)`;
    }
}
