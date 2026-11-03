"use client";

import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { LigneAgent, LigneConversation, SectionBarre } from "@/components/shell/LignesBarre";
import { MenuAgent } from "@/components/shell/MenuAgent";
import { MenuConversationBarre, ModaleRenommer } from "@/components/shell/MenuConversationBarre";
import { MenuCreationAgent } from "@/components/team/MenuCreationAgent";
import { useDesactiverAgent } from "@/components/team/useDesactiverAgent";
import { BoutonIcone } from "@/components/ui/Bouton";
import { useMenuContextuel } from "@/components/ui/MenuContextuel";
import { useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { cn } from "@/lib/cn";
import { decaler, deplacer, trierParRang } from "@/lib/rang-agents";
import { useChat, useIdDirect, useProjects, useRecentChats, useRoles } from "@/lib/workspace";
import type { Chat, Role } from "@/types/domain";

/**
 * Panneau blanc des conversations, à côté du rail (comme celui d'un projet) :
 * Mes agents, une ligne par agent avec ce qu'il fait, puis les conversations
 * d'équipe. L'utilisation de Claude est dans le rail. Le clic droit sur une ligne
 * ouvre son menu ; les agents épinglés passent juste après l'assistant, les masqués
 * se rangent sous « N masqués » (ils restent actifs et appelables).
 */
export function PanneauConversations({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const currentId = useSearchParams().get("id");
  const roles = useRoles();
  const projects = useProjects();
  const conversations = useRecentChats();
  const idDirect = useIdDirect();
  /* Dans un fil, la ligne de son agent reste active. */
  const agentDuFil = useChat(currentId)?.fil?.roleId;
  const { meta, ranger } = useAgents();
  const menuAgent = useMenuContextuel<Role>();
  const menuConversation = useMenuContextuel<Chat>();
  const [desactiver, fenetreDesactiver] = useDesactiverAgent();
  const [renommage, setRenommage] = useState<Chat | null>(null);
  const [voirMasques, setVoirMasques] = useState(false);

  const estActif = (role: Role) => currentId === idDirect(role.id) || agentDuFil === role.id;
  const [assistant, ...autres] = roles;
  const epingleLe = (role: Role) => meta[role.id]?.epingleLe ?? "";
  const rang = (id: string) => meta[id]?.rang;
  /* Les épinglés en haut ; dans chaque groupe, l'ordre choisi en glissant (cf. rang-agents.ts). */
  const epingles = trierParRang(
    autres.filter((r) => epingleLe(r) && !meta[r.id]?.masque).sort((a, b) => epingleLe(b).localeCompare(epingleLe(a))),
    rang,
  );
  const masques = autres.filter((r) => meta[r.id]?.masque);
  /* Un agent masqué dont la conversation est ouverte reste à sa place le temps qu'on y est. */
  const suivants = trierParRang(
    autres.filter((r) => !epingleLe(r) && (!meta[r.id]?.masque || estActif(r))),
    rang,
  );
  const visibles = [assistant, ...epingles, ...suivants];
  const groupeDe = (id: string) => (epingles.some((r) => r.id === id) ? epingles : suivants.some((r) => r.id === id) ? suivants : null);

  /* Glisser un agent dans son groupe (épinglés ou non) ; l'assistant reste en tête. */
  const [glisse, setGlisse] = useState<string | null>(null);
  const [cible, setCible] = useState<{ id: string; apres: boolean } | null>(null);
  const ecrireOrdre = (ordre: string[]) =>
    void ranger(ordre).catch((e: unknown) => annoncer(e instanceof Error ? e.message : String(e)));
  const poser = () => {
    const groupe = glisse ? groupeDe(glisse) : null;
    if (glisse && cible && groupe?.some((r) => r.id === cible.id)) {
      const avant = groupe.map((r) => r.id);
      const apres = deplacer(avant, glisse, cible.id, cible.apres);
      if (apres.join() !== avant.join()) ecrireOrdre(apres);
    }
    setGlisse(null);
    setCible(null);
  };
  /* Au clavier : Alt + flèche haut ou bas déplace l'agent d'une place dans son groupe. */
  const auClavier = (role: Role) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const groupe = groupeDe(role.id);
    if (!groupe) return;
    e.preventDefault();
    const avant = groupe.map((r) => r.id);
    const apres = decaler(avant, role.id, e.key === "ArrowUp" ? -1 : 1);
    if (apres.join() === avant.join()) return;
    ecrireOrdre(apres);
    annoncer(`${role.name} : place ${apres.indexOf(role.id) + 1} sur ${apres.length}.`);
  };
  const deplacable = (role: Role, ligne: ReactNode) => {
    if (!groupeDe(role.id) || groupeDe(role.id)!.length < 2) return ligne;
    const memeGroupe = !!glisse && groupeDe(glisse) === groupeDe(role.id);
    return (
      <div
        key={role.id}
        draggable
        data-agent-barre={role.id}
        aria-roledescription="agent déplaçable"
        onKeyDown={auClavier(role)}
        onDragStart={(e: DragEvent<HTMLDivElement>) => {
          // Sans l'adresse du lien : lâché ailleurs, il n'ouvre rien.
          e.dataTransfer.clearData();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("application/x-klyra-agent", role.id);
          setGlisse(role.id);
        }}
        onDragOver={(e) => {
          if (!memeGroupe) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const boite = e.currentTarget.getBoundingClientRect();
          const apres = e.clientY > boite.top + boite.height / 2;
          if (cible?.id !== role.id || cible.apres !== apres) setCible({ id: role.id, apres });
        }}
        onDrop={(e) => {
          e.preventDefault();
          poser();
        }}
        onDragEnd={() => {
          setGlisse(null);
          setCible(null);
        }}
        className={cn(
          "relative",
          glisse === role.id && "opacity-50",
          cible?.id === role.id && glisse !== role.id && "after:pointer-events-none after:absolute after:inset-x-2 after:h-0.5 after:rounded-full after:bg-fond-accent",
          cible?.id === role.id && (cible.apres ? "after:-bottom-px" : "after:-top-px"),
        )}
      >
        {ligne}
      </div>
    );
  };
  const masquesRanges = masques.filter((r) => !estActif(r));

  return (
    <aside
      aria-label="Conversations"
      className="my-2 ml-2 flex w-[296px] shrink-0 flex-col overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-ambiante"
    >
      <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-4 in-data-[shell=desktop]:mt-1">
        <span className="flex-1 text-ui font-semibold text-texte-principal">Chats</span>
        <BoutonIcone
          taille="mini"
          icone={<Icon name="message-plus-01" size={16} />}
          libelle="Nouvelle conversation"
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
        data-liste-conversations
        aria-label="Agents et conversations"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3 [mask-image:linear-gradient(to_bottom,transparent,black_8px,black_calc(100%-16px),transparent)] [scrollbar-width:none]"
      >
        {/* L'assistant, puis les agents actifs de Mes agents : les seuls qu'on peut appeler. */}
        <SectionBarre
          titre="Mes agents"
          href="/equipe"
          nombre={roles.length > 1 ? roles.length - 1 : undefined}
          action={
            <MenuCreationAgent
              alignement="droite"
              declencheur={({ ref, basculer, ouvert, attributs }) => (
                <BoutonIcone
                  ref={ref}
                  taille="mini"
                  actif={ouvert}
                  icone={<Icon name="plus-01" size={16} />}
                  libelle="Nouvel agent"
                  className="text-icone-secondaire"
                  onClick={basculer}
                  {...attributs}
                />
              )}
            />
          }
        >
          {visibles.map((role) =>
            deplacable(
              role,
              <LigneAgent
                key={role.id}
                role={role}
                active={estActif(role)}
                epingle={!!epingleLe(role)}
                masque={!!meta[role.id]?.masque}
                onMenu={(e) => menuAgent.ouvrir(e, role)}
              />,
            ),
          )}
          {masquesRanges.length > 0 && (
            <button
              type="button"
              aria-expanded={voirMasques}
              onClick={() => setVoirMasques((v) => !v)}
              className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 text-left text-ui-xs text-texte-tertiaire transition-colors duration-[120ms] hover:bg-fond-survol hover:text-texte-secondaire"
            >
              <Icon name="chevron-right" size={14} className={cn("ml-2.5 text-icone-secondaire transition-transform duration-[220ms] ease-sortie", voirMasques && "rotate-90")} />
              {masquesRanges.length > 1 ? `${masquesRanges.length} agents masqués` : "1 agent masqué"}
            </button>
          )}
          {voirMasques &&
            masquesRanges.map((role) => (
              <LigneAgent key={role.id} role={role} active={false} masque onMenu={(e) => menuAgent.ouvrir(e, role)} />
            ))}
          {roles.length === 1 && (
            <MenuCreationAgent
              declencheur={({ ref, basculer, attributs }) => (
                <button
                  ref={ref}
                  type="button"
                  onClick={basculer}
                  {...attributs}
                  className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 text-left text-ui-s text-texte-tertiaire transition-colors duration-[120ms] hover:bg-fond-survol hover:text-texte-secondaire"
                >
                  <Icon name="plus-01" size={16} className="ml-1.5 text-icone-secondaire" />
                  Créer un agent
                </button>
              )}
            />
          )}
        </SectionBarre>

        {conversations.length > 0 && (
          <SectionBarre titre="Conversations d’équipe" nombre={conversations.length}>
            {conversations.map((chat) => (
              <LigneConversation
                key={chat.id}
                chat={chat}
                active={currentId === chat.id}
                projet={projects.find((p) => p.id === chat.projectId)?.name}
                onMenu={(e) => menuConversation.ouvrir(e, chat)}
              />
            ))}
          </SectionBarre>
        )}
      </nav>

      {menuAgent.menu && (
        <MenuAgent
          key={menuAgent.menu.cible.id + menuAgent.menu.x + menuAgent.menu.y}
          role={menuAgent.menu.cible}
          x={menuAgent.menu.x}
          y={menuAgent.menu.y}
          onFermer={menuAgent.fermer}
          onDesactiver={(role) => void desactiver(role).catch((e: unknown) => annoncer(e instanceof Error ? e.message : String(e)))}
        />
      )}
      {menuConversation.menu && (
        <MenuConversationBarre
          key={menuConversation.menu.cible.id + menuConversation.menu.x + menuConversation.menu.y}
          chat={menuConversation.menu.cible}
          projet={projects.find((p) => p.id === menuConversation.menu?.cible.projectId)?.name}
          x={menuConversation.menu.x}
          y={menuConversation.menu.y}
          onFermer={menuConversation.fermer}
          onRenommer={setRenommage}
        />
      )}
      {renommage && <ModaleRenommer chat={renommage} onFermer={() => setRenommage(null)} />}
      {fenetreDesactiver}
    </aside>
  );
}
