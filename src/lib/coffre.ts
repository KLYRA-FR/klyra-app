"use client";

import { useCallback, useEffect, useState } from "react";
import { getBridge, type EntreeSecretCoffre, type EtatCoffre, type Reponse, type SecretCoffre } from "@/lib/bridge";

export * from "../../electron/coffre-regles";

/**
 * Le Coffre de KLYRA côté écran (cf. electron/coffre.ts) : la liste des secrets et des connexions,
 * relue quand le main dit qu'elle a changé (un agent y a rangé un secret). L'écran n'a jamais une
 * valeur : il en envoie une quand la personne la tape ou la colle, et « Copier » passe par le main.
 */
export function useCoffreKlyra() {
  const pont = getBridge()?.coffre;
  const [etat, setEtat] = useState<EtatCoffre | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!pont) return;
    let actif = true;
    const relire = () =>
      void pont.etat().then((r) => {
        if (actif && r.ok) setEtat(r.data);
      });
    relire();
    const arreter = pont.surChangement(relire);
    return () => {
      actif = false;
      arreter();
    };
  }, [pont]);

  /** Une action du main : son erreur à l'écran, ou ce qu'elle rend ; la liste suit par `coffre:change`. */
  const agir = useCallback(async <T,>(appel: Promise<Reponse<T>> | undefined): Promise<T | null> => {
    if (!appel) return null;
    const r = await appel;
    if (!r.ok) {
      setErreur(r.message);
      return null;
    }
    setErreur(null);
    return r.data;
  }, []);

  return {
    disponible: !!pont,
    etat,
    erreur,
    effacerErreur: () => setErreur(null),
    ajouter: (e: EntreeSecretCoffre, remplacer = false) => agir(pont?.ajouter(e, remplacer)),
    modifier: (id: string, champs: Parameters<NonNullable<typeof pont>["modifier"]>[1]) => agir(pont?.modifier(id, champs)),
    remplacerValeur: (id: string, valeur: string) => agir(pont?.remplacerValeur(id, valeur)),
    retirer: (id: string) => agir(pont?.retirer(id)),
    copier: (id: string) => agir(pont?.copier(id)),
  };
}

/** Le secret du coffre qui porte ce nom de variable. */
export function secretDe(etat: EtatCoffre | null, variable: string): SecretCoffre | undefined {
  return etat?.secrets.find((s) => s.variable === variable);
}
