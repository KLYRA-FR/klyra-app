"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { EmptyState } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Onglets, type Onglet } from "@/components/ui/Onglets";
import { cn } from "@/lib/cn";
import type { Chat, Project } from "@/types/domain";
import { ApercuSite } from "./ApercuSite";
import { PanneauNavigateur } from "@/components/chat/navigateur/PanneauNavigateur";
import { useActiviteNavigateur } from "@/lib/navigateur";

/* Une conversation de projet a le panneau d'un chat d'agent (PanneauLateral : aperçu, Git, fichiers…) ;
   ce panneau-ci reste aux autres conversations d'équipe (routines, workflows, sans projet). */
type PreviewTab = "apercu" | "taches" | "navigateur";

const TABS: Onglet<PreviewTab>[] = [
  { id: "apercu", label: "Aperçu", icone: <Icon name="globe-01" size={16} /> },
  { id: "taches", label: "Tâches", icone: <Icon name="list" size={16} /> },
  { id: "navigateur", label: "Navigateur", icone: <Icon name="computer" size={16} /> },
];

const LARGEUR_DEFAUT = 480;
const LARGEUR_MIN = 320;
/** La conversation garde au moins cette largeur. */
const CONVERSATION_MIN = 424;
const CLE = "klyra-apercu-largeur";

/** Largeur du panneau, gardée d'une session à l'autre (préférence de cet écran). */
function useLargeur() {
  const [largeur, setLargeur] = useState(() => {
    try {
      const v = Number(localStorage.getItem(CLE));
      return v >= LARGEUR_MIN ? v : LARGEUR_DEFAUT;
    } catch {
      return LARGEUR_DEFAUT;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CLE, String(largeur));
    } catch {
      /* stockage indisponible */
    }
  }, [largeur]);
  return [largeur, setLargeur] as const;
}


/** Largeur de la rangée conversation + aperçu. On saute les enveloppes en `display: contents`
 *  (elles mesurent 0 px et bloqueraient la poignée à la largeur minimale). */
function largeurDisponible(el: HTMLElement | null) {
  let parent = el?.parentElement ?? null;
  while (parent && getComputedStyle(parent).display === "contents") parent = parent.parentElement;
  return parent?.clientWidth || 1200;
}

interface PreviewPanelProps {
  project: Project | undefined;
  chat: Chat;
  /** « Modifié par Hugo · 09:52 ». */
  modifiedLabel: string | null;
  /** Un lien local cliqué dans la conversation : l'aperçu l'ouvre. */
  adresseDemandee?: { url: string; n: number } | null;
}

/** Panneau de droite des conversations d'équipe hors projet : l'aperçu d'un site, les tâches, le navigateur de ses agents. */
export function PreviewPanel({ project, chat, modifiedLabel, adresseDemandee }: PreviewPanelProps) {
  const [tab, setTab] = useState<PreviewTab>("apercu");
  /* Un agent passe la main à la personne sur une page : le Navigateur s'affiche. */
  const activiteNavigateur = useActiviteNavigateur(chat.id);
  const [attenteVue, setAttenteVue] = useState(false);
  if ((activiteNavigateur === "attente") !== attenteVue) {
    setAttenteVue(activiteNavigateur === "attente");
    if (activiteNavigateur === "attente") setTab("navigateur");
  }
  const [largeur, setLargeur] = useLargeur();
  const panneau = useRef<HTMLElement>(null);
  /* Lien cliqué dans la conversation : l'aperçu passe devant (rendu suivant, sans effet). */
  const [derniereDemande, setDerniereDemande] = useState(0);
  if (adresseDemandee && adresseDemandee.n !== derniereDemande) {
    setDerniereDemande(adresseDemandee.n);
    setTab("apercu");
  }
  /* Poignée : on tire le bord gauche ; double-clic pour revenir à la largeur de départ. */
  const tirer = (depart: ReactPointerEvent) => {
    const x0 = depart.clientX;
    const l0 = largeur;
    const max = () => largeurDisponible(panneau.current) - CONVERSATION_MIN;
    const bouger = (e: PointerEvent) => setLargeur(Math.max(LARGEUR_MIN, Math.min(max(), l0 + x0 - e.clientX)));
    const lacher = () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      delete document.body.dataset.glisse;
    };
    // Pendant le geste, l'aperçu (iframe) ne doit pas avaler les mouvements de la souris.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.dataset.glisse = "1";
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
  };
  const clavierPoignee = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setLargeur((l) => Math.max(LARGEUR_MIN, l + (e.key === "ArrowLeft" ? 24 : -24)));
  };

  return (
    <aside
      ref={panneau}
      aria-label="Aperçu du projet"
      className="@container relative flex h-full shrink-0 flex-col border-l border-bordure-subtile bg-fond-surface"
      style={{ width: largeur }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Largeur de l’aperçu"
        aria-valuenow={largeur}
        tabIndex={0}
        onPointerDown={tirer}
        onDoubleClick={() => setLargeur(LARGEUR_DEFAUT)}
        onKeyDown={clavierPoignee}
        className="group/poignee absolute top-0 bottom-0 -left-2 z-20 w-4 cursor-col-resize"
      >
        <span className="absolute top-0 bottom-0 left-2 w-px bg-transparent transition-colors duration-[120ms] group-hover/poignee:bg-bleu-k1-500 group-focus-visible/poignee:bg-bleu-k1-500" />
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <Onglets libelle="Vues de la conversation" onglets={TABS} valeur={tab} onChange={setTab} etiquettes="large" />
      </div>

      {/* Gardé monté derrière les autres onglets : ses pages ne se rechargent pas. */}
      <ApercuSite project={project} modifiedLabel={modifiedLabel} adresseDemandee={adresseDemandee} visible={tab === "apercu"} />
      {/* Le navigateur de KLYRA : les onglets que les agents de cette conversation utilisent. */}
      {tab === "navigateur" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <PanneauNavigateur chat={chat} />
        </div>
      )}
      {tab === "taches" && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <TachesChat chat={chat} />
        </div>
      )}
    </aside>
  );
}

function TachesChat({ chat }: { chat: Chat }) {
  const taches = chat.taches ?? [];
  if (!taches.length) {
    return <EmptyState title="Pas de tâches" description="Quand un agent découpe son travail, sa liste s’affiche ici." />;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-3">
      {taches.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-ui-s">
          <Icon
            name={t.statut === "fait" ? "check-01" : t.statut === "en-cours" ? "loader-01" : "circle"}
            size={16}
            className={cn("mt-0.5 shrink-0", t.statut === "fait" ? "text-icone-accent" : "text-icone-secondaire")}
          />
          <span className={t.statut === "fait" ? "text-texte-tertiaire line-through" : "text-texte-principal"}>{t.texte}</span>
        </li>
      ))}
    </ul>
  );
}
