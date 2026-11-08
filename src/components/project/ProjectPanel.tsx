"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { LigneConversation, SectionBarre } from "@/components/shell/LignesBarre";
import { MenuConversationBarre, ModaleRenommer } from "@/components/shell/MenuConversationBarre";
import { useSupprimerConversation } from "@/components/shell/useSupprimerConversation";
import { BoutonIcone } from "@/components/ui/Bouton";
import { ElementContextuel, MenuContextuel, SeparateurContextuel, useMenuContextuel } from "@/components/ui/MenuContextuel";
import { cn } from "@/lib/cn";
import { useArbreProjet } from "@/lib/arbre-projet";
import { emplacementProjet } from "@/lib/depot-projet";
import { nomLieu, useServeursRelies } from "@/lib/lieux";
import { useModifiedFiles, useProjects, useRecentChats } from "@/lib/workspace";
import type { Chat, Project } from "@/types/domain";
import { DepotProjet } from "./DepotProjet";
import { FileTree } from "./FileTree";
import { useMenuProjet } from "./MenuProjet";
import { ouvrirFichier } from "./Visionneuse";

/**
 * Panneau blanc du projet, à côté du rail, comme celui des chats : le projet (son nom ouvre la liste des
 * autres projets), sa branche, ses conversations, puis tout le contenu de son dossier.
 */
export function ProjectPanel({ project, onClose }: { project: Project; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const currentId = useSearchParams().get("id");
  const projects = useProjects();
  const conversations = useRecentChats().filter((c) => c.projectId === project.id);
  const modified = useModifiedFiles(project.id);
  const arbre = useArbreProjet(project);
  const serveurs = useServeursRelies();
  const { ouvrirMenu, menuProjet } = useMenuProjet();
  const menuProjets = useMenuContextuel<null>();
  const menuConversation = useMenuContextuel<Chat>();
  const [renommage, setRenommage] = useState<Chat | null>(null);
  const [supprimerConversation, fenetreSuppression] = useSupprimerConversation();
  const nouvelle = () => router.push(`/projet?id=${encodeURIComponent(project.id)}&nouvelle=1`);

  return (
    <aside
      aria-label={`Projet ${project.name}`}
      data-panneau-projet
      className="my-2 ml-2 flex w-[272px] shrink-0 flex-col overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-ambiante"
    >
      {/* Le projet : son nom ouvre la liste des projets ; clic droit, ses réglages. */}
      <div className="flex flex-col gap-0.5 border-b border-bordure-subtile p-2 in-data-[shell=desktop]:pt-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={!!menuProjets.menu}
            aria-label={`Projet ${project.name} : changer de projet`}
            onClick={(e) => menuProjets.ouvrir(e, null)}
            onContextMenu={(e) => ouvrirMenu(e, project)}
            className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 text-left transition-colors duration-[120ms] ease-sortie hover:bg-fond-survol"
          >
            <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-[1px]", project.pinned ? "bg-bleu-k1-500" : "border-[1.25px] border-current text-icone-secondaire")} />
            <span className="truncate text-ui font-semibold text-texte-principal">{project.name}</span>
            <Icon name="chevron-down" size={14} className="shrink-0 text-icone-secondaire" />
          </button>
          <BoutonIcone
            taille="mini"
            icone={<Icon name="chevron-left" size={16} />}
            libelle="Replier le panneau"
            data-son="fermer"
            onClick={onClose}
            className="text-icone-secondaire"
          />
        </div>
        <DepotProjet key={`barre-${project.id}`} project={project} compact />
      </div>

      {/* Les conversations du projet : chacune avec son agent, comme dans les chats. */}
      <div data-liste-conversations className="flex max-h-[45%] min-h-0 shrink-0 flex-col overflow-y-auto px-2 pt-2 pb-2">
        <SectionBarre
          titre="Conversations"
          nombre={conversations.length}
          action={
            <BoutonIcone
              taille="mini"
              icone={<Icon name="plus-01" size={16} />}
              libelle="Nouvelle conversation"
              actif={pathname === "/projet"}
              onClick={nouvelle}
              className="text-icone-secondaire"
            />
          }
        >
          {conversations.length ? (
            conversations.map((chat) => (
              <LigneConversation key={chat.id} chat={chat} active={pathname === "/chat" && currentId === chat.id} onMenu={(e) => menuConversation.ouvrir(e, chat)} />
            ))
          ) : (
            <p className="m-0 px-2 py-1 text-ui-xs text-texte-tertiaire">Pas encore de conversation : écris la première à droite.</p>
          )}
        </SectionBarre>
      </div>

      {/* Fichiers du projet */}
      <div className="flex items-center gap-1 border-t border-bordure-subtile pt-3 pr-2 pb-1 pl-4">
        <span className="flex-1 text-ui font-semibold text-texte-principal">Fichiers</span>
      </div>
      <p title={project.folder} className="m-0 px-4 pb-2 text-ui-2xs leading-[1.4] text-texte-tertiaire">
        <span className={cn(!project.lieu && "klyra-mono", "[overflow-wrap:anywhere]")}>{emplacementProjet(project.folder, project.lieu, nomLieu(project.lieu, serveurs))}</span>
        <br />
        Clic sur un fichier pour le voir
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {arbre.erreur ? (
          <p role="alert" className="m-0 px-2 py-2 text-ui-xs text-texte-erreur">
            Dossier illisible : {arbre.erreur}
          </p>
        ) : (
          <FileTree
            key={project.id}
            nodes={arbre.noeuds}
            contenu={arbre.contenu}
            charger={arbre.charger}
            modified={modified}
            onOuvrir={(chemin) => ouvrirFichier({ projectId: project.id, chemin })}
          />
        )}
      </div>

      {menuProjets.menu && (
        <MenuContextuel x={menuProjets.menu.x} y={menuProjets.menu.y} libelle="Changer de projet" onFermer={menuProjets.fermer}>
          {projects.map((p) => (
            <ElementContextuel key={p.id} icone={p.id === project.id ? "check-01" : "folder"} onChoisir={() => router.push(`/projet?id=${encodeURIComponent(p.id)}`)}>
              {p.name}
            </ElementContextuel>
          ))}
          <SeparateurContextuel />
          <ElementContextuel icone="projets-dossier" onChoisir={() => router.push("/projets")}>
            Tous les projets
          </ElementContextuel>
          <ElementContextuel icone="plus-01" onChoisir={() => router.push("/projets?nouveau=1")}>
            Nouveau projet
          </ElementContextuel>
        </MenuContextuel>
      )}
      {menuConversation.menu && (
        <MenuConversationBarre
          key={menuConversation.menu.cible.id + menuConversation.menu.x + menuConversation.menu.y}
          chat={menuConversation.menu.cible}
          x={menuConversation.menu.x}
          y={menuConversation.menu.y}
          onFermer={menuConversation.fermer}
          onRenommer={setRenommage}
          onSupprimer={(chat) => void supprimerConversation(chat)}
        />
      )}
      {renommage && <ModaleRenommer chat={renommage} onFermer={() => setRenommage(null)} />}
      {fenetreSuppression}
      {menuProjet}
    </aside>
  );
}
