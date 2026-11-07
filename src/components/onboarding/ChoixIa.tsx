"use client";

import { useEffect, useRef, useState } from "react";
import { getBridge, unwrap, type ProgressionMoteur } from "@/lib/bridge";
import { actualiserMoteurs, pret, useMoteurs } from "@/lib/moteurs";

import { VueChoixIa, type ChoixIaProps } from "./VueChoixIa";
import { TestChoixIa } from "./TestChoixIa";

export function ChoixIa({ simulation, ...props }: ChoixIaProps & { simulation?: boolean }) {
  return simulation ? <TestChoixIa {...props} /> : <ChoixIaReelle {...props} />;
}

function ChoixIaReelle({ choix, choisir, continuer, erreurExterne }: ChoixIaProps) {
  const { moteurs, erreur: lecture, actualiser } = useMoteurs(null);
  const [action, setAction] = useState<"installation" | "connexion" | "verification" | null>(null);
  const [progression, setProgression] = useState<ProgressionMoteur | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [cle, setCle] = useState("");
  const vivant = useRef(true);
  const occupe = useRef(false);
  const courant = moteurs?.find((m) => m.moteur.id === choix);
  const installe = !!courant?.moteur.chemin;
  const disponible = courant ? pret(courant) : false;
  useEffect(() => {
    vivant.current = true;
    const arreter = getBridge()?.moteurs?.onProgression((id, p, lieu) => { if (id === choix && !lieu) setProgression(p); });
    const verifier = () => { if (document.visibilityState === "visible") void actualiser(); };
    window.addEventListener("focus", verifier);
    return () => { vivant.current = false; arreter?.(); window.removeEventListener("focus", verifier); };
  }, [choix, actualiser]);

  const avancer = async () => {
    if (!choix || occupe.current) return;
    occupe.current = true; setErreur(null);
    const pont = getBridge()?.moteurs;
    try {
      if (!pont || !courant) throw new Error("Les IA n’ont pas pu être lues. Réessaie la vérification.");
      if (!installe) {
        if (!courant.moteur.installable) throw new Error("L’installation de cette IA n’est pas disponible sur ce poste. Choisis une autre IA ou réessaie après sa mise à jour.");
        setAction("installation"); setProgression(null);
        unwrap(await pont.installer(choix, null));
        await actualiserMoteurs(null);
        return;
      }
      if (!disponible) {
        setAction("connexion");
        const compte = unwrap(await (choix === "grok" ? pont.connecterAvecCle(choix, cle.trim(), null) : pont.connecter(choix, null)));
        if (!compte.connecte) throw new Error("La connexion n’est pas terminée. Valide-la dans la fenêtre ouverte, puis vérifie à nouveau.");
        await actualiserMoteurs(null);
        return;
      }
      setAction("verification");
      const compte = unwrap(await pont.compte(choix, null));
      if (!compte.installe || !compte.connecte) { await actualiserMoteurs(null); throw new Error("Cette IA n’est plus connectée. Reconnecte-la pour continuer."); }
      await continuer(choix);
    } catch (e) {
      if (vivant.current) setErreur(e instanceof Error ? e.message : "Cette étape n’a pas abouti. Réessaie.");
    } finally {
      occupe.current = false;
      if (vivant.current) { setAction(null); setCle(""); }
    }
  };
  return <VueChoixIa choix={choix} choisir={choisir} continuer={continuer} erreurExterne={erreurExterne} moteurs={moteurs} lecture={lecture} erreur={erreur} action={action} progression={progression} cle={cle} setCle={setCle} setErreur={setErreur} avancer={avancer} actualiser={actualiser} />;
}
