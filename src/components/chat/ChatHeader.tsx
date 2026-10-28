"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { ChoixModele } from "./ChoixModele";
import { useAgentOccupe, useRole, useTravail } from "@/lib/workspace";
import type { Chat, Project } from "@/types/domain";

interface ChatHeaderProps {
  chat: Chat;
  project: Project | undefined;
  previewOpen: boolean;
  onTogglePreview: () => void;
}

/** En-tête d'une conversation directe : l'agent, ce qu'il fait, sa fiche. */
function EnTeteDirect({ chat, panneauOuvert, onTogglePanneau }: { chat: Chat; panneauOuvert: boolean; onTogglePanneau: () => void }) {
  const router = useRouter();
  const role = useRole(chat.roleIds[0] ?? "principal");
  const ici = useTravail(chat.id);
  const occupe = useAgentOccupe(role.id);
  const etat = ici ? "Travaille…" : occupe ? "Travaille dans une conversation d’équipe" : role.title;
  return (
    <header className="@container flex items-center gap-3 border-b border-bordure-subtile px-5 py-3">
      <AgentRond roleId={role.id} taille={32} statut={occupe ? { type: "travaille" } : null} fondPastille="surface" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="m-0 flex items-baseline gap-2 truncate text-ui font-semibold text-texte-principal">
          {role.name}
          <span className="text-ui-2xs font-normal text-texte-tertiaire">{role.tag}</span>
        </h1>
        <span className={occupe ? "klyra-respire truncate text-ui-xs text-texte-secondaire" : "truncate text-ui-xs text-texte-tertiaire"}>
          {etat}
        </span>
      </div>
      <ChoixModele chat={chat} />
      {/* Sa fiche complète (rôle, compétences, historique) : l'équipe n'est plus dans le menu. */}
      {role.id !== "principal" && (
        <>
          <Bouton
            variant="blanc"
            taille="compact"
            onClick={() => router.push(`/equipe?agent=${role.id}`)}
            iconeGauche={<Icon name="user-profile-01" size={16} />}
            className="hidden @2xl:inline-flex"
          >
            Profil
          </Bouton>
          <BoutonIcone
            taille="compact"
            icone={<Icon name="user-profile-01" size={16} />}
            libelle={`Profil de ${role.name}`}
            onClick={() => router.push(`/equipe?agent=${role.id}`)}
            className="@2xl:hidden"
          />
        </>
      )}
      {/* Le point : l'agent a des tâches en cours, visibles dans le panneau. */}
      <span className="relative">
        <BoutonIcone
          taille="compact"
          actif={panneauOuvert}
          icone={<Icon name="layout-right" size={16} />}
          libelle={panneauOuvert ? "Fermer le panneau" : "Ouvrir le panneau (réglages, fichiers, tâches)"}
          aria-pressed={panneauOuvert}
          onClick={onTogglePanneau}
        />
        {!panneauOuvert && chat.taches?.some((t) => t.statut === "en-cours") && (
          <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-bleu-k1-500" />
        )}
      </span>
    </header>
  );
}

export function ChatHeader({ chat, project, previewOpen, onTogglePreview }: ChatHeaderProps) {
  if (chat.kind === "direct") {
    return <EnTeteDirect chat={chat} panneauOuvert={previewOpen} onTogglePanneau={onTogglePreview} />;
  }

  const roleCount = chat.roleIds.length;
  return (
    <header className="@container flex items-center gap-3 border-b border-bordure-subtile px-5 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="m-0 truncate text-ui font-semibold">{chat.title}</h1>
        <span className="truncate text-ui-xs text-texte-tertiaire">
          {project?.name} · {roleCount} {roleCount > 1 ? "agents" : "agent"} dans la conversation
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Les visages de la conversation, qui se chevauchent. */}
        <div aria-label="Agents de la conversation" className="mr-1 hidden -space-x-2 @xl:flex">
          {chat.roleIds.map((roleId) => (
            <AgentRond key={roleId} roleId={roleId} taille={26} className="rounded-sm ring-2 ring-fond-surface" />
          ))}
        </div>
        <BoutonIcone
          taille="compact"
          actif={previewOpen}
          icone={<Icon name="layout-right" size={16} />}
          libelle={previewOpen ? "Masquer l’aperçu" : "Afficher l’aperçu"}
          aria-pressed={previewOpen}
          onClick={onTogglePreview}
        />
        <BoutonIcone taille="compact" icone={<Icon name="dot-horizontal" size={16} />} libelle="Plus d’options" />
      </div>
    </header>
  );
}
