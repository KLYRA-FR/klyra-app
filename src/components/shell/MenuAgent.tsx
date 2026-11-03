"use client";

import { useRouter } from "next/navigation";
import { AgentRond } from "@/components/roles/AgentRond";
import {
  ActionRapide,
  ActionsRapides,
  ElementContextuel,
  EnteteContextuel,
  MenuContextuel,
  SeparateurContextuel,
  SousMenuContextuel,
} from "@/components/ui/MenuContextuel";
import { useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { useChatMessages, useIdDirect, useNonLus, useTravail, useWorkspace } from "@/lib/workspace";
import type { Role } from "@/types/domain";
import { etapeEnCours } from "./LignesBarre";

/**
 * Le clic droit sur un agent de la barre : où il en est, ses gestes fréquents (nouveau fil,
 * épingle, sourdine, fiche), puis l'ouvrir, l'arrêter, aller à ses tickets ou routines, et
 * le masquer de la liste ou le désactiver. L'assistant ne se masque ni ne se désactive.
 */
export function MenuAgent({
  role,
  x,
  y,
  onFermer,
  onDesactiver,
}: {
  role: Role;
  x: number;
  y: number;
  onFermer: (rendreFocus?: boolean) => void;
  onDesactiver: (role: Role) => void;
}) {
  const router = useRouter();
  const { meta, preferer, canEdit } = useAgents();
  const { state, creerFil, arreter, marquerLu } = useWorkspace();
  const chatId = useIdDirect()(role.id);
  const travail = useTravail(chatId);
  const messages = useChatMessages(chatId);
  const nonLus = useNonLus(chatId);
  const assistant = role.id === "principal";
  const reglage = meta[role.id] ?? {};
  const epingle = !!reglage.epingleLe;
  const muet = !!reglage.muet;
  const masque = !!reglage.masque;
  /* Partout où il travaille : sa conversation, ses fils, les conversations d'équipe. */
  const chantiers = Object.entries(state.travail).filter(([, t]) => t.roleId === role.id).map(([id]) => id);

  const statut = travail
    ? `${etapeEnCours(messages, travail.messageId) ?? "Réfléchit"}…`
    : chantiers.length
      ? "Travaille dans une autre conversation…"
      : role.title || role.tag;

  const aller = (url: string) => router.push(url);
  const changer = (preference: Parameters<typeof preferer>[1], annonce: string) =>
    void preferer(role.id, preference).then(
      () => annoncer(annonce),
      (e: unknown) => annoncer(e instanceof Error ? e.message : String(e)),
    );

  return (
    <MenuContextuel x={x} y={y} libelle={role.name} onFermer={onFermer}>
      <EnteteContextuel
        visuel={<AgentRond roleId={role.id} taille={28} />}
        titre={role.name}
        sousTitre={statut}
        enCours={chantiers.length > 0}
      />
      <ActionsRapides>
        <ActionRapide icone="plus-01" libelle="Nouveau fil" onChoisir={() => aller(`/chat?id=${encodeURIComponent(creerFil(role.id))}`)} />
        {!assistant && (
          <ActionRapide
            icone={epingle ? "pin-off-01" : "pin-01"}
            libelle={epingle ? "Désépingler" : "Épingler"}
            actif={epingle}
            garderOuvert
            onChoisir={() => canEdit && changer({ epingle: !epingle }, epingle ? `${role.name} n’est plus épinglé.` : `${role.name} épinglé en haut.`)}
          />
        )}
        <ActionRapide
          icone="bell-01"
          libelle={muet ? "En sourdine" : "Sourdine"}
          actif={muet}
          garderOuvert
          onChoisir={() => canEdit && changer({ muet: !muet }, muet ? `${role.name} te prévient de nouveau.` : `${role.name} en sourdine.`)}
        />
        <ActionRapide icone="user-profile-01" libelle="Fiche" onChoisir={() => aller(`/equipe?agent=${encodeURIComponent(role.id)}`)} />
      </ActionsRapides>
      <SeparateurContextuel />
      <ElementContextuel icone="message-square" raccourci="↵" onChoisir={() => aller(`/chat?id=${encodeURIComponent(chatId)}`)}>
        Ouvrir la conversation
      </ElementContextuel>
      {nonLus > 0 && (
        <ElementContextuel icone="check-01" onChoisir={() => marquerLu(chatId)}>
          Marquer comme lu
        </ElementContextuel>
      )}
      {chantiers.length > 0 && (
        <ElementContextuel
          icone="stop-01"
          detail={chantiers.length > 1 ? `Dans ${chantiers.length} conversations` : undefined}
          onChoisir={() => chantiers.forEach((id) => arreter(id))}
        >
          Arrêter son travail
        </ElementContextuel>
      )}
      <SeparateurContextuel />
      <SousMenuContextuel icone="link-external" libelle="Aller à">
        <ElementContextuel icone="list" onChoisir={() => aller(`/tickets?agent=${encodeURIComponent(role.id)}`)}>
          Ses tickets
        </ElementContextuel>
        <ElementContextuel icone="clock-01" onChoisir={() => aller(`/routines?vue=routines&agent=${encodeURIComponent(role.id)}`)}>
          Ses routines
        </ElementContextuel>
        <ElementContextuel icone="user-profile-01" onChoisir={() => aller(`/equipe?agent=${encodeURIComponent(role.id)}`)}>
          Sa fiche
        </ElementContextuel>
      </SousMenuContextuel>
      <ElementContextuel icone="copy-left" onChoisir={() => void navigator.clipboard?.writeText(`@${role.name}`)}>
        Copier la mention @{role.name}
      </ElementContextuel>
      {!assistant && (
        <>
          <SeparateurContextuel />
          <ElementContextuel
            icone={masque ? "maximise-01" : "minimise-01"}
            desactive={!canEdit}
            detail={masque ? undefined : "Il reste actif et appelable"}
            onChoisir={() => changer({ masque: !masque }, masque ? `${role.name} de retour dans la liste.` : `${role.name} masqué de la liste.`)}
          >
            {masque ? "Afficher dans la liste" : "Masquer de la liste"}
          </ElementContextuel>
          <ElementContextuel icone="lock-01" danger desactive={!canEdit} onChoisir={() => onDesactiver(role)}>
            Désactiver…
          </ElementContextuel>
        </>
      )}
    </MenuContextuel>
  );
}
