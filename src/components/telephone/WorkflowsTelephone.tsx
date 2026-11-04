"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input, Textarea } from "klyra-ui";
import { MODELES } from "@/components/chat/ChoixModele";
import { Icon } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { FICHES, LIBELLES_STATUT_ETAPE, LIBELLES_STATUT_EXECUTION, nomNoeud } from "@/components/workflows/catalogue";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { cn } from "@/lib/cn";
import { libelleFrequence, NOMS_JOURS } from "@/lib/planning";
import { useGestePoste, useLecturePoste } from "@/lib/poste/client";
import { majuscule } from "@/lib/poste-texte";
import { messageGeste, useLectureSuivie, useTirerPourRelire } from "@/lib/telephone/lecture-suivie";
import {
  CHAMPS_ETAPE,
  enCoursExecution,
  entreeEtape,
  etatsEtapes,
  libelleAnnotations,
  libelleExecution,
  libelleUnDeclencheur,
  miseAPlat,
  modifiable,
  texteAnnotation,
  type ChampEtape,
  type EtapeLue,
  type LigneEtape,
  type LigneWorkflow,
  type NoeudLu,
  type ResumeExecution,
  type VersionLue,
  type WorkflowLu,
} from "@/lib/telephone/workflow-etapes";
import type { Frequence, RoleTeinte } from "@/types/domain";
import { estEtape } from "@/types/workflows";
import { EnteteTelephone } from "./EnteteTelephone";
import { ConfirmationFeuille, Feuille, MenuFeuille, useAppuiLong } from "./Feuille";
import { NotePoste, SurLePoste, VueLecture, useBandeau } from "./etats";
import { usePostes, useSupport } from "./poste";

/**
 * Automatisations › Workflows sur le téléphone (spec mobile T-18, T-19). Le canevas devient une
 * lecture en étapes (`miseAPlat`) ; on lance, on approuve, on suit les exécutions et on modifie le
 * contenu d'une étape. La structure et le dessin restent sur l'ordinateur (P-8).
 */

export const urlWorkflows = (workflow?: string | null, version?: string | null) =>
  `/routines?vue=workflows${workflow ? `&workflow=${encodeURIComponent(workflow)}` : ""}${version ? `&version=${encodeURIComponent(version)}` : ""}`;

const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtJour = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });

/** « Aujourd'hui, 09:12 », « lun. 3 nov., 09:12 » : comme l'historique du bureau. */
function quandCourt(iso: string): string {
  const d = new Date(iso);
  return `${d.toDateString() === new Date().toDateString() ? "Aujourd’hui" : fmtJour.format(d)}, ${fmtHeure.format(d)}`;
}

function duree(e: ResumeExecution): string {
  const s = Math.max(1, Math.round(((e.fin ? new Date(e.fin) : new Date()).getTime() - new Date(e.debut).getTime()) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

/** L'issue d'une exécution finie, comme l'historique du bureau. */
function issue(e: ResumeExecution): string {
  return e.statut === "fait" ? "Réussie" : e.statut === "erreur" ? `Échec après ${duree(e)}` : e.statut === "arrete" ? `Arrêtée après ${duree(e)}` : LIBELLES_STATUT_EXECUTION[e.statut];
}

const fermeWorkflows = (sur: string) => `les workflows sont sur ${sur}. Ils s’affichent quand KLYRA y est ouverte.`;
const RAISON_DESSIN = "le dessin d’un workflow se fait au pointeur.";

function MarqueExecution({ statut }: { statut: ResumeExecution["statut"] }) {
  if (statut === "fait") return <PixelCheck className="h-[9px] w-3" />;
  if (statut === "en-cours" || statut === "approbation") return <Icon name="loader-01" size={16} className="text-icone-accent motion-safe:animate-spin" />;
  if (statut === "erreur") return <span aria-hidden className="size-2 rounded-full bg-texte-erreur" />;
  return <span aria-hidden className="size-2 rounded-full bg-icone-secondaire" />;
}

/* ─── Les gestes du « ⋯ » d'un workflow (T-18 et T-19) ─────────── */

type FeuilleActions = { genre: "menu" | "renommer" | "supprimer" | "versions"; wf: { id: string; titre: string } };

function useActionsWorkflow({ relancer, executions, onSupprime }: { relancer: () => void; executions?: () => void; onSupprime?: () => void }) {
  const router = useRouter();
  const sur = useSupport();
  const { ouvert } = usePostes();
  const { faire, occupe } = useGestePoste();
  const [bandeau, annoncer] = useBandeau();
  const [feuille, setFeuille] = useState<FeuilleActions | null>(null);
  const fermer = () => setFeuille(null);
  const geste = async <T,>(type: string, args: Record<string, unknown>, message: string, apres?: (data: T) => void) => {
    const r = await faire<T>(type, args);
    if (!r.ok) {
      annoncer(messageGeste(r, sur));
      return;
    }
    annoncer(message);
    apres?.(r.data);
    relancer();
  };
  const note = ouvert ? undefined : <NotePoste />;
  const wf = feuille?.wf;

  const rendu = (
    <>
      {feuille?.genre === "menu" && wf ? (
        <MenuFeuille
          titre={wf.titre}
          onFermer={fermer}
          actions={[
            ...(executions ? [{ libelle: "Exécutions", onChoisir: executions }] : []),
            { libelle: "Renommer", desactivee: !ouvert, note, onChoisir: () => setFeuille({ genre: "renommer", wf }) },
            {
              libelle: "Dupliquer",
              desactivee: !ouvert || occupe,
              note,
              onChoisir: () => void geste<{ id: string }>("workflows.dupliquer", { id: wf.id }, "Workflow dupliqué.", (d) => router.push(urlWorkflows(d.id))),
            },
            { libelle: "Supprimer le workflow", danger: true, desactivee: !ouvert, note, onChoisir: () => setFeuille({ genre: "supprimer", wf }) },
            { libelle: "Historique des versions", onChoisir: () => setFeuille({ genre: "versions", wf }) },
          ]}
        />
      ) : null}
      {feuille?.genre === "renommer" && wf ? <FeuilleRenommer
          wf={wf}
          onFermer={fermer}
          onFait={() => {
            annoncer("Enregistré");
            relancer();
          }}
        /> : null}
      {feuille?.genre === "supprimer" && wf ? (
        <ConfirmationFeuille
          titre={`Supprimer « ${wf.titre} » et ses exécutions ?`}
          confirmer="Supprimer"
          danger
          onFermer={fermer}
          onConfirmer={() => void geste("workflows.supprimer", { id: wf.id }, "Workflow supprimé.", onSupprime)}
        />
      ) : null}
      {feuille?.genre === "versions" && wf ? (
        <FeuilleVersions
          id={wf.id}
          onFermer={fermer}
          onChoisir={(version) => {
            fermer();
            router.push(urlWorkflows(wf.id, version));
          }}
        />
      ) : null}
      {bandeau}
    </>
  );
  return { ouvrir: (w: { id: string; titre: string }) => setFeuille({ genre: "menu", wf: w }), rendu, annoncer };
}

function FeuilleRenommer({ wf, onFermer, onFait }: { wf: { id: string; titre: string }; onFermer: () => void; onFait: () => void }) {
  const sur = useSupport();
  const { ouvert } = usePostes();
  const { faire, occupe } = useGestePoste();
  const [titre, setTitre] = useState(wf.titre);
  const [erreur, setErreur] = useState<string | null>(null);
  const enregistrer = async () => {
    const r = await faire("workflows.renommer", { id: wf.id, titre });
    if (!r.ok) setErreur(messageGeste(r, sur));
    else {
      onFait();
      onFermer();
    }
  };
  return (
    <Feuille
      titre="Renommer"
      onFermer={onFermer}
      pied={
        <>
          <Bouton variant="sombre" taille="md" className="w-full" disabled={!ouvert || occupe || titre.trim() === wf.titre} onClick={() => void enregistrer()}>
            Enregistrer
          </Bouton>
          {!ouvert ? <NotePoste /> : null}
        </>
      }
    >
      <Input size="lg" data-autofocus aria-label="Nom du workflow" value={titre} maxLength={200} onChange={(e) => setTitre(e.target.value)} className="rounded-md border-bordure-champ" />
      {erreur ? (
        <p role="alert" className="mt-2 text-ui-xs text-texte-erreur">
          {erreur}
        </p>
      ) : null}
    </Feuille>
  );
}

const RAISONS: Record<VersionLue["raison"], string> = { auto: "Enregistrée auto", execution: "Avant une exécution", restauration: "Avant une restauration" };

function FeuilleVersions({ id, onFermer, onChoisir }: { id: string; onFermer: () => void; onChoisir: (version: string) => void }) {
  const lecture = useLecturePoste<VersionLue[]>("workflows.versions", { id });
  return (
    <Feuille titre="Historique des versions" onFermer={onFermer}>
      <div className="-mx-4">
        <VueLecture lecture={lecture} ferme={fermeWorkflows} lignes={3}>
          {(versions) =>
            versions.length === 0 ? (
              <p className="px-4 text-ui text-texte-secondaire">Une version est gardée toutes les 5 minutes d’édition et avant chaque exécution.</p>
            ) : (
              <ul className="px-4">
                {versions.map((v) => (
                  <li key={v.id} className="border-b border-bordure-subtile last:border-b-0">
                    <button type="button" onClick={() => onChoisir(v.id)} className="flex min-h-14 w-full flex-col justify-center text-left active:bg-fond-survol">
                      <span className="text-body-s text-texte-principal">{quandCourt(v.at)}</span>
                      <span className="text-ui-xs text-texte-secondaire">
                        {RAISONS[v.raison]} · {v.etapes} étape{v.etapes > 1 ? "s" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          }
        </VueLecture>
      </div>
    </Feuille>
  );
}

/* ─── T-18 : la liste ──────────────────────────────────────────── */

export function WorkflowsListeTelephone({ onglets }: { onglets: ReactNode }) {
  const router = useRouter();
  const lecture = useLectureSuivie<LigneWorkflow[]>("workflows.liste", {}, { suivre: (l) => l.some((w) => w.derniere && enCoursExecution(w.derniere)) });
  const tirer = useTirerPourRelire(lecture.relancer);
  const actions = useActionsWorkflow({ relancer: lecture.relancer });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Automatisations" parent="/plus" />
      <div className="shrink-0 px-4 pb-2">{onglets}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6" {...tirer.props}>
        {tirer.tire ? <p className="py-2 text-ui-xs text-texte-secondaire">Relâche pour relire</p> : null}
        <div className="-mx-4">
          <VueLecture lecture={lecture} ferme={fermeWorkflows} lignes={4}>
            {(liste) => (
              <div className="px-4">
                {liste.length === 0 ? (
                  <p className="pt-6 text-body-s font-medium text-texte-principal">Aucun workflow</p>
                ) : (
                  <>
                    <h2 className="pt-3 pb-1 text-ui-xs font-medium text-texte-secondaire">Tes workflows</h2>
                    <ul>
                      {liste.map((wf) => (
                        <LigneListeWorkflow key={wf.id} wf={wf} onOuvrir={() => router.push(urlWorkflows(wf.id))} onMenu={() => actions.ouvrir(wf)} />
                      ))}
                    </ul>
                  </>
                )}
                <SurLePoste titre="Nouveau workflow" raison={RAISON_DESSIN} />
              </div>
            )}
          </VueLecture>
        </div>
      </div>
      {actions.rendu}
    </div>
  );
}

function LigneListeWorkflow({ wf, onOuvrir, onMenu }: { wf: LigneWorkflow; onOuvrir: () => void; onMenu: () => void }) {
  const appui = useAppuiLong(onMenu);
  const d = wf.derniere;
  return (
    <li className="flex items-center gap-1 border-b border-bordure-subtile" {...appui}>
      <button type="button" onClick={onOuvrir} className="flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 text-left active:bg-fond-survol">
        <span className="truncate text-body-s font-medium text-texte-principal">{wf.titre}</span>
        <span className="truncate text-ui-xs text-texte-secondaire">
          {wf.declencheur} · {wf.etapes} étape{wf.etapes > 1 ? "s" : ""}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-ui-xs text-texte-secondaire">
          {d ? (
            <>
              <MarqueExecution statut={d.statut} />
              <span className="truncate">
                Dernière : {quandCourt(d.debut)} · {libelleExecution(d, wf.etapes)}
              </span>
            </>
          ) : (
            "Aucune exécution pour l’instant"
          )}
        </span>
      </button>
      <BoutonIcone variant="discret" taille="md" libelle={`Actions de ${wf.titre}`} aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={onMenu} />
    </li>
  );
}

/* ─── T-19 : un workflow ───────────────────────────────────────── */

export function WorkflowTelephone({ id, versionId }: { id: string; versionId: string | null }) {
  const router = useRouter();
  const sur = useSupport();
  const { ouvert } = usePostes();
  const [vue, setVue] = useState<string | null>(null);
  const [limite, setLimite] = useState(12);
  const lecture = useLectureSuivie<WorkflowLu>(
    "workflows.lire",
    { id, version: versionId, execution: vue, limite },
    { garde: `${id}|${versionId}`, suivre: (w) => !!w.enCours, intervalle: 4000 },
  );
  const { relancer } = lecture;
  const tirer = useTirerPourRelire(relancer);
  const { faire, occupe } = useGestePoste();
  const [executions, setExecutions] = useState(false);
  const [etape, setEtape] = useState<{ noeud: NoeudLu; numero: number } | null>(null);
  const [notes, setNotes] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const actions = useActionsWorkflow({ relancer, executions: () => setExecutions(true), onSupprime: () => router.push(urlWorkflows()) });
  const { annoncer } = actions;
  const data = lecture.etat === "ok" ? lecture.data : null;
  const aPlat = useMemo(() => (data ? miseAPlat(data.noeuds, data.liens) : null), [data]);
  const etats = useMemo(() => etatsEtapes(data?.vue ?? null), [data]);
  const total = data?.noeuds.filter((n) => estEtape(n.type)).length ?? 0;
  const enCours = data?.executions.find((e) => e.id === data.enCours) ?? (data?.vue && data.vue.id === data.enCours ? data.vue : undefined);
  const lectureSeule = !!data?.version;
  const indisponible = !ouvert || occupe;
  const nomAgent = (agentId: string) => data?.agents.find((a) => a.id === agentId)?.name ?? agentId;

  const geste = async (type: string, args: Record<string, unknown>, message: string, apres?: () => void) => {
    setErreur(null);
    const r = await faire(type, args);
    if (!r.ok) {
      setErreur(messageGeste(r, sur));
      return;
    }
    annoncer(message);
    apres?.();
    relancer();
  };
  const lancer = () => void geste("workflows.lancer", { id }, "Workflow lancé", () => setVue(null));
  const decider = (etapeId: string, approuver: boolean) =>
    void geste("workflows.approuver", { etapeId, approuver }, approuver ? "Approuvé : l’exécution continue." : "Refusé : l’exécution s’arrête.");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone
        titre={data?.titre ?? "Workflow"}
        parent={versionId ? urlWorkflows(id) : urlWorkflows()}
        droite={
          data && !lectureSeule ? (
            <BoutonIcone variant="discret" taille="md" libelle="Actions du workflow" aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => actions.ouvrir(data)} />
          ) : null
        }
      />
      {data?.version ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-y border-bordure-subtile bg-fond-surface-grise px-4 py-2">
          <p className="min-w-0 flex-1 text-ui text-texte-principal">
            <span className="font-medium">Aperçu de la version</span> · {quandCourt(data.version.at)} · lecture seule
          </p>
          <Bouton variant="blanc" taille="md" onClick={() => router.push(urlWorkflows(id))}>
            Retour
          </Bouton>
          <Bouton
            variant="sombre"
            taille="md"
            disabled={indisponible}
            onClick={() => void geste("workflows.restaurer", { id, version: data.version!.id }, "Version rendue actuelle.", () => router.replace(urlWorkflows(id)))}
          >
            Rendre actuelle
          </Bouton>
        </div>
      ) : enCours ? (
        <div className="flex shrink-0 items-center gap-2 border-y border-bordure-subtile bg-fond-surface-grise px-4 py-2">
          <Icon name="loader-01" size={16} className="shrink-0 text-icone-accent motion-safe:animate-spin" />
          <p className="min-w-0 flex-1 text-ui text-texte-principal">
            <span className="font-medium">{LIBELLES_STATUT_EXECUTION[enCours.statut]}</span> · exécution {enCours.numero} · {enCours.faits}/{total}
          </p>
          <Bouton variant="blanc" taille="md" onClick={() => setExecutions(true)}>
            Voir l’exécution
          </Bouton>
        </div>
      ) : null}
      {vue && data?.vue && data.vue.id !== data.enCours ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-bordure-subtile px-4 py-1">
          <p className="min-w-0 flex-1 text-ui-xs text-texte-secondaire">
            {data.vue.seule ? "Étape seule" : `Exécution ${data.vue.numero}`} · {issue(data.vue)}
          </p>
          <button type="button" onClick={() => setVue(null)} className="min-h-11 text-ui-xs text-texte-principal underline underline-offset-2">
            Afficher les derniers résultats
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-6" {...tirer.props}>
        {tirer.tire ? <p className="px-4 py-2 text-ui-xs text-texte-secondaire">Relâche pour relire</p> : null}
        <VueLecture lecture={lecture} ferme={fermeWorkflows}>
          {(w) => (
            <div className="px-4 pt-2">
              {!aPlat?.lignes.length ? <p className="pt-4 text-body-s text-texte-principal">Ce workflow n’a pas encore d’étape.</p> : null}
              <ol aria-label="Étapes">
                {aPlat?.lignes.map((ligne, i) => (
                  <LigneEtapeVue
                    key={ligne.genre === "etape" ? ligne.noeud.id : `${ligne.genre}-${i}`}
                    ligne={ligne}
                    wf={w}
                    etats={etats}
                    nomAgent={nomAgent}
                    indisponible={indisponible}
                    onOuvrir={(noeud, numero) => setEtape({ noeud, numero })}
                    onDecider={decider}
                  />
                ))}
              </ol>
              {aPlat?.annotations.length ? (
                <div className="mt-4">
                  <button type="button" aria-expanded={notes} onClick={() => setNotes((v) => !v)} className="flex min-h-11 items-center gap-1 text-ui text-texte-principal underline underline-offset-2">
                    {libelleAnnotations(aPlat.annotations)}
                  </button>
                  {notes ? (
                    <ul className="flex flex-col gap-2 pb-2">
                      {aPlat.annotations.map((n) => (
                        <li key={n.id} className="rounded-md bg-fond-surface-grise px-3 py-2 text-ui break-words whitespace-pre-wrap text-texte-principal">
                          {texteAnnotation(n)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <SurLePoste raison={RAISON_DESSIN} />
            </div>
          )}
        </VueLecture>
      </div>
      {data && !lectureSeule ? (
        <div className="shrink-0 border-t border-bordure-subtile px-4 py-3">
          {erreur ? (
            <p role="alert" className="pb-2 text-ui-xs text-texte-erreur">
              {erreur}
            </p>
          ) : null}
          <BoutonPrincipal className="w-full" disabled={indisponible || !!data.enCours} onClick={lancer}>
            {data.enCours ? "En cours…" : "Lancer le workflow"}
          </BoutonPrincipal>
        </div>
      ) : erreur ? (
        <p role="alert" className="shrink-0 px-4 py-2 text-ui-xs text-texte-erreur">
          {erreur}
        </p>
      ) : null}

      {etape && data ? (
        <FeuilleEtape
          key={etape.noeud.id}
          wf={data}
          noeud={etape.noeud}
          numero={etape.numero}
          etat={etats.get(etape.noeud.id)}
          lectureSeule={lectureSeule}
          onFermer={() => setEtape(null)}
          onEnregistre={() => {
            setEtape(null);
            annoncer("Enregistré");
            relancer();
          }}
        />
      ) : null}
      {executions && data ? (
        <FeuilleExecutionsWorkflow
          wf={data}
          total={total}
          vue={vue}
          indisponible={indisponible}
          onVue={(execution) => {
            setVue(execution);
            setExecutions(false);
          }}
          onArreter={(execution) => void geste("workflows.arreter", { execution }, "Exécution arrêtée.")}
          onPlus={() => setLimite((n) => n + data.plus)}
          onFermer={() => setExecutions(false)}
        />
      ) : null}
      {actions.rendu}
    </div>
  );
}

/** Une ligne de la lecture en étapes : une étape, le début d'une branche, ou un saut vers une autre étape. */
function LigneEtapeVue({
  ligne,
  wf,
  etats,
  nomAgent,
  indisponible,
  onOuvrir,
  onDecider,
}: {
  ligne: LigneEtape;
  wf: WorkflowLu;
  etats: Map<string, EtapeLue>;
  nomAgent: (id: string) => string;
  indisponible: boolean;
  onOuvrir: (noeud: NoeudLu, numero: number) => void;
  onDecider: (etapeId: string, approuver: boolean) => void;
}) {
  const retrait = { paddingLeft: ligne.niveau * 20 };
  if (ligne.genre === "branche") {
    return (
      <li style={retrait} className="pt-2 text-ui-xs font-medium text-texte-secondaire">
        ↳ si {ligne.branche} :
      </li>
    );
  }
  if (ligne.genre === "saut") {
    return (
      <li style={retrait} className="py-2 text-ui-xs text-texte-secondaire">
        ↳ {ligne.branche ? `si ${ligne.branche} : ` : ""}
        {ligne.retour ? "retour à" : "passe à"} l’étape {ligne.vers.numero} · {ligne.vers.nom}
      </li>
    );
  }
  const n = ligne.noeud;
  const etat = etats.get(n.id);
  const agent = n.type === "agent" ? String(n.champs.agent || "principal") : null;
  const agentLu = agent ? wf.agents.find((a) => a.id === agent) : undefined;
  const titre = n.type === "declencheur" ? `${nomNoeud(n)} · ${libelleUnDeclencheur(n)}` : agent ? `${nomNoeud(n)} · ${nomAgent(agent)}` : nomNoeud(n);
  const detail = detailEtape(n, wf);
  const attend = etat?.statut === "approbation";
  return (
    <li style={retrait} className="border-b border-bordure-subtile">
      <button type="button" onClick={() => onOuvrir(n, ligne.numero)} className="flex min-h-14 w-full items-start gap-3 py-3 text-left active:bg-fond-survol">
        <span className="w-5 shrink-0 pt-1 text-ui font-medium text-texte-secondaire tabular-nums">{ligne.numero}</span>
        {agent ? (
          <RondApercu agentId={agent} nom={nomAgent(agent)} teinte={(agentLu?.teinte ?? "jaune") as RoleTeinte} taille={28} className={agentLu?.actif === false ? "opacity-60" : undefined} />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-xs bg-fond-surface-grise text-icone-secondaire">
            <Icon name={FICHES[n.type].icone} size={16} />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body-s font-medium text-texte-principal">{titre}</span>
          {detail ? <span className="line-clamp-2 text-ui-xs break-words text-texte-secondaire">{detail}</span> : null}
          {etat?.erreur ? <span className="line-clamp-2 text-ui-xs text-texte-erreur">{etat.erreur}</span> : null}
        </span>
        {etat ? (
          <span className={cn("shrink-0 pt-1 text-ui-xs", etat.statut === "erreur" ? "text-texte-erreur" : etat.statut === "fait" ? "text-texte-secondaire" : "font-medium text-texte-principal")}>
            {LIBELLES_STATUT_ETAPE[etat.statut]}
            {etat.branche ? ` · ${etat.branche === "oui" ? "Oui" : "Non"}` : ""}
          </span>
        ) : null}
      </button>
      {attend && etat ? (
        <div className="flex flex-col gap-2 pb-3 pl-8">
          {entreeEtape(n.id, wf.liens, etats) ? (
            <p className="line-clamp-6 rounded-md bg-fond-surface-grise px-3 py-2 text-ui break-words whitespace-pre-wrap text-texte-principal">{entreeEtape(n.id, wf.liens, etats)}</p>
          ) : null}
          <div className="flex gap-2">
            <Bouton variant="blanc" taille="md" className="flex-1" disabled={indisponible} onClick={() => onDecider(etat.id, false)}>
              Refuser
            </Bouton>
            <Bouton variant="sombre" taille="md" className="flex-1" disabled={indisponible} onClick={() => onDecider(etat.id, true)}>
              Approuver
            </Bouton>
          </div>
          {indisponible ? <NotePoste /> : null}
        </div>
      ) : null}
    </li>
  );
}

const texte = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Le contenu d'une étape en une ou deux lignes, sous son nom. */
function detailEtape(n: NoeudLu, wf: WorkflowLu): string {
  const c = n.champs;
  switch (n.type) {
    case "declencheur": {
      const prochaine = wf.prochaines[n.id];
      return c.declencheur === "planifie" && prochaine ? `Prochaine exécution ${quandCourt(prochaine)}` : "";
    }
    case "prompt":
      return texte(c.texte) ? `« ${texte(c.texte)} »` : "";
    case "ressource": {
      const chemins = texte(c.chemins).split("\n").filter(Boolean);
      return chemins.map((chemin) => chemin.split(/[\\/]/).at(-1)).join(", ");
    }
    case "agent":
      return texte(c.tache);
    case "llm":
      return [MODELES.find((m) => m.id === (texte(c.modele) || "sonnet"))?.nom, texte(c.prompt)].filter(Boolean).join(" · ");
    case "image":
      return texte(c.description);
    case "condition":
      return texte(c.regle);
    case "approbation":
      return texte(c.question) ? `« ${texte(c.question)} »` : "";
    case "sortie": {
      const cible = texte(c.cible) || "notification";
      const nom = cible === "fichier" ? texte(c.chemin) : texte(c.titre);
      return [cible === "notification" ? "Notification" : cible === "conversation" ? "Conversation" : "Fichier", nom].filter(Boolean).join(" · ");
    }
    default:
      return "";
  }
}

/* ─── Le contenu d'une étape, en feuille ───────────────────────── */

const FREQUENCES = [
  { value: "heure", label: "Chaque heure" },
  { value: "jour", label: "Chaque jour" },
  { value: "jours-ouvres", label: "En semaine" },
  { value: "semaine", label: "Chaque semaine" },
  { value: "mois", label: "Chaque mois" },
];

function FeuilleEtape({
  wf,
  noeud,
  numero,
  etat,
  lectureSeule,
  onFermer,
  onEnregistre,
}: {
  wf: WorkflowLu;
  noeud: NoeudLu;
  numero: number;
  etat?: EtapeLue;
  lectureSeule: boolean;
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const sur = useSupport();
  const { ouvert } = usePostes();
  const { faire, occupe } = useGestePoste();
  const champs = CHAMPS_ETAPE[noeud.type];
  const initial = (c: ChampEtape) => String(noeud.champs[c.cle] ?? FICHES[noeud.type].champs[c.cle] ?? "");
  const [valeurs, setValeurs] = useState<Record<string, string>>(() => Object.fromEntries(champs.map((c) => [c.cle, initial(c)])));
  const [frequence, setFrequence] = useState<Frequence>(noeud.frequence ?? { type: "jour", heure: "09:00" });
  const [erreur, setErreur] = useState<string | null>(null);
  const modifies = champs.filter((c) => valeurs[c.cle] !== initial(c));
  const planifie = noeud.type === "declencheur" && valeurs.declencheur === "planifie";
  const frequenceModifiee = planifie && JSON.stringify(frequence) !== JSON.stringify(noeud.frequence ?? null);
  const editable = !lectureSeule && modifiable(noeud.type);
  const actifs = wf.agents.filter((a) => a.actif);

  const enregistrer = async () => {
    setErreur(null);
    const r = await faire("workflows.modifierEtape", {
      id: wf.id,
      noeudId: noeud.id,
      patch: { champs: Object.fromEntries(modifies.map((c) => [c.cle, valeurs[c.cle]])), ...(frequenceModifiee ? { frequence } : {}) },
      avant: { champs: Object.fromEntries(modifies.map((c) => [c.cle, noeud.champs[c.cle] ?? null])), frequence: noeud.frequence ?? null },
    });
    if (r.ok) onEnregistre();
    else setErreur(messageGeste(r, sur));
  };

  const visible = (c: ChampEtape) => {
    if (noeud.type === "sortie" && c.cle === "chemin") return valeurs.cible === "fichier";
    if (noeud.type === "sortie" && c.cle === "titre") return valeurs.cible !== "fichier";
    if (noeud.type === "llm" && c.cle === "effort") return valeurs.modele !== "haiku";
    return true;
  };
  const placeholder = (c: ChampEtape & { genre: "texte" }) => (noeud.type === "sortie" && c.cle === "titre" && valeurs.cible === "conversation" ? "Nom de la conversation" : c.placeholder);
  const choisir = (cle: string, valeur: string) => setValeurs((v) => ({ ...v, [cle]: valeur }));
  const champHeure = "heure" in frequence ? frequence.heure : "09:00";
  const champJour = "jour" in frequence ? frequence.jour : 1;
  const sortie = etat?.sortie;

  return (
    <Feuille
      titre={`Étape ${numero} · ${nomNoeud(noeud)}`}
      haute={noeud.type === "agent" || noeud.type === "llm" || noeud.type === "prompt"}
      onFermer={onFermer}
      pied={
        editable ? (
          <>
            {erreur ? (
              <p role="alert" className="pb-2 text-ui-xs text-texte-erreur">
                {erreur}
              </p>
            ) : null}
            <Bouton variant="sombre" taille="md" className="w-full" disabled={!ouvert || occupe || (!modifies.length && !frequenceModifiee)} onClick={() => void enregistrer()}>
              Enregistrer
            </Bouton>
            {!ouvert ? <NotePoste /> : null}
          </>
        ) : undefined
      }
    >
      <fieldset disabled={!editable || occupe} className="flex flex-col gap-4">
        {champs.filter(visible).map((c) => (
          <div key={c.cle} className="flex flex-col gap-2">
            <span className="text-ui-s font-medium text-texte-principal">{c.libelle}</span>
            {c.genre === "texte" ? (
              c.lignes === 1 ? (
                <Input size="lg" aria-label={c.libelle} value={valeurs[c.cle]} placeholder={placeholder(c)} onChange={(e) => choisir(c.cle, e.target.value)} className="rounded-md border-bordure-champ" />
              ) : (
                <Textarea
                  size="lg"
                  autoGrow
                  aria-label={c.libelle}
                  value={valeurs[c.cle]}
                  placeholder={placeholder(c)}
                  onChange={(e) => choisir(c.cle, e.target.value)}
                  className={cn("rounded-md border-bordure-champ", c.lignes > 2 ? "min-h-[120px]" : "min-h-[72px]")}
                />
              )
            ) : c.genre === "choix" ? (
              <div role="radiogroup" aria-label={c.libelle} className="flex flex-wrap gap-2">
                {c.options
                  .filter((o) => !(noeud.type === "declencheur" && o.id === "webhook" && initial(c) !== "webhook"))
                  .map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={valeurs[c.cle] === o.id}
                      onClick={() => choisir(c.cle, o.id)}
                      className={cn(
                        "min-h-11 rounded-xs border px-3 text-ui disabled:opacity-60",
                        valeurs[c.cle] === o.id ? "klyra-surface-sombre border-transparent text-texte-inverse" : "border-bordure-subtile bg-fond-surface text-texte-principal",
                      )}
                    >
                      {o.nom}
                    </button>
                  ))}
              </div>
            ) : c.genre === "agent" ? (
              <div className="[&_button]:min-h-12 [&_button]:text-body-s">
                <ListeDeroulante
                  libelle={c.libelle}
                  value={valeurs[c.cle]}
                  disabled={!editable || occupe}
                  options={[
                    ...(actifs.some((a) => a.id === valeurs[c.cle])
                      ? []
                      : [{ value: valeurs[c.cle], label: `${wf.agents.find((a) => a.id === valeurs[c.cle])?.name ?? valeurs[c.cle]} · désactivé`, disabled: true }]),
                    ...actifs.map((a) => ({ value: a.id, label: a.tag ? `${a.name} · ${a.tag}` : a.name, icone: <RondApercu agentId={a.id} nom={a.name} teinte={a.teinte as RoleTeinte} taille={20} /> })),
                  ]}
                  onChange={(v) => choisir(c.cle, v)}
                />
              </div>
            ) : (
              <div className="[&_button]:min-h-12 [&_button]:text-body-s">
                <ListeDeroulante libelle={c.libelle} value={valeurs[c.cle]} disabled={!editable || occupe} options={MODELES.map((m) => ({ value: m.id, label: m.nom }))} onChange={(v) => choisir(c.cle, v)} />
              </div>
            )}
          </div>
        ))}
        {planifie ? (
          <div className="flex flex-col gap-2">
            <span className="text-ui-s font-medium text-texte-principal">Fréquence</span>
            <div className="[&_button]:min-h-12 [&_button]:text-body-s">
              <ListeDeroulante
                libelle="Fréquence"
                value={frequence.type === "manuel" ? "jour" : frequence.type}
                disabled={!editable || occupe}
                options={FREQUENCES}
                onChange={(t) =>
                  setFrequence(
                    t === "heure"
                      ? { type: "heure" }
                      : t === "semaine"
                        ? { type: "semaine", jour: Math.min(champJour, 7), heure: champHeure }
                        : t === "mois"
                          ? { type: "mois", jour: champJour, heure: champHeure }
                          : { type: t as "jour" | "jours-ouvres", heure: champHeure },
                  )
                }
              />
            </div>
            {frequence.type === "semaine" ? (
              <div className="[&_button]:min-h-12 [&_button]:text-body-s">
                <ListeDeroulante
                  libelle="Jour"
                  value={String(frequence.jour)}
                  disabled={!editable || occupe}
                  options={NOMS_JOURS.map((nom, i) => ({ value: String(i + 1), label: majuscule(nom) }))}
                  onChange={(j) => setFrequence({ ...frequence, jour: Number(j) })}
                />
              </div>
            ) : null}
            {frequence.type === "mois" ? (
              <div className="[&_button]:min-h-12 [&_button]:text-body-s">
                <ListeDeroulante
                  libelle="Jour du mois"
                  value={String(frequence.jour)}
                  disabled={!editable || occupe}
                  options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "le 1er" : `le ${i + 1}` }))}
                  onChange={(j) => setFrequence({ ...frequence, jour: Number(j) })}
                />
              </div>
            ) : null}
            {frequence.type !== "heure" && frequence.type !== "manuel" ? (
              <Input size="lg" type="time" aria-label="Heure" value={champHeure} onChange={(e) => setFrequence({ ...frequence, heure: e.target.value })} className="rounded-md border-bordure-champ" />
            ) : null}
            <p className="text-ui-xs text-texte-secondaire">
              {libelleFrequence(frequence)}
              {wf.prochaines[noeud.id] ? ` · prochaine exécution ${quandCourt(wf.prochaines[noeud.id])}` : ""}
            </p>
          </div>
        ) : null}
      </fieldset>
      {noeud.type === "declencheur" && valeurs.declencheur === "webhook" ? <SurLePoste raison="l’adresse du webhook est servie par l’ordinateur." /> : null}
      {noeud.type === "ressource" ? (
        <>
          <ul className="flex flex-col gap-1">
            {texte(noeud.champs.chemins)
              .split("\n")
              .filter(Boolean)
              .map((chemin) => (
                <li key={chemin} className="flex items-center gap-2 text-ui break-all text-texte-principal">
                  <Icon name="file-01" size={16} className="shrink-0 text-icone-secondaire" />
                  {chemin}
                </li>
              ))}
          </ul>
          <SurLePoste raison="les fichiers d’une ressource se choisissent sur l’ordinateur." />
        </>
      ) : null}
      {etat ? (
        <section className="mt-4 flex flex-col gap-2 border-t border-bordure-subtile pt-3">
          <h3 className="text-ui-s font-medium text-texte-principal">
            {etat.statut === "fait" ? "Résultat" : LIBELLES_STATUT_ETAPE[etat.statut]}
            {etat.branche ? ` · ${etat.branche === "oui" ? "Oui" : "Non"}` : ""}
            {etat.passe > 1 ? ` · tour ${etat.passe}` : ""}
          </h3>
          {etat.erreur ? <p className="text-ui-xs text-texte-erreur">{etat.erreur}</p> : null}
          {sortie ? <p className="max-h-[40vh] overflow-y-auto rounded-md bg-fond-surface-grise px-3 py-2 text-ui break-words whitespace-pre-wrap text-texte-principal select-text">{sortie}</p> : null}
        </section>
      ) : null}
      {lectureSeule ? <p className="mt-3 text-ui-xs text-texte-secondaire">Aperçu d’une version : lecture seule.</p> : null}
    </Feuille>
  );
}

/* ─── Les exécutions d'un workflow, en feuille haute ───────────── */

function FeuilleExecutionsWorkflow({
  wf,
  total,
  vue,
  indisponible,
  onVue,
  onArreter,
  onPlus,
  onFermer,
}: {
  wf: WorkflowLu;
  total: number;
  vue: string | null;
  indisponible: boolean;
  onVue: (execution: string) => void;
  onArreter: (execution: string) => void;
  onPlus: () => void;
  onFermer: () => void;
}) {
  return (
    <Feuille titre="Exécutions" haute onFermer={onFermer}>
      {wf.executions.length === 0 ? <p className="text-ui text-texte-secondaire">Aucune exécution pour l’instant.</p> : null}
      <ul className="flex flex-col">
        {wf.executions.map((e) => {
          const enCours = enCoursExecution(e);
          return (
            <li key={e.id} className={cn("flex flex-col gap-1 border-b border-bordure-subtile py-2", vue === e.id && "bg-fond-surface-grise")}>
              <button type="button" onClick={() => onVue(e.id)} className="flex min-h-11 flex-col gap-0.5 text-left active:bg-fond-survol">
                <span className="flex items-center gap-2">
                  <MarqueExecution statut={e.statut} />
                  <span className="flex-1 text-ui font-medium text-texte-principal">{e.seule ? "Étape seule" : `Exécution ${e.numero}`}</span>
                  <span className="text-ui-xs text-texte-secondaire">{e.source === "planifie" ? "Planifiée" : e.source === "webhook" ? "Webhook" : "Manuelle"}</span>
                </span>
                <span className="text-ui-xs text-texte-secondaire">
                  {quandCourt(e.debut)} · {enCours ? libelleExecution(e, total) : issue(e)}
                </span>
                {e.arret && (e.statut === "approbation" || e.statut === "erreur") ? (
                  <span className="text-ui-xs text-texte-secondaire">
                    {e.statut === "approbation" ? "En attente à" : "Échec à"} : {e.arret}
                  </span>
                ) : null}
                {e.erreur ? <span className="text-ui-xs text-texte-erreur">{e.erreur}</span> : null}
              </button>
              <span className="flex flex-wrap gap-x-4">
                {enCours ? (
                  <button type="button" disabled={indisponible} onClick={() => onArreter(e.id)} className="min-h-11 text-ui font-medium text-texte-principal underline underline-offset-2 disabled:opacity-60">
                    Arrêter
                  </button>
                ) : null}
                {e.chatId ? (
                  <Link href={`/chat?id=${encodeURIComponent(e.chatId)}`} className="flex min-h-11 items-center text-ui text-texte-principal underline underline-offset-2">
                    Voir la conversation
                  </Link>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {wf.plus > 0 ? (
        <Bouton variant="blanc" taille="md" className="mt-3" onClick={onPlus}>
          Afficher les exécutions plus anciennes
        </Bouton>
      ) : null}
    </Feuille>
  );
}

