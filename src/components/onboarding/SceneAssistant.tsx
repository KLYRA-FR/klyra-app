"use client";

import { useRef, type PointerEvent } from "react";
import { AgentRond } from "@/components/roles/AgentRond";
import { Icon } from "@/components/icons/Icon";
import { LogoFournisseur } from "@/components/ui/LogoFournisseur";
import type { EtapePriseEnMain, FournisseurDepart } from "../../../electron/prise-en-main-modele";

const LEGENDES: Record<string, [string, string]> = {
  assistant: ["Une présence, pour avancer.", "Un interlocuteur qui apprend le contexte de tes demandes."],
  ia: ["Ton IA. Ton assistant.", "Connecte le compte que tu souhaites utiliser avec KLYRA."],
  acces: ["L’initiative, avec tes règles.", "Tu choisis les accès. Tu peux les ajuster à tout moment."],
  demande: ["On commence par du concret.", "Une demande à toi, une réponse dans ta conversation."],
};

export function SceneAssistant({ nom, etape, fournisseur }: { nom: string; etape: EtapePriseEnMain; fournisseur: FournisseurDepart | null }) {
  const scene = useRef<HTMLDivElement>(null);
  const legende = LEGENDES[etape] ?? LEGENDES.demande;
  const suivre = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = e.currentTarget.getBoundingClientRect();
    scene.current?.style.setProperty("--prise-x", `${((e.clientX - box.left) / box.width - .5) * 12}px`);
    scene.current?.style.setProperty("--prise-y", `${((e.clientY - box.top) / box.height - .5) * 12}px`);
  };
  const recentrer = () => { scene.current?.style.setProperty("--prise-x", "0px"); scene.current?.style.setProperty("--prise-y", "0px"); };
  return (
    <aside className="prise-scene" ref={scene} onPointerMove={suivre} onPointerLeave={recentrer} aria-label="Ton assistant prend forme">
      <div className="prise-constellation" aria-hidden="true">
        <div className="prise-orbite prise-orbite-exterieure" />
        <div className="prise-orbite prise-orbite-interieure" />
        <div className="prise-papier prise-papier-document"><Icon name="file-01" size={20} /><span>Le document</span><strong>L’essentiel, au clair.</strong><i /><i /></div>
        <div className="prise-papier prise-papier-idee"><Icon name="stars" size={20} /><span>L’idée</span><strong>Un point de départ.</strong></div>
        <div className="prise-personnage"><AgentRond roleId="principal" taille={96} /><span>{nom.trim() || "Ton assistant"}</span><small>À tes côtés</small></div>
        <div className="prise-papier prise-papier-reponse">
          {etape === "ia" && fournisseur ? <LogoFournisseur id={fournisseur} initiale={fournisseur.charAt(0).toUpperCase()} taille={24} /> : <Icon name="message-square" size={20} />}
          <span>{etape === "ia" ? "L’IA de ton choix" : "La conversation"}</span><strong>{etape === "ia" ? "La bonne connexion." : "On fait avancer la suite."}</strong>
        </div>
      </div>
      <div className="prise-scene-texte"><h2>{legende[0]}</h2><p>{legende[1]}</p></div>
      <div className="prise-scene-bas"><span>KLYRA</span></div>
    </aside>
  );
}
