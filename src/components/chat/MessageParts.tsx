"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Stack } from "klyra-ui";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { Markdown } from "@/components/ui/Markdown";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { getBridge } from "@/lib/bridge";
import { iconeEtape } from "@/lib/etapes";
import { idDirect, useRole } from "@/lib/workspace";
import { PastilleExtension } from "./PastilleExtension";
import type {
  ChangedFile,
  DeliverableOption,
  Etape,
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

/**
 * Bulle de texte. Toi : à droite, en noir uni (sans reflet), le texte
 * tel que tu l'as tapé. Un agent : à gauche, en gris clair, sa réponse en
 * Markdown (titres, listes, code).
 */
export function TextBubble({ text, tone }: { text: string; tone: "user" | "role" }) {
  if (tone === "user") {
    return (
      <div className="w-fit max-w-[560px] bg-fond-inverse rounded-xl px-3.5 py-2 text-ui leading-[1.55] whitespace-pre-wrap text-texte-inverse [overflow-wrap:anywhere]">
        {text}
      </div>
    );
  }
  return (
    <div className="w-fit max-w-[680px] min-w-0 rounded-xl bg-fond-survol px-3.5 py-2.5 [overflow-wrap:anywhere]">
      <Markdown source={text} className="gap-2 text-ui leading-[1.6] text-texte-principal" />
    </div>
  );
}

/* ─── Fichiers joints ──────────────────────────────────────────── */

/** Les fichiers joints à un message : une carte par fichier, un clic le montre dans le Finder. */
export function FichiersJoints({ chemins }: { chemins: string[] }) {
  const bridge = getBridge();
  return (
    <div className="flex w-[min(100%,256px)] flex-col gap-1.5">
      {chemins.map((chemin) => {
        const nom = chemin.split("/").pop() ?? chemin;
        return (
          <button
            key={chemin}
            type="button"
            title={`${chemin}\nClic pour le montrer dans le Finder`}
            onClick={() => bridge && void bridge.fichiers.montrer(chemin)}
            className="flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-md border border-bordure-subtile bg-fond-surface p-2 text-left transition-colors duration-[120ms] hover:border-bordure-forte"
          >
            <PastilleExtension chemin={chemin} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-ui-xs font-medium text-texte-principal">{nom}</span>
              <span className="truncate text-ui-3xs text-texte-tertiaire">{chemin.replace(/^\/Users\/[^/]+/, "~")}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Étapes du travail d'un agent ─────────────────────────────── */

/**
 * Ce que l'agent a fait pour répondre (lire, modifier, lancer une commande),
 * replié en une ligne : « 6 étapes · 2 fichiers modifiés ». Ouvert pendant
 * qu'il travaille, l'étape en cours en dernier.
 */
export function EtapesView({ etapes, enCours }: { etapes: Etape[]; enCours: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const propres = etapes.filter((e) => e.parent === null);
  const modifies = new Set(propres.filter((e) => /Write|Edit/.test(e.outil)).map((e) => e.libelle)).size;
  const erreurs = propres.filter((e) => e.statut === "erreur").length;
  const derniere = propres[propres.length - 1];
  const resume = [
    `${propres.length} étape${propres.length > 1 ? "s" : ""}`,
    modifies > 0 && `${modifies} fichier${modifies > 1 ? "s" : ""} modifié${modifies > 1 ? "s" : ""}`,
    erreurs > 0 && `${erreurs} en erreur`,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!propres.length) return null;

  return (
    <div className="flex max-w-[680px] flex-col gap-1">
      <button
        type="button"
        aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)}
        className="flex h-7 w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent px-1.5 text-left text-ui-xs text-texte-tertiaire transition-colors duration-[120ms] hover:bg-fond-survol hover:text-texte-principal"
      >
        <Icon
          name="chevron-right"
          size={14}
          className={cn("shrink-0 transition-transform duration-[220ms] ease-sortie", ouvert && "rotate-90")}
        />
        {enCours && derniere?.statut === "en-cours" && !ouvert ? (
          <span className="klyra-respire truncate font-medium text-texte-principal">{derniere.libelle}…</span>
        ) : (
          <span className="truncate">{resume}</span>
        )}
      </button>
      {ouvert && (
        <ol className="m-0 ml-[11px] flex list-none flex-col gap-0.5 border-l border-bordure-subtile p-0 pl-3">
          {propres.map((etape) => (
            <li key={etape.id} className="flex min-w-0 items-center gap-2 py-0.5 text-ui-xs text-texte-secondaire">
              <Icon
                name={etape.statut === "en-cours" ? "loader-01" : iconeEtape(etape.outil)}
                size={14}
                className={cn(
                  "shrink-0",
                  etape.statut === "en-cours" && "animate-spin text-icone-accent [animation-duration:1.5s]",
                  etape.statut === "erreur" ? "text-texte-erreur" : "text-icone-secondaire",
                )}
              />
              <span className={cn("truncate", etape.statut === "erreur" && "text-texte-erreur")}>{etape.libelle}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ─── Demande d'autorisation ───────────────────────────────────── */

/**
 * L'agent demande ton accord : ce qu'il veut faire, la commande exacte, et
 * tes trois réponses. Une fois répondue, la carte se résume en une ligne.
 */
export function CarteAutorisation({
  part,
  nomAgent,
  onRepondre,
}: {
  part: Extract<MessagePart, { type: "autorisation" }>;
  nomAgent: string;
  onRepondre?: (decision: "oui" | "toujours" | "non") => void;
}) {
  if (part.statut !== "attente") {
    return (
      <div className="flex max-w-[680px] items-center gap-1.5 px-1 text-ui-xs text-texte-tertiaire">
        <Icon name={part.statut === "acceptee" ? "check-01" : "x-01"} size={14} />
        <span className="truncate">
          {part.statut === "acceptee" ? "Accordé" : "Refusé"} : {part.libelle}
        </span>
      </div>
    );
  }
  return (
    <div role="alert" className="flex w-full max-w-[680px] flex-col gap-3 rounded-lg border border-bleu-k1-500 bg-fond-surface p-4 shadow-ombre-xs">
      <div className="flex flex-col gap-1">
        <span className="text-ui-s font-semibold text-texte-principal">{nomAgent} demande ton accord</span>
        <span className="text-ui-s text-texte-secondaire">{part.description || part.libelle}</span>
      </div>
      {part.detail && (
        <pre className="klyra-mono m-0 overflow-x-auto rounded-md border border-bordure-subtile bg-fond-page px-3 py-2 text-ui-xs whitespace-pre-wrap text-texte-principal [overflow-wrap:anywhere]">
          {part.detail}
        </pre>
      )}
      <div className="flex flex-wrap gap-2">
        <Bouton variant="sombre" taille="compact" onClick={() => onRepondre?.("oui")}>
          Autoriser
        </Bouton>
        <Bouton variant="blanc" taille="compact" onClick={() => onRepondre?.("toujours")}>
          Toujours, dans ce projet
        </Bouton>
        <Bouton variant="blanc" taille="compact" onClick={() => onRepondre?.("non")}>
          Refuser
        </Bouton>
      </div>
    </div>
  );
}

/* ─── Passation à un collègue ──────────────────────────────────── */

/** « Confié à Iris · Concevoir la hero », centré dans le fil, sans bulle. */
export function PassationView({
  roleId,
  consigne,
  statut,
  etapes,
}: {
  roleId: string;
  consigne: string;
  statut: "en-cours" | "fait" | "erreur";
  etapes: number;
}) {
  const role = useRole(roleId);
  const libelle = statut === "en-cours" ? "Confié à" : statut === "fait" ? "Rendu par" : "Arrêté chez";
  return (
    <div className="flex min-h-6 max-w-[680px] flex-wrap items-center justify-center gap-x-1.5 gap-y-1 self-center px-4 text-center text-ui-xs text-texte-tertiaire">
      <span className={cn(statut === "en-cours" && "klyra-respire")}>{libelle}</span>
      <Link
        href={`/chat?id=${idDirect(roleId)}`}
        className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-bordure-subtile bg-fond-surface pr-2.5 pl-px font-medium text-texte-principal no-underline transition-colors duration-[120ms] hover:border-bordure-forte"
      >
        <AgentRond roleId={roleId} taille={20} />
        {role.name}
      </Link>
      {consigne && <span className="truncate">· {consigne}</span>}
      {etapes > 0 && <span>· {etapes} étape{etapes > 1 ? "s" : ""}</span>}
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
  enCours = false,
  etapesDe = () => 0,
  nomAgent = "L’agent",
  onAutorisation,
}: {
  part: MessagePart;
  tone: "user" | "role";
  onAction: (label: string) => void;
  /** La réponse est en train de s'écrire. */
  enCours?: boolean;
  /** Nombre d'étapes faites par le collègue d'une passation. */
  etapesDe?: (etapeId: string) => number;
  /** Le prénom de l'agent, pour ses demandes d'autorisation. */
  nomAgent?: string;
  onAutorisation?: (demandeId: string, decision: "oui" | "toujours" | "non") => void;
}) {
  switch (part.type) {
    case "text":
      return part.text.trim() ? <TextBubble text={part.text} tone={tone} /> : null;
    case "fichiers":
      return <FichiersJoints chemins={part.chemins} />;
    case "autorisation":
      return <CarteAutorisation part={part} nomAgent={nomAgent} onRepondre={(d) => onAutorisation?.(part.id, d)} />;
    case "etapes":
      return <EtapesView etapes={part.etapes} enCours={enCours} />;
    case "passation":
      return <PassationView roleId={part.roleId} consigne={part.consigne} statut={part.statut} etapes={etapesDe(part.etapeId)} />;
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
