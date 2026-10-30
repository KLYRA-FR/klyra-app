"use client";

import { useCallback, useEffect, useRef } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { apparition } from "@/lib/mouvement";
import { poste } from "@/lib/plateforme";
import { getBridge } from "@/lib/bridge";
import type { RetourExport } from "./useExporterConversation";

/** Même minuterie que le message du point 8, sans modifier celui-ci. */
export function MessageExport({ message, onFermer }: { message: RetourExport; onFermer: () => void }) {
  const zone = useRef<HTMLDivElement | null>(null);
  const avantFocus = useRef<HTMLElement | null>(null);
  const monter = useCallback((el: HTMLDivElement | null) => { zone.current = el; apparition(el); }, []);
  const fermer = () => {
    if (zone.current?.contains(document.activeElement) && avantFocus.current?.isConnected) avantFocus.current.focus({ preventScroll: true });
    onFermer();
  };

  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    let restant = 8000;
    let debut = 0;
    let minuteur: ReturnType<typeof setTimeout> | null = null;
    let survole = el.matches(":hover");
    let focusDedans = el.contains(document.activeElement);
    let fenetreActive = document.hasFocus();
    let masquee = document.hidden;
    let demarre = false;
    const actualiser = () => {
      if (message.type === "erreur") return;
      if (survole || focusDedans || !fenetreActive || masquee) {
        if (minuteur !== null) {
          restant = Math.max(0, restant - (performance.now() - debut));
          clearTimeout(minuteur);
          minuteur = null;
        }
      } else if (minuteur === null) {
        if (demarre) restant = Math.max(restant, 3000);
        demarre = true;
        debut = performance.now();
        minuteur = setTimeout(onFermer, restant);
      }
    };
    const entrer = () => { survole = true; actualiser(); };
    const sortir = () => { survole = false; actualiser(); };
    const focus = (e: FocusEvent) => {
      if (e.relatedTarget instanceof HTMLElement && !el.contains(e.relatedTarget)) avantFocus.current = e.relatedTarget;
      focusDedans = true; actualiser();
    };
    const blur = (e: FocusEvent) => { focusDedans = e.relatedTarget instanceof Node && el.contains(e.relatedTarget); actualiser(); };
    const activer = () => { fenetreActive = true; actualiser(); };
    const desactiver = () => { fenetreActive = false; actualiser(); };
    const visibilite = () => { masquee = document.hidden; actualiser(); };
    el.addEventListener("pointerenter", entrer);
    el.addEventListener("pointerleave", sortir);
    el.addEventListener("focusin", focus);
    el.addEventListener("focusout", blur);
    window.addEventListener("focus", activer);
    window.addEventListener("blur", desactiver);
    document.addEventListener("visibilitychange", visibilite);
    actualiser();
    return () => {
      if (minuteur !== null) clearTimeout(minuteur);
      el.removeEventListener("pointerenter", entrer);
      el.removeEventListener("pointerleave", sortir);
      el.removeEventListener("focusin", focus);
      el.removeEventListener("focusout", blur);
      window.removeEventListener("focus", activer);
      window.removeEventListener("blur", desactiver);
      document.removeEventListener("visibilitychange", visibilite);
    };
  }, [message, onFermer]);

  return (
    <div ref={monter} data-export-conversation
      className="absolute top-3 left-1/2 z-30 flex max-w-[min(560px,calc(100%-48px))] -translate-x-1/2 items-center gap-1 rounded-md bg-fond-inverse py-1.5 pr-1.5 pl-3.5 text-ui-s text-texte-inverse shadow-ombre-md"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fermer(); } }}
    >
      {message.type === "succes" ? <>
        <span className="min-w-0 truncate pr-2" title={message.chemin}>Conversation exportée : {message.nom}</span>
        <Bouton variant="ghost" taille="mini" className="shrink-0 whitespace-nowrap focus-visible:outline-texte-inverse"
          onClick={() => { void getBridge()?.fichiers.montrer(message.chemin); }}
        >Montrer {poste.dansExplorateur}</Bouton>
      </> : <span className="min-w-0 pr-2">Export impossible : {message.raison}</span>}
      <BoutonIcone variant="ghost" taille="mini" libelle="Fermer" icone={<Icon name="x-01" size={14} />}
        className="shrink-0 border-transparent bg-transparent text-texte-inverse-secondaire hover:text-texte-inverse focus-visible:outline-texte-inverse"
        onClick={fermer} />
    </div>
  );
}
