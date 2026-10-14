"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PromptBox } from "@/components/chat/PromptBox";
import { Icon, type IconName } from "@/components/icons/Icon";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
import { Onglets } from "@/components/ui/Onglets";
import { PuceSelect, type PuceOption } from "@/components/ui/PuceSelect";
import { cn } from "@/lib/cn";
import { formatListDate } from "@/lib/format";
import { findMention } from "@/lib/mentions";
import { useChatPreview, useProjects, useRecentChats, useRoles, useWorkspace } from "@/lib/workspace";
import type { Chat, ProjectStatus, RoleId } from "@/types/domain";

/* ─── Suggestions par rôle ─────────────────────────────────────── */

type SuggestionTab = "suggeres" | "dev" | "designer" | "redacteur" | "commercial";

interface Suggestion {
  icon: IconName;
  text: string;
  /** Agent à qui l'envoyer ; absent : le Principal répartit. */
  roleId?: RoleId;
}

const SUGGESTIONS: Record<SuggestionTab, Suggestion[]> = {
  suggeres: [
    { icon: "list", text: "Fais le point sur l’avancement de chaque projet" },
    { icon: "check-01", text: "Prépare les tâches de la semaine pour toute l’équipe" },
    { icon: "message-square", text: "Résume les décisions prises dans le chat Hero de la home" },
  ],
  dev: [
    { icon: "code-01", text: "Intègre la nouvelle hero de la home Bizwhoo", roleId: "dev" },
    { icon: "iphone-02", text: "Corrige le formulaire de contact sur téléphone", roleId: "dev" },
    { icon: "file-code", text: "Branche le formulaire du diagnostic sur la base de données", roleId: "dev" },
  ],
  designer: [
    { icon: "layout-left", text: "Fais la spec de la page offres, avec ses cinq états", roleId: "designer" },
    { icon: "users-profiles-01", text: "Revois le parcours du diagnostic en 5 étapes", roleId: "designer" },
    { icon: "computer", text: "Vérifie la page contact en 375, 768 et 1280 px", roleId: "designer" },
  ],
  redacteur: [
    { icon: "message-square", text: "Propose trois accroches pour le post LinkedIn de la semaine", roleId: "redacteur" },
    { icon: "globe-01", text: "Réécris la hero de klyra.fr, plus courte", roleId: "redacteur" },
    { icon: "list", text: "Écris la newsletter d’octobre à partir du brief de Mathilde", roleId: "redacteur" },
  ],
  commercial: [
    { icon: "file-code", text: "Prépare la propale Bizwhoo avec deux options chiffrées", roleId: "commercial" },
    { icon: "users-profiles-plus", text: "Fais le point sur les prospects qui dorment", roleId: "commercial" },
    { icon: "refresh-01", text: "Écris la relance du devis envoyé la semaine dernière", roleId: "commercial" },
  ],
};

/* Les prénoms suffisent : sans icône, les cinq onglets tiennent dans un demi-écran. */
const TABS: { id: SuggestionTab; label: string }[] = [
  { id: "suggeres", label: "Suggérés" },
  { id: "dev", label: "Hugo" },
  { id: "designer", label: "Iris" },
  { id: "redacteur", label: "Olivier" },
  { id: "commercial", label: "Thomas" },
];

/* ─── Statut des projets ───────────────────────────────────────── */

/* Tags du design system : bleu (k-tag), orange (k-tag--orange), gris. */
const STATUS: Record<ProjectStatus, { label: string; className: string }> = {
  "en-cours": { label: "En cours", className: "bg-fond-teinte-bleue text-texte-accent" },
  "en-revue": { label: "En revue", className: "bg-fond-tag-orange text-texte-accent-orange" },
  livre: { label: "Livré", className: "bg-fond-surface-grise text-texte-secondaire" },
};

const AUTO = "auto";

const REPRENDRE: { id: "chats" | "projets"; label: string; icone: ReactNode }[] = [
  { id: "chats", label: "Chats récents", icone: <Icon name="message-square" size={16} /> },
  { id: "projets", label: "Projets", icone: <Icon name="folder" size={16} /> },
];

/** Ligne des listes de l'accueil : même hauteur pour les suggestions, chats et projets. */
const LIGNE = cn(
  "flex items-center gap-3 rounded-sm border border-transparent px-3 py-2 no-underline",
  "transition-[background-color,border-color,box-shadow] duration-[220ms] ease-sortie",
  "hover:border-bordure-subtile hover:bg-fond-surface hover:shadow-ombre-xs",
);

function RecentChatRow({ chat, projectName }: { chat: Chat; projectName: string | undefined }) {
  const preview = useChatPreview(chat.id);
  return (
    <Link href={`/chat?id=${chat.id}`} className={LIGNE}>
      <RoleAvatar roleId={preview.roleId} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui-s font-medium text-texte-principal">{chat.title}</span>
        <span className="truncate text-ui-xs text-texte-tertiaire">
          {projectName ? `${projectName} · ` : ""}
          {preview.text}
        </span>
      </span>
      <span className="klyra-mono shrink-0 text-ui-3xs text-texte-tertiaire">{formatListDate(chat.updatedAt)}</span>
    </Link>
  );
}

/** Accueil de l'IA : on écrit au Principal, ou on part d'une suggestion. */
export function HomeScreen() {
  const router = useRouter();
  const { state, startChat } = useWorkspace();
  const roles = useRoles();
  const projects = useProjects();
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  // « Écrire à Hugo » depuis l'équipe arrive ici avec ?a=dev.
  const preselected = useSearchParams().get("a");
  const [to, setTo] = useState<RoleId | typeof AUTO>(
    roles.find((r) => r.id === preselected && r.id !== "principal")?.id ?? AUTO,
  );
  const [tab, setTab] = useState<SuggestionTab>("suggeres");
  const [reprendre, setReprendre] = useState<"chats" | "projets">("chats");
  const recentChats = useRecentChats(4);

  const submit = () => {
    const recipient = to === AUTO ? findMention(text, roles) : to;
    const chatId = startChat(projectId, text.trim(), recipient);
    router.push(`/chat?id=${chatId}`);
  };

  /* Une suggestion remplit le composeur ; on relit et on envoie. */
  const pick = (suggestion: Suggestion) => {
    setText(suggestion.text);
    setTo(suggestion.roleId ?? AUTO);
    promptRef.current?.focus();
  };

  const recipientOptions: PuceOption<RoleId | typeof AUTO>[] = [
    { value: AUTO, label: "Principal" },
    ...roles.filter((r) => r.id !== "principal").map((r) => ({ value: r.id, label: `${r.name} · ${r.tag}` })),
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container mx-auto flex max-w-[960px] flex-col gap-5 px-8 pt-[clamp(20px,7vh,72px)] pb-8">
        <header className="flex flex-col gap-3 px-1">
          {/* Titre KLYRA : une partie en semi-gras, l'autre en regular, même couleur. */}
          <h1 className="m-0 text-h2 leading-[0.925] tracking-[-0.05em] text-texte-principal">
            <span className="font-semibold">Bonjour {state.currentUser.name},</span>
            <br />
            <span className="font-normal">on avance sur quoi aujourd’hui ?</span>
          </h1>
          {/* Masquée sur un écran bas : l’accueil tient sans défiler. */}
          <p className="m-0 text-body-s text-texte-secondaire [@media(max-height:760px)]:hidden">
            Écris au Principal : il répartit le travail entre les {roles.length - 1} agents de l’équipe.
          </p>
        </header>

        <PromptBox
          ref={promptRef}
          taille="grand"
          value={text}
          onChange={setText}
          onSubmit={submit}
          placeholder="Décris ce que tu veux faire, ou @mentionne un rôle…"
          puces={
            <>
              <PuceSelect
                libelle="Projet"
                icone={<Icon name="folder" size={16} />}
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                value={projectId}
                onChange={setProjectId}
              />
              <PuceSelect
                libelle="Destinataire"
                icone={<Icon name="users-profiles-01" size={16} />}
                options={recipientOptions}
                value={to}
                onChange={setTo}
              />
            </>
          }
        />

        {/* Sous le composeur, deux blocs côte à côte : tout tient sans faire défiler. */}
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          {/* Suggestions, rangées par agent. */}
          <section aria-label="Suggestions" className="flex flex-col gap-1 rounded-xl border border-bordure-subtile bg-fond-page p-2">
            <Onglets libelle="Suggestions par agent" onglets={TABS} valeur={tab} onChange={setTab} className="self-start" />
            <ul className="m-0 mt-1 flex list-none flex-col p-0">
              {SUGGESTIONS[tab].map((suggestion) => (
                <li key={suggestion.text}>
                  <button
                    type="button"
                    onClick={() => pick(suggestion)}
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-3 rounded-sm border border-transparent bg-transparent px-3 py-2.5 text-left",
                      "transition-[background-color,border-color,box-shadow] duration-[220ms] ease-sortie",
                      "hover:border-bordure-subtile hover:bg-fond-surface hover:shadow-ombre-xs",
                    )}
                  >
                    <Icon name={suggestion.icon} size={16} className="text-icone-secondaire group-hover:text-icone-accent" />
                    <span className="flex-1 text-ui-s text-texte-secondaire group-hover:text-texte-principal">{suggestion.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Reprendre : là où on s'est arrêté, chats ou projets. */}
          <section aria-label="Reprendre" className="flex flex-col gap-1 rounded-xl border border-bordure-subtile bg-fond-page p-2">
            <div className="flex items-center justify-between">
              <Onglets libelle="Reprendre" onglets={REPRENDRE} valeur={reprendre} onChange={setReprendre} />
              <Link
                href={reprendre === "chats" ? "/chats" : "/projets"}
                className="pr-2 text-ui-xs text-texte-tertiaire no-underline hover:text-texte-accent"
              >
                Tout voir
              </Link>
            </div>
            <ul className="m-0 mt-1 flex list-none flex-col p-0">
              {reprendre === "chats"
                ? recentChats.map((chat) => (
                    <li key={chat.id}>
                      <RecentChatRow chat={chat} projectName={projects.find((p) => p.id === chat.projectId)?.name} />
                    </li>
                  ))
                : projects.slice(0, 4).map((project) => {
                    const status = STATUS[project.status];
                    return (
                      <li key={project.id}>
                        <Link href={`/projet?id=${project.id}`} className={LIGNE}>
                          <span
                            aria-hidden="true"
                            className={cn("size-2 shrink-0 rounded-[1px]", project.pinned ? "bg-bleu-k1-500" : "border-[1.25px] border-gris-k1-300")}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-ui-s font-medium text-texte-principal">{project.name}</span>
                            <span className="truncate text-ui-xs text-texte-tertiaire">{project.subtitle}</span>
                          </span>
                          <span className={cn("shrink-0 rounded-pill px-2 py-0.5 text-ui-3xs font-medium", status.className)}>
                            {status.label}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
