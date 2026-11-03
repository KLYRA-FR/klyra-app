"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { nomAbonnement, useCompteClaude } from "@/lib/compte-claude";
import { apparition } from "@/lib/mouvement";
import { useWorkspace } from "@/lib/workspace";
import { ListeServeurs, parcourirMenu, PointServeur, useServeurs } from "./Serveurs";

/** L'état de Claude en quelques mots, et la couleur de son point. */
function useEtatClaude() {
  const { disponible, compte, action } = useCompteClaude();
  if (!disponible) return { texte: "Claude : app de bureau", ok: null };
  if (action === "connexion") return { texte: "Connexion à Claude…", ok: null };
  if (!compte) return { texte: "Vérification de Claude…", ok: null };
  if (!compte.installe) return { texte: "Claude Code introuvable", ok: false };
  if (!compte.connecte) return { texte: "Claude non connecté", ok: false };
  const abonnement = nomAbonnement(compte.abonnement);
  return { texte: abonnement ? `Claude ${abonnement} · connecté` : "Claude connecté", ok: true };
}

/** Point d'état : K1 connecté, rouge à reconnecter, gris en attente. */
function Point({ ok, className }: { ok: boolean | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        ok === true ? "bg-bleu-k1-500" : ok === false ? "bg-bordure-erreur" : "bg-gris-k1-100",
        className,
      )}
    />
  );
}

const LIGNE_MENU =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-2 text-left text-ui-s text-texte-principal hover:bg-fond-survol focus-visible:bg-fond-survol focus-visible:-outline-offset-2";

/**
 * Dans le rail : ton avatar, avec le point d'état de Claude (et un globe quand les agents tournent sur un VPS).
 * Un clic ouvre ton menu : les Réglages de l'app, et les Serveurs (Ce PC ou un VPS relié, comme dans OpenBot).
 */
export function CarteCompteRail() {
  const router = useRouter();
  const { moi } = useWorkspace();
  const { texte, ok } = useEtatClaude();
  const [ouvert, setOuvert] = useState(false);
  const [serveursOuverts, setServeursOuverts] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const ligneServeurs = useRef<HTMLButtonElement>(null);
  const menuServeurs = useRef<HTMLDivElement>(null);
  const idMenu = useId();
  const idServeurs = useId();

  const fermer = (rendreFocus: boolean) => {
    setOuvert(false);
    setServeursOuverts(false);
    if (rendreFocus) bouton.current?.focus();
  };
  const s = useServeurs(ouvert, fermer);

  /* Au clavier, le sous-menu prend le focus sur la machine cochée ; à la souris, il s'ouvre seulement. */
  const [focusServeurs, setFocusServeurs] = useState(false);
  const ouvrirServeurs = (focus: boolean) => {
    setServeursOuverts(true);
    setFocusServeurs(focus);
  };
  const quitterServeurs = () => {
    setServeursOuverts(false);
    ligneServeurs.current?.focus();
  };

  useEffect(() => {
    if (!ouvert) return;
    zone.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const dehors = (e: MouseEvent) => {
      if (!zone.current?.contains(e.target as Node)) fermer(false);
    };
    document.addEventListener("mousedown", dehors);
    return () => document.removeEventListener("mousedown", dehors);
  }, [ouvert]);

  useEffect(() => {
    if (!serveursOuverts || !focusServeurs) return;
    const menu = menuServeurs.current;
    (menu?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
  }, [serveursOuverts, focusServeurs]);

  const aller = (chemin: string) => {
    fermer(false);
    router.push(chemin);
  };

  const clavierMenu = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      fermer(true);
    } else if (e.key === "ArrowRight" && document.activeElement === ligneServeurs.current) {
      e.preventDefault();
      ouvrirServeurs(true);
    } else if (parcourirMenu(e, e.currentTarget)) {
      setServeursOuverts(false);
    }
  };

  const clavierServeurs = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "ArrowLeft") {
      e.preventDefault();
      quitterServeurs();
    } else if (e.key === "Tab") {
      e.preventDefault();
      fermer(true);
    } else parcourirMenu(e, e.currentTarget);
  };

  const libelle = `${moi.name} · ${texte} · Serveur : ${s.nom}`;

  return (
    <div ref={zone} className="relative flex">
      <button
        ref={bouton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idMenu : undefined}
        aria-label={libelle}
        title={`${texte} · ${s.nom}`}
        onClick={() => (ouvert ? fermer(false) : setOuvert(true))}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" || ouvert) return;
          e.preventDefault();
          setOuvert(true);
        }}
        className={cn("relative flex cursor-pointer rounded-full border-0 bg-transparent p-0", ouvert && "ring-2 ring-texte-inverse ring-offset-2 ring-offset-fond-inverse-fort")}
      >
        <Avatar shape="circle" size="md" src={moi.photo ?? undefined} initials={moi.initial} alt="" gradient={false} />
        <Point ok={ok} className="absolute -right-0.5 -bottom-0.5 size-2.5 border-2 border-fond-inverse-fort" />
        {/* Les agents tournent sur un VPS : on le voit sans ouvrir le menu. */}
        {s.actif && (
          <span aria-hidden="true" className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-fond-inverse-fort bg-fond-inverse-fort text-texte-inverse">
            <Icon name="globe-01" size={12} />
          </span>
        )}
      </button>

      {ouvert && (
        <div ref={apparition} className="absolute bottom-0 left-full z-50 ml-3 flex items-end gap-1">
          <div
            id={idMenu}
            role="menu"
            aria-label="Compte"
            onKeyDown={clavierMenu}
            className="flex w-[240px] flex-col gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-flottante"
          >
            <div className="flex flex-col px-2 pt-1 pb-1.5">
              <span className="truncate text-ui-s font-semibold text-texte-principal">{moi.name}</span>
              <span className="flex items-center gap-1.5 text-ui-xs text-texte-tertiaire">
                <Point ok={ok} />
                <span className="truncate">{texte}</span>
              </span>
            </div>
            <span aria-hidden="true" className="mx-2 mb-1 h-px bg-bordure-subtile" />
            <button type="button" role="menuitem" tabIndex={-1} onMouseEnter={() => setServeursOuverts(false)} onClick={() => aller("/reglages")} className={cn(LIGNE_MENU, "h-9")}>
              <Icon name="settings" size={16} className="shrink-0 text-icone-secondaire" />
              Réglages
            </button>
            <button
              ref={ligneServeurs}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-haspopup="menu"
              aria-expanded={serveursOuverts}
              aria-controls={serveursOuverts ? idServeurs : undefined}
              onMouseEnter={() => ouvrirServeurs(false)}
              onClick={() => (serveursOuverts ? setServeursOuverts(false) : ouvrirServeurs(true))}
              className={cn(LIGNE_MENU, "min-h-11 py-1.5", serveursOuverts && "bg-fond-survol")}
            >
              <Icon name={s.actif ? "globe-01" : "computer"} size={16} className="shrink-0 text-icone-secondaire" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>Serveurs</span>
                <span className="flex items-center gap-1.5 text-ui-xs leading-[1.35] text-texte-tertiaire">
                  {s.actif && <PointServeur sonde={s.sonde ?? "attente"} />}
                  <span className="truncate">{s.nom}</span>
                </span>
              </span>
              <Icon name="chevron-right" size={16} className="shrink-0 text-icone-secondaire" />
            </button>
          </div>

          {serveursOuverts && (
            <div
              ref={(el) => {
                menuServeurs.current = el;
                apparition(el);
              }}
              id={idServeurs}
              role="menu"
              aria-label="Serveurs"
              onKeyDown={clavierServeurs}
              className="flex w-[280px] flex-col gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-flottante"
            >
              <ListeServeurs s={s} aller={aller} />
            </div>
          )}
        </div>
      )}
      {s.fenetre}
    </div>
  );
}
