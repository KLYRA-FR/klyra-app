"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bouton } from "@/components/ui/Bouton";
import { COMMANDE_COMPACTER, conseilContexte, estChatPrincipal, formaterJetons, MARGE_PLUS_TARD } from "@/lib/contexte";
import { useRoles, useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";

/**
 * Au-dessus du composeur : une conversation lourde, à résumer pour alléger la suite ; ou une
 * reprise après plus d'une heure, où l'on repart léger pour un nouveau sujet : à zéro dans le chat
 * d'un agent (un fil y serait une tâche de plus), un fil neuf dans un fil.
 * Règles : lib/contexte.ts. Absent pendant qu'un agent travaille.
 */
export function ConseilContexte({ chat }: { chat: Chat }) {
  const { state, sendMessage, masquerConseilContexte, creerFil, repartir } = useWorkspace();
  const roles = useRoles();
  const router = useRouter();
  // La pause compte : le conseil peut apparaître sans nouveau message.
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const minuterie = setInterval(() => setMaintenant(Date.now()), 60_000);
    return () => clearInterval(minuterie);
  }, []);

  const conseil = conseilContexte(chat, maintenant);
  if (!conseil || state.travail[chat.id]) return null;

  const nom = roles.find((r) => r.id === conseil.roleId)?.name ?? conseil.roleId;
  const taille = formaterJetons(conseil.jetons);
  const constat = conseil.cacheExpire
    ? `Pause de plus d’une heure : ton prochain message ici fera relire ${taille} jetons à ${nom}, au prix fort.`
    : `${nom} relit ${taille} jetons à chaque étape de cette conversation.`;
  const principal = estChatPrincipal(chat);
  const conseilFil = principal
    ? ` Pour un nouveau sujet, repars à zéro : ${nom} ne relira plus cette conversation, qui reste lisible.`
    : conseil.filPossible
      ? " Pour un nouveau sujet, un fil neuf repart léger."
      : "";
  const conseilResume = conseil.raison === "lourde" ? " Pour continuer ici, un résumé allège la suite." : "";
  const nouveauFil = () => router.push(`/chat?id=${encodeURIComponent(creerFil(conseil.roleId, undefined, null, undefined, { lieu: chat.lieu ?? null }))}`);

  return (
    <div className="mx-auto w-full max-w-[880px] px-5" data-conseil-contexte={conseil.raison}>
      <div role="status" className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-fond-surface-grise px-3 py-2">
        <p className="m-0 min-w-0 flex-1 text-ui-xs text-texte-secondaire">
          {constat}
          {conseilFil}
          {conseilResume}
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Bouton variant="discret" taille="mini" onClick={() => masquerConseilContexte(chat.id, conseil.jetons + MARGE_PLUS_TARD)}>
            Plus tard
          </Bouton>
          {principal ? (
            <Bouton variant="blanc" taille="mini" onClick={() => repartir(chat.id)}>
              Repartir à zéro
            </Bouton>
          ) : (
            conseil.filPossible && (
              <Bouton variant="blanc" taille="mini" onClick={nouveauFil}>
                Nouveau fil
              </Bouton>
            )
          )}
          {conseil.raison === "lourde" && (
            <Bouton variant="blanc" taille="mini" onClick={() => sendMessage(chat.id, COMMANDE_COMPACTER, conseil.roleId)}>
              Résumer la conversation
            </Bouton>
          )}
        </div>
      </div>
    </div>
  );
}
