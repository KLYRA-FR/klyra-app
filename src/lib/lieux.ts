"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Chat, RoleId } from "@/types/domain";
import { CLE_CARNET, interroger, lireCarnet, retardDe, sondeDe, type Carnet, type ServeurConnu, type Sonde } from "./serveur-vps";

/**
 * Où tourne une conversation : ce PC (null) ou un VPS relié (son origine https).
 * Les VPS viennent du carnet de l'écran Serveurs. La machine active, choisie dans le sélecteur,
 * est l'espace affiché, comme dans OpenBot : ses conversations, ses projets et ses routines.
 * Ce qu'on crée y va. Une conversation ne change jamais de machine.
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

/** Le lieu retenu, même s'il n'est plus relié (un repli sur l'ordinateur se reconnaît ainsi). */
export function lieuRetenu(): string | null {
  try {
    return localStorage.getItem(CLE_LIEU);
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

/** Un élément (conversation, projet, routine) est-il dans l'espace de cette machine ? Ce PC : `null`. */
export function dansEspace(lieu: string | null | undefined, espace: string | null): boolean {
  return (lieu ?? null) === espace;
}

/** L'hôte d'un VPS, tel qu'il figure dans l'id d'une conversation directe (`dm-<agent>@<hôte>`). */
export function hoteDe(lieu: string): string {
  try {
    return new URL(lieu).host;
  } catch {
    return lieu;
  }
}

/** Le VPS relié qui a cet hôte ; à défaut, son adresse https. */
export function lieuDeHote(hote: string): string {
  return lire().find((s) => hoteDe(s.adresse) === hote)?.adresse ?? `https://${hote}`;
}

/** Préfixe des conversations directes : `dm-<agent>`, et `dm-<agent>@<hôte>` sur un VPS. */
export const DIRECT = "dm-";
/** `dm-<agent>@pc` : la conversation de ce PC quand `dm-<agent>` est restée à un VPS (avant l'espace par serveur). */
const SUR_PC = "pc";

/** L'agent et l'hôte (null : ce PC) qu'annonce l'id d'une conversation directe. */
export function lireIdDirect(id: string): { roleId: RoleId; hote: string | null } | null {
  if (!id.startsWith(DIRECT)) return null;
  const reste = id.slice(DIRECT.length);
  const at = reste.indexOf("@");
  if (at < 0) return { roleId: reste, hote: null };
  const hote = reste.slice(at + 1);
  return { roleId: reste.slice(0, at), hote: hote === SUR_PC ? null : hote };
}

/** La machine d'une conversation (null : ce PC) ; une directe pas encore enregistrée se lit à son id. */
export function lieuDeConversation(chats: readonly Chat[], id: string): string | null {
  const chat = chats.find((c) => c.id === id);
  if (chat) return chat.lieu ?? null;
  const hote = lireIdDirect(id)?.hote;
  return hote ? lieuDeHote(hote) : null;
}

/**
 * La conversation directe avec un agent dans l'espace d'une machine : une par agent et par serveur.
 * Celle qui existe est reprise, même sous un id d'avant (`dm-<agent>` restée sur un VPS). Sinon :
 * `dm-<agent>` sur ce PC, `dm-<agent>@<hôte>` sur un VPS, `dm-<agent>@pc` si l'id simple est pris.
 */
export function idDirect(roleId: RoleId, lieu: string | null = null, chats: readonly Chat[] = []): string {
  const existante = chats.find(
    (c) => c.kind === "direct" && !c.fil && lireIdDirect(c.id)?.roleId === roleId && dansEspace(c.lieu, lieu),
  );
  if (existante) return existante.id;
  if (lieu) return `${DIRECT}${roleId}@${hoteDe(lieu)}`;
  const simple = `${DIRECT}${roleId}`;
  return chats.some((c) => c.id === simple) ? `${simple}@${SUR_PC}` : simple;
}

export interface SondeServeur {
  sonde: Sonde;
  agents?: string;
  versionCode?: number;
  retard: boolean;
}

/** La dernière sonde de chaque VPS relié, relue chaque minute : un serveur mis à jour perd son avis tout seul. */
export function useSondes(serveurs: ServeurConnu[]): Record<string, SondeServeur> {
  const [sondes, setSondes] = useState<Record<string, SondeServeur>>({});
  useEffect(() => {
    const controle = new AbortController();
    const sonder = () => {
      for (const serveur of serveurs) {
        void interroger(serveur.adresse, controle.signal).then((lecture) => {
          if (controle.signal.aborted) return;
          setSondes((etat) => ({
            ...etat,
            [serveur.id]: { sonde: sondeDe(lecture), agents: lecture.ok ? lecture.agents : undefined, versionCode: lecture.ok ? lecture.versionCode : undefined, retard: retardDe(lecture) },
          }));
        });
      }
    };
    sonder();
    const minuteur = setInterval(sonder, 60_000);
    return () => {
      controle.abort();
      clearInterval(minuteur);
    };
  }, [serveurs]);
  return sondes;
}

/** Le nom à afficher pour un lieu. */
export function nomLieu(lieu: string | null | undefined, serveurs: ServeurConnu[]): string {
  if (!lieu) return "Ce PC";
  return serveurs.find((s) => s.adresse === lieu)?.nom ?? new URL(lieu).hostname.split(".")[0];
}
