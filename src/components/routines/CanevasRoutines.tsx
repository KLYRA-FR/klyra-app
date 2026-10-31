"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { apparition } from "@/lib/mouvement";
import { raccourciDuSysteme } from "@/lib/plateforme";

type Camera = { x: number; y: number; z: number };
export interface CarteCanevas { id: string; contenu: ReactNode; lien: boolean; travaille?: boolean; pointille?: boolean }
const borner = (z: number) => Math.max(0.5, Math.min(1.5, z));

// Petites pièces visuelles recopiées du canevas Workflows ; aucun code ni stockage partagé.
function courbe(a: { x: number; y: number }, b: { x: number; y: number }) {
  const c = Math.max(48, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + c} ${a.y}, ${b.x - c} ${b.y}, ${b.x} ${b.y}`;
}
function BoutonOutil({ icone, libelle, onClick, raccourci }: { icone: IconName; libelle: string; onClick(): void; raccourci?: string }) {
  return <button type="button" aria-label={libelle} title={raccourci ? `${libelle} (${raccourciDuSysteme(raccourci)})` : libelle} onClick={onClick} className="flex size-8 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-icone-secondaire transition-colors duration-[120ms] ease-sortie hover:bg-fond-survol hover:text-texte-principal"><Icon name={icone} size={16} /></button>;
}

/** Placement mesuré et caméra locaux à la vue : les cartes n'ont aucune position persistante. */
export function CanevasRoutines({ agentId, nom, cartes, agent, etat, focaliser }: { agentId: string; nom: string; cartes: CarteCanevas[]; agent: ReactNode; etat?: ReactNode; focaliser?: string | null }) {
  const vue = useRef<HTMLElement>(null);
  const monde = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const carteAgent = useRef<HTMLDivElement>(null);
  const [hauteurs, setHauteurs] = useState<Record<string, number>>({});
  const [taille, setTaille] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<Camera>({ x: 80, y: 80, z: 1 });
  const camera = useRef(cam);
  const glisse = useRef<null | { x: number; y: number; cam: Camera }>(null);
  const [anime, setAnime] = useState(false);
  const [menu, setMenu] = useState(false);
  const boutonMenu = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<null | { x: number; y: number; w: number; h: number }>(null);
  const signature = cartes.map((c) => c.id).join("|");
  const mondeVisible = !etat;
  const places = cartes.reduce<(CarteCanevas & { y: number })[]>((avant, carte) => {
    const precedente = avant.at(-1);
    return [...avant, { ...carte, y: precedente ? precedente.y + (hauteurs[precedente.id] ?? 320) + 32 : 0 }];
  }, []);
  const derniere = places.at(-1);
  const hauteur = derniere ? derniere.y + (hauteurs[derniere.id] ?? 320) : 0;
  const hauteurAgent = hauteurs.agent ?? 170;
  const agentY = Math.max(0, (hauteur - hauteurAgent) / 2);
  const hauteurMonde = Math.max(hauteur, agentY + hauteurAgent);

  const deplacer = useCallback((nouvelle: Camera, transition = false) => {
    setAnime(transition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    camera.current = nouvelle;
    setCam(nouvelle);
  }, []);
  const ajuster = useCallback(() => {
    if (!taille.w || !taille.h) return;
    const z = Math.max(0.6, Math.min(1, (taille.w - 160) / 760, (taille.h - 160) / Math.max(1, hauteurMonde)));
    deplacer({ x: Math.max(40, (taille.w - 760 * z) / 2), y: Math.max(40, (taille.h - hauteurMonde * z) / 2), z }, true);
  }, [taille, hauteurMonde, deplacer]);
  const zoomer = useCallback((z: number, x = taille.w / 2, y = taille.h / 2) => {
    const c = camera.current;
    const prochain = borner(z);
    deplacer({ x: x - (x - c.x) * prochain / c.z, y: y - (y - c.y) * prochain / c.z, z: prochain });
  }, [taille, deplacer]);
  useLayoutEffect(() => {
    if (!vue.current) return;
    const observer = new ResizeObserver(([e]) => setTaille({ w: e.contentRect.width, h: e.contentRect.height }));
    observer.observe(vue.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const observer = new ResizeObserver((entrees) => setHauteurs((avant) => {
      const apres = { ...avant }; let change = false;
      for (const e of entrees) { const id = (e.target as HTMLElement).dataset.carteMesuree!; const h = e.borderBoxSize[0]?.blockSize ?? e.contentRect.height; if (apres[id] !== h) { apres[id] = h; change = true; } }
      return change ? apres : avant;
    }));
    for (const el of elements.current.values()) observer.observe(el);
    if (carteAgent.current) observer.observe(carteAgent.current);
    return () => observer.disconnect();
  }, [signature, mondeVisible]);
  useEffect(() => { const frame = requestAnimationFrame(ajuster); return () => cancelAnimationFrame(frame); }, [ajuster, agentId]);
  const montrer = useCallback((el: HTMLElement) => {
    if (!vue.current) return;
    const r = el.getBoundingClientRect(); const v = vue.current.getBoundingClientRect(); const c = camera.current;
    const dx = r.left < v.left + 24 ? v.left + 24 - r.left : r.right > v.right - 24 ? v.right - 24 - r.right : 0;
    const dy = r.top < v.top + 24 ? v.top + 24 - r.top : r.bottom > v.bottom - 64 ? v.bottom - 64 - r.bottom : 0;
    if (dx || dy) deplacer({ ...c, x: c.x + dx, y: c.y + dy }, true);
  }, [deplacer]);
  useEffect(() => {
    if (!focaliser) return;
    const frame = requestAnimationFrame(() => {
      const carte = elements.current.get(focaliser)?.querySelector<HTMLElement>("[data-routine-carte]");
      carte?.focus({ preventScroll: true }); if (carte) montrer(carte);
    });
    return () => cancelAnimationFrame(frame);
  }, [focaliser, signature, montrer]);
  useEffect(() => {
    const el = vue.current; if (!el) return;
    const roue = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[role="menu"], input, textarea')) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { const r = el.getBoundingClientRect(); zoomer(camera.current.z * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top); }
      else deplacer({ ...camera.current, x: camera.current.x - e.deltaX, y: camera.current.y - e.deltaY });
    };
    el.addEventListener("wheel", roue, { passive: false });
    return () => el.removeEventListener("wheel", roue);
  }, [zoomer, deplacer]);
  useEffect(() => {
    if (!menu) return;
    apparition(menuRef.current); menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dehors = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node) && !boutonMenu.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("pointerdown", dehors); return () => document.removeEventListener("pointerdown", dehors);
  }, [menu]);
  useEffect(() => {
    const actualiser = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || !monde.current?.contains(el) || !el.matches(":focus-visible")) { setFocus(null); return; }
      const r = el.getBoundingClientRect(); const v = vue.current!.getBoundingClientRect();
      setFocus({ x: r.left - v.left, y: r.top - v.top, w: r.width, h: r.height });
    };
    let frame = 0;
    const debut = performance.now();
    const mesurer = () => { actualiser(); if (anime && performance.now() - debut < 240) frame = requestAnimationFrame(mesurer); };
    frame = requestAnimationFrame(mesurer);
    return () => cancelAnimationFrame(frame);
  }, [cam, signature, hauteurs, anime]);

  return <section ref={vue} aria-label={`Routines de ${nom}`} tabIndex={-1} className="relative min-w-0 flex-1 overflow-hidden outline-none" style={{ backgroundColor: "var(--color-fond-page)", backgroundImage: "radial-gradient(var(--color-bordure-forte) 1px, transparent 1px)", backgroundSize: `${20 * cam.z}px ${20 * cam.z}px`, backgroundPosition: `${cam.x}px ${cam.y}px` }}
    onPointerDown={(e) => { if (e.button || (e.target as HTMLElement).closest("[data-carte-mesuree], button, a, [role=menu]")) return; glisse.current = { x: e.clientX, y: e.clientY, cam: camera.current }; e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus(); }}
    onPointerMove={(e) => { const g = glisse.current; if (g) deplacer({ ...g.cam, x: g.cam.x + e.clientX - g.x, y: g.cam.y + e.clientY - g.y }); }} onPointerUp={() => { glisse.current = null; }} onPointerCancel={() => { glisse.current = null; }}
    onFocusCapture={(e) => { if (monde.current?.contains(e.target)) { montrer(e.target); const r = e.target.getBoundingClientRect(); const v = e.currentTarget.getBoundingClientRect(); setFocus(e.target.matches(":focus-visible") ? { x: r.left - v.left, y: r.top - v.top, w: r.width, h: r.height } : null); } }} onBlurCapture={() => setFocus(null)}
    onKeyDown={(e) => { if ((e.target as HTMLElement).closest("input, textarea, [role=combobox], [role=menu]")) return; if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomer(cam.z + 0.1); } else if (e.key === "-") { e.preventDefault(); zoomer(cam.z - 0.1); } else if (e.key === "0") { e.preventDefault(); zoomer(1); } else if (e.shiftKey && (e.code === "Digit1")) { e.preventDefault(); ajuster(); } }}>
    {etat ?? <div ref={monde} className="absolute top-0 left-0 origin-top-left" style={{ width: 760, height: hauteurMonde, transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`, transition: anime ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)" : "none" }}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible" width={760} height={hauteurMonde} fill="none">{places.filter((c) => c.lien).map((c) => <path key={c.id} data-lien-routine={c.id} d={courbe({ x: 320, y: c.y + 22 }, { x: 480, y: agentY + 22 })} strokeWidth={1.75} className={c.travaille ? "stroke-bleu-k1-500" : c.pointille ? "stroke-bordure-forte" : "stroke-texte-tertiaire"} strokeDasharray={c.pointille ? "4 4" : undefined} />)}</svg>
      {places.map((c) => <div key={c.id} ref={(el) => { if (el) elements.current.set(c.id, el); else elements.current.delete(c.id); }} data-carte-mesuree={c.id} className="absolute left-0 w-[320px]" style={{ top: c.y }}>{c.contenu}</div>)}
      <div ref={carteAgent} data-carte-mesuree="agent" className="absolute left-[480px] w-[280px]" style={{ top: agentY }}>{agent}</div>
    </div>}
    {focus && <span aria-hidden="true" className="pointer-events-none absolute z-20 rounded-xs border-2 border-focus" style={{ left: focus.x - 2, top: focus.y - 2, width: focus.w + 4, height: focus.h + 4 }} />}
    <div className="absolute bottom-4 left-4 z-20 flex items-center gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-sm"><BoutonOutil icone="zoom-out" libelle="Zoom arrière" raccourci="−" onClick={() => zoomer(cam.z - 0.1)} /><button ref={boutonMenu} type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className="h-8 cursor-pointer rounded-sm border-0 bg-transparent px-2 text-ui-xs text-texte-principal hover:bg-fond-survol">{Math.round(cam.z * 100)} %</button><BoutonOutil icone="zoom-in" libelle="Zoom avant" raccourci="+" onClick={() => zoomer(cam.z + 0.1)} />
      {menu && <div ref={menuRef} role="menu" aria-label="Zoom" className="absolute bottom-full left-0 mb-2 w-56 rounded-lg border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-md" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMenu(false); boutonMenu.current?.focus(); } if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) { e.preventDefault(); const boutons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button")); const i = boutons.indexOf(document.activeElement as HTMLButtonElement); boutons[e.key === "Home" ? 0 : e.key === "End" ? boutons.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + boutons.length) % boutons.length]?.focus(); } }}>{[{ nom: "Zoom avant", touche: "+" }, { nom: "Zoom arrière", touche: "−" }, { nom: "Zoom à 100 %", touche: "0" }, { nom: "Ajuster à l’écran", touche: "⇧1" }].map((a, i) => <button key={a.nom} type="button" role="menuitem" onClick={() => { if (i === 3) ajuster(); else zoomer(i === 2 ? 1 : cam.z + (i === 0 ? 0.1 : -0.1)); setMenu(false); boutonMenu.current?.focus(); }} className="flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-ui-s text-texte-principal hover:bg-fond-survol"><span className="flex-1">{a.nom}</span><span className="text-ui-2xs text-texte-secondaire">{raccourciDuSysteme(a.touche)}</span></button>)}</div>}
    </div>
  </section>;
}
