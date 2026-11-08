import { cadreDe, type AreteGraphe, type NoeudGraphe, type Position } from "./graphe-memoire";

export type CameraGraphe = { k: number; x: number; y: number };
export const ZOOM_MIN = 0.04;
export const ZOOM_MAX = 12;

/** Le point sous le curseur reste au même endroit, y compris aux limites du zoom. */
export function zoomerCamera(v: CameraGraphe, facteur: number, p: Position): CameraGraphe {
  const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.k * facteur));
  return { k, x: p.x - (p.x - v.x) * k / v.k, y: p.y - (p.y - v.y) * k / v.k };
}

export function cadrerCamera(pos: Record<string, Position>, largeur: number, hauteur: number): CameraGraphe {
  const c = cadreDe(pos, 64);
  const k = Math.max(ZOOM_MIN, Math.min(1.5, largeur / c.l, hauteur / c.h));
  return { k, x: largeur / 2 - (c.x + c.l / 2) * k, y: hauteur / 2 - (c.y + c.h / 2) * k };
}

type Structure = {
  noeuds: Pick<NoeudGraphe, "id" | "type">[];
  aretes: Pick<AreteGraphe, "de" | "vers" | "type">[];
};
type Particule = Position & { vx: number; vy: number; fx: number; fy: number; rayon: number };
type Cellule = { points: Particule[]; x: number; y: number; cx: number; cy: number };

/**
 * Ressorts + répulsion amortis, sans nœud ancré ni dépendance externe. Les cellules
 * éloignées sont agrégées pour éviter une comparaison de toutes les paires.
 * Les liens suggérés restent visuels : ils ne changent pas la physique.
 */
export class SimulationGraphe {
  readonly positions: Record<string, Particule> = {};
  private points: Particule[];
  private liens: { a: Particule; b: Particule; force: number; distance: number }[];
  private alpha = 1;
  private tenu: { id: string; p: Position } | null = null;

  constructor(g: Structure) {
    const degres = new Map<string, number>();
    const aretes = g.aretes.filter((a) => a.type !== "deduit");
    for (const a of aretes) for (const id of [a.de, a.vers]) degres.set(id, (degres.get(id) ?? 0) + 1);
    g.noeuds.forEach((n, i) => {
      const angle = i * 2.399963, r = Math.sqrt(i) * 32;
      this.positions[n.id] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0, fx: 0, fy: 0, rayon: n.type === "agent" ? 20 : 10 };
    });
    this.points = Object.values(this.positions);
    this.liens = aretes.flatMap((a) => {
      const p = this.positions[a.de], q = this.positions[a.vers];
      return p && q && p !== q ? [{ a: p, b: q, force: 0.055 / Math.sqrt(Math.max(degres.get(a.de) ?? 1, degres.get(a.vers) ?? 1)), distance: 100 + p.rayon + q.rayon }] : [];
    });
    // Premier dessin déjà déployé ; les dernières oscillations se font à l'écran.
    for (let i = 0; i < 100; i++) this.avancer();
  }

  saisir(id: string, p: Position) {
    if (!this.positions[id]) return;
    this.tenu = { id, p: { ...p } };
    this.rechauffer();
  }
  tirer(p: Position) {
    if (!this.tenu) return;
    this.tenu.p = p;
    const n = this.positions[this.tenu.id];
    n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0;
    this.rechauffer();
  }
  relacher() { this.tenu = null; this.rechauffer(); }
  rechauffer() { this.alpha = Math.max(this.alpha, 0.65); }

  /** Retourne false une fois au repos : aucune boucle d'animation permanente. */
  avancer(): boolean {
    if (!this.points.length || this.alpha < 0.003) return false;
    const cellules = new Map<string, Cellule>();
    const taille = 180;
    for (const p of this.points) {
      p.fx = -p.x * 0.0008; p.fy = -p.y * 0.0008;
      const cx = Math.floor(p.x / taille), cy = Math.floor(p.y / taille), cle = `${cx}:${cy}`;
      let c = cellules.get(cle);
      if (!c) { c = { points: [], x: 0, y: 0, cx, cy }; cellules.set(cle, c); }
      c.points.push(p); c.x += p.x; c.y += p.y;
    }
    for (const c of cellules.values()) { c.x /= c.points.length; c.y /= c.points.length; }
    for (const p of this.points) {
      const cx = Math.floor(p.x / taille), cy = Math.floor(p.y / taille);
      for (const c of cellules.values()) {
        if (Math.abs(cx - c.cx) > 1 || Math.abs(cy - c.cy) > 1) {
          const dx = p.x - c.x, dy = p.y - c.y, d2 = dx * dx + dy * dy;
          const f = 1100 * c.points.length / Math.max(100, d2) / Math.sqrt(Math.max(100, d2));
          p.fx += dx * f; p.fy += dy * f;
        } else for (const q of c.points) {
          if (q === p) continue;
          const dx = p.x - q.x || 0.01, dy = p.y - q.y || 0.01;
          const d = Math.max(0.1, Math.hypot(dx, dy));
          const collision = Math.max(0, p.rayon + q.rayon + 28 - d) * 0.25;
          const f = (1100 / Math.max(100, d * d) + collision) / d;
          p.fx += dx * f; p.fy += dy * f;
        }
      }
    }
    for (const { a, b, force, distance } of this.liens) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy));
      const f = (d - distance) / d * force;
      a.fx += dx * f; a.fy += dy * f; b.fx -= dx * f; b.fy -= dy * f;
    }
    for (const p of this.points) {
      p.vx = (p.vx + p.fx * this.alpha) * 0.72;
      p.vy = (p.vy + p.fy * this.alpha) * 0.72;
      p.x += Math.max(-24, Math.min(24, p.vx)); p.y += Math.max(-24, Math.min(24, p.vy));
    }
    if (this.tenu) {
      const p = this.positions[this.tenu.id];
      p.x = this.tenu.p.x; p.y = this.tenu.p.y; p.vx = 0; p.vy = 0;
    }
    this.alpha *= this.tenu ? 0.997 : 0.975;
    return true;
  }
}
