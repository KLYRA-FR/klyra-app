"use client";

import { useEffect, useSyncExternalStore } from "react";
import { jetonAppareil } from "@/lib/serveur-vps";

/**
 * Voie directe du téléphone vers un VPS, quand l'ordinateur est fermé. D'habitude, le téléphone écrit
 * au compte et l'ordinateur relaie (M-3) ; mais une conversation qui tourne sur un VPS peut avancer
 * sans lui : le téléphone, relié à ce VPS (Plus › Serveurs), lui envoie le message et lit la réponse.
 * Le VPS garde la conversation et le texte du message avec la réponse : à sa réouverture, l'ordinateur
 * range l'échange dans la conversation (`electron/contexte-distant.ts`), puis le recopie dans le compte.
 * D'ici là, l'échange est gardé sur ce téléphone seulement.
 */

const CHEMIN_AGENT = "/klyra/v1/agent";
const CLE = "klyra:telephone:vps-direct";
/** Au-delà, un échange que le compte n'a toujours pas repris est oublié (le journal du VPS garde 24 h). */
const GARDE_MS = 24 * 60 * 60 * 1000;

export type Voie = "file" | "vps";

/** Ordinateur ouvert : il relaie, comme pour toute conversation. Fermé : le VPS directement, si ce téléphone y est relié. */
export function voieEnvoi({ posteOuvert, lieu, jeton }: { posteOuvert: boolean; lieu: string | null | undefined; jeton: string | null }): Voie {
  return !posteOuvert && lieu && jeton ? "vps" : "file";
}

export interface EchangeDirect {
  conversation: string;
  messageId: string;
  texte: string;
  creeLe: string;
  adresse: string;
  requestId: string;
  agentId: string;
  reponse: string;
  statut: "en-cours" | "fait" | "erreur";
  erreur: string | null;
  /** Une demande d'accord de l'agent, à laquelle le téléphone répond lui-même. */
  autorisation: { id: string; outil: string; description: string } | null;
}

type Evenement =
  | { type: "texte"; delta: string; nouveauBloc?: boolean }
  | { type: "autorisation"; id: string; outil: string; description?: string }
  | { type: "autorisation-fin"; id: string }
  | { type: "fin"; ok: boolean; texte: string; erreur?: string }
  | { type: string };

/** Un événement du VPS appliqué à l'échange (même suite d'événements que l'app de bureau). */
export function appliquerEvenement(echange: EchangeDirect, event: Evenement): EchangeDirect {
  if (event.type === "texte" && "delta" in event && typeof event.delta === "string") {
    const separe = event.nouveauBloc && echange.reponse ? "\n\n" : "";
    return { ...echange, reponse: echange.reponse + separe + event.delta };
  }
  if (event.type === "autorisation" && "id" in event && typeof event.id === "string") {
    const outil = "outil" in event && typeof event.outil === "string" ? event.outil : "outil";
    const description = "description" in event && typeof event.description === "string" ? event.description : "";
    return { ...echange, autorisation: { id: event.id, outil, description } };
  }
  if (event.type === "autorisation-fin" && "id" in event) {
    return echange.autorisation?.id === event.id ? { ...echange, autorisation: null } : echange;
  }
  if (event.type === "fin" && "ok" in event) {
    const reponse = typeof event.texte === "string" && event.texte ? event.texte : echange.reponse;
    if (event.ok) return { ...echange, statut: "fait", reponse, autorisation: null };
    const erreur = "erreur" in event && typeof event.erreur === "string" && event.erreur ? event.erreur : "L’agent s’est arrêté sur une erreur.";
    return { ...echange, statut: "erreur", erreur, reponse, autorisation: null };
  }
  return echange;
}

/* ─── Les échanges gardés sur ce téléphone ─────────────────────────── */

const abonnes = new Set<() => void>();
let cache: EchangeDirect[] | null = null;

function lire(): EchangeDirect[] {
  if (cache) return cache;
  try {
    const brut: unknown = JSON.parse(localStorage.getItem(CLE) ?? "[]");
    cache = Array.isArray(brut) ? (brut as EchangeDirect[]).filter((e) => Date.now() - Date.parse(e.creeLe) < GARDE_MS) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function ecrire(changer: (liste: EchangeDirect[]) => EchangeDirect[]) {
  cache = changer(lire());
  try {
    localStorage.setItem(CLE, JSON.stringify(cache));
  } catch {
    /* Sans stockage : l'échange vit le temps de la page. */
  }
  for (const abonne of abonnes) abonne();
}

function mettreAJour(requestId: string, changer: (echange: EchangeDirect) => EchangeDirect) {
  ecrire((liste) => liste.map((e) => (e.requestId === requestId ? changer(e) : e)));
}

const VIDE: EchangeDirect[] = [];

/**
 * Les échanges directs d'une conversation, tant que le compte ne les a pas repris : `repris` liste
 * les messages déjà copiés par l'ordinateur. Les réponses en cours sont suivies tant que l'écran est là.
 */
export function useEchangesDirects(conversation: string, repris: ReadonlySet<string>): EchangeDirect[] {
  const tous = useSyncExternalStore(
    (rappel) => {
      abonnes.add(rappel);
      return () => abonnes.delete(rappel);
    },
    lire,
    () => VIDE,
  );
  const enCours = tous.filter((e) => e.conversation === conversation && e.statut === "en-cours").map((e) => e.requestId).join(",");

  useEffect(() => {
    const arrets = enCours ? enCours.split(",").map((requestId) => suivre(requestId)) : [];
    return () => arrets.forEach((arret) => arret());
  }, [enCours]);

  useEffect(() => {
    if (tous.some((e) => repris.has(e.messageId))) ecrire((liste) => liste.filter((e) => !repris.has(e.messageId)));
  }, [tous, repris]);

  return tous.filter((e) => e.conversation === conversation && !repris.has(e.messageId));
}

/* ─── Les appels au VPS ────────────────────────────────────────────── */

const entetes = (jeton: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${jeton}` });

/**
 * Envoie le message au VPS. L'accès est « demander » : chaque outil attend l'accord donné ici,
 * le téléphone n'ouvre jamais plus de pouvoir qu'il n'en voit (M-13).
 */
export async function envoyerAuVps(p: {
  adresse: string;
  conversation: string;
  agentId: string;
  titre: string;
  texte: string;
  sessionId: string | null;
  modele: string | null;
  effort: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const jeton = jetonAppareil(p.adresse);
  if (!jeton) return { ok: false, message: "Ce téléphone n’est plus relié à ce VPS : relie-le dans Plus › Serveurs." };
  const echange: EchangeDirect = {
    conversation: p.conversation,
    messageId: `tel-${crypto.randomUUID()}`,
    texte: p.texte,
    creeLe: new Date().toISOString(),
    adresse: p.adresse,
    requestId: crypto.randomUUID(),
    agentId: p.agentId,
    reponse: "",
    statut: "en-cours",
    erreur: null,
    autorisation: null,
  };
  try {
    const reponse = await fetch(`${p.adresse}${CHEMIN_AGENT}/envoyer`, {
      method: "POST",
      headers: entetes(jeton),
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify({
        requestId: echange.requestId,
        options: {
          agent: p.agentId === "principal" ? null : p.agentId,
          prompt: p.texte,
          sessionId: p.sessionId,
          modele: p.modele,
          effort: p.effort,
          acces: "demander",
          dossier: null,
        },
        contexte: {
          chatId: p.conversation,
          agentId: p.agentId,
          titre: p.titre,
          telephone: { messageId: echange.messageId, texte: p.texte, creeLe: echange.creeLe },
        },
      }),
    });
    if (reponse.status === 401) return { ok: false, message: "Ce téléphone n’est plus relié à ce VPS : relie-le dans Plus › Serveurs." };
    if (reponse.status !== 202) return { ok: false, message: "Ce VPS ne sait pas encore recevoir les messages du téléphone : relance la commande d’installation pour le mettre à jour." };
  } catch {
    return { ok: false, message: "Le VPS ne répond pas. S’il est éteint, ou hors de ton réseau Tailscale, l’agent ne peut pas répondre." };
  }
  ecrire((liste) => [...liste, echange]);
  return { ok: true };
}

/** Suit la réponse en flux (événements de cette réponse seulement). Renvoie de quoi arrêter de suivre. */
function suivre(requestId: string): () => void {
  const echange = lire().find((e) => e.requestId === requestId);
  const jeton = echange ? jetonAppareil(echange.adresse) : null;
  if (!echange || !jeton) return () => undefined;
  const controle = new AbortController();
  void (async () => {
    try {
      const reponse = await fetch(`${echange.adresse}${CHEMIN_AGENT}/evenements?depuis=0&instance=&requete=${encodeURIComponent(requestId)}`, {
        headers: { Authorization: `Bearer ${jeton}` },
        signal: controle.signal,
        cache: "no-store",
      });
      if (!reponse.body) return;
      const lecteur = reponse.body.getReader();
      const decodeur = new TextDecoder();
      let tampon = "";
      let vus = 0;
      /* Le flux repart du début de la réponse à chaque suivi : on repart d'un échange vide. */
      mettreAJour(requestId, (e) => ({ ...e, reponse: "", autorisation: null }));
      for (;;) {
        const { value, done } = await lecteur.read();
        if (done) break;
        tampon += decodeur.decode(value, { stream: true });
        const blocs = tampon.split("\n\n");
        tampon = blocs.pop() ?? "";
        for (const bloc of blocs) {
          const donnees = bloc.split("\n").find((l) => l.startsWith("data: "));
          if (!donnees || bloc.startsWith("event: instance")) continue;
          const entree = JSON.parse(donnees.slice(6)) as { seq?: number; requestId?: string; event?: Evenement };
          if (entree.requestId !== requestId || !entree.event || (entree.seq ?? 0) <= vus) continue;
          vus = entree.seq ?? vus;
          const evenement = entree.event;
          mettreAJour(requestId, (e) => appliquerEvenement(e, evenement));
          if (evenement.type === "fin") {
            controle.abort();
            return;
          }
        }
      }
    } catch {
      /* Coupé (écran quitté, réseau) : le suivi reprend au prochain affichage. */
    }
  })();
  return () => controle.abort();
}

export async function autoriserVps(echange: EchangeDirect, decision: "oui" | "non"): Promise<boolean> {
  const jeton = jetonAppareil(echange.adresse);
  if (!jeton || !echange.autorisation) return false;
  try {
    const reponse = await fetch(`${echange.adresse}${CHEMIN_AGENT}/autoriser`, {
      method: "POST",
      headers: entetes(jeton),
      body: JSON.stringify({ requestId: echange.requestId, demandeId: echange.autorisation.id, decision }),
    });
    return reponse.ok;
  } catch {
    return false;
  }
}

export async function arreterVps(echange: EchangeDirect): Promise<boolean> {
  const jeton = jetonAppareil(echange.adresse);
  if (!jeton) return false;
  try {
    const reponse = await fetch(`${echange.adresse}${CHEMIN_AGENT}/annuler`, {
      method: "POST",
      headers: entetes(jeton),
      body: JSON.stringify({ requestId: echange.requestId }),
    });
    return reponse.ok;
  } catch {
    return false;
  }
}
