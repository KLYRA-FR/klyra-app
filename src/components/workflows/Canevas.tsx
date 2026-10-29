"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";
import { raccourciDuSysteme } from "@/lib/plateforme";
import { portDe, texteSortie } from "@/lib/workflows/moteur";
import type { Frequence, RoleTeinte } from "@/types/domain";
import {
  estEtape,
  liensBoucle,
  problemeLien,
  type Branche,
  type EtapeWorkflow,
  type Graphe,
  type Noeud,
  type Point,
  type Trait,
  type TypeNoeud,
  type Valeur,
  type Workflow,
} from "@/types/workflows";
import { ANCRE_NON, ANCRE_PORT, ENCRES, FICHES, FORMES, GROUPES, largeurNoeud, nomNoeud, nouveauNoeud, TEINTES } from "./catalogue";
import { NoeudVue } from "./NoeudVue";

/**
 * Le canevas d'un workflow : on s'y déplace (glisser le fond avec la main, ou
 * la molette), on zoome (⌘ + molette, ou le menu), on pose des nœuds, on les
 * relie en tirant depuis leur sortie, on dessine, on cherche. Tout changement
 * du graphe passe par `changer` (et donc par l'historique Annuler/Rétablir).
 */

type Outil = "selection" | "main" | "stylo" | "marqueur" | "gomme" | "note" | "forme" | "texte";
type Camera = { x: number; y: number; z: number };

type Interaction =
  | { type: "pan"; px: number; py: number; cam: Camera }
  | { type: "cadre"; depart: Point; point: Point; garder: Set<string> }
  | { type: "deplacer"; px: number; py: number; departs: Map<string, Point>; cle: string; bouge: boolean }
  | { type: "lien"; de: string; branche?: Branche; point: Point }
  | { type: "trait"; trait: Trait }
  | { type: "gomme" }
  | { type: "redim"; id: string; px: number; py: number; l: number; h: number; cle: string };

type MenuContexte =
  | { x: number; y: number; cible: { type: "noeud"; id: string } }
  | { x: number; y: number; cible: { type: "lien"; id: string } }
  | { x: number; y: number; cible: { type: "canevas"; monde: Point } };

type MenuAjout = { x: number; y: number; monde: Point; depuis?: { de: string; branche?: Branche }; inserer?: string; seulement?: TypeNoeud[] };

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2;
const HAUTEUR_ESTIMEE = 180;

export interface ProprietesCanevas {
  wf: Workflow;
  graphe: Graphe;
  lecture: boolean;
  changer: (fn: (g: Graphe) => Graphe, fusion?: string) => void;
  annuler: () => void;
  retablir: () => void;
  /** Le résultat à montrer sur un nœud, et la navigation entre ses résultats. */
  resultatDe: (noeudId: string) => { etape: EtapeWorkflow | null; rang: number; total: number; aller: (sens: number) => void };
  lancer: (o: { declencheurId?: string | null; seule?: string }) => void;
  decider: (etapeId: string, approuver: boolean) => void;
  creerWebhook: (noeudId: string) => void;
  adresses: Record<string, string>;
  auteur: string;
  /** Les sorties cherchables (recherche dans les résultats). */
  sorties: EtapeWorkflow[];
}

/* Un champ ou une liste déroulante a le focus : le clavier est à lui, pas aux raccourcis du canevas. */
const estChamp = (cible: EventTarget | null) =>
  cible instanceof HTMLElement &&
  (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.tagName === "SELECT" || cible.role === "combobox" || cible.isContentEditable);

/** La courbe d'un lien, d'une sortie vers une entrée. */
function courbe(a: Point, b: Point): string {
  const c = Math.max(48, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + c} ${a.y}, ${b.x - c} ${b.y}, ${b.x} ${b.y}`;
}

function cheminTrait(points: Point[]): string {
  if (!points.length) return "";
  return points.map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

/* ─── Petits boutons de la barre d'outils ──────────────────────── */

function BoutonOutil({ icone, libelle, actif, onClick, raccourci }: { icone: IconName; libelle: string; actif?: boolean; onClick: () => void; raccourci?: string }) {
  return (
    <button
      type="button"
      aria-label={libelle}
      aria-pressed={actif}
      title={raccourci ? `${libelle} (${raccourciDuSysteme(raccourci)})` : libelle}
      onClick={onClick}
      className={cn(
        "flex size-8 cursor-pointer items-center justify-center rounded-sm border-0 transition-colors duration-[120ms] ease-sortie",
        actif ? "bg-fond-inverse text-texte-inverse" : "bg-transparent text-icone-secondaire hover:bg-fond-survol hover:text-texte-principal",
      )}
    >
      <Icon name={icone} size={16} />
    </button>
  );
}

function Pastille({ couleur, actif, libelle, onClick }: { couleur: string; actif: boolean; libelle: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={libelle}
      title={libelle}
      aria-pressed={actif}
      onClick={onClick}
      className={cn("size-5 cursor-pointer rounded-full border-2", actif ? "border-bleu-k1-500" : "border-fond-surface")}
      style={{ background: couleur, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.08)" }}
    />
  );
}

/** Un menu flottant (contexte, ajout) : une liste d'actions. */
function ElementMenu({ libelle, icone, onClick, raccourci, desactive }: { libelle: string; icone?: IconName; onClick: () => void; raccourci?: string; desactive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={desactive}
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-ui-s text-texte-principal hover:bg-fond-survol disabled:cursor-default disabled:opacity-50"
    >
      {icone && <Icon name={icone} size={16} className="shrink-0 text-icone-secondaire" />}
      <span className="flex-1">{libelle}</span>
      {raccourci && <span className="text-ui-2xs text-texte-tertiaire">{raccourciDuSysteme(raccourci)}</span>}
    </button>
  );
}

/* ─── Le canevas ───────────────────────────────────────────────── */

export function Canevas(p: ProprietesCanevas) {
  const { graphe, lecture, changer } = p;
  const vue = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Camera>({ x: 80, y: 80, z: 1 });
  const camRef = useRef(cam);
  const [taille, setTaille] = useState({ l: 1000, h: 600 });
  const [outil, setOutil] = useState<Outil>("selection");
  const [encre, setEncre] = useState(ENCRES[0].valeur);
  const [teinteNote, setTeinteNote] = useState("jaune");
  const [forme, setForme] = useState("rectangle");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lienChoisi, setLienChoisi] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const action = useRef<Interaction | null>(null);
  const [cibleLien, setCibleLien] = useState<{ id: string; ok: boolean } | null>(null);
  const [menu, setMenu] = useState<MenuContexte | null>(null);
  const [ajout, setAjout] = useState<MenuAjout | null>(null);
  const [recherche, setRecherche] = useState<string | null>(null);
  const [minicarte, setMinicarte] = useState(false);
  const [interfaceVisible, setInterfaceVisible] = useState(true);
  const [menuZoom, setMenuZoom] = useState(false);
  const [sousMenu, setSousMenu] = useState<"dessin" | "note" | "forme" | null>(null);
  const [annonce, setAnnonce] = useState<string | null>(null);
  const [annulable, setAnnulable] = useState<{ texte: string } | null>(null);
  const presse = useRef<Graphe | null>(null);
  const [aPresse, setAPresse] = useState(false);
  const espace = useRef(false);

  const parId = useMemo(() => new Map(graphe.noeuds.map((n) => [n.id, n])), [graphe.noeuds]);
  const boucles = useMemo(() => liensBoucle(graphe.noeuds.filter((n) => estEtape(n.type)), graphe.liens), [graphe]);

  const majCam = (c: Camera) => {
    camRef.current = c;
    setCam(c);
  };
  const versMonde = (cx: number, cy: number): Point => {
    const r = vue.current?.getBoundingClientRect();
    const c = camRef.current;
    return { x: (cx - (r?.left ?? 0) - c.x) / c.z, y: (cy - (r?.top ?? 0) - c.y) / c.z };
  };
  const zoomerA = (z: number, ecran?: { x: number; y: number }) => {
    const c = camRef.current;
    const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const pt = ecran ?? { x: taille.l / 2, y: taille.h / 2 };
    majCam({ z: nz, x: pt.x - ((pt.x - c.x) / c.z) * nz, y: pt.y - ((pt.y - c.y) / c.z) * nz });
  };
  const bornes = (noeuds: Noeud[]) => {
    if (!noeuds.length) return null;
    const xs = noeuds.map((n) => n.at.x);
    const ys = noeuds.map((n) => n.at.y);
    const x2 = noeuds.map((n) => n.at.x + largeurNoeud(n));
    const y2 = noeuds.map((n) => n.at.y + (n.taille?.h ?? HAUTEUR_ESTIMEE));
    return { x: Math.min(...xs), y: Math.min(...ys), l: Math.max(...x2) - Math.min(...xs), h: Math.max(...y2) - Math.min(...ys) };
  };
  const ajuster = () => {
    const b = bornes(graphe.noeuds);
    if (!b) return majCam({ x: 80, y: 80, z: 1 });
    const z = Math.min(1, Math.max(ZOOM_MIN, Math.min((taille.l - 160) / b.l, (taille.h - 200) / b.h)));
    majCam({ z, x: (taille.l - b.l * z) / 2 - b.x * z, y: (taille.h - b.h * z) / 2 - b.y * z });
  };
  const centrerSur = (n: Noeud) => {
    const c = camRef.current;
    majCam({ ...c, x: taille.l / 2 - (n.at.x + largeurNoeud(n) / 2) * c.z, y: taille.h / 3 - n.at.y * c.z });
  };

  const dire = (texte: string) => {
    setAnnonce(texte);
    setTimeout(() => setAnnonce((a) => (a === texte ? null : a)), 2600);
  };

  /* Taille de la zone, et molette (non passive : on empêche le zoom de la page). */
  useEffect(() => {
    const el = vue.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTaille({ l: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    const molette = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("textarea, [data-defile]")) return;
      e.preventDefault();
      const c = camRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.z * Math.exp(-e.deltaY * 0.0025)));
        const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
        const suite = { z: nz, x: pt.x - ((pt.x - c.x) / c.z) * nz, y: pt.y - ((pt.y - c.y) / c.z) * nz };
        camRef.current = suite;
        setCam(suite);
      } else {
        const suite = { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY };
        camRef.current = suite;
        setCam(suite);
      }
    };
    el.addEventListener("wheel", molette, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", molette);
    };
  }, []);

  /* ─── Les changements du graphe ──────────────────────────────── */

  const majNoeud = (id: string, fn: (n: Noeud) => Noeud, fusion?: string) =>
    changer((g) => ({ ...g, noeuds: g.noeuds.map((n) => (n.id === id ? fn(n) : n)) }), fusion);

  const ajouterNoeud = (type: TypeNoeud, monde: Point, depuis?: MenuAjout["depuis"], inserer?: string) => {
    const n = nouveauNoeud(type, { x: monde.x, y: monde.y }, p.auteur);
    changer((g) => {
      let liens = g.liens;
      if (depuis) {
        const de = g.noeuds.find((x) => x.id === depuis.de);
        if (de && !problemeLien(de, n, liens, depuis.branche))
          liens = [...liens, { id: crypto.randomUUID(), de: de.id, vers: n.id, port: portDe(de), ...(depuis.branche ? { branche: depuis.branche } : {}) }];
      }
      if (inserer) {
        const l = g.liens.find((x) => x.id === inserer);
        const de = l && g.noeuds.find((x) => x.id === l.de);
        const vers = l && g.noeuds.find((x) => x.id === l.vers);
        if (l && de && vers && !problemeLien(de, n, [], l.branche) && !problemeLien(n, vers, [])) {
          liens = [
            ...liens.filter((x) => x.id !== l.id),
            { id: crypto.randomUUID(), de: de.id, vers: n.id, port: l.port, ...(l.branche ? { branche: l.branche } : {}) },
            { id: crypto.randomUUID(), de: n.id, vers: vers.id, port: portDe(n) },
          ];
          dire("Nœud ajouté dans la connexion.");
        }
      }
      return { ...g, noeuds: [...g.noeuds, n], liens };
    });
    setSelection(new Set([n.id]));
    setLienChoisi(null);
  };

  const supprimer = (ids: Set<string>, lien?: string | null) => {
    const bloques = graphe.noeuds.filter((n) => ids.has(n.id) && n.verrouille).map((n) => n.id);
    const cibles = new Set([...ids].filter((id) => !bloques.includes(id)));
    if (!cibles.size && !lien) return;
    const noms = graphe.noeuds.filter((n) => cibles.has(n.id)).map(nomNoeud);
    changer((g) => ({
      ...g,
      noeuds: g.noeuds.filter((n) => !cibles.has(n.id)),
      liens: g.liens.filter((l) => !cibles.has(l.de) && !cibles.has(l.vers) && l.id !== lien),
    }));
    setSelection(new Set());
    setLienChoisi(null);
    if (noms.length) {
      const texte = noms.length === 1 ? `${noms[0]} supprimé` : `${noms.length} nœuds supprimés`;
      setAnnulable({ texte });
      setTimeout(() => setAnnulable((a) => (a?.texte === texte ? null : a)), 5000);
    } else if (lien) dire("Connexion supprimée.");
  };

  const copier = () => {
    const noeuds = graphe.noeuds.filter((n) => selection.has(n.id));
    if (!noeuds.length) return;
    presse.current = { noeuds, liens: graphe.liens.filter((l) => selection.has(l.de) && selection.has(l.vers)), traits: [] };
    setAPresse(true);
  };
  const coller = (monde?: Point) => {
    const c = presse.current;
    if (!c || lecture) return;
    const b = bornes(c.noeuds)!;
    const dx = monde ? monde.x - b.x : 32;
    const dy = monde ? monde.y - b.y : 32;
    const ids = new Map(c.noeuds.map((n) => [n.id, crypto.randomUUID()]));
    const noeuds = c.noeuds.map((n) => ({ ...n, id: ids.get(n.id)!, at: { x: n.at.x + dx, y: n.at.y + dy }, verrouille: false }));
    const liens = c.liens.map((l) => ({ ...l, id: crypto.randomUUID(), de: ids.get(l.de)!, vers: ids.get(l.vers)! }));
    changer((g) => ({ ...g, noeuds: [...g.noeuds, ...noeuds], liens: [...g.liens, ...liens] }));
    setSelection(new Set(noeuds.map((n) => n.id)));
    presse.current = { noeuds: noeuds, liens, traits: [] };
  };
  const dupliquer = () => {
    copier();
    coller();
  };
  const verrouiller = (ids: string[], v: boolean) =>
    changer((g) => ({ ...g, noeuds: g.noeuds.map((n) => (ids.includes(n.id) ? { ...n, verrouille: v } : n)) }));
  const empiler = (id: string, devant: boolean) =>
    changer((g) => {
      const n = g.noeuds.find((x) => x.id === id);
      if (!n) return g;
      const reste = g.noeuds.filter((x) => x.id !== id);
      return { ...g, noeuds: devant ? [...reste, n] : [n, ...reste] };
    });

  /* ─── Le clavier ─────────────────────────────────────────────── */

  const clavier = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    clavier.current = (e: KeyboardEvent) => {
      if (estChamp(e.target)) return;
      const cmd = e.metaKey || e.ctrlKey;
      if (e.key === " ") espace.current = e.type === "keydown";
      if (e.type !== "keydown") return;
      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) p.retablir();
        else p.annuler();
      } else if (cmd && e.key.toLowerCase() === "y") {
        e.preventDefault();
        p.retablir();
      } else if (cmd && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setRecherche("");
      } else if (cmd && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(new Set(graphe.noeuds.map((n) => n.id)));
      } else if (cmd && e.key.toLowerCase() === "c") copier();
      else if (cmd && e.key.toLowerCase() === "v") coller();
      else if (cmd && e.key.toLowerCase() === "d") {
        e.preventDefault();
        dupliquer();
      } else if (cmd && e.key === ".") setInterfaceVisible((v) => !v);
      else if ((e.key === "Delete" || e.key === "Backspace") && !lecture) supprimer(selection, lienChoisi);
      else if (e.key === "Escape") {
        setSelection(new Set());
        setLienChoisi(null);
        setMenu(null);
        setAjout(null);
        setOutil("selection");
      } else if (!cmd && !lecture) {
        const k = e.key.toLowerCase();
        if (k === "v") setOutil("selection");
        else if (k === "h") setOutil("main");
        else if (k === "p") setOutil("stylo");
        else if (k === "m") setOutil("marqueur");
        else if (k === "e") setOutil("gomme");
        else if (k === "n") setOutil("note");
        else if (k === "s") setOutil("forme");
        else if (k === "t") setOutil("texte");
        else if (k === "a") setAjout({ x: taille.l / 2 - 140, y: taille.h / 2 - 160, monde: versMonde(taille.l / 2, taille.h / 2) });
        else if (e.key === "+" || e.key === "=") zoomerA(camRef.current.z * 1.2);
        else if (e.key === "-") zoomerA(camRef.current.z / 1.2);
        else if (e.key === "0") zoomerA(1);
        else if (e.key === "!" || (e.shiftKey && e.key === "1")) ajuster();
      }
    };
  });
  useEffect(() => {
    const f = (e: KeyboardEvent) => clavier.current(e);
    window.addEventListener("keydown", f);
    window.addEventListener("keyup", f);
    return () => {
      window.removeEventListener("keydown", f);
      window.removeEventListener("keyup", f);
    };
  }, []);

  /* ─── La souris ──────────────────────────────────────────────── */

  const commencer = (i: Interaction) => {
    action.current = i;
    setInteraction(i);
  };
  const gommer = (m: Point) => {
    const r = 10 / camRef.current.z;
    const touches = graphe.traits.filter((t) => t.points.some((q) => Math.hypot(q.x - m.x, q.y - m.y) < r + t.epaisseur));
    if (touches.length) changer((g) => ({ ...g, traits: g.traits.filter((t) => !touches.some((x) => x.id === t.id)) }), "gomme");
  };

  const surFond = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return;
    setMenu(null);
    setMenuZoom(false);
    setSousMenu(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = versMonde(e.clientX, e.clientY);
    if (outil === "main" || espace.current || e.button === 1 || lecture) {
      commencer({ type: "pan", px: e.clientX, py: e.clientY, cam: camRef.current });
      return;
    }
    if (outil === "stylo" || outil === "marqueur") {
      commencer({
        type: "trait",
        trait: { id: crypto.randomUUID(), outil, teinte: encre, epaisseur: outil === "marqueur" ? 14 : 3, points: [m] },
      });
      return;
    }
    if (outil === "gomme") {
      gommer(m);
      commencer({ type: "gomme" });
      return;
    }
    if (outil === "note" || outil === "forme" || outil === "texte") {
      const type = outil;
      const n = nouveauNoeud(type, m, p.auteur);
      if (type === "note") n.champs.teinte = teinteNote;
      if (type === "forme") n.champs.forme = forme;
      changer((g) => ({ ...g, noeuds: [...g.noeuds, n] }));
      setSelection(new Set([n.id]));
      setOutil("selection");
      return;
    }
    setLienChoisi(null);
    commencer({ type: "cadre", depart: m, point: m, garder: e.shiftKey ? new Set(selection) : new Set() });
    if (!e.shiftKey) setSelection(new Set());
  };

  const prendreNoeud = (n: Noeud, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (outil !== "selection" || espace.current || lecture) return;
    e.stopPropagation();
    setMenu(null);
    setLienChoisi(null);
    let sel = selection;
    if (e.shiftKey) {
      sel = new Set(selection);
      if (sel.has(n.id)) sel.delete(n.id);
      else sel.add(n.id);
    } else if (!selection.has(n.id)) sel = new Set([n.id]);
    setSelection(sel);
    vue.current?.setPointerCapture(e.pointerId);
    const departs = new Map(graphe.noeuds.filter((x) => sel.has(x.id) && !x.verrouille).map((x) => [x.id, x.at]));
    commencer({ type: "deplacer", px: e.clientX, py: e.clientY, departs, cle: `deplacer:${crypto.randomUUID()}`, bouge: false });
  };

  const tirerLien = (n: Noeud, e: ReactPointerEvent<HTMLElement>, branche?: Branche) => {
    if (lecture) return;
    e.stopPropagation();
    vue.current?.setPointerCapture(e.pointerId);
    commencer({ type: "lien", de: n.id, branche, point: versMonde(e.clientX, e.clientY) });
  };

  const redimensionner = (n: Noeud, e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    vue.current?.setPointerCapture(e.pointerId);
    commencer({
      type: "redim",
      id: n.id,
      px: e.clientX,
      py: e.clientY,
      l: largeurNoeud(n),
      h: n.taille?.h ?? FICHES[n.type].hauteur ?? 40,
      cle: `redim:${crypto.randomUUID()}`,
    });
  };

  const bouger = (e: ReactPointerEvent<HTMLDivElement>) => {
    const i = action.current;
    if (!i) return;
    const z = camRef.current.z;
    if (i.type === "pan") {
      majCam({ ...i.cam, x: i.cam.x + e.clientX - i.px, y: i.cam.y + e.clientY - i.py });
    } else if (i.type === "cadre") {
      const suite = { ...i, point: versMonde(e.clientX, e.clientY) };
      action.current = suite;
      setInteraction(suite);
      const x1 = Math.min(suite.depart.x, suite.point.x);
      const y1 = Math.min(suite.depart.y, suite.point.y);
      const x2 = Math.max(suite.depart.x, suite.point.x);
      const y2 = Math.max(suite.depart.y, suite.point.y);
      const dedans = graphe.noeuds.filter((n) => n.at.x < x2 && n.at.x + largeurNoeud(n) > x1 && n.at.y < y2 && n.at.y + (n.taille?.h ?? 120) > y1);
      setSelection(new Set([...i.garder, ...dedans.map((n) => n.id)]));
    } else if (i.type === "deplacer") {
      const dx = (e.clientX - i.px) / z;
      const dy = (e.clientY - i.py) / z;
      if (!i.bouge && Math.hypot(dx, dy) < 3) return;
      i.bouge = true;
      changer(
        (g) => ({
          ...g,
          noeuds: g.noeuds.map((n) => {
            const d = i.departs.get(n.id);
            return d ? { ...n, at: { x: Math.round(d.x + dx), y: Math.round(d.y + dy) } } : n;
          }),
        }),
        i.cle,
      );
    } else if (i.type === "lien") {
      const suite = { ...i, point: versMonde(e.clientX, e.clientY) };
      action.current = suite;
      setInteraction(suite);
      const sous = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-noeud]")?.getAttribute("data-noeud");
      const de = parId.get(i.de);
      const vers = sous ? parId.get(sous) : undefined;
      setCibleLien(de && vers && vers.id !== de.id ? { id: vers.id, ok: !problemeLien(de, vers, graphe.liens, i.branche) } : null);
    } else if (i.type === "trait") {
      const m = versMonde(e.clientX, e.clientY);
      const der = i.trait.points.at(-1)!;
      if (Math.hypot(m.x - der.x, m.y - der.y) < 2 / z) return;
      const suite = { ...i, trait: { ...i.trait, points: [...i.trait.points, m] } };
      action.current = suite;
      setInteraction(suite);
    } else if (i.type === "gomme") {
      gommer(versMonde(e.clientX, e.clientY));
    } else if (i.type === "redim") {
      const l = Math.max(60, Math.round(i.l + (e.clientX - i.px) / z));
      const h = Math.max(32, Math.round(i.h + (e.clientY - i.py) / z));
      majNoeud(i.id, (n) => ({ ...n, taille: { ...n.taille, l, h } }), i.cle);
    }
  };

  const lacher = (e: ReactPointerEvent<HTMLDivElement>) => {
    const i = action.current;
    action.current = null;
    setInteraction(null);
    setCibleLien(null);
    if (!i) return;
    if (i.type === "trait" && i.trait.points.length > 1) changer((g) => ({ ...g, traits: [...g.traits, i.trait] }));
    if (i.type === "lien") {
      const sous = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-noeud]")?.getAttribute("data-noeud");
      const de = parId.get(i.de);
      if (!de) return;
      if (sous && sous !== de.id) {
        const vers = parId.get(sous)!;
        const pb = problemeLien(de, vers, graphe.liens, i.branche);
        if (pb) return dire(`${pb}.`);
        const boucle = liensBoucle(
          graphe.noeuds.filter((n) => estEtape(n.type)),
          [...graphe.liens, { id: "nouveau", de: de.id, vers: vers.id, port: portDe(de) }],
        ).has("nouveau");
        changer((g) => ({
          ...g,
          liens: [...g.liens, { id: crypto.randomUUID(), de: de.id, vers: vers.id, port: portDe(de), ...(i.branche ? { branche: i.branche } : {}) }],
        }));
        dire(`${nomNoeud(de)} relié à ${nomNoeud(vers)}.${boucle ? " Cela crée une boucle." : ""}`);
      } else if (!sous) {
        /* Lâché dans le vide : on ajoute un nœud déjà relié. */
        const r = vue.current!.getBoundingClientRect();
        setAjout({ x: e.clientX - r.left, y: e.clientY - r.top, monde: versMonde(e.clientX, e.clientY), depuis: { de: de.id, branche: i.branche } });
      }
    }
  };

  const contexte = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const r = vue.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const t = e.target as HTMLElement;
    const noeud = t.closest("[data-noeud]")?.getAttribute("data-noeud");
    const lien = t.closest("[data-lien]")?.getAttribute("data-lien");
    if (noeud) {
      if (!selection.has(noeud)) setSelection(new Set([noeud]));
      setMenu({ x, y, cible: { type: "noeud", id: noeud } });
    } else if (lien) {
      setLienChoisi(lien);
      setMenu({ x, y, cible: { type: "lien", id: lien } });
    } else setMenu({ x, y, cible: { type: "canevas", monde: versMonde(e.clientX, e.clientY) } });
  };

  /* ─── Le dessin ──────────────────────────────────────────────── */

  const sortieDe = (n: Noeud, branche?: Branche): Point => ({ x: n.at.x + largeurNoeud(n), y: n.at.y + (branche === "non" ? ANCRE_NON : ANCRE_PORT) });
  const entreeDe = (n: Noeud): Point => ({ x: n.at.x, y: n.at.y + ANCRE_PORT });

  const traits = interaction?.type === "trait" ? [...graphe.traits, interaction.trait] : graphe.traits;
  const etapes = graphe.noeuds.filter((n) => estEtape(n.type));
  const annotations = graphe.noeuds.filter((n) => !estEtape(n.type));
  const choisi = selection.size === 1 ? parId.get([...selection][0]) : undefined;

  const resultatsRecherche = useMemo(() => {
    const q = (recherche ?? "").trim().toLowerCase();
    if (!q) return [];
    return graphe.noeuds.filter((n) => {
      const textes = [nomNoeud(n), ...Object.values(n.champs).filter((v): v is string => typeof v === "string")];
      const sorties = p.sorties.filter((s) => s.noeudId === n.id).map(texteSortie);
      return [...textes, ...sorties].some((t) => t.toLowerCase().includes(q));
    });
  }, [recherche, graphe.noeuds, p.sorties]);

  const fiches = Object.values(FICHES);
  const [filtreAjout, setFiltreAjout] = useState("");

  const curseur =
    interaction?.type === "pan"
      ? "cursor-grabbing"
      : outil === "main"
        ? "cursor-grab"
        : outil === "stylo" || outil === "marqueur" || outil === "gomme" || outil === "note" || outil === "forme" || outil === "texte"
          ? "cursor-crosshair"
          : "cursor-default";

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={vue}
        role="application"
        aria-label={`Canevas du workflow : ${p.wf.titre}`}
        onPointerDown={surFond}
        onPointerMove={bouger}
        onPointerUp={lacher}
        onPointerCancel={lacher}
        onContextMenu={contexte}
        onDoubleClick={(e) => {
          if (lecture || (e.target as HTMLElement).closest("[data-noeud]")) return;
          const r = vue.current!.getBoundingClientRect();
          setAjout({ x: e.clientX - r.left, y: e.clientY - r.top, monde: versMonde(e.clientX, e.clientY) });
        }}
        className={cn("absolute inset-0 touch-none select-none", curseur)}
        style={{
          backgroundColor: "var(--color-fond-page)",
          backgroundImage: "radial-gradient(var(--color-bordure-forte) 1px, transparent 1px)",
          backgroundSize: `${20 * cam.z}px ${20 * cam.z}px`,
          backgroundPosition: `${cam.x}px ${cam.y}px`,
        }}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
          {/* Les annotations sous tout le reste. */}
          {annotations.map((n) => (
            <div key={n.id} className="absolute" style={{ left: n.at.x, top: n.at.y }}>
              <NoeudVue
                noeud={n}
                wf={p.wf}
                choisi={selection.has(n.id)}
                lecture={lecture || !!n.verrouille}
                etape={null}
                resultats={null}
                cible={null}
                onChamps={(patch: Record<string, Valeur>, fusion?: string) => majNoeud(n.id, (x) => ({ ...x, champs: { ...x.champs, ...patch } }), fusion)}
                onFrequence={() => {}}
                onPrise={(e) => prendreNoeud(n, e)}
                onLienDepuis={() => {}}
                onRedim={(e) => redimensionner(n, e)}
                onLancer={() => {}}
                onDecider={() => {}}
                onWebhook={() => {}}
                adresseWebhook={null}
              />
            </div>
          ))}

          {/* Les traits à main levée. */}
          <svg aria-hidden="true" className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
            {traits.map((t) => (
              <path
                key={t.id}
                d={cheminTrait(t.points)}
                fill="none"
                stroke={t.teinte}
                strokeWidth={t.epaisseur}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={t.outil === "marqueur" ? 0.35 : 1}
              />
            ))}
          </svg>

          {/* Les liens. */}
          <svg className="absolute top-0 left-0 overflow-visible" width={1} height={1}>
            <defs>
              <marker id="wf-fleche" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" className="fill-texte-tertiaire" />
              </marker>
              <marker id="wf-fleche-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" className="fill-bleu-k1-500" />
              </marker>
            </defs>
            {graphe.liens.map((l) => {
              const de = parId.get(l.de);
              const vers = parId.get(l.vers);
              if (!de || !vers) return null;
              const a = sortieDe(de, l.branche);
              const b = entreeDe(vers);
              const actif = lienChoisi === l.id;
              const boucle = boucles.has(l.id);
              const d = courbe(a, b);
              return (
                <g key={l.id} data-lien={l.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    className="cursor-pointer"
                    style={{ pointerEvents: "stroke" }}
                    onPointerDown={(e) => {
                      if (lecture) return;
                      e.stopPropagation();
                      setLienChoisi(l.id);
                      setSelection(new Set());
                    }}
                  />
                  <path
                    d={d}
                    fill="none"
                    strokeWidth={actif ? 2.5 : 1.75}
                    strokeDasharray={boucle ? "6 5" : undefined}
                    className={cn("pointer-events-none", actif ? "stroke-bleu-k1-500" : "stroke-texte-tertiaire")}
                    markerEnd={actif ? "url(#wf-fleche-active)" : "url(#wf-fleche)"}
                  />
                  {boucle && (
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} textAnchor="middle" className="pointer-events-none fill-texte-tertiaire text-[11px] font-medium">
                      Boucle
                    </text>
                  )}
                </g>
              );
            })}
            {interaction?.type === "lien" && parId.get(interaction.de) && (
              <path
                d={courbe(sortieDe(parId.get(interaction.de)!, interaction.branche), interaction.point)}
                fill="none"
                strokeWidth={1.75}
                strokeDasharray="4 4"
                className={cibleLien && !cibleLien.ok ? "stroke-texte-erreur" : "stroke-bleu-k1-500"}
              />
            )}
          </svg>

          {/* Les étapes. */}
          {etapes.map((n) => {
            const r = p.resultatDe(n.id);
            return (
              <div key={n.id} className="absolute" style={{ left: n.at.x, top: n.at.y }}>
                <NoeudVue
                  noeud={n}
                  wf={p.wf}
                  choisi={selection.has(n.id)}
                  lecture={lecture || !!n.verrouille}
                  etape={r.etape}
                  resultats={r.total ? { rang: r.rang, total: r.total, precedent: () => r.aller(1), suivant: () => r.aller(-1) } : null}
                  cible={cibleLien?.id === n.id ? (cibleLien.ok ? "ok" : "refus") : null}
                  onChamps={(patch, fusion) => majNoeud(n.id, (x) => ({ ...x, champs: { ...x.champs, ...patch } }), fusion)}
                  onFrequence={(f: Frequence) => majNoeud(n.id, (x) => ({ ...x, frequence: f }))}
                  onPrise={(e) => prendreNoeud(n, e)}
                  onLienDepuis={(e, branche) => tirerLien(n, e, branche)}
                  onRedim={() => {}}
                  onLancer={() => (n.type === "declencheur" ? p.lancer({ declencheurId: n.id }) : p.lancer({ seule: n.id }))}
                  onDecider={(ok) => r.etape && p.decider(r.etape.id, ok)}
                  onWebhook={() => p.creerWebhook(n.id)}
                  adresseWebhook={p.adresses[n.id] ?? null}
                />
              </div>
            );
          })}

          {/* Le cadre de sélection. */}
          {interaction?.type === "cadre" && (
            <div
              className="pointer-events-none absolute rounded-2xs border border-bleu-k1-500 bg-bleu-k1-500/5"
              style={{
                left: Math.min(interaction.depart.x, interaction.point.x),
                top: Math.min(interaction.depart.y, interaction.point.y),
                width: Math.abs(interaction.point.x - interaction.depart.x),
                height: Math.abs(interaction.point.y - interaction.depart.y),
              }}
            />
          )}
        </div>

        {/* La barre d'un nœud choisi : dupliquer, verrouiller, supprimer. */}
        {choisi && !lecture && interaction?.type !== "deplacer" && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 flex items-center gap-0.5 rounded-md border border-bordure-subtile bg-fond-surface p-0.5 shadow-ombre-sm"
            style={{ left: choisi.at.x * cam.z + cam.x, top: choisi.at.y * cam.z + cam.y - 44 }}
          >
            {(choisi.type === "note" || choisi.type === "forme") &&
              TEINTES.map((t) => (
                <Pastille
                  key={t.id}
                  libelle={`Couleur : ${t.nom}`}
                  couleur={AGENT_PASTELS[t.id as RoleTeinte].haut}
                  actif={choisi.champs.teinte === t.id}
                  onClick={() => majNoeud(choisi.id, (n) => ({ ...n, champs: { ...n.champs, teinte: t.id } }))}
                />
              ))}
            {choisi.type === "forme" && (
              <ListeDeroulante
                variante="compact"
                libelle="Forme"
                value={String(choisi.champs.forme)}
                options={FORMES.map((f) => ({ value: f.id, label: f.nom }))}
                onChange={(forme) => majNoeud(choisi.id, (n) => ({ ...n, champs: { ...n.champs, forme } }))}
              />
            )}
            {choisi.type === "texte" && (
              <>
                <ListeDeroulante
                  variante="compact"
                  libelle="Taille du texte"
                  value={String(choisi.champs.corps || "corps")}
                  options={[
                    { value: "corps", label: "Corps" },
                    { value: "intertitre", label: "Intertitre" },
                    { value: "titre", label: "Titre" },
                  ]}
                  onChange={(corps) => majNoeud(choisi.id, (n) => ({ ...n, champs: { ...n.champs, corps } }))}
                />
                <ListeDeroulante
                  variante="compact"
                  libelle="Alignement"
                  value={String(choisi.champs.alignement || "gauche")}
                  options={[
                    { value: "gauche", label: "Gauche" },
                    { value: "centre", label: "Centre" },
                    { value: "droite", label: "Droite" },
                    { value: "justifie", label: "Justifié" },
                  ]}
                  onChange={(alignement) => majNoeud(choisi.id, (n) => ({ ...n, champs: { ...n.champs, alignement } }))}
                />
                <BoutonOutil icone="type-01" libelle="Gras" actif={!!choisi.champs.gras} onClick={() => majNoeud(choisi.id, (n) => ({ ...n, champs: { ...n.champs, gras: !n.champs.gras } }))} />
              </>
            )}
            {choisi.type === "note" && (
              <BoutonOutil
                icone="user-profile-01"
                libelle={choisi.champs.montrerAuteur === false ? "Afficher l’auteur" : "Masquer l’auteur"}
                actif={choisi.champs.montrerAuteur !== false}
                onClick={() => majNoeud(choisi.id, (n) => ({ ...n, champs: { ...n.champs, montrerAuteur: n.champs.montrerAuteur === false } }))}
              />
            )}
            <BoutonOutil icone="copy-left" libelle={`Dupliquer ${nomNoeud(choisi)}`} onClick={dupliquer} raccourci="⌘D" />
            <BoutonOutil
              icone={choisi.verrouille ? "lock-open-01" : "lock-01"}
              libelle={choisi.verrouille ? `Déverrouiller ${nomNoeud(choisi)}` : `Verrouiller ${nomNoeud(choisi)}`}
              onClick={() => verrouiller([choisi.id], !choisi.verrouille)}
            />
            {!choisi.verrouille && <BoutonOutil icone="trash-01" libelle={`Supprimer ${nomNoeud(choisi)}`} onClick={() => supprimer(new Set([choisi.id]))} raccourci="⌫" />}
          </div>
        )}
      </div>

      {/* Canevas vide. */}
      {!graphe.noeuds.length && !lecture && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-lg border border-bordure-subtile bg-fond-surface px-8 py-7 text-center shadow-ombre-sm">
            <span className="flex size-10 items-center justify-center rounded-md bg-fond-surface-grise text-icone-secondaire">
              <Icon name="lightning-01" size={20} />
            </span>
            <span className="text-ui font-semibold text-texte-principal">Commence par un déclencheur</span>
            <span className="max-w-[280px] text-ui-s text-texte-secondaire">Il lance le workflow : à la main, à heure fixe ou par un webhook. Relie-lui ensuite tes étapes.</span>
            <button
              type="button"
              onClick={() => ajouterNoeud("declencheur", versMonde((vue.current?.getBoundingClientRect().left ?? 0) + taille.l / 2 - 140, (vue.current?.getBoundingClientRect().top ?? 0) + taille.h / 2 - 80))}
              className="h-8 cursor-pointer rounded-sm border-0 bg-fond-inverse px-3 text-ui-s font-medium text-texte-inverse"
            >
              Ajouter un déclencheur
            </button>
          </div>
        </div>
      )}

      {/* ─── L'interface autour du canevas ─── */}
      {interfaceVisible && (
        <>
          {/* La barre d'outils, en bas au centre. */}
          {!lecture && (
            <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-md" role="toolbar" aria-label="Outils du canevas">
              <BoutonOutil icone="cursor-01" libelle="Sélection" raccourci="V" actif={outil === "selection"} onClick={() => setOutil("selection")} />
              <BoutonOutil icone="move" libelle="Déplacer" raccourci="H" actif={outil === "main"} onClick={() => setOutil("main")} />
              <span className="mx-1 h-5 w-px bg-bordure-subtile" />
              <div className="relative">
                <BoutonOutil
                  icone={outil === "marqueur" ? "marker-01" : outil === "gomme" ? "eraser-01" : "pencil-01"}
                  libelle="Dessin"
                  raccourci="P"
                  actif={outil === "stylo" || outil === "marqueur" || outil === "gomme"}
                  onClick={() => {
                    if (outil !== "stylo" && outil !== "marqueur" && outil !== "gomme") setOutil("stylo");
                    setSousMenu(sousMenu === "dessin" ? null : "dessin");
                  }}
                />
                {sousMenu === "dessin" && (
                  <div ref={apparition} className="absolute bottom-[calc(100%+10px)] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-md">
                    <BoutonOutil icone="pencil-01" libelle="Stylo" actif={outil === "stylo"} onClick={() => setOutil("stylo")} />
                    <BoutonOutil icone="marker-01" libelle="Marqueur" raccourci="M" actif={outil === "marqueur"} onClick={() => setOutil("marqueur")} />
                    <BoutonOutil icone="eraser-01" libelle="Gomme" raccourci="E" actif={outil === "gomme"} onClick={() => setOutil("gomme")} />
                    <span className="mx-0.5 h-5 w-px bg-bordure-subtile" />
                    {ENCRES.map((c) => (
                      <Pastille key={c.id} couleur={c.valeur} libelle={`Couleur : ${c.nom}`} actif={encre === c.valeur} onClick={() => setEncre(c.valeur)} />
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <BoutonOutil
                  icone="note-01"
                  libelle="Note adhésive"
                  raccourci="N"
                  actif={outil === "note"}
                  onClick={() => {
                    setOutil("note");
                    setSousMenu(sousMenu === "note" ? null : "note");
                  }}
                />
                {sousMenu === "note" && (
                  <div ref={apparition} className="absolute bottom-[calc(100%+10px)] left-1/2 flex -translate-x-1/2 gap-1 rounded-md border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-md">
                    {TEINTES.map((t) => (
                      <Pastille key={t.id} couleur={AGENT_PASTELS[t.id as RoleTeinte].haut} libelle={`Note : ${t.nom}`} actif={teinteNote === t.id} onClick={() => setTeinteNote(t.id)} />
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <BoutonOutil
                  icone={forme === "cercle" || forme === "ovale" ? "circle" : forme === "losange" ? "diamond" : forme.startsWith("triangle") ? "triangle" : forme === "etoile" ? "star-01" : "square"}
                  libelle="Formes"
                  raccourci="S"
                  actif={outil === "forme"}
                  onClick={() => {
                    setOutil("forme");
                    setSousMenu(sousMenu === "forme" ? null : "forme");
                  }}
                />
                {sousMenu === "forme" && (
                  <div ref={apparition} className="absolute bottom-[calc(100%+10px)] left-1/2 flex w-[180px] -translate-x-1/2 flex-col rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-md" role="menu">
                    {FORMES.map((f) => (
                      <ElementMenu
                        key={f.id}
                        libelle={f.nom}
                        onClick={() => {
                          setForme(f.id);
                          setOutil("forme");
                          setSousMenu(null);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <BoutonOutil icone="type-01" libelle="Texte" raccourci="T" actif={outil === "texte"} onClick={() => setOutil("texte")} />
              <span className="mx-1 h-5 w-px bg-bordure-subtile" />
              <button
                type="button"
                onClick={() => setAjout({ x: taille.l / 2 - 140, y: taille.h - 440, monde: versMonde((vue.current?.getBoundingClientRect().left ?? 0) + taille.l / 2 - 140, (vue.current?.getBoundingClientRect().top ?? 0) + taille.h / 2 - 100) })}
                title="Ajouter un nœud (A)"
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-fond-inverse px-3 text-ui-s font-medium text-texte-inverse"
              >
                <Icon name="plus-01" size={16} />
                Ajouter un nœud
              </button>
            </div>
          )}

          {/* Zoom et minicarte, en bas à gauche. */}
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-sm">
            <BoutonOutil icone="zoom-out" libelle="Zoom arrière" raccourci="-" onClick={() => zoomerA(cam.z / 1.2)} />
            <div className="relative">
              <button
                type="button"
                aria-label={`Zoom ${Math.round(cam.z * 100)} %`}
                onClick={() => setMenuZoom(!menuZoom)}
                className="h-8 min-w-14 cursor-pointer rounded-sm border-0 bg-transparent px-1.5 text-ui-xs font-medium text-texte-principal tabular-nums hover:bg-fond-survol"
              >
                {Math.round(cam.z * 100)} %
              </button>
              {menuZoom && (
                <div ref={apparition} role="menu" className="absolute bottom-[calc(100%+10px)] left-0 w-[200px] rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-md">
                  <ElementMenu libelle="Zoom avant" raccourci="+" onClick={() => zoomerA(cam.z * 1.2)} />
                  <ElementMenu libelle="Zoom arrière" raccourci="−" onClick={() => zoomerA(cam.z / 1.2)} />
                  <ElementMenu libelle="Zoom à 100 %" raccourci="0" onClick={() => zoomerA(1)} />
                  <ElementMenu
                    libelle="Ajuster à l’écran"
                    raccourci="⇧1"
                    onClick={() => {
                      ajuster();
                      setMenuZoom(false);
                    }}
                  />
                </div>
              )}
            </div>
            <BoutonOutil icone="zoom-in" libelle="Zoom avant" raccourci="+" onClick={() => zoomerA(cam.z * 1.2)} />
            <span className="mx-0.5 h-5 w-px bg-bordure-subtile" />
            <BoutonOutil icone="map-01" libelle={minicarte ? "Fermer la minicarte" : "Ouvrir la minicarte"} actif={minicarte} onClick={() => setMinicarte(!minicarte)} />
            <BoutonOutil icone="arrow-rotate-left-01" libelle="Annuler" raccourci="⌘Z" onClick={p.annuler} />
            <BoutonOutil icone="arrow-rotate-right-01" libelle="Rétablir" raccourci="⇧⌘Z" onClick={p.retablir} />
          </div>

          {/* La recherche, en haut à droite. */}
          <div className="absolute top-3 right-3 z-20">
            {recherche === null ? (
              <div className="flex gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-sm">
                <BoutonOutil icone="search-01" libelle="Rechercher" raccourci="⌘F" onClick={() => setRecherche("")} />
                <BoutonOutil icone="maximise-01" libelle="Masquer l’interface" raccourci="⌘." onClick={() => setInterfaceVisible(false)} />
              </div>
            ) : (
              <div ref={apparition} className="flex w-[300px] flex-col rounded-lg border border-bordure-subtile bg-fond-surface shadow-ombre-md" role="search" aria-label="Rechercher dans le canevas">
                <div className="flex items-center gap-2 border-b border-bordure-subtile px-3 py-2">
                  <Icon name="search-01" size={16} className="text-icone-secondaire" />
                  <input
                    autoFocus
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setRecherche(null)}
                    placeholder="Rechercher des étapes, prompts et résultats"
                    className="min-w-0 flex-1 border-0 bg-transparent text-ui-s text-texte-principal focus:outline-none"
                  />
                  <button type="button" aria-label="Fermer la recherche" onClick={() => setRecherche(null)} className="cursor-pointer border-0 bg-transparent p-0 text-icone-secondaire">
                    <Icon name="x-01" size={14} />
                  </button>
                </div>
                <div className="max-h-[300px] overflow-y-auto p-1" data-defile>
                  {!recherche.trim() ? (
                    <p className="m-0 px-2 py-2 text-ui-xs text-texte-tertiaire">Trouve une étape par son nom, son prompt ou son résultat.</p>
                  ) : resultatsRecherche.length === 0 ? (
                    <p className="m-0 px-2 py-2 text-ui-xs text-texte-tertiaire">Aucune étape ne correspond à « {recherche} ».</p>
                  ) : (
                    resultatsRecherche.map((n) => (
                      <ElementMenu
                        key={n.id}
                        icone={FICHES[n.type].icone}
                        libelle={nomNoeud(n)}
                        onClick={() => {
                          setSelection(new Set([n.id]));
                          centrerSur(n);
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* La minicarte. */}
          {minicarte && (
            <Minicarte
              noeuds={graphe.noeuds}
              cam={cam}
              taille={taille}
              onAller={(m) => majCam({ ...cam, x: taille.l / 2 - m.x * cam.z, y: taille.h / 2 - m.y * cam.z })}
            />
          )}
        </>
      )}
      {!interfaceVisible && (
        <button
          type="button"
          onClick={() => setInterfaceVisible(true)}
          className="absolute top-3 right-3 z-20 h-8 cursor-pointer rounded-sm border border-bordure-subtile bg-fond-surface px-3 text-ui-xs font-medium text-texte-principal shadow-ombre-sm"
        >
          Afficher l’interface
        </button>
      )}

      {/* Le menu d'ajout. */}
      {ajout && (
        <>
          <button type="button" aria-label="Fermer" className="absolute inset-0 z-30 cursor-default border-0 bg-transparent" onClick={() => setAjout(null)} />
          <div
            ref={apparition}
            role="menu"
            aria-label={ajout.depuis ? "Ajouter un nœud connecté" : "Ajouter un nœud"}
            className="absolute z-40 flex max-h-[420px] w-[300px] flex-col rounded-lg border border-bordure-subtile bg-fond-surface shadow-ombre-lg"
            style={{ left: Math.max(8, Math.min(ajout.x, taille.l - 308)), top: Math.max(8, Math.min(ajout.y, taille.h - 428)) }}
          >
            <div className="flex items-center gap-2 border-b border-bordure-subtile px-3 py-2">
              <Icon name="search-01" size={16} className="text-icone-secondaire" />
              <input
                autoFocus
                value={filtreAjout}
                onChange={(e) => setFiltreAjout(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setAjout(null)}
                placeholder="Rechercher des nœuds"
                className="min-w-0 flex-1 border-0 bg-transparent text-ui-s text-texte-principal focus:outline-none"
              />
            </div>
            <div className="overflow-y-auto p-1" data-defile>
              {GROUPES.map((gr) => {
                const de = ajout.depuis ? parId.get(ajout.depuis.de) : undefined;
                const liste = fiches.filter(
                  (f) =>
                    f.groupe === gr.id &&
                    (!filtreAjout.trim() || `${f.titre} ${f.aide}`.toLowerCase().includes(filtreAjout.trim().toLowerCase())) &&
                    (!de || !problemeLien(de, nouveauNoeud(f.type, { x: 0, y: 0 }), [], ajout.depuis?.branche)),
                );
                if (!liste.length) return null;
                return (
                  <div key={gr.id} className="flex flex-col">
                    <span className="px-2 pt-2 pb-1 text-ui-2xs font-medium text-texte-tertiaire">{gr.titre}</span>
                    {liste.map((f) => (
                      <button
                        key={f.type}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          ajouterNoeud(f.type, ajout.monde, ajout.depuis, ajout.inserer);
                          setAjout(null);
                          setFiltreAjout("");
                        }}
                        className="flex cursor-pointer items-start gap-2.5 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left hover:bg-fond-survol"
                      >
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-xs bg-fond-surface-grise text-icone-secondaire">
                          <Icon name={f.icone} size={14} />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-ui-s font-medium text-texte-principal">
                            {f.titre}
                            {f.bientot && <span className="ml-1.5 text-ui-2xs font-normal text-texte-tertiaire">bientôt</span>}
                          </span>
                          <span className="text-ui-2xs text-texte-tertiaire">{f.aide}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Le menu contextuel. */}
      {menu && (
        <>
          <button type="button" aria-label="Fermer" className="absolute inset-0 z-30 cursor-default border-0 bg-transparent" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            ref={apparition}
            role="menu"
            className="absolute z-40 w-[230px] rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-lg"
            style={{ left: Math.min(menu.x, taille.l - 238), top: Math.min(menu.y, taille.h - 320) }}
            onClick={() => setMenu(null)}
          >
            {menu.cible.type === "noeud" &&
              (() => {
                const n = parId.get((menu.cible as { id: string }).id);
                if (!n) return null;
                return (
                  <>
                    <span className="block px-2 pt-1 pb-1.5 text-ui-2xs font-medium text-texte-tertiaire">Nœud</span>
                    {estEtape(n.type) && <ElementMenu icone="play-01" libelle={n.type === "declencheur" ? "Lancer depuis ce déclencheur" : "Lancer l’étape"} onClick={() => p.lancer(n.type === "declencheur" ? { declencheurId: n.id } : { seule: n.id })} desactive={lecture} />}
                    <ElementMenu icone="copy-left" libelle="Copier" raccourci="⌘C" onClick={copier} />
                    <ElementMenu icone="copy-left" libelle="Dupliquer" raccourci="⌘D" onClick={dupliquer} desactive={lecture} />
                    <ElementMenu icone="layers-01" libelle="Premier plan" onClick={() => empiler(n.id, true)} desactive={lecture} />
                    <ElementMenu icone="layers-01" libelle="Arrière-plan" onClick={() => empiler(n.id, false)} desactive={lecture} />
                    {n.taille && FICHES[n.type].hauteur && (
                      <ElementMenu libelle="Réinitialiser la taille" onClick={() => majNoeud(n.id, (x) => ({ ...x, taille: { l: FICHES[x.type].largeur, h: FICHES[x.type].hauteur } }))} desactive={lecture} />
                    )}
                    <ElementMenu icone={n.verrouille ? "lock-open-01" : "lock-01"} libelle={n.verrouille ? "Déverrouiller" : "Verrouiller"} onClick={() => verrouiller([...selection], !n.verrouille)} desactive={lecture} />
                    <ElementMenu icone="trash-01" libelle="Supprimer" raccourci="⌫" onClick={() => supprimer(selection)} desactive={lecture || !!n.verrouille} />
                  </>
                );
              })()}
            {menu.cible.type === "lien" && (
              <>
                <span className="block px-2 pt-1 pb-1.5 text-ui-2xs font-medium text-texte-tertiaire">Connexion</span>
                <ElementMenu
                  icone="plus-01"
                  libelle="Ajouter un nœud dans la connexion"
                  desactive={lecture}
                  onClick={() => {
                    const l = graphe.liens.find((x) => x.id === (menu.cible as { id: string }).id);
                    const de = l && parId.get(l.de);
                    const vers = l && parId.get(l.vers);
                    if (!l || !de || !vers) return;
                    setAjout({ x: menu.x, y: menu.y, monde: { x: (de.at.x + largeurNoeud(de) + vers.at.x) / 2 - 140, y: (de.at.y + vers.at.y) / 2 + 60 }, inserer: l.id });
                  }}
                />
                <ElementMenu icone="trash-01" libelle="Supprimer la connexion" onClick={() => supprimer(new Set(), (menu.cible as { id: string }).id)} desactive={lecture} />
              </>
            )}
            {menu.cible.type === "canevas" && (
              <>
                <span className="block px-2 pt-1 pb-1.5 text-ui-2xs font-medium text-texte-tertiaire">Canevas</span>
                <ElementMenu
                  icone="plus-01"
                  libelle="Ajouter un nœud ici"
                  desactive={lecture}
                  onClick={() => setAjout({ x: menu.x, y: menu.y, monde: (menu.cible as { monde: Point }).monde })}
                />
                <ElementMenu libelle="Coller ici" raccourci="⌘V" onClick={() => coller((menu.cible as { monde: Point }).monde)} desactive={lecture || !aPresse} />
                <ElementMenu libelle="Tout sélectionner" raccourci="⌘A" onClick={() => setSelection(new Set(graphe.noeuds.map((n) => n.id)))} />
                <ElementMenu icone="arrow-rotate-left-01" libelle="Annuler" raccourci="⌘Z" onClick={p.annuler} desactive={lecture} />
                <ElementMenu icone="arrow-rotate-right-01" libelle="Rétablir" raccourci="⇧⌘Z" onClick={p.retablir} desactive={lecture} />
                <ElementMenu icone="search-01" libelle="Rechercher" raccourci="⌘F" onClick={() => setRecherche("")} />
                <ElementMenu
                  icone="lock-open-01"
                  libelle="Tout déverrouiller"
                  desactive={lecture || !graphe.noeuds.some((n) => n.verrouille)}
                  onClick={() => verrouiller(graphe.noeuds.map((n) => n.id), false)}
                />
              </>
            )}
          </div>
        </>
      )}

      {/* Les messages courts : connexion refusée, nœud supprimé (avec Annuler). */}
      {(annonce || annulable) && (
        <div role="status" aria-live="polite" className="absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-md bg-fond-inverse px-3.5 py-2 text-ui-s text-texte-inverse shadow-ombre-md">
          {annulable ? annulable.texte : annonce}
          {annulable && (
            <button
              type="button"
              onClick={() => {
                p.annuler();
                setAnnulable(null);
              }}
              className="cursor-pointer border-0 bg-transparent p-0 text-ui-s font-semibold text-texte-inverse underline underline-offset-2"
            >
              Annuler
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** La minicarte : tout le canevas en petit ; un clic y emmène. */
function Minicarte({ noeuds, cam, taille, onAller }: { noeuds: Noeud[]; cam: Camera; taille: { l: number; h: number }; onAller: (m: Point) => void }) {
  const L = 200;
  const H = 130;
  const vueMonde = { x: -cam.x / cam.z, y: -cam.y / cam.z, l: taille.l / cam.z, h: taille.h / cam.z };
  const xs = [...noeuds.map((n) => n.at.x), vueMonde.x];
  const ys = [...noeuds.map((n) => n.at.y), vueMonde.y];
  const x2 = [...noeuds.map((n) => n.at.x + largeurNoeud(n)), vueMonde.x + vueMonde.l];
  const y2 = [...noeuds.map((n) => n.at.y + (n.taille?.h ?? HAUTEUR_ESTIMEE)), vueMonde.y + vueMonde.h];
  const b = { x: Math.min(...xs) - 40, y: Math.min(...ys) - 40, l: Math.max(...x2) - Math.min(...xs) + 80, h: Math.max(...y2) - Math.min(...ys) + 80 };
  const e = Math.min(L / b.l, H / b.h);
  return (
    <div
      ref={apparition}
      className="absolute right-4 bottom-4 z-20 cursor-pointer overflow-hidden rounded-md border border-bordure-subtile bg-fond-surface shadow-ombre-sm"
      style={{ width: L, height: H }}
      onClick={(ev) => {
        const r = ev.currentTarget.getBoundingClientRect();
        onAller({ x: b.x + (ev.clientX - r.left) / e, y: b.y + (ev.clientY - r.top) / e });
      }}
    >
      <svg width={L} height={H} aria-hidden="true">
        {noeuds.map((n) => (
          <rect
            key={n.id}
            x={(n.at.x - b.x) * e}
            y={(n.at.y - b.y) * e}
            width={largeurNoeud(n) * e}
            height={(n.taille?.h ?? HAUTEUR_ESTIMEE) * e}
            rx={2}
            className={estEtape(n.type) ? "fill-bordure-forte" : "fill-bordure-subtile"}
          />
        ))}
        <rect
          x={(vueMonde.x - b.x) * e}
          y={(vueMonde.y - b.y) * e}
          width={vueMonde.l * e}
          height={vueMonde.h * e}
          rx={3}
          fill="none"
          strokeWidth={1.5}
          className="stroke-bleu-k1-500"
        />
      </svg>
    </div>
  );
}

