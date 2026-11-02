"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Chat } from "@/types/domain";
import { CLE_CARNET, interroger, lireCarnet, sondeDe, type Carnet, type ServeurConnu, type Sonde } from "./serveur-vps";

/**
 * Où tourne une conversation : ce PC (null) ou un VPS relié (son origine https).
 * Les VPS viennent du carnet de l'écran Serveurs. La machine active, choisie dans le sélecteur
 * du rail, sert aux conversations directes et aux nouveaux projets, routines et conversations.
 */

const CLE_LIEU = "klyra:lieu-actif";
const EVENEMENT = "klyra:carnet";
const EVENEMENT_LIEU = "klyra:lieu-actif";

const abonnes = new Set<() => void>();
let instantane: ServeurConnu[] | null = null;
let brut: string | null = null;

function lire(): ServeurConnu[] {
  let texte: string | null = null;
  try {
    texte = localStorage.getItem(CLE_CARNET);
  } catch {
    texte = null;
  }
  if (instantane && texte === brut) return instantane;
  brut = texte;
  instantane = lireCarnet(texte).liste.filter((s) => s.etat === "joint");
  return instantane;
}

function abonner(rappel: () => void) {
  abonnes.add(rappel);
  const surStockage = (e: StorageEvent) => e.key === CLE_CARNET && rappel();
  window.addEventListener(EVENEMENT, rappel);
  window.addEventListener("storage", surStockage);
  return () => {
    abonnes.delete(rappel);
    window.removeEventListener(EVENEMENT, rappel);
    window.removeEventListener("storage", surStockage);
  };
}

/** À appeler après chaque écriture du carnet. */
export function signalerCarnet() {
  window.dispatchEvent(new Event(EVENEMENT));
}

/** Change le carnet hors de l'écran Serveurs (le sélecteur du rail) ; l'écran le relit. */
export function modifierCarnet(changer: (carnet: Carnet) => Carnet) {
  try {
    localStorage.setItem(CLE_CARNET, JSON.stringify(changer(lireCarnet(localStorage.getItem(CLE_CARNET)))));
  } catch {
    return;
  }
  signalerCarnet();
}

const VIDE: ServeurConnu[] = [];

/** Les VPS reliés (pas ceux qu'on a quittés). */
export function useServeursRelies(): ServeurConnu[] {
  return useSyncExternalStore(abonner, lire, () => VIDE);
}

/** Le lieu des nouvelles conversations : le dernier choisi, s'il est encore relié. */
export function lieuParDefaut(): string | null {
  try {
    const lieu = localStorage.getItem(CLE_LIEU);
    return lieu && lire().some((s) => s.adresse === lieu) ? lieu : null;
  } catch {
    return null;
  }
}

export function retenirLieu(lieu: string | null) {
  try {
    if (lieu) localStorage.setItem(CLE_LIEU, lieu);
    else localStorage.removeItem(CLE_LIEU);
  } catch {
    /* Sans stockage, les nouvelles conversations restent sur ce PC. */
  }
  window.dispatchEvent(new Event(EVENEMENT_LIEU));
}

function abonnerLieu(rappel: () => void) {
  const arreter = abonner(rappel);
  const surStockage = (e: StorageEvent) => e.key === CLE_LIEU && rappel();
  window.addEventListener(EVENEMENT_LIEU, rappel);
  window.addEventListener("storage", surStockage);
  return () => {
    arreter();
    window.removeEventListener(EVENEMENT_LIEU, rappel);
    window.removeEventListener("storage", surStockage);
  };
}

/** La machine active (null : ce PC), celle du sélecteur du rail. */
export function useLieuActif(): string | null {
  return useSyncExternalStore(abonnerLieu, lieuParDefaut, () => null);
}

/** La clé d'une machine dans `Chat.sessionsParLieu`. */
function cleLieu(lieu: string | null): string {
  return lieu ?? "pc";
}

/**
 * La conversation passe sur une autre machine. Une session n'existe que là où elle a été créée :
 * celles d'ici restent de côté, celles que la conversation avait laissées là-bas reviennent.
 */
export function changerDeLieu(chat: Chat, lieu: string | null): Chat {
  const avant = chat.lieu ?? null;
  if (avant === lieu) return chat;
  const { [cleLieu(lieu)]: reprises = {}, ...autres } = chat.sessionsParLieu ?? {};
  const laissees = Object.keys(chat.sessions).length ? { ...autres, [cleLieu(avant)]: chat.sessions } : autres;
  const suivant: Chat = { ...chat, lieu, sessions: reprises, sessionsParLieu: laissees };
  if (!Object.keys(laissees).length) delete suivant.sessionsParLieu;
  return suivant;
}

/** La dernière sonde de chaque VPS relié, relue quand la liste change (Réglages › Mobile, Ce téléphone). */
export function useSondes(serveurs: ServeurConnu[]): Record<string, { sonde: Sonde; agents?: string }> {
  const [sondes, setSondes] = useState<Record<string, { sonde: Sonde; agents?: string }>>({});
  useEffect(() => {
    const controle = new AbortController();
    for (const serveur of serveurs) {
      void interroger(serveur.adresse, controle.signal).then((lecture) => {
        if (controle.signal.aborted) return;
        setSondes((etat) => ({ ...etat, [serveur.id]: { sonde: sondeDe(lecture), agents: lecture.ok ? lecture.agents : undefined } }));
      });
    }
    return () => controle.abort();
  }, [serveurs]);
  return sondes;
}

/** Le nom à afficher pour un lieu. */
export function nomLieu(lieu: string | null | undefined, serveurs: ServeurConnu[]): string {
  if (!lieu) return "Ce PC";
  return serveurs.find((s) => s.adresse === lieu)?.nom ?? new URL(lieu).hostname.split(".")[0];
}
