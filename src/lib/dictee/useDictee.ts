"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { getBridge, type CodeErreurDictee, type ProgressionDictee } from "@/lib/bridge";
import { poste } from "@/lib/plateforme";
import { ouvrirMicro, type Micro } from "./micro";
import type { Moteur, Rappels } from "./moteur";
import { MoteurElevenLabs } from "./moteur-elevenlabs";
import { MoteurLocal } from "./moteur-local";
import { niveau as niveauTrame } from "./segmenteur";

export type PhaseDictee = "repos" | "preparation" | "ecoute" | "finalisation";
export type MessageDictee = { ton: "erreur" | "info"; texte: string };
/** Le champ pendant la dictée : le texte jusqu'au provisoire, le provisoire (en gris), la suite. */
export type ZonesDictee = { avant: string; provisoire: string; apres: string };

/** Au-delà, la dictée s'arrête d'elle-même. */
const DUREE_MAX_MS = 5 * 60 * 1000;
/** L'audio gardé pendant qu'on passe d'ElevenLabs à l'ordinateur. */
const TAMPON_MAX = 300;

/** Une dictée en cours : ce qui l'entoure dans le champ, et ce qui a été dit. */
interface Session {
  avant: string;
  apres: string;
  dicte: string;
  provisoire: string;
  moteur: Moteur | null;
  /** Les trames reçues sans moteur (on bascule sur l'ordinateur). */
  tampon: Float32Array[];
  bascule: Promise<void> | null;
  micro: Micro | null;
  minuteurs: ReturnType<typeof setTimeout>[];
}

const joindre = (a: string, b: string) => (a && b ? (/\s$/.test(a) ? a + b : `${a} ${b}`) : a || b);

function zones(s: Session): ZonesDictee {
  const avant = joindre(s.avant, s.dicte);
  const provisoire = s.provisoire ? (avant && !/\s$/.test(avant) ? ` ${s.provisoire}` : s.provisoire) : "";
  const colle = !s.apres || !(s.dicte || s.provisoire) || /^[\s.,;:!?)\]]/.test(s.apres);
  return { avant, provisoire, apres: colle ? s.apres : ` ${s.apres}` };
}

function messageMicro(e: unknown): string {
  const nom = e instanceof DOMException ? e.name : "";
  if (nom === "NotAllowedError" || nom === "SecurityError") return "Micro refusé : autorise l’app dans les réglages du système.";
  return "Micro introuvable : branche-en un ou vérifie les réglages du son.";
}

/**
 * La dictée d'une zone de saisie : le texte s'écrit à l'endroit du curseur
 * pendant qu'on parle (provisoire en gris, puis définitif segment par
 * segment) ; le texte déjà saisi ne bouge pas. ElevenLabs si une clé est
 * enregistrée, sinon Whisper sur l'ordinateur ; si la connexion tombe en
 * route, la dictée continue sur l'ordinateur.
 */
export function useDictee({
  valeur,
  onChange,
  champRef,
}: {
  valeur: string;
  onChange: (valeur: string) => void;
  champRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [phase, setPhase] = useState<PhaseDictee>("repos");
  const [moteur, setMoteur] = useState<Moteur["nom"] | null>(null);
  const [niveau, setNiveau] = useState(0);
  const [secondes, setSecondes] = useState(0);
  const [preparation, setPreparation] = useState<ProgressionDictee | null>(null);
  const [message, setMessage] = useState<MessageDictee | null>(null);
  const [affichage, setAffichage] = useState<ZonesDictee | null>(null);

  const session = useRef<Session | null>(null);
  /* Les dernières valeurs, lues par les rappels des moteurs. */
  const valeurActuelle = useRef(valeur);
  const changer = useRef(onChange);
  useEffect(() => {
    valeurActuelle.current = valeur;
    changer.current = onChange;
  });

  /* Le curseur suit le texte dicté, une fois le champ à jour. */
  const curseur = useRef<{ valeur: string; position: number; focus: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = champRef.current;
    const c = curseur.current;
    if (!el || !c || el.value !== c.valeur) return;
    curseur.current = null;
    if (c.focus) el.focus();
    el.setSelectionRange(c.position, c.position);
    if (c.position >= c.valeur.length - 1) el.scrollTop = el.scrollHeight;
  });

  const publier = useCallback((s: Session, focus = false) => {
    const z = zones(s);
    const texte = z.avant + z.provisoire + z.apres;
    curseur.current = { valeur: texte, position: z.avant.length + z.provisoire.length, focus };
    setAffichage(z);
    changer.current(texte);
  }, []);

  const montrer = useCallback((m: MessageDictee) => {
    setMessage(m);
    setTimeout(() => setMessage((actuel) => (actuel === m ? null : actuel)), m.ton === "erreur" ? 7000 : 5000);
  }, []);

  /** Fin de la dictée : le provisoire restant est gardé, le curseur se place après le texte dicté. */
  const finir = useCallback(
    (s: Session, m?: MessageDictee) => {
      if (session.current !== s) return;
      session.current = null;
      s.micro?.arreter();
      s.minuteurs.forEach(clearTimeout);
      s.moteur?.annuler();
      s.dicte = joindre(s.dicte, s.provisoire);
      s.provisoire = "";
      publier(s, true);
      setAffichage(null);
      setPhase("repos");
      setMoteur(null);
      setNiveau(0);
      setPreparation(null);
      if (m) montrer(m);
    },
    [montrer, publier],
  );

  const demarrerLocal = useCallback(
    (s: Session, rappels: Rappels) => {
      const pont = getBridge()?.dictee;
      if (!pont) return;
      s.moteur = new MoteurLocal(pont, rappels, () => joindre(s.avant, s.dicte));
      for (const t of s.tampon) s.moteur.trame(t);
      s.tampon = [];
      setMoteur("local");
    },
    [],
  );

  /** ElevenLabs ne répond plus : le provisoire est gardé, et la suite se dicte sur l'ordinateur. */
  const secours = useCallback(
    async (s: Session, code: CodeErreurDictee, texte: string, rappels: Rappels) => {
      if (session.current !== s) return;
      const pont = getBridge()?.dictee;
      if (!pont || s.moteur?.nom === "local") return finir(s, { ton: "erreur", texte });
      s.moteur = null;
      s.dicte = joindre(s.dicte, s.provisoire);
      s.provisoire = "";
      publier(s);
      const etat = await pont.etat();
      const choisi = etat.ok ? etat.data.modeles.find((m) => m.id === etat.data.modele) : undefined;
      if (!choisi?.present) {
        const suite = code === "reseau" ? " Le modèle de l’ordinateur n’est pas encore téléchargé : la dictée s’arrête." : "";
        return finir(s, { ton: "erreur", texte: texte + suite });
      }
      montrer({ ton: "info", texte: `${texte} La dictée continue sur l’ordinateur.` });
      s.bascule = pont.preparer().then((r) => {
        if (session.current !== s) return;
        if (!r.ok) return finir(s, { ton: "erreur", texte: r.message });
        demarrerLocal(s, rappels);
      });
      await s.bascule;
    },
    [demarrerLocal, finir, montrer, publier],
  );

  const rappelsDe = useCallback(
    (s: Session): Rappels => {
      const rappels: Rappels = {
        partiel: (texte) => {
          if (session.current !== s) return;
          s.provisoire = texte.trim();
          publier(s);
        },
        definitif: (texte) => {
          if (session.current !== s) return;
          s.dicte = joindre(s.dicte, texte.trim());
          s.provisoire = "";
          publier(s);
        },
        erreur: (code, texte) => void secours(s, code, texte, rappels),
      };
      return rappels;
    },
    [publier, secours],
  );

  const arreter = useCallback(async () => {
    const s = session.current;
    if (!s || s.micro === null) return;
    s.micro.arreter();
    s.minuteurs.forEach(clearTimeout);
    setPhase("finalisation");
    setNiveau(0);
    await s.bascule;
    await s.moteur?.terminer();
    finir(s);
  }, [finir]);

  const commencer = useCallback(async () => {
    const bridge = getBridge();
    const pont = bridge?.dictee;
    if (!pont) return montrer({ ton: "erreur", texte: "La dictée marche dans l’app de bureau à jour." });
    setMessage(null);
    const acces = await bridge.systeme.micro?.();
    if (acces && (!acces.ok || !acces.data)) {
      return montrer({ ton: "erreur", texte: `L’app n’a pas accès au micro : ${poste.reglagesMicro}.` });
    }
    const etat = await pont.etat();
    if (!etat.ok) return montrer({ ton: "erreur", texte: etat.message });

    const el = champRef.current;
    const v = valeurActuelle.current;
    const position = el && document.activeElement === el ? el.selectionEnd : v.length;
    const s: Session = { avant: v.slice(0, position), apres: v.slice(position), dicte: "", provisoire: "", moteur: null, tampon: [], bascule: null, micro: null, minuteurs: [] };
    session.current = s;
    const rappels = rappelsDe(s);

    if (etat.data.cleElevenLabs && navigator.onLine) {
      s.moteur = new MoteurElevenLabs(pont, rappels);
      setMoteur("elevenlabs");
    } else {
      if (etat.data.cleElevenLabs) montrer({ ton: "info", texte: "Pas de connexion : la dictée se fait sur l’ordinateur." });
      if (!etat.data.pret) {
        setPreparation(null);
        setPhase("preparation");
        const r = await pont.preparer();
        if (session.current !== s) return;
        if (!r.ok) return finir(s, { ton: "erreur", texte: r.message });
        // « Dictée prête » le temps d'un regard, puis on écoute.
        await new Promise((ok) => setTimeout(ok, 600));
        if (session.current !== s) return;
      }
      demarrerLocal(s, rappels);
    }

    let micro: Micro;
    try {
      micro = await ouvrirMicro((trame) => {
        if (session.current !== s || s.micro === null) return;
        setNiveau(Math.min(1, niveauTrame(trame) * 10));
        if (s.moteur) s.moteur.trame(trame);
        else if (s.tampon.length < TAMPON_MAX) s.tampon.push(trame);
      });
    } catch (e) {
      return finir(s, { ton: "erreur", texte: messageMicro(e) });
    }
    if (session.current !== s) return micro.arreter();
    s.micro = micro;
    setPreparation(null);
    setSecondes(0);
    setPhase("ecoute");
    s.minuteurs.push(setInterval(() => setSecondes((n) => n + 1), 1000), setTimeout(() => void arreter(), DUREE_MAX_MS));
    publier(s, true);
  }, [arreter, champRef, demarrerLocal, finir, montrer, publier, rappelsDe]);

  /* La progression du téléchargement et du chargement du modèle. */
  useEffect(() => getBridge()?.dictee?.onProgression((p) => session.current && setPreparation(p)), []);

  /* On quitte l'écran en pleine dictée : le micro se coupe, le texte reste. */
  useEffect(
    () => () => {
      const s = session.current;
      session.current = null;
      s?.micro?.arreter();
      s?.minuteurs.forEach(clearTimeout);
      s?.moteur?.annuler();
    },
    [],
  );

  /** Fermer la fenêtre de préparation : le téléchargement continue en coulisse. */
  const annulerPreparation = useCallback(() => {
    const s = session.current;
    if (!s || phase !== "preparation") return;
    session.current = null;
    setPhase("repos");
    setPreparation(null);
    setMoteur(null);
  }, [phase]);

  const basculer = useCallback(() => {
    if (phase === "repos") void commencer();
    else if (phase === "ecoute") void arreter();
  }, [arreter, commencer, phase]);

  /** Au survol du micro : le modèle local déjà téléchargé se charge en avance. */
  const prechauffe = useRef(false);
  const prechauffer = useCallback(() => {
    if (prechauffe.current) return;
    prechauffe.current = true;
    void getBridge()?.dictee?.prechauffer();
  }, []);

  return { phase, moteur, niveau, secondes, preparation, message, zones: affichage, basculer, arreter, annulerPreparation, prechauffer };
}

export type Dictee = ReturnType<typeof useDictee>;
