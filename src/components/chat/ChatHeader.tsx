"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { agentDeConversation } from "@/lib/conversation-projet";
import { estChatPrincipal, peutRepartir } from "@/lib/contexte";
import { nomLieu, useServeursRelies } from "@/lib/lieux";
import { ChoixModele } from "./ChoixModele";
import { ouvrirPanneauAgent } from "./PanneauLateral";
import { MenuConversation } from "./MenuConversation";
import type { ActionExport } from "./useExporterConversation";
import { useBasculerEpingle } from "./BoutonEpingle";
import { estEpinglee } from "@/lib/epinglage";
import { useAgentOccupe, useChatMessages, useRole, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat, Project } from "@/types/domain";

interface ChatHeaderProps {
  chat: Chat;
  project: Project | undefined;
  previewOpen: boolean;
  onTogglePreview: () => void;
  actionExport?: ActionExport;
}

/** En-tête d'une conversation directe : l'agent, ce qu'il fait, sa fiche. */
function EnTeteDirect({ chat, panneauOuvert, onTogglePanneau, actionExport }: { chat: Chat; panneauOuvert: boolean; onTogglePanneau: () => void; actionExport?: ActionExport }) {
  const onOuvrirPanneau = ouvrirPanneauAgent;
  const options = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const role = useRole(chat.roleIds[0] ?? "principal");
  const ici = useTravail(chat.id);
  const messages = useChatMessages(chat.id);
  const { repartir } = useWorkspace();
  const rienDepuis = !peutRepartir(chat, messages);
  const actionRepartir = estChatPrincipal(chat)
    ? { lancer: () => repartir(chat.id), desactivee: !!ici || rienDepuis, detail: ici ? `${role.name} travaille` : rienDepuis ? "Rien depuis le dernier départ" : undefined }
    : undefined;
  const occupe = useAgentOccupe(role.id);
  // Dans un fil : son identifiant, celui qu'on cite (« Rapport hebdo (klyra-fil-…) »).
  const etat = ici ? "Travaille…" : chat.fil ? `${chat.title} · ${chat.id}` : occupe ? "Travaille dans une conversation d’équipe" : role.title;
  return (
    <header className="@container flex items-center gap-3 border-b border-bordure-subtile px-5 py-3">
      {/* L'avatar et le prénom ouvrent le panneau de l'agent, sur ses réglages. */}
      <button type="button" onClick={onOuvrirPanneau} aria-label={`Ouvrir le panneau de ${role.name}`} className="cursor-pointer rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bordure-forte">
        <AgentRond roleId={role.id} taille={32} statut={occupe ? { type: "travaille" } : null} fondPastille="surface" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="m-0 flex items-baseline gap-2 truncate text-ui font-semibold text-texte-principal">
          <button type="button" onClick={onOuvrirPanneau} title={`Ouvrir le panneau de ${role.name}`} className="cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-[length:inherit] text-inherit hover:underline hover:underline-offset-2">
            {role.name}
          </button>
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
          data-son="panneau"
          onClick={onTogglePanneau}
        />
        {!panneauOuvert && chat.taches?.some((t) => t.statut === "en-cours") && (
          <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-bleu-k1-500" />
        )}
      </span>
      {actionExport && <MenuConversation bouton={options} actionExport={actionExport} repartir={actionRepartir} />}
    </header>
  );
}

/**
 * Le titre en cours de renommage. Entrée ou clic ailleurs : il est gardé ;
 * Échap : il reste tel quel. Une seule fin, même si le champ perd ensuite le focus.
 */
function ChampTitre({ titre, onFin }: { titre: string; onFin: (nouveau: string | null, auClavier: boolean) => void }) {
  const fini = useRef(false);
  const finir = (nouveau: string | null, auClavier: boolean) => {
    if (fini.current) return;
    fini.current = true;
    onFin(nouveau, auClavier);
  };
  return (
    <input
      autoFocus
      defaultValue={titre}
      maxLength={80}
      aria-label="Nom de la conversation"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finir(e.currentTarget.value, false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          // Sans cela, l'Entrée irait aussi au « … » qui reprend le focus, et rouvrirait le menu.
          e.preventDefault();
          finir(e.currentTarget.value, true);
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          finir(null, true);
        }
      }}
      // La typo et la place du titre (le contour ne prend pas de place) : l'en-tête ne bouge pas.
      className="w-full min-w-0 rounded-2xs bg-transparent p-0 text-ui font-semibold text-texte-principal outline outline-1 outline-offset-2 outline-bordure-champ"
    />
  );
}

/**
 * En-tête d'une conversation de projet : celle d'un chat avec un agent (son visage, le modèle, le panneau
 * de réglages, d'aperçu et de fichiers), avec le titre de la conversation, qu'on renomme et qu'on épingle.
 */
function EnTeteProjet({ chat, panneauOuvert, onTogglePanneau, actionExport }: { chat: Chat; panneauOuvert: boolean; onTogglePanneau: () => void; actionExport?: ActionExport }) {
  const { renommerChat } = useWorkspace();
  const serveurs = useServeursRelies();
  const basculerEpingle = useBasculerEpingle();
  const [edition, setEdition] = useState(false);
  const options = useRef<HTMLButtonElement>(null);
  const role = useRole(agentDeConversation(chat));
  const ici = useTravail(chat.id);
  const travailleur = useRole(ici?.roleId ?? role.id);
  const autres = chat.roleIds.length - 1;
  const etat = ici
    ? `${travailleur.name} travaille…`
    : [`${role.name} · ${role.tag}`, autres > 0 && `${autres} autre${autres > 1 ? "s" : ""} agent${autres > 1 ? "s" : ""} mentionné${autres > 1 ? "s" : ""}`, chat.lieu && `sur ${nomLieu(chat.lieu, serveurs)}`]
        .filter(Boolean)
        .join(" · ");
  return (
    <header className="@container flex items-center gap-3 border-b border-bordure-subtile px-5 py-3">
      {/* Le visage de l'agent ouvre le panneau, sur ses réglages. */}
      <button type="button" onClick={ouvrirPanneauAgent} aria-label={`Ouvrir le panneau de ${role.name}`} className="cursor-pointer rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bordure-forte">
        <AgentRond roleId={role.id} taille={32} statut={ici ? { type: "travaille" } : null} fondPastille="surface" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {edition ? (
          <ChampTitre
            titre={chat.title}
            onFin={(nouveau, auClavier) => {
              if (nouveau !== null) renommerChat(chat.id, nouveau);
              setEdition(false);
              if (auClavier) options.current?.focus();
            }}
          />
        ) : (
          <h1 className="m-0 flex min-w-0 items-center gap-1.5 text-ui font-semibold">
            <span className="truncate">{chat.title}</span>
            {estEpinglee(chat) && (
              <span role="img" aria-label="Épinglée" title="Épinglée" className="flex shrink-0 text-icone-secondaire">
                <Icon name="pin-01" size={14} />
              </span>
            )}
          </h1>
        )}
        <span className={ici ? "klyra-respire truncate text-ui-xs text-texte-secondaire" : "truncate text-ui-xs text-texte-tertiaire"}>{etat}</span>
      </div>
      <ChoixModele chat={chat} />
      {/* Le point : l'agent a des tâches en cours, visibles dans le panneau. */}
      <span className="relative">
        <BoutonIcone
          taille="compact"
          actif={panneauOuvert}
          icone={<Icon name="layout-right" size={16} />}
          libelle={panneauOuvert ? "Fermer le panneau" : "Ouvrir le panneau (réglages, aperçu, fichiers, tâches)"}
          aria-pressed={panneauOuvert}
          data-son="panneau"
          onClick={onTogglePanneau}
        />
        {!panneauOuvert && chat.taches?.some((t) => t.statut === "en-cours") && (
          <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-bleu-k1-500" />
        )}
      </span>
      <MenuConversation bouton={options} onRenommer={() => setEdition(true)} epinglee={estEpinglee(chat)} onEpingler={() => basculerEpingle(chat)} actionExport={actionExport} />
    </header>
  );
}

export function ChatHeader({ chat, project, previewOpen, onTogglePreview, actionExport }: ChatHeaderProps) {
  const { renommerChat } = useWorkspace();
  const serveurs = useServeursRelies();
  const basculerEpingle = useBasculerEpingle();
  /* La conversation dont le titre est en cours de renommage. */
  const [edition, setEdition] = useState<string | null>(null);
  const options = useRef<HTMLButtonElement>(null);

  if (chat.kind === "direct") {
    return <EnTeteDirect chat={chat} panneauOuvert={previewOpen} onTogglePanneau={onTogglePreview} actionExport={actionExport} />;
  }
  /* Dans un projet : la conversation se lit comme le chat d'un agent. */
  if (project) {
    return <EnTeteProjet key={chat.id} chat={chat} panneauOuvert={previewOpen} onTogglePanneau={onTogglePreview} actionExport={actionExport} />;
  }

  const roleCount = chat.roleIds.length;
  return (
    <header className="@container flex items-center gap-3 border-b border-bordure-subtile px-5 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {edition === chat.id ? (
          <ChampTitre
            titre={chat.title}
            onFin={(nouveau, auClavier) => {
              if (nouveau !== null) renommerChat(chat.id, nouveau);
              setEdition(null);
              // Au clavier, le focus revient au « … » ; un clic ailleurs le laisse où il est allé.
              if (auClavier) options.current?.focus();
            }}
          />
        ) : (
          <h1 className="m-0 flex min-w-0 items-center gap-1.5 text-ui font-semibold">
            <span className="truncate">{chat.title}</span>
            {estEpinglee(chat) && (
              <span role="img" aria-label="Épinglée" title="Épinglée" className="flex shrink-0 text-icone-secondaire">
                <Icon name="pin-01" size={14} />
              </span>
            )}
          </h1>
        )}
        <span className="truncate text-ui-xs text-texte-tertiaire">
          {roleCount} {roleCount > 1 ? "agents" : "agent"} dans la conversation
          {chat.lieu ? ` · sur ${nomLieu(chat.lieu, serveurs)}` : ""}
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
          data-son="panneau"
          onClick={onTogglePreview}
        />
        <MenuConversation bouton={options} onRenommer={() => setEdition(chat.id)} epinglee={estEpinglee(chat)} onEpingler={() => basculerEpingle(chat)} actionExport={actionExport} />
      </div>
    </header>
  );
}
