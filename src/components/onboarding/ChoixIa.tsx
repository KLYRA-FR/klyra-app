"use client";

import { useEffect, useRef, useState } from "react";
import { LogoFournisseur } from "@/components/ui/LogoFournisseur";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { Icon } from "@/components/icons/Icon";
import { getBridge, unwrap, type ProgressionMoteur } from "@/lib/bridge";
import { FOURNISSEURS } from "@/lib/fournisseurs";
import { actualiserMoteurs, pret, useMoteurs } from "@/lib/moteurs";
import type { FournisseurDepart } from "../../../electron/prise-en-main-modele";

const AIDES: Record<string, string> = { claude: "Avec ton compte Claude", codex: "Avec ton compte ChatGPT", grok: "Avec une clé d’API xAI" };

export function ChoixIa({ choix, choisir, continuer, erreurExterne }: { choix: FournisseurDepart | null; choisir: (id: FournisseurDepart) => Promise<void>; continuer: (id: FournisseurDepart) => Promise<void>; erreurExterne: string | null }) {
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
  const total = progression?.total;
  const pourcent = total && total > 0 ? Math.min(100, Math.round((progression!.recu / total) * 100)) : null;
  const attente = action === "installation" ? progression?.etape === "verification" ? "Vérification du téléchargement…" : progression?.etape === "installation" ? "Installation sur cet ordinateur…" : "Téléchargement de l’IA…" : action === "connexion" ? choix === "grok" ? "Vérification de ta clé…" : "Termine la connexion dans ton navigateur…" : "Vérification de la connexion…";
  return (
    <div className="prise-choix-ia">
      <div className="prise-fournisseurs" role="group" aria-label="Ton IA">
        {FOURNISSEURS.map((f) => {
          const moteur = moteurs?.find((m) => m.moteur.id === f.id);
          const statut = !moteurs ? "Vérification…" : moteur && pret(moteur) ? "Connecté" : moteur?.moteur.chemin ? "À connecter" : "À installer";
          return <button type="button" key={f.id} aria-pressed={choix === f.id} disabled={!!action} className="prise-fournisseur" onClick={() => { setErreur(null); setCle(""); void choisir(f.id).catch((e: unknown) => setErreur(e instanceof Error ? e.message : "Le choix n’a pas été enregistré.")); }}><LogoFournisseur id={f.id} initiale={f.initiale} taille={28} /><span className="prise-fournisseur-nom"><strong>{f.nom}</strong><small>{AIDES[f.id]}</small></span><span className="prise-statut">{statut}</span><span className="prise-radio" aria-hidden="true">{choix === f.id && <span />}</span></button>;
        })}
      </div>
      {choix && !disponible && <p className="prise-aide">{installe ? "La connexion se fait auprès du fournisseur. KLYRA ne te demande pas son mot de passe." : "KLYRA peut installer le programme nécessaire sur cet ordinateur. Tu gardes ton compte auprès du fournisseur choisi."}</p>}
      {choix === "grok" && installe && !disponible && <label className="prise-champ"><span>Clé d’API xAI</span><input type="password" autoComplete="off" value={cle} onChange={(e) => setCle(e.target.value)} disabled={!!action} spellCheck={false} /><small>Elle passe par le coffre système du poste et n’est pas enregistrée dans la prise en main.</small></label>}
      {action && <div className="prise-attente" role="status"><span className="prise-pixel" /><span>{attente}</span>{pourcent !== null && action === "installation" && <span className="prise-pourcent">{pourcent} %</span>}{action === "installation" && <progress max={100} value={pourcent ?? undefined} aria-label={attente} />}</div>}
      {(erreur || lecture || erreurExterne || courant?.erreur) && <p className="prise-erreur" role="alert">{erreur || lecture || erreurExterne || courant?.erreur}</p>}
      <div className="prise-actions-ia"><BoutonPrincipal onClick={() => void avancer()} disabled={!choix || !moteurs || !!lecture || !!action || (choix === "grok" && installe && !disponible && !cle.trim())}>{action ? "Un instant…" : !choix ? "Choisir une IA" : !installe ? `Installer ${FOURNISSEURS.find((f) => f.id === choix)?.nom ?? "l’IA"}` : !disponible ? "Connecter mon compte" : "Continuer"}</BoutonPrincipal><Bouton variant="discret" taille="md" disabled={action === "installation"} onClick={() => { setErreur(null); void actualiser().catch(() => setErreur("La vérification n’a pas abouti. Réessaie.")); }} iconeGauche={<Icon name="refresh-01" size={16} />}>Vérifier</Bouton></div>
      <p className="prise-aide">Ton compte d’équipe KLYRA est indépendant. Tu pourras le connecter plus tard.</p>
    </div>
  );
}
