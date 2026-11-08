/**
 * Le graphe commun de la page Mémoire : un index recalculé à partir des sources (souvenirs des agents lus
 * dans leurs fichiers, fichiers publiés, fils, projets). Rien n'y est écrit : effacer ce module laisse les
 * sources intactes. Règles pures, sans React ni Electron.
 */

export type TypeNoeud = "souvenir" | "fichier" | "fil" | "agent" | "projet";
export type TypeArete = "lien" | "produit-par" | "issu-de" | "concerne" | "remplace" | "deduit";

export interface NoeudGraphe {
  id: string;
  type: TypeNoeud;
  titre: string;
  /** Résumé d'une ligne. */
  resume: string;
  /** Agent auteur (null pour un projet). Pour un nœud agent : son propre id. */
  agent: string | null;
  projetId: string | null;
  /** ISO, ou null si la source n'en donne pas. */
  date: string | null;
  /** Chemin du fichier source (souvenir, fichier publié), sinon null. */
  chemin: string | null;
  prive: boolean;
  /** Pour un souvenir : user, feedback, project ou reference. */
  sousType?: string | null;
  /** Conversation à ouvrir (fil, ou fil d'origine d'un fichier). */
  chatId?: string | null;
}
export interface AreteGraphe {
  de: string;
  vers: string;
  type: TypeArete;
  /** Liens déduits seulement, entre 0 et 1. */
  confiance?: number;
  /** Pourquoi le lien est déduit (« même projet », « même sujet : … »). */
  raison?: string;
}
export interface Graphe { noeuds: NoeudGraphe[]; aretes: AreteGraphe[] }

/* ─── Sources ──────────────────────────────────────────────────────────── */

export interface SouvenirSource {
  id: string; nom: string; fichier: string; description: string; type: string | null; agent: string;
  date: string; chemin: string; prive: boolean; projetId: string | null; liens: string[]; remplace: string[];
}
export interface FilSource { id: string; titre: string; agent: string; projetId: string | null; date: string | null }
export interface FichierSource {
  id: string; titre: string; description: string; agent: string; chemin: string;
  chatId: string | null; projetId: string | null; date: string | null;
}
export interface ProjetSource { id: string; nom: string; date: string | null }
export interface AgentSource { id: string; nom: string; titre?: string }
export interface SourcesGraphe {
  souvenirs: SouvenirSource[]; fils: FilSource[]; fichiers: FichierSource[]; projets: ProjetSource[]; agents: AgentSource[];
}

/** Clé de comparaison d'un nom de souvenir : `Fonctionnement modifications` = `fonctionnement-modifications`. */
export function cleNom(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\.md$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const idAgent = (id: string) => `agent:${id}`;
export const idProjet = (id: string) => `projet:${id}`;
export const idFil = (id: string) => `fil:${id}`;
export const idFichier = (id: string) => `fichier:${id}`;

/** Construit le graphe commun. Les liens déduits sont ajoutés à part (`liensDeduits`), en pointillé. */
export function construireGraphe(s: SourcesGraphe): Graphe {
  const noeuds = new Map<string, NoeudGraphe>(), aretes: AreteGraphe[] = [], vues = new Set<string>();
  const arete = (de: string, vers: string, type: TypeArete) => {
    if (de === vers || !noeuds.has(de) || !noeuds.has(vers)) return;
    const cle = `${type}|${de}|${vers}`;
    if (vues.has(cle)) return;
    vues.add(cle);
    aretes.push({ de, vers, type });
  };
  const nomsAgents = new Map(s.agents.map((a) => [a.id, a]));
  const agentNoeud = (id: string) => {
    const nid = idAgent(id);
    if (!noeuds.has(nid)) {
      const a = nomsAgents.get(id);
      noeuds.set(nid, { id: nid, type: "agent", titre: a?.nom || id, resume: a?.titre ?? "Agent", agent: id, projetId: null, date: null, chemin: null, prive: false });
    }
    return nid;
  };
  for (const a of s.agents) agentNoeud(a.id);
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
  const parNom = new Map<string, SouvenirSource[]>();
  for (const m of s.souvenirs) {
    for (const cle of new Set([cleNom(m.nom), cleNom(m.fichier)])) {
      if (!cle) continue;
      parNom.set(cle, [...(parNom.get(cle) ?? []), m]);
    }
  }
  const resoudre = (cible: string, agent: string) => {
    const liste = parNom.get(cleNom(cible)) ?? [];
    return (liste.find((x) => x.agent === agent) ?? liste[0])?.id ?? null;
  };
  for (const m of s.souvenirs) {
    arete(m.id, agentNoeud(m.agent), "produit-par");
    if (m.projetId) arete(m.id, idProjet(m.projetId), "concerne");
    for (const l of m.liens) { const c = resoudre(l, m.agent); if (c) arete(m.id, c, "lien"); }
    for (const r of m.remplace) { const c = resoudre(r, m.agent); if (c) arete(m.id, c, "remplace"); }
  }
  for (const f of s.fils) {
    arete(idFil(f.id), agentNoeud(f.agent), "produit-par");
    if (f.projetId) arete(idFil(f.id), idProjet(f.projetId), "concerne");
  }
  for (const f of s.fichiers) {
    const id = idFichier(f.id);
    arete(id, agentNoeud(f.agent), "produit-par");
    if (f.chatId) arete(id, idFil(f.chatId), "issu-de");
    if (f.projetId) arete(id, idProjet(f.projetId), "concerne");
  }
  return { noeuds: [...noeuds.values()], aretes };
}

/* ─── Liens déduits ────────────────────────────────────────────────────── */

const MOTS_VIDES = new Set(
  ("avec dans des pour par sur une les est que qui pas plus sans ses son mais aux elle elles ils nous vous leur leurs " +
    "cette ces tout tous toute faire fait quand comme avant apres entre dont chaque depuis sous vers the and for with from this that " +
    "klyra fichier note page agent agents projet").split(" "),
);
export function motsCles(texte: string): Set<string> {
  const mots = texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  return new Set(mots.filter((m) => !MOTS_VIDES.has(m)));
}

/**
 * Liens que l'app propose sans les écrire : même sujet (mots en commun dans le titre et le résumé) et, pour
 * deux souvenirs d'agents différents, même projet. Au plus `parNoeud` par nœud, au-dessus de `seuil`.
 */
export function liensDeduits(g: Graphe, opts: { seuil?: number; parNoeud?: number; refuses?: Set<string> } = {}): AreteGraphe[] {
  const seuil = opts.seuil ?? 0.25, parNoeud = opts.parNoeud ?? 3;
  const candidats = g.noeuds.filter((n) => n.type === "souvenir" || n.type === "fichier" || n.type === "fil");
  const explicites = new Set(g.aretes.map((a) => cleArete(a.de, a.vers)));
  const mots = new Map(candidats.map((n) => [n.id, motsCles(`${n.titre} ${n.resume}`)]));
  const index = new Map<string, string[]>();
  for (const n of candidats) for (const m of mots.get(n.id)!) index.set(m, [...(index.get(m) ?? []), n.id]);
  const parId = new Map(candidats.map((n) => [n.id, n]));
  const propositions = new Map<string, AreteGraphe>();
  const proposer = (a: string, b: string, confiance: number, raison: string) => {
    const cle = cleArete(a, b);
    if (explicites.has(cle) || opts.refuses?.has(cle)) return;
    const avant = propositions.get(cle);
    if (!avant || (avant.confiance ?? 0) < confiance) propositions.set(cle, { de: a < b ? a : b, vers: a < b ? b : a, type: "deduit", confiance, raison });
  };
  for (const n of candidats) {
    const communs = new Map<string, number>();
    for (const m of mots.get(n.id)!) {
      const porteurs = index.get(m)!;
      if (porteurs.length > 40) continue; // Mot trop courant : il ne dit pas de quoi parle la note.
      for (const autre of porteurs) if (autre > n.id) communs.set(autre, (communs.get(autre) ?? 0) + 1);
    }
    for (const [autre, nb] of communs) {
      const a = mots.get(n.id)!, b = mots.get(autre)!;
      const jaccard = nb / (a.size + b.size - nb);
      if (nb >= 2 && jaccard >= seuil) {
        const exemples = [...a].filter((m) => b.has(m)).slice(0, 3).join(", ");
        proposer(n.id, autre, Math.round(jaccard * 100) / 100, `Même sujet : ${exemples}`);
      }
    }
  }
  const parProjet = new Map<string, NoeudGraphe[]>();
  for (const n of candidats) if (n.type === "souvenir" && n.projetId) parProjet.set(n.projetId, [...(parProjet.get(n.projetId) ?? []), n]);
  for (const liste of parProjet.values()) {
    for (let i = 0; i < liste.length && i < 60; i++) for (let j = i + 1; j < liste.length && j < 60; j++) {
      if (liste[i].agent !== liste[j].agent) proposer(liste[i].id, liste[j].id, 0.4, "Même projet");
    }
  }
  // Garde les meilleurs par nœud.
  const tries = [...propositions.values()].sort((x, y) => (y.confiance ?? 0) - (x.confiance ?? 0));
  const compte = new Map<string, number>(), garde: AreteGraphe[] = [];
  for (const a of tries) {
    if ((compte.get(a.de) ?? 0) >= parNoeud || (compte.get(a.vers) ?? 0) >= parNoeud || !parId.has(a.de) || !parId.has(a.vers)) continue;
    compte.set(a.de, (compte.get(a.de) ?? 0) + 1); compte.set(a.vers, (compte.get(a.vers) ?? 0) + 1);
    garde.push(a);
  }
  return garde;
}
export function cleArete(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/* ─── Périmètre, filtres, orphelins ────────────────────────────────────── */

/** `null` : Corentin (le propriétaire) voit tout ; sinon un agent ne voit pas les nœuds privés des autres. */
export function visiblePour(g: Graphe, observateur: string | null): Graphe {
  if (observateur === null) return g;
  const noeuds = g.noeuds.filter((n) => !n.prive || n.agent === observateur);
  const ids = new Set(noeuds.map((n) => n.id));
  return { noeuds, aretes: g.aretes.filter((a) => ids.has(a.de) && ids.has(a.vers)) };
}

export type Periode = "tout" | "7j" | "30j" | "90j";
export interface FiltresGraphe { agents: string[]; types: TypeNoeud[]; projetId: string | null; periode: Periode; orphelins: boolean }
export const FILTRES_VIDES: FiltresGraphe = { agents: [], types: [], projetId: null, periode: "tout", orphelins: false };
const JOURS: Record<Periode, number> = { tout: 0, "7j": 7, "30j": 30, "90j": 90 };

/** Souvenirs, fichiers et fils sans aucun lien hormis leur agent : à relier ou à revoir. */
export function orphelins(g: Graphe): Set<string> {
  const relies = new Set<string>();
  for (const a of g.aretes) if (a.type !== "produit-par" && a.type !== "deduit") { relies.add(a.de); relies.add(a.vers); }
  return new Set(g.noeuds.filter((n) => (n.type === "souvenir" || n.type === "fichier" || n.type === "fil") && !relies.has(n.id)).map((n) => n.id));
}

/**
 * Applique les filtres. Les agents et projets restent visibles quand l'un de leurs nœuds l'est
 * (repères), sauf s'ils sont exclus par le filtre de type.
 */
export function filtrerGraphe(g: Graphe, f: FiltresGraphe, maintenant = Date.now()): Graphe {
  const seuil = JOURS[f.periode] ? maintenant - JOURS[f.periode] * 86_400_000 : 0;
  const seuls = f.orphelins ? orphelins(g) : null;
  const contenus = g.noeuds.filter((n) => {
    if (n.type === "agent" || n.type === "projet") return false;
    if (f.types.length && !f.types.includes(n.type)) return false;
    if (f.agents.length && (!n.agent || !f.agents.includes(n.agent))) return false;
    if (f.projetId && n.projetId !== f.projetId) return false;
    if (seuil && (!n.date || Date.parse(n.date) < seuil)) return false;
    if (seuls && !seuls.has(n.id)) return false;
    return true;
  });
  const ids = new Set(contenus.map((n) => n.id));
  const reperes = new Set<string>();
  for (const a of g.aretes) {
    if (a.type === "deduit") continue;
    if (ids.has(a.de)) reperes.add(a.vers);
    if (ids.has(a.vers)) reperes.add(a.de);
  }
  const garde = (n: NoeudGraphe) => {
    if (ids.has(n.id)) return true;
    if (n.type !== "agent" && n.type !== "projet") return false;
    if (f.types.length && !f.types.includes(n.type)) return false;
    if (n.type === "agent" && f.agents.length && !f.agents.includes(n.agent ?? "")) return false;
    if (n.type === "projet" && f.projetId && n.projetId !== f.projetId) return false;
    // Sans filtre restrictif, un agent ou un projet seul reste affiché (état de départ).
    return reperes.has(n.id) || (!f.agents.length && !f.projetId && !seuil && !seuls && !f.types.length);
  };
  const noeuds = g.noeuds.filter(garde);
  const finaux = new Set(noeuds.map((n) => n.id));
  return { noeuds, aretes: g.aretes.filter((a) => finaux.has(a.de) && finaux.has(a.vers)) };
}

/** Voisins d'un nœud, avec la relation lue depuis ce nœud. */
export function voisins(g: Graphe, id: string): { noeud: NoeudGraphe; arete: AreteGraphe; sortant: boolean }[] {
  const parId = new Map(g.noeuds.map((n) => [n.id, n]));
  const out: { noeud: NoeudGraphe; arete: AreteGraphe; sortant: boolean }[] = [];
  for (const a of g.aretes) {
    const autre = a.de === id ? a.vers : a.vers === id ? a.de : null;
    const n = autre ? parId.get(autre) : undefined;
    if (n) out.push({ noeud: n, arete: a, sortant: a.de === id });
  }
  return out;
}

export function libelleRelation(a: AreteGraphe, sortant: boolean): string {
  switch (a.type) {
    case "lien": return sortant ? "Cite" : "Cité par";
    case "produit-par": return sortant ? "Produit par" : "A produit";
    case "issu-de": return sortant ? "Issu du fil" : "A donné";
    case "concerne": return sortant ? "Concerne" : "Concerné par";
    case "remplace": return sortant ? "Remplace" : "Remplacé par";
    case "deduit": return `Lien suggéré (${Math.round((a.confiance ?? 0) * 100)} %)`;
  }
}

/* ─── Placement ────────────────────────────────────────────────────────── */

export interface Position { x: number; y: number }

/**
 * Place les nœuds sans hasard (même graphe, même dessin) : chaque agent sur un grand cercle, ses nœuds en
 * spirale autour de lui, les projets au centre ; puis quelques passes de répulsion sur une grille
 * (coût linéaire, fluide au-delà de 500 nœuds) et de rappel le long des arêtes.
 */
export function placerGraphe(g: Graphe, passes = 40): Record<string, Position> {
  const pos: Record<string, Position> = {};
  if (!g.noeuds.length) return pos;
  const agents = g.noeuds.filter((n) => n.type === "agent");
  const projets = g.noeuds.filter((n) => n.type === "projet");
  const autres = g.noeuds.filter((n) => n.type !== "agent" && n.type !== "projet");
  const rayon = Math.max(260, Math.sqrt(g.noeuds.length) * 48);
  agents.forEach((a, i) => {
    const t = (i / Math.max(1, agents.length)) * Math.PI * 2 - Math.PI / 2;
    pos[a.id] = { x: Math.cos(t) * rayon, y: Math.sin(t) * rayon };
  });
  projets.forEach((p, i) => {
    const t = i * 2.39996;
    const r = 30 + Math.sqrt(i) * 70;
    pos[p.id] = { x: Math.cos(t) * r, y: Math.sin(t) * r };
  });
  const rang = new Map<string, number>();
  for (const n of autres) {
    const centre = (n.agent && pos[idAgent(n.agent)]) || { x: 0, y: 0 };
    const k = rang.get(n.agent ?? "") ?? 0;
    rang.set(n.agent ?? "", k + 1);
    const t = k * 2.39996, r = 46 + Math.sqrt(k) * 30;
    // Un nœud lié à un projet est tiré vers le centre.
    const vers = n.projetId && pos[idProjet(n.projetId)] ? 0.3 : 0;
    pos[n.id] = { x: centre.x * (1 - vers) + Math.cos(t) * r, y: centre.y * (1 - vers) + Math.sin(t) * r };
  }
  const ids = g.noeuds.map((n) => n.id);
  const fixes = new Set(agents.map((a) => a.id));
  const aretes = g.aretes.filter((a) => a.type !== "deduit" && pos[a.de] && pos[a.vers]);
  const CELLULE = 60, DIST = 36;
  for (let passe = 0; passe < passes; passe++) {
    const grille = new Map<string, string[]>();
    for (const id of ids) {
      const p = pos[id], cle = `${Math.floor(p.x / CELLULE)}:${Math.floor(p.y / CELLULE)}`;
      const c = grille.get(cle);
      if (c) c.push(id); else grille.set(cle, [id]);
    }
    const dep = new Map<string, Position>(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (const id of ids) {
      const p = pos[id], cx = Math.floor(p.x / CELLULE), cy = Math.floor(p.y / CELLULE);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const autre of grille.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (autre <= id) continue;
          const q = pos[autre];
          let vx = p.x - q.x, vy = p.y - q.y;
          let d = Math.hypot(vx, vy);
          if (d >= DIST) continue;
          if (d < 0.01) { vx = 1; vy = (id.length % 7) - 3; d = Math.hypot(vx, vy); }
          const f = ((DIST - d) / d) * 0.5;
          const a = dep.get(id)!, b = dep.get(autre)!;
          a.x += vx * f; a.y += vy * f; b.x -= vx * f; b.y -= vy * f;
        }
      }
    }
    for (const a of aretes) {
      const p = pos[a.de], q = pos[a.vers];
      const vx = q.x - p.x, vy = q.y - p.y, d = Math.hypot(vx, vy);
      if (d < 90) continue;
      const f = ((d - 90) / d) * 0.02;
      const da = dep.get(a.de)!, db = dep.get(a.vers)!;
      da.x += vx * f; da.y += vy * f; db.x -= vx * f; db.y -= vy * f;
    }
    for (const id of ids) {
      if (fixes.has(id)) continue;
      const d = dep.get(id)!;
      pos[id] = { x: pos[id].x + Math.max(-20, Math.min(20, d.x)), y: pos[id].y + Math.max(-20, Math.min(20, d.y)) };
    }
  }
  return pos;
}

/** Cadre qui contient toutes les positions, avec une marge. */
export function cadreDe(pos: Record<string, Position>, marge = 80): { x: number; y: number; l: number; h: number } {
  const v = Object.values(pos);
  if (!v.length) return { x: -400, y: -300, l: 800, h: 600 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of v) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { x: minX - marge, y: minY - marge, l: maxX - minX + marge * 2, h: maxY - minY + marge * 2 };
}

/** Nœud le plus proche dans une direction (navigation au clavier dans le graphe). */
export function voisinDansDirection(pos: Record<string, Position>, depuis: string, dir: "haut" | "bas" | "gauche" | "droite", ids: string[]): string | null {
  const p = pos[depuis];
  if (!p) return ids[0] ?? null;
  let meilleur: string | null = null, score = Infinity;
  for (const id of ids) {
    if (id === depuis || !pos[id]) continue;
    const dx = pos[id].x - p.x, dy = pos[id].y - p.y;
    const avant = dir === "droite" ? dx : dir === "gauche" ? -dx : dir === "bas" ? dy : -dy;
    const cote = dir === "droite" || dir === "gauche" ? Math.abs(dy) : Math.abs(dx);
    if (avant <= 0) continue;
    const s = avant + cote * 2;
    if (s < score) { score = s; meilleur = id; }
  }
  return meilleur;
}

/* ─── Sources depuis l'état de l'app ───────────────────────────────────── */

interface ChatLike { id: string; title: string; projectId: string | null; updatedAt: string; fil?: { roleId: string; creeLe: string; supprime?: boolean; projetId?: string | null } | null }
interface RenduLike { id: string; titre: string; description: string; roleId: string; origine: string; chemin: string; chatId: string | null; projectId: string | null; misAJour: string }

/** Les fils (tâches) de l'espace affiché. Un fil « supprimé » n'entre pas dans le graphe. */
export function filsDepuisChats(chats: ChatLike[]): FilSource[] {
  return chats.filter((c) => c.fil && !c.fil.supprime).map((c) => ({
    id: c.id, titre: c.title, agent: c.fil!.roleId, projetId: c.projectId ?? c.fil!.projetId ?? null, date: c.fil!.creeLe || c.updatedAt,
  }));
}
/** Les fichiers publiés : le chemin d'origine (sur un VPS, la partie après `#`). */
export function fichiersDepuisRendus(rendus: RenduLike[]): FichierSource[] {
  return rendus.map((r) => ({
    id: r.id, titre: r.titre, description: r.description, agent: r.roleId,
    chemin: r.origine.includes("#") ? r.origine.slice(r.origine.indexOf("#") + 1) : r.origine || r.chemin,
    chatId: r.chatId, projetId: r.projectId, date: r.misAJour,
  }));
}

/* ─── Recherche (phase 2) ──────────────────────────────────────────────── */

export interface TrouveContenu { chemin: string; extrait: string; occurrences: number }
export interface ResultatRecherche { noeud: NoeudGraphe; ou: "nom" | "resume" | "contenu"; extrait: string; score: number }

const plat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Mêmes mots que le serveur (`motsRecherche` d'electron/graphe-souvenirs.ts). */
export function motsDe(requete: string): string[] {
  return [...new Set(plat(requete.slice(0, 300)).split(/[^a-z0-9_-]+/).filter((m) => m.length >= 2))].slice(0, 12);
}

/**
 * Cherche dans le nom et le résumé de chaque nœud, puis ajoute ceux dont le fichier source contient tous les mots
 * (`contenu`, par chemin, lu par le PC ou le VPS). Un nœud absent du graphe donné (privé d'un autre agent) n'est
 * jamais renvoyé.
 */
export function chercherNoeuds(g: Graphe, requete: string, contenu: TrouveContenu[] = [], cheminsDe?: (n: NoeudGraphe) => string[]): ResultatRecherche[] {
  const mots = motsDe(requete);
  if (!mots.length) return [];
  const parChemin = new Map(contenu.map((c) => [c.chemin, c]));
  const out: ResultatRecherche[] = [];
  for (const n of g.noeuds) {
    const titre = plat(n.titre), resume = plat(n.resume);
    if (mots.every((m) => titre.includes(m))) {
      out.push({ noeud: n, ou: "nom", extrait: n.resume, score: 300 + (titre === mots.join(" ") ? 50 : 0) - Math.min(titre.length, 99) / 100 });
      continue;
    }
    if (mots.every((m) => titre.includes(m) || resume.includes(m))) { out.push({ noeud: n, ou: "resume", extrait: n.resume, score: 200 }); continue; }
    const chemins = cheminsDe ? cheminsDe(n) : n.chemin ? [n.chemin] : [];
    const trouve = chemins.map((c) => parChemin.get(c)).find(Boolean);
    if (trouve) out.push({ noeud: n, ou: "contenu", extrait: trouve.extrait, score: 100 + Math.min(trouve.occurrences, 50) });
  }
  return out.sort((a, b) => b.score - a.score || a.noeud.titre.localeCompare(b.noeud.titre, "fr"));
}

/** Découpe un texte pour surligner les mots trouvés (sans HTML). */
export function segmentsSurlignes(texte: string, mots: string[]): { texte: string; trouve: boolean }[] {
  if (!mots.length || !texte) return [{ texte, trouve: false }];
  const p = plat(texte);
  const marques = new Array<boolean>(texte.length).fill(false);
  // NFD puis retrait des accents garde la longueur pour le français courant ; sinon, pas de surlignage.
  if (p.length !== texte.length) return [{ texte, trouve: false }];
  for (const m of mots) for (let i = p.indexOf(m); i >= 0; i = p.indexOf(m, i + m.length)) marques.fill(true, i, i + m.length);
  const out: { texte: string; trouve: boolean }[] = [];
  for (let i = 0; i < texte.length; i++) {
    const dernier = out[out.length - 1];
    if (dernier && dernier.trouve === marques[i]) dernier.texte += texte[i];
    else out.push({ texte: texte[i], trouve: marques[i] });
  }
  return out;
}
