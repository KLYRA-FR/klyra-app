"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { dateUneFoisPassee } from "@/components/routines/CarteRoutine";
import { apercuAgent } from "@/components/routines/ColonneAgents";
import { MarqueRun } from "@/components/routines/MarqueRun";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { cn } from "@/lib/cn";
import { useServeursRelies } from "@/lib/lieux";
import { useGestePoste } from "@/lib/poste/client";
import { majuscule } from "@/lib/poste-texte";
import { dureeRun, libellePlanning, libelleRun, lienRun, runActif } from "@/lib/routines-affichage";
import { roleLisible } from "@/lib/telephone/agents";
import { useUneFois } from "@/lib/telephone/geste";
import { messageGeste, useLectureSuivie } from "@/lib/telephone/lecture-suivie";
import {
  ecrireBrouillon,
  essaiPossible,
  initialeDe,
  lireBrouillon,
  nouvelleRoutine,
  quandRelatif,
  routineDejaCreee,
  valeursRoutine,
  type AgentLu,
  type BrouillonRoutine,
  type ExecutionsLues,
  type RoutinesLues,
} from "@/lib/telephone/routines-telephone";
import type { RoleTeinte } from "@/types/domain";
import type { Routine, RoutineInput, RoutineRun } from "@/types/routines";
import { MenuPage } from "./CommunAgentsTelephone";
import { BOUTON_INACTIF } from "./Controles";
import { EnteteTelephone } from "./EnteteTelephone";
import { ConfirmationFeuille, Feuille, MenuFeuille, useAppuiLong, type ActionMenu } from "./Feuille";
import { FormulaireRoutineTelephone, type ContexteRoutine } from "./FormulaireRoutineTelephone";
import { Carte, Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { useTirerPourRelire } from "./TirerPourRelire";
import { EtatEcran, NotePoste, VueLecture, useBandeau, useVueGardeeAffichee } from "./etats";
import { usePostes, useSupport } from "./poste";

/**
 * Automatisations › Routines sur le téléphone (lot 7, E7-01 à E7-25). La colonne des agents du
 * canevas devient le premier écran ; les routines d'un agent se lisent en cartes, l'agent en tête.
 * Tout passe par l'ordinateur ouvert (gestes `routines.*`) ; rien n'est gardé dans le compte.
 */

export const urlRoutines = (agent?: string | null, routine?: string | null, formulaire = false) =>
  `/routines?vue=routines${agent ? `&agent=${encodeURIComponent(agent)}` : ""}${routine ? `&routine=${encodeURIComponent(routine)}` : ""}${formulaire ? "&formulaire=1" : ""}`;

const ECLAIRAGE_MS = 1800;
const PHRASE_AUCUN = "Les routines et les workflows tournent sur ton ordinateur.";

/** P-6 des routines. Celles d'un VPS partent quand même (MO-T17) : dit seulement si ce téléphone en connaît un. */
function usePhraseFermee() {
  const vps = useServeursRelies().length > 0;
  return (sur: string) => `les routines sont sur ${sur}. Elles ne partent que quand KLYRA y est ouverte.${vps ? ` Celles d’un VPS y tournent même ${sur} fermé.` : ""}`;
}

/** Le moteur des routines ne tourne pas sur l'ordinateur (E7-06) : « Réessayer » relit, il ne le démarre pas. */
function MoteurArrete({ erreur, relancer }: { erreur: string | null; relancer: () => void }) {
  const sur = useSupport();
  return (
    <EtatEcran
      erreur
      icone="help-circle-contained"
      titre="Les routines sont arrêtées"
      texte={erreur ?? `Le moteur des routines est indisponible sur ${sur}.`}
      className="pt-8"
      action={
        <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="refresh-01" size={20} />} onClick={relancer}>
          Réessayer
        </Bouton>
      }
    />
  );
}

/** Le lien d'une carte : souligné, avec sa cible de 44 px. */
function LienCarte({ href, onClick, chevron = false, children, disabled = false }: { href?: string; onClick?: () => void; chevron?: boolean; children: ReactNode; disabled?: boolean }) {
  const classe = "-my-2.5 inline-flex min-h-11 items-center gap-0.5 text-ui font-medium text-texte-principal underline underline-offset-[3px] disabled:text-texte-tertiaire";
  const contenu = (
    <>
      {children}
      {chevron ? <Icon name="chevron-right" size={16} /> : null}
    </>
  );
  return href ? (
    <Link href={href} className={classe}>
      {contenu}
    </Link>
  ) : (
    <button type="button" disabled={disabled} onClick={onClick} className={classe}>
      {contenu}
    </button>
  );
}

/* ─── E7-01 à E7-06 : les agents ───────────────────────────────── */

export function AgentsRoutinesTelephone({ onglets, routineDemandee }: { onglets: ReactNode; routineDemandee: string | null }) {
  const router = useRouter();
  const ferme = usePhraseFermee();
  const lecture = useLectureSuivie<RoutinesLues>("routines.liste", {}, { suivre: (d) => d.enCours.some(runActif) });
  const tirer = useTirerPourRelire(lecture.relancer, { enCours: lecture.relecture });
  const [brouillon] = useState(lireBrouillon);
  const data = lecture.etat === "ok" ? lecture.data : null;
  /* Un lien vers une routine sans son agent (notification) mène à son agent, comme au bureau. */
  const cible = routineDemandee ? data?.routines.find((r) => r.id === routineDemandee) : undefined;
  useEffect(() => {
    if (cible) router.replace(urlRoutines(cible.agentId, cible.id));
  }, [cible, router]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Automatisations" parent="/plus" droite={<MenuPage titre="Automatisations" actions={[{ libelle: "Relire", icone: "refresh-01", onChoisir: lecture.relancer }]} />} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6" {...tirer.props}>
        {tirer.indicateur}
        <div className="px-4 pt-2 pb-4">{onglets}</div>
        <VueLecture lecture={lecture} ferme={ferme} lignes={5} formeAucun="encadre" phraseAucun={PHRASE_AUCUN} gestes={null}>
          {(d) => (!d.actif ? <MoteurArrete erreur={d.erreur} relancer={lecture.relancer} /> : <ListeAgents lues={d} brouillonDe={brouillon?.valeurs.agentId} />)}
        </VueLecture>
      </div>
    </div>
  );
}

/** Mes agents, puis Hors de Mes agents ; l'état de chacun écrit. Vue gardée : l'activité n'est plus en direct (E7-03). */
function ListeAgents({ lues, brouillonDe }: { lues: RoutinesLues; brouillonDe?: string }) {
  const sur = useSupport();
  const gardee = !!useVueGardeeAffichee();
  const enCours = gardee ? lues.enCours.filter((r) => r.status === "needs-attention") : lues.enCours;
  return (
    <nav aria-label="Agents" className="flex flex-col gap-4 px-4">
      {[true, false].map((actif) => {
        const groupe = lues.agents.filter((a) => a.actif === actif);
        if (!groupe.length) return null;
        const titre = actif ? "Mes agents" : "Hors de Mes agents";
        return (
          <SectionListe key={titre} titre={titre} compte={groupe.length}>
            <GroupeListe>
              {groupe.map((a) => {
                const apercu = apercuAgent(a, lues.routines, enCours, brouillonDe, true).replace("Absent de cet ordinateur", `Absent de ${sur}`);
                const attend = apercu === "Attend ton accord";
                return (
                  <LigneListe
                    key={a.id}
                    href={urlRoutines(a.id)}
                    debut={<RondApercu agentId={a.id} nom={a.name} teinte={a.teinte} taille={40} className={a.actif ? undefined : "opacity-60"} />}
                    retrait="avatar"
                    nom={a.name}
                    nonLu={attend}
                    etiquette={roleLisible(a.tag, a.id) ? <Etiquette>{roleLisible(a.tag, a.id)}</Etiquette> : null}
                    meta={apercu === "Routine en cours" ? "En cours" : undefined}
                    metaAccent
                    ligne2={attend ? <span className="font-semibold text-texte-accent">{apercu}</span> : apercu}
                    uneLigne
                    fin="chevron"
                  />
                );
              })}
            </GroupeListe>
          </SectionListe>
        );
      })}
      <p className="-mt-1 flex items-start gap-1.5 px-1 text-ui-xs leading-[1.4] text-texte-secondaire">
        <Icon name="clock-01" size={16} className="shrink-0 text-icone-secondaire" />
        Les routines partent de {sur} tant que KLYRA est ouverte. App fermée ou en veille, rien ne part.
      </p>
    </nav>
  );
}

/* ─── E7-07 à E7-17 : les routines d'un agent ──────────────────── */

interface Edition extends BrouillonRoutine {
  contexte: ContexteRoutine;
  /** L'adresse a montré le formulaire : si elle ne le montre plus (retour du système), il se ferme. */
  affichee: boolean;
}
type Echec = { type: string; message: string; reessayer: () => void };
interface Confirmation {
  titre: string;
  texte?: string;
  confirmer: string;
  danger?: boolean;
  action: () => void;
}

const SUGGESTIONS = [
  {
    name: "Point de la semaine",
    instruction: "Fais le point sur mes tâches de la semaine. Signale les échéances proches, les blocages et les décisions qui m’attendent.",
    schedule: { kind: "weekly", weekday: 1, time: "09:00" },
  },
  {
    name: "Revue des mails",
    instruction: "Relis les mails accessibles avec mes connexions et propose les réponses utiles en brouillon. Si une connexion manque, signale-le. N’envoie aucun message.",
    schedule: { kind: "weekdays", time: "09:00" },
  },
  {
    name: "Contrôle de klyra.fr",
    instruction: "Vérifie les pages publiques de klyra.fr. Signale les liens cassés et les erreurs visibles ; ne modifie pas le site.",
    schedule: { kind: "weekdays", time: "09:00" },
  },
] as const satisfies readonly Pick<RoutineInput, "name" | "instruction" | "schedule">[];

export function RoutinesAgentTelephone({ agentId, routineId, formulaire }: { agentId: string; routineId: string | null; formulaire: boolean }) {
  const router = useRouter();
  const sur = useSupport();
  const { ouvert } = usePostes();
  const ferme = usePhraseFermee();
  const lecture = useLectureSuivie<RoutinesLues>("routines.liste", { agentId }, { suivre: (d) => d.enCours.some((r) => r.agentId === agentId && runActif(r)) });
  const { relancer } = lecture;
  const tirer = useTirerPourRelire(relancer, { enCours: lecture.relecture });
  const { faire, occupe } = useGestePoste();
  const uneFois = useUneFois();
  const [bandeau, annoncer] = useBandeau();
  const [brouillon, setBrouillon] = useState<BrouillonRoutine | null>(lireBrouillon);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [tour, setTour] = useState(0);
  const [restaurer, setRestaurer] = useState(formulaire);
  const [executions, setExecutions] = useState<Routine | null>(null);
  const [menu, setMenu] = useState<Routine | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [erreurs, setErreurs] = useState<Record<string, Echec | undefined>>({});
  const [eclairee, setEclairee] = useState<string | null>(null);
  /* Ce que l'écran montre : la lecture en direct, ou la vue gardée (lecture seule). */
  const data = lecture.etat === "ok" ? lecture.data : lecture.etat === "ferme" ? (lecture.gardee?.data ?? null) : null;

  const agent: AgentLu = data?.agents.find((a) => a.id === agentId) ?? { id: agentId, name: "Agent indisponible", tag: "", title: "", teinte: "jaune" as RoleTeinte, actif: false, connu: false };
  const nomAgent = (id: string) => data?.agents.find((a) => a.id === id)?.name ?? "Agent indisponible";
  const agentActif = (id: string) => !!data?.agents.some((a) => a.id === id && a.actif);
  const liste = (data?.routines ?? []).filter((r) => r.agentId === agentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const actifDe = (id: string) => data?.enCours.find((run) => run.routineId === id && runActif(run));
  const indisponible = !ouvert || occupe || !data?.actif;

  /* Le formulaire est une page : « formulaire=1 » dans l'adresse, le retour du système le ferme (le brouillon reste). */
  if (edition && formulaire && !edition.affichee) setEdition({ ...edition, affichee: true });
  if (edition?.affichee && !formulaire) setEdition(null);
  /* Page rouverte sur le formulaire : il reprend le brouillon de cet agent, s'il y en a un. */
  if (restaurer && data) {
    setRestaurer(false);
    if (formulaire && !edition && brouillon?.valeurs.agentId === agentId) setEdition({ ...brouillon, contexte: data, affichee: true });
  }

  useEffect(() => {
    if (!eclairee) return;
    document.querySelector(`[data-routine-carte="${CSS.escape(eclairee)}"]`)?.scrollIntoView({ block: "center" });
    const minuteur = setTimeout(() => setEclairee(null), ECLAIRAGE_MS);
    return () => clearTimeout(minuteur);
  }, [eclairee]);

  const commencer = (initiale: Routine | null, valeurs?: RoutineInput, champAgent = false) => {
    if (!data) return;
    const base = initiale ? valeursRoutine(initiale) : nouvelleRoutine(agentId, data.fuseau, data.lieu);
    setEdition({ initiale: initiale ? initialeDe(initiale) : null, base, valeurs: valeurs ?? base, champAgent, contexte: data, affichee: false });
    setTour((n) => n + 1);
    router.push(urlRoutines(agentId, routineId, true));
  };
  /* Le brouillon n'est gardé que s'il s'écarte de l'ouverture, comme au bureau. */
  const memoriser = useCallback(
    (valeurs: RoutineInput, modifie: boolean) => {
      if (!edition) return;
      const suivant = modifie ? { initiale: edition.initiale, base: edition.base, valeurs, champAgent: edition.champAgent } : null;
      setBrouillon(suivant);
      ecrireBrouillon(suivant);
    },
    [edition],
  );
  const fermerFormulaire = () => {
    ecrireBrouillon(null);
    setBrouillon(null);
    setEdition(null);
    router.replace(urlRoutines(agentId, routineId));
  };
  const reussi = (routine: Routine, creee: boolean) => {
    ecrireBrouillon(null);
    setBrouillon(null);
    setEdition(null);
    setEclairee(routine.id);
    annoncer(creee ? "Routine créée." : "Routine enregistrée.");
    relancer();
    router.replace(urlRoutines(routine.agentId, routine.id));
  };
  const enregistrer = async (input: RoutineInput) => {
    if (!edition) return;
    const depuis = new Date(Date.now() - 60_000).toISOString();
    const r = await faire<Routine>("routines.enregistrer", { id: edition.initiale?.id ?? null, updatedAt: edition.initiale?.updatedAt ?? null, input });
    if (r.ok) return reussi(r.data, !edition.initiale);
    if (r.code === "changee" || r.code === "supprimee") relancer();
    /* Sans réponse, la création a pu aboutir : relire avant de proposer un nouvel essai (§ 3). */
    if (r.code === "delai" && !edition.initiale) {
      const relue = await faire<RoutinesLues>("routines.liste", { agentId: input.agentId });
      const deja = relue.ok ? routineDejaCreee(relue.data.routines, input, depuis) : undefined;
      if (deja) return reussi(deja, true);
    }
    throw Object.assign(new Error(r.code === "delai" ? `${majuscule(sur)} ne répond pas. Tes changements sont gardés sur cette page.` : messageGeste(r, sur)), { code: r.code });
  };
  const recharger = () => {
    const courante = data?.routines.find((r) => r.id === edition?.initiale?.id);
    if (!courante || !data) return;
    const base = valeursRoutine(courante);
    setEdition({ initiale: initialeDe(courante), base, valeurs: base, champAgent: false, contexte: data, affichee: true });
    setTour((n) => n + 1);
  };
  const reprendreBrouillon = () => {
    if (!brouillon || !data) return;
    setEdition({ ...brouillon, contexte: data, affichee: false });
    setTour((n) => n + 1);
    router.push(urlRoutines(agentId, routineId, true));
  };

  const agir = (r: Routine, type: string, args: Record<string, unknown>, message: string, apres?: () => void): Promise<void> =>
    uneFois(async () => {
      setErreurs((e) => ({ ...e, [r.id]: undefined }));
      const res = await faire(type, args);
      if (res.ok) {
        annoncer(message);
        apres?.();
      } else setErreurs((e) => ({ ...e, [r.id]: { type, message: messageGeste(res, sur), reessayer: () => void agir(r, type, args, message, apres) } }));
      /* Toujours relire : sans réponse, le geste a pu aboutir ; la carte le dira avant tout nouvel essai. */
      relancer();
    });
  const executer = (r: Routine) => void agir(r, "routines.executer", { id: r.id }, "Exécution ajoutée à la file de l’agent.", () => setEclairee(r.id));
  const pause = (r: Routine) => {
    /* Une « une fois » passée et en pause : on choisit une nouvelle date avant de la reprendre, comme au bureau. */
    if (!r.active && r.schedule.kind === "once" && !r.nextRunAt) commencer(r, { ...valeursRoutine(r), active: true });
    else void agir(r, "routines.pause", { id: r.id, active: !r.active }, r.active ? "Routine en pause. Une exécution déjà en cours continue." : "Routine reprise.");
  };
  const interrompre = (r: Routine, run: RoutineRun) => {
    const enFile = run.status === "queued";
    setConfirmation({
      titre: enFile ? "Annuler ce départ ?" : "Interrompre cette exécution ?",
      texte: "Le planning de la routine reste inchangé. Les messages déjà écrits sont conservés.",
      confirmer: enFile ? "Annuler le départ" : "Interrompre",
      action: () => void agir(r, "routines.interrompre", { runId: run.id, statut: run.status }, enFile ? "Départ annulé." : "Exécution interrompue."),
    });
  };
  const supprimer = (r: Routine) =>
    setConfirmation({
      titre: `Supprimer « ${r.name} » ?`,
      texte: "La routine et son historique seront supprimés. Les messages de ses conversations sont conservés.",
      confirmer: "Supprimer",
      danger: true,
      action: () =>
        void agir(r, "routines.supprimer", { id: r.id }, "Routine supprimée.", () => {
          if (routineId === r.id) router.replace(urlRoutines(agentId));
        }),
    });
  const simplifier = (r: Routine) =>
    setConfirmation({
      titre: `Garder seulement ${nomAgent(r.agentId)} ?`,
      texte: `La routine reprendra avec sa première consigne et un seul agent. Les ${r.relais?.length ?? 0} relais ne seront plus exécutés. Leur sauvegarde reste sur ${sur}.`,
      confirmer: "Garder et reprendre",
      action: () => void agir(r, "routines.simplifier", { id: r.id }, "Routine reprise avec un seul agent."),
    });
  const ouvrirExecutions = (r: Routine) => {
    setExecutions(r);
    if (routineId !== r.id) router.replace(urlRoutines(agentId, r.id));
  };

  const actionsMenu = (r: Routine): ActionMenu[] => {
    const relais = !!r.relais?.length;
    const actif = actifDe(r.id);
    const bloquerReprise = indisponible || (!r.active && (!agentActif(r.agentId) || relais));
    const note = ouvert ? undefined : <NotePoste className="text-ui-xs text-texte-secondaire" />;
    return [
      { libelle: "Modifier", icone: "pencil-01", desactivee: indisponible, note, onChoisir: () => commencer(r) },
      ...(r.schedule.kind !== "manual" ? [{ libelle: r.active ? "Mettre en pause" : "Reprendre", icone: (r.active ? "pause-01" : "play-01") as IconName, desactivee: bloquerReprise, note, onChoisir: () => pause(r) }] : []),
      { libelle: "Exécutions", icone: "list", onChoisir: () => ouvrirExecutions(r) },
      ...(relais ? [{ libelle: `Garder seulement ${nomAgent(r.agentId)}`, icone: "user-profile-01" as IconName, desactivee: indisponible || !agentActif(r.agentId), onChoisir: () => simplifier(r) }] : []),
      ...(!agentActif(r.agentId) ? [{ libelle: "Changer d’agent", icone: "users-profiles-01" as IconName, desactivee: indisponible, onChoisir: () => commencer(r, undefined, true) }] : []),
      {
        libelle: "Supprimer…",
        icone: "trash-01",
        danger: !actif,
        separateurAvant: true,
        desactivee: indisponible || !!actif,
        note: actif ? "Une exécution attend ou travaille déjà pour cette routine." : note,
        onChoisir: () => supprimer(r),
      },
    ];
  };

  const brouillonVisible = !edition && brouillon?.valeurs.agentId === agentId;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={data ? `Routines de ${agent.name}` : "Routines"} parent={urlRoutines()} droite={<MenuPage titre={data ? `Routines de ${agent.name}` : "Routines"} actions={[{ libelle: "Relire", icone: "refresh-01", onChoisir: relancer }]} />} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6" {...tirer.props}>
        {tirer.indicateur}
        <VueLecture lecture={lecture} ferme={ferme} formeAucun="encadre" phraseAucun={PHRASE_AUCUN} gestes="Exécuter, mettre en pause et modifier">
          {(d) =>
            !d.actif ? (
              <MoteurArrete erreur={d.erreur} relancer={relancer} />
            ) : (
              <div className="flex flex-col gap-4 px-4 pt-2">
                <CarteAgentTelephone agent={agent} sur={sur} />
                <p className="flex items-center gap-2.5 px-1 text-ui-xs text-texte-secondaire" aria-hidden="true">
                  <span className="h-px flex-1 bg-bordure-defaut" />
                  confiées à {agent.name}
                  <span className="h-px flex-1 bg-bordure-defaut" />
                </p>
                {brouillonVisible && brouillon ? (
                  <section aria-label="Brouillon non enregistré" className="flex flex-col rounded-xl border border-dashed border-gris-k2-600 bg-fond-surface">
                    <header className="flex min-h-[52px] items-center gap-2.5 pt-1 pr-4 pl-4">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-xs bg-fond-surface-grise text-icone-secondaire">
                        <Icon name="pencil-01" size={16} />
                      </span>
                      <h2 className="truncate text-body-s font-semibold text-texte-principal">{brouillon.valeurs.name || "Nouvelle routine"}</h2>
                    </header>
                    <div className="flex flex-col gap-3 px-4 pb-4">
                      <div>
                        <p className="text-ui text-texte-secondaire">{libellePlanning(brouillon.valeurs.schedule)}</p>
                        <p className="mt-0.5 text-ui font-medium text-texte-principal">Brouillon non enregistré</p>
                      </div>
                      <div className="flex gap-2">
                        <Bouton variant="sombre" taille="md" className={cn("flex-1", BOUTON_INACTIF)} disabled={indisponible} onClick={reprendreBrouillon}>
                          Reprendre
                        </Bouton>
                        <Bouton
                          variant="blanc"
                          taille="md"
                          className="flex-1"
                          onClick={() =>
                            setConfirmation({
                              titre: "Abandonner ce brouillon ?",
                              texte: "La routine non enregistrée sera effacée de ce téléphone.",
                              confirmer: "Abandonner",
                              action: () => {
                                ecrireBrouillon(null);
                                setBrouillon(null);
                              },
                            })
                          }
                        >
                          Abandonner
                        </Bouton>
                      </div>
                    </div>
                  </section>
                ) : null}
                {liste.map((r) => (
                  <CarteRoutineTelephone
                    key={r.id}
                    routine={r}
                    agentActif={agentActif(r.agentId)}
                    nomDe={nomAgent}
                    actif={actifDe(r.id)}
                    derniere={d.dernieres?.[r.id]}
                    eclairee={eclairee === r.id}
                    indisponible={indisponible}
                    relecture={lecture.relecture}
                    erreur={erreurs[r.id]}
                    onMenu={() => setMenu(r)}
                    onExecuter={() => executer(r)}
                    onPause={() => pause(r)}
                    onInterrompre={(run) => interrompre(r, run)}
                    onSimplifier={() => simplifier(r)}
                    onExecutions={() => ouvrirExecutions(r)}
                  />
                ))}
                {!liste.length && !brouillonVisible && agent.actif ? (
                  <section className="rounded-xl border border-bordure-subtile bg-fond-surface pt-4 pb-1 shadow-ombre-ambiante">
                    <h2 className="px-4 text-body-s font-semibold text-texte-principal">Confie une tâche qui revient à {agent.name}</h2>
                    <p className="mt-1 px-4 text-ui text-texte-secondaire">Commence avec un exemple, puis adapte sa consigne avant de l’enregistrer.</p>
                    <ul className="mt-2">
                      {SUGGESTIONS.map((s) => (
                        <LigneListe
                          key={s.name}
                          debut={<TuileIcone icone="clock-01" />}
                          retrait="tuile"
                          nom={s.name}
                          ligne2={libellePlanning(s.schedule)}
                          uneLigne
                          fin="chevron"
                          inactive={indisponible}
                          raison={ouvert ? undefined : <NotePoste className="text-ui-xs text-texte-secondaire" />}
                          onClick={() => commencer(null, { ...nouvelleRoutine(agentId, d.fuseau, d.lieu), ...s })}
                        />
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            )
          }
        </VueLecture>
      </div>
      {data?.actif && agent.actif ? (
        <div className="shrink-0 border-t border-bordure-defaut bg-fond-page px-4 py-3">
          <BoutonPrincipal className="w-full" disabled={indisponible} onClick={() => commencer(null)}>
            Nouvelle routine
          </BoutonPrincipal>
          {!ouvert ? <NotePoste className="mt-1.5 px-1 text-ui-xs text-texte-secondaire" /> : null}
        </div>
      ) : null}

      {edition ? (
        <FormulaireRoutineTelephone
          key={tour}
          initiale={edition.initiale}
          base={edition.base}
          valeurs={edition.valeurs}
          champAgent={edition.champAgent}
          contexte={edition.contexte}
          changeeAilleurs={!!edition.initiale && !!data && data.routines.find((r) => r.id === edition.initiale!.id)?.updatedAt !== edition.initiale.updatedAt}
          onRecharger={recharger}
          onEnregistrer={enregistrer}
          onChange={memoriser}
          onFermer={fermerFormulaire}
        />
      ) : null}
      {executions ? (
        <FeuilleExecutions
          routine={executions}
          actif={actifDe(executions.id)}
          agentActif={agentActif(executions.agentId)}
          nomAgent={nomAgent}
          indisponible={indisponible}
          onInterrompre={(run) => interrompre(executions, run)}
          onFermer={() => setExecutions(null)}
        />
      ) : null}
      {menu ? (
        <MenuFeuille
          titre={menu.name}
          objet={{ visuel: <TuileIcone grande icone={menu.relais?.length ? "lock-01" : menu.active ? "clock-01" : "pause-01"} />, sous: `${nomAgent(menu.agentId)} · ${libellePlanning(menu.schedule).replace(/^./, (c) => c.toLowerCase())}` }}
          actions={actionsMenu(menu)}
          onFermer={() => setMenu(null)}
        />
      ) : null}
      {confirmation ? (
        <ConfirmationFeuille
          titre={confirmation.titre}
          texte={confirmation.texte}
          confirmer={confirmation.confirmer}
          danger={confirmation.danger}
          onConfirmer={confirmation.action}
          onFermer={() => setConfirmation(null)}
        />
      ) : null}
      {bandeau}
    </div>
  );
}

/** L'agent en tête de ses routines : le lien « confiée à » du canevas devient l'ordre de lecture. */
function CarteAgentTelephone({ agent, sur }: { agent: AgentLu; sur: string }) {
  const gardee = !!useVueGardeeAffichee();
  return (
    <Carte className={cn("px-4 py-3.5", !agent.actif && "border-bordure-forte bg-fond-surface-douce")}>
      <div aria-label={`Agent ${agent.name}`} role="group">
        <div className="flex items-center gap-3">
          <RondApercu agentId={agent.id} nom={agent.name} teinte={agent.teinte} taille={44} className={agent.actif ? undefined : "opacity-60"} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-s font-semibold text-texte-principal">{agent.name}</p>
            <p className="mt-px truncate text-ui text-texte-secondaire">{[roleLisible(agent.tag, agent.id), agent.actif ? "Actif" : agent.connu ? "Désactivé" : `Absent de ${sur}`].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        {agent.title && !gardee ? <p className="mt-2.5 line-clamp-2 text-ui text-texte-secondaire">{agent.title}</p> : null}
        {!agent.actif ? <p className="mt-2.5 text-ui text-texte-secondaire">{agent.connu ? "Désactivé : ses routines ne partent pas." : `Absent de ${sur} : ses routines ne partent pas.`}</p> : null}
        <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-3 pb-1">
          <LienCarte href={`/chat?id=${encodeURIComponent(`dm-${agent.id}`)}`} chevron>
            Ouvrir la conversation
          </LienCarte>
          {!agent.actif ? (
            <LienCarte href="/equipe" chevron>
              Ouvrir l’équipe
            </LienCarte>
          ) : null}
        </div>
      </div>
    </Carte>
  );
}

/** La carte d'une routine du bureau, pleine largeur : même contenu, mêmes gestes, cibles de 44 px. */
function CarteRoutineTelephone({
  routine: r,
  agentActif,
  nomDe,
  actif,
  derniere: lue,
  eclairee,
  indisponible,
  relecture,
  erreur,
  onMenu,
  onExecuter,
  onPause,
  onInterrompre,
  onSimplifier,
  onExecutions,
}: {
  routine: Routine;
  agentActif: boolean;
  nomDe: (id: string) => string;
  actif?: RoutineRun;
  derniere?: { run: RoutineRun | null } | { erreur: string };
  eclairee: boolean;
  indisponible: boolean;
  relecture: boolean;
  erreur?: Echec;
  onMenu(): void;
  onExecuter(): void;
  onPause(): void;
  onInterrompre(run: RoutineRun): void;
  onSimplifier(): void;
  onExecutions(): void;
}) {
  const id = useId();
  const nomAgent = nomDe(r.agentId);
  const appui = useAppuiLong(onMenu);
  const consigne = useRef<HTMLParagraphElement>(null);
  const [developpee, setDeveloppee] = useState(false);
  const [deborde, setDeborde] = useState(false);
  const relais = !!r.relais?.length;
  const derniere = lue && "run" in lue ? (lue.run ?? undefined) : undefined;
  const erreurLecture = lue && "erreur" in lue ? lue.erreur : undefined;
  const run = actif ?? derniere;

  useEffect(() => {
    const el = consigne.current;
    if (!el) return;
    const mesurer = () => {
      if (!developpee) setDeborde(el.scrollHeight > el.clientHeight + 1);
    };
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(el);
    return () => observateur.disconnect();
  }, [r.instruction, developpee]);

  const bloquerReprise = indisponible || (!r.active && (!agentActif || relais));
  const motif = relais
    ? "Choisis d’abord quoi conserver de cette ancienne chaîne."
    : !agentActif
      ? "Choisis un agent actif avant de lancer cette routine."
      : actif
        ? "Une exécution attend ou travaille déjà pour cette routine."
        : null;
  const etat = relais
    ? "Ancienne chaîne à examiner"
    : !agentActif
      ? "Agent indisponible"
      : !r.active && dateUneFoisPassee(r)
        ? "Date passée · en pause"
        : !r.active
          ? actif?.kind === "manual"
            ? "En pause · une exécution manuelle part quand même"
            : "En pause"
          : r.schedule.kind === "manual"
            ? "À lancer quand tu veux"
            : `Prochaine : ${quandRelatif(r.nextRunAt, r.timezone)}`;
  const fuseauDifferent = r.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ville = r.timezone.split("/").at(-1)?.replaceAll("_", " ") ?? r.timezone;
  const heure = actif ? new Intl.DateTimeFormat("fr-FR", { timeZone: r.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(actif.startedAt ?? actif.createdAt)) : null;
  const contour = actif?.status === "running" || actif?.status === "needs-attention"
    ? "border-[1.5px] border-bordure-accent-survol"
    : derniere?.status === "failed"
      ? "border-bordure-erreur"
      : relais || !agentActif
        ? "border-bordure-forte bg-fond-surface-douce"
        : "border-bordure-subtile";
  const peutReessayer = erreur ? essaiPossible(erreur.type, !!actif, relecture) : false;

  return (
    <section
      aria-labelledby={`${id}-titre`}
      aria-describedby={`${id}-agent`}
      data-routine-carte={r.id}
      data-eclaire={eclairee || undefined}
      {...appui}
      className={cn("klyra-telephone-eclaire flex flex-col rounded-xl border bg-fond-surface shadow-ombre-ambiante transition-[border-color] duration-[120ms] ease-sortie", contour)}
    >
      <header className="flex min-h-[52px] items-center gap-2.5 pt-1 pr-0.5 pl-4">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-xs bg-fond-surface-grise text-icone-secondaire">
          <Icon name={relais ? "lock-01" : !r.active ? "pause-01" : "clock-01"} size={16} />
        </span>
        <h3 id={`${id}-titre`} className="min-w-0 flex-1 truncate text-body-s font-semibold text-texte-principal">
          {r.name}
        </h3>
        <MarqueRun run={run} />
        <BoutonIcone variant="discret" className="size-11" libelle={`Actions de ${r.name}`} aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={onMenu} />
      </header>
      <span id={`${id}-agent`} className="sr-only">
        Confiée à {nomAgent}
      </span>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div>
          <p className="text-ui text-texte-secondaire">
            {libellePlanning(r.schedule)}
            {fuseauDifferent ? ` · heure de ${ville}` : ""}
          </p>
          <p className="mt-0.5 text-ui font-medium text-texte-principal">{etat}</p>
        </div>
        <div>
          <p ref={consigne} className={cn("rounded-md border border-bordure-subtile bg-fond-page px-3 py-2.5 text-ui leading-[1.45] break-words whitespace-pre-wrap text-texte-principal", !developpee && "line-clamp-3")}>
            {r.instruction}
          </p>
          {deborde || developpee ? (
            <button type="button" aria-expanded={developpee} onClick={() => setDeveloppee((v) => !v)} className="-mb-1 min-h-11 text-ui-xs text-texte-principal underline underline-offset-[3px]">
              {developpee ? "Réduire" : "Afficher toute la consigne"}
            </button>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 rounded-md bg-fond-surface-grise px-3 py-2.5 text-ui leading-[1.4] text-texte-secondaire">
          {actif ? (
            <>
              <p role="status" className="flex items-center gap-1.5 font-medium text-texte-principal">
                <MarqueRun run={actif} />
                <span>
                  <span className="font-semibold text-texte-accent">{libelleRun(actif)}</span> · depuis {heure}
                </span>
              </p>
              {actif.status === "needs-attention" ? <p>L’agent attend une autorisation.</p> : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Bouton variant="blanc" taille="md" disabled={indisponible} onClick={() => onInterrompre(actif)}>
                  {actif.status === "queued" ? "Annuler le départ" : "Interrompre"}
                </Bouton>
                {lienRun(actif) ? <LienCarte href={lienRun(actif)!}>{actif.status === "needs-attention" ? "Répondre dans la conversation" : "Ouvrir la conversation"}</LienCarte> : null}
              </div>
            </>
          ) : derniere ? (
            <>
              <p className="flex items-center gap-1.5 font-medium text-texte-principal">
                <MarqueRun run={derniere} />
                <span className="min-w-0">
                  Dernière : {libelleRun(derniere)} · {quandRelatif(derniere.scheduledFor, r.timezone)}
                  {dureeRun(derniere) ? ` · ${dureeRun(derniere)}` : ""}
                </span>
              </p>
              {derniere.error || derniere.result ? <p className={cn("line-clamp-2 break-words whitespace-pre-wrap", derniere.error && "text-texte-erreur")}>{derniere.error || derniere.result}</p> : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-1">
                {lienRun(derniere) ? <LienCarte href={lienRun(derniere)!}>Voir la conversation</LienCarte> : null}
                <LienCarte chevron onClick={onExecutions}>
                  Exécutions
                </LienCarte>
              </div>
            </>
          ) : (
            <p>{erreurLecture ? "Le dernier résultat est indisponible." : "Aucune exécution pour le moment."}</p>
          )}
          {erreurLecture ? (
            <p role="alert" className="text-texte-erreur">
              {erreurLecture}
            </p>
          ) : null}
        </div>
        {relais ? (
          <div className="flex flex-col gap-2 text-ui-xs text-texte-secondaire">
            <p>Elle est conservée en pause. Aucun relais ne sera lancé. Tu peux conserver seulement la consigne du premier agent ; une sauvegarde de l’ancienne chaîne reste sur l’ordinateur.</p>
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center">Voir les {r.relais!.length} relais conservés</summary>
              <ol className="my-2 flex list-decimal flex-col gap-2 pl-4">
                {r.relais!.map((relai) => (
                  <li key={relai.id}>
                    <strong className="text-texte-principal">
                      {nomDe(relai.de)} → {nomDe(relai.vers)}
                    </strong>
                    <p className="my-1 break-words whitespace-pre-wrap">{relai.consigne}</p>
                  </li>
                ))}
              </ol>
            </details>
            <Bouton variant="blanc" taille="md" className="w-full" disabled={indisponible || !agentActif} onClick={onSimplifier}>
              Garder seulement {nomAgent}
            </Bouton>
          </div>
        ) : (
          <>
            <footer className="flex gap-2">
              <Bouton variant="sombre" taille="md" className={cn("flex-1 px-3", BOUTON_INACTIF)} iconeGauche={<Icon name="play-01" size={16} />} disabled={indisponible || !agentActif || !!actif} onClick={onExecuter}>
                Exécuter
              </Bouton>
              {r.schedule.kind !== "manual" ? (
                <Bouton variant="blanc" taille="md" className={cn("flex-1 px-3", BOUTON_INACTIF)} iconeGauche={<Icon name={r.active ? "pause-01" : "play-01"} size={16} />} disabled={bloquerReprise} onClick={onPause}>
                  {r.active ? "Pause" : "Reprendre"}
                </Bouton>
              ) : null}
            </footer>
            {motif ? <p className="-mt-1 text-ui-xs text-texte-secondaire">{motif}</p> : null}
          </>
        )}
        {erreur && (peutReessayer || erreur.type !== "routines.executer" || !actif) ? (
          <div role="alert" className="flex flex-col gap-2 text-ui text-texte-erreur">
            <p className="break-words">{erreur.message}</p>
            <Bouton variant="blanc" taille="md" className="self-start text-texte-principal" disabled={indisponible || !peutReessayer} onClick={erreur.reessayer}>
              Réessayer
            </Bouton>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ─── E7-24, E7-25 : les exécutions d'une routine ──────────────── */

function FeuilleExecutions({
  routine: r,
  actif,
  agentActif,
  nomAgent,
  indisponible,
  onInterrompre,
  onFermer,
}: {
  routine: Routine;
  actif?: RoutineRun;
  agentActif: boolean;
  nomAgent: (id: string) => string;
  indisponible: boolean;
  onInterrompre(run: RoutineRun): void;
  onFermer(): void;
}) {
  const sur = useSupport();
  const [limite, setLimite] = useState(50);
  const lecture = useLectureSuivie<ExecutionsLues>("routines.executions", { id: r.id, limite }, { garde: r.id, suivre: () => !!actif });
  const bloque = !r.active || !agentActif || !!r.relais?.length;
  const sous = [r.name, nomAgent(r.agentId)].join(" · ");

  return (
    <Feuille titre="Exécutions" sousTitre={sous} haute bordee onFermer={onFermer}>
      <div className="-mx-4 pt-3">
        <VueLecture lecture={lecture} ferme={(s) => `l’historique de cette routine est sur ${s}. Il s’affiche quand KLYRA y est ouverte.`} gestes={null}>
          {(data) => {
            const runs = actif ? [actif, ...data.runs.filter((run) => run.id !== actif.id)] : data.runs;
            return (
              <div className="flex flex-col gap-4 px-4">
                {r.schedule.kind !== "manual" ? (
                  <SectionListe titre="À venir">
                    <div className="rounded-md bg-fond-page px-3.5 py-3 text-ui leading-[1.5] text-texte-secondaire">
                      {bloque ? (
                        <p>Aucun départ tant que la routine est en pause ou bloquée.</p>
                      ) : data.dates.length ? (
                        <ul className="list-disc pl-[18px] text-texte-principal">
                          {data.dates.map((date) => (
                            <li key={date}>{quandRelatif(date, r.timezone)}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>Aucun départ dans les sept prochains jours.</p>
                      )}
                      {runs.length ? (
                        <p className="mt-2 text-ui-xs">
                          Au retour de veille ou après fermeture : {r.missedPolicy === "skip" ? "ignorer les échéances manquées" : "lancer une seule fois la dernière échéance manquée"}. Un retard de moins de cinq minutes est exécuté normalement.
                        </p>
                      ) : null}
                    </div>
                  </SectionListe>
                ) : null}
                {!runs.length ? (
                  <EtatEcran
                    forme="encadre"
                    icone="list"
                    titre="Aucune exécution pour le moment"
                    texte={!bloque && data.dates[0] ? `La première partira ${quandRelatif(data.dates[0], r.timezone).replace(", ", " à ")}, si KLYRA est ouverte sur ${sur}.` : "Elle apparaîtra ici dès son premier départ."}
                    className="px-0 pb-0"
                  />
                ) : (
                  <SectionListe titre="Historique">
                    <GroupeListe>
                      {runs.slice(0, limite).map((run) => (
                        <LigneExecution key={run.id} routine={r} run={run} enCours={actif?.id === run.id} nomAgent={nomAgent} indisponible={indisponible} onInterrompre={onInterrompre} />
                      ))}
                    </GroupeListe>
                  </SectionListe>
                )}
                {data.runs.length > limite ? (
                  <Bouton taille="md" variant="blanc" className="w-full" disabled={lecture.relecture} onClick={() => setLimite((n) => n + 50)}>
                    Voir les exécutions précédentes
                  </Bouton>
                ) : null}
              </div>
            );
          }}
        </VueLecture>
      </div>
    </Feuille>
  );
}

/** Une exécution : sa marque, son statut, sa date et sa durée ; la ligne ouvre sa conversation (compte). */
function LigneExecution({
  routine: r,
  run,
  enCours,
  nomAgent,
  indisponible,
  onInterrompre,
}: {
  routine: Routine;
  run: RoutineRun;
  enCours: boolean;
  nomAgent: (id: string) => string;
  indisponible: boolean;
  onInterrompre(run: RoutineRun): void;
}) {
  const lien = lienRun(run);
  const duree = dureeRun(run);
  const changee = run.instruction !== r.instruction || run.routineName !== r.name || run.agentId !== r.agentId;
  const detail = run.missed ? (run.missed.reason === "busy" ? "L’agent travaillait déjà" : "KLYRA était fermée") : run.error || run.result;
  return (
    <>
      <LigneListe
        href={lien ?? undefined}
        retrait="tuile"
        debut={
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-md-moins bg-fond-surface-grise text-icone-defaut">
            <MarqueRun run={run} />
          </span>
        }
        nom={<span role={enCours ? "status" : undefined}>{libelleRun(run)}</span>}
        meta={run.kind === "manual" ? "Manuelle" : "Planifiée"}
        ligne2={
          <>
            <span className="block truncate">
              {majuscule(quandRelatif(run.scheduledFor, r.timezone))}
              {duree ? ` · ${duree}` : ""}
            </span>
            {detail ? <span className={cn("block truncate", run.error && !run.missed && "text-texte-erreur")}>{detail}</span> : null}
          </>
        }
        fin={lien ? "chevron" : undefined}
      />
      {enCours || changee ? (
        <li className="flex flex-col gap-1 pr-4 pb-3 pl-16 text-ui-xs text-texte-secondaire">
          {enCours ? (
            <Bouton taille="md" variant="blanc" className="self-start" disabled={indisponible} onClick={() => onInterrompre(run)}>
              {run.status === "queued" ? "Annuler le départ" : "Interrompre"}
            </Bouton>
          ) : null}
          {changee ? (
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center">Consigne et agent lors du lancement</summary>
              <p className="my-2 break-words">
                {run.routineName} · {nomAgent(run.agentId)}
              </p>
              <p className="my-2 break-words whitespace-pre-wrap">{run.instruction}</p>
            </details>
          ) : null}
        </li>
      ) : null}
    </>
  );
}
