"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { annoncer } from "@/lib/annonces";
import { apparition } from "@/lib/mouvement";
import { raccourciDuSysteme } from "@/lib/plateforme";
import { avecCommande } from "@/lib/raccourcis";
import type { RappelSupprime } from "@/lib/suppression-rappels";
import { useWorkspace } from "@/lib/workspace";

const titreCourt = (titre: string) => titre.length > 60 ? titre.slice(0, 59) + "…" : titre;
const eclairages = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function eclairer(rendus: RappelSupprime[]) {
  for (const { tache } of rendus) {
    const ligne = document.querySelector<HTMLElement>('[data-rappel="' + CSS.escape(tache.id) + '"]');
    if (!ligne) continue;
    clearTimeout(eclairages.get(ligne));
    ligne.dataset.eclaire = "";
    eclairages.set(ligne, setTimeout(() => {
      delete ligne.dataset.eclaire;
      eclairages.delete(ligne);
    }, 1800));
  }
}

/** Le montage dure le temps d'un groupe, même en changeant de page. */
function MessageActif({ groupe }: { groupe: RappelSupprime[] }) {
  const { restaurerTaches, oublierSuppressions } = useWorkspace();
  const pathname = usePathname();
  const zone = useRef<HTMLDivElement | null>(null);
  const avantFocus = useRef<HTMLElement | null>(null);
  const saisie = useRef(false);
  const monter = useCallback((el: HTMLDivElement | null) => {
    zone.current = el;
    apparition(el);
  }, []);
  const rendreFocus = useCallback(() => {
    if (avantFocus.current?.isConnected) avantFocus.current.focus({ preventScroll: true });
  }, []);
  const fermer = useCallback(() => {
    rendreFocus();
    oublierSuppressions();
  }, [oublierSuppressions, rendreFocus]);

  const annuler = useCallback(() => {
    const focusDansMessage = !!zone.current?.contains(document.activeElement);
    const rendus = restaurerTaches();
    if (!rendus.length) return;
    annoncer(rendus.length === 1
      ? "Rappel restauré : " + titreCourt(rendus[0].tache.titre) + "."
      : rendus.length + " rappels restaurés.");
    requestAnimationFrame(() => {
      eclairer(rendus);
      const dernier = rendus.at(-1)!.tache.id;
      const ligne = document.querySelector<HTMLElement>('[data-rappel="' + CSS.escape(dernier) + '"]');
      if (ligne) {
        ligne.querySelector<HTMLElement>('[role="checkbox"]')?.focus({ preventScroll: true });
        ligne.scrollIntoView({
          block: "nearest", inline: "nearest",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
      } else if (focusDansMessage) rendreFocus();
    });
  }, [restaurerTaches, rendreFocus]);

  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    saisie.current = false;
    const dernier = groupe.at(-1)!.tache;
    const touche = raccourciDuSysteme("⌘Z");
    annoncer("Rappel supprimé : " + titreCourt(dernier.titre) + ". " +
      (groupe.length === 1 ? touche + " pour annuler." : groupe.length + " rappels supprimés, " + touche + " pour tout annuler."));

    let restant = 8000;
    let debut = 0;
    let minuteur: ReturnType<typeof setTimeout> | null = null;
    let survole = el.matches(":hover");
    let focusDedans = el.contains(document.activeElement);
    let fenetreActive = document.hasFocus();
    let masquee = document.hidden;
    let demarre = false;
    const actualiser = () => {
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
        minuteur = setTimeout(oublierSuppressions, restant);
      }
    };
    const entrer = () => { survole = true; actualiser(); };
    const sortir = () => { survole = false; actualiser(); };
    const focus = (e: FocusEvent) => {
      if (e.relatedTarget instanceof HTMLElement && !el.contains(e.relatedTarget)) avantFocus.current = e.relatedTarget;
      focusDedans = true;
      actualiser();
    };
    const blur = (e: FocusEvent) => { focusDedans = e.relatedTarget instanceof Node && el.contains(e.relatedTarget); actualiser(); };
    const activer = () => { fenetreActive = true; actualiser(); };
    const desactiver = () => { fenetreActive = false; actualiser(); };
    const visibilite = () => { masquee = document.hidden; actualiser(); };
    const taper = () => { saisie.current = true; };
    el.addEventListener("pointerenter", entrer);
    el.addEventListener("pointerleave", sortir);
    el.addEventListener("focusin", focus);
    el.addEventListener("focusout", blur);
    window.addEventListener("focus", activer);
    window.addEventListener("blur", desactiver);
    document.addEventListener("visibilitychange", visibilite);
    document.addEventListener("input", taper, true);
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
      document.removeEventListener("input", taper, true);
    };
  }, [groupe, oublierSuppressions]);

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.defaultPrevented || pathname !== "/planning" || e.key.toLowerCase() !== "z" ||
          !avecCommande(e) || e.shiftKey || saisie.current || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      annuler();
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [pathname, annuler]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-6">
      <div
        ref={monter}
        data-annulation-rappels
        className="pointer-events-auto flex max-w-full items-center gap-1 rounded-md bg-fond-inverse py-1.5 pr-1.5 pl-3.5 text-ui-s text-texte-inverse shadow-ombre-md"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          fermer();
        }}
      >
        <span className="pr-2 whitespace-nowrap">{groupe.length === 1 ? "Rappel supprimé" : groupe.length + " rappels supprimés"}</span>
        <Bouton
          variant="ghost" taille="mini" className="focus-visible:outline-texte-inverse"
          aria-label={groupe.length === 1 ? "Annuler la suppression" : "Annuler la suppression des " + groupe.length + " rappels"}
          title={pathname === "/planning" ? "Annuler (" + raccourciDuSysteme("⌘Z") + ")" : undefined}
          onClick={annuler}
        >Annuler</Bouton>
        <BoutonIcone
          variant="ghost" taille="mini" libelle="Fermer" icone={<Icon name="x-01" size={14} />}
          className="border-transparent bg-transparent text-texte-inverse-secondaire hover:text-texte-inverse focus-visible:outline-texte-inverse"
          onClick={fermer}
        />
      </div>
    </div>
  );
}

export function MessageSuppression() {
  const { state } = useWorkspace();
  return state.rappelsSupprimes.length ? <MessageActif groupe={state.rappelsSupprimes} /> : null;
}
