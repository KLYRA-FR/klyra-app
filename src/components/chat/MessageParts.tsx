"use client";

import { useState, type ReactNode } from "react";
import { Stack } from "klyra-ui";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { useRole } from "@/lib/workspace";
import type {
  ChangedFile,
  DeliverableOption,
  MessageAction,
  MessagePart,
  Task,
  TaskStatus,
} from "@/types/domain";

/** Largeur max des blocs d’un message, pour garder un fil lisible. */
const PART_WIDTH = "max-w-[400px]";

/** Carte interne d’un message : blanche, bordure subtile, ombre-xs. */
const PART_CARD = "rounded-md border border-bordure-subtile bg-fond-surface shadow-ombre-xs";

/* ─── Texte ────────────────────────────────────────────────────── */

export function TextBubble({ text, tone }: { text: string; tone: "user" | "role" }) {
  return (
    <div
      className={cn(
        "w-fit max-w-[440px] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-ui leading-[1.45]",
        tone === "user" ? "bg-fond-accent text-texte-inverse" : "bg-fond-survol text-texte-principal",
      )}
    >
      {text}
    </div>
  );
}

/* ─── Répartition des tâches ───────────────────────────────────── */

/* « Fait » prend la coche pixel KLYRA ; les autres, une icône du set officiel. */
const STATUS: Record<TaskStatus, { label: string; icon: ReactNode; labelClass: string }> = {
  fait: { label: "Fait", icon: <PixelCheck className="h-[13px] w-[18px]" />, labelClass: "text-texte-accent" },
  "en-cours": {
    label: "En cours",
    icon: <Icon name="loader-01" size={16} className="animate-spin text-icone-accent [animation-duration:1.5s]" />,
    labelClass: "text-texte-accent",
  },
  "a-venir": { label: "À venir", icon: <Icon name="circle" size={16} className="text-icone-secondaire" />, labelClass: "text-texte-tertiaire" },
};

function TaskRow({ task }: { task: Task }) {
  const role = useRole(task.roleId);
  const upcoming = task.status === "a-venir";
  const { label, icon, labelClass } = STATUS[task.status];
  return (
    <div className={cn("flex items-center gap-2.5 px-3 py-2.5", upcoming && "text-texte-tertiaire")}>
      <span className="flex w-[18px] justify-center">{icon}</span>
      <span className="text-ui-s font-medium">{role.name}</span>
      <span className="flex-1 truncate text-ui-s text-texte-tertiaire">{task.label}</span>
      <span className={cn("text-ui-2xs font-medium", labelClass)}>{label}</span>
    </div>
  );
}

export function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <div className={cn(PART_CARD, "divide-y divide-bordure-subtile", PART_WIDTH)}>
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </div>
  );
}

/* ─── Livrable à choisir ───────────────────────────────────────── */

function OptionThumbnail({ layout }: { layout: DeliverableOption["layout"] }) {
  return (
    <div aria-hidden="true" className="flex h-[92px] w-[150px] gap-2 rounded-sm bg-fond-page p-3">
      <Stack gap={5} className="flex-1 justify-center">
        <span className="h-2 w-[70%] rounded-[2px] bg-gris-k1-500" />
        <span className="h-2 w-1/2 rounded-[2px] bg-gris-k2-500" />
        <span className="mt-2 h-2.5 w-8 rounded-[2px] bg-fond-inverse-fort" />
      </Stack>
      {layout === "texte-media" && <span className="w-[46px] rounded-2xs bg-(image:--degrade-carte-bleue)" />}
    </div>
  );
}

export function OptionPicker({ options }: { options: DeliverableOption[] }) {
  const [selectedId, setSelectedId] = useState(options.find((o) => o.selected)?.id ?? null);
  return (
    <div role="radiogroup" aria-label="Options proposées" className="flex flex-wrap gap-3">
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setSelectedId(option.id)}
            className="flex cursor-pointer flex-col gap-1.5 border-none bg-transparent p-0 text-left"
          >
            <span
              className={cn(
                "rounded-sm outline-offset-2 transition-[outline-color] duration-[120ms]",
                selected ? "outline-[1.5px] outline-focus outline" : "outline outline-1 outline-bordure-forte",
              )}
            >
              <OptionThumbnail layout={option.layout} />
            </span>
            <span className={cn("text-ui-xs", selected ? "font-semibold text-texte-accent" : "text-texte-tertiaire")}>
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Journal de travail ───────────────────────────────────────── */

export function WorkLog({ durationMin, files }: { durationMin: number; files: ChangedFile[] }) {
  const [open, setOpen] = useState(true);
  const fileCount = files.length;
  return (
    <div className={cn(PART_CARD, "flex flex-col gap-2 px-3 py-2.5", PART_WIDTH)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left"
      >
        <Icon name="code-01" size={16} className="text-icone-accent" />
        <span className="flex-1 text-ui-s font-medium">
          A travaillé {durationMin} min · {fileCount} {fileCount > 1 ? "fichiers modifiés" : "fichier modifié"}
        </span>
        <Icon
          name="chevron-down"
          size={16}
          className={cn("text-icone-secondaire transition-transform duration-[220ms] ease-sortie", !open && "-rotate-90")}
        />
      </button>
      {open && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {files.map((file) => (
            <li key={file.path} className="klyra-mono flex items-center gap-2 text-ui-2xs text-texte-secondaire">
              <Icon name="file-code" size={14} className="text-icone-secondaire" />
              <span className="flex-1 truncate">{file.path}</span>
              <span className="text-texte-tertiaire">
                +{file.added}
                {file.removed > 0 && ` −${file.removed}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Actions proposées ────────────────────────────────────────── */

export function ActionRow({ actions, onAction }: { actions: MessageAction[]; onAction: (label: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Bouton
          key={action.id}
          variant={action.primary ? "sombre" : "blanc"}
          taille="compact"
          onClick={() => onAction(action.label)}
        >
          {action.label}
        </Bouton>
      ))}
    </div>
  );
}

/* ─── Aiguillage ───────────────────────────────────────────────── */

export function MessagePartView({
  part,
  tone,
  onAction,
}: {
  part: MessagePart;
  tone: "user" | "role";
  onAction: (label: string) => void;
}) {
  switch (part.type) {
    case "text":
      return <TextBubble text={part.text} tone={tone} />;
    case "tasks":
      return <TaskList tasks={part.tasks} />;
    case "options":
      return <OptionPicker options={part.options} />;
    case "worklog":
      return <WorkLog durationMin={part.durationMin} files={part.files} />;
    case "actions":
      return <ActionRow actions={part.actions} onAction={onAction} />;
  }
}
