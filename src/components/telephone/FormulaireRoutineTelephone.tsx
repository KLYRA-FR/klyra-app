"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input, Textarea } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { erreurDuMoteur, erreursSaisie, ORDRE, type ChampErreur } from "@/components/routines/FormulaireRoutine";
import { aujourdHui, FREQUENCES, JOURS, planningDeType, resumeAvance, VALEURS_JOURS } from "@/components/routines/PlanningRoutine";
import { Bouton } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { useLecturePoste } from "@/lib/poste/client";
import { majuscule } from "@/lib/poste-texte";
import { quandRoutine } from "@/lib/routines-affichage";
import { DEMANDE_MAX, type InitialeBrouillon, type RoutinesLues } from "@/lib/telephone/routines-telephone";
import type { RoutineInput, RoutineSchedule } from "@/types/routines";
import { BOUTON_INACTIF, CHAMP_KLYRA_UI, MessageErreur } from "./Controles";
import { ChoixFeuille, type OptionChoix } from "./Feuille";
import { Etiquette, GroupeListe, LigneChoix, LigneListe, LigneSaisie, SectionListe, TuileIcone, ValeurLigne } from "./Liste";
import { PagePleine } from "./PagePleine";
import { BandeauEtat, NoteGeste, useAccesGeste } from "./etats";
import { useSupport } from "./poste";

/**
 * E7-18 à E7-23 : le formulaire d'une routine en page pleine. Mêmes champs et mêmes règles que
 * `FormulaireRoutine` du bureau (contrôles de `erreursSaisie`, erreurs du moteur placées par
 * `erreurDuMoteur`) ; les listes déroulantes deviennent des lignes qui ouvrent une feuille de choix
 * (D-6), l'heure et la date passent par le sélecteur du système. Agents, projets, machines et fuseau
 * viennent de l'ordinateur.
 */

export type ContexteRoutine = Pick<RoutinesLues, "agents" | "projets" | "serveurs" | "fuseau" | "lieu">;

const AIDE = "text-ui-xs leading-[1.4] text-texte-secondaire";

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

/** Le fuseau se lit par sa ville ; la valeur technique reste interne (E7-19). */
const ville = (timezone: string) => timezone.split("/").at(-1)?.replaceAll("_", " ") || timezone;

const dateFr = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dateLisible = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? dateFr.format(new Date(`${date}T00:00:00Z`)) : "À choisir");

type FeuilleOuverte = "agent" | "frequence" | "jour" | "jourMois" | "minute" | "unite" | "fuseau" | "machine" | "destination";

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
  onFermer,
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
  /** Quitter pour de bon : le brouillon est effacé (la confirmation est faite ici). */
  onFermer: () => void;
}) {
  const sur = useSupport();
  const { possible } = useAccesGeste();
  const id = useId();
  const [base] = useState(() => complet(baseRecue, contexte.fuseau));
  const [valeurs, setValeurs] = useState(() => complet(valeursRecues, contexte.fuseau));
  /* Un formulaire arrivé déjà rempli sans routine derrière : un brouillon (atelier, exemple, reprise). */
  const [prerempli] = useState(() => !initiale && JSON.stringify(complet(valeursRecues, contexte.fuseau)) !== JSON.stringify(complet(baseRecue, contexte.fuseau)));
  const [essai, setEssai] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [serveur, setServeur] = useState<{ champ: ChampErreur; message: string } | null>(null);
  const [feuille, setFeuille] = useState<FeuilleOuverte | null>(null);
  const formulaire = useRef<HTMLDivElement>(null);
  const signaler = useRef(onChange);

  const actifs = contexte.agents.filter((a) => a.actif);
  const agent = contexte.agents.find((a) => a.id === valeurs.agentId);
  const agentActif = actifs.some((a) => a.id === valeurs.agentId);
  const agentNom = agent?.name ?? "Agent indisponible";
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
    // Pas de focus automatique sur le nom : le clavier du téléphone cacherait la moitié de la page à l'ouverture.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fuseaux = useMemo<OptionChoix<string>[]>(() => {
    let possibles: string[] = [];
    try {
      possibles = Intl.supportedValuesOf("timeZone");
    } catch {
      /* Le fuseau de l'ordinateur et UTC restent proposés. */
    }
    return [...new Set(["UTC", contexte.fuseau, valeurs.timezone, ...possibles])].map((value) => ({ value, label: ville(value) })).sort((a, b) => a.label.localeCompare(b.label, "fr"));
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

  const enregistrer = async () => {
    if (occupe || !possible) return;
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
      focaliserErreur(echec.champ);
    } finally {
      setOccupe(false);
    }
  };

  const optionsAgents: OptionChoix<string>[] = actifs.map((a) => ({ value: a.id, label: a.name, etiquette: a.tag ? <Etiquette>{a.tag}</Etiquette> : undefined, debut: <RondApercu agentId={a.id} nom={a.name} teinte={a.teinte} taille={32} /> }));
  if (!agentActif) optionsAgents.unshift({ value: valeurs.agentId, label: `${agentNom} · ${agent?.connu ? "désactivé" : "introuvable"}`, debut: <RondApercu agentId={valeurs.agentId} nom={agentNom} teinte={agent?.teinte ?? "jaune"} taille={32} />, desactivee: true });
  const optionsDestination: OptionChoix<string>[] = [
    { value: "", label: valeurs.lieu ? `Conversation de la routine, sur ${nomLieu(valeurs.lieu)}` : `Conversation avec ${agentNom}` },
    ...(!projetPresent ? [{ value: valeurs.projectId!, label: "Projet indisponible", desactivee: true }] : []),
    ...projetsIci.map((p) => ({ value: p.id, label: `Projet ${p.name}` })),
  ];
  const optionsMachine: OptionChoix<string>[] = [
    { value: "pc", label: majuscule(sur) },
    ...contexte.serveurs.map((s) => ({ value: s.adresse, label: s.nom })),
    ...(valeurs.lieu && !contexte.serveurs.some((s) => s.adresse === valeurs.lieu) ? [{ value: valeurs.lieu, label: `${nomLieu(valeurs.lieu)} (plus relié)`, desactivee: true }] : []),
  ];
  const s = valeurs.schedule;
  const avance = s.kind === "advanced" || s.kind === "custom";
  const libelleFrequence = FREQUENCES.find((f) => f.value === s.kind)?.label ?? (s.kind === "custom" ? "Expression cron" : "Programmation avancée");
  const destination = optionsDestination.find((o) => o.value === (valeurs.projectId ?? ""))?.label ?? "";
  const fermerFeuille = () => setFeuille(null);
  const titrePage = initiale ? `Modifier « ${initiale.name} »` : "Nouvelle routine";
  const erreurPied = erreur("formulaire");

  return (
    <PagePleine
      titre={titrePage}
      modifie={modifie}
      onFermer={() => {
        if (!occupe) onFermer();
      }}
      onEnvoyer={() => void enregistrer()}
      pied={
        <div className="flex flex-col gap-2">
          {erreurPied ? (
            <div data-champ="formulaire" tabIndex={-1}>
              <BandeauEtat ton="erreur" icone={<Icon name="help-circle-contained" size={20} />}>
                {erreurPied}
              </BandeauEtat>
            </div>
          ) : null}
          <Bouton type="submit" variant="sombre" taille="md" className={cn("w-full", BOUTON_INACTIF)} disabled={occupe || !possible}>
            {occupe ? "Enregistrement…" : initiale ? "Enregistrer" : "Créer la routine"}
          </Bouton>
          {!possible ? <NoteGeste className="px-1 text-ui-xs text-texte-secondaire" /> : null}
        </div>
      }
    >
      <div ref={formulaire} aria-busy={occupe} className="flex flex-col gap-[18px]">
        {prerempli ? (
          <BandeauEtat ton="info" icone={<Icon name="help-circle-contained" size={20} />}>
            <b className="font-semibold">Brouillon à relire.</b> Rien n’est planifié avant « Créer la routine ».
          </BandeauEtat>
        ) : null}
        {changeeAilleurs ? (
          <BandeauEtat
            icone={<Icon name="refresh-01" size={20} />}
            action={
              <Bouton variant="blanc" taille="compact" disabled={occupe} onClick={onRecharger}>
                Recharger
              </Bouton>
            }
          >
            Cette routine a changé pendant que tu la modifiais.
          </BandeauEtat>
        ) : null}
        <div data-champ="name" className="flex flex-col gap-2">
          <label htmlFor={`${id}-nom`} className="text-ui font-medium text-texte-principal">
            Nom
          </label>
          <Input
            id={`${id}-nom`}
            size="lg"
            value={valeurs.name}
            maxLength={80}
            placeholder="Point de la semaine"
            disabled={occupe}
            aria-invalid={!!erreur("name")}
            aria-describedby={description("name")}
            onChange={(e) => changer("name", e.target.value)}
            className={CHAMP_KLYRA_UI}
          />
          <Erreur id={description("name")} message={erreur("name")} />
          {valeurs.name.length >= 70 ? <span className={AIDE}>{valeurs.name.length}/80</span> : null}
        </div>
        <div data-champ="agentId" className="flex flex-col gap-2">
          <span className="text-ui font-medium text-texte-principal">Agent</span>
          <GroupeListe>
            <LigneListe
              debut={<RondApercu agentId={valeurs.agentId} nom={agentNom} teinte={agent?.teinte ?? "jaune"} taille={32} className={agentActif ? undefined : "opacity-60"} />}
              retrait="tuile"
              nom={agentNom}
              etiquette={agent?.tag ? <Etiquette>{agent.tag}</Etiquette> : null}
              fin="chevron"
              onClick={occupe ? undefined : () => setFeuille("agent")}
            />
          </GroupeListe>
          <Erreur id={description("agentId")} message={erreur("agentId")} />
        </div>
        <div data-champ="instruction" className="flex flex-col gap-2">
          <label htmlFor={`${id}-consigne`} className="text-ui font-medium text-texte-principal">
            Consigne
          </label>
          <Textarea
            id={`${id}-consigne`}
            size="lg"
            autoGrow
            value={valeurs.instruction}
            maxLength={100000}
            disabled={occupe}
            placeholder="Fais le point sur les tâches de cette semaine et indique celles qui demandent une décision."
            aria-invalid={!!erreur("instruction")}
            aria-describedby={description("instruction") ?? `${id}-consigne-aide`}
            onChange={(e) => changer("instruction", e.target.value)}
            className={cn(CHAMP_KLYRA_UI, "min-h-[132px]")}
          />
          <Erreur id={description("instruction")} message={erreur("instruction")} />
          <span id={`${id}-consigne-aide`} className={AIDE}>
            Elle part telle quelle à chaque exécution, comme un message que tu lui écrirais. {agentNom} ne voit pas cette page : écris tout ce qu’il doit savoir.
          </span>
        </div>
        <div data-champ="schedule" className="flex flex-col gap-2">
          <SectionListe titre="Quand">
            <GroupeListe>
              {avance ? (
                <LigneListe debut={<TuileIcone icone="calendar-01" />} retrait="tuile" nom="Fréquence" fin={<ValeurLigne chevron={false}>{libelleFrequence}</ValeurLigne>} />
              ) : (
                <LigneListe debut={<TuileIcone icone="calendar-01" />} retrait="tuile" nom="Fréquence" fin={<ValeurLigne chevron>{libelleFrequence}</ValeurLigne>} onClick={occupe ? undefined : () => setFeuille("frequence")} />
              )}
              {s.kind === "weekly" ? <LigneListe debut={<TuileIcone icone="calendar-01" />} retrait="tuile" nom="Jour" fin={<ValeurLigne chevron>{JOURS[VALEURS_JOURS.indexOf(s.weekday)]}</ValeurLigne>} onClick={occupe ? undefined : () => setFeuille("jour")} /> : null}
              {s.kind === "monthly" ? <LigneListe debut={<TuileIcone icone="calendar-01" />} retrait="tuile" nom="Jour du mois" fin={<ValeurLigne chevron>{s.day === 1 ? "1er" : s.day}</ValeurLigne>} onClick={occupe ? undefined : () => setFeuille("jourMois")} /> : null}
              {s.kind === "hourly" ? <LigneListe debut={<TuileIcone icone="clock-01" />} retrait="tuile" nom="Minute" fin={<ValeurLigne chevron>{String(s.minute).padStart(2, "0")}</ValeurLigne>} onClick={occupe ? undefined : () => setFeuille("minute")} /> : null}
              {s.kind === "once" ? (
                <LigneSaisie icone="calendar-01" nom="Date" valeur={dateLisible(s.date)}>
                  <SelecteurSysteme type="date" libelle="Date" min={aujourdHui(valeurs.timezone)} valeur={s.date} disabled={occupe} onChange={(date) => changerPlanning({ ...s, date })} />
                </LigneSaisie>
              ) : null}
              {"time" in s && typeof s.time === "string" ? (
                <LigneSaisie icone="clock-01" nom="Heure" valeur={s.time || "À choisir"}>
                  <SelecteurSysteme type="time" libelle="Heure" valeur={s.time} disabled={occupe} onChange={(time) => changerPlanning({ ...s, time } as RoutineSchedule)} />
                </LigneSaisie>
              ) : null}
              {s.kind === "interval" ? (
                <>
                  <LigneSaisie icone="clock-01" nom="Toutes les">
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label="Toutes les"
                      min={s.unit === "minutes" ? 3 : 1}
                      max={100000}
                      step={1}
                      value={s.amount || ""}
                      disabled={occupe}
                      onChange={(e) => changerPlanning({ ...s, amount: Number(e.target.value) })}
                      className={cn(CHAMP_KLYRA_UI, "h-11 w-24 px-3 text-right")}
                    />
                  </LigneSaisie>
                  <LigneListe debut={<TuileIcone icone="calendar-01" />} retrait="tuile" nom="Unité" fin={<ValeurLigne chevron>{s.unit === "minutes" ? "Minutes" : s.unit === "hours" ? "Heures" : "Jours"}</ValeurLigne>} onClick={occupe ? undefined : () => setFeuille("unite")} />
                </>
              ) : null}
            </GroupeListe>
          </SectionListe>
          {avance ? (
            <div className="flex flex-col gap-2 px-1">
              <p className={cn(AIDE, "break-words")}>{resumeAvance(s)}</p>
              <p className={AIDE}>Cette programmation est conservée. Tu peux la remplacer volontairement par une fréquence simple.</p>
              <Bouton variant="blanc" taille="md" disabled={occupe} onClick={() => changerPlanning(planningDeType("daily", s, valeurs.timezone))}>
                Remplacer par une fréquence simple
              </Bouton>
            </div>
          ) : null}
          {s.kind === "manual" ? <p className={cn(AIDE, "px-1")}>Elle ne part que quand tu la lances.</p> : null}
          {s.kind === "monthly" && s.day > 28 ? <p className={cn(AIDE, "px-1")}>Les mois sans ce jour sont sautés.</p> : null}
          {s.kind === "interval" ? <p className={cn(AIDE, "px-1")}>Un nouvel intervalle commence à l’enregistrement ; la première exécution part après cet intervalle. Minimum 3 minutes. Modifier seulement le nom ou la consigne conserve le rythme existant.</p> : null}
          <Erreur id={description("schedule")} message={erreur("schedule")} />
        </div>
        <ApercuPlanning schedule={s} timezone={valeurs.timezone} />
        {initiale?.scheduleKind === "once" && !initiale.active && !valeurs.active ? <p className={AIDE}>Cette routine est en pause. Modifier sa date ne la relance pas ; tu pourras la reprendre après l’enregistrement.</p> : null}
        {s.kind !== "manual" ? (
          s.kind === "once" ? (
            <p className={AIDE}>Si l’app est fermée à cette heure-là, elle part à la réouverture.</p>
          ) : (
            <SectionListe titre="Si l’app est fermée à l’heure prévue">
              <div role="radiogroup" aria-label="Exécutions manquées">
                <GroupeListe>
                  <LigneChoix nom="Ne rien rattraper" ligne2="Au retour, l’historique note les exécutions manquées. Rien ne part en retard." choisie={valeurs.missedPolicy === "skip"} desactivee={occupe} onChoisir={() => changer("missedPolicy", "skip")} />
                  <LigneChoix nom="Rattraper la plus récente" ligne2="Au retour, seule la dernière exécution manquée part, en retard. Les autres sont notées manquées." choisie={valeurs.missedPolicy === "run-once"} desactivee={occupe} onChoisir={() => changer("missedPolicy", "run-once")} />
                </GroupeListe>
              </div>
              <p className={cn(AIDE, "mt-2 px-1")}>KLYRA n’exécute rien app fermée ou ordinateur en veille. Une exécution dépassée de moins de 5 minutes part normalement.</p>
            </SectionListe>
          )
        ) : null}
        <GroupeListe>
          <LigneListe debut={<TuileIcone icone="globe-01" />} retrait="tuile" nom="Fuseau horaire" fin={<ValeurLigne chevron>{ville(valeurs.timezone)}</ValeurLigne>} onClick={occupe ? undefined : () => setFeuille("fuseau")} />
          {contexte.serveurs.length > 0 || valeurs.lieu ? (
            <LigneListe debut={<TuileIcone icone="computer" />} retrait="tuile" nom="Machine" ligne2={initiale ? "Une routine reste sur sa machine." : `Sur un VPS, elle tourne même quand ${sur} est éteint.`} fin={<ValeurLigne chevron={!initiale}>{nomLieu(valeurs.lieu)}</ValeurLigne>} onClick={occupe || initiale ? undefined : () => setFeuille("machine")} />
          ) : null}
          <LigneListe debut={<TuileIcone icone="message-square" />} retrait="tuile" nom="Où arrive le résultat" ligne2={destination} uneLigne fin="chevron" onClick={occupe ? undefined : () => setFeuille("destination")} />
        </GroupeListe>
        {erreur("timezone") ? (
          <div data-champ="timezone" tabIndex={-1}>
            <Erreur id={description("timezone")} message={erreur("timezone")} />
          </div>
        ) : null}
        {erreur("projectId") ? (
          <div data-champ="projectId" tabIndex={-1}>
            <Erreur id={description("projectId")} message={erreur("projectId")} />
          </div>
        ) : null}
      </div>

      {feuille === "agent" ? <ChoixFeuille titre="Agent" valeur={valeurs.agentId} options={optionsAgents} onChoisir={(v) => changer("agentId", v)} onFermer={fermerFeuille} /> : null}
      {feuille === "frequence" ? <ChoixFeuille titre="Fréquence" valeur={s.kind} options={FREQUENCES} onChoisir={(kind) => { if (kind !== "advanced" && kind !== "custom") changerPlanning(planningDeType(kind, s, valeurs.timezone)); }} onFermer={fermerFeuille} /> : null}
      {feuille === "jour" && s.kind === "weekly" ? <ChoixFeuille titre="Jour" valeur={String(s.weekday)} options={JOURS.map((label, i) => ({ value: String(VALEURS_JOURS[i]), label }))} onChoisir={(v) => changerPlanning({ ...s, weekday: Number(v) })} onFermer={fermerFeuille} /> : null}
      {feuille === "jourMois" && s.kind === "monthly" ? <ChoixFeuille titre="Jour du mois" valeur={String(s.day)} options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "1er" : String(i + 1) }))} onChoisir={(v) => changerPlanning({ ...s, day: Number(v) })} onFermer={fermerFeuille} /> : null}
      {feuille === "minute" && s.kind === "hourly" ? <ChoixFeuille titre="Minute" valeur={String(s.minute)} options={Array.from({ length: 60 }, (_, m) => ({ value: String(m), label: String(m).padStart(2, "0") }))} onChoisir={(v) => changerPlanning({ ...s, minute: Number(v) })} onFermer={fermerFeuille} /> : null}
      {feuille === "unite" && s.kind === "interval" ? <ChoixFeuille titre="Unité" valeur={s.unit} options={[{ value: "minutes" as const, label: "Minutes" }, { value: "hours" as const, label: "Heures" }, { value: "days" as const, label: "Jours" }]} onChoisir={(unit) => changerPlanning({ ...s, unit })} onFermer={fermerFeuille} /> : null}
      {feuille === "fuseau" ? <ChoixFeuille titre="Fuseau horaire" valeur={valeurs.timezone} options={fuseaux} onChoisir={(v) => changer("timezone", v)} onFermer={fermerFeuille} /> : null}
      {feuille === "machine" ? <ChoixFeuille titre="Machine" valeur={valeurs.lieu ?? "pc"} options={optionsMachine} onChoisir={(v) => setValeurs((c) => ({ ...c, lieu: v === "pc" ? null : v, projectId: null }))} onFermer={fermerFeuille} /> : null}
      {feuille === "destination" ? <ChoixFeuille titre="Où arrive le résultat" valeur={valeurs.projectId ?? ""} options={optionsDestination} onChoisir={(v) => changer("projectId", v || null)} onFermer={fermerFeuille} /> : null}
    </PagePleine>
  );
}

/** Le sélecteur du système (heure, date), invisible sur toute la ligne : la valeur française reste affichée. */
function SelecteurSysteme({ type, libelle, valeur, min, disabled, onChange }: { type: "time" | "date"; libelle: string; valeur: string; min?: string; disabled: boolean; onChange: (valeur: string) => void }) {
  return (
    <input
      type={type}
      aria-label={libelle}
      value={valeur}
      min={min}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => {
        try {
          e.currentTarget.showPicker?.();
        } catch {
          /* Le navigateur ouvre le sien. */
        }
      }}
      className="absolute inset-0 h-full w-full cursor-pointer text-body-s opacity-0"
    />
  );
}

function Erreur({ id, message }: { id?: string; message?: string }) {
  return message ? <MessageErreur id={id}>{message}</MessageErreur> : null;
}

/** Les prochains départs si l'on enregistre maintenant, calculés par le moteur de l'ordinateur. */
const APERCU = "rounded-md bg-fond-surface-grise px-3.5 py-3 text-ui leading-[1.5] text-texte-secondaire";

function ApercuPlanning({ schedule, timezone }: { schedule: RoutineSchedule; timezone: string }) {
  const cle = JSON.stringify([schedule, timezone]);
  const [demande, setDemande] = useState<{ cle: string; args: { schedule: RoutineSchedule; timezone: string } } | null>(null);
  useEffect(() => {
    if (schedule.kind === "manual") return;
    const minuteur = setTimeout(() => setDemande({ cle, args: { schedule, timezone } }), 250);
    return () => clearTimeout(minuteur);
  }, [schedule, timezone, cle]);
  const lecture = useLecturePoste<string[]>("routines.apercu", schedule.kind === "manual" || demande?.cle !== cle ? null : demande.args, { garder: false });
  if (schedule.kind === "manual") return null;
  if (demande?.cle !== cle || lecture.etat === "attente") {
    return (
      <p role="status" className={APERCU}>
        Aperçu des dates en cours…
      </p>
    );
  }
  if (lecture.etat !== "ok") {
    return (
      <p role="status" className={APERCU}>
        {lecture.etat === "erreur" && lecture.code !== "moteur" && lecture.message ? lecture.message : "Aperçu indisponible. Le planning sera vérifié à l’enregistrement."}
      </p>
    );
  }
  return (
    <div role="status" className={APERCU}>
      <p>Prochains départs si tu enregistres maintenant :</p>
      <ul className="mt-1 list-disc pl-[18px] text-texte-principal">
        {lecture.data.map((date) => (
          <li key={date}>{quandRoutine(date, timezone)}</li>
        ))}
      </ul>
    </div>
  );
}
