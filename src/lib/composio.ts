"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBridge, type EtatComposio, type KlyraBridge, type Reponse } from "./bridge";
import { useCompte } from "./compte";

type Pont = NonNullable<KlyraBridge["composio"]>;
type Vue = { scope: string; etat: EtatComposio | null; erreur: string | null };

/** Pas de cache disque : une réponse ancienne n'est jamais montrée sous une autre identité. */
export function useComposio() {
  const pont = getBridge()?.composio;
  const compte = useCompte();
  const scope = `${compte.etat}:${compte.moi?._id ?? "local"}`;
  const [vue, setVue] = useState<Vue | null>(null);
  const [chargement, setChargement] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState<{ scope: string; texte: string } | null>(null);
  const [echec, setEchec] = useState<{ scope: string; nom: string; texte: string } | null>(null);
  const lecture = useRef(0);
  const scopeActif = useRef(scope);
  const verrou = useRef(false);
  const dernierFocus = useRef(0);
  const etat = vue?.scope === scope ? vue.etat : null;
  const erreur = vue?.scope === scope ? vue.erreur : null;
  useEffect(() => {
    scopeActif.current = scope;
    return () => { scopeActif.current = ""; };
  }, [scope]);

  const actualiser = useCallback(async (): Promise<EtatComposio | null> => {
    if (!pont || scopeActif.current !== scope) return null;
    const id = ++lecture.current;
    setChargement(true);
    try {
      const r = await pont.etat();
      if (id !== lecture.current || scopeActif.current !== scope) return null;
      setVue({ scope, etat: r.ok ? r.data : null, erreur: r.ok ? r.data.erreur?.message ?? null : r.message });
      return r.ok ? r.data : null;
    } catch {
      if (id === lecture.current && scopeActif.current === scope) setVue({ scope, etat: null, erreur: "L’espace Composio ne répond pas. Actualise pour réessayer." });
      return null;
    } finally { if (id === lecture.current && scopeActif.current === scope) setChargement(false); }
  }, [pont, scope]);

  useEffect(() => {
    const debut = window.setTimeout(() => void actualiser(), 0);
    return () => window.clearTimeout(debut);
  }, [actualiser]);

  useEffect(() => {
    const retour = () => {
      if (verrou.current || Date.now() - dernierFocus.current < 10_000) return;
      dernierFocus.current = Date.now();
      void actualiser();
    };
    window.addEventListener("focus", retour);
    window.addEventListener("online", retour);
    return () => { window.removeEventListener("focus", retour); window.removeEventListener("online", retour); };
  }, [actualiser]);

  const faire = useCallback(async <T,>(nom: string, operation: (p: Pont, contexte: string) => Promise<Reponse<T>>, annonce = ""): Promise<T | null> => {
    if (!pont || !etat || verrou.current) return null;
    verrou.current = true;
    setAction(nom);
    setAnnonce(null);
    setEchec(null);
    try {
      const r = await operation(pont, etat.contexte);
      if (scopeActif.current !== scope) return null;
      await actualiser();
      if (scopeActif.current !== scope) return null;
      if (!r.ok) {
        setVue((v) => v?.scope === scope ? { ...v, erreur: r.message } : v);
        setEchec({ scope, nom, texte: r.message });
        return null;
      }
      setAnnonce({ scope, texte: annonce });
      return r.data;
    } catch {
      await actualiser();
      if (scopeActif.current !== scope) return null;
      const texte = "L’action Composio n’a pas été confirmée. Actualise avant de réessayer.";
      setVue((v) => v?.scope === scope ? { ...v, erreur: texte } : v);
      setEchec({ scope, nom, texte });
      return null;
    } finally {
      verrou.current = false;
      setAction(null);
    }
  }, [pont, etat, actualiser, scope]);

  return { bureau: !!pont, scope, etat, erreur, echec: echec?.scope === scope ? echec : null, chargement: chargement || (!!pont && vue?.scope !== scope), action, message: annonce?.scope === scope ? annonce.texte : "", actualiser, faire,
    console: async () => { await pont?.console(); },
  };
}

export type ComposioApiInterface = ReturnType<typeof useComposio>;
