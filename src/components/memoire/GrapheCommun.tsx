"use client";

import { EmptyState } from "klyra-ui";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { couleurAgent } from "@/components/team/AgentVisuel";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useAgents } from "@/lib/agents";
import { appelerCerveau } from "@/lib/cerveau-pont";
import { cn } from "@/lib/cn";
import {
  cadreDe, construireGraphe, fichiersDepuisRendus, filsDepuisChats, filtrerGraphe, FILTRES_VIDES, libelleRelation, liensDeduits,
  orphelins, placerGraphe, visiblePour, voisinDansDirection, voisins,
  type AreteGraphe, type FiltresGraphe, type Graphe, type NoeudGraphe, type Periode, type Position, type SouvenirSource, type TypeNoeud,
} from "@/lib/graphe-memoire";
import { renduDansEspace } from "@/lib/rendus-espace";
import { useChatsEspace, useProjects, useWorkspace } from "@/lib/workspace";
import type { RoleTeinte } from "@/types/domain";

export type VueGrapheCommun = "graphe" | "liste";

const TYPES: { id: TypeNoeud; label: string; pluriel: string; couleur: string }[] = [
  { id: "souvenir", label: "Mémoire", pluriel: "Mémoires", couleur: "var(--color-bleu-k1-300)" },
  { id: "fichier", label: "Fichier produit", pluriel: "Fichiers produits", couleur: "var(--color-orange-k1-500)" },
  { id: "fil", label: "Fil", pluriel: "Fils", couleur: "var(--color-vert-k1-400)" },
  { id: "projet", label: "Projet", pluriel: "Projets", couleur: "var(--color-violet-500)" },
  { id: "agent", label: "Agent", pluriel: "Agents", couleur: "var(--color-gris-k1-300)" },
];
const TYPE = Object.fromEntries(TYPES.map((t) => [t.id, t])) as Record<TypeNoeud, (typeof TYPES)[number]>;
const SOUS_TYPES: Record<string, string> = { user: "Personne", feedback: "Retour", project: "Projet", reference: "Référence" };
const PERIODES: { value: Periode; label: string }[] = [
  { value: "tout", label: "Toute période" }, { value: "7j", label: "7 derniers jours" },
  { value: "30j", label: "30 derniers jours" }, { value: "90j", label: "90 derniers jours" },
];
const RELECTURE_MS = 60_000;

const dateCourte = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "Date inconnue");

/** Lit les souvenirs du lieu affiché (PC ou VPS), relus à l'ouverture, chaque minute et sur demande. */
function useSouvenirs(lieu: string | null, projets: { id: string; dossier: string }[]) {
  const [etat, setEtat] = useState<{ souvenirs: SouvenirSource[]; erreur: string; charge: boolean }>({ souvenirs: [], erreur: "", charge: false });
  const generation = useRef(0);
  const cle = JSON.stringify(projets);
  const lire = useCallback(async () => {
    const n = ++generation.current;
    try {
      const r = await appelerCerveau<{ souvenirs: SouvenirSource[] }>(lieu, "graphe-souvenirs", { projets: JSON.parse(cle) });
      if (n === generation.current) setEtat({ souvenirs: r.souvenirs, erreur: "", charge: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const texte = /inconnue/i.test(message)
        ? "Ce serveur ne lit pas encore la mémoire des agents : relancez son installation pour le mettre à jour. Fils, fichiers et projets restent affichés."
        : `Mémoires des agents illisibles. ${message}`;
      if (n === generation.current) setEtat((avant) => ({ ...avant, erreur: texte, charge: true }));
    }
  }, [lieu, cle]);
  useEffect(() => {
    const premier = setTimeout(() => void lire(), 0);
    const boucle = setInterval(() => { if (document.visibilityState === "visible") void lire(); }, RELECTURE_MS);
    return () => { clearTimeout(premier); clearInterval(boucle); };
  }, [lire]);
  return { ...etat, relire: lire };
}

export function GrapheCommun({ lieu, vue }: { lieu: string | null; vue: VueGrapheCommun }) {
  const router = useRouter();
  const projetsApp = useProjects(), chats = useChatsEspace();
  const { state } = useWorkspace();
  const { roles, tous } = useAgents();
  const dossiers = useMemo(() => projetsApp.filter((p) => p.folder).map((p) => ({ id: p.id, dossier: p.folder })), [projetsApp]);
  const { souvenirs, erreur, charge, relire } = useSouvenirs(lieu, dossiers);
  const [filtres, setFiltres] = useState<FiltresGraphe>(FILTRES_VIDES);
  const [observateur, setObservateur] = useState<string>("");
  const [suggestions, setSuggestions] = useState(true);
  const [selection, setSelection] = useState<string | null>(null);

  const agents = useMemo(() => {
    const vus = new Map<string, { id: string; nom: string; titre: string; teinte: RoleTeinte }>();
    for (const r of [...roles, ...tous.map((a) => a.role)]) if (!vus.has(r.id)) vus.set(r.id, { id: r.id, nom: r.name, titre: r.title, teinte: r.teinte });
    return vus;
  }, [roles, tous]);
  const complet = useMemo(() => construireGraphe({
    souvenirs,
    fils: filsDepuisChats(chats),
    fichiers: fichiersDepuisRendus(state.rendus.filter((r) => renduDansEspace(r.origine, lieu))),
    projets: projetsApp.map((p) => ({ id: p.id, nom: p.name, date: p.updatedAt })),
    agents: roles.map((r) => ({ id: r.id, nom: r.name, titre: r.title })),
  }), [souvenirs, chats, state.rendus, lieu, projetsApp, roles]);
  // Le périmètre d'abord : un nœud privé ne nourrit ni les filtres ni les suggestions d'un autre agent.
  const perimetre = useMemo(() => visiblePour(complet, observateur || null), [complet, observateur]);
  const graphe = useMemo<Graphe>(() => {
    const g = filtrerGraphe(perimetre, filtres);
    return suggestions ? { noeuds: g.noeuds, aretes: [...g.aretes, ...liensDeduits(g)] } : g;
  }, [perimetre, filtres, suggestions]);
  const seuls = useMemo(() => orphelins(perimetre), [perimetre]);
  const courant = graphe.noeuds.find((n) => n.id === selection) ?? null;

  const nomAgent = useCallback((id: string | null) => (id ? agents.get(id)?.nom ?? id : ""), [agents]);
  const couleur = useCallback((id: string | null) => {
    const t = id ? agents.get(id)?.teinte : undefined;
    return t ? couleurAgent(t) : "var(--color-gris-k1-400)";
  }, [agents]);
  const ouvrirFil = (chatId: string) => router.push(`/chat?id=${encodeURIComponent(chatId)}`);

  const optionsAgents = [{ value: "", label: "Tous les agents" }, ...[...agents.values()].filter((a) => complet.noeuds.some((n) => n.agent === a.id)).map((a) => ({ value: a.id, label: a.nom }))];
  const optionsProjets = [{ value: "", label: "Tous les projets" }, ...projetsApp.map((p) => ({ value: p.id, label: p.name }))];
  const compte = (t: TypeNoeud) => perimetre.noeuds.filter((n) => n.type === t).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtres du graphe">
        <ListeDeroulante variante="compact" libelle="Agent" value={filtres.agents[0] ?? ""} options={optionsAgents}
          onChange={(v) => setFiltres((f) => ({ ...f, agents: v ? [v] : [] }))} />
        <ListeDeroulante variante="compact" libelle="Type" value={filtres.types[0] ?? ""}
          options={[{ value: "", label: "Tous les types" }, ...TYPES.map((t) => ({ value: t.id, label: `${t.pluriel} (${compte(t.id)})` }))]}
          onChange={(v) => setFiltres((f) => ({ ...f, types: v ? [v as TypeNoeud] : [] }))} />
        <ListeDeroulante variante="compact" libelle="Projet" value={filtres.projetId ?? ""} options={optionsProjets}
          onChange={(v) => setFiltres((f) => ({ ...f, projetId: v || null }))} />
        <ListeDeroulante variante="compact" libelle="Période" value={filtres.periode} options={PERIODES}
          onChange={(v) => setFiltres((f) => ({ ...f, periode: v }))} />
        <Bouton taille="mini" variant="discret" actif={filtres.orphelins} aria-pressed={filtres.orphelins}
          onClick={() => setFiltres((f) => ({ ...f, orphelins: !f.orphelins }))}>
          Orphelins ({seuls.size})
        </Bouton>
        <Bouton taille="mini" variant="discret" actif={suggestions} aria-pressed={suggestions} onClick={() => setSuggestions((s) => !s)}>
          Liens suggérés
        </Bouton>
        <span className="ml-auto flex items-center gap-2">
          <ListeDeroulante variante="compact" libelle="Vu par" value={observateur}
            options={[{ value: "", label: "Vu par toi (tout)" }, ...roles.map((r) => ({ value: r.id, label: `Vu par ${r.name}` }))]}
            onChange={setObservateur} />
          <BoutonIcone taille="mini" libelle="Relire les sources" icone={<Icon name="refresh-01" size={16} />} onClick={() => void relire()} />
        </span>
      </div>
      {erreur && <p role="status" className="rounded-md border border-bordure-subtile bg-fond-surface-grise px-3 py-2 text-ui-s text-texte-secondaire">{erreur}</p>}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!charge && !complet.noeuds.length ? (
            <p role="status" className="p-6 text-ui-s text-texte-secondaire">Lecture des mémoires…</p>
          ) : !graphe.noeuds.length ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-bordure-subtile bg-fond-surface">
              <EmptyState title={complet.noeuds.length ? "Rien ne correspond à ces filtres" : "La mémoire est encore vide"}
                description={complet.noeuds.length ? "Retire un filtre pour revoir le graphe." : "Les souvenirs des agents, leurs fichiers publiés et leurs fils apparaîtront ici dès qu’ils existent."} />
            </div>
          ) : vue === "graphe" ? (
            <VueGraphe graphe={graphe} selection={selection} choisir={setSelection} orphelins={seuls} couleur={couleur} />
          ) : (
            <VueListe graphe={graphe} selection={selection} choisir={setSelection} orphelins={seuls} nomAgent={nomAgent} />
          )}
          <Legende />
        </div>
        {courant && (
          <PanneauNoeud noeud={courant} graphe={graphe} orphelin={seuls.has(courant.id)} nomAgent={nomAgent}
            nomProjet={(id) => projetsApp.find((p) => p.id === id)?.name ?? id}
            choisir={setSelection} fermer={() => setSelection(null)} ouvrirFil={ouvrirFil} />
        )}
      </div>
    </div>
  );
}

function Legende() {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-ui-xs text-texte-secondaire" aria-label="Légende">
      {TYPES.filter((t) => t.id !== "agent").map((t) => (
        <li key={t.id} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: t.couleur }} />{t.pluriel}</li>
      ))}
      <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2" style={{ borderColor: "var(--color-texte-tertiaire)" }} />Anneau : couleur de l’agent</li>
      <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-dashed" style={{ borderColor: "var(--color-rouge-500)" }} />Orphelin</li>
      <li className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-texte-tertiaire" />Lien suggéré</li>
    </ul>
  );
}

/* ─── Graphe ───────────────────────────────────────────────────────────── */

type Vue = { k: number; x: number; y: number };
const rayonDe = (n: NoeudGraphe) => (n.type === "agent" ? 18 : n.type === "projet" ? 11 : 7);

function VueGraphe({ graphe, selection, choisir, orphelins, couleur }: {
  graphe: Graphe; selection: string | null; choisir: (id: string | null) => void; orphelins: Set<string>; couleur: (agent: string | null) => string;
}) {
  const pos = useMemo(() => placerGraphe({ noeuds: graphe.noeuds, aretes: graphe.aretes.filter((a) => a.type !== "deduit") }), [graphe]);
  const cadre = useMemo(() => cadreDe(pos), [pos]);
  const [vue, setVue] = useState<Vue>({ k: 1, x: 0, y: 0 });
  const svg = useRef<SVGSVGElement>(null);
  const glisse = useRef<{ x: number; y: number; vue: Vue; bouge: boolean } | null>(null);
  const centre = { x: cadre.x + cadre.l / 2, y: cadre.y + cadre.h / 2 };
  const ids = useMemo(() => graphe.noeuds.map((n) => n.id), [graphe]);

  const versSvg = (clientX: number, clientY: number) => {
    const el = svg.current, ctm = el?.getScreenCTM();
    if (!el || !ctm) return centre;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const zoomer = (facteur: number, autour = centre) => setVue((v) => {
    const k = Math.max(0.3, Math.min(5, v.k * facteur));
    return { k, x: autour.x - ((autour.x - v.x) * k) / v.k, y: autour.y - ((autour.y - v.y) * k) / v.k };
  });
  const centrerSur = (id: string) => {
    const p = pos[id];
    if (p) setVue((v) => ({ ...v, x: centre.x - p.x * v.k, y: centre.y - p.y * v.k }));
  };
  const surRoue = (e: WheelEvent<SVGSVGElement>) => zoomer(e.deltaY < 0 ? 1.15 : 1 / 1.15, versSvg(e.clientX, e.clientY));
  const surAppui = (e: PointerEvent<SVGSVGElement>) => {
    glisse.current = { x: e.clientX, y: e.clientY, vue, bouge: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const surMouvement = (e: PointerEvent<SVGSVGElement>) => {
    const g = glisse.current, el = svg.current;
    if (!g || !el) return;
    const echelle = cadre.l / Math.max(1, el.clientWidth);
    const dx = (e.clientX - g.x) * echelle, dy = (e.clientY - g.y) * echelle;
    if (Math.abs(dx) + Math.abs(dy) > 3 * echelle) g.bouge = true;
    if (g.bouge) setVue({ ...g.vue, x: g.vue.x + dx, y: g.vue.y + dy });
  };
  const surRelache = (e: PointerEvent<SVGSVGElement>) => {
    const g = glisse.current;
    glisse.current = null;
    if (g && !g.bouge) {
      const id = (e.target as Element).closest("[data-noeud]")?.getAttribute("data-noeud") ?? null;
      choisir(id);
    }
  };
  const surTouche = (e: KeyboardEvent<SVGSVGElement>) => {
    const dirs: Record<string, "haut" | "bas" | "gauche" | "droite"> = { ArrowUp: "haut", ArrowDown: "bas", ArrowLeft: "gauche", ArrowRight: "droite" };
    if (dirs[e.key]) {
      e.preventDefault();
      const suivant = selection ? voisinDansDirection(pos, selection, dirs[e.key], ids) : ids[0];
      if (suivant) { choisir(suivant); centrerSur(suivant); }
    } else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomer(1.25); }
    else if (e.key === "-") { e.preventDefault(); zoomer(1 / 1.25); }
    else if (e.key === "0") { e.preventDefault(); setVue({ k: 1, x: 0, y: 0 }); }
    else if (e.key === "Escape" && selection) { e.preventDefault(); choisir(null); }
  };
  const actif = selection ? graphe.noeuds.find((n) => n.id === selection) : null;

  return (
    <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-2xl bg-fond-nuit">
      <svg
        ref={svg}
        role="application"
        aria-roledescription="graphe"
        aria-label={`Graphe de la mémoire : ${graphe.noeuds.length} éléments. Flèches pour passer d’un élément à l’autre, + et − pour zoomer, 0 pour recadrer, Échap pour fermer le détail.`}
        tabIndex={0}
        viewBox={`${cadre.x} ${cadre.y} ${cadre.l} ${cadre.h}`}
        className="size-full cursor-grab touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-focus active:cursor-grabbing"
        onWheel={surRoue}
        onPointerDown={surAppui}
        onPointerMove={surMouvement}
        onPointerUp={surRelache}
        onKeyDown={surTouche}
      >
        <g transform={`translate(${vue.x} ${vue.y}) scale(${vue.k})`}>
          <Couche graphe={graphe} pos={pos} selection={selection} orphelins={orphelins} couleur={couleur} libelles={vue.k >= 1.6} />
        </g>
      </svg>
      <p className="sr-only" aria-live="polite">{actif ? `${TYPE[actif.type].label} : ${actif.titre}` : ""}</p>
      <div className="absolute right-3 bottom-3 flex gap-1">
        <BoutonIcone variant="ghost" taille="mini" libelle="Zoomer" icone={<Icon name="zoom-in" size={16} />} onClick={() => zoomer(1.25)} />
        <BoutonIcone variant="ghost" taille="mini" libelle="Dézoomer" icone={<Icon name="zoom-out" size={16} />} onClick={() => zoomer(1 / 1.25)} />
        <BoutonIcone variant="ghost" taille="mini" libelle="Tout voir" icone={<Icon name="expand" size={16} />} onClick={() => setVue({ k: 1, x: 0, y: 0 })} />
      </div>
    </div>
  );
}

/** Le dessin, mémorisé : déplacer ou zoomer ne le recalcule pas (seul le `transform` du groupe change). */
const Couche = memo(function Couche({ graphe, pos, selection, orphelins, couleur, libelles }: {
  graphe: Graphe; pos: Record<string, Position>; selection: string | null; orphelins: Set<string>; couleur: (agent: string | null) => string; libelles: boolean;
}) {
  const proches = useMemo(() => {
    const s = new Set<string>();
    if (selection) for (const a of graphe.aretes) { if (a.de === selection) s.add(a.vers); if (a.vers === selection) s.add(a.de); }
    return s;
  }, [graphe, selection]);
  const trait = (a: AreteGraphe) => {
    const touche = selection && (a.de === selection || a.vers === selection);
    if (a.type === "deduit") return { stroke: "rgba(255,255,255,.45)", dash: "4 4", w: touche ? 1.6 : 1, o: touche ? 1 : 0.6 };
    return { stroke: touche ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.18)", dash: undefined, w: touche ? 1.6 : 1, o: 1 };
  };
  return (
    <>
      <g aria-hidden>
        {graphe.aretes.map((a) => {
          const p = pos[a.de], q = pos[a.vers];
          if (!p || !q) return null;
          const t = trait(a);
          return <line key={`${a.type}|${a.de}|${a.vers}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={t.stroke} strokeWidth={t.w} strokeDasharray={t.dash} opacity={t.o} vectorEffect="non-scaling-stroke" />;
        })}
      </g>
      {graphe.noeuds.map((n) => {
        const p = pos[n.id];
        if (!p) return null;
        const r = rayonDe(n), choisi = n.id === selection, estompe = !!selection && !choisi && !proches.has(n.id);
        const montrerTexte = n.type === "agent" || n.type === "projet" || libelles || choisi || proches.has(n.id);
        return (
          <g key={n.id} data-noeud={n.id} transform={`translate(${p.x} ${p.y})`} opacity={estompe ? 0.35 : 1} className="cursor-pointer">
            <title>{`${TYPE[n.type].label} · ${n.titre}`}</title>
            {orphelins.has(n.id) && <circle r={r + 5} fill="none" stroke="var(--color-rouge-500)" strokeDasharray="3 3" strokeWidth={1.2} />}
            {choisi && <circle r={r + 8} fill="none" stroke="white" strokeWidth={2} />}
            {n.type === "agent" && n.agent ? (
              <foreignObject x={-r} y={-r} width={r * 2} height={r * 2}>
                <AgentRond roleId={n.agent} taille={r * 2} />
              </foreignObject>
            ) : n.type === "projet" ? (
              <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={4} fill={TYPE.projet.couleur} />
            ) : (
              <circle r={r} fill={TYPE[n.type].couleur} stroke={couleur(n.agent)} strokeWidth={3} strokeDasharray={n.prive ? "2 2" : undefined} />
            )}
            {montrerTexte && (
              <text y={r + 14} textAnchor="middle" fill="white" fontSize={n.type === "agent" ? 13 : 11} className="pointer-events-none">
                {n.titre.length > 32 ? `${n.titre.slice(0, 31)}…` : n.titre}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
});

/* ─── Liste ────────────────────────────────────────────────────────────── */

function VueListe({ graphe, selection, choisir, orphelins, nomAgent }: {
  graphe: Graphe; selection: string | null; choisir: (id: string) => void; orphelins: Set<string>; nomAgent: (id: string | null) => string;
}) {
  const lignes = useMemo(() => [...graphe.noeuds].filter((n) => n.type !== "agent")
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.titre.localeCompare(b.titre, "fr")), [graphe]);
  const [limite, setLimite] = useState(200);
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-bordure-subtile bg-fond-surface">
      <ul aria-label="Éléments de la mémoire" className="divide-y divide-bordure-subtile">
        {lignes.slice(0, limite).map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => choisir(n.id)} aria-current={n.id === selection ? "true" : undefined}
              className={cn("flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-fond-survol focus-visible:bg-fond-survol focus-visible:outline-none", n.id === selection && "bg-fond-surface-grise")}>
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: TYPE[n.type].couleur }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-ui font-medium text-texte-principal">
                  <span className="truncate">{n.titre}</span>
                  {n.prive && <Icon name="lock-01" size={14} aria-label="Privé" />}
                  {orphelins.has(n.id) && <span className="text-ui-2xs font-normal text-texte-erreur">Orphelin</span>}
                </span>
                {n.resume && n.resume !== n.titre && <span className="block truncate text-ui-s text-texte-secondaire">{n.resume}</span>}
              </span>
              <span className="shrink-0 text-right text-ui-xs text-texte-tertiaire">
                {TYPE[n.type].label}{n.agent ? ` · ${nomAgent(n.agent)}` : ""}<br />{n.date ? dateCourte(n.date) : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {lignes.length > limite && (
        <div className="p-3 text-center">
          <Bouton taille="mini" onClick={() => setLimite((l) => l + 200)}>Afficher {Math.min(200, lignes.length - limite)} de plus ({lignes.length - limite} restants)</Bouton>
        </div>
      )}
    </div>
  );
}

/* ─── Panneau d'un nœud ────────────────────────────────────────────────── */

function PanneauNoeud({ noeud, graphe, orphelin, nomAgent, nomProjet, choisir, fermer, ouvrirFil }: {
  noeud: NoeudGraphe; graphe: Graphe; orphelin: boolean; nomAgent: (id: string | null) => string; nomProjet: (id: string) => string;
  choisir: (id: string) => void; fermer: () => void; ouvrirFil: (chatId: string) => void;
}) {
  const liste = useMemo(() => voisins(graphe, noeud.id), [graphe, noeud.id]);
  const titre = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titre.current?.focus({ preventScroll: true }); }, [noeud.id]);
  return (
    <aside aria-label="Détail de l’élément" className="flex w-[320px] shrink-0 flex-col gap-3 overflow-auto rounded-2xl border border-bordure-subtile bg-fond-surface p-4"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); fermer(); } }}>
      <div className="flex items-start gap-2">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: TYPE[noeud.type].couleur }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-ui-xs text-texte-tertiaire">{TYPE[noeud.type].label}{noeud.sousType ? ` · ${SOUS_TYPES[noeud.sousType] ?? noeud.sousType}` : ""}</p>
          <h2 ref={titre} tabIndex={-1} className="text-ui font-semibold break-words text-texte-principal outline-none">{noeud.titre}</h2>
        </div>
        <BoutonIcone taille="mini" libelle="Fermer le détail" icone={<Icon name="x-01" size={16} />} onClick={fermer} />
      </div>
      {noeud.resume && noeud.resume !== noeud.titre && <p className="text-ui-s text-texte-secondaire">{noeud.resume}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-ui-s">
        {noeud.agent && noeud.type !== "agent" && (<><dt className="text-texte-tertiaire">Agent</dt><dd className="flex items-center gap-1.5"><AgentRond roleId={noeud.agent} taille={16} />{nomAgent(noeud.agent)}</dd></>)}
        {noeud.type !== "agent" && (<><dt className="text-texte-tertiaire">Date</dt><dd>{dateCourte(noeud.date)}</dd></>)}
        {noeud.projetId && noeud.type !== "projet" && (<><dt className="text-texte-tertiaire">Projet</dt><dd>{nomProjet(noeud.projetId)}</dd></>)}
        {noeud.chemin && (<><dt className="text-texte-tertiaire">Source</dt><dd className="break-all text-ui-xs text-texte-secondaire">{noeud.chemin}</dd></>)}
        {noeud.prive && (<><dt className="text-texte-tertiaire">Visibilité</dt><dd className="flex items-center gap-1"><Icon name="lock-01" size={14} />Privé : son agent et toi</dd></>)}
      </dl>
      {orphelin && <p className="rounded-md bg-fond-surface-grise px-3 py-2 text-ui-xs text-texte-secondaire">Aucun lien avec le reste de la mémoire, hormis son agent.</p>}
      {noeud.chatId && <Bouton taille="mini" className="self-start" iconeGauche={<Icon name="message-square" size={14} />} onClick={() => ouvrirFil(noeud.chatId!)}>Ouvrir le fil</Bouton>}
      <section aria-label="Voisins" className="flex flex-col gap-1">
        <h3 className="text-ui-xs font-medium text-texte-tertiaire">Voisins ({liste.length})</h3>
        {!liste.length && <p className="text-ui-s text-texte-secondaire">Aucun.</p>}
        <ul className="flex flex-col">
          {liste.map(({ noeud: v, arete, sortant }) => (
            <li key={`${arete.type}|${v.id}`}>
              <button type="button" onClick={() => choisir(v.id)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-ui-s hover:bg-fond-survol focus-visible:bg-fond-survol focus-visible:outline-none">
                <span className={cn("size-2 shrink-0 rounded-full", arete.type === "deduit" && "outline-1 outline-offset-1 outline-dashed outline-texte-tertiaire")} style={{ background: TYPE[v.type].couleur }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{v.titre}</span>
                <span className="shrink-0 text-ui-2xs text-texte-tertiaire" title={arete.raison}>{libelleRelation(arete, sortant)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
