"use client";

import { useState, type ReactNode } from "react";
import { Button, Card, Divider, Stack, cn } from "klyra-ui";
import { CheckIcon, ChevronDownIcon, CircleDashedIcon, CodeIcon, FileCodeIcon, LoaderCircleIcon } from "lucide-react";
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

/* ─── Texte ────────────────────────────────────────────────────── */

export function TextBubble({ text, tone }: { text: string; tone: "user" | "role" }) {
  return (
    <div
      className={cn(
        "w-fit max-w-[440px] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-ui leading-[1.45]",
        tone === "user" ? "bg-ink text-white" : "bg-surface-2 text-fg-1",
      )}
    >
      {text}
    </div>
  );
}

/* ─── Répartition des tâches ───────────────────────────────────── */

const STATUS: Record<TaskStatus, { label: string; icon: ReactNode }> = {
  fait: { label: "Fait", icon: <CheckIcon size={15} /> },
  "en-cours": { label: "En cours", icon: <LoaderCircleIcon size={15} /> },
  "a-venir": { label: "À venir", icon: <CircleDashedIcon size={15} /> },
};

function TaskRow({ task }: { task: Task }) {
  const role = useRole(task.roleId);
  const upcoming = task.status === "a-venir";
  const { label, icon } = STATUS[task.status];
  return (
    <div className={cn("flex items-center gap-2.5 px-3 py-2.5", upcoming && "text-fg-3")}>
      {icon}
      <span className="text-ui-s font-medium">{role.name}</span>
      <span className="flex-1 truncate text-ui-s text-fg-3">{task.label}</span>
      <span className="klyra-mono text-ui-3xs uppercase text-fg-3">{label}</span>
    </div>
  );
}

export function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <Card variant="outline" radius="md" padding="sm" className={cn("p-0", PART_WIDTH)}>
      {tasks.map((task, i) => (
        <div key={task.id}>
          {i > 0 && <Divider />}
          <TaskRow task={task} />
        </div>
      ))}
    </Card>
  );
}

/* ─── Livrable à choisir ───────────────────────────────────────── */

function OptionThumbnail({ layout }: { layout: DeliverableOption["layout"] }) {
  return (
    <div aria-hidden="true" className="flex h-[92px] w-[150px] gap-2 rounded-sm bg-surface-2 p-3">
      <Stack gap={5} className="flex-1 justify-center">
        <span className="h-2 w-[70%] rounded-xs bg-k3" />
        <span className="h-2 w-1/2 rounded-xs bg-k3" />
        <span className="mt-2 h-2.5 w-8 rounded-pill bg-ink" />
      </Stack>
      {layout === "texte-media" && <span className="w-[46px] rounded-xs bg-blue-mist" />}
    </div>
  );
}

export function OptionPicker({ options }: { options: DeliverableOption[] }) {
  const [selectedId, setSelectedId] = useState(options.find((o) => o.selected)?.id ?? null);
  return (
    <div role="radiogroup" aria-label="Options proposées" className="flex gap-3">
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
                selected ? "outline-[1.5px] outline-ink outline" : "outline outline-1 outline-border-1",
              )}
            >
              <OptionThumbnail layout={option.layout} />
            </span>
            <span className={cn("text-ui-xs", selected ? "font-semibold text-fg-1" : "text-fg-3")}>
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
    <Card variant="outline" radius="md" padding="sm" className={cn("gap-2 px-3 py-2.5", PART_WIDTH)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left"
      >
        <CodeIcon size={15} />
        <span className="flex-1 text-ui-s font-medium">
          A travaillé {durationMin} min · {fileCount} {fileCount > 1 ? "fichiers modifiés" : "fichier modifié"}
        </span>
        <ChevronDownIcon
          size={15}
          className={cn("text-fg-3 transition-transform duration-[220ms]", !open && "-rotate-90")}
        />
      </button>
      {open && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {files.map((file) => (
            <li key={file.path} className="klyra-mono flex items-center gap-2 text-ui-2xs text-fg-2">
              <FileCodeIcon size={13} className="shrink-0 text-fg-3" />
              <span className="flex-1 truncate">{file.path}</span>
              <span className="text-fg-3">
                +{file.added}
                {file.removed > 0 && ` −${file.removed}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ─── Actions proposées ────────────────────────────────────────── */

export function ActionRow({ actions, onAction }: { actions: MessageAction[]; onAction: (label: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action.id}
          variant={action.primary ? "dark" : "ghost"}
          size="sm"
          onClick={() => onAction(action.label)}
        >
          {action.label}
        </Button>
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
