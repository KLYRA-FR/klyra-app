"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { PuceSelect } from "@/components/ui/PuceSelect";
import { AgentRond } from "@/components/roles/AgentRond";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";
import { texteDe, useProjects, useRoles, useWorkspace } from "@/lib/workspace";
import { useChantiers, type Chantier } from "@/lib/workflows/chantiers";
import { estEtape, GRAPHE_VIDE, type ExecutionWorkflow, type Graphe, type VersionWorkflow, type Workflow } from "@/types/workflows";
import { Canevas } from "./Canevas";
import { LIBELLES_STATUT_EXECUTION, nouveauNoeud } from "./catalogue";

/**
 * Les workflows : le choix du workflow et ses versions en haut, le canevas au
 * milieu, l'historique des exécutions à droite. Un seul workflow est ouvert ;
 * ses changements sont enregistrés tout seuls.
 */

const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtJour = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });

function quandCourt(iso: string): string {
  const d = new Date(iso);
  const auj = new Date();
  const memeJour = d.toDateString() === auj.toDateString();
  return `${memeJour ? "Aujourd’hui" : fmtJour.format(d)}, ${fmtHeure.format(d)}`;
}

function duree(e: ExecutionWorkflow): string {
  const s = Math.max(1, Math.round(((e.fin ? new Date(e.fin) : new Date()).getTime() - new Date(e.debut).getTime()) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

function nouveauWorkflow(titre = "Workflow sans titre", graphe: Graphe = GRAPHE_VIDE): Workflow {
  const maintenant = new Date().toISOString();
  return { id: crypto.randomUUID(), titre, graphe, projectId: null, creeLe: maintenant, majLe: maintenant, versions: [] };
}

/** Un exemple pour démarrer : maquette, accord, code, recette ; la recette renvoie au code tant que ce n'est pas bon. */
function exemple(): Workflow {
  const d = nouveauNoeud("declencheur", { x: 40, y: 120 });
  const iris = nouveauNoeud("agent", { x: 380, y: 60 });
  iris.champs = { agent: "designer", tache: "Propose la maquette de la page demandée, en suivant le design system KLYRA.", nom: "Maquette" };
  const p = nouveauNoeud("prompt", { x: 40, y: 380 });
  p.champs = { texte: "Une page « Nos offres » pour klyra.fr : trois offres, un bloc CTA." };
  const ok = nouveauNoeud("approbation", { x: 740, y: 60 });
  ok.champs = { question: "La maquette te convient ?" };
  const hugo = nouveauNoeud("agent", { x: 1080, y: 60 });
  hugo.champs = { agent: "dev", tache: "Code cette maquette dans le projet.", nom: "Code" };
  const qa = nouveauNoeud("agent", { x: 1440, y: 60 });
  qa.champs = { agent: "qa", tache: "Contrôle ce qui vient d’être codé et rends ton verdict.", nom: "Recette" };
  const c = nouveauNoeud("condition", { x: 1800, y: 60 });
  c.champs = { regle: "Le verdict de la recette est positif, sans bloquant." };
  const fin = nouveauNoeud("sortie", { x: 2160, y: 60 });
  fin.champs = { cible: "notification", titre: "La page est prête", chemin: "" };
  const l = (de: { id: string }, vers: { id: string }, branche?: "oui" | "non") => ({
    id: crypto.randomUUID(),
    de: de.id,
    vers: vers.id,
    port: "texte" as const,
    ...(branche ? { branche } : {}),
  });
  return nouveauWorkflow("De la maquette à la recette", {
    noeuds: [d, p, iris, ok, hugo, qa, c, fin],
    liens: [l(d, iris), l(p, iris), l(iris, ok), l(ok, hugo), l(hugo, qa), l(qa, c), l(c, fin, "oui"), l(c, hugo, "non")],
    traits: [],
  });
}

/* ─── L'historique des exécutions ──────────────────────────────── */

function Historique({
  wf,
  executions,
  vue,
  onVue,
  onFermer,
}: {
  wf: Workflow;
  executions: ExecutionWorkflow[];
  vue: string | null;
  onVue: (id: string | null) => void;
  onFermer: () => void;
}) {
  const { arreterExecution, state } = useWorkspace();
  const roles = useRoles();
  const nomAgent = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const total = wf.graphe.noeuds.filter((n) => estEtape(n.type)).length;
  const [plus, setPlus] = useState(false);
  const visibles = plus ? executions : executions.slice(0, 12);
  return (
    <aside ref={apparition} aria-label="Exécutions" className="flex w-[300px] shrink-0 flex-col border-l border-bordure-subtile bg-fond-surface">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="m-0 flex-1 text-ui font-semibold text-texte-principal">Exécutions</h2>
        <BoutonIcone taille="mini" icone={<Icon name="x-01" size={16} />} libelle="Fermer l’historique" onClick={onFermer} />
      </div>
      {vue && (
        <button type="button" onClick={() => onVue(null)} className="mx-4 mb-2 cursor-pointer self-start border-0 bg-transparent p-0 text-ui-xs text-texte-accent underline underline-offset-2">
          Afficher les derniers résultats
        </button>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {executions.length === 0 ? (
          <p className="m-0 px-2 text-ui-s text-texte-tertiaire">Aucune exécution pour l’instant. Lance le workflow depuis son déclencheur.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {visibles.map((e) => {
              const faits = e.etapes.filter((s) => s.statut === "fait").length;
              const enCours = e.statut === "en-cours" || e.statut === "approbation";
              const issue =
                e.statut === "fait"
                  ? "Réussie"
                  : e.statut === "erreur"
                    ? `Échec après ${duree(e)}`
                    : e.statut === "arrete"
                      ? `Arrêtée après ${duree(e)}`
                      : LIBELLES_STATUT_EXECUTION[e.statut];
              const enAttente = e.etapes.find((s) => s.statut === "approbation" || s.statut === "erreur");
              const nomAttente = enAttente && wf.graphe.noeuds.find((n) => n.id === enAttente.noeudId);
              return (
                <li key={e.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onVue(e.id)}
                    onKeyDown={(k) => k.key === "Enter" && onVue(e.id)}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2.5",
                      vue === e.id ? "border-bordure-accent-legere bg-fond-teinte-bleue" : "border-transparent hover:bg-fond-survol",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {e.statut === "fait" && <PixelCheck className="h-[9px] w-3" />}
                      {enCours && <Icon name="loader-01" size={14} className="text-icone-accent motion-safe:animate-spin" />}
                      {e.statut === "erreur" && <span className="size-2 rounded-full bg-texte-erreur" />}
                      {e.statut === "arrete" && <span className="size-2 rounded-full bg-texte-tertiaire" />}
                      <span className="flex-1 text-ui-s font-medium text-texte-principal">
                        {e.seule ? "Étape seule" : `Exécution ${e.numero}`}
                      </span>
                      {e.lancePar ? (
                        <span className="flex items-center gap-1 text-ui-2xs text-texte-tertiaire">
                          <AgentRond roleId={e.lancePar.roleId} taille={14} fondPastille="surface" />
                          {nomAgent(e.lancePar.roleId)}
                        </span>
                      ) : (
                        <span className="text-ui-2xs text-texte-tertiaire">{e.source === "planifie" ? "Planifiée" : e.source === "webhook" ? "Webhook" : "Manuelle"}</span>
                      )}
                    </span>
                    <span className="text-ui-xs text-texte-tertiaire">
                      {quandCourt(e.debut)} · {enCours ? `${LIBELLES_STATUT_EXECUTION[e.statut]} · ${faits}/${total}` : issue}
                    </span>
                    {nomAttente && (e.statut === "approbation" || e.statut === "erreur") && (
                      <span className="text-ui-2xs text-texte-secondaire">
                        {e.statut === "approbation" ? "En attente à" : "Échec à"} : {String(nomAttente.champs.nom || "") || nomAttente.type}
                      </span>
                    )}
                    {e.erreur && <span className="text-ui-2xs text-texte-erreur">{e.erreur}</span>}
                    <span className="flex gap-2">
                      {enCours && (
                        <button
                          type="button"
                          onClick={(k) => {
                            k.stopPropagation();
                            arreterExecution(e.id);
                          }}
                          className="cursor-pointer border-0 bg-transparent p-0 text-ui-2xs font-medium text-texte-principal underline underline-offset-2"
                        >
                          Arrêter
                        </button>
                      )}
                      {e.chatId && state.chats.some((c) => c.id === e.chatId) && (
                        <Link href={`/chat?id=${e.chatId}`} onClick={(k) => k.stopPropagation()} className="text-ui-2xs text-texte-tertiaire underline underline-offset-2 hover:text-texte-principal">
                          Voir la conversation
                        </Link>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!plus && executions.length > 12 && (
          <button type="button" onClick={() => setPlus(true)} className="mx-2 mt-2 cursor-pointer border-0 bg-transparent p-0 text-ui-xs text-texte-tertiaire underline underline-offset-2">
            Afficher les exécutions plus anciennes
          </button>
        )}
      </div>
    </aside>
  );
}

/* ─── Un workflow ouvert ───────────────────────────────────────── */

function Editeur({ wf, chantier }: { wf: Workflow; chantier: Chantier | null }) {
  const { state, enregistrerWorkflow, lancerWorkflow, deciderApprobation } = useWorkspace();
  const roles = useRoles();
  /* Un agent construit ce workflow : le canevas montre son chantier, en lecture, jusqu'à l'enregistrement. */
  const construit = chantier && chantier.workflowId === wf.id ? chantier : null;
  const enTravaux = !!construit && construit.phase !== "fini";
  const [graphe, setGraphe] = useState<Graphe>(wf.graphe);
  const grapheRef = useRef(graphe);
  const passe = useRef<Graphe[]>([]);
  const futur = useRef<Graphe[]>([]);
  const derniereFusion = useRef<string | null>(null);
  const [apercu, setApercu] = useState<VersionWorkflow | null>(null);
  const [historique, setHistorique] = useState(false);
  const [vue, setVue] = useState<string | null>(null);
  const [decalages, setDecalages] = useState<Record<string, number>>({});
  const [adresses, setAdresses] = useState<Record<string, string>>({});

  const poser = (g: Graphe) => {
    grapheRef.current = g;
    setGraphe(g);
  };
  const changer = (fn: (g: Graphe) => Graphe, fusion?: string) => {
    const avant = grapheRef.current;
    const apres = fn(avant);
    if (apres === avant) return;
    if (!fusion || fusion !== derniereFusion.current) {
      passe.current = [...passe.current.slice(-99), avant];
      futur.current = [];
    }
    derniereFusion.current = fusion ?? null;
    poser(apres);
  };
  const annuler = () => {
    const g = passe.current.pop();
    if (!g) return;
    futur.current.push(grapheRef.current);
    derniereFusion.current = null;
    poser(g);
  };
  const retablir = () => {
    const g = futur.current.pop();
    if (!g) return;
    passe.current.push(grapheRef.current);
    derniereFusion.current = null;
    poser(g);
  };

  /* Enregistrement automatique, regroupé. */
  const wfRef = useRef(wf);
  useEffect(() => {
    wfRef.current = wf;
  });
  useEffect(() => {
    if (graphe === wfRef.current.graphe) return;
    const t = setTimeout(() => enregistrerWorkflow({ ...wfRef.current, graphe }), 400);
    return () => clearTimeout(t);
  }, [graphe, enregistrerWorkflow]);

  /* Une étape modifiée ailleurs (le téléphone) : l'éditeur reprend le graphe enregistré, s'il n'a rien en attente. */
  const grapheVu = useRef(wf.graphe);
  useEffect(() => {
    const avant = grapheVu.current;
    grapheVu.current = wf.graphe;
    /* Un agent l'a modifié (sa version garde le graphe d'avant) : son graphe l'emporte. */
    const parAgent = wf.versions[0]?.raison === "agent" && wf.versions[0].graphe === avant;
    if (wf.graphe !== avant && (grapheRef.current === avant || parAgent)) poser(wf.graphe);
  }, [wf.graphe, wf.versions]);

  /* Les adresses des webhooks déjà créés. */
  useEffect(() => {
    const ws = getBridge()?.webhooks;
    if (!ws) return;
    for (const [id, secret] of Object.entries(wf.webhooks ?? {}))
      void ws.adresse(secret).then((r) => r.ok && setAdresses((a) => ({ ...a, [id]: r.data })));
  }, [wf.webhooks]);

  const executions = useMemo(() => state.executions.filter((e) => e.workflowId === wf.id), [state.executions, wf.id]);
  const enCours = executions.find((e) => e.statut === "en-cours" || e.statut === "approbation");
  const total = graphe.noeuds.filter((n) => estEtape(n.type)).length;

  /* L'exécution montrée sur le canevas : celle qu'on regarde, sinon celle qui tourne. */
  const montree = (vue ? executions.find((e) => e.id === vue) : enCours) ?? null;
  const parcours = useMemo(() => {
    const faits = new Set<string>();
    const actifs = new Set<string>();
    if (!montree) return { faits, actifs };
    const derniere = new Map<string, (typeof montree.etapes)[number]>();
    for (const e of montree.etapes) derniere.set(e.noeudId, e);
    for (const l of graphe.liens) {
      const de = derniere.get(l.de);
      const vers = derniere.get(l.vers);
      if (de?.statut !== "fait" || !vers || (l.branche && de.branche !== l.branche)) continue;
      if (vers.statut === "en-cours" || vers.statut === "approbation") actifs.add(l.id);
      else if (vers.statut !== "ignore") faits.add(l.id);
    }
    return { faits, actifs };
  }, [montree, graphe.liens]);
  /* L'agent d'une étape en cours : ce qu'il écrit dans la conversation du workflow, en direct. */
  const enDirect = useMemo(() => {
    const direct: Record<string, { texte: string; etape: string | null }> = {};
    if (!montree?.chatId || (montree.statut !== "en-cours" && montree.statut !== "approbation")) return direct;
    for (const e of montree.etapes) {
      if (e.statut !== "en-cours") continue;
      const n = graphe.noeuds.find((x) => x.id === e.noeudId);
      if (n?.type !== "agent") continue;
      const roleId = String(n.champs.agent || "principal");
      const m = state.messages.findLast(
        (x) => x.chatId === montree.chatId && x.author.kind === "role" && x.author.roleId === roleId && x.createdAt >= e.debut && x.statut === "en-cours",
      );
      if (!m) continue;
      const etapes = m.parts.flatMap((p) => (p.type === "etapes" ? p.etapes : []));
      const enCoursEtape = etapes.findLast((x) => x.statut === "en-cours" && !x.parent) ?? null;
      direct[n.id] = { texte: texteDe(m), etape: enCoursEtape?.libelle ?? null };
    }
    return direct;
  }, [montree, graphe.noeuds, state.messages]);

  /* Les résultats d'un nœud, du plus récent au plus ancien. */
  const resultatDe = (noeudId: string) => {
    const liste = executions.flatMap((e) => [...e.etapes].reverse().filter((s) => s.noeudId === noeudId && s.statut !== "ignore"));
    const choisie = vue ? executions.find((e) => e.id === vue) : null;
    let rang = Math.min(decalages[noeudId] ?? 0, Math.max(0, liste.length - 1));
    if (choisie) {
      const i = liste.findIndex((s) => choisie.etapes.some((x) => x.id === s.id));
      rang = i >= 0 ? i : -1;
    }
    return {
      etape: rang >= 0 ? (liste[rang] ?? null) : null,
      rang: rang + 1,
      total: liste.length,
      aller: (sens: number) => {
        setVue(null);
        setDecalages((d) => ({ ...d, [noeudId]: Math.min(liste.length - 1, Math.max(0, rang + sens)) }));
      },
    };
  };

  const lancer = (o: { declencheurId?: string | null; seule?: string }) => {
    enregistrerWorkflow({ ...wfRef.current, graphe: grapheRef.current });
    // Attendre que l'enregistrement soit dans l'état, pour lancer le graphe à jour.
    setTimeout(() => {
      lancerWorkflow(wf.id, o);
      setVue(null);
      setDecalages({});
    }, 0);
  };

  const creerWebhook = (noeudId: string) => {
    const octets = crypto.getRandomValues(new Uint8Array(18));
    const secret = Array.from(octets, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
    enregistrerWorkflow({ ...wfRef.current, graphe: grapheRef.current, webhooks: { ...wfRef.current.webhooks, [noeudId]: secret } });
    const ws = getBridge()?.webhooks;
    if (ws) void ws.adresse(secret).then((r) => r.ok && setAdresses((a) => ({ ...a, [noeudId]: r.data })));
    else setAdresses((a) => ({ ...a, [noeudId]: "Relance l’app une fois pour activer les webhooks." }));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* L'état de l'exécution en cours, et l'aperçu d'une version. */}
      {(enCours || apercu) && (
        <div className="relative flex items-center gap-3 border-b border-bordure-subtile bg-fond-teinte-bleue px-4 py-2 text-ui-s text-texte-principal">
          {/* L'avancée de l'exécution, en bas du bandeau. */}
          {enCours && !apercu && (
            <span
              aria-hidden="true"
              className="absolute bottom-0 left-0 h-[2px] bg-bleu-k1-500 transition-[width] duration-500 ease-sortie"
              style={{ width: `${Math.min(100, (enCours.etapes.filter((s) => s.statut === "fait").length / Math.max(1, total)) * 100)}%` }}
            />
          )}
          {apercu ? (
            <>
              <Icon name="clock-backward" size={16} className="text-icone-secondaire" />
              <span className="flex-1">
                <span className="font-medium">Aperçu de la version</span> · {quandCourt(apercu.at)} · lecture seule
              </span>
              <Bouton variant="blanc" taille="mini" onClick={() => setApercu(null)}>
                Retour
              </Bouton>
              <Bouton
                variant="sombre"
                taille="mini"
                onClick={() => {
                  const actuel = { ...wfRef.current, graphe: grapheRef.current };
                  enregistrerWorkflow({
                    ...actuel,
                    versions: [{ id: crypto.randomUUID(), at: new Date().toISOString(), raison: "restauration" as const, graphe: grapheRef.current }, ...actuel.versions].slice(0, 50),
                  });
                  changer(() => apercu.graphe);
                  setApercu(null);
                }}
              >
                Rendre actuelle
              </Bouton>
            </>
          ) : (
            enCours && (
              <>
                {enCours.lancePar ? (
                  <AgentRond roleId={enCours.lancePar.roleId} taille={20} statut={{ type: "travaille" }} />
                ) : (
                  <Icon name="loader-01" size={16} className="text-icone-accent motion-safe:animate-spin" />
                )}
                <span className="flex-1">
                  <span className="font-medium">{LIBELLES_STATUT_EXECUTION[enCours.statut]}</span> · exécution {enCours.numero}
                  {enCours.lancePar && <> · lancée par {roles.find((r) => r.id === enCours.lancePar?.roleId)?.name ?? enCours.lancePar.roleId}</>} ·{" "}
                  <span className="klyra-mono tabular-nums">
                    {enCours.etapes.filter((s) => s.statut === "fait").length}/{total}
                  </span>
                </span>
                <Bouton variant="blanc" taille="mini" onClick={() => setHistorique(true)}>
                  Voir l’exécution
                </Bouton>
              </>
            )
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Canevas
          key={apercu?.id ?? "actuel"}
          wf={wf}
          graphe={apercu?.graphe ?? (construit && enTravaux ? construit.graphe : graphe)}
          lecture={!!apercu || enTravaux}
          construction={apercu ? null : construit}
          parcours={apercu || enTravaux ? undefined : parcours}
          enDirect={apercu ? undefined : enDirect}
          changer={changer}
          annuler={annuler}
          retablir={retablir}
          resultatDe={resultatDe}
          lancer={lancer}
          decider={deciderApprobation}
          creerWebhook={creerWebhook}
          adresses={adresses}
          auteur={state.currentUser.name}
          sorties={executions.flatMap((e) => e.etapes)}
        />
        {historique && <Historique wf={wf} executions={executions} vue={vue} onVue={setVue} onFermer={() => setHistorique(false)} />}
      </div>

      {/* Ce que la barre du haut pilote, rendu par l'écran. */}
      <BarreEditeur
        wf={wf}
        graphe={graphe}
        historique={historique}
        onHistorique={() => setHistorique(!historique)}
        onApercu={setApercu}
        onLancer={() => lancer({ declencheurId: null })}
        enCours={!!enCours}
        enTravaux={enTravaux}
        virtuel={!!construit?.nouveau && !state.workflows.some((w) => w.id === wf.id)}
      />
    </div>
  );
}

/* Deux emplacements gardent le lancement après le switch de vues. */
function BarreEditeur(props: {
  wf: Workflow;
  graphe: Graphe;
  historique: boolean;
  onHistorique: () => void;
  onApercu: (v: VersionWorkflow) => void;
  onLancer: () => void;
  enCours: boolean;
  enTravaux: boolean;
  virtuel: boolean;
}) {
  const [cibles, setCibles] = useState<{ outils: HTMLElement; lancement: HTMLElement } | null>(null);
  useEffect(() => {
    const outils = document.getElementById("barre-workflow");
    const lancement = document.getElementById("lancer-workflow");
    const id = setTimeout(() => setCibles(outils && lancement ? { outils, lancement } : null), 0);
    return () => clearTimeout(id);
  }, []);
  if (!cibles) return null;
  return <BarrePortail cible={cibles.outils} cibleLancement={cibles.lancement} {...props} />;
}

function BarrePortail({
  cible,
  cibleLancement,
  wf,
  historique,
  onHistorique,
  onApercu,
  onLancer,
  enCours,
  enTravaux,
  virtuel,
}: {
  cible: HTMLElement;
  cibleLancement: HTMLElement;
  wf: Workflow;
  graphe: Graphe;
  historique: boolean;
  onHistorique: () => void;
  onApercu: (v: VersionWorkflow) => void;
  onLancer: () => void;
  enCours: boolean;
  enTravaux: boolean;
  virtuel: boolean;
}) {
  const { enregistrerWorkflow } = useWorkspace();
  const projets = useProjects();
  const roles = useRoles();
  const [versions, setVersions] = useState(false);
  /* Un workflow encore en construction n'existe pas : rien à régler ni à lancer. */
  if (virtuel) return createPortal(<BoutonPrincipal disabled>En construction…</BoutonPrincipal>, cibleLancement);
  const contenu = (
    <div className="flex items-center gap-2">
      <PuceSelect
        libelle="Projet du workflow"
        icone={<Icon name="folder" size={16} />}
        options={[{ value: "", label: "Sans projet" }, ...projets.map((p) => ({ value: p.id, label: p.name }))]}
        value={wf.projectId ?? ""}
        onChange={(v) => enregistrerWorkflow({ ...wf, projectId: v || null })}
      />
      <div className="relative">
        <BoutonIcone taille="compact" icone={<Icon name="clock-backward" size={16} />} libelle="Historique des versions" onClick={() => setVersions(!versions)} />
        {versions && (
          <>
            <button type="button" aria-label="Fermer" className="fixed inset-0 z-30 cursor-default border-0 bg-transparent" onClick={() => setVersions(false)} />
            <div ref={apparition} role="menu" className="absolute top-[calc(100%+6px)] right-0 z-40 max-h-[360px] w-[260px] overflow-y-auto rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-lg">
              <span className="block px-2 pt-1 pb-1.5 text-ui-2xs font-medium text-texte-tertiaire">Historique des versions</span>
              {wf.versions.length === 0 ? (
                <p className="m-0 px-2 pb-2 text-ui-xs text-texte-tertiaire">Une version est gardée toutes les 5 minutes d’édition et avant chaque exécution.</p>
              ) : (
                wf.versions.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onApercu(v);
                      setVersions(false);
                    }}
                    className="flex w-full cursor-pointer flex-col rounded-sm border-0 bg-transparent px-2 py-1.5 text-left hover:bg-fond-survol"
                  >
                    <span className="text-ui-s text-texte-principal">{quandCourt(v.at)}</span>
                    <span className="text-ui-2xs text-texte-tertiaire">
                      {v.raison === "auto"
                        ? "Enregistrée auto"
                        : v.raison === "execution"
                          ? "Avant une exécution"
                          : v.raison === "agent"
                            ? `Avant la modification de ${roles.find((r) => r.id === v.par)?.name ?? "l’agent"}`
                            : "Avant une restauration"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
      <Bouton variant={historique ? "gris" : "blanc"} taille="compact" iconeGauche={<Icon name="list" size={16} />} onClick={onHistorique}>
        Exécutions
      </Bouton>
    </div>
  );
  return <>
    {createPortal(contenu, cible)}
    {createPortal(<BoutonPrincipal onClick={onLancer} disabled={enCours || enTravaux}>
      {enTravaux ? "En construction…" : enCours ? "En cours…" : "Lancer le workflow"}
    </BoutonPrincipal>, cibleLancement)}
  </>;
}

/* ─── L'écran ──────────────────────────────────────────────────── */

export function WorkflowsScreen({ entete }: { entete?: ReactNode }) {
  const { state, enregistrerWorkflow, supprimerWorkflow } = useWorkspace();
  const workflows = useMemo(() => [...state.workflows].sort((a, b) => b.majLe.localeCompare(a.majLe)), [state.workflows]);
  const demande = useSearchParams().get("workflow");
  const [ouvert, setOuvert] = useState<string | null>(demande);

  /* Un agent construit un workflow : la page l'ouvre, et le montre avant même qu'il soit enregistré. */
  const chantiers = useChantiers();
  const chantier = chantiers.find((c) => c.phase !== "fini") ?? chantiers[0] ?? null;
  const [suivis, setSuivis] = useState<{ chantier: string | null; execution: string | null; lien: string | null }>({ chantier: null, execution: null, lien: demande });
  const cleChantier = chantier ? `${chantier.cle}|${chantier.workflowId}` : null;
  /* Un agent lance un workflow : la page l'ouvre aussi, pour voir l'exécution passer. */
  const lanceeParAgent = state.executions.find((e) => e.lancePar && (e.statut === "en-cours" || e.statut === "approbation")) ?? null;
  if (cleChantier && cleChantier !== suivis.chantier) {
    setSuivis({ ...suivis, chantier: cleChantier });
    setOuvert(chantier!.workflowId);
  } else if (lanceeParAgent && lanceeParAgent.id !== suivis.execution) {
    setSuivis({ ...suivis, execution: lanceeParAgent.id });
    setOuvert(lanceeParAgent.workflowId);
  } else if (demande && demande !== suivis.lien) {
    setSuivis({ ...suivis, lien: demande });
    setOuvert(demande);
  }
  /* Le nouveau workflow, tant que l'agent l'écrit : il n'existe pas encore. */
  const enConstruction = chantier?.nouveau && !state.workflows.some((w) => w.id === chantier.workflowId) ? chantier : null;
  const titreVirtuel = enConstruction?.titre ?? "";
  const idVirtuel = enConstruction?.workflowId ?? null;
  const virtuel = useMemo<Workflow | null>(
    () => (idVirtuel ? { id: idVirtuel, titre: titreVirtuel, graphe: GRAPHE_VIDE, projectId: null, creeLe: "", majLe: "", versions: [] } : null),
    [idVirtuel, titreVirtuel],
  );
  const wf = workflows.find((w) => w.id === ouvert) ?? (virtuel && virtuel.id === ouvert ? virtuel : null) ?? workflows[0] ?? virtuel ?? null;
  const estVirtuel = !!virtuel && wf?.id === virtuel.id;
  const [liste, setListe] = useState(false);
  const [renommer, setRenommer] = useState(false);
  const [confirmer, setConfirmer] = useState(false);

  const creer = (w: Workflow) => {
    enregistrerWorkflow(w);
    setOuvert(w.id);
    setListe(false);
  };

  if (!wf)
    return (
      <div className="relative flex h-full items-center justify-center p-6">
        {entete && <div className="absolute top-3 right-4">{entete}</div>}
        <div ref={apparition} className="flex max-w-[460px] flex-col items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-lg bg-fond-surface-grise text-icone-secondaire">
            <Icon name="lightning-01" size={24} />
          </span>
          <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
            <span className="font-semibold">Tes workflows</span>
          </h1>
          <p className="m-0 text-ui text-texte-secondaire">
            Un déclencheur lance tes agents, l’un après l’autre : chacun passe son résultat au suivant. Ajoute des conditions, des
            approbations, et la sortie que tu veux.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <BoutonPrincipal onClick={() => creer(nouveauWorkflow())}>Nouveau workflow</BoutonPrincipal>
            <Bouton variant="blanc" taille="md" onClick={() => creer(exemple())}>
              Partir d’un exemple
            </Bouton>
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-bordure-subtile px-4 py-2.5">
        {/* Le choix du workflow. */}
        <div className="relative mr-auto flex min-w-0 items-center gap-1">
          {renommer ? (
            <input
              autoFocus
              defaultValue={wf.titre}
              aria-label="Nom du workflow"
              onBlur={(e) => {
                enregistrerWorkflow({ ...wf, titre: e.target.value.trim() || "Workflow sans titre" });
                setRenommer(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenommer(false);
              }}
              className="h-8 w-[280px] rounded-sm border border-bordure-forte bg-fond-surface px-2 text-ui font-semibold text-texte-principal focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setListe(!liste)}
              aria-expanded={liste}
              disabled={estVirtuel}
              className="flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent px-2 hover:bg-fond-survol disabled:cursor-default disabled:hover:bg-transparent"
            >
              <Icon name="lightning-01" size={16} className="shrink-0 text-icone-secondaire" />
              <span className="truncate text-ui font-semibold text-texte-principal">{wf.titre}</span>
              {!estVirtuel && <Icon name="chevron-down" size={14} className="shrink-0 text-icone-secondaire" />}
            </button>
          )}
          {chantier && chantier.workflowId === wf.id && chantier.phase !== "fini" && (
            <span className="ml-1 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-fond-teinte-bleue pr-2.5 pl-1 text-ui-2xs font-medium text-texte-accent">
              <AgentRond roleId={chantier.roleId} taille={16} statut={{ type: "travaille" }} fondPastille="surface" />
              En construction
            </span>
          )}
          {liste && (
            <>
              <button type="button" aria-label="Fermer" className="fixed inset-0 z-30 cursor-default border-0 bg-transparent" onClick={() => setListe(false)} />
              <div ref={apparition} role="menu" aria-label="Workflows" className="absolute top-[calc(100%+6px)] left-0 z-40 flex w-[300px] flex-col rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-lg">
                <span className="px-2 pt-1 pb-1.5 text-ui-2xs font-medium text-texte-tertiaire">Workflows</span>
                <div className="max-h-[280px] overflow-y-auto">
                  {workflows.map((w) => {
                    const n = w.graphe.noeuds.filter((x) => estEtape(x.type)).length;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOuvert(w.id);
                          setListe(false);
                        }}
                        className={cn("flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 px-2 py-1.5 text-left hover:bg-fond-survol", w.id === wf.id ? "bg-fond-surface-grise" : "bg-transparent")}
                      >
                        <span className="min-w-0 flex-1 truncate text-ui-s text-texte-principal">{w.titre}</span>
                        <span className="text-ui-2xs text-texte-tertiaire">
                          {n} étape{n > 1 ? "s" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <span className="my-1 h-px bg-bordure-subtile" />
                <button type="button" role="menuitem" onClick={() => creer(nouveauWorkflow())} className="flex cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-ui-s text-texte-principal hover:bg-fond-survol">
                  <Icon name="plus-01" size={16} className="text-icone-secondaire" /> Nouveau workflow
                </button>
                <button type="button" role="menuitem" onClick={() => creer(exemple())} className="flex cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-ui-s text-texte-principal hover:bg-fond-survol">
                  <Icon name="stars" size={16} className="text-icone-secondaire" /> Partir d’un exemple
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRenommer(true);
                    setListe(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-ui-s text-texte-principal hover:bg-fond-survol"
                >
                  <Icon name="pencil-01" size={16} className="text-icone-secondaire" /> Renommer
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => creer({ ...nouveauWorkflow(`Copie de ${wf.titre}`, wf.graphe), projectId: wf.projectId })}
                  className="flex cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-ui-s text-texte-principal hover:bg-fond-survol"
                >
                  <Icon name="copy-left" size={16} className="text-icone-secondaire" /> Dupliquer
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setConfirmer(true);
                    setListe(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-ui-s text-texte-erreur hover:bg-fond-survol"
                >
                  <Icon name="trash-01" size={16} /> Supprimer le workflow
                </button>
              </div>
            </>
          )}
        </div>
        <div id="barre-workflow" className="flex items-center" />
        {entete}
        <div id="lancer-workflow" className="flex items-center" />
      </header>
      {confirmer && (
        <div className="flex items-center gap-2 border-b border-bordure-subtile bg-fond-surface-grise px-4 py-2">
          <span className="flex-1 text-ui-s text-texte-principal">Supprimer « {wf.titre} » et ses exécutions ?</span>
          <Bouton
            variant="sombre"
            taille="mini"
            onClick={() => {
              supprimerWorkflow(wf.id);
              setOuvert(null);
              setConfirmer(false);
            }}
          >
            Supprimer
          </Bouton>
          <Bouton variant="blanc" taille="mini" onClick={() => setConfirmer(false)}>
            Annuler
          </Bouton>
        </div>
      )}
      <Editeur key={wf.id} wf={wf} chantier={chantier} />
    </div>
  );
}
