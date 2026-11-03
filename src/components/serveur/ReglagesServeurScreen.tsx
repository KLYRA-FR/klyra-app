"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { allerAuReglage, Entree } from "@/components/reglages/ReglagesScreen";
import { nomLieu, useLieuActif, useServeursRelies } from "@/lib/lieux";
import type { ServeurConnu } from "@/lib/serveur-vps";
import { cheminServeur, SECTIONS_SERVEUR, type IdSectionServeur } from "./catalogue";
import { Fournisseurs } from "./Fournisseurs";
import { GeneralServeur } from "./GeneralServeur";

const CONTENU: Record<IdSectionServeur, (lieu: string | null, serveur: ServeurConnu | null) => ReactNode> = {
  general: (_lieu, serveur) => <GeneralServeur serveur={serveur} />,
  fournisseurs: (lieu) => <Fournisseurs lieu={lieu} />,
};

/**
 * Réglages du serveur, comme dans OpenBot : ce qui appartient à la machine où tournent les agents
 * (Ce PC ou un VPS relié), à part des Réglages de l'app. `?serveur=<adresse>` choisit le VPS (sans :
 * le serveur actif), `?section=fournisseurs&fournisseur=codex` ouvre la page d'un fournisseur,
 * `&reglage=<id>` mène à un réglage.
 */
export function ReglagesServeurScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const actif = useLieuActif();
  const serveurs = useServeursRelies();
  const demande = params.get("serveur");
  const lieu = demande && serveurs.some((s) => s.adresse === demande) ? demande : actif;
  const serveur = serveurs.find((s) => s.adresse === lieu) ?? null;
  const sections = SECTIONS_SERVEUR;
  const courante = sections.find((s) => s.id === params.get("section")) ?? sections[0];
  const reglage = params.get("reglage");
  const nav = useRef<HTMLElement>(null);
  const contenu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    contenu.current?.scrollTo({ top: 0 });
  }, [courante.id]);

  /* Venu d'une recherche : on mène au réglage, une fois la section affichée. */
  useEffect(() => {
    if (!reglage) return;
    const t = window.setTimeout(() => allerAuReglage(reglage), 120);
    return () => window.clearTimeout(t);
  }, [reglage, courante.id]);

  const ouvrir = (id: IdSectionServeur) => router.replace(cheminServeur(id, { serveur: demande }), { scroll: false });

  const deplacer = (e: KeyboardEvent<HTMLButtonElement>) => {
    const lignes = Array.from(nav.current?.querySelectorAll<HTMLButtonElement>("[data-entree-reglages]") ?? []);
    const i = lignes.indexOf(e.currentTarget);
    const j = { ArrowDown: Math.min(lignes.length - 1, i + 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: lignes.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    lignes[j].focus();
    ouvrir(sections[j].id);
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[248px] shrink-0 flex-col gap-3 border-r border-bordure-subtile px-3 pt-5 pb-4">
        <div className="flex items-center gap-2.5 px-2.5">
          <Icon name={serveur ? "globe-01" : "computer"} size={20} className="shrink-0 text-icone-defaut" />
          <div className="flex min-w-0 flex-col">
            <h1 className="m-0 truncate text-ui font-semibold text-texte-principal">{nomLieu(lieu, serveurs)}</h1>
            <span className="text-ui-2xs text-texte-tertiaire">Réglages du serveur</span>
          </div>
        </div>
        <nav ref={nav} aria-label="Sections des réglages du serveur" className="klyra-defilement-fin -mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1">
          {sections.map((s) => (
            <Entree key={s.id} icone={s.icone} actif={s.id === courante.id} courant={s.id === courante.id} onClick={() => ouvrir(s.id)} onKeyDown={deplacer}>
              {s.titre}
            </Entree>
          ))}
        </nav>
      </aside>

      <div ref={contenu} className="min-w-0 flex-1 overflow-y-auto">
        <div key={`${lieu ?? "pc"}-${courante.id}`} className="klyra-arrivee @container mx-auto flex max-w-[760px] flex-col gap-6 px-8 pt-8 pb-12">
          <header className="flex flex-col gap-1.5">
            <h2 className="m-0 text-h3 leading-[1] font-semibold tracking-[-0.04em] text-texte-principal">{courante.titre}</h2>
            <p className="m-0 text-ui-s text-texte-tertiaire">{courante.description}</p>
          </header>
          {CONTENU[courante.id](lieu, serveur)}
        </div>
      </div>
    </div>
  );
}
