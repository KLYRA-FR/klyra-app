"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { CarteInteractiveVue } from "@/components/chat/CarteInteractive";
import { fenetreCreneaux, planningTelephone, type Carte, type ReponseCarte } from "@/lib/cartes-interactives";
import type { PlanningDuPoste } from "@/lib/poste/gestes/planning";
import { useLecturePoste } from "@/lib/poste/client";

/**
 * Une carte interactive sur le téléphone : la même vue qu'au bureau, envoyée comme un message. Pour
 * des créneaux, le planning à croiser vient du calendrier du compte (lu même ordinateur fermé) et des
 * rendez-vous de l'ordinateur (ouvert, ou sa dernière vue gardée) ; rien n'est lu pour un autre genre.
 */
export function CarteTelephone({
  etapeId,
  carte,
  envoyee,
  actif,
  repondu,
  onEnvoyer,
}: {
  etapeId: string;
  carte: Carte;
  envoyee: ReponseCarte | null;
  actif: boolean;
  repondu: string | null;
  onEnvoyer: (texte: string) => void;
}) {
  const fenetre = useMemo(() => (carte.genre === "creneaux" ? fenetreCreneaux(carte.creneaux) : null), [carte]);
  const compte = useQuery(api.evenements.entre, fenetre ?? "skip");
  const poste = useLecturePoste<PlanningDuPoste>("planning.lire", fenetre ? {} : null);
  const donneesPoste = poste.etat === "ok" ? poste.data : poste.etat === "ferme" ? (poste.gardee?.data ?? null) : null;
  const planning = useMemo(() => (fenetre ? planningTelephone(compte, donneesPoste?.evenements) : []), [fenetre, compte, donneesPoste]);
  return <CarteInteractiveVue etapeId={etapeId} carte={carte} envoyee={envoyee} provisoire={false} actif={actif} repondu={repondu} planning={planning} onEnvoyer={(texte) => onEnvoyer(texte)} />;
}
