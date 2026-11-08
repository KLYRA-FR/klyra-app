"use client";

import { useRouter } from "next/navigation";
import { AgentRond } from "@/components/roles/AgentRond";
import { ElementContextuel, EnteteContextuel, MenuContextuel, SeparateurContextuel, SousMenuContextuel } from "@/components/ui/MenuContextuel";
import { ajouterAuBrouillon } from "@/lib/brouillons";
import { estAvantDepart } from "@/lib/contexte";
import { formatDaySeparator, formatTime, isSameDay } from "@/lib/format";
import { raccourciDuSysteme } from "@/lib/plateforme";
import { citer, titreDuPassage } from "@/lib/repondre";
import { texteDe, useRoles, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat, Message } from "@/types/domain";

/** Ce que le clic droit vise : le message, et le texte surligné dedans s'il y en a. */
export type CibleMessage = { message: Message; selection: string };

/**
 * Le clic droit sur un message : copier (la sélection d'abord), citer dans sa réponse, en faire
 * un fil pour un agent (le passage cité attend dans son composeur, rien n'est envoyé) et, sur
 * une réponse d'agent, créer une branche ou réessayer.
 */
export function MenuMessage({ chat, cible, x, y, onFermer }: { chat: Chat; cible: CibleMessage; x: number; y: number; onFermer: (rendreFocus?: boolean) => void }) {
  const router = useRouter();
  const roles = useRoles();
  const { creerFil, brancher, reessayer } = useWorkspace();
  const travail = useTravail(chat.id);
  const { message, selection } = cible;
  const texte = texteDe(message);
  const passage = selection || texte;
  const auteur = message.author.kind === "role" ? message.author.roleId : null;
  const role = auteur ? roles.find((r) => r.id === auteur) : null;
  /* Le fil va à l'agent qui a écrit ; sur ton message, à l'agent de la conversation s'il n'y en a qu'un. */
  const pourFil = auteur ?? chat.fil?.roleId ?? (chat.roleIds.length === 1 ? chat.roleIds[0] : null);
  const agentsFil = pourFil ? roles.filter((r) => r.id === pourFil) : roles.filter((r) => chat.roleIds.includes(r.id));
  const quand = `${isSameDay(message.createdAt, new Date().toISOString()) ? "Aujourd’hui" : formatDaySeparator(message.createdAt)}, ${formatTime(message.createdAt)}`;

  const enFil = (roleId: string) => {
    const id = creerFil(roleId, titreDuPassage(passage) || undefined, null, undefined, { lieu: chat.lieu ?? null });
    ajouterAuBrouillon(id, citer(passage));
    router.push(`/chat?id=${encodeURIComponent(id)}`);
  };

  return (
    <MenuContextuel x={x} y={y} libelle={role ? `Message de ${role.name}` : "Ton message"} onFermer={onFermer}>
      <EnteteContextuel visuel={auteur ? <AgentRond roleId={auteur} taille={24} /> : undefined} titre={role?.name ?? "Toi"} sousTitre={quand} />
      <SeparateurContextuel />
      {selection && (
        <ElementContextuel icone="copy-left" raccourci={raccourciDuSysteme("⌘C")} onChoisir={() => void navigator.clipboard?.writeText(selection)}>
          Copier la sélection
        </ElementContextuel>
      )}
      <ElementContextuel icone="copy-left" desactive={!texte} onChoisir={() => void navigator.clipboard?.writeText(texte)}>
        Copier le message
      </ElementContextuel>
      <ElementContextuel icone="git-branch-01" desactive={!texte.trim()} onChoisir={() => router.push(`/memoire?chat=${encodeURIComponent(chat.id)}&message=${encodeURIComponent(message.id)}`)}>
        Garder en mémoire
      </ElementContextuel>
      <ElementContextuel icone="align-left" desactive={!passage} onChoisir={() => ajouterAuBrouillon(chat.id, citer(passage))}>
        {selection ? "Citer la sélection" : "Citer dans ma réponse"}
      </ElementContextuel>
      {passage && agentsFil.length === 1 && (
        <ElementContextuel icone="git-branch-02" detail={`Un fil pour ${agentsFil[0].name}, le passage prêt à envoyer`} onChoisir={() => enFil(agentsFil[0].id)}>
          En faire un fil
        </ElementContextuel>
      )}
      {passage && agentsFil.length > 1 && (
        <SousMenuContextuel icone="git-branch-02" libelle="En faire un fil pour">
          {agentsFil.map((r) => (
            <ElementContextuel key={r.id} icone="user-profile-01" onChoisir={() => enFil(r.id)}>
              {r.name}
            </ElementContextuel>
          ))}
        </SousMenuContextuel>
      )}
      {auteur && texte && (
        <>
          <SeparateurContextuel />
          <ElementContextuel
            icone="git-branch-01"
            onChoisir={() => {
              const id = brancher(chat.id, message.id);
              if (id) router.push(`/chat?id=${encodeURIComponent(id)}`);
            }}
          >
            Créer une branche
          </ElementContextuel>
          {!estAvantDepart(chat, message) && (
            <ElementContextuel
              icone="refresh-01"
              detail={travail ? "L’agent travaille : ce sera fait juste après" : undefined}
              onChoisir={() => reessayer(chat.id, message.id, "reessayer")}
            >
              Réessayer
            </ElementContextuel>
          )}
        </>
      )}
    </MenuContextuel>
  );
}
