"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { messageErreur, useCompte } from "@/lib/compte";
import { texteResultat, type DemandeLue } from "@/lib/telephone/tickets";
import { useAnnonce } from "./Annonce";
import { useCartes } from "./AgentsChat";

/**
 * Les demandes du téléphone sur les tickets (contrat des lots 3 et 4, règle 2). Le même geste garde son
 * identifiant tant qu'il n'est pas fini : un double appui ou une reprise réseau retombent sur la même
 * demande, et réessayer après un échec en crée une nouvelle. Rend le message d'erreur, ou null si le
 * compte l'a acceptée (ce qui ne dit pas qu'elle est faite).
 */
export function useDemandeTicket() {
  const { etat } = useCompte();
  const demandes = useQuery(api.ticketsCompte.mesDemandes, etat === "connecte" ? {} : "skip");
  const demander = useMutation(api.ticketsCompte.demander);
  const ids = useRef(new Map<string, string>());
  const lues = useRef(demandes);
  useEffect(() => {
    lues.current = demandes;
  }, [demandes]);

  const envoyer = useCallback(
    async (conversationOrigine: string, type: DemandeLue["type"], valeur: Record<string, unknown>, revision: number): Promise<string | null> => {
      const cle = JSON.stringify([conversationOrigine, type, valeur, revision]);
      const connu = ids.current.get(cle);
      const fini = connu ? lues.current?.some((d) => d.demandeId === connu && (d.etat === "confirmee" || d.etat === "echouee")) : false;
      const demandeId = connu && !fini ? connu : crypto.randomUUID();
      ids.current.set(cle, demandeId);
      try {
        await demander({ demandeId, conversationOrigine, type, valeur: JSON.stringify(valeur), revision });
        return null;
      } catch (err) {
        return messageErreur(err);
      }
    },
    [demander],
  );
  return { demandes, envoyer };
}

/**
 * L'accusé de l'ordinateur se dit ici, où que soit la personne : le succès réel, l'étape qui attend, ou
 * l'erreur précise. Seulement sur un passage vu de l'attente au résultat : rouvrir l'app ne rejoue rien.
 */
export function SuiviDemandesTickets() {
  const { etat } = useCompte();
  const demandes = useQuery(api.ticketsCompte.mesDemandes, etat === "connecte" ? {} : "skip");
  const conversations = useQuery(api.conversationsCompte.liste, etat === "connecte" ? {} : "skip");
  const annoncer = useAnnonce();
  const router = useRouter();
  const { nom } = useCartes();
  const suivies = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (!demandes) return;
    const avant = suivies.current;
    const apres = new Map<string, string>();
    for (const d of demandes) {
      if (d.etat === "en-attente" || d.etat === "traitement") {
        apres.set(d.demandeId, conversations?.find((c) => c.origine === d.conversationOrigine)?.titre ?? avant?.get(d.demandeId) ?? "Ce ticket");
      } else if (avant?.has(d.demandeId)) {
        if (d.type === "confier") {
          let roleId = "";
          try {
            roleId = String((JSON.parse(d.valeur) as { roleId?: unknown }).roleId ?? "");
          } catch {
            /* Sans agent lisible : le texte reste juste. */
          }
          if (d.etat === "confirmee") {
            const ticket = `/tickets?id=${encodeURIComponent(d.conversationOrigine)}`;
            annoncer({ texte: `Confié à ${nom(roleId)}`, icone: "check-01", action: { libelle: "Voir le ticket", onChoisir: () => router.push(ticket) } });
          } else {
            const resultat = texteResultat(d, "Ce rappel");
            annoncer({ texte: resultat?.texte ?? "Attribution à réessayer.", erreur: true });
          }
        } else {
          const resultat = texteResultat(d, avant.get(d.demandeId) ?? "Ce ticket");
          if (resultat) annoncer(resultat.erreur ? { texte: resultat.texte, erreur: true } : { texte: resultat.texte, icone: "check-01" });
        }
      }
    }
    suivies.current = apres;
  }, [demandes, conversations, annoncer, nom, router]);
  return null;
}
