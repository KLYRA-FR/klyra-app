"use client";

import { EmptyState, Input } from "klyra-ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { couleurAgent } from "@/components/team/AgentVisuel";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useConfirmation } from "@/components/ui/Modale";
import { useAgents } from "@/lib/agents";
import { appelerCerveau } from "@/lib/cerveau-pont";
import { cn } from "@/lib/cn";
import {
  chercherNoeuds, cleArete, propositionsEntretien, construireGraphe, fichiersDepuisRendus, filsDepuisChats, filtrerGraphe, FILTRES_VIDES, idFichier, libelleRelation,
  liensDeduits, motsDe, orphelins, segmentsSurlignes, visiblePour, voisins,
  type AreteGraphe, type Doublon, type Obsolete, type ResultatRecherche, type TrouveContenu, type FiltresGraphe, type Graphe, type NoeudGraphe, type Periode, type SouvenirSource, type TypeNoeud,
} from "@/lib/graphe-memoire";
import { renduDansEspace } from "@/lib/rendus-espace";
import { useChatsEspace, useProjects, useWorkspace } from "@/lib/workspace";
import type { RoleTeinte } from "@/types/domain";
import { GrapheInteractif, type PoigneeGraphe } from "./GrapheInteractif";

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

/** Contenu des fichiers sources, cherché par le PC ou le VPS ; la dernière frappe seule compte. */
function useRechercheContenu(lieu: string | null, requete: string, projets: { id: string; dossier: string }[], fichiers: string[]) {
  const [etat, setEtat] = useState<{ pour: string; trouves: TrouveContenu[]; duree: number }>({ pour: "", trouves: [], duree: 0 });
  const cle = JSON.stringify([projets, fichiers]);
  useEffect(() => {
    const texte = requete.trim();
    if (!motsDe(texte).length) return;
    let annule = false;
    const minuteur = setTimeout(async () => {
      const debut = performance.now();
      try {
        const [p, f] = JSON.parse(cle);
        const r = await appelerCerveau<{ trouves: TrouveContenu[] }>(lieu, "graphe-chercher", { requete: texte, projets: p, fichiers: f });
        if (!annule) setEtat({ pour: texte, trouves: r.trouves, duree: performance.now() - debut });
      } catch {
        if (!annule) setEtat({ pour: texte, trouves: [], duree: performance.now() - debut });
      }
    }, 150);
    return () => { annule = true; clearTimeout(minuteur); };
  }, [lieu, requete, cle]);
  return etat.pour === requete.trim() ? etat : null;
}

interface OperationVue { id: string; type: string; le: string; libelle: string; annuleLe: string | null }
/** Un MEMORY.md et ce qu'un allègement y changerait (`indexMemoires`, electron/graphe-entretien.ts). */
interface MemoireVue { id: string; agent: string; date: string; octets: number; octetsApres: number; lignes: number; gardees: number; retirees: number; allege: boolean; utile: boolean }
interface EtatEntretienVue { refuses: string[]; operations: OperationVue[]; memoires?: MemoireVue[] }

/** Refus de liens et dernières actions d'entretien du lieu affiché ; chaque action relit l'état. */
function useEntretien(lieu: string | null, projets: { id: string; dossier: string }[], apres: () => void) {
  const [etat, setEtat] = useState<EtatEntretienVue>({ refuses: [], operations: [] });
  const [message, setMessage] = useState("");
  useEffect(() => {
    let annule = false;
    appelerCerveau<EtatEntretienVue>(lieu, "graphe-entretien").then((e) => { if (!annule) setEtat(e); }).catch(() => { /* serveur ancien : pas d'entretien */ });
    return () => { annule = true; };
  }, [lieu]);
  const agir = async (action: string, args: Record<string, unknown>, fait: string) => {
    try {
      setEtat(await appelerCerveau<EtatEntretienVue>(lieu, `graphe-entretien-${action}`, { ...args, projets }));
      setMessage(fait);
      apres();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Action impossible.");
    }
  };
  const memoires = useMemo(() => (etat.memoires ?? []).filter((m) => m.utile), [etat.memoires]);
  return { refuses: useMemo(() => new Set(etat.refuses), [etat.refuses]), operations: etat.operations, memoires, message, agir };
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
  const [requete, setRequete] = useState("");
  const [entretienOuvert, setEntretienOuvert] = useState(false);
  const [demander, fenetre] = useConfirmation();
  const entretien = useEntretien(lieu, dossiers, () => void relire());
  const poignee = useRef<PoigneeGraphe | null>(null);
  const rendusEspace = useMemo(() => state.rendus.filter((r) => renduDansEspace(r.origine, lieu)), [state.rendus, lieu]);

  const agents = useMemo(() => {
    const vus = new Map<string, { id: string; nom: string; titre: string; teinte: RoleTeinte }>();
    for (const r of [...roles, ...tous.map((a) => a.role)]) if (!vus.has(r.id)) vus.set(r.id, { id: r.id, nom: r.name, titre: r.title, teinte: r.teinte });
    return vus;
  }, [roles, tous]);
  const complet = useMemo(() => construireGraphe({
    souvenirs,
    fils: filsDepuisChats(chats),
    fichiers: fichiersDepuisRendus(rendusEspace),
    projets: projetsApp.map((p) => ({ id: p.id, nom: p.name, date: p.updatedAt })),
    agents: roles.map((r) => ({ id: r.id, nom: r.name, titre: r.title })),
  }), [souvenirs, chats, rendusEspace, projetsApp, roles]);
  // Le périmètre d'abord : un nœud privé ne nourrit ni les filtres ni les suggestions d'un autre agent.
  const perimetre = useMemo(() => visiblePour(complet, observateur || null), [complet, observateur]);
  const graphe = useMemo<Graphe>(() => {
    const g = filtrerGraphe(perimetre, filtres);
    return suggestions ? { noeuds: g.noeuds, aretes: [...g.aretes, ...liensDeduits(g, { refuses: entretien.refuses })] } : g;
  }, [perimetre, filtres, suggestions, entretien.refuses]);
  const propositions = useMemo(() => {
    const p = propositionsEntretien(perimetre);
    const liens = liensDeduits(perimetre, { refuses: entretien.refuses, parNoeud: 3 });
    return { ...p, liens };
  }, [perimetre, entretien.refuses]);
  const nbEntretien = propositions.doublons.length + propositions.obsoletes.length + propositions.liens.length + entretien.memoires.length;
  const parId = useMemo(() => new Map(perimetre.noeuds.map((n) => [n.id, n])), [perimetre]);

  const accepter = async (a: AreteGraphe) => {
    const [de, vers] = [parId.get(a.de), parId.get(a.vers)];
    if (!de || !vers || de.type !== "souvenir" || vers.type !== "souvenir") return;
    const ok = await demander({ titre: "Écrire ce lien ?", confirmer: "Écrire le lien",
      texte: `« Voir aussi : [[${vers.titre}]] » sera ajouté à la fin du souvenir « ${de.titre} » (${nomAgent(de.agent)}). Tu pourras annuler tant que le fichier n’a pas changé.` });
    if (ok) await entretien.agir("lien", { de: de.id, attenduDe: de.date, vers: vers.id }, `Lien écrit dans « ${de.titre} ».`);
  };
  const refuser = (a: AreteGraphe) => void entretien.agir("refuser", { cle: cleArete(a.de, a.vers) }, "Suggestion écartée : elle ne reviendra pas.");
  const fusionner = async (d: Doublon) => {
    const ok = await demander({ titre: "Fusionner ces deux souvenirs ?", confirmer: "Fusionner",
      texte: `« ${d.garder.titre} » est gardé et reprend le texte de « ${d.retirer.titre} » sous un titre « Repris de… ». « ${d.retirer.titre} » part dans le dossier archive, à côté, et sa ligne quitte MEMORY.md. Rien n’est supprimé, et tu pourras annuler.` });
    if (ok) await entretien.agir("fusionner", { garder: d.garder.id, attenduGarder: d.garder.date, retirer: d.retirer.id, attenduRetirer: d.retirer.date }, `« ${d.retirer.titre} » fusionné dans « ${d.garder.titre} ».`);
  };
  const archiver = async (o: Obsolete) => {
    const ok = await demander({ titre: "Archiver ce souvenir ?", confirmer: "Archiver",
      texte: `« ${o.noeud.titre} » part dans le dossier archive, à côté de lui, et sa ligne quitte MEMORY.md : ${nomAgent(o.noeud.agent)} ne le chargera plus. Rien n’est supprimé, et tu pourras annuler.` });
    if (ok) await entretien.agir("archiver", { id: o.noeud.id, attendu: o.noeud.date }, `« ${o.noeud.titre} » archivé.`);
  };
  const alleger = async (m: MemoireVue) => {
    const ok = await demander({ titre: `Alléger le MEMORY.md de ${nomAgent(m.agent)} ?`, confirmer: "Alléger",
      texte: `${m.retirees} lignes qui pointent vers des souvenirs de projet ou de référence quittent l’index que ${nomAgent(m.agent)} charge à chaque appel (${kio(m.octets)} → ${kio(m.octetsApres)}). Les souvenirs restent dans leurs fichiers : l’agent les retrouve avec l’outil memoire_graphe, que la tête de l’index lui rappelle. Les ${m.gardees} lignes de préférences et de retours restent. Tu pourras annuler tant que le fichier n’a pas changé.` });
    if (ok) await entretien.agir("alleger", { id: m.id, attendu: m.date }, `MEMORY.md de ${nomAgent(m.agent)} allégé.`);
  };
  const annulerOp = async (op: OperationVue) => {
    const ok = await demander({ titre: "Annuler cette action ?", confirmer: "Annuler l’action", annuler: "Garder", texte: op.libelle });
    if (ok) await entretien.agir("annuler", { id: op.id }, "Action annulée.");
  };
  const seuls = useMemo(() => orphelins(perimetre), [perimetre]);

  // Recherche : nom et résumé ici, contenu par le lieu des fichiers ; jamais hors du périmètre affiché.
  const copies = useMemo(() => new Map(rendusEspace.map((r) => [idFichier(r.id), [r.chemin].filter(Boolean)])), [rendusEspace]);
  const fichiersTexte = useMemo(() => rendusEspace.flatMap((r) => (r.chemin ? [r.chemin] : [])), [rendusEspace]);
  const contenu = useRechercheContenu(lieu, requete, dossiers, fichiersTexte);
  const resultats = useMemo<ResultatRecherche[]>(() => (motsDe(requete).length
    ? chercherNoeuds(perimetre, requete, contenu?.trouves ?? [], (n) => [...(n.chemin ? [n.chemin] : []), ...(copies.get(n.id) ?? [])])
    : []), [perimetre, requete, contenu, copies]);
  const surlignes = useMemo(() => (motsDe(requete).length ? new Set(resultats.map((r) => r.noeud.id)) : null), [requete, resultats]);
  const allerA = (id: string) => {
    if (!graphe.noeuds.some((n) => n.id === id)) setFiltres(FILTRES_VIDES);
    setSelection(id);
    requestAnimationFrame(() => poignee.current?.centrer(id));
  };
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
      <BarreRecherche requete={requete} changer={setRequete} resultats={resultats} enCours={!!motsDe(requete).length && !contenu}
        duree={contenu?.duree ?? null} nomAgent={(id) => (id ? agents.get(id)?.nom ?? id : "")} choisir={allerA} />
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
        <Bouton taille="mini" variant="discret" actif={entretienOuvert} aria-pressed={entretienOuvert} onClick={() => { setSelection(null); setEntretienOuvert((o) => !o); }}>
          Entretien ({nbEntretien})
        </Bouton>
        <span className="ml-auto flex items-center gap-2">
          <ListeDeroulante variante="compact" libelle="Vu par" value={observateur}
            options={[{ value: "", label: "Vu par toi (tout)" }, ...roles.map((r) => ({ value: r.id, label: `Vu par ${r.name}` }))]}
            onChange={setObservateur} />
          <BoutonIcone taille="mini" libelle="Relire les sources" icone={<Icon name="refresh-01" size={16} />} onClick={() => void relire()} />
        </span>
      </div>
      {fenetre}
      {entretien.message && <p role="status" className="text-ui-s text-texte-secondaire">{entretien.message}</p>}
      {erreur && <p role="status" className="rounded-md border border-bordure-subtile bg-fond-surface-grise px-3 py-2 text-ui-s text-texte-secondaire">{erreur}</p>}
      <div className="relative flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!charge && !complet.noeuds.length ? (
            <p role="status" className="p-6 text-ui-s text-texte-secondaire">Lecture des mémoires…</p>
          ) : !graphe.noeuds.length ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-bordure-subtile bg-fond-surface">
              <EmptyState title={complet.noeuds.length ? "Rien ne correspond à ces filtres" : "La mémoire est encore vide"}
                description={complet.noeuds.length ? "Retire un filtre pour revoir le graphe." : "Les souvenirs des agents, leurs fichiers publiés et leurs fils apparaîtront ici dès qu’ils existent."} />
            </div>
          ) : vue === "graphe" ? (
            <GrapheInteractif types={TYPE} graphe={graphe} selection={selection} choisir={setSelection} orphelins={seuls} couleur={couleur} surlignes={surlignes} poignee={poignee} />
          ) : (
            <VueListe graphe={surlignes ? { noeuds: graphe.noeuds.filter((n) => surlignes.has(n.id)), aretes: [] } : graphe} selection={selection} choisir={setSelection} orphelins={seuls} nomAgent={nomAgent} />
          )}
          <Legende />
        </div>
        {entretienOuvert && !courant && (
          <PanneauEntretien propositions={propositions} operations={entretien.operations} parId={parId} nomAgent={nomAgent}
            memoires={entretien.memoires} alleger={alleger}
            ouvrir={allerA} fermer={() => setEntretienOuvert(false)} fusionner={fusionner} archiver={archiver} accepter={accepter} refuser={refuser} annuler={annulerOp} />
        )}
        {courant && (
          <PanneauNoeud accepter={accepter} refuser={refuser} noeud={courant} graphe={graphe} orphelin={seuls.has(courant.id)} nomAgent={nomAgent}
            nomProjet={(id) => projetsApp.find((p) => p.id === id)?.name ?? id}
            choisir={allerA} fermer={() => { setSelection(null); requestAnimationFrame(() => document.querySelector<SVGSVGElement>('svg[aria-roledescription="graphe"]')?.focus()); }} ouvrirFil={ouvrirFil} />
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

function PanneauNoeud({ noeud, graphe, orphelin, nomAgent, nomProjet, choisir, fermer, ouvrirFil, accepter, refuser }: {
  noeud: NoeudGraphe; graphe: Graphe; orphelin: boolean; nomAgent: (id: string | null) => string; nomProjet: (id: string) => string;
  choisir: (id: string) => void; fermer: () => void; ouvrirFil: (chatId: string) => void;
  accepter: (a: AreteGraphe) => void; refuser: (a: AreteGraphe) => void;
}) {
  const liste = useMemo(() => voisins(graphe, noeud.id), [graphe, noeud.id]);
  const titre = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titre.current?.focus({ preventScroll: true }); }, [noeud.id]);
  return (
    <aside aria-label="Détail de l’élément" className="absolute inset-y-0 right-0 z-10 flex w-[min(320px,100%)] shrink-0 flex-col gap-3 overflow-auto rounded-2xl border border-bordure-subtile bg-fond-surface p-4 min-[1000px]:static"
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
            <li key={`${arete.type}|${v.id}`} className="flex flex-col">
              <button type="button" onClick={() => choisir(v.id)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-ui-s hover:bg-fond-survol focus-visible:bg-fond-survol focus-visible:outline-none">
                <span className={cn("size-2 shrink-0 rounded-full", arete.type === "deduit" && "outline-1 outline-offset-1 outline-dashed outline-texte-tertiaire")} style={{ background: TYPE[v.type].couleur }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{v.titre}</span>
                <span className="shrink-0 text-ui-2xs text-texte-tertiaire" title={arete.raison}>{libelleRelation(arete, sortant)}</span>
              </button>
              {arete.type === "deduit" && (
                <span className="flex items-center gap-1 pb-1 pl-6">
                  <span className="flex-1 truncate text-ui-2xs text-texte-tertiaire">{arete.raison}</span>
                  {noeud.type === "souvenir" && v.type === "souvenir" && <Bouton taille="mini" variant="gris" onClick={() => accepter(sortant ? arete : { ...arete, de: noeud.id, vers: v.id })}>Accepter</Bouton>}
                  <Bouton taille="mini" variant="discret" onClick={() => refuser(arete)}>Refuser</Bouton>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

/* ─── Recherche ────────────────────────────────────────────────────────── */

function Surligne({ texte, mots }: { texte: string; mots: string[] }) {
  return <>{segmentsSurlignes(texte, mots).map((s, i) => (s.trouve ? <mark key={i} className="rounded-[2px] bg-fond-teinte-bleue text-texte-principal">{s.texte}</mark> : <span key={i}>{s.texte}</span>))}</>;
}

const OU: Record<ResultatRecherche["ou"], string> = { nom: "nom", resume: "résumé", contenu: "contenu" };

function BarreRecherche({ requete, changer, resultats, enCours, duree, nomAgent, choisir }: {
  requete: string; changer: (v: string) => void; resultats: ResultatRecherche[]; enCours: boolean; duree: number | null;
  nomAgent: (id: string | null) => string; choisir: (id: string) => void;
}) {
  const [ouverte, setOuverte] = useState(false);
  const [actif, setActif] = useState(0);
  const id = useId();
  const mots = motsDe(requete), visibles = resultats.slice(0, 30);
  const montrer = ouverte && mots.length > 0;
  const prendre = (i: number) => {
    const r = visibles[i];
    if (!r) return;
    choisir(r.noeud.id);
    setOuverte(false);
  };
  const surTouche = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOuverte(true); setActif((a) => Math.min(a + 1, visibles.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActif((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); prendre(actif); }
    else if (e.key === "Escape") { if (ouverte) { e.preventDefault(); setOuverte(false); } else if (requete) { e.preventDefault(); changer(""); } }
  };
  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOuverte(false); }}>
      <Input
        type="search"
        role="combobox"
        aria-label="Rechercher dans la mémoire"
        aria-expanded={montrer}
        aria-controls={`${id}-liste`}
        aria-autocomplete="list"
        aria-activedescendant={montrer && visibles[actif] ? `${id}-${actif}` : undefined}
        placeholder="Chercher un nom, un résumé ou un passage…"
        leftIcon={<Icon name="search-01" size={16} />}
        clearable
        onClear={() => changer("")}
        value={requete}
        onChange={(e) => { changer(e.target.value); setActif(0); setOuverte(true); }}
        onFocus={() => setOuverte(true)}
        onKeyDown={surTouche}
      />
      {mots.length > 0 && (
        <p role="status" className="mt-1 text-ui-xs text-texte-tertiaire">
          {resultats.length ? `${resultats.length} élément${resultats.length > 1 ? "s" : ""} trouvé${resultats.length > 1 ? "s" : ""}, surlignés dans le graphe` : enCours ? "Recherche dans les fichiers…" : "Aucun élément trouvé"}
          {enCours && resultats.length ? " · recherche dans les fichiers…" : ""}
          {duree !== null && !enCours ? ` · contenu lu en ${Math.max(1, Math.round(duree))} ms` : ""}
        </p>
      )}
      {montrer && visibles.length > 0 && (
        <ul id={`${id}-liste`} role="listbox" aria-label="Résultats" data-flottant
          className="absolute top-[44px] right-0 left-0 z-30 max-h-[360px] overflow-auto rounded-lg border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-levee">
          {visibles.map((r, i) => (
            <li key={r.noeud.id} id={`${id}-${i}`} role="option" aria-selected={i === actif}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActif(i)} onClick={() => prendre(i)}
              className={cn("flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2", i === actif && "bg-fond-survol")}>
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: TYPE[r.noeud.type].couleur }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-s font-medium text-texte-principal"><Surligne texte={r.noeud.titre} mots={mots} /></span>
                {r.extrait && r.extrait !== r.noeud.titre && <span className="line-clamp-2 text-ui-xs text-texte-secondaire"><Surligne texte={r.extrait} mots={mots} /></span>}
              </span>
              <span className="shrink-0 text-ui-2xs text-texte-tertiaire">{TYPE[r.noeud.type].label}{r.noeud.agent && r.noeud.type !== "agent" ? ` · ${nomAgent(r.noeud.agent)}` : ""} · {OU[r.ou]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Entretien ────────────────────────────────────────────────────────── */

function Section({ titre, nombre, vide, children }: { titre: string; nombre: number; vide: string; children: ReactNode }) {
  return (
    <section aria-label={titre} className="flex flex-col gap-1.5">
      <h3 className="text-ui-xs font-medium text-texte-tertiaire">{titre} ({nombre})</h3>
      {nombre ? <ul className="flex flex-col gap-1.5">{children}</ul> : <p className="text-ui-s text-texte-secondaire">{vide}</p>}
    </section>
  );
}

function kio(n: number): string {
  return n < 1024 ? `${n} o` : `${(n / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Kio`;
}

function PanneauEntretien({ propositions, operations, memoires, alleger, parId, nomAgent, ouvrir, fermer, fusionner, archiver, accepter, refuser, annuler }: {
  propositions: { doublons: Doublon[]; obsoletes: Obsolete[]; liens: AreteGraphe[] }; operations: OperationVue[];
  memoires: MemoireVue[]; alleger: (m: MemoireVue) => void;
  parId: Map<string, NoeudGraphe>; nomAgent: (id: string | null) => string; ouvrir: (id: string) => void; fermer: () => void;
  fusionner: (d: Doublon) => void; archiver: (o: Obsolete) => void; accepter: (a: AreteGraphe) => void; refuser: (a: AreteGraphe) => void;
  annuler: (op: OperationVue) => void;
}) {
  const lien = (n: NoeudGraphe) => (
    <button type="button" onClick={() => ouvrir(n.id)} className="max-w-full truncate text-left font-medium text-texte-principal underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none">{n.titre}</button>
  );
  const carte = "flex flex-col gap-1 rounded-md border border-bordure-subtile p-2.5 text-ui-s";
  return (
    <aside aria-label="Entretien de la mémoire" className="flex w-[340px] shrink-0 flex-col gap-4 overflow-auto rounded-2xl border border-bordure-subtile bg-fond-surface p-4"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); fermer(); } }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-ui font-semibold text-texte-principal">Entretien</h2>
          <p className="text-ui-xs text-texte-secondaire">Ce que l’app propose. Rien ne change sans ton accord, et chaque action s’annule.</p>
        </div>
        <BoutonIcone taille="mini" libelle="Fermer l’entretien" icone={<Icon name="x-01" size={16} />} onClick={fermer} />
      </div>
      <Section titre="Doublons" nombre={propositions.doublons.length} vide="Aucun doublon repéré.">
        {propositions.doublons.slice(0, 30).map((d) => (
          <li key={`${d.a.id}|${d.b.id}`} className={carte}>
            <span className="flex flex-col">{lien(d.garder)}{lien(d.retirer)}</span>
            <span className="text-ui-xs text-texte-tertiaire">{nomAgent(d.garder.agent)} · {d.raison}</span>
            <Bouton taille="mini" className="self-start" onClick={() => fusionner(d)}>Fusionner dans le plus récent</Bouton>
          </li>
        ))}
      </Section>
      <Section titre="Obsolètes" nombre={propositions.obsoletes.length} vide="Aucun souvenir obsolète repéré.">
        {propositions.obsoletes.slice(0, 30).map((o) => (
          <li key={o.noeud.id} className={carte}>
            {lien(o.noeud)}
            <span className="text-ui-xs text-texte-tertiaire">{nomAgent(o.noeud.agent)} · {o.raison}</span>
            <Bouton taille="mini" className="self-start" onClick={() => archiver(o)}>Archiver</Bouton>
          </li>
        ))}
      </Section>
      <Section titre="MEMORY.md à alléger" nombre={memoires.length} vide="Aucun index trop chargé.">
        {memoires.map((m) => (
          <li key={m.id} className={carte}>
            <span className="font-medium text-texte-principal">{nomAgent(m.agent)}</span>
            <span className="text-ui-xs text-texte-tertiaire">
              {m.lignes} lignes, {kio(m.octets)} chargés à chaque appel · {m.retirees} renvoient à des souvenirs de projet ou de référence{m.allege ? " (déjà allégé une fois)" : ""}
            </span>
            <Bouton taille="mini" className="self-start" onClick={() => alleger(m)}>Alléger ({kio(m.octets)} → {kio(m.octetsApres)})</Bouton>
          </li>
        ))}
      </Section>
      <Section titre="Liens suggérés" nombre={propositions.liens.length} vide="Aucune suggestion pour l’instant.">
        {propositions.liens.slice(0, 40).map((a) => {
          const de = parId.get(a.de), vers = parId.get(a.vers);
          if (!de || !vers) return null;
          const ecrivable = de.type === "souvenir" && vers.type === "souvenir";
          return (
            <li key={`${a.de}|${a.vers}`} className={carte}>
              <span className="flex flex-col">{lien(de)}{lien(vers)}</span>
              <span className="text-ui-xs text-texte-tertiaire">{a.raison} · confiance {Math.round((a.confiance ?? 0) * 100)} %</span>
              <span className="flex gap-1">
                {ecrivable && <Bouton taille="mini" variant="gris" onClick={() => accepter(a)}>Accepter</Bouton>}
                <Bouton taille="mini" variant="discret" onClick={() => refuser(a)}>Refuser</Bouton>
              </span>
            </li>
          );
        })}
      </Section>
      {operations.length > 0 && (
        <Section titre="Dernières actions" nombre={operations.length} vide="">
          {operations.map((op) => (
            <li key={op.id} className="flex items-center gap-2 text-ui-s">
              <span className={cn("min-w-0 flex-1 truncate", op.annuleLe && "text-texte-tertiaire line-through")}>{op.libelle}</span>
              {!op.annuleLe && <Bouton taille="mini" variant="discret" onClick={() => annuler(op)}>Annuler</Bouton>}
            </li>
          ))}
        </Section>
      )}
    </aside>
  );
}
