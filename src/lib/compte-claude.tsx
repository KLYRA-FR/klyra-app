"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getBridge, type CompteClaude, type CompteClaudeLocal } from "@/lib/bridge";

/**
 * Le compte Claude du poste : connecté ou non, quel compte, quel abonnement.
 * Vérifié à l'ouverture, puis quand on revient sur l'app (au plus toutes les
 * 5 min). Sans l'app de bureau, il n'y a pas de compte à lire.
 */

interface CompteApi {
  /** Faux dans un navigateur : rien à lire. */
  disponible: boolean;
  compte: CompteClaude | null;
  /** Une connexion ou une déconnexion est en cours. */
  action: "connexion" | "deconnexion" | null;
  erreur: string | null;
  verifier: () => Promise<void>;
  connecter: () => Promise<void>;
  deconnecter: () => Promise<void>;
}

const CompteContext = createContext<CompteApi | null>(null);

const REVERIFIER_MS = 5 * 60_000;

export function CompteClaudeProvider({ children }: { children: ReactNode }) {
  const bridge = getBridge();
  const [compte, setCompte] = useState<CompteClaude | null>(null);
  const [action, setAction] = useState<CompteApi["action"]>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const verifier = useCallback(async () => {
    if (!bridge) return;
    const r = await bridge.claude.compte();
    if (r.ok) setCompte(r.data);
    else setErreur(r.message);
  }, [bridge]);

  /* Première lecture, à l'ouverture. */
  useEffect(() => {
    if (!bridge) return;
    let actif = true;
    void bridge.claude.compte().then((r) => {
      if (!actif) return;
      if (r.ok) setCompte(r.data);
      else setErreur(r.message);
    });
    return () => {
      actif = false;
    };
  }, [bridge]);

  /* Retour sur l'app : on revérifie si la dernière lecture date un peu. */
  useEffect(() => {
    if (!bridge) return;
    const auRetour = () => {
      if (document.visibilityState === "visible" && (!compte || Date.now() - compte.verifieLe > REVERIFIER_MS)) {
        void verifier();
      }
    };
    document.addEventListener("visibilitychange", auRetour);
    return () => document.removeEventListener("visibilitychange", auRetour);
  }, [bridge, compte, verifier]);

  const executer = useCallback(
    async (quoi: "connexion" | "deconnexion") => {
      if (!bridge) return;
      setAction(quoi);
      setErreur(null);
      const r = await (quoi === "connexion" ? bridge.claude.connexion() : bridge.claude.deconnexion());
      if (r.ok) {
        setCompte(r.data);
        if (quoi === "connexion" && !r.data.connecte) setErreur("La connexion n’a pas abouti. Réessaie depuis la page qui s’est ouverte.");
      } else {
        setErreur(r.message);
      }
      setAction(null);
    },
    [bridge],
  );

  const value = useMemo<CompteApi>(
    () => ({
      disponible: !!bridge,
      compte,
      action,
      erreur,
      verifier,
      connecter: () => executer("connexion"),
      deconnecter: () => executer("deconnexion"),
    }),
    [bridge, compte, action, erreur, verifier, executer],
  );
  return <CompteContext.Provider value={value}>{children}</CompteContext.Provider>;
}

export function useCompteClaude(): CompteApi {
  const ctx = useContext(CompteContext);
  if (!ctx) throw new Error("useCompteClaude doit être utilisé dans <CompteClaudeProvider>");
  return ctx;
}

/** La liste des connexions ; le hook historique reste exclusivement celui des agents. */
export function useComptesClaude() {
  const pont = getBridge()?.claude;
  const { verifier: verifierPoste } = useCompteClaude();
  const [comptes, setComptes] = useState<CompteClaudeLocal[] | null>(null);
  const [action, setAction] = useState<{ id: string; type: "connexion" | "deconnexion" | "verification" } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const occupe = useRef(false);
  const generation = useRef(0);

  const relire = useCallback(async () => {
    if (!pont?.comptes || occupe.current) return;
    const lecture = ++generation.current;
    try {
      const r = await pont.comptes();
      if (lecture !== generation.current) return;
      if (r.ok) { setComptes(r.data); setErreur(null); }
      else setErreur(r.message);
    } catch {
      if (lecture === generation.current) setErreur("Impossible de lire les comptes Claude. Réessaie.");
    }
  }, [pont]);

  useEffect(() => {
    let actif = true;
    const lectures = generation;
    void Promise.resolve().then(() => { if (actif) return relire(); });
    return () => { actif = false; lectures.current++; };
  }, [relire]);

  const agir = useCallback(async (type: "connexion" | "deconnexion" | "verification", id?: string) => {
    if (!pont || occupe.current) return;
    occupe.current = true;
    generation.current++;
    setAction({ id: id ?? "nouveau", type });
    setErreur(null);
    try {
      const r = type === "connexion" ? await pont.connecterCompte!(id)
        : type === "deconnexion" ? await pont.deconnecterCompte!(id!) : await pont.verifierCompte!(id!);
      if (r.ok) {
        setComptes((avant) => [...(avant ?? []).filter((c) => c.id !== r.data.id), r.data].sort((a, b) => Number(b.poste) - Number(a.poste)));
        if (r.data.poste) await verifierPoste();
      } else setErreur(r.message);
    } catch {
      setErreur("L’action sur ce compte Claude a échoué. Réessaie.");
    } finally {
      occupe.current = false;
      setAction(null);
    }
  }, [pont, verifierPoste]);

  return { comptes, action, erreur, relire, agir };
}

/** « Max », « Pro »… : le nom de l'abonnement, tel qu'Anthropic l'affiche. */
export function nomAbonnement(abonnement: string | null): string | null {
  if (!abonnement) return null;
  const noms: Record<string, string> = { max: "Max", pro: "Pro", team: "Team", enterprise: "Enterprise", free: "Gratuit" };
  return noms[abonnement] ?? abonnement.charAt(0).toUpperCase() + abonnement.slice(1);
}
