/**
 * Le graphe commun de la page Mémoire : un index recalculé à partir des sources (souvenirs des agents lus
 * dans leurs fichiers, fichiers publiés, fils, projets). Rien n'y est écrit : effacer ce module laisse les
 * sources intactes. Règles pures, sans React ni Electron. Le modèle (nœuds, arêtes, liens déduits, périmètre)
 * est dans `electron/graphe-regles.ts`, lu aussi par l'outil des agents : la page et les agents voient le même graphe.
 */
export * from "../../electron/graphe-regles";
import { cleArete, cleNom, idAgent, idProjet, motsCles, type FichierSource, type FilSource, type Graphe, type NoeudGraphe } from "../../electron/graphe-regles";

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

/* ─── Entretien (phase 3) ──────────────────────────────────────────────── */

export interface Doublon { a: NoeudGraphe; b: NoeudGraphe; garder: NoeudGraphe; retirer: NoeudGraphe; raison: string; confiance: number }
export interface Obsolete { noeud: NoeudGraphe; raison: string }
export const JOURS_OBSOLETE = 90;

/**
 * Ce que l'app signale sans rien appliquer : deux souvenirs d'un même agent qui disent la même chose (même nom,
 * ou titre et résumé presque identiques ; on propose de garder le plus récent), et les souvenirs obsolètes
 * (remplacés par un autre, ou souvenir de projet inchangé depuis 90 jours).
 */
export function propositionsEntretien(g: Graphe, maintenant = Date.now()): { doublons: Doublon[]; obsoletes: Obsolete[] } {
  const souvenirs = g.noeuds.filter((n) => n.type === "souvenir");
  const parId = new Map(souvenirs.map((n) => [n.id, n]));
  const mots = new Map(souvenirs.map((n) => [n.id, motsCles(`${n.titre} ${n.resume}`)]));
  const doublons: Doublon[] = [], vus = new Set<string>();
  const proposer = (a: NoeudGraphe, b: NoeudGraphe, raison: string, confiance: number) => {
    const cle = cleArete(a.id, b.id);
    if (vus.has(cle)) return;
    vus.add(cle);
    const [garder, retirer] = (a.date ?? "") >= (b.date ?? "") ? [a, b] : [b, a];
    doublons.push({ a, b, garder, retirer, raison, confiance });
  };
  const parCle = new Map<string, NoeudGraphe[]>();
  for (const n of souvenirs) {
    const cle = `${n.agent}|${cleNom(n.titre)}`;
    parCle.set(cle, [...(parCle.get(cle) ?? []), n]);
  }
  for (const liste of parCle.values()) for (let i = 1; i < liste.length; i++) proposer(liste[0], liste[i], "Même nom", 1);
  const index = new Map<string, string[]>();
  for (const n of souvenirs) for (const m of mots.get(n.id)!) index.set(m, [...(index.get(m) ?? []), n.id]);
  for (const n of souvenirs) {
    const a = mots.get(n.id)!;
    if (a.size < 3) continue;
    const communs = new Map<string, number>();
    for (const m of a) for (const autre of index.get(m) ?? []) if (autre > n.id) communs.set(autre, (communs.get(autre) ?? 0) + 1);
    for (const [autre, nb] of communs) {
      const o = parId.get(autre)!, b = mots.get(autre)!;
      if (o.agent !== n.agent || b.size < 3) continue;
      const j = nb / (a.size + b.size - nb);
      if (j >= 0.6) proposer(n, o, `Titre et résumé presque identiques (${Math.round(j * 100)} %)`, Math.round(j * 100) / 100);
    }
  }
  const obsoletes: Obsolete[] = [], dejaObsolete = new Set<string>();
  for (const a of g.aretes) {
    if (a.type !== "remplace" || !parId.has(a.vers) || dejaObsolete.has(a.vers)) continue;
    dejaObsolete.add(a.vers);
    obsoletes.push({ noeud: parId.get(a.vers)!, raison: `Remplacé par « ${g.noeuds.find((n) => n.id === a.de)?.titre ?? "un autre souvenir"} »` });
  }
  for (const n of souvenirs) {
    if (dejaObsolete.has(n.id) || n.sousType !== "project" || !n.date) continue;
    const jours = Math.floor((maintenant - Date.parse(n.date)) / 86_400_000);
    if (jours >= JOURS_OBSOLETE) obsoletes.push({ noeud: n, raison: `Souvenir de projet inchangé depuis ${jours} jours` });
  }
  return { doublons: doublons.sort((x, y) => y.confiance - x.confiance), obsoletes };
}
