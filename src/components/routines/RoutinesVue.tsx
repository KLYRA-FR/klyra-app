"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useConfirmation } from "@/components/ui/Modale";
import { AgentRond } from "@/components/roles/AgentRond";
import { useAgents } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { poste } from "@/lib/plateforme";
import { useRoutines } from "@/lib/routines";
import { libellePlanning, libelleRun, quandRoutine, runActif } from "@/lib/routines-affichage";
import type { Routine, RoutineInput, RoutinePatch, RoutineRun } from "@/types/routines";
import { DetailRoutine } from "./DetailRoutine";
import { FormulaireRoutine } from "./FormulaireRoutine";

interface Edition { initiale: Routine | null; valeurs?: RoutineInput; cle: number }
const BROUILLON = "klyra:routine-brouillon";
function lireBrouillon(): Edition | null {
  try {
    const b = JSON.parse(localStorage.getItem(BROUILLON) ?? "null");
    return b?.valeurs && typeof b.valeurs.name === "string" && typeof b.valeurs.instruction === "string" && b.valeurs.schedule?.kind && typeof b.valeurs.agentId === "string" ? b : null;
  } catch { return null; }
}
function effacerBrouillon() { try { localStorage.removeItem(BROUILLON); } catch { /* Stockage navigateur indisponible : le formulaire reste utilisable. */ } }

/** Liste et détail : toute mutation est confirmée par le moteur avant le retour visuel. */
export function RoutinesVue({ onglets, garderSortie }: { onglets: ReactNode; garderSortie: (garde: () => Promise<boolean>) => () => void }) {
  const api = useRoutines();
  const { roles, tous } = useAgents();
  const router = useRouter();
  const recherche = useSearchParams();
  const selection = recherche.get("routine");
  const routine = api.routines.find((r) => r.id === selection);
  const [filtre, setFiltre] = useState("tous");
  const [edition, setEdition] = useState<Edition | null>(null);
  const [brouillon, setBrouillon] = useState<Edition | null>(lireBrouillon);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  const [demander, confirmation] = useConfirmation();
  const modifie = useRef(false);
  const sauvegardeEnCours = useRef(false);
  const refsLignes = useRef(new Map<string, HTMLButtonElement>());
  const zoneErreur = useRef<HTMLParagraphElement>(null);
  const indisponible = !api.actif || !!api.erreur || occupe;
  const nomAgent = (id: string) => roles.find((a) => a.id === id)?.name ?? tous.find((a) => a.role.id === id)?.role.name ?? id;
  const agentActif = (id: string) => roles.some((a) => a.id === id);

  const quitter = useCallback(async () => {
    if (sauvegardeEnCours.current) return false;
    if (modifie.current && !(await demander({ titre: "Abandonner les modifications ?", texte: "Les changements de ce formulaire ne seront pas enregistrés.", confirmer: "Abandonner", annuler: "Continuer à modifier" }))) return false;
    modifie.current = false;
    setEdition(null);
    setBrouillon(null);
    effacerBrouillon();
    return true;
  }, [demander]);
  useEffect(() => garderSortie(quitter), [garderSortie, quitter]);
  const choisir = async (id: string | null) => {
    if (!(await quitter())) return;
    router.replace(id ? `/routines?vue=routines&routine=${encodeURIComponent(id)}` : "/routines?vue=routines", { scroll: false });
    if (!id && selection) requestAnimationFrame(() => refsLignes.current.get(selection)?.focus());
  };
  const commencer = async (initiale: Routine | null, valeurs?: RoutineInput) => {
    if (!(await quitter())) return;
    setEdition({ initiale, valeurs, cle: Date.now() });
    setErreur(null);
  };
  const memoriser = useCallback((valeurs: RoutineInput, dirty: boolean) => {
    modifie.current = dirty;
    if (!dirty) { effacerBrouillon(); return; }
    try { localStorage.setItem(BROUILLON, JSON.stringify({ ...edition, valeurs })); } catch { /* Les erreurs du stockage local n'empêchent pas la saisie. */ }
  }, [edition]);
  const agir = async (operation: () => Promise<unknown>, message: string) => {
    if (occupe) return;
    setOccupe(true); setErreur(null);
    try { await operation(); await api.actualiser(); setAnnonce(message); }
    catch (error) { setErreur(error instanceof Error ? error.message : String(error)); requestAnimationFrame(() => zoneErreur.current?.focus()); }
    finally { setOccupe(false); }
  };
  const enregistrer = async (input: RoutineInput) => {
    if (!edition) return;
    if (indisponible) throw new Error(api.erreur ?? "Le moteur des routines est indisponible.");
    sauvegardeEnCours.current = true;
    try {
    let sauvee: Routine;
    if (edition.initiale) {
      const courante = api.routines.find((r) => r.id === edition.initiale!.id);
      if (!courante) throw new Error("Cette routine a été supprimée pendant la modification. Copie ta consigne avant de fermer ce formulaire.");
      if (courante.updatedAt !== edition.initiale.updatedAt) throw new Error("Cette routine a changé. Recharge-la avant de l’enregistrer pour ne pas écraser ces changements.");
      const patch = Object.fromEntries(Object.entries(input).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(edition.initiale![k as keyof Routine]))) as RoutinePatch;
      sauvee = await api.modifier(courante.id, patch);
    } else sauvee = await api.creer(input);
    modifie.current = false; effacerBrouillon(); setBrouillon(null); setEdition(null);
    await api.actualiser();
    router.replace(`/routines?vue=routines&routine=${encodeURIComponent(sauvee.id)}`, { scroll: false });
    setAnnonce(edition.initiale ? "Routine enregistrée." : "Routine créée.");
    } finally { sauvegardeEnCours.current = false; }
  };
  const pause = async () => {
    if (!routine) return;
    if (!routine.active && routine.schedule.kind === "once" && !routine.nextRunAt) {
      await commencer(routine, { ...routine, active: true });
      return;
    }
    await agir(() => api.modifier(routine.id, { active: !routine.active }), routine.active ? "Routine en pause. Une exécution déjà en cours continue." : "Routine reprise.");
  };
  const supprimer = async () => {
    if (!routine || !(await demander({ titre: `Supprimer « ${routine.name} » ?`, texte: "La routine et son historique seront supprimés. Les messages de ses conversations sont conservés.", confirmer: "Supprimer" }))) return;
    await agir(async () => { await api.supprimer(routine.id); router.replace("/routines?vue=routines"); }, "Routine supprimée.");
  };
  const interrompre = async (run: RoutineRun) => {
    const enFile = run.status === "queued";
    if (!(await demander({ titre: enFile ? "Annuler ce départ ?" : "Interrompre cette exécution ?", texte: "Le planning de la routine reste inchangé. Les messages déjà écrits sont conservés.", confirmer: enFile ? "Annuler le départ" : "Interrompre" }))) return;
    await agir(() => api.interrompre(run.id), enFile ? "Départ annulé." : "Exécution interrompue.");
  };
  const simplifier = async () => {
    if (!routine || !(await demander({ titre: `Garder seulement ${nomAgent(routine.agentId)} ?`, texte: `La routine reprendra avec sa première consigne et un seul agent. Les ${routine.relais?.length ?? 0} relais ne seront plus exécutés. Leur sauvegarde reste sur cet ordinateur.`, confirmer: "Garder et reprendre" }))) return;
    await agir(() => api.modifier(routine.id, { relais: [], active: true }), "Routine reprise avec un seul agent.");
  };
  const statut = (r: Routine) => r.relais?.length ? "Ancienne chaîne à examiner" : !agentActif(r.agentId) ? "Agent indisponible" : api.enCours.find((run) => run.routineId === r.id && runActif(run)) ? libelleRun(api.enCours.find((run) => run.routineId === r.id && runActif(run))!) : !r.active ? "En pause" : r.schedule.kind === "manual" ? "À la demande" : quandRoutine(r.nextRunAt, r.timezone);
  const agents = [...new Set(api.routines.map((r) => r.agentId))];
  const liste = api.routines.filter((r) => filtre === "tous" || r.agentId === filtre);
  const suggestion = (i: number): RoutineInput => ({ agentId: roles[0]?.id ?? "principal", name: ["Point de la semaine", "Revue des mails", "Contrôle de klyra.fr"][i], instruction: ["Fais le point sur mes tâches de la semaine. Signale les échéances proches, les blocages et les décisions qui m’attendent.", "Relis les mails accessibles avec mes connexions et propose les réponses utiles en brouillon. Si une connexion manque, signale-le. N’envoie aucun message.", "Vérifie les pages publiques de klyra.fr. Signale les liens cassés et les erreurs visibles ; ne modifie pas le site."][i], schedule: i === 0 ? { kind: "weekly", weekday: 1, time: "09:00" } : { kind: "weekdays", time: "09:00" }, active: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, missedPolicy: "skip" });

  return <div className="h-full overflow-y-auto"><div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="m-0 text-h3 font-semibold tracking-[-0.04em] text-texte-principal">Automatisations</h1><div className="flex flex-wrap items-center gap-3">{onglets}{!edition && <BoutonPrincipal disabled={indisponible} onClick={() => void commencer(null)}>Nouvelle routine</BoutonPrincipal>}</div></header>
    <p className="m-0 text-ui-s text-texte-secondaire">Un agent, une consigne, un planning. Les routines partent de {poste.ce} tant que KLYRA est ouverte. App fermée ou en veille, rien ne part.</p>
    <p className="sr-only" role="status" aria-live="polite">{annonce}</p>
    {(api.erreur || erreur) && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bordure-forte bg-fond-surface p-4"><p ref={zoneErreur} tabIndex={-1} role="alert" className="m-0 min-w-0 flex-1 break-words text-ui-s text-texte-principal">{erreur ?? api.erreur}</p><Bouton onClick={() => { setErreur(null); void api.actualiser(); }}>Réessayer</Bouton></div>}
    {!api.charge ? <p role="status" className="text-ui-s text-texte-secondaire">Chargement des routines…</p> : <>
      {!edition && brouillon && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bordure-subtile bg-fond-surface p-4"><p className="m-0 flex-1 text-ui-s text-texte-secondaire">Un brouillon de routine est conservé sur cet ordinateur.</p><Bouton disabled={indisponible} onClick={() => { setEdition({ ...brouillon, cle: Date.now() }); setBrouillon(null); }}>Reprendre le brouillon</Bouton><Bouton onClick={async () => { if (await demander({ titre: "Abandonner ce brouillon ?", confirmer: "Abandonner" })) { effacerBrouillon(); setBrouillon(null); } }}>Abandonner</Bouton></div>}
      {edition ? <FormulaireRoutine key={edition.cle} initiale={edition.initiale} valeursInitiales={edition.valeurs} onEnregistrer={enregistrer} onAnnuler={() => void quitter()} onChange={memoriser} changeeAilleurs={!!edition.initiale && api.routines.find((r) => r.id === edition.initiale!.id)?.updatedAt !== edition.initiale.updatedAt} onRecharger={async () => { const r = api.routines.find((r) => r.id === edition.initiale?.id); if (r) await commencer(r); }} /> : api.routines.length ? <div className="grid min-w-0 grid-cols-1 items-start gap-5 @4xl:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label="Routines" className={cn("min-w-0 rounded-3xl border border-bordure-subtile bg-fond-surface p-3", selection && "hidden @4xl:block")}>
          {agents.length > 1 && <ListeDeroulante libelle="Filtrer par agent" value={filtre} onChange={setFiltre} options={[{ value: "tous", label: "Tous les agents" }, ...agents.map((id) => ({ value: id, label: nomAgent(id) }))]} />}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">{liste.map((r) => <li key={r.id}><button ref={(el) => { if (el) refsLignes.current.set(r.id, el); else refsLignes.current.delete(r.id); }} type="button" aria-current={selection === r.id ? "true" : undefined} onClick={() => void choisir(r.id)} className={cn("mt-1 flex w-full cursor-pointer flex-col gap-1 rounded-lg p-3 text-left hover:bg-fond-survol", selection === r.id && "bg-fond-surface-grise")}>
            <span className="text-ui-s font-semibold break-words text-texte-principal">{r.name}</span><span className="flex items-center gap-2 text-ui-xs text-texte-secondaire"><AgentRond roleId={r.agentId} taille={20} />{nomAgent(r.agentId)}</span><span className="text-ui-xs text-texte-secondaire">{libellePlanning(r.schedule)}</span><span className="text-ui-xs font-medium text-texte-principal">{statut(r)}</span>
          </button></li>)}</ul>
        </nav>
        {routine ? <DetailRoutine key={routine.id} routine={routine} revision={api.revision} indisponible={indisponible} onRetour={() => void choisir(null)} onModifier={() => void commencer(routine)} onExecuter={() => void agir(() => api.executer(routine.id), "Exécution ajoutée à la file de l’agent.")} onPause={() => void pause()} onSupprimer={() => void supprimer()} onSimplifier={() => void simplifier()} onInterrompre={(run) => void interrompre(run)} /> : <section className={cn("rounded-3xl border border-bordure-subtile bg-fond-surface p-5 text-ui-s text-texte-secondaire", !selection && "hidden @4xl:block")}><p>{selection ? "Cette routine n’est plus disponible." : "Choisis une routine pour voir sa consigne, son planning et ses résultats."}</p>{selection && <Bouton onClick={() => void choisir(null)}>Toutes les routines</Bouton>}</section>}
      </div> : api.actif && <section className="flex flex-col gap-4 rounded-3xl border border-bordure-subtile bg-fond-surface p-5"><h2 className="m-0 text-h4 font-semibold text-texte-principal">Confie une tâche qui revient à un agent</h2><p className="m-0 text-ui-s text-texte-secondaire">Commence avec un exemple, puis adapte sa consigne avant de l’enregistrer.</p><div className="flex flex-wrap gap-3">{[0, 1, 2].map((i) => <Bouton key={i} disabled={indisponible} onClick={() => void commencer(null, suggestion(i))}>{suggestion(i).name}</Bouton>)}</div></section>}
    </>}
    {confirmation}
  </div></div>;
}
