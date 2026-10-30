"use client";

import { useId } from "react";
import { Input } from "klyra-ui";
import { Bouton } from "@/components/ui/Bouton";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { cn } from "@/lib/cn";
import type { RoutineSchedule } from "@/types/routines";

const FREQUENCES = [
  { value: "manual", label: "À la demande" },
  { value: "once", label: "Une fois" },
  { value: "hourly", label: "Toutes les heures" },
  { value: "daily", label: "Chaque jour" },
  { value: "weekdays", label: "Jours ouvrés" },
  { value: "weekly", label: "Chaque semaine" },
  { value: "monthly", label: "Chaque mois" },
  { value: "interval", label: "À intervalle régulier" },
] satisfies { value: RoutineSchedule["kind"]; label: string }[];

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const VALEURS_JOURS = [1, 2, 3, 4, 5, 6, 0];
const AIDE = "m-0 text-ui-xs leading-relaxed text-texte-secondaire";

/** Date civile du fuseau choisi : le min du calendrier ne dépend pas du fuseau du poste. */
function aujourdHui(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const lire = (type: string) => parts.find((p) => p.type === type)?.value;
    return `${lire("year")}-${lire("month")}-${lire("day")}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function resumeAvance(schedule: Extract<RoutineSchedule, { kind: "advanced" | "custom" }>): string {
  if (schedule.kind === "custom") return `Cron : ${schedule.expression}`;
  const jours = schedule.days.kind === "every-day" ? "Tous les jours"
    : schedule.days.kind === "days-of-week" ? schedule.days.days.map((day) => JOURS[(day + 6) % 7]).join(", ")
      : `Jours du mois : ${schedule.days.days.join(", ")}`;
  const heure = schedule.time.kind === "at-time" ? `à ${schedule.time.time}`
    : `toutes les ${schedule.time.amount} ${schedule.time.unit === "minutes" ? "minutes" : "heures"}`;
  return `${jours}, ${heure}. Mois : ${schedule.months.join(", ")}.`;
}

/** Le calendrier est validé en dernier ressort par le moteur ; aucun minuteur ni calcul d'échéance ici. */
export function PlanningRoutine({ value, onChange, timezone, erreur, disabled = false }: {
  value: RoutineSchedule;
  onChange: (schedule: RoutineSchedule) => void;
  timezone: string;
  erreur?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const avance = value.kind === "advanced" || value.kind === "custom";
  const heure = "time" in value && typeof value.time === "string" ? value.time : "09:00";
  const erreurId = erreur ? `${id}-erreur` : undefined;
  const changerType = (kind: RoutineSchedule["kind"]) => {
    switch (kind) {
      case "manual": onChange({ kind }); break;
      case "once": onChange({ kind, date: aujourdHui(timezone), time: heure }); break;
      case "hourly": onChange({ kind, minute: 0 }); break;
      case "daily": case "weekdays": onChange({ kind, time: heure }); break;
      case "weekly": onChange({ kind, weekday: 1, time: heure }); break;
      case "monthly": onChange({ kind, day: 1, time: heure }); break;
      case "interval": onChange({ kind, amount: 1, unit: "hours", anchorAt: new Date().toISOString() }); break;
    }
  };

  return (
    <fieldset data-champ="schedule" disabled={disabled} aria-describedby={erreurId} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-2 text-ui-s font-medium text-texte-principal">Quand</legend>
      <ListeDeroulante
        libelle="Fréquence"
        value={value.kind}
        options={avance ? [{ value: value.kind, label: value.kind === "custom" ? "Expression cron" : "Programmation avancée", disabled: true }] : FREQUENCES}
        onChange={changerType}
        disabled={disabled || avance}
      />
      {avance ? (
        <div className="flex min-w-0 flex-col items-start gap-2 rounded-md border border-bordure-subtile bg-fond-page p-3">
          <p className={cn(AIDE, "break-words")}>{resumeAvance(value)}</p>
          <p className={AIDE}>Cette programmation est conservée. Tu peux la remplacer volontairement par une fréquence simple.</p>
          <Bouton disabled={disabled} variant="blanc" onClick={() => changerType("daily")} className="max-w-full whitespace-normal text-left">
            Remplacer par une fréquence simple
          </Bouton>
        </div>
      ) : (
        <>
          {value.kind === "weekly" && (
            <div role="radiogroup" aria-label="Jour de la semaine" className="flex flex-wrap gap-1.5">
              {JOURS.map((nom, index) => {
                const jour = VALEURS_JOURS[index];
                return (
                  <button key={jour} type="button" role="radio" data-jour={jour} aria-label={nom} aria-checked={value.weekday === jour}
                    tabIndex={value.weekday === jour ? 0 : -1} disabled={disabled}
                    onClick={() => onChange({ ...value, weekday: jour })}
                    onKeyDown={(event) => {
                      const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
                      if (!delta && event.key !== "Home" && event.key !== "End") return;
                      event.preventDefault();
                      const prochain = event.key === "Home" ? 0 : event.key === "End" ? 6 : (index + delta + 7) % 7;
                      onChange({ ...value, weekday: VALEURS_JOURS[prochain] });
                      event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-jour="${VALEURS_JOURS[prochain]}"]`)?.focus();
                    }}
                    className={cn("h-8 cursor-pointer rounded-sm border px-3 text-ui-xs font-medium transition-colors duration-[120ms] ease-sortie disabled:opacity-60",
                      value.weekday === jour ? "klyra-surface-sombre border-transparent text-texte-inverse" : "border-bordure-subtile bg-fond-surface text-texte-secondaire hover:border-bordure-forte")}
                  >{nom.slice(0, 3)}.</button>
                );
              })}
            </div>
          )}
          <div className="flex min-w-0 flex-wrap items-end gap-4">
            {value.kind === "once" && (
              <Champ label="Date" className="min-w-0 flex-1 basis-[140px]">
                <Input size="sm" type="date" min={aujourdHui(timezone)} value={value.date} disabled={disabled} aria-invalid={!!erreur} aria-describedby={erreurId}
                  data-routine-date onChange={(e) => onChange({ ...value, date: e.target.value })} className={cn(CHAMP, "min-w-0")} />
              </Champ>
            )}
            {value.kind === "hourly" && (
              <Champ label="Minute" className="w-[140px] max-w-full">
                <ListeDeroulante libelle="Minute" value={String(value.minute)} disabled={disabled}
                  options={Array.from({ length: 60 }, (_, minute) => ({ value: String(minute), label: String(minute).padStart(2, "0") }))}
                  onChange={(minute) => onChange({ ...value, minute: Number(minute) })} />
              </Champ>
            )}
            {value.kind === "monthly" && (
              <Champ label="Jour du mois" className="w-[140px] max-w-full">
                <ListeDeroulante libelle="Jour du mois" value={String(value.day)} disabled={disabled}
                  options={Array.from({ length: 31 }, (_, day) => ({ value: String(day + 1), label: day === 0 ? "1er" : String(day + 1) }))}
                  onChange={(day) => onChange({ ...value, day: Number(day) })} />
              </Champ>
            )}
            {("time" in value && typeof value.time === "string") && (
              <Champ label="Heure" className="w-[140px] max-w-full">
                <Input size="sm" type="time" value={value.time} disabled={disabled} aria-invalid={!!erreur} aria-describedby={erreurId}
                  onChange={(e) => onChange({ ...value, time: e.target.value })} className={CHAMP} />
              </Champ>
            )}
            {value.kind === "interval" && (
              <>
                <Champ label="Toutes les" className="w-[140px] max-w-full">
                  <Input size="sm" type="number" min={value.unit === "minutes" ? 3 : 1} max={100000} step={1} value={value.amount || ""} disabled={disabled}
                    aria-invalid={!!erreur} aria-describedby={erreurId} onChange={(e) => onChange({ ...value, amount: Number(e.target.value) })} className={CHAMP} />
                </Champ>
                <Champ label="Unité" className="min-w-0 flex-1 basis-[140px]">
                  <ListeDeroulante libelle="Unité de l’intervalle" value={value.unit} disabled={disabled}
                    options={[{ value: "minutes", label: "Minutes" }, { value: "hours", label: "Heures" }, { value: "days", label: "Jours" }]}
                    onChange={(unit) => onChange({ ...value, unit })} />
                </Champ>
              </>
            )}
          </div>
          {value.kind === "manual" && <p className={AIDE}>Elle ne part que quand tu la lances.</p>}
          {value.kind === "weekdays" && <p className={AIDE}>Du lundi au vendredi.</p>}
          {value.kind === "monthly" && value.day > 28 && <p className={AIDE}>Les mois sans ce jour sont sautés.</p>}
          {value.kind === "interval" && <p className={AIDE}>Un nouvel intervalle commence à l’enregistrement ; la première exécution part après cet intervalle. Minimum 3 minutes. Modifier seulement le nom ou la consigne conserve le rythme existant.</p>}
        </>
      )}
      {erreur && <p id={erreurId} role="alert" className="m-0 text-ui-xs text-texte-erreur">{erreur}</p>}
    </fieldset>
  );
}
