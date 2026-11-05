"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "klyra-ui";
import { MODELES } from "@/components/chat/ChoixModele";
import { Icon } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { FICHES, LIBELLES_STATUT_ETAPE, LIBELLES_STATUT_EXECUTION, nomNoeud } from "@/components/workflows/catalogue";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { cn } from "@/lib/cn";
import { reduit } from "@/lib/mouvement";
import { useLieuActif } from "@/lib/lieux";
import { libelleFrequence } from "@/lib/planning";
import { useGestePoste, useLecturePoste } from "@/lib/poste/client";
import { useUneFois } from "@/lib/telephone/geste";
import { messageGeste, useLectureSuivie } from "@/lib/telephone/lecture-suivie";
import {
  CHAMPS_ETAPE,
  enCoursExecution,
  entreeEtape,
  enTravaux,
  etatChantier,
  etatsEtapes,
  libelleAnnotations,
  libelleDeclencheur,
  libelleDerniere,
  libelleExecution,
  libelleUnDeclencheur,
  miseAPlat,
  nomFichier,
  RELECTURE_CHANTIER_MS,
  texteAnnotation,
  type ChampEtape,
  type ChantierLu,
  type EtapeLue,
  type LigneEtape,
  type LigneWorkflow,
  type NoeudLu,
  type ResumeExecution,
  type VersionLue,
  type WorkflowLu,
} from "@/lib/telephone/workflow-etapes";
import type { RoleTeinte } from "@/types/domain";
import { estEtape } from "@/types/workflows";
import { useAnnonce } from "./Annonce";
import { AvatarConstructeur, BandeauConstructionTelephone, couleurChantier, verbeChantier } from "./ChantierTelephone";
import { MenuPage } from "./CommunAgentsTelephone";
import { BOUTON_INACTIF, CHAMP_KLYRA_UI, MessageErreur } from "./Controles";
import { EnteteTelephone } from "./EnteteTelephone";
import { ConfirmationFeuille, Feuille, MenuFeuille, useFermerFeuille } from "./Feuille";
import { Carte, CLASSE_GROUPE, Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { useTirerPourRelire } from "./TirerPourRelire";
import { BandeauEtat, EtatEcran, NoteGeste, VueLecture, useAccesGeste } from "./etats";
import { useSupport } from "./poste";

/**
 * Automatisations › Workflows sur le téléphone (lot 7, E7-26 à E7-38). Le canevas devient une
 * lecture en étapes (`miseAPlat`) ; on lance, on approuve, on suit les exécutions, on gère le
 * workflow. Le contenu d'une étape, sa structure et la restauration d'une version restent sur
 * l'ordinateur (P-8) : ici, ils se lisent.
 */

export const urlWorkflows = (workflow?: string | null, version?: string | null) =>
  `/routines?vue=workflows${workflow ? `&workflow=${encodeURIComponent(workflow)}` : ""}${version ? `&version=${encodeURIComponent(version)}` : ""}`;

const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtJour = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });

/** « Aujourd'hui, 09:12 », « lun. 3 nov., 09:12 » : comme l'historique du bureau. */
function quandCourt(iso: string): string {
  const d = new Date(iso);
  const hier = new Date(Date.now() - 86_400_000);
  return `${d.toDateString() === new Date().toDateString() ? "Aujourd’hui" : d.toDateString() === hier.toDateString() ? "Hier" : fmtJour.format(d)}, ${fmtHeure.format(d)}`;
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
const PHRASE_AUCUN = "Les routines et les workflows tournent sur ton ordinateur.";
const RAISON_DESSIN = "Le dessin d’un workflow se fait au pointeur.";

function MarqueExecution({ statut }: { statut: ResumeExecution["statut"] }) {
  if (statut === "fait") return <PixelCheck className="h-[9px] w-3" />;
  if (statut === "en-cours" || statut === "approbation") return <Icon name="loader-01" size={18} className="text-icone-accent motion-safe:animate-spin" />;
  if (statut === "erreur") return <span aria-hidden className="size-2 rounded-full bg-texte-erreur" />;
  return <span aria-hidden className="size-2 rounded-full bg-icone-secondaire" />;
}

/** P-8 : un geste qui reste sur l'ordinateur, en ligne de groupe (E7-26, E7-29). */
function LigneSurPoste({ icone, nom }: { icone: "plus-01" | "pencil-01"; nom: string }) {
  const sur = useSupport();
  return (
    <GroupeListe>
      <LigneListe debut={<TuileIcone icone={icone} />} retrait="tuile" nom={nom} etiquette={<Etiquette>Sur {sur}</Etiquette>} ligne2={RAISON_DESSIN} />
    </GroupeListe>
  );
}

/* ─── E7-34 : les gestes du « ⋯ » d'un workflow ────────────────── */

interface WorkflowMenu {
  id: string;
  titre: string;
  /** « Manuel · 7 étapes » */
  sous: string;
  enCours: boolean;
}

const sousTitre = (declencheur: string, etapes: number) => `${declencheur} · ${etapes} étape${etapes > 1 ? "s" : ""}`;

function useActionsWorkflow({ relancer, executions, onSupprime }: { relancer: () => void; executions: (id: string) => void; onSupprime?: () => void }) {
  const router = useRouter();
  const sur = useSupport();
  const { possible } = useAccesGeste();
  const { faire, occupe } = useGestePoste();
  const annonce = useAnnonce();
  const annoncer = (texte: string) => annonce({ texte, icone: "check-01" });
  /* Le menu joue sa sortie pendant que la feuille suivante monte : deux états, pas un. */
  const [menu, setMenu] = useState<WorkflowMenu | null>(null);
  const [suite, setSuite] = useState<{ genre: "renommer" | "versions"; wf: WorkflowMenu } | null>(null);
  const geste = async <T,>(type: string, args: Record<string, unknown>, message: string, apres?: (data: T) => void) => {
    const r = await faire<T>(type, args);
    if (!r.ok) annonce({ texte: messageGeste(r, sur), erreur: true });
    else {
      annoncer(message);
      apres?.(r.data);
    }
    relancer();
  };
  const note = possible ? undefined : <NoteGeste className="text-ui-xs text-texte-secondaire" />;

  const rendu = (
    <>
      {menu ? (
        <MenuFeuille
          titre={menu.titre}
          objet={{ visuel: <TuileIcone grande icone="lightning-01" />, sous: menu.sous }}
          onFermer={() => setMenu(null)}
          actions={[
            { libelle: "Exécutions", icone: "list", onChoisir: () => executions(menu.id) },
            { libelle: "Historique des versions", icone: "clock-backward", onChoisir: () => setSuite({ genre: "versions", wf: menu }) },
            { libelle: "Renommer", icone: "pencil-01", desactivee: !possible, note, onChoisir: () => setSuite({ genre: "renommer", wf: menu }) },
            {
              libelle: "Dupliquer",
              icone: "copy-left",
              desactivee: !possible || occupe,
              note,
              onChoisir: () => void geste<{ id: string }>("workflows.dupliquer", { id: menu.id }, "Workflow dupliqué.", (d) => router.push(urlWorkflows(d.id))),
            },
            { libelle: "Relire", icone: "refresh-01", onChoisir: relancer },
            {
              libelle: "Supprimer le workflow…",
              icone: "trash-01",
              danger: !menu.enCours,
              separateurAvant: true,
              desactivee: !possible || menu.enCours,
              note: menu.enCours ? "Une exécution est en cours : arrête-la d’abord depuis Exécutions." : note,
              confirmation: { titre: `Supprimer « ${menu.titre} » et ses exécutions ?`, texte: `Il disparaît aussi de ${sur}. Les conversations de ses exécutions restent.`, confirmer: "Supprimer" },
              onChoisir: () => void geste("workflows.supprimer", { id: menu.id }, "Workflow supprimé.", onSupprime),
            },
          ]}
        />
      ) : null}
      {suite?.genre === "renommer" ? (
        <FeuilleRenommer
          wf={suite.wf}
          onFermer={() => setSuite(null)}
          onFait={() => {
            annoncer("Workflow renommé.");
            relancer();
          }}
        />
      ) : null}
      {suite?.genre === "versions" ? (
        <FeuilleVersions
          id={suite.wf.id}
          onFermer={() => setSuite(null)}
          onChoisir={(version) => {
            setSuite(null);
            router.push(urlWorkflows(suite.wf.id, version));
          }}
        />
      ) : null}
    </>
  );
  return { ouvrir: setMenu, rendu, annoncer };
}

function FeuilleRenommer({ wf, onFermer, onFait }: { wf: { id: string; titre: string }; onFermer: () => void; onFait: () => void }) {
  const [titre, setTitre] = useState(wf.titre);
  return (
    <Feuille titre="Renommer" onFermer={onFermer} pied={<PiedRenommer wf={wf} titre={titre} onFait={onFait} />}>
      <div className="flex flex-col gap-2 pt-1">
        <label htmlFor="renommer-workflow" className="text-ui font-medium text-texte-principal">
          Nom du workflow
        </label>
        <Input id="renommer-workflow" size="lg" data-autofocus value={titre} maxLength={200} onChange={(e) => setTitre(e.target.value)} className={CHAMP_KLYRA_UI} />
      </div>
    </Feuille>
  );
}

function PiedRenommer({ wf, titre, onFait }: { wf: { id: string; titre: string }; titre: string; onFait: () => void }) {
  const sur = useSupport();
  const { possible } = useAccesGeste();
  const { faire, occupe } = useGestePoste();
  const fermer = useFermerFeuille();
  const [erreur, setErreur] = useState<string | null>(null);
  const enregistrer = async () => {
    setErreur(null);
    const r = await faire("workflows.renommer", { id: wf.id, titre: titre.trim() });
    if (!r.ok) setErreur(messageGeste(r, sur));
    else {
      onFait();
      fermer();
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}
      <Bouton variant="sombre" taille="md" className="w-full" disabled={!possible || occupe || !titre.trim() || titre.trim() === wf.titre} onClick={() => void enregistrer()}>
        {occupe ? "Enregistrement…" : "Enregistrer"}
      </Bouton>
      {!possible ? <NoteGeste className="px-1 text-ui-xs text-texte-secondaire" /> : null}
    </div>
  );
}

const RAISONS: Record<VersionLue["raison"], string> = { auto: "Enregistrée auto", execution: "Avant une exécution", restauration: "Avant une restauration", agent: "Avant la modification d’un agent" };

function FeuilleVersions({ id, onFermer, onChoisir }: { id: string; onFermer: () => void; onChoisir: (version: string) => void }) {
  const lecture = useLecturePoste<VersionLue[]>("workflows.versions", { id });
  return (
    <Feuille titre="Historique des versions" onFermer={onFermer}>
      <div className="-mx-4">
        <VueLecture lecture={lecture} ferme={fermeWorkflows} lignes={3} gestes={null} verrou={false}>
          {(versions) =>
            versions.length === 0 ? (
              <p className="px-5 pb-2 text-ui text-texte-secondaire">Aucune version gardée pour l’instant.</p>
            ) : (
              <div className="px-4 pb-1">
                <GroupeListe>
                  {versions.map((v) => (
                    <LigneListe
                      key={v.id}
                      debut={<TuileIcone icone="clock-backward" />}
                      retrait="tuile"
                      nom={quandCourt(v.at)}
                      etiquette={v.actuelle ? <Etiquette ton="bleue">Actuelle</Etiquette> : null}
                      ligne2={`${RAISONS[v.raison]} · ${v.etapes} étape${v.etapes > 1 ? "s" : ""}`}
                      fin="chevron"
                      onClick={() => onChoisir(v.id)}
                    />
                  ))}
                </GroupeListe>
              </div>
            )
          }
        </VueLecture>
      </div>
    </Feuille>
  );
}

/* ─── E7-26 à E7-28 : la liste ─────────────────────────────────── */

export function WorkflowsListeTelephone({ onglets }: { onglets: ReactNode }) {
  const router = useRouter();
  /* Suivie pendant une exécution, et chaque seconde pendant qu'un agent construit un workflow. */
  const lieu = useLieuActif();
  const lecture = useLectureSuivie<LigneWorkflow[]>(
    "workflows.liste",
    { lieu },
    {
      suivre: (l) => l.some((w) => (w.derniere && enCoursExecution(w.derniere)) || w.chantier),
      intervalle: (l) => (l.some((w) => enTravaux(w.chantier)) ? RELECTURE_CHANTIER_MS : 5000),
    },
  );
  const tirer = useTirerPourRelire(lecture.relancer, { enCours: lecture.relecture });
  const actions = useActionsWorkflow({ relancer: lecture.relancer, executions: (id) => router.push(`${urlWorkflows(id)}&executions=1`) });
  const sur = useSupport();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Automatisations" parent="/plus" droite={<MenuPage titre="Automatisations" actions={[{ libelle: "Relire", icone: "refresh-01", onChoisir: lecture.relancer }]} />} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6" {...tirer.props}>
        {tirer.indicateur}
        <div className="px-4 pt-2 pb-4">{onglets}</div>
        <VueLecture lecture={lecture} ferme={fermeWorkflows} lignes={4} formeAucun="encadre" phraseAucun={PHRASE_AUCUN} gestes="Lancer et approuver" verrou={false}>
          {(liste) =>
            liste.length === 0 ? (
              <EtatEcran forme="encadre" icone="lightning-01" titre="Aucun workflow" texte={`Un workflow se dessine sur ${sur}, au pointeur. Tu le lances, tu suis ses exécutions et tu approuves ses étapes d’ici.`} />
            ) : (
              <div className="flex flex-col gap-4 px-4">
                <SectionListe titre="Tes workflows" compte={liste.length}>
                  <GroupeListe>
                    {liste.map((wf) => (
                      <LigneListeWorkflow
                        key={wf.id}
                        wf={wf}
                        onOuvrir={() => router.push(urlWorkflows(wf.id))}
                        onMenu={() => actions.ouvrir({ id: wf.id, titre: wf.titre, sous: sousTitre(wf.declencheur, wf.etapes), enCours: !!wf.derniere && enCoursExecution(wf.derniere) })}
                      />
                    ))}
                  </GroupeListe>
                </SectionListe>
                <LigneSurPoste icone="plus-01" nom="Nouveau workflow" />
              </div>
            )
          }
        </VueLecture>
      </div>
      {actions.rendu}
    </div>
  );
}

function LigneListeWorkflow({ wf, onOuvrir, onMenu }: { wf: LigneWorkflow; onOuvrir: () => void; onMenu: () => void }) {
  const c = wf.chantier ?? null;
  /* Un workflow qu'un agent crée n'existe pas encore sur l'ordinateur : rien à y faire, on regarde. */
  const virtuel = !!c?.nouveau && enTravaux(c);
  const d = wf.derniere;
  if (c && enTravaux(c))
    return (
      <LigneListe
        className="klyra-wf-pose"
        style={couleurChantier(c).style}
        onClick={onOuvrir}
        onMenu={virtuel ? undefined : onMenu}
        debut={<AvatarConstructeur chantier={c} />}
        retrait="avatar"
        nom={wf.titre}
        ligne2={
          <>
            <span className="block truncate">
              <span className="font-medium text-texte-principal">{c.agent.name}</span> {verbeChantier(c)} · {c.etapes} étape{c.etapes > 1 ? "s" : ""}
            </span>
            {c.gestes[0] ? <span className={cn("block truncate text-texte-tertiaire", c.phase === "ecrit" && "klyra-curseur-texte")}>{c.gestes[0]}</span> : null}
          </>
        }
        fin="chevron"
      />
    );
  const derniere = d ? libelleDerniere(d, wf.etapes) : null;
  return (
    <LigneListe
      className={c?.phase === "fini" ? "klyra-wf-eclat" : undefined}
      style={c ? couleurChantier(c).style : undefined}
      onClick={onOuvrir}
      onMenu={onMenu}
      debut={<TuileIcone icone="lightning-01" />}
      retrait="tuile"
      nom={wf.titre}
      ligne2={
        <>
          <span className="block truncate">{sousTitre(wf.declencheur, wf.etapes)}</span>
          <span className={cn("block truncate", derniere?.accent && "font-semibold text-texte-accent")}>
            {d && derniere ? (derniere.accent ? derniere.texte : `Dernière : ${quandCourt(d.debut)} · ${derniere.texte}`) : "Aucune exécution pour l’instant"}
          </span>
        </>
      }
      fin="chevron"
    />
  );
}

/* ─── E7-29 à E7-38 : un workflow ──────────────────────────────── */

export function WorkflowTelephone({ id, versionId, executionsOuvertes = false }: { id: string; versionId: string | null; executionsOuvertes?: boolean }) {
  const router = useRouter();
  const sur = useSupport();
  const { possible } = useAccesGeste();
  const [vue, setVue] = useState<string | null>(null);
  const [limite, setLimite] = useState(12);
  const lecture = useLectureSuivie<WorkflowLu>(
    "workflows.lire",
    { id, version: versionId, execution: vue, limite },
    {
      garde: `${id}|${versionId}`,
      suivre: (w) => !!w.enCours || !!w.chantier,
      intervalle: (w) => (enTravaux(w.chantier) ? RELECTURE_CHANTIER_MS : 4000),
    },
  );
  const { relancer } = lecture;
  const tirer = useTirerPourRelire(relancer, { enCours: lecture.relecture });
  const { faire, occupe } = useGestePoste();
  const uneFois = useUneFois();
  const [executions, setExecutions] = useState(executionsOuvertes);
  const [etape, setEtape] = useState<{ noeud: NoeudLu; numero: number } | null>(null);
  const [notes, setNotes] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [aArreter, setAArreter] = useState<ResumeExecution | null>(null);
  const actions = useActionsWorkflow({ relancer, executions: () => setExecutions(true), onSupprime: () => router.push(urlWorkflows()) });
  const { annoncer } = actions;
  const data = lecture.etat === "ok" ? lecture.data : lecture.etat === "ferme" ? (lecture.gardee?.data ?? null) : null;
  const gardee = lecture.etat === "ferme";
  const aPlat = useMemo(() => (data ? miseAPlat(data.noeuds, data.liens) : null), [data]);
  const etats = useMemo(() => etatsEtapes(data?.vue ?? null), [data]);
  const total = data?.noeuds.filter((n) => estEtape(n.type)).length ?? 0;
  const enCours = data?.executions.find((e) => e.id === data.enCours) ?? (data?.vue && data.vue.id === data.enCours ? data.vue : undefined);
  /* Un agent construit : on regarde, on ne modifie pas une étape qu'il est en train d'écrire. */
  const chantier = data?.chantier ?? null;
  const travaux = enTravaux(chantier);
  const lectureSeule = !!data?.version || travaux;
  const indisponible = !possible || occupe;
  const nomAgent = (agentId: string) => data?.agents.find((a) => a.id === agentId)?.name ?? "Agent indisponible";

  /* Une décision, un lancement : envoyés une fois. */
  const geste = (type: string, args: Record<string, unknown>, message: string, apres?: () => void) =>
    uneFois(async () => {
      setErreur(null);
      const r = await faire(type, args);
      if (!r.ok) setErreur(messageGeste(r, sur));
      else {
        annoncer(message);
        apres?.();
      }
      /* Toujours relire : sans réponse, le geste a pu aboutir ; l'écran le dira avant un nouvel essai. */
      relancer();
    });
  const lancer = () => void geste("workflows.lancer", { id }, "Workflow lancé", () => setVue(null));
  const decider = (etapeId: string, approuver: boolean) => void geste("workflows.approuver", { etapeId, approuver }, approuver ? "Approuvé : l’exécution continue." : "Refusé : l’exécution s’arrête.");
  const menu = data && !lectureSeule && !(chantier?.nouveau && travaux) && !gardee ? { id: data.id, titre: data.titre, sous: sousTitre(libelleDeclencheur(data.noeuds), total), enCours: !!data.enCours } : null;

  /* Supprimé ailleurs : le dire et mener à la liste (§ 4), pas « Réessayer » sur rien. */
  if (lecture.etat === "erreur" && lecture.code === "introuvable") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EnteteTelephone titre="Workflow" parent={urlWorkflows()} />
        <EtatEcran
          erreur
          icone="help-circle-contained"
          titre={lecture.message || `Ce workflow n’existe plus sur ${sur}.`}
          action={
            <Bouton variant="blanc" taille="md" onClick={() => router.push(urlWorkflows())}>
              Revenir aux workflows
            </Bouton>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone
        titre={data?.titre ?? "Workflow"}
        parent={versionId ? urlWorkflows(id) : urlWorkflows()}
        droite={menu ? <BoutonIcone variant="discret" className="size-11" libelle="Actions du workflow" aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => actions.ouvrir(menu)} /> : null}
      />
      {chantier ? <BandeauConstructionTelephone chantier={chantier} /> : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-6" {...tirer.props}>
        {tirer.indicateur}
        <VueLecture lecture={lecture} ferme={fermeWorkflows} formeAucun="encadre" phraseAucun={PHRASE_AUCUN} gestes="Lancer et approuver" verrou={false}>
          {(w) => (
            <div className="flex flex-col gap-3.5 px-4 pt-2">
              {!chantier && w.version ? (
                <BandeauEtat icone={<Icon name="clock-backward" size={20} />}>
                  <p>
                    <b className="font-semibold">Aperçu de la version</b> · {quandCourt(w.version.at)} · lecture seule
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Bouton variant="blanc" taille="compact" className="relative after:absolute after:inset-x-0 after:-inset-y-1.5" onClick={() => router.push(urlWorkflows(id))}>
                      Retour
                    </Bouton>
                    <p className="px-1 text-ui-xs text-texte-secondaire">Restaurer cette version : sur ton ordinateur.</p>
                  </div>
                </BandeauEtat>
              ) : !chantier && enCours ? (
                <BandeauEtat
                  icone={<Icon name="loader-01" size={20} className="text-icone-accent motion-safe:animate-spin" />}
                  action={
                    <Bouton variant="blanc" taille="compact" className="relative after:absolute after:inset-x-0 after:-inset-y-1.5" onClick={() => setExecutions(true)}>
                      Voir
                    </Bouton>
                  }
                >
                  <b className="font-semibold">{LIBELLES_STATUT_EXECUTION[enCours.statut]}</b> · exécution {enCours.numero} · {enCours.faits}/{total}
                </BandeauEtat>
              ) : null}
              {vue && w.vue && w.vue.id !== w.enCours ? (
                <div className="flex items-center gap-2 px-1">
                  <p className="min-w-0 flex-1 text-ui-xs text-texte-secondaire">
                    {w.vue.seule ? "Étape seule" : `Exécution ${w.vue.numero}`} · {issue(w.vue)}
                  </p>
                  <button type="button" onClick={() => setVue(null)} className="min-h-11 text-ui-xs text-texte-principal underline underline-offset-[3px]">
                    Afficher les derniers résultats
                  </button>
                </div>
              ) : null}
              {!aPlat?.lignes.length ? (
                <EtatEcran forme="encadre" icone="lightning-01" titre="Ce workflow n’a pas encore d’étape" texte={`Ses étapes se dessinent sur ${sur}, au pointeur.`} className="px-0 pb-0" />
              ) : (
                <ol aria-label="Étapes" className={CLASSE_GROUPE}>
                  {aPlat.lignes.map((ligne, i) => (
                    <LigneEtapeVue
                      key={ligne.genre === "etape" ? ligne.noeud.id : `${ligne.genre}-${i}`}
                      ligne={ligne}
                      wf={w}
                      etats={etats}
                      nomAgent={nomAgent}
                      indisponible={indisponible || !!w.version || gardee}
                      chantier={chantier}
                      onOuvrir={(noeud, numero) => setEtape({ noeud, numero })}
                      onDecider={decider}
                    />
                  ))}
                </ol>
              )}
              {aPlat?.annotations.length ? (
                <div className="px-1">
                  <button type="button" aria-expanded={notes} onClick={() => setNotes((v) => !v)} className="-my-2 flex min-h-11 items-center gap-1 text-ui font-medium text-texte-principal underline underline-offset-[3px]">
                    {libelleAnnotations(aPlat.annotations)}
                  </button>
                  {notes ? (
                    <ul className="flex flex-col gap-2 pt-3">
                      {aPlat.annotations.map((n) => (
                        <li key={n.id} className="rounded-md bg-fond-surface-grise px-3 py-2 text-ui break-words whitespace-pre-wrap text-texte-principal">
                          {texteAnnotation(n)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {w.version ? null : <LigneSurPoste icone="pencil-01" nom="Changer les étapes" />}
            </div>
          )}
        </VueLecture>
      </div>
      {data && travaux ? (
        <div className="shrink-0 border-t border-bordure-defaut bg-fond-page px-4 py-3">
          <BoutonPrincipal className={cn("w-full", BOUTON_INACTIF)} disabled>
            En construction…
          </BoutonPrincipal>
        </div>
      ) : data && !lectureSeule ? (
        <div className="shrink-0 border-t border-bordure-defaut bg-fond-page px-4 py-3">
          {erreur ? <MessageErreur className="pb-2">{erreur}</MessageErreur> : null}
          <BoutonPrincipal className={cn("w-full", BOUTON_INACTIF)} disabled={indisponible || !!data.enCours || total === 0 || lecture.relecture} onClick={lancer}>
            {data.enCours ? "En cours…" : "Lancer le workflow"}
          </BoutonPrincipal>
          {!possible ? <NoteGeste className="mt-1.5 px-1 text-ui-xs text-texte-secondaire" /> : null}
        </div>
      ) : erreur ? (
        <MessageErreur className="shrink-0 px-4 py-2">{erreur}</MessageErreur>
      ) : null}

      {etape && data ? <FeuilleEtape key={etape.noeud.id} wf={data} noeud={etape.noeud} numero={etape.numero} etat={etats.get(etape.noeud.id)} onFermer={() => setEtape(null)} /> : null}
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
          onArreter={setAArreter}
          onPlus={() => setLimite((n) => n + data.plus)}
          onFermer={() => setExecutions(false)}
        />
      ) : null}
      {aArreter ? (
        <ConfirmationFeuille
          titre={aArreter.seule ? "Arrêter cette étape ?" : `Arrêter l’exécution ${aArreter.numero} ?`}
          texte={aArreter.statut === "approbation" ? "Elle attend ton accord : elle s’arrête sans suite. Ce qui est déjà fait reste." : "L’étape en cours s’arrête, les suivantes ne partent pas. Ce qui est déjà fait reste."}
          confirmer="Arrêter"
          onFermer={() => setAArreter(null)}
          onConfirmer={() => void geste("workflows.arreter", { execution: aArreter.id }, "Exécution arrêtée.")}
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
  chantier,
  onOuvrir,
  onDecider,
}: {
  ligne: LigneEtape;
  wf: WorkflowLu;
  etats: Map<string, EtapeLue>;
  nomAgent: (id: string) => string;
  indisponible: boolean;
  /** Un agent construit le workflow : ses étapes à lui sont marquées, celle qu'il écrit suivie. */
  chantier: ChantierLu | null;
  onOuvrir: (noeud: NoeudLu, numero: number) => void;
  onDecider: (etapeId: string, approuver: boolean) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const etatTravaux = ligne.genre === "etape" ? etatChantier(chantier, ligne.noeud.id) : null;
  /* L'étape qu'il écrit reste à l'écran : la liste la suit, comme la caméra du bureau. */
  useEffect(() => {
    if (etatTravaux === "ecrit") ref.current?.scrollIntoView({ block: "nearest", behavior: reduit() ? "auto" : "smooth" });
  }, [etatTravaux]);
  if (ligne.genre === "branche") {
    return (
      <li style={{ paddingLeft: 40 + Math.max(0, ligne.niveau - 1) * 20 }} className="pt-2 pr-3 text-ui-xs font-semibold text-texte-secondaire">
        ↳ si {ligne.branche} :
      </li>
    );
  }
  if (ligne.genre === "saut") {
    return (
      <li style={{ paddingLeft: 40 + ligne.niveau * 20 }} className="pt-1 pr-3 pb-3 text-ui-xs text-texte-secondaire">
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
  const retrait = 12 + ligne.niveau * 20;
  const entree = attend ? entreeEtape(n.id, wf.liens, etats) : "";
  return (
    <li
      ref={ref}
      data-chantier={etatTravaux ?? undefined}
      style={etatTravaux ? couleurChantier(chantier).style : undefined}
      className={cn(
        "relative transition-[background-color] duration-300 ease-sortie [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-16 [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:bg-bordure-defaut [&:not(:first-child)]:before:content-['']",
        chantier?.nouveaux.includes(n.id) && "klyra-wf-pose",
        etatTravaux === "fantome" && "klyra-wf-ligne-fantome",
        etatTravaux === "ecrit" && "klyra-wf-ligne-ecrit",
        etatTravaux === "modif" && "klyra-wf-ligne-modif",
        etatTravaux === "ne" && "klyra-wf-eclat",
      )}
    >
      <button type="button" onClick={() => onOuvrir(n, ligne.numero)} style={{ paddingLeft: retrait }} className="flex min-h-[60px] w-full items-start gap-2.5 py-3 pr-3 text-left active:bg-fond-survol">
        <span className="w-4 shrink-0 pt-[7px] text-right text-ui font-semibold text-texte-secondaire tabular-nums">{ligne.numero}</span>
        {agent ? (
          <RondApercu agentId={agent} nom={nomAgent(agent)} teinte={(agentLu?.teinte ?? "jaune") as RoleTeinte} taille={32} className={agentLu?.actif === false ? "opacity-60" : undefined} />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xs bg-fond-surface-grise text-icone-defaut">
            <Icon name={FICHES[n.type].icone} size={18} />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body-s leading-[1.3] font-medium text-texte-principal">{titre}</span>
          {detail ? (
            <span className={cn("line-clamp-2 text-ui leading-[1.35] break-words text-texte-secondaire", etatTravaux === "ecrit" && "klyra-curseur-texte")}>{detail}</span>
          ) : etatTravaux === "ecrit" ? (
            <span className="klyra-curseur-texte text-ui-xs text-texte-tertiaire">{chantier?.agent.name} l’écrit</span>
          ) : null}
          {etat?.erreur ? <span className="line-clamp-2 text-ui-xs text-texte-erreur">{etat.erreur}</span> : null}
        </span>
        {etat ? (
          <span
            className={cn(
              "shrink-0 pt-1.5 text-ui-xs",
              etat.statut === "erreur" ? "font-medium text-texte-erreur" : etat.statut === "en-cours" || etat.statut === "approbation" ? "font-semibold text-texte-accent" : "text-texte-secondaire",
            )}
          >
            {LIBELLES_STATUT_ETAPE[etat.statut]}
            {etat.branche ? ` · ${etat.branche === "oui" ? "Oui" : "Non"}` : ""}
          </span>
        ) : null}
      </button>
      {attend && etat ? (
        <div className="-mt-1 flex flex-col gap-2.5 pr-3 pb-3.5" style={{ paddingLeft: retrait + 58 }}>
          {entree ? <p className="line-clamp-6 rounded-md bg-fond-surface-grise px-3 py-2.5 text-ui leading-[1.45] break-words whitespace-pre-wrap text-texte-principal">{entree}</p> : null}
          <div className="flex gap-2">
            <Bouton variant="blanc" taille="md" className="flex-1 px-2.5" disabled={indisponible} onClick={() => onDecider(etat.id, false)}>
              Refuser
            </Bouton>
            <Bouton variant="sombre" taille="md" className="flex-1 px-2.5" disabled={indisponible} onClick={() => onDecider(etat.id, true)}>
              Approuver
            </Bouton>
          </div>
          {indisponible ? <NoteGeste className="text-ui-xs text-texte-secondaire" /> : null}
        </div>
      ) : null}
    </li>
  );
}

const texte = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Le contenu d'une étape en une ou deux lignes, sous son nom. Un fichier par son nom, jamais son chemin. */
function detailEtape(n: NoeudLu, wf: WorkflowLu): string {
  const c = n.champs;
  switch (n.type) {
    case "declencheur": {
      const prochaine = wf.prochaines[n.id];
      return c.declencheur === "planifie" && prochaine ? `Prochaine exécution ${quandCourt(prochaine)}` : "";
    }
    case "prompt":
      return texte(c.texte) ? `« ${texte(c.texte)} »` : "";
    case "ressource":
      return texte(c.chemins).split("\n").filter(Boolean).map(nomFichier).join(", ");
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
      const nom = cible === "fichier" ? nomFichier(texte(c.chemin)) : texte(c.titre);
      return [cible === "notification" ? "Notification" : cible === "conversation" ? "Conversation" : "Fichier", nom].filter(Boolean).join(" · ");
    }
    default:
      return "";
  }
}

/* ─── E7-32 : le contenu d'une étape, en lecture seule ─────────── */

/** La valeur lisible d'un champ : le nom d'une option, d'un modèle ; un fichier par son nom. */
function valeurChamp(c: ChampEtape, noeud: NoeudLu): string {
  const brut = String(noeud.champs[c.cle] ?? FICHES[noeud.type].champs[c.cle] ?? "").trim();
  if (c.genre === "choix") return c.options.find((o) => o.id === brut)?.nom ?? "";
  if (c.genre === "modele") return MODELES.find((m) => m.id === brut)?.nom ?? "";
  if (noeud.type === "sortie" && c.cle === "chemin") return nomFichier(brut);
  return brut;
}

function FeuilleEtape({ wf, noeud, numero, etat, onFermer }: { wf: WorkflowLu; noeud: NoeudLu; numero: number; etat?: EtapeLue; onFermer: () => void }) {
  const cible = String(noeud.champs.cible ?? "notification");
  const visible = (c: ChampEtape) => {
    if (c.genre === "agent") return false;
    if (noeud.type === "sortie" && c.cle === "chemin") return cible === "fichier";
    if (noeud.type === "sortie" && c.cle === "titre") return cible !== "fichier";
    if (noeud.type === "llm" && c.cle === "effort") return noeud.champs.modele !== "haiku";
    return true;
  };
  const champs = CHAMPS_ETAPE[noeud.type].filter(visible).map((c) => ({ c, valeur: valeurChamp(c, noeud) })).filter((x) => x.valeur);
  const agent = noeud.type === "agent" ? String(noeud.champs.agent || "principal") : null;
  const agentLu = agent ? wf.agents.find((a) => a.id === agent) : undefined;
  const fichiers = noeud.type === "ressource" ? texte(noeud.champs.chemins).split("\n").filter(Boolean).map(nomFichier) : [];
  const execution = wf.vue;
  return (
    <Feuille titre={`Étape ${numero} · ${nomNoeud(noeud)}`} haute bordee onFermer={onFermer} pied={<p className="px-1 text-ui-xs text-texte-secondaire">Modifier cette étape : sur ton ordinateur.</p>}>
      <div className="flex flex-col gap-[18px] pt-3.5">
        {agent ? (
          <GroupeListe>
            <LigneListe
              debut={<RondApercu agentId={agent} nom={agentLu?.name ?? "Agent indisponible"} teinte={(agentLu?.teinte ?? "jaune") as RoleTeinte} taille={40} className={agentLu?.actif === false ? "opacity-60" : undefined} />}
              retrait="avatar"
              nom={agentLu?.name ?? "Agent indisponible"}
              ligne2={agentLu ? (agentLu.actif ? agentLu.tag : `${agentLu.tag} · désactivé`) : undefined}
            />
          </GroupeListe>
        ) : null}
        {champs.map(({ c, valeur }) => (
          <Carte key={c.cle} titre={<span className="text-ui font-semibold">{c.libelle}</span>}>
            <p className="mt-1 text-body-s leading-[1.45] break-words whitespace-pre-wrap">{valeur}</p>
          </Carte>
        ))}
        {noeud.type === "declencheur" && noeud.champs.declencheur === "planifie" && noeud.frequence ? (
          <Carte titre={<span className="text-ui font-semibold">Fréquence</span>}>
            <p className="mt-1 text-body-s leading-[1.45]">
              {libelleFrequence(noeud.frequence)}
              {wf.prochaines[noeud.id] ? ` · prochaine exécution ${quandCourt(wf.prochaines[noeud.id])}` : ""}
            </p>
          </Carte>
        ) : null}
        {fichiers.length ? (
          <GroupeListe>
            {fichiers.map((f, i) => (
              <LigneListe key={`${f}-${i}`} debut={<TuileIcone icone="file-01" />} retrait="tuile" nom={f} />
            ))}
          </GroupeListe>
        ) : null}
        {etat ? (
          <section className="flex flex-col gap-2 border-t border-bordure-defaut pt-3.5">
            <h3 className="px-1 text-ui font-semibold text-texte-principal">
              {etat.statut === "fait" ? "Résultat" : LIBELLES_STATUT_ETAPE[etat.statut]}
              {etat.branche ? ` · ${etat.branche === "oui" ? "Oui" : "Non"}` : ""}
              {execution && !execution.seule ? ` · exécution ${execution.numero}` : ""}
              {etat.passe > 1 ? ` · tour ${etat.passe}` : ""}
            </h3>
            {etat.erreur ? <p className="px-1 text-ui text-texte-erreur">{etat.erreur}</p> : null}
            {etat.sortie ? <p className="max-h-[40vh] overflow-y-auto rounded-md bg-fond-surface-grise px-3.5 py-3 text-ui leading-[1.5] break-words whitespace-pre-wrap text-texte-principal select-text">{etat.sortie}</p> : null}
          </section>
        ) : null}
      </div>
    </Feuille>
  );
}

/* ─── E7-33 : les exécutions d'un workflow, en feuille haute ───── */

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
  onArreter: (execution: ResumeExecution) => void;
  onPlus: () => void;
  onFermer: () => void;
}) {
  return (
    <Feuille titre="Exécutions" sousTitre={wf.titre} haute bordee onFermer={onFermer}>
      <div className="pt-3">
        {wf.executions.length === 0 ? <EtatEcran forme="encadre" icone="list" titre="Aucune exécution pour l’instant" className="px-0 pb-0" /> : null}
        {wf.executions.length ? (
          <GroupeListe>
            {wf.executions.map((e) => {
              const enCours = enCoursExecution(e);
              const source = e.source === "planifie" ? "Planifiée" : e.source === "webhook" ? "Webhook" : e.source === "agent" ? "Par un agent" : "Manuelle";
              return (
                <LigneExecutionWorkflow key={e.id} execution={e} source={source} enCours={enCours} choisie={vue === e.id} total={total} indisponible={indisponible} onVue={() => onVue(e.id)} onArreter={() => onArreter(e)} />
              );
            })}
          </GroupeListe>
        ) : null}
        {wf.plus > 0 ? (
          <Bouton variant="blanc" taille="md" className="mt-3.5 w-full" onClick={onPlus}>
            Afficher les exécutions plus anciennes
          </Bouton>
        ) : null}
      </div>
    </Feuille>
  );
}

function LigneExecutionWorkflow({
  execution: e,
  source,
  enCours,
  choisie,
  total,
  indisponible,
  onVue,
  onArreter,
}: {
  execution: ResumeExecution;
  source: string;
  enCours: boolean;
  choisie: boolean;
  total: number;
  indisponible: boolean;
  onVue: () => void;
  onArreter: () => void;
}) {
  return (
    <>
      <LigneListe
        onClick={onVue}
        retrait="tuile"
        debut={
          <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-md-moins", enCours ? "bg-fond-teinte-bleue" : "bg-fond-surface-grise", choisie && "ring-1 ring-bordure-forte")}>
            <MarqueExecution statut={e.statut} />
          </span>
        }
        nom={e.seule ? "Étape seule" : `Exécution ${e.numero}`}
        meta={source}
        ligne2={
          <>
            <span className="block truncate">
              {quandCourt(e.debut)} · {enCours ? <span className="font-semibold text-texte-accent">{libelleExecution(e, total)}</span> : issue(e)}
            </span>
            {e.arret && (e.statut === "approbation" || e.statut === "erreur") ? (
              <span className={cn("block truncate", e.statut === "erreur" && "text-texte-erreur")}>
                {e.statut === "approbation" ? "En attente à" : "Échec à"} : {e.arret}
                {e.erreur && e.statut === "erreur" ? ` · ${e.erreur}` : ""}
              </span>
            ) : e.erreur ? (
              <span className="block truncate text-texte-erreur">{e.erreur}</span>
            ) : null}
          </>
        }
        fin="chevron"
      />
      {enCours || e.chatId ? (
        <li className="flex flex-wrap gap-x-4 pr-4 pb-2 pl-16">
          {enCours ? (
            <button type="button" disabled={indisponible} onClick={onArreter} className="min-h-11 text-ui font-medium text-texte-principal underline underline-offset-[3px] disabled:text-texte-tertiaire">
              Arrêter
            </button>
          ) : null}
          {e.chatId ? (
            <Link href={`/chat?id=${encodeURIComponent(e.chatId)}`} className="flex min-h-11 items-center text-ui font-medium text-texte-principal underline underline-offset-[3px]">
              Voir la conversation
            </Link>
          ) : null}
          {enCours && indisponible ? <NoteGeste className="w-full text-ui-xs text-texte-secondaire" /> : null}
        </li>
      ) : null}
    </>
  );
}
