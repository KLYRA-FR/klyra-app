"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { LigneAgent, LigneConversation, SectionBarre } from "@/components/shell/LignesBarre";
import { BoutonIcone } from "@/components/ui/Bouton";
import { idDirect, useChat, useProjects, useRecentChats, useRoles } from "@/lib/workspace";

/**
 * Panneau blanc des conversations, à côté du rail (comme celui d'un projet) :
 * l'équipe, une ligne par agent avec ce qu'il fait, puis les conversations
 * d'équipe. L'utilisation de Claude est dans le rail.
 */
export function PanneauConversations({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const currentId = useSearchParams().get("id");
  const roles = useRoles();
  const projects = useProjects();
  const conversations = useRecentChats();
  /* Dans un fil, la ligne de son agent reste active. */
  const agentDuFil = useChat(currentId)?.fil?.roleId;

  return (
    <aside
      aria-label="Conversations"
      className="my-2 ml-2 flex w-[296px] shrink-0 flex-col overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-ambiante"
    >
      <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-4 in-data-[shell=desktop]:mt-1">
        <span className="flex-1 text-ui font-semibold text-texte-principal">Chats</span>
        <BoutonIcone
          taille="mini"
          icone={<Icon name="plus-01" size={16} />}
          libelle="Nouveau chat"
          onClick={() => router.push("/")}
          className="text-icone-secondaire"
        />
        <BoutonIcone
          taille="mini"
          icone={<Icon name="chevron-left" size={16} />}
          libelle="Replier le panneau"
          data-son="fermer"
          onClick={onClose}
          className="text-icone-secondaire"
        />
      </div>

      {/* Fondu en haut et en bas de la liste qui défile. */}
      <nav
        aria-label="Agents et conversations"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3 [mask-image:linear-gradient(to_bottom,transparent,black_8px,black_calc(100%-16px),transparent)] [scrollbar-width:none]"
      >
        <SectionBarre
          titre="Équipe"
          href="/equipe"
          nombre={roles.length - 1}
          action={
            <BoutonIcone
              taille="mini"
              icone={<Icon name="plus-01" size={16} />}
              libelle="Nouvel agent"
              className="text-icone-secondaire"
              onClick={() => router.push("/equipe?nouveau=1")}
            />
          }
        >
          {roles.map((role) => (
            <LigneAgent key={role.id} role={role} active={currentId === idDirect(role.id) || agentDuFil === role.id} />
          ))}
        </SectionBarre>

        {conversations.length > 0 && (
          <SectionBarre titre="Conversations d’équipe" nombre={conversations.length}>
            {conversations.map((chat) => (
              <LigneConversation
                key={chat.id}
                chat={chat}
                active={currentId === chat.id}
                projet={projects.find((p) => p.id === chat.projectId)?.name}
              />
            ))}
          </SectionBarre>
        )}
      </nav>
    </aside>
  );
}
