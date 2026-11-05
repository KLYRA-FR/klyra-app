"use client";

import { useEffect, useState } from "react";
import type { CompteClaude, ModeleMoteur, MoteurPoste } from "@/lib/bridge";
import type { LectureEspace, ValeurConversation } from "@/lib/espace-sync";
import { FOURNISSEURS, PAR_DEFAUT } from "@/lib/fournisseurs";
import type { EtatMoteur } from "@/lib/moteurs";
import { useLecturePoste } from "@/lib/poste/client";
import { jetonAppareil } from "@/lib/serveur-vps";
import { lireModele } from "./options";

type Catalogue = { moteurs: EtatMoteur[]; erreur: string | null };
type Choix = NonNullable<ReturnType<typeof lireModele>>;

/** Les lectures authentifiées existantes du VPS ; aucune installation ni connexion depuis le choix. */
export async function lireModelesTelephone(lieu: string, origine: string, signal: AbortSignal): Promise<Catalogue & { choix: Choix | null }> {
  const jeton = jetonAppareil(lieu);
  if (!jeton) throw new Error("Ce téléphone n’est plus relié à ce VPS.");
  const lire = async <T,>(chemin: string, corps?: string): Promise<T> => {
    const r = await fetch(`${lieu}/klyra/v1/${chemin}`, {
      method: corps === undefined ? "GET" : "POST", body: corps,
      headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
      signal, cache: "no-store", redirect: "error",
    });
    if (!r.ok) throw new Error("Les fournisseurs ne se lisent pas sur ce serveur.");
    return r.json() as Promise<T>;
  };
  const [liste, espace] = await Promise.all([
    lire<{ moteurs: MoteurPoste[] }>("moteurs"),
    lire<{ resultat: LectureEspace }>("espace/lire", "{}"),
  ]);
  const moteurs = await Promise.all(liste.moteurs.filter((m) => FOURNISSEURS.some((f) => f.id === m.id)).map(async (moteur): Promise<EtatMoteur> => {
    if (!moteur.chemin) return { moteur, compte: null, modeles: null, erreur: null };
    try {
      const { compte } = await lire<{ compte: CompteClaude }>(`moteurs/${moteur.id}/compte`);
      const modeles = moteur.id === PAR_DEFAUT || !compte.connecte ? null : (await lire<{ modeles: ModeleMoteur[] }>(`moteurs/${moteur.id}/modeles`)).modeles;
      return { moteur, compte, modeles, erreur: null };
    } catch (err) {
      if (signal.aborted) throw err;
      return { moteur, compte: null, modeles: null, erreur: "Les modèles de ce fournisseur ne se lisent pas." };
    }
  }));
  const valeur = espace.resultat.elements?.find((e) => e.type === "conversation" && e.id === origine)?.valeur as ValeurConversation | undefined;
  const chat = valeur?.chat;
  return { moteurs, erreur: null, choix: chat ? { fournisseur: FOURNISSEURS.find((f) => f.id === chat.fournisseur)?.id ?? PAR_DEFAUT, modele: chat.modele ?? null, effort: chat.effort ?? null } : null };
}

/** Le catalogue de la machine de cette conversation, même sans bridge Electron sur le téléphone. */
export function useModelesTelephone(lieu: string | null, origine: string) {
  const poste = useLecturePoste<Catalogue>("fil.modeles", lieu ? null : { conversation: origine });
  const [serveur, setServeur] = useState<{ cle: string; catalogue: Catalogue; choix: Choix | null } | null>(null);
  const cle = `${lieu}|${origine}`;
  useEffect(() => {
    if (!lieu) return;
    const controle = new AbortController();
    void lireModelesTelephone(lieu, origine, controle.signal).then((lu) => {
      if (!controle.signal.aborted) setServeur({ cle, catalogue: lu, choix: lu.choix });
    }).catch(() => {
      if (!controle.signal.aborted) setServeur({ cle, catalogue: { moteurs: [], erreur: "Les fournisseurs ne se lisent pas sur ce serveur." }, choix: null });
    });
    return () => controle.abort();
  }, [lieu, origine, cle]);
  const lu = lieu ? serveur?.cle === cle ? serveur.catalogue : null : poste.etat === "ok" ? poste.data : poste.etat === "ferme" ? poste.gardee?.data : null;
  return { moteurs: lu?.moteurs ?? null, erreur: lu?.erreur ?? null, choix: lieu && serveur?.cle === cle ? serveur.choix : null };
}
