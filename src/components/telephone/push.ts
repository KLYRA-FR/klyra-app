"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { EvenementPush, PreferencesPush } from "../../../convex/model/push";
import { useCompte } from "@/lib/compte";
import { champsAbonnement, cleEnOctets, etatNavigateur, lireNavigateur, type EtatNavigateur } from "@/lib/push";

/** Le service worker de l'app web (`public/sw.js`), enregistré par la coque, jamais dans Electron. */
export const SERVICE_WORKER = "/sw.js";

export type EtatPush =
  | { etat: "chargement" }
  /** Le compte n'a pas de clés VAPID : rien ne part. */
  | { etat: "sans-cles" }
  | { etat: Exclude<EtatNavigateur, "accordee"> }
  /** Autorisé par le système, pas encore abonné pour cette session. */
  | { etat: "a-activer" }
  | { etat: "active"; preferences: PreferencesPush; ouverturesAttendues: string[] };

async function inscription(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register(SERVICE_WORKER, { scope: "/", updateViaCache: "none" }));
}

/**
 * Les notifications de ce téléphone : l'état, l'abonnement (la demande d'autorisation du système
 * se fait ici, au premier besoin, jamais à l'ouverture), les choix par événement.
 */
export function usePushTelephone() {
  const { etat: compte } = useCompte();
  const connecte = compte === "connecte";
  const cle = useQuery(api.notificationsPush.clePublique, connecte ? {} : "skip");
  const abonnement = useQuery(api.notificationsPush.monAbonnement, connecte ? {} : "skip");
  const sAbonner = useMutation(api.notificationsPush.sAbonner);
  const seDesabonner = useMutation(api.notificationsPush.seDesabonner);
  const changerPreference = useMutation(api.notificationsPush.changerPreference);
  const attendre = useMutation(api.notificationsPush.attendreOuverture);
  const [navigateur, setNavigateur] = useState<EtatNavigateur | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  /* La permission se relit au retour dans l'app (changée dans les réglages du téléphone). */
  useEffect(() => {
    const lire = () => setNavigateur(etatNavigateur(lireNavigateur()));
    lire();
    document.addEventListener("visibilitychange", lire);
    return () => document.removeEventListener("visibilitychange", lire);
  }, []);

  let etat: EtatPush;
  if (cle === undefined || abonnement === undefined || navigateur === null) etat = { etat: "chargement" };
  else if (cle === null) etat = { etat: "sans-cles" };
  else if (navigateur !== "accordee" && navigateur !== "a-demander") etat = { etat: navigateur };
  else if (navigateur === "accordee" && abonnement) etat = { etat: "active", preferences: abonnement.preferences, ouverturesAttendues: abonnement.ouverturesAttendues };
  else etat = { etat: navigateur === "accordee" ? "a-activer" : "a-demander" };

  /** Demande l'autorisation du système si besoin, abonne ce navigateur et cette session. */
  const activer = useCallback(async (): Promise<boolean> => {
    if (!cle) return false;
    setOccupe(true);
    setErreur(null);
    try {
      const permission = await Notification.requestPermission();
      setNavigateur(etatNavigateur(lireNavigateur()));
      if (permission !== "granted") return false;
      const sw = await inscription();
      await navigator.serviceWorker.ready;
      const existant = await sw.pushManager.getSubscription();
      const navigateurAbonne = existant ?? (await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleEnOctets(cle) }));
      const champs = champsAbonnement(navigateurAbonne);
      if (!champs) throw new Error("abonnement");
      await sAbonner(champs);
      return true;
    } catch {
      setErreur("L’activation n’a pas abouti. Réessaie dans un instant.");
      return false;
    } finally {
      setOccupe(false);
    }
  }, [cle, sAbonner]);

  const couper = useCallback(async () => {
    setOccupe(true);
    setErreur(null);
    try {
      const sw = await navigator.serviceWorker.getRegistration("/");
      await (await sw?.pushManager.getSubscription())?.unsubscribe();
      await seDesabonner({});
    } catch {
      setErreur("Les notifications n’ont pas pu être coupées. Réessaie dans un instant.");
    } finally {
      setOccupe(false);
    }
  }, [seDesabonner]);

  const changer = useCallback(
    async (evenement: EvenementPush, actif: boolean) => {
      setErreur(null);
      try {
        await changerPreference({ evenement, actif });
      } catch {
        setErreur("Ce choix n’a pas été enregistré. Réessaie dans un instant.");
      }
    },
    [changerPreference],
  );

  /** « Me prévenir à l'ouverture » : abonne d'abord ce téléphone s'il ne l'est pas. */
  const attendreOuverture = useCallback(
    async (clePoste: string): Promise<boolean> => {
      if (!abonnement && !(await activer())) return false;
      setErreur(null);
      try {
        await attendre({ cle: clePoste });
        return true;
      } catch {
        setErreur("La demande n’a pas été enregistrée. Réessaie dans un instant.");
        return false;
      }
    },
    [abonnement, activer, attendre],
  );

  return { etat, occupe, erreur, activer, couper, changer, attendreOuverture };
}

/**
 * À l'ouverture de l'app, sans rien demander : un abonnement renouvelé par le navigateur, ou une
 * nouvelle session sur un téléphone déjà autorisé, est redonné au compte.
 */
export function useSynchroPush() {
  const { etat } = useCompte();
  const connecte = etat === "connecte";
  const cle = useQuery(api.notificationsPush.clePublique, connecte ? {} : "skip");
  const abonnement = useQuery(api.notificationsPush.monAbonnement, connecte ? {} : "skip");
  const sAbonner = useMutation(api.notificationsPush.sAbonner);
  const endpoint = abonnement?.endpoint ?? null;
  const charge = abonnement !== undefined;

  useEffect(() => {
    if (!cle || !charge || etatNavigateur(lireNavigateur()) !== "accordee") return;
    let arrete = false;
    void (async () => {
      try {
        const sw = await navigator.serviceWorker.getRegistration("/");
        const actuel = await sw?.pushManager.getSubscription();
        const champs = actuel ? champsAbonnement(actuel) : null;
        if (!arrete && champs && champs.endpoint !== endpoint) await sAbonner(champs);
      } catch {
        /* La prochaine ouverture réessaie. */
      }
    })();
    return () => {
      arrete = true;
    };
  }, [cle, charge, endpoint, sAbonner]);
}
