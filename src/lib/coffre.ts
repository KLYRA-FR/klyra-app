"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLieuActif } from "@/lib/lieux";
import { getBridge, type EntreeSecretCoffre, type EtatCoffre, type Reponse, type SecretCoffre } from "@/lib/bridge";

export * from "../../electron/coffre-regles";

/**
 * Le Coffre de KLYRA côté écran (cf. electron/coffre.ts) : la liste des secrets et des connexions,
 * relue quand le main dit qu'elle a changé (un agent y a rangé un secret). L'écran n'a jamais une
 * valeur : il en envoie une quand la personne la tape ou la colle, et « Copier » passe par le main.
 */
export function useCoffreKlyra(lieuDemande?: string | null) {
  const bridge = getBridge()?.coffre;
  const lieuActif = useLieuActif();
  const lieu = lieuDemande === undefined ? lieuActif : lieuDemande;
  /* Un serveur pas encore à jour n'a pas de coffre à lui : celui de ce PC, comme avant. */
  const [ancien, setAncien] = useState<string | null>(null);
  const surVps = !!lieu && lieu !== ancien && !!bridge?.vps;
  const pont = useMemo(() => {
    if (!bridge) return undefined;
    if (!surVps || !lieu) return bridge;
    const appel = <T,>(methode: string, corps: unknown = {}) => bridge.vps!(lieu, methode, corps) as Promise<Reponse<T>>;
    return {
      etat: () => appel<EtatCoffre>("etat"),
      ajouter: (entree: EntreeSecretCoffre, remplacer?: boolean) => appel<SecretCoffre>("ajouter", { entree, remplacer }),
      modifier: (id: string, champs: Parameters<typeof bridge.modifier>[1]) => appel<SecretCoffre>("modifier", { id, champs }),
      remplacerValeur: (id: string, valeur: string) => appel<SecretCoffre>("valeur", { id, valeur }),
      retirer: (id: string) => appel<void>("retirer", { id }),
      copier: (id: string) => bridge.copierVps!(lieu, id),
      /* Aucun signal n'arrive d'un VPS : une relecture régulière. */
      surChangement: (rappel: () => void) => {
        const minuterie = setInterval(rappel, 20_000);
        return () => clearInterval(minuterie);
      },
    };
  }, [bridge, surVps, lieu]);
  const [etat, setEtat] = useState<EtatCoffre | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!pont) return;
    let actif = true;
    const relire = () =>
      void pont.etat().then((r) => {
        if (!actif) return;
        if (r.ok) {
          setEtat(r.data);
          setErreur(null);
        } else if (r.code === "serveur-ancien" && lieu) setAncien(lieu);
        else setErreur(r.message);
      });
    relire();
    const arreter = pont.surChangement(relire);
    return () => {
      actif = false;
      arreter();
    };
  }, [pont, lieu, revision]);

  /** Une action du main : son erreur à l'écran, ou ce qu'elle rend ; la liste suit par `coffre:change`. */
  const agir = useCallback(async <T,>(appel: Promise<Reponse<T>> | undefined): Promise<T | null> => {
    if (!appel) return null;
    const r = await appel;
    if (!r.ok) {
      setErreur(r.message);
      return null;
    }
    setErreur(null);
    setRevision((n) => n + 1);
    return r.data;
  }, []);

  return {
    disponible: !!pont,
    /** Le serveur dont c'est le coffre (null : ce PC). */
    lieu: surVps ? lieu : null,
    etat,
    erreur,
    effacerErreur: () => setErreur(null),
    ajouter: (e: EntreeSecretCoffre, remplacer = false) => agir(pont?.ajouter(e, remplacer)),
    modifier: (id: string, champs: Parameters<NonNullable<typeof pont>["modifier"]>[1]) => agir(pont?.modifier(id, champs)),
    remplacerValeur: (id: string, valeur: string) => agir(pont?.remplacerValeur(id, valeur)),
    retirer: (id: string) => agir(pont?.retirer(id)),
    copier: (id: string) => agir(pont?.copier(id)),
    /** Copie un secret de ce PC sur un serveur (rend `true`) ; la valeur ne passe pas par l'écran. */
    copierVers: async (id: string, adresse: string) => (await agir<void>(bridge?.copierVers?.(id, adresse))) !== null,
  };
}

/** Le secret du coffre qui porte ce nom de variable. */
export function secretDe(etat: EtatCoffre | null, variable: string): SecretCoffre | undefined {
  return etat?.secrets.find((s) => s.variable === variable);
}
