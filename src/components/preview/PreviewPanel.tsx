"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { EmptyState } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { FileTree } from "@/components/project/FileTree";
import { Bouton } from "@/components/ui/Bouton";
import { Onglets, type Onglet } from "@/components/ui/Onglets";
import { useArbreProjet } from "@/lib/arbre-projet";
import { cn } from "@/lib/cn";
import { useModifiedFiles } from "@/lib/workspace";
import type { Chat, Project } from "@/types/domain";
import { ouvrirFichier } from "@/components/project/Visionneuse";
import { ApercuSite } from "./ApercuSite";
import { Publier } from "./Publier";
import { VueModifies } from "./VueModifies";
import { PanneauNavigateur } from "@/components/chat/navigateur/PanneauNavigateur";
import { useActiviteNavigateur } from "@/lib/navigateur";

type PreviewTab = "apercu" | "code" | "fichiers" | "taches" | "navigateur";

const TABS: Onglet<PreviewTab>[] = [
  { id: "apercu", label: "Aperçu", icone: <Icon name="globe-01" size={16} /> },
  { id: "code", label: "Modifié", icone: <Icon name="code-01" size={16} /> },
  { id: "fichiers", label: "Fichiers", icone: <Icon name="file-code" size={16} /> },
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

/** Panneau de droite d'une conversation de projet : le vrai site en aperçu, ses fichiers, et Publier. */
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
  const [publier, setPublier] = useState(false);
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
        <Onglets libelle="Vues du projet" onglets={TABS} valeur={tab} onChange={setTab} etiquettes="large" />
        <Bouton
          variant="sombre"
          taille="compact"
          iconeGauche={<Icon name="upload-01" size={16} />}
          title="Publier : commit et push sur git"
          className="ml-auto"
          disabled={!project}
          onClick={() => setPublier(true)}
        >
          <span className="sr-only @md:not-sr-only">Publier</span>
        </Bouton>
      </div>

      {/* Gardé monté derrière les autres onglets : ses pages ne se rechargent pas. */}
      <ApercuSite project={project} modifiedLabel={modifiedLabel} adresseDemandee={adresseDemandee} visible={tab === "apercu"} />
      {/* Le navigateur de KLYRA : les onglets que les agents de cette conversation utilisent. */}
      {tab === "navigateur" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <PanneauNavigateur chat={chat} />
        </div>
      )}
      {tab !== "apercu" && tab !== "navigateur" && project && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {tab === "fichiers" && <ArbreProjet project={project} />}
          {tab === "code" && <VueModifies project={project} />}
          {tab === "taches" && <TachesChat chat={chat} />}
        </div>
      )}

      {publier && project && <Publier project={project} onFermer={() => setPublier(false)} />}
    </aside>
  );
}

function ArbreProjet({ project }: { project: Project }) {
  const arbre = useArbreProjet(project);
  const modified = useModifiedFiles(project.id);
  if (arbre.erreur) return <p className="m-0 p-3 text-ui-s text-texte-erreur">Dossier illisible : {arbre.erreur}</p>;
  return (
    <FileTree
      key={project.id}
      nodes={arbre.noeuds}
      contenu={arbre.contenu}
      charger={arbre.charger}
      modified={modified}
      onOuvrir={(chemin) => ouvrirFichier({ projectId: project.id, chemin })}
    />
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
