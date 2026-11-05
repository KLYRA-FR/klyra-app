"use client";

import { useEffect, useRef, type RefObject } from "react";
import { getBridge } from "@/lib/bridge";
import { changements, elementsDuServeur, fusionner, memoDe, paquets, type EtatEspace, type LectureEspace } from "@/lib/espace-sync";
import { useServeursRelies } from "@/lib/lieux";

/** Un serveur est relu à ce rythme, pour ce qu'un autre appareil y a écrit. */
const RELECTURE_MS = 60_000;
/** Regroupe les écritures : une réponse en cours n'envoie rien, et le reste part à ce rythme au plus. */
const ENVOI_MS = 3_000;
/** Au-delà, l'élément reste sur ce PC : le serveur refuserait le corps entier. */
const ELEMENT_MAX = 15_000_000;

type Etat = EtatEspace & { travail: Record<string, unknown>; charge: boolean };

/**
 * Chaque VPS garde son espace (serveur/espace.mjs). L'app le relit au démarrage, y envoie ce qui change, et
 * garde sa copie dans `conversations.json` : un serveur qui ne répond pas ne fait rien perdre. Le premier
 * passage y envoie tout ce que ce PC avait pour lui. Un serveur pas à jour ne le connaît pas : rien ne change.
 */
export function useEspaceServeurs(state: Etat, stateRef: RefObject<Etat>, fusionnerEtat: (etat: EtatEspace) => void) {
  const serveurs = useServeursRelies();
  const memos = useRef(new Map<string, Map<string, string>>());
  const revisions = useRef(new Map<string, number>());
  const anciens = useRef(new Set<string>());
  const enCours = useRef(new Set<string>());
  const pret = state.charge;

  const travaille = (id: string) => !!stateRef.current.travail[id];

  const envoyer = useRef(async (lieu: string) => {
    const pont = getBridge()?.espace;
    const memo = memos.current.get(lieu);
    if (!pont || !memo || enCours.current.has(lieu)) return;
    const { elements } = elementsDuServeur(stateRef.current, lieu, travaille);
    const envoyables = elements.filter((e) => (JSON.stringify(e.valeur)?.length ?? 0) <= ELEMENT_MAX);
    const { aEcrire, aRetirer, suivant } = changements(envoyables, memo);
    if (!aEcrire.length && !aRetirer.length) return;
    enCours.current.add(lieu);
    try {
      const lots = paquets(aEcrire);
      let revision: number | null = null;
      for (let i = 0; i < Math.max(1, lots.length); i++) {
        const r = await pont.ecrire(lieu, { elements: lots[i] ?? [], supprimes: i === 0 ? aRetirer : [] });
        /* Le mémo ne bouge pas : tout repartira au prochain essai. */
        if (!r.ok) return;
        revision = r.data.revision;
      }
      memos.current.set(lieu, suivant);
      if (revision !== null) revisions.current.set(lieu, revision);
    } finally {
      enCours.current.delete(lieu);
    }
  });

  const lire = useRef(async (lieu: string) => {
    const pont = getBridge()?.espace;
    if (!pont || anciens.current.has(lieu) || enCours.current.has(lieu)) return;
    const r = await pont.lire(lieu, revisions.current.get(lieu));
    if (!r.ok) {
      if (r.code === "serveur-ancien") anciens.current.add(lieu);
      return;
    }
    const lu = r.data as LectureEspace;
    if (!lu.inchange) {
      fusionnerEtat(fusionner(stateRef.current, lu, lieu, travaille));
      memos.current.set(lieu, memoDe(lu.elements ?? []));
      revisions.current.set(lieu, lu.revision);
    }
    await envoyer.current(lieu);
  });

  /* La lecture au démarrage et à l'arrivée d'un serveur, puis régulière. */
  const adresses = serveurs.map((s) => s.adresse).join("\n");
  useEffect(() => {
    if (!pret || !adresses) return;
    const liste = adresses.split("\n");
    for (const lieu of liste) void lire.current(lieu);
    const minuterie = setInterval(() => {
      for (const lieu of liste) void lire.current(lieu);
    }, RELECTURE_MS);
    return () => clearInterval(minuterie);
  }, [pret, adresses]);

  /* L'envoi de ce qui change : une seule attente à la fois, qu'une réponse en cours ne repousse pas sans fin. */
  const attente = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!pret || !adresses || attente.current) return;
    attente.current = setTimeout(() => {
      attente.current = null;
      for (const lieu of adresses.split("\n")) void envoyer.current(lieu);
    }, ENVOI_MS);
  }, [pret, adresses, state.chats, state.messages, state.projects, state.workflows, state.executions, state.rendus, state.travail]);

  useEffect(
    () => () => {
      if (attente.current) clearTimeout(attente.current);
      attente.current = null;
    },
    [],
  );
}
