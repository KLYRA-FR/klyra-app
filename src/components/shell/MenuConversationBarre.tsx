"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "klyra-ui";
import { Bouton } from "@/components/ui/Bouton";
import { ElementContextuel, EnteteContextuel, MenuContextuel, SeparateurContextuel } from "@/components/ui/MenuContextuel";
import { Modale } from "@/components/ui/Modale";
import { estEpinglee } from "@/lib/epinglage";
import { useNonLus, useRoles, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";
import { Grappe } from "./LignesBarre";

/** Le clic droit sur une conversation d'équipe de la barre. */
export function MenuConversationBarre({
  chat,
  projet,
  x,
  y,
  onFermer,
  onRenommer,
}: {
  chat: Chat;
  projet?: string;
  x: number;
  y: number;
  onFermer: (rendreFocus?: boolean) => void;
  onRenommer: (chat: Chat) => void;
}) {
  const router = useRouter();
  const roles = useRoles();
  const { epinglerChat, marquerLu, arreter } = useWorkspace();
  const travail = useTravail(chat.id);
  const nonLus = useNonLus(chat.id);
  const epinglee = estEpinglee(chat);
  const qui = travail ? roles.find((r) => r.id === travail.roleId)?.name : null;
  const membres = chat.roleIds.map((id) => roles.find((r) => r.id === id)?.name).filter(Boolean);

  return (
    <MenuContextuel x={x} y={y} libelle={chat.title} onFermer={onFermer}>
      <EnteteContextuel
        visuel={<Grappe chat={chat} roles={roles} petite />}
        titre={chat.title}
        sousTitre={qui ? `${qui} travaille…` : [projet, membres.join(", ")].filter(Boolean).join(" · ")}
        enCours={!!travail}
      />
      <SeparateurContextuel />
      <ElementContextuel icone="message-square" raccourci="↵" onChoisir={() => router.push(`/chat?id=${encodeURIComponent(chat.id)}`)}>
        Ouvrir
      </ElementContextuel>
      <ElementContextuel icone={epinglee ? "pin-off-01" : "pin-01"} onChoisir={() => epinglerChat(chat.id, !epinglee)}>
        {epinglee ? "Retirer l’épingle" : "Épingler"}
      </ElementContextuel>
      {nonLus > 0 && (
        <ElementContextuel icone="check-01" onChoisir={() => marquerLu(chat.id)}>
          Marquer comme lu
        </ElementContextuel>
      )}
      <ElementContextuel icone="pencil-01" onChoisir={() => onRenommer(chat)}>
        Renommer…
      </ElementContextuel>
      {travail && (
        <ElementContextuel icone="stop-01" onChoisir={() => arreter(chat.id)}>
          Arrêter {qui ?? "l’agent"}
        </ElementContextuel>
      )}
      {chat.projectId && (
        <>
          <SeparateurContextuel />
          <ElementContextuel icone="projets-dossier" onChoisir={() => router.push(`/projet?id=${encodeURIComponent(chat.projectId!)}`)}>
            Ouvrir le projet{projet ? ` ${projet}` : ""}
          </ElementContextuel>
        </>
      )}
    </MenuContextuel>
  );
}

/** Renommer une conversation sans l'ouvrir. */
export function ModaleRenommer({ chat, onFermer }: { chat: Chat; onFermer: () => void }) {
  const { renommerChat } = useWorkspace();
  const [titre, setTitre] = useState(chat.title);
  const formulaire = useId();
  const propre = titre.trim();
  return (
    <Modale
      titre="Renommer la conversation"
      onFermer={onFermer}
      className="w-[420px]"
      actions={
        <>
          <Bouton variant="blanc" taille="md" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton type="submit" form={formulaire} variant="sombre" taille="md" disabled={!propre || propre === chat.title}>
            Renommer
          </Bouton>
        </>
      }
    >
      <form
        id={formulaire}
        onSubmit={(e) => {
          e.preventDefault();
          if (!propre) return;
          renommerChat(chat.id, propre);
          onFermer();
        }}
      >
        <Input data-autofocus size="sm" value={titre} maxLength={120} aria-label="Nom de la conversation" onChange={(e) => setTitre(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
      </form>
    </Modale>
  );
}
