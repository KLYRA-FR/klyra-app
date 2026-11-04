"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Input, Textarea } from "klyra-ui";
import { RondApercu } from "@/components/roles/AgentRond";
import { erreurDuMoteur, erreursSaisie, ORDRE, type ChampErreur } from "@/components/routines/FormulaireRoutine";
import { PlanningRoutine } from "@/components/routines/PlanningRoutine";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { cn } from "@/lib/cn";
import { useLecturePoste } from "@/lib/poste/client";
import { majuscule } from "@/lib/poste-texte";
import { quandRoutine } from "@/lib/routines-affichage";
import { DEMANDE_MAX, type InitialeBrouillon, type RoutinesLues } from "@/lib/telephone/routines-telephone";
import type { Routine, RoutineInput, RoutineSchedule } from "@/types/routines";
import { EnteteTelephone } from "./EnteteTelephone";
import { NotePoste } from "./etats";
import { usePostes, useSupport } from "./poste";
import { CHAMP_KLYRA_UI } from "./Controles";

/**
 * T-16 : le formulaire d'une routine en page pleine. Mêmes champs et mêmes règles que
 * `FormulaireRoutine` du bureau (contrôles de `erreursSaisie`, erreurs du moteur placées par
 * `erreurDuMoteur`) ; les listes (agents, projets, machines, fuseau) viennent de l'ordinateur.
 */

export type ContexteRoutine = Pick<RoutinesLues, "agents" | "projets" | "serveurs" | "fuseau" | "lieu">;

const AIDE = "text-ui-xs leading-relaxed text-texte-secondaire";
/** Les champs à 16 px : sous cette taille, Safari agrandit la page au focus (spec § 9). */
const CHAMP_TELEPHONE = CHAMP_KLYRA_UI;

function complet(input: RoutineInput, fuseau: string): Required<RoutineInput> {
  return {
    agentId: input.agentId,
    name: input.name,
    instruction: input.instruction,
    schedule: structuredClone(input.schedule),
    timezone: input.timezone ?? fuseau,
    active: input.active ?? true,
    missedPolicy: input.schedule.kind === "once" ? "run-once" : (input.missedPolicy ?? "skip"),
    projectId: input.projectId ?? null,
    lieu: input.lieu ?? null,
  };
}

const ville = (timezone: string) => timezone.split("/").at(-1)?.replaceAll("_", " ") || timezone;

export function FormulaireRoutineTelephone({
  initiale,
  base: baseRecue,
  valeurs: valeursRecues,
  champAgent,
  contexte,
  changeeAilleurs,
  onRecharger,
  onEnregistrer,
  onChange,
  onAnnuler,
}: {
  initiale: InitialeBrouillon | null;
  base: RoutineInput;
  valeurs: RoutineInput;
  champAgent: boolean;
  contexte: ContexteRoutine;
  changeeAilleurs: boolean;
  onRecharger: () => void;
  /** Lève une erreur avec son `code` (celui du moteur) si l'enregistrement échoue. */
  onEnregistrer: (input: RoutineInput) => Promise<void>;
  onChange: (valeurs: RoutineInput, modifie: boolean) => void;
  onAnnuler: () => void;
}) {
  const sur = useSupport();
  const { ouvert } = usePostes();
  const id = useId();
  const [base] = useState(() => complet(baseRecue, contexte.fuseau));
  const [valeurs, setValeurs] = useState(() => complet(valeursRecues, contexte.fuseau));
  const [essai, setEssai] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [serveur, setServeur] = useState<{ champ: ChampErreur; message: string } | null>(null);
  const [choisirFuseau, setChoisirFuseau] = useState(false);
  const formulaire = useRef<HTMLFormElement>(null);
  const nom = useRef<HTMLInputElement>(null);
  const signaler = useRef(onChange);

  const actifs = contexte.agents.filter((a) => a.actif);
  const agent = contexte.agents.find((a) => a.id === valeurs.agentId);
  const agentActif = actifs.some((a) => a.id === valeurs.agentId);
  const agentNom = agent?.name ?? valeurs.agentId;
  const projetsIci = contexte.projets.filter((p) => p.lieu === (valeurs.lieu ?? null));
  const projetPresent = valeurs.projectId === null || projetsIci.some((p) => p.id === valeurs.projectId);
  const nomLieu = (lieu: string | null) => (lieu ? (contexte.serveurs.find((s) => s.adresse === lieu)?.nom ?? new URL(lieu).hostname.split(".")[0]) : majuscule(sur));
  const modifie = JSON.stringify(valeurs) !== JSON.stringify(base);
  const erreurs = erreursSaisie(valeurs, agentActif, agentNom, projetPresent);
  if (serveur) erreurs[serveur.champ] = serveur.message;
  const erreur = (champ: ChampErreur) => (essai || (champ === "agentId" && !agentActif) ? erreurs[champ] : undefined);
  const description = (champ: ChampErreur) => (erreur(champ) ? `${id}-${champ}-erreur` : undefined);

  useEffect(() => {
    signaler.current = onChange;
  }, [onChange]);
  useEffect(() => {
    signaler.current(valeurs, modifie);
  }, [valeurs, modifie]);
  useEffect(() => {
    if (champAgent) formulaire.current?.querySelector<HTMLButtonElement>('[data-champ="agentId"] button')?.focus();
    else if (initiale?.scheduleKind === "once" && !initiale.active && valeursRecues.active) formulaire.current?.querySelector<HTMLInputElement>("[data-routine-date]")?.focus();
    // Pas de focus automatique sur le nom : le clavier du téléphone cacherait la moitié de la page à l'ouverture.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fuseaux = useMemo(() => {
    let possibles: string[] = [];
    try {
      possibles = Intl.supportedValuesOf("timeZone");
    } catch {
      /* Le fuseau de l'ordinateur et UTC restent proposés. */
    }
    return [...new Set(["UTC", contexte.fuseau, valeurs.timezone, ...possibles])]
      .map((value) => ({ value, label: `${ville(value)} · ${value}` }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [contexte.fuseau, valeurs.timezone]);

  const changer = <K extends keyof Required<RoutineInput>>(champ: K, value: Required<RoutineInput>[K]) => {
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
      conteneur?.scrollIntoView({ block: "center" });
    });
  };

  const enregistrer = async (event: FormEvent) => {
    event.preventDefault();
    if (occupe || !ouvert) return;
    setEssai(true);
    setServeur(null);
    const controles = erreursSaisie(valeurs, agentActif, agentNom, projetPresent);
    const premier = ORDRE.find((champ) => controles[champ]);
    if (premier) {
      focaliserErreur(premier);
      return;
    }
    let schedule = valeurs.schedule;
    // Comme au bureau : une nouvelle cadence commence au geste d'enregistrement.
    if (schedule.kind === "interval" && (!initiale || JSON.stringify(schedule) !== JSON.stringify(base.schedule))) schedule = { ...schedule, anchorAt: new Date().toISOString() };
    const input = { ...valeurs, name: valeurs.name.trim(), instruction: valeurs.instruction.trim(), schedule };
    if (JSON.stringify(input).length > DEMANDE_MAX) {
      setServeur({ champ: "instruction", message: "Depuis le téléphone, la consigne peut contenir 60 000 caractères au maximum." });
      focaliserErreur("instruction");
      return;
    }
    setOccupe(true);
    try {
      await onEnregistrer(input);
    } catch (error) {
      const echec = erreurDuMoteur(error);
      setServeur(echec);
      if (echec.champ === "timezone") setChoisirFuseau(true);
      focaliserErreur(echec.champ);
    } finally {
      setOccupe(false);
    }
  };

  const optionsAgents = actifs.map((a) => ({ value: a.id, label: a.tag ? `${a.name} · ${a.tag}` : a.name, icone: <RondApercu agentId={a.id} nom={a.name} teinte={a.teinte} taille={20} />, disabled: false }));
  if (!agentActif) {
    optionsAgents.unshift({
      value: valeurs.agentId,
      label: `${agentNom} · ${agent?.connu ? "désactivé" : "introuvable"}`,
      icone: <RondApercu agentId={valeurs.agentId} nom={agentNom} teinte={agent?.teinte ?? "jaune"} taille={20} />,
      disabled: true,
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-fond-page">
      <EnteteTelephone
        titre={initiale ? `Modifier « ${initiale.name} »` : "Nouvelle routine"}
        droite={
          <button type="button" className="min-h-11 px-2 text-ui text-texte-principal" disabled={occupe} onClick={onAnnuler}>
            Annuler
          </button>
        }
      />
      <form ref={formulaire} noValidate aria-label={initiale ? `Modifier « ${initiale.name} »` : "Nouvelle routine"} aria-busy={occupe} onSubmit={enregistrer} className="flex min-h-0 flex-1 flex-col">
        <div className="@container flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-2 pb-6">
          {changeeAilleurs ? (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-bordure-forte bg-fond-surface p-3">
              <p className={cn(AIDE, "flex-1")}>Cette routine a changé pendant que tu la modifiais.</p>
              <Bouton variant="blanc" taille="md" disabled={occupe} onClick={onRecharger}>
                Recharger
              </Bouton>
            </div>
          ) : null}
          <div data-champ="name">
            <Champ label="Nom">
              <Input
                ref={nom}
                size="lg"
                value={valeurs.name}
                maxLength={80}
                placeholder="Point de la semaine"
                disabled={occupe}
                aria-invalid={!!erreur("name")}
                aria-describedby={description("name")}
                onChange={(e) => changer("name", e.target.value)}
                className={CHAMP_TELEPHONE}
              />
              <Erreur id={description("name")} message={erreur("name")} />
              {valeurs.name.length >= 70 ? <span className={AIDE}>{valeurs.name.length}/80</span> : null}
            </Champ>
          </div>
          <div data-champ="agentId">
            <Champ label="Agent">
              <div role="group" aria-label="Agent" aria-describedby={description("agentId")} className="[&_button]:min-h-12 [&_button]:text-body-s">
                <ListeDeroulante libelle="Agent" value={valeurs.agentId} options={optionsAgents} disabled={occupe} onChange={(value) => changer("agentId", value)} />
              </div>
              <Erreur id={description("agentId")} message={erreur("agentId")} />
            </Champ>
          </div>
          <div data-champ="instruction">
            <Champ label="Consigne">
              <Textarea
                size="lg"
                autoGrow
                value={valeurs.instruction}
                maxLength={100000}
                disabled={occupe}
                placeholder="Fais le point sur les tâches de cette semaine et indique celles qui demandent une décision."
                aria-invalid={!!erreur("instruction")}
                aria-describedby={description("instruction") ?? `${id}-consigne-aide`}
                onChange={(e) => changer("instruction", e.target.value)}
                className={cn(CHAMP_TELEPHONE, "min-h-[160px]")}
              />
              <Erreur id={description("instruction")} message={erreur("instruction")} />
              <span id={`${id}-consigne-aide`} className={AIDE}>
                Elle part telle quelle à chaque exécution, comme un message que tu lui écrirais. {agentNom} ne voit pas cette page : écris tout ce qu’il doit savoir.
              </span>
            </Champ>
          </div>
          <div className="[&_input]:min-h-12 [&_input]:text-body-s [&_[role=radio]]:min-h-11 [&_button]:min-h-11">
            <PlanningRoutine value={valeurs.schedule} onChange={changerPlanning} timezone={valeurs.timezone} erreur={erreur("schedule")} disabled={occupe} />
          </div>
          <ApercuPlanning schedule={valeurs.schedule} timezone={valeurs.timezone} />
          {initiale?.scheduleKind === "once" && !initiale.active && !valeurs.active ? (
            <p className={AIDE}>Cette routine est en pause. Modifier sa date ne la relance pas ; tu pourras la reprendre après l’enregistrement.</p>
          ) : null}
          {valeurs.schedule.kind !== "manual" ? (
            valeurs.schedule.kind === "once" ? (
              <p className={AIDE}>Si l’app est fermée à cette heure-là, elle part à la réouverture.</p>
            ) : (
              <fieldset disabled={occupe} className="flex min-w-0 flex-col gap-3">
                <legend className="mb-2 text-ui-s font-medium text-texte-principal">Si l’app est fermée à l’heure prévue</legend>
                <div role="radiogroup" aria-label="Exécutions manquées" className="flex flex-col gap-2">
                  <ChoixRattrapage value="skip" actuel={valeurs.missedPolicy} disabled={occupe} onChange={(v) => changer("missedPolicy", v)} titre="Ne rien rattraper">
                    Au retour, l’historique note les exécutions manquées. Rien ne part en retard.
                  </ChoixRattrapage>
                  <ChoixRattrapage value="run-once" actuel={valeurs.missedPolicy} disabled={occupe} onChange={(v) => changer("missedPolicy", v)} titre="Rattraper la plus récente">
                    Au retour, seule la dernière exécution manquée part, en retard. Les autres sont notées manquées.
                  </ChoixRattrapage>
                </div>
                <p className={AIDE}>KLYRA n’exécute rien app fermée ou ordinateur en veille. Une exécution dépassée de moins de 5 minutes part normalement.</p>
              </fieldset>
            )
          ) : null}
          <div data-champ="timezone">
            {choisirFuseau || erreur("timezone") ? (
              <Champ label="Fuseau horaire">
                <div role="group" aria-label="Fuseau horaire" aria-describedby={description("timezone")} className="[&_button]:min-h-12 [&_button]:text-body-s">
                  <ListeDeroulante libelle="Fuseau horaire" value={valeurs.timezone} options={fuseaux} disabled={occupe} onChange={(value) => changer("timezone", value)} />
                </div>
                <Erreur id={description("timezone")} message={erreur("timezone")} />
              </Champ>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className={cn(AIDE, "break-words")}>
                  Heures de {ville(valeurs.timezone)} ({valeurs.timezone})
                </p>
                <Bouton variant="discret" taille="compact" className="min-h-11" disabled={occupe} onClick={() => setChoisirFuseau(true)}>
                  Changer
                </Bouton>
              </div>
            )}
          </div>
          {contexte.serveurs.length > 0 || valeurs.lieu ? (
            <Champ label="Machine" aide={initiale ? "Une routine reste sur sa machine." : `Sur un VPS, elle tourne même quand ${sur} est éteint.`}>
              <div className="[&_button]:min-h-12 [&_button]:text-body-s">
                <ListeDeroulante
                  libelle="Machine"
                  value={valeurs.lieu ?? "pc"}
                  disabled={occupe || !!initiale}
                  options={[
                    { value: "pc", label: majuscule(sur) },
                    ...contexte.serveurs.map((s) => ({ value: s.adresse, label: s.nom })),
                    ...(valeurs.lieu && !contexte.serveurs.some((s) => s.adresse === valeurs.lieu) ? [{ value: valeurs.lieu, label: `${nomLieu(valeurs.lieu)} (plus relié)`, disabled: true }] : []),
                  ]}
                  onChange={(value) => setValeurs((courantes) => ({ ...courantes, lieu: value === "pc" ? null : value, projectId: null }))}
                />
              </div>
            </Champ>
          ) : null}
          <div data-champ="projectId">
            <Champ label="Où arrive le résultat">
              <div role="group" aria-label="Où arrive le résultat" aria-describedby={description("projectId")} className="[&_button]:min-h-12 [&_button]:text-body-s">
                <ListeDeroulante
                  libelle="Où arrive le résultat"
                  value={valeurs.projectId ?? ""}
                  disabled={occupe}
                  options={[
                    { value: "", label: valeurs.lieu ? `Conversation de la routine, sur ${nomLieu(valeurs.lieu)}` : `Conversation avec ${agentNom}` },
                    ...(!projetPresent ? [{ value: valeurs.projectId!, label: "Projet indisponible", disabled: true }] : []),
                    ...projetsIci.map((p) => ({ value: p.id, label: `Projet ${p.name}` })),
                  ]}
                  onChange={(value) => changer("projectId", value || null)}
                />
              </div>
              <Erreur id={description("projectId")} message={erreur("projectId")} />
            </Champ>
          </div>
          {erreur("formulaire") ? (
            <div data-champ="formulaire" tabIndex={-1}>
              <Erreur id={description("formulaire")} message={erreur("formulaire")} />
            </div>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-bordure-subtile bg-fond-page px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <BoutonPrincipal type="submit" className="w-full" disabled={occupe || !ouvert}>
            {initiale ? "Enregistrer" : "Créer la routine"}
          </BoutonPrincipal>
          {!ouvert ? <NotePoste /> : null}
        </div>
      </form>
    </div>
  );
}

function Erreur({ id, message }: { id?: string; message?: string }) {
  return message ? (
    <span id={id} role="alert" className="text-ui-xs text-texte-erreur">
      {message}
    </span>
  ) : null;
}

/** Les prochains départs si l'on enregistre maintenant, calculés par le moteur de l'ordinateur. */
function ApercuPlanning({ schedule, timezone }: { schedule: RoutineSchedule; timezone: string }) {
  const cle = JSON.stringify([schedule, timezone]);
  const [demande, setDemande] = useState<{ cle: string; args: { schedule: RoutineSchedule; timezone: string } } | null>(null);
  useEffect(() => {
    if (schedule.kind === "manual") return;
    const minuteur = setTimeout(() => setDemande({ cle, args: { schedule, timezone } }), 250);
    return () => clearTimeout(minuteur);
  }, [schedule, timezone, cle]);
  const lecture = useLecturePoste<string[]>("routines.apercu", schedule.kind === "manual" || demande?.cle !== cle ? null : demande.args);
  if (schedule.kind === "manual") return null;
  if (demande?.cle !== cle || lecture.etat === "attente") {
    return (
      <p role="status" className={AIDE}>
        Aperçu des dates en cours…
      </p>
    );
  }
  if (lecture.etat !== "ok") {
    return (
      <p role="status" className={AIDE}>
        {lecture.etat === "erreur" && lecture.code !== "moteur" && lecture.message ? lecture.message : "Aperçu indisponible. Le planning sera vérifié à l’enregistrement."}
      </p>
    );
  }
  return (
    <div role="status" className={AIDE}>
      <p>Prochains départs si tu enregistres maintenant :</p>
      <ul className="list-disc pl-5">
        {lecture.data.map((date) => (
          <li key={date}>{quandRoutine(date, timezone)}</li>
        ))}
      </ul>
    </div>
  );
}

function ChoixRattrapage({
  value,
  actuel,
  onChange,
  disabled,
  titre,
  children,
}: {
  value: Routine["missedPolicy"];
  actuel: Routine["missedPolicy"];
  onChange: (value: Routine["missedPolicy"]) => void;
  disabled: boolean;
  titre: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={actuel === value}
      disabled={disabled}
      onClick={() => onChange(value)}
      className={cn(
        "flex min-h-11 flex-col gap-1 rounded-md border p-3 text-left active:bg-fond-survol disabled:opacity-60",
        actuel === value ? "border-bordure-forte bg-fond-surface shadow-ombre-xs" : "border-bordure-subtile bg-fond-page",
      )}
    >
      <span className="text-ui font-medium text-texte-principal">{titre}</span>
      <span className={AIDE}>{children}</span>
    </button>
  );
}
