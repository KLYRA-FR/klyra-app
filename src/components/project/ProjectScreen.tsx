"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Avatar, EmptyState } from "klyra-ui";
import { PromptBox } from "@/components/chat/PromptBox";
import { Icon } from "@/components/icons/Icon";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
import { Bouton } from "@/components/ui/Bouton";
import { PuceSelect, type PuceOption } from "@/components/ui/PuceSelect";
import { cn } from "@/lib/cn";
import { formatListDate } from "@/lib/format";
import { findMention } from "@/lib/mentions";
import { poste } from "@/lib/plateforme";
import { useChatPreview, useProject, useRecentChats, useRoles, useWorkspace } from "@/lib/workspace";
import type { Chat, ProjectStatus, RoleId } from "@/types/domain";

const STATUS: Record<ProjectStatus, { label: string; className: string }> = {
  "en-cours": { label: "En cours", className: "bg-fond-teinte-bleue text-texte-accent" },
  "en-revue": { label: "En revue", className: "bg-fond-tag-orange text-texte-accent-orange" },
  livre: { label: "Livré", className: "bg-fond-surface-grise text-texte-secondaire" },
};

const AUTO = "auto";

function ChatRow({ chat }: { chat: Chat }) {
  const preview = useChatPreview(chat.id);
  return (
    <Link
      href={`/chat?id=${chat.id}`}
      className="group flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 no-underline transition-[background-color,border-color,box-shadow] duration-[220ms] ease-sortie hover:border-bordure-subtile hover:bg-fond-surface hover:shadow-ombre-xs"
    >
      <RoleAvatar roleId={preview.roleId} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-ui font-medium text-texte-principal">{chat.title}</span>
        <span className="truncate text-ui-s text-texte-tertiaire">{preview.text}</span>
      </div>
      <span className="klyra-mono shrink-0 text-ui-2xs text-texte-tertiaire">{formatListDate(chat.updatedAt)}</span>
    </Link>
  );
}

/** Page d'un projet : son brief, un nouveau chat, et les chats en cours. */
export function ProjectScreen() {
  const router = useRouter();
  const project = useProject(useSearchParams().get("id"));
  const roles = useRoles();
  const { startChat, retirerProjet } = useWorkspace();
  const [retirer, setRetirer] = useState(false);
  const chats = useRecentChats().filter((c) => c.projectId === project?.id);
  const [text, setText] = useState("");
  const [to, setTo] = useState<RoleId | typeof AUTO>(AUTO);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <EmptyState title="Ce projet n’existe pas" description="Choisis un projet dans le menu." />
      </div>
    );
  }

  const status = STATUS[project.status];
  const submit = () => {
    const recipient = to === AUTO ? findMention(text, roles) : to;
    router.push(`/chat?id=${startChat(project.id, text.trim(), recipient)}`);
  };
  const recipientOptions: PuceOption<RoleId | typeof AUTO>[] = [
    { value: AUTO, label: "Principal", icone: <RoleAvatar roleId="principal" size="xs" /> },
    ...roles
      .filter((r) => r.id !== "principal")
      .map((r) => ({ value: r.id, label: `${r.name} · ${r.tag}`, icone: <RoleAvatar roleId={r.id} size="xs" /> })),
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-8 pt-12 pb-12">
        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn("rounded-pill px-2.5 py-0.5 text-ui-2xs font-medium", status.className)}>{status.label}</span>
            {project.previewUrl && <span className="klyra-mono text-ui-xs text-texte-tertiaire">{project.previewUrl}</span>}
            <span className="ml-auto flex gap-1">
              <Bouton
                variant="discret"
                taille="compact"
                iconeGauche={<Icon name="file-code" size={16} />}
                onClick={() => router.push(`/projets?modifier=${project.id}`)}
              >
                Modifier
              </Bouton>
              <Bouton variant="discret" taille="compact" iconeGauche={<Icon name="trash-01" size={16} />} onClick={() => setRetirer(true)}>
                Retirer
              </Bouton>
            </span>
          </div>
          {retirer && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-bordure-subtile bg-fond-page p-3">
              <span className="flex-1 text-ui-s text-texte-principal">
                Retirer {project.name} de l’app ? Son dossier reste sur {poste.ton}, rien n’est effacé.
              </span>
              <Bouton
                variant="sombre"
                taille="compact"
                onClick={() => {
                  retirerProjet(project.id);
                  router.push("/projets");
                }}
              >
                Retirer
              </Bouton>
              <Bouton variant="blanc" taille="compact" onClick={() => setRetirer(false)}>
                Annuler
              </Bouton>
            </div>
          )}
          {/* Titre KLYRA : semi-gras + regular, même couleur. */}
          <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
            <span className="font-semibold">{project.name}</span>{" "}
            {project.subtitle && <span className="font-normal">· {project.subtitle}</span>}
          </h1>
          {project.brief && <p className="m-0 text-body-s leading-[1.45] text-texte-secondaire">{project.brief}</p>}
          <span className="klyra-mono text-ui-xs text-texte-tertiaire [overflow-wrap:anywhere]">
            {project.folder.replace(/^\/Users\/[^/]+/, "~")}
          </span>
          <div className="flex items-center gap-3">
            <Avatar.Group size="sm" aria-label="Agents du projet">
              {project.roleIds.map((roleId) => (
                <RoleAvatar key={roleId} roleId={roleId} size="sm" className="ring-2 ring-fond-surface" />
              ))}
            </Avatar.Group>
            <span className="text-ui-s text-texte-tertiaire">
              {project.roleIds
                .map((id) => roles.find((r) => r.id === id)?.name)
                .filter(Boolean)
                .join(", ")}
            </span>
          </div>
        </header>

        <PromptBox
          value={text}
          onChange={setText}
          onSubmit={submit}
          placeholder={`Nouveau chat dans ${project.name}…`}
          puces={
            <PuceSelect
              libelle="Destinataire"
              icone={<Icon name="users-profiles-01" size={16} />}
              options={recipientOptions}
              value={to}
              onChange={setTo}
            />
          }
        />

        <section aria-labelledby="chats-titre" className="flex flex-col gap-2">
          <h2 id="chats-titre" className="m-0 px-1 text-ui font-semibold text-texte-principal">
            Chats du projet
          </h2>
          {chats.length > 0 ? (
            <div className="flex flex-col rounded-xl border border-bordure-subtile bg-fond-page p-1.5">
              {chats.map((chat) => (
                <ChatRow key={chat.id} chat={chat} />
              ))}
            </div>
          ) : (
            <p className="m-0 px-1 text-ui text-texte-tertiaire">Pas encore de chat : écris le premier au-dessus.</p>
          )}
        </section>
      </div>
    </div>
  );
}
