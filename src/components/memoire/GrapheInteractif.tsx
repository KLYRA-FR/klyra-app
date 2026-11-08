"use client";

import { memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cadrerCamera, SimulationGraphe, zoomerCamera, ZOOM_MAX, ZOOM_MIN, type CameraGraphe } from "@/lib/graphe-physique";
import { voisinDansDirection, type Graphe, type Position, type TypeNoeud } from "@/lib/graphe-memoire";

export interface PoigneeGraphe { centrer: (id: string) => void }
type Types = Record<TypeNoeud, { label: string; couleur: string }>;
type Geste = { pointer: number; id: string | null; debut: Position; vue: CameraGraphe; decalage: Position; bouge: boolean };
const rayonDe = (type: TypeNoeud) => type === "agent" ? 18 : type === "projet" ? 11 : 7;
const cible = (t: EventTarget | null) => t instanceof Element ? t.closest("[data-noeud]")?.getAttribute("data-noeud") ?? null : null;

export function GrapheInteractif({ graphe, selection, choisir, orphelins, couleur, surlignes, poignee, types }: {
  graphe: Graphe; selection: string | null; choisir: (id: string | null) => void; orphelins: Set<string>;
  couleur: (agent: string | null) => string; surlignes: Set<string> | null; poignee: RefObject<PoigneeGraphe | null>; types: Types;
}) {
  // Une relecture des sources ou une recherche ne doit pas relancer le placement.
  const structure = JSON.stringify({ noeuds: graphe.noeuds.map(({ id, type }) => ({ id, type })), aretes: graphe.aretes.filter((a) => a.type !== "deduit").map(({ de, vers, type }) => ({ de, vers, type })) });
  const simulation = useMemo(() => new SimulationGraphe(JSON.parse(structure)), [structure]);
  const [vue, setVue] = useState<CameraGraphe>({ k: 1, x: 0, y: 0 });
  const [taille, setTaille] = useState({ l: 1100, h: 650 });
  const [survol, setSurvol] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [enGeste, setEnGeste] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const geste = useRef<Geste | null>(null);
  const doigts = useRef(new Map<number, Position>());
  const pince = useRef<{ distance: number; milieu: Position; vue: CameraGraphe } | null>(null);
  const reveiller = useRef<() => void>(() => {});
  const tailleReelle = () => ({ l: svg.current?.clientWidth ?? 1100, h: svg.current?.clientHeight ?? 650 });
  const recadrer = () => { const t = tailleReelle(); setVue(cadrerCamera(simulation.positions, t.l, t.h)); };
  const centre = { x: taille.l / 2, y: taille.h / 2 };
  const centrerSur = (id: string) => {
    const p = simulation.positions[id];
    if (p) setVue((v) => { const k = Math.max(1, v.k); return { k, x: taille.l / 2 - p.x * k, y: taille.h / 2 - p.y * k }; });
  };
  useImperativeHandle(poignee, () => ({ centrer: centrerSur }));

  useLayoutEffect(() => {
    const el = svg.current;
    if (!el) return;
    let avant = { l: el.clientWidth, h: el.clientHeight };
    const observer = new ResizeObserver(() => {
      const t = { l: el.clientWidth, h: el.clientHeight };
      if (t.l < 1 || t.h < 1) return;
      setTaille(t);
      // Ouvrir le détail garde le même point au centre du graphe.
      setVue((v) => ({ ...v, x: v.x + (t.l - avant.l) / 2, y: v.y + (t.h - avant.h) / 2 }));
      avant = t;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const t = { l: el.clientWidth, h: el.clientHeight };
    const debut = requestAnimationFrame(() => setVue(cadrerCamera(simulation.positions, t.l, t.h)));
    return () => cancelAnimationFrame(debut);
  }, [simulation]);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    // Seuls les attributs géométriques changent par image, pas les 600 composants React.
    const points = [...el.querySelectorAll<SVGGElement>("[data-noeud]")].map((element) => ({ element, p: simulation.positions[element.dataset.noeud!] }));
    const liens = [...el.querySelectorAll<SVGLineElement>("line[data-de]")].map((element) => ({ element, a: simulation.positions[element.dataset.de!], b: simulation.positions[element.dataset.vers!] }));
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const dessiner = () => {
      for (const { element, p } of points) if (p) element.setAttribute("transform", `translate(${p.x} ${p.y})`);
      for (const { element, a, b } of liens) if (a && b) {
        element.setAttribute("x1", String(a.x)); element.setAttribute("y1", String(a.y));
        element.setAttribute("x2", String(b.x)); element.setAttribute("y2", String(b.y));
      }
    };
    const image = () => {
      frame = 0;
      let active = simulation.avancer();
      if (reduit.matches) for (let i = 0; active && i < 240; i++) active = simulation.avancer();
      dessiner();
      el.dataset.simulation = active ? "active" : "repos";
      if (active && !reduit.matches) frame = requestAnimationFrame(image);
      else setRevision((v) => v + 1);
    };
    const demarrer = () => { el.dataset.simulation = "active"; if (!frame) frame = requestAnimationFrame(image); };
    reveiller.current = demarrer;
    demarrer();
    return () => { cancelAnimationFrame(frame); reveiller.current = () => {}; };
  }, [simulation, graphe.aretes, graphe.noeuds]);

  // Un écouteur non passif bloque le défilement de la page et le zoom navigateur au pincement.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const roue = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1);
      setVue((v) => zoomerCamera(v, Math.exp(-Math.max(-300, Math.min(300, delta)) * (e.ctrlKey ? 0.01 : 0.002)), { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    el.addEventListener("wheel", roue, { passive: false });
    return () => el.removeEventListener("wheel", roue);
  }, []);

  const local = (e: { clientX: number; clientY: number }): Position => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // Choisir le point le plus proche évite que les grandes zones tactiles se masquent.
  const noeudSous = (p: Position) => {
    let id: string | null = null, distance = Infinity;
    for (const n of graphe.noeuds) {
      const q = simulation.positions[n.id];
      if (!q) continue;
      const d = Math.hypot(q.x * vue.k + vue.x - p.x, q.y * vue.k + vue.y - p.y);
      const r = Math.max(22, Math.min(rayonDe(n.type) * 1.8, rayonDe(n.type) * Math.sqrt(vue.k)) + 4);
      if (d <= r && d < distance) { id = n.id; distance = d; }
    }
    return id;
  };
  const surAppui = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = local(e);
    doigts.current.set(e.pointerId, p);
    if (e.nativeEvent.isTrusted) e.currentTarget.setPointerCapture(e.pointerId);
    setEnGeste(true);
    e.currentTarget.focus({ preventScroll: true });
    if (doigts.current.size === 2) {
      const [a, b] = [...doigts.current.values()];
      pince.current = { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), milieu: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, vue };
      if (geste.current?.id) simulation.relacher();
      geste.current = null;
      return;
    }
    if (doigts.current.size !== 1) return;
    const id = noeudSous(p), n = id ? simulation.positions[id] : null;
    geste.current = { pointer: e.pointerId, id, debut: p, vue, decalage: n ? { x: n.x - (p.x - vue.x) / vue.k, y: n.y - (p.y - vue.y) / vue.k } : { x: 0, y: 0 }, bouge: false };
  };
  const surMouvement = (e: PointerEvent<SVGSVGElement>) => {
    const p = local(e);
    if (doigts.current.has(e.pointerId)) doigts.current.set(e.pointerId, p);
    const pin = pince.current;
    if (pin && doigts.current.size >= 2) {
      const [a, b] = [...doigts.current.values()], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const v = zoomerCamera(pin.vue, Math.hypot(b.x - a.x, b.y - a.y) / pin.distance, pin.milieu);
      setVue({ ...v, x: v.x + m.x - pin.milieu.x, y: v.y + m.y - pin.milieu.y });
      return;
    }
    const g = geste.current;
    if (!g || g.pointer !== e.pointerId) { setSurvol(noeudSous(p)); return; }
    const dx = p.x - g.debut.x, dy = p.y - g.debut.y;
    if (!g.bouge && Math.hypot(dx, dy) < 4) return;
    if (!g.bouge && g.id) simulation.saisir(g.id, simulation.positions[g.id]);
    g.bouge = true;
    if (g.id) {
      simulation.tirer({ x: (p.x - g.vue.x) / g.vue.k + g.decalage.x, y: (p.y - g.vue.y) / g.vue.k + g.decalage.y });
      reveiller.current();
    } else setVue({ ...g.vue, x: g.vue.x + dx, y: g.vue.y + dy });
  };
  const terminer = (e: PointerEvent<SVGSVGElement>, annule: boolean) => {
    doigts.current.delete(e.pointerId);
    const g = geste.current;
    if (g?.pointer === e.pointerId) {
      geste.current = null;
      if (g.id && g.bouge) { simulation.relacher(); reveiller.current(); }
      // La capture retargete pointerup sur le SVG : conserver la cible de pointerdown.
      if (!annule && !g.bouge) choisir(g.id);
    }
    if (pince.current) { pince.current = null; geste.current = null; }
    if (!doigts.current.size) setEnGeste(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const surTouche = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dirs = { ArrowUp: "haut", ArrowDown: "bas", ArrowLeft: "gauche", ArrowRight: "droite" } as const;
    if (e.key in dirs) {
      e.preventDefault();
      const id = cible(e.target);
      if (id && !e.shiftKey) {
        const suivant = voisinDansDirection(simulation.positions, id, dirs[e.key as keyof typeof dirs], graphe.noeuds.map((n) => n.id));
        if (suivant) { choisir(suivant); centrerSur(suivant); }
      } else {
        const pas = e.shiftKey ? 160 : 48;
        setVue((v) => ({ ...v, x: v.x + (e.key === "ArrowLeft" ? pas : e.key === "ArrowRight" ? -pas : 0), y: v.y + (e.key === "ArrowUp" ? pas : e.key === "ArrowDown" ? -pas : 0) }));
      }
    } else if (e.key === "+" || e.key === "=") { e.preventDefault(); setVue((v) => zoomerCamera(v, 1.25, centre)); }
    else if (e.key === "-") { e.preventDefault(); setVue((v) => zoomerCamera(v, 0.8, centre)); }
    else if (e.key === "0") { e.preventDefault(); recadrer(); }
    else if (e.key === "Escape") { e.preventDefault(); choisir(null); }
    else if ((e.key === "Enter" || e.key === " ") && cible(e.target)) { e.preventDefault(); choisir(cible(e.target)); }
  };
  const actif = graphe.noeuds.find((n) => n.id === selection);
  return (
    <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-2xl bg-fond-nuit">
      <svg ref={svg} role="application" aria-roledescription="graphe" tabIndex={0}
        aria-label={`Graphe de la mémoire : ${graphe.noeuds.length} éléments. Glisser un nœud pour déplacer ses voisins, glisser le fond ou utiliser les flèches pour déplacer la vue, molette ou + et − pour zoomer, 0 pour tout voir. Tab puis Entrée pour ouvrir un élément, Échap pour fermer le détail.`}
        viewBox={`0 0 ${taille.l} ${taille.h}`}
        className={`size-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-focus ${enGeste ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={surAppui} onPointerMove={surMouvement} onPointerUp={(e) => terminer(e, false)} onPointerCancel={(e) => terminer(e, true)}
        onLostPointerCapture={(e) => { if (doigts.current.has(e.pointerId)) terminer(e, true); }}
        onPointerLeave={() => { if (!geste.current) setSurvol(null); }}
        onFocusCapture={(e) => setSurvol(cible(e.target))} onKeyDown={surTouche}>
        <g data-camera transform={`translate(${vue.x} ${vue.y}) scale(${vue.k})`}>
          <Couche graphe={graphe} simulation={simulation} revision={revision} vue={vue} taille={taille} selection={selection} survol={survol}
            orphelins={orphelins} couleur={couleur} surlignes={surlignes} types={types} />
        </g>
      </svg>
      <p className="sr-only" aria-live="polite">{actif ? `${types[actif.type].label} : ${actif.titre}` : ""}</p>
      <div className="pointer-events-none absolute top-4 left-4 right-4 text-ui-xs text-white/75">Tirer un nœud · Glisser le fond · Molette pour zoomer</div>
      <div className="absolute right-4 bottom-4 flex items-center gap-1 rounded-xl border border-white/15 bg-fond-nuit p-1 text-white" role="group" aria-label="Navigation du graphe">
        <BoutonIcone variant="ghost" taille="md" className="size-11 text-white hover:bg-white/10 disabled:text-white/40" libelle="Dézoomer" disabled={vue.k <= ZOOM_MIN} icone={<Icon name="zoom-out" size={16} />} onClick={() => setVue((v) => zoomerCamera(v, 0.8, centre))} />
        <output className="min-w-12 text-center text-ui-xs tabular-nums" aria-label="Niveau de zoom">{Math.round(vue.k * 100)} %</output>
        <BoutonIcone variant="ghost" taille="md" className="size-11 text-white hover:bg-white/10 disabled:text-white/40" libelle="Zoomer" disabled={vue.k >= ZOOM_MAX} icone={<Icon name="zoom-in" size={16} />} onClick={() => setVue((v) => zoomerCamera(v, 1.25, centre))} />
        <BoutonIcone variant="ghost" taille="md" className="size-11 text-white hover:bg-white/10" libelle="Tout voir" icone={<Icon name="expand" size={16} />} onClick={recadrer} />
      </div>
    </div>
  );
}

/** Libellés en pixels écran, avec priorité au survol et à la sélection, puis évitement des collisions. */
const Couche = memo(function Couche({ graphe, simulation, revision, vue, taille, selection, survol, orphelins, couleur, surlignes, types }: {
  graphe: Graphe; simulation: SimulationGraphe; revision: number; vue: CameraGraphe; taille: { l: number; h: number };
  selection: string | null; survol: string | null; orphelins: Set<string>; couleur: (id: string | null) => string; surlignes: Set<string> | null; types: Types;
}) {
  const accent = survol ?? selection;
  const proches = useMemo(() => {
    const s = new Set<string>();
    for (const a of graphe.aretes) { if (a.de === accent) s.add(a.vers); if (a.vers === accent) s.add(a.de); }
    return s;
  }, [graphe.aretes, accent]);
  const rayon = (type: TypeNoeud) => Math.max(4, Math.min(rayonDe(type) * 1.8, rayonDe(type) * Math.sqrt(vue.k))) / vue.k;
  const libelles = useMemo(() => {
    void revision;
    const occupes: { x: number; y: number; l: number; h: number }[] = [], ids = new Set<string>();
    const priorite = (n: Graphe["noeuds"][number]) => n.id === accent || n.id === selection ? 0 : proches.has(n.id) ? 1 : n.type === "agent" ? 2 : surlignes?.has(n.id) ? 3 : 4;
    for (const n of [...graphe.noeuds].sort((a, b) => priorite(a) - priorite(b))) {
      if (vue.k < 0.7 && priorite(n) > 2) continue;
      const p = simulation.positions[n.id];
      if (!p) continue;
      const l = Math.min(n.titre.length, n.id === accent ? 64 : 36) * 7;
      const r = { x: p.x * vue.k + vue.x - l / 2, y: p.y * vue.k + vue.y + Math.max(4, Math.min(rayonDe(n.type) * 1.8, rayonDe(n.type) * Math.sqrt(vue.k))) + 4, l, h: 20 };
      if (r.x + r.l < 0 || r.x > taille.l || r.y < 32 || r.y > taille.h - 64) continue;
      if (priorite(n) > 0 && occupes.some((o) => r.x < o.x + o.l && r.x + r.l > o.x && r.y < o.y + o.h && r.y + r.h > o.y)) continue;
      occupes.push(r); ids.add(n.id);
    }
    return ids;
  }, [graphe.noeuds, accent, selection, proches, surlignes, simulation, revision, vue, taille]);
  return <>
    <g aria-hidden="true" pointerEvents="none">
      {graphe.aretes.map((a) => {
        const p = simulation.positions[a.de], q = simulation.positions[a.vers];
        if (!p || !q) return null;
        const touche = a.de === accent || a.vers === accent;
        return <line key={`${a.type}|${a.de}|${a.vers}`} data-de={a.de} data-vers={a.vers} x1={p.x} y1={p.y} x2={q.x} y2={q.y}
          stroke={touche ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.18)"} strokeWidth={touche ? 1.5 : 1}
          strokeDasharray={a.type === "deduit" ? "4 4" : undefined} opacity={accent && !touche ? 0.15 : 1} vectorEffect="non-scaling-stroke" />;
      })}
    </g>
    {graphe.noeuds.map((n, i) => {
      const p = simulation.positions[n.id];
      if (!p) return null;
      const r = rayon(n.type), choisi = n.id === selection, actif = n.id === accent, trouve = !!surlignes?.has(n.id);
      const estompe = surlignes ? !trouve && !choisi && !actif && !proches.has(n.id) : !!accent && !actif && !choisi && !proches.has(n.id);
      const max = actif ? 64 : 36;
      return <g key={n.id} data-noeud={n.id} data-trouve={trouve || undefined} transform={`translate(${p.x} ${p.y})`} opacity={estompe ? 0.3 : 1}
        role="button" aria-label={`${types[n.type].label} : ${n.titre}`} aria-pressed={choisi} tabIndex={choisi || (!selection && i === 0) ? 0 : -1}
        className="group cursor-grab outline-none active:cursor-grabbing">
        <title>{`${types[n.type].label} · ${n.titre}`}</title>
        <circle r={Math.max(r + 4 / vue.k, 22 / vue.k)} fill="transparent" />
        <circle r={r + 4 / vue.k} fill="none" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" className="opacity-0 group-focus-visible:opacity-100" />
        {orphelins.has(n.id) && <circle r={r + 4 / vue.k} fill="none" stroke="var(--color-rouge-500)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        {trouve && <circle r={r + 5 / vue.k} fill="var(--color-bleu-k1-500)" opacity={0.45} />}
        {(choisi || actif) && <circle r={r + 7 / vue.k} fill="none" stroke="white" strokeWidth={choisi ? 2 : 1} vectorEffect="non-scaling-stroke" />}
        {n.type === "agent" && n.agent ? <foreignObject x={-r} y={-r} width={r * 2} height={r * 2} pointerEvents="none"><AgentRond roleId={n.agent} taille={r * 2} /></foreignObject>
          : n.type === "projet" ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={4 / vue.k} fill={types.projet.couleur} />
            : <circle r={r} fill={types[n.type].couleur} stroke={couleur(n.agent)} strokeWidth={2} strokeDasharray={n.prive ? "2 2" : undefined} vectorEffect="non-scaling-stroke" />}
        {libelles.has(n.id) && !estompe && <text y={r + 16 / vue.k} textAnchor="middle" fill="white" fontSize={12 / vue.k}
          stroke="var(--color-fond-nuit)" strokeWidth={3 / vue.k} paintOrder="stroke" className="pointer-events-none" fontWeight={actif || choisi ? 600 : 400}>
          {n.titre.length > max ? `${n.titre.slice(0, max - 1)}…` : n.titre}
        </text>}
      </g>;
    })}
  </>;
});
