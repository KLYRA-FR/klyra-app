"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

const SALLE = "klyra";
const INTERVALLE = 10_000;

/** Dit au serveur que l'app est ouverte. Sans ce signal, un rappel assigné part par e-mail. */
export function PresenceKlyra({ actif }: { actif: boolean }) {
  const heartbeat = useMutation(api.presence.heartbeat);
  const disconnect = useMutation(api.presence.disconnect);
  const [sessionId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!actif) return;
    let jeton: string | null = null;
    let arrete = false;
    const battre = () => {
      void heartbeat({ roomId: SALLE, userId: "session", sessionId, interval: INTERVALLE })
        .then((reponse) => {
          if (arrete) return disconnect({ sessionToken: reponse.sessionToken });
          jeton = reponse.sessionToken;
        })
        .catch(() => {
          /* Le prochain signal réessaie. Une coupure ne déconnecte pas le compte. */
        });
    };
    battre();
    const minuteur = setInterval(battre, INTERVALLE);
    return () => {
      arrete = true;
      clearInterval(minuteur);
      if (jeton) void disconnect({ sessionToken: jeton });
    };
  }, [actif, disconnect, heartbeat, sessionId]);

  return null;
}
