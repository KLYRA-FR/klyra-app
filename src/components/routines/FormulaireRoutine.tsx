"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Input, Textarea } from "klyra-ui";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { quandRoutine } from "@/lib/routines-affichage";
import { cn } from "@/lib/cn";
import { useRole, useWorkspace } from "@/lib/workspace";
import type { Routine, RoutineInput, RoutineSchedule } from "@/types/routines";
import { PlanningRoutine } from "./PlanningRoutine";

type Valeurs = Required<RoutineInput>;
type ChampErreur = "name" | "agentId" | "instruction" | "schedule" | "timezone" | "projectId" | "formulaire";
type Erreurs = Partial<Record<ChampErreur, string>>;
const ORDRE: ChampErreur[] = ["name", "agentId", "instruction", "schedule", "timezone", "projectId", "formulaire"];
const AIDE = "m-0 text-ui-xs leading-relaxed text-texte-secondaire";

export interface FormulaireRoutineProps {
  initiale: Routine | null;
  valeursInitiales?: RoutineInput;
  onEnregistrer: (input: RoutineInput) => Promise<void>;
  onAnnuler: () => void;
  onChange: (input: RoutineInput, modifie: boolean) => void;
  changeeAilleurs?: boolean;
  onRecharger?: () => void;
}

function fuseauSysteme(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function normaliser(input?: RoutineInput | Routine | null): Valeurs {
  return {
    agentId: input?.agentId ?? "principal",
    name: input?.name ?? "",
    instruction: input?.instruction ?? "",
    schedule: structuredClone(input?.schedule ?? { kind: "daily", time: "09:00" }),
    timezone: input?.timezone ?? fuseauSysteme(),
    active: input?.active ?? true,
    missedPolicy: input?.schedule.kind === "once" ? "run-once" : input?.missedPolicy ?? "skip",
    projectId: input?.projectId ?? null,
  };
}

function ville(timezone: string): string {
  return timezone.split("/").at(-1)?.replaceAll("_", " ") || timezone;
}

/** Ces contrôles expliquent la saisie ; la date future et le calcul IANA restent validés par le moteur. */
function erreursSaisie(input: Valeurs, agentActif: boolean, agentNom: string, projetPresent: boolean): Erreurs {
  const erreurs: Erreurs = {};
  if (!input.name.trim()) erreurs.name = "Donne-lui un nom.";
  else if (input.name.trim().length > 80) erreurs.name = "Le nom peut contenir 80 caractères au maximum.";
  if (!agentActif) erreurs.agentId = `Choisis un agent actif, ou réactive ${agentNom} dans Équipe.`;
  if (!input.instruction.trim()) erreurs.instruction = "Écris ce que l’agent doit faire.";
  else if (input.instruction.length > 100000) erreurs.instruction = "La consigne peut contenir 100 000 caractères au maximum.";
  const schedule = input.schedule;
  if ("time" in schedule && typeof schedule.time === "string" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) erreurs.schedule = "Choisis une heure au format HH:mm.";
  if (schedule.kind === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(schedule.date)) erreurs.schedule = "Choisis une date pour cette exécution.";
  if (schedule.kind === "interval") {
    if (!Number.isSafeInteger(schedule.amount) || schedule.amount < 1 || schedule.amount > 100000) erreurs.schedule = "Choisis un nombre entier entre 1 et 100 000.";
    else if (schedule.unit === "minutes" && schedule.amount < 3) erreurs.schedule = "L’intervalle minimum est de 3 minutes.";
  }
  try {
    if (!input.timezone || /^[+-]/.test(input.timezone)) throw new Error();
    new Intl.DateTimeFormat("fr-FR", { timeZone: input.timezone }).format(new Date());
  } catch {
    erreurs.timezone = "Choisis un fuseau horaire IANA valide.";
  }
  if (!projetPresent) erreurs.projectId = "Ce projet n’est plus disponible. Choisis une autre destination.";
  return erreurs;
}

function erreurDuMoteur(error: unknown): { champ: ChampErreur; message: string } {
  const message = error instanceof Error ? error.message : "L’enregistrement n’a pas abouti. Réessaie.";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const champ = code === "programmation" || code === "date-passee" ? "schedule"
    : code.includes("agent") ? "agentId"
      : /fuseau/i.test(message) ? "timezone"
        : /consigne/i.test(message) ? "instruction"
          : /\bnom\b/i.test(message) ? "name"
            : /projet/i.test(message) ? "projectId" : "formulaire";
  return { champ, message };
}

/** Le parent conserve le brouillon et confirme les sorties. Une nouvelle clé remonte le formulaire au rechargement volontaire. */
export function FormulaireRoutine(props: FormulaireRoutineProps) {
  return <SaisieRoutine key={props.initiale?.id ?? "nouvelle"} {...props} />;
}

function SaisieRoutine({ initiale, valeursInitiales, onEnregistrer, onAnnuler, onChange, changeeAilleurs = false, onRecharger }: FormulaireRoutineProps) {
  const { roles, tous } = useAgents();
  const { state: { projects } } = useWorkspace();
  const [base] = useState(() => normaliser(initiale));
  const [valeurs, setValeurs] = useState(() => normaliser(valeursInitiales ?? initiale));
  const [essai, setEssai] = useState(false);
  const [occupé, setOccupé] = useState(false);
  const [serveur, setServeur] = useState<{ champ: ChampErreur; message: string } | null>(null);
  const [choisirFuseau, setChoisirFuseau] = useState(false);
  const formulaire = useRef<HTMLFormElement>(null);
  const nom = useRef<HTMLInputElement>(null);
  const signaler = useRef(onChange);
  const id = useId();
  const role = useRole(valeurs.agentId);
  const agentActif = roles.some((agent) => agent.id === valeurs.agentId);
  const agentConnu = tous.some((agent) => agent.role.id === valeurs.agentId);
  const projetPresent = valeurs.projectId === null || projects.some((projet) => projet.id === valeurs.projectId);
  const modifie = JSON.stringify(valeurs) !== JSON.stringify(base);
  const erreurs = erreursSaisie(valeurs, agentActif, role.name, projetPresent);
  if (serveur) erreurs[serveur.champ] = serveur.message;
  const erreur = (champ: ChampErreur) => (essai || (champ === "agentId" && !agentActif)) ? erreurs[champ] : undefined;
  const description = (champ: ChampErreur) => erreur(champ) ? `${id}-${champ}-erreur` : undefined;

  useEffect(() => { signaler.current = onChange; }, [onChange]);
  useEffect(() => { signaler.current(valeurs, modifie); }, [valeurs, modifie]);
  useEffect(() => {
    if (initiale?.schedule.kind === "once" && !initiale.active && valeursInitiales?.active) formulaire.current?.querySelector<HTMLInputElement>("[data-routine-date]")?.focus();
    else nom.current?.focus();
    // La sélection et le rechargement volontaire remontent le formulaire ; un événement externe ne vole pas le focus.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fuseaux = useMemo(() => {
    let possibles: string[] = [];
    try { possibles = Intl.supportedValuesOf("timeZone"); } catch { /* Le fuseau courant et UTC restent proposés. */ }
    return [...new Set(["UTC", fuseauSysteme(), valeurs.timezone, ...possibles])]
      .map((value) => ({ value, label: `${ville(value)} · ${value}` }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [valeurs.timezone]);

  const changer = <K extends keyof Valeurs>(champ: K, value: Valeurs[K]) => {
    setValeurs((courantes) => ({ ...courantes, [champ]: value }));
    if (serveur?.champ === champ || serveur?.champ === "formulaire") setServeur(null);
  };
  const changerPlanning = (schedule: RoutineSchedule) => {
    setValeurs((courantes) => ({ ...courantes, schedule, missedPolicy: schedule.kind === "once" ? "run-once" : courantes.missedPolicy }));
    if (serveur?.champ === "schedule" || serveur?.champ === "formulaire") setServeur(null);
  };
  const focaliserErreur = (champ: ChampErreur) => {
    requestAnimationFrame(() => {
      const conteneur = formulaire.current?.querySelector<HTMLElement>(`[data-champ="${champ}"]`);
      (conteneur?.querySelector<HTMLElement>("input, textarea, button:not(:disabled)") ?? conteneur)?.focus();
    });
  };

  const enregistrer = async (event: FormEvent) => {
    event.preventDefault();
    if (occupé) return;
    setEssai(true);
    setServeur(null);
    const controles = erreursSaisie(valeurs, agentActif, role.name, projetPresent);
    const premier = ORDRE.find((champ) => controles[champ]);
    if (premier) { focaliserErreur(premier); return; }
    let schedule = valeurs.schedule;
    // Une cadence existante inchangée garde son ancrage. Le début d'une nouvelle cadence
    // correspond au geste d'enregistrement, et non au moment où le formulaire a été ouvert.
    if (schedule.kind === "interval" && (!initiale || JSON.stringify(schedule) !== JSON.stringify(base.schedule))) {
      schedule = { ...schedule, anchorAt: new Date().toISOString() };
    }
    setOccupé(true);
    try {
      await onEnregistrer({ ...valeurs, name: valeurs.name.trim(), instruction: valeurs.instruction.trim(), schedule });
    } catch (error) {
      const echec = erreurDuMoteur(error);
      setServeur(echec);
      if (echec.champ === "timezone") setChoisirFuseau(true);
      focaliserErreur(echec.champ);
    } finally {
      setOccupé(false);
    }
  };

  const aideConsigne = `Elle part telle quelle à chaque exécution, comme un message que tu lui écrirais. ${role.name} ne voit pas cette page : écris tout ce qu’il doit savoir.`;
  const optionsAgents = roles.map((agent) => ({ value: agent.id, label: `${agent.name} · ${agent.tag}`, icone: <AgentRond roleId={agent.id} taille={20} />, disabled: false }));
  if (!agentActif) optionsAgents.unshift({ value: valeurs.agentId, label: `${role.name} · ${agentConnu ? "désactivé" : "introuvable"}`, icone: <AgentRond roleId={valeurs.agentId} taille={20} />, disabled: true });

  return (
    <form ref={formulaire} noValidate aria-labelledby={`${id}-titre`} aria-busy={occupé} onSubmit={enregistrer}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          if (!occupé) onAnnuler();
        }
      }}
      className="klyra-carte-flottante @container flex min-w-0 flex-col gap-5 rounded-lg p-5">
      <h2 id={`${id}-titre`} className="m-0 text-ui font-semibold text-texte-principal">{initiale ? `Modifier « ${initiale.name} »` : "Nouvelle routine"}</h2>
      {changeeAilleurs && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-bordure-forte bg-fond-page p-3">
          <p className={cn(AIDE, "flex-1")}>Cette routine a changé pendant que tu la modifiais.</p>
          {onRecharger && <Bouton disabled={occupé} onClick={onRecharger}>Recharger</Bouton>}
        </div>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-4 @2xl:grid-cols-2">
        <div data-champ="name">
          <Champ label="Nom">
            <Input ref={nom} size="sm" value={valeurs.name} maxLength={80} placeholder="Point de la semaine" disabled={occupé}
              aria-invalid={!!erreur("name")} aria-describedby={description("name")} onChange={(event) => changer("name", event.target.value)} className={CHAMP} />
            <Erreur id={description("name")} message={erreur("name")} />
            {valeurs.name.length >= 70 && <span className={AIDE}>{valeurs.name.length}/80</span>}
          </Champ>
        </div>
        <div data-champ="agentId">
          <Champ label="Agent">
            <div role="group" aria-label="Agent" aria-describedby={description("agentId")}>
              <ListeDeroulante libelle="Agent" value={valeurs.agentId} options={optionsAgents} disabled={occupé} onChange={(value) => changer("agentId", value)} />
            </div>
            <Erreur id={description("agentId")} message={erreur("agentId")} />
          </Champ>
        </div>
        <div data-champ="instruction" className="@2xl:col-span-2">
          <Champ label="Consigne">
            <Textarea size="sm" autoGrow value={valeurs.instruction} maxLength={100000} disabled={occupé}
              placeholder="Fais le point sur les tâches de cette semaine et indique celles qui demandent une décision."
              aria-invalid={!!erreur("instruction")} aria-describedby={description("instruction") ?? `${id}-consigne-aide`}
              onChange={(event) => changer("instruction", event.target.value)} className={cn(CHAMP, "min-h-[120px]")} />
            <Erreur id={description("instruction")} message={erreur("instruction")} />
            <span id={`${id}-consigne-aide`} className={AIDE}>{aideConsigne}</span>
          </Champ>
        </div>
      </div>
      <PlanningRoutine value={valeurs.schedule} onChange={changerPlanning} timezone={valeurs.timezone} erreur={erreur("schedule")} disabled={occupé} />
      <ApercuPlanning schedule={valeurs.schedule} timezone={valeurs.timezone} />
      {initiale?.schedule.kind === "once" && !initiale.active && !valeurs.active && (
        <p className={AIDE}>Cette routine est en pause. Modifier sa date ne la relance pas ; tu pourras la reprendre après l’enregistrement.</p>
      )}
      {valeurs.schedule.kind !== "manual" && (
        valeurs.schedule.kind === "once" ? <p className={AIDE}>Si l’app est fermée à cette heure-là, elle part à la réouverture.</p> : (
          <fieldset disabled={occupé} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="mb-2 text-ui-s font-medium text-texte-principal">Si l’app est fermée à l’heure prévue</legend>
            <div role="radiogroup" aria-label="Exécutions manquées" className="grid gap-2 @xl:grid-cols-2">
              <ChoixRattrapage value="skip" actuel={valeurs.missedPolicy} disabled={occupé} onChange={(value) => changer("missedPolicy", value)} titre="Ne rien rattraper">
                Au retour, l’historique note les exécutions manquées. Rien ne part en retard.
              </ChoixRattrapage>
              <ChoixRattrapage value="run-once" actuel={valeurs.missedPolicy} disabled={occupé} onChange={(value) => changer("missedPolicy", value)} titre="Rattraper la plus récente">
                Au retour, seule la dernière exécution manquée part, en retard. Les autres sont notées manquées.
              </ChoixRattrapage>
            </div>
            <p className={AIDE}>KLYRA n’exécute rien app fermée ou ordinateur en veille. Une exécution dépassée de moins de 5 minutes part normalement.</p>
          </fieldset>
        )
      )}
      <div data-champ="timezone">
        {choisirFuseau || erreur("timezone") ? (
          <Champ label="Fuseau horaire">
            <div role="group" aria-label="Fuseau horaire" aria-describedby={description("timezone")}>
              <ListeDeroulante libelle="Fuseau horaire" value={valeurs.timezone} options={fuseaux} disabled={occupé} onChange={(value) => changer("timezone", value)} />
            </div>
            <Erreur id={description("timezone")} message={erreur("timezone")} />
          </Champ>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn(AIDE, "break-words")}>Heures de {ville(valeurs.timezone)} ({valeurs.timezone})</p>
            <Bouton variant="discret" taille="mini" disabled={occupé} onClick={() => setChoisirFuseau(true)}>Changer</Bouton>
          </div>
        )}
      </div>
      <div data-champ="projectId">
        <Champ label="Où arrive le résultat">
          <div role="group" aria-label="Où arrive le résultat" aria-describedby={description("projectId")}>
            <ListeDeroulante libelle="Où arrive le résultat" value={valeurs.projectId ?? ""} disabled={occupé}
              options={[
                { value: "", label: `Conversation avec ${role.name}` },
                ...(!projetPresent ? [{ value: valeurs.projectId!, label: "Projet indisponible", disabled: true }] : []),
                ...projects.map((projet) => ({ value: projet.id, label: `Projet ${projet.name}` })),
              ]}
              onChange={(value) => changer("projectId", value || null)} />
          </div>
          <Erreur id={description("projectId")} message={erreur("projectId")} />
        </Champ>
      </div>
      {erreur("formulaire") && <div data-champ="formulaire" tabIndex={-1}><Erreur id={description("formulaire")} message={erreur("formulaire")} /></div>}
      <div className="flex flex-wrap items-center gap-2">
        <BoutonPrincipal type="submit" disabled={occupé}>{initiale ? "Enregistrer" : "Créer la routine"}</BoutonPrincipal>
        <Bouton variant="blanc" taille="md" disabled={occupé} onClick={onAnnuler}>Annuler</Bouton>
      </div>
    </form>
  );
}

function Erreur({ id, message }: { id?: string; message?: string }) {
  return message ? <span id={id} role="alert" className="text-ui-xs text-texte-erreur">{message}</span> : null;
}

function ApercuPlanning({ schedule, timezone }: { schedule: RoutineSchedule; timezone: string }) {
  const [apercu, setApercu] = useState<{ cle: string; dates: string[]; erreur: string | null } | null>(null);
  const cle = JSON.stringify([schedule, timezone]);
  useEffect(() => {
    const api = getBridge()?.routines;
    if (!api || schedule.kind === "manual") return;
    let annule = false;
    const timer = setTimeout(() => {
      void api.apercu(schedule, timezone).then((r) => {
        if (!annule) setApercu({ cle, dates: r.ok ? r.data : [], erreur: r.ok ? null : r.message });
      }).catch(() => { if (!annule) setApercu({ cle, dates: [], erreur: "Aperçu indisponible. Le planning sera vérifié à l’enregistrement." }); });
    }, 250);
    return () => { annule = true; clearTimeout(timer); };
  }, [schedule, timezone, cle]);
  if (schedule.kind === "manual" || apercu?.cle !== cle) return null;
  return <div className="text-ui-xs text-texte-secondaire" role="status"><p className="m-0">{apercu.erreur ?? "Prochains départs si tu enregistres maintenant :"}</p>{!apercu.erreur && <ul className="mb-0 space-y-1 pl-5">{apercu.dates.map((date) => <li key={date}>{quandRoutine(date, timezone)}</li>)}</ul>}</div>;
}

function ChoixRattrapage({ value, actuel, onChange, disabled, titre, children }: {
  value: "skip" | "run-once";
  actuel: "skip" | "run-once";
  onChange: (value: "skip" | "run-once") => void;
  disabled: boolean;
  titre: string;
  children: ReactNode;
}) {
  return (
    <button type="button" role="radio" aria-checked={actuel === value} tabIndex={actuel === value ? 0 : -1} disabled={disabled}
      onClick={() => onChange(value)} onKeyDown={(event) => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        onChange(value === "skip" ? "run-once" : "skip");
        const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=radio]");
        radios?.[value === "skip" ? 1 : 0]?.focus();
      }}
      className={cn("flex min-w-0 cursor-pointer flex-col gap-1 rounded-md border p-3 text-left transition-colors duration-[120ms] ease-sortie disabled:opacity-60",
        actuel === value ? "border-bordure-forte bg-fond-surface shadow-ombre-xs" : "border-bordure-subtile bg-fond-page hover:border-bordure-forte")}
    >
      <span className="text-ui-s font-medium text-texte-principal">{titre}</span>
      <span className={AIDE}>{children}</span>
    </button>
  );
}
