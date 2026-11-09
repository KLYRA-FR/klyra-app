"use client";

import { useEffect, useRef, useState } from "react";
import { getBridge } from "@/lib/bridge";
import { useReglages } from "@/lib/reglages";
import { echangesPourSuggestion, peutSuggerer, reponseVientDeFinir, Suggesteur } from "@/lib/suggestion";
import { useChatMessages, useFile, useTravail } from "@/lib/workspace";
import type { Chat } from "@/types/domain";

/**
 * La réponse suggérée dans le champ d'une conversation : demandée quand la
 * réponse d'agent vue en cours d'écriture se termine, effacée par une frappe,
 * l'envoi ou un autre fil. Rien sans l'app de bureau ni avec le réglage coupé.
 * Seulement ce qui suit le dernier « Repartir à zéro » de la conversation.
 */
export function useSuggestion(chat: Pick<Chat, "id" | "departs">, texte: string) {
  const chatId = chat.id;
  const dernierDepart = chat.departs?.at(-1);
  const messages = useChatMessages(chatId);
  const travail = useTravail(chatId);
  const file = useFile(chatId);
  const { reglages } = useReglages();
  const actives = reglages?.suggestions.actives ?? false;
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const [suggesteur] = useState(
    () =>
      new Suggesteur(
        {
          demander: async (id, echanges) => {
            const r = await getBridge()?.claude.suggestion?.(id, echanges);
            return r?.ok ? r.data : null;
          },
          annuler: (id) => void getBridge()?.claude.annulerSuggestion?.(id),
        },
        setSuggestion,
      ),
  );

  /* Un autre fil, ou l'écran quitté : la demande s'arrête. */
  useEffect(() => () => suggesteur.annuler(), [chatId, suggesteur]);

  /* La réponse d'agent vue en train de s'écrire : sa fin seule déclenche la suggestion. */
  const vueEnCours = useRef<string | null>(null);
  const dernier = messages.at(-1);
  const occupe = !!travail || file.length > 0;
  useEffect(() => {
    const s = suggesteur;
    if (dernier?.author.kind === "role" && dernier.statut === "en-cours") {
      vueEnCours.current = dernier.id;
      return;
    }
    if (!reponseVientDeFinir(vueEnCours.current, dernier)) {
      // Un nouveau message (envoi), un agent au travail : la suggestion d'avant ne vaut plus.
      if (occupe || dernier?.author.kind !== "role") s.annuler();
      return;
    }
    // La conversation se libère juste après la fin du message : on attend ce moment.
    if (occupe) return;
    // Décidé alors, une fois : vider le champ plus tard ne la redemande pas.
    vueEnCours.current = null;
    if (!dernier || !peutSuggerer(messages, { actives, occupe, texte })) return;
    const echanges = echangesPourSuggestion({ departs: dernierDepart ? [dernierDepart] : undefined }, messages);
    if (echanges) s.lancer(`${chatId}:${dernier.id}`, echanges);
  }, [chatId, dernierDepart, dernier, messages, actives, occupe, texte, suggesteur]);

  /* « Repartir à zéro » : une suggestion tirée de ce qui précède ne vaut plus. */
  useEffect(() => {
    if (dernierDepart) suggesteur.annuler();
  }, [dernierDepart, suggesteur]);

  /* Toute frappe efface la suggestion et arrête la demande en cours ; le réglage coupé aussi. */
  useEffect(() => {
    if (texte || !actives) suggesteur.annuler();
  }, [texte, actives, suggesteur]);

  return {
    suggestion: texte ? null : suggestion,
    /** La phrase à insérer (Tab), qui disparaît alors. */
    prendre: () => suggesteur.prendre(),
    ignorer: () => suggesteur.annuler(),
  };
}
