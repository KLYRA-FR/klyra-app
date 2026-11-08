"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { useMenuContextuel } from "@/components/ui/MenuContextuel";
import { getBridge } from "@/lib/bridge";
import { renduDansEspace } from "@/lib/rendus-espace";
import { cn } from "@/lib/cn";
import { nomImage } from "@/lib/collage";
import { nomFichier, tailleLisible } from "@/lib/fichiers";
import { formatListDate } from "@/lib/format";
import { poste } from "@/lib/plateforme";
import { useChatMessages, useRole, useWorkspace } from "@/lib/workspace";
import type { Chat, Project, Rendu, TacheAgent } from "@/types/domain";
import { ApercuSite } from "@/components/preview/ApercuSite";
import { Publier } from "@/components/preview/Publier";
import { VueModifies } from "@/components/preview/VueModifies";
import { useActiviteNavigateur } from "@/lib/navigateur";
import { VueImage } from "./ImageJointe";
import { PanneauNavigateur } from "./navigateur/PanneauNavigateur";
import { PastilleExtension } from "./PastilleExtension";
import { ReglagesAgent } from "./reglages-agent/ReglagesAgent";
import { MenuFichierConversation, MenuLivrable, ouvrirLivrable, SuivisTelechargement, useTelechargements } from "./TelechargementsFichiers";

/**
 * Panneau à droite d'une conversation, à onglets : les réglages de l'agent,
 * les fichiers de la conversation, ses tâches, le navigateur de ses agents, et un onglet
 * par image jointe qu'on a ouverte. Dans une conversation de projet, en plus : l'aperçu
 * du site et ce que les agents ont modifié (avec Publier). On ferme un onglet, on le
 * rouvre avec « + », on élargit le panneau à la poignée ou on l'agrandit.
 */

export type Onglet = "reglages" | "apercu" | "modifie" | "fichiers" | "taches" | "navigateur";

const ONGLETS: Record<Onglet, { nom: string; icone: IconName }> = {
  reglages: { nom: "Réglages", icone: "settings" },
  apercu: { nom: "Aperçu", icone: "globe-01" },
  modifie: { nom: "Modifié", icone: "code-01" },
  fichiers: { nom: "Fichiers", icone: "folder" },
  taches: { nom: "Tâches", icone: "list" },
  navigateur: { nom: "Navigateur", icone: "computer" },
};
/** Tous les onglets, dans leur ordre ; ceux d'un projet n'existent que dans une conversation de projet. */
const ORDRE: Onglet[] = ["reglages", "apercu", "modifie", "fichiers", "taches", "navigateur"];
const DU_PROJET: Onglet[] = ["apercu", "modifie"];
const ordreDe = (projet: boolean) => (projet ? ORDRE : ORDRE.filter((o) => !DU_PROJET.includes(o)));

/** Demande d'ouvrir le panneau sur les réglages de l'agent (clic sur son avatar ou son prénom). */
export const OUVRIR_PANNEAU_AGENT = "klyra:panneau-agent";
export const ouvrirPanneauAgent = () => window.dispatchEvent(new Event(OUVRIR_PANNEAU_AGENT));

/** Le panneau sur l'onglet des réglages, rouvert s'il avait été fermé. */
export function surReglages(e: EtatPanneau): EtatPanneau {
  return { ...e, actif: "reglages", ouverts: e.ouverts.includes("reglages") ? e.ouverts : ORDRE.filter((o) => o === "reglages" || e.ouverts.includes(o)) };
}

const LARGEUR_DEFAUT = 340;
const LARGEUR_MIN = 296;
/** Une image s'ouvre à cette largeur au moins, si la conversation garde sa place. */
const LARGEUR_IMAGE = 560;
/** L'aperçu d'un site a besoin d'un peu plus de place que les réglages. */
const LARGEUR_APERCU = 480;
const CLE = "klyra-panneau-lateral";

export interface EtatPanneau {
  ouverts: Onglet[];
  actif: Onglet;
  largeur: number;
  /** Les onglets qui existaient à l'enregistrement : un onglet apparu depuis (Navigateur) s'ouvre une fois de lui-même. */
  connus?: Onglet[];
}

/** L'état du panneau, gardé d'une session à l'autre (préférence de cet écran seulement). */
export function usePanneauLateral() {
  const [etat, setEtat] = useState<EtatPanneau>(() => {
    try {
      const brut = JSON.parse(localStorage.getItem(CLE) ?? "null") as EtatPanneau | null;
      if (brut?.ouverts?.length) {
        const connus = brut.connus ?? ["reglages", "fichiers", "taches"];
        const nouveaux = ORDRE.filter((o) => !connus.includes(o) && !brut.ouverts.includes(o));
        return { ...brut, ouverts: ORDRE.filter((o) => brut.ouverts.includes(o) || nouveaux.includes(o)), connus: [...ORDRE] };
      }
    } catch {
      /* stockage indisponible */
    }
    return { ouverts: [...ORDRE], actif: "reglages", largeur: LARGEUR_DEFAUT, connus: [...ORDRE] };
  });
  useEffect(() => {
    try {
      localStorage.setItem(CLE, JSON.stringify(etat));
    } catch {
      /* stockage indisponible */
    }
  }, [etat]);
  return [etat, setEtat] as const;
}

/* ─── Onglet Fichiers ──────────────────────────────────────────── */

type Source = "joint" | "cree" | "modifie" | "lu";
const SOURCES: Record<Source, string> = { joint: "Joint", cree: "Créé", modifie: "Modifié", lu: "Lu" };

interface FichierChat {
  chemin: string;
  source: Source;
  at: string;
}

/** Tous les fichiers de la conversation : joints par toi, créés, modifiés ou lus par l'agent. */
function useFichiersChat(chatId: string): FichierChat[] {
  const messages = useChatMessages(chatId);
  return useMemo(() => {
    const parChemin = new Map<string, FichierChat>();
    const rang: Record<Source, number> = { lu: 0, joint: 1, modifie: 2, cree: 3 };
    const noter = (chemin: string, source: Source, at: string) => {
      const avant = parChemin.get(chemin);
      if (!avant || rang[source] >= rang[avant.source]) parChemin.set(chemin, { chemin, source, at });
    };
    for (const m of messages) {
      for (const p of m.parts) {
        if (p.type === "fichiers") p.chemins.forEach((c) => noter(c, "joint", m.createdAt));
        if (p.type === "etapes") {
          for (const e of p.etapes) {
            if (!e.chemin || e.statut === "erreur") continue;
            noter(e.chemin, e.outil === "Write" ? "cree" : e.outil === "Read" ? "lu" : "modifie", m.createdAt);
          }
        }
      }
    }
    return [...parChemin.values()].sort((a, b) => b.at.localeCompare(a.at));
  }, [messages]);
}

/**
 * Les livrables (outil `publier_artefact`) : ceux de l'agent, toutes conversations confondues, dans sa
 * conversation directe ; ceux de cette conversation ailleurs. Avec, sur ce PC, ses deux dossiers :
 * ses livrables (copies gardées par l'app) et son dossier de travail hors projet.
 * Clic droit sur un livrable : Télécharger (dans Téléchargements de ce PC), Ouvrir, Afficher, Copier le chemin.
 */
function Livrables({ chat }: { chat: Chat }) {
  const { state } = useWorkspace();
  const bridge = getBridge();
  const direct = chat.kind === "direct" && !chat.fil;
  const agentId = chat.roleIds[0] ?? "principal";
  const agent = useRole(agentId);
  const livrables = state.rendus.filter((r) => renduDansEspace(r.origine, chat.lieu ?? null) && (direct ? r.roleId === agentId : r.chatId === chat.id));
  const total = livrables.reduce((n, r) => n + (r.taille ?? 0), 0);
  const surCePc = !!bridge && !chat.lieu;
  const { menu, ouvrir: ouvrirMenu, fermer: fermerMenu } = useMenuContextuel<Rendu>();
  const { suivis, telecharger, oublier, enCours } = useTelechargements();
  if (!livrables.length && !(direct && surCePc)) return null;

  return (
    <section aria-label="Livrables" className="flex flex-col gap-2 p-3 pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-ui-xs font-semibold text-texte-principal">{direct ? `Livrables de ${agent.name}` : "Livrables de cette conversation"}</span>
        {livrables.length > 0 && <span className="klyra-mono text-ui-2xs text-texte-tertiaire">{livrables.length} · {tailleLisible(total)}</span>}
      </div>
      {livrables.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {livrables.slice(0, 30).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => ouvrirLivrable(r)}
                onContextMenu={(e) => ouvrirMenu(e, r)}
                title={`${r.titre}\n${r.origine}\nClic pour l’ouvrir, clic droit pour le télécharger`}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent p-1.5 text-left hover:bg-fond-survol"
              >
                <PastilleExtension chemin={r.origine} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-ui-s font-medium text-texte-principal">{r.titre}</span>
                  <span className="truncate text-ui-2xs text-texte-tertiaire">
                    {tailleLisible(r.taille ?? 0)} · {formatListDate(r.misAJour)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">Ce que {agent.name} publie (pages, maquettes, captures, vidéos) arrive ici et dans Artefacts.</span>
      )}
      <SuivisTelechargement suivis={suivis} oublier={oublier} />
      {menu && <MenuLivrable menu={menu} fermer={fermerMenu} enCours={enCours(menu.cible.id)} onTelecharger={telecharger} />}
      {direct && surCePc && (
        <div className="flex flex-wrap gap-1.5">
          <Bouton variant="gris" taille="compact" onClick={() => void bridge.rendus.dossierAgent(agentId, "rendus")}>
            Ses livrables
          </Bouton>
          <Bouton variant="gris" taille="compact" onClick={() => void bridge.rendus.dossierAgent(agentId, "atelier")}>
            Son dossier de travail
          </Bouton>
        </div>
      )}
    </section>
  );
}

function Fichiers({ chat }: { chat: Chat }) {
  return (
    <div className="flex flex-col">
      <Livrables chat={chat} />
      <FichiersConversation chat={chat} />
    </div>
  );
}

function FichiersConversation({ chat }: { chat: Chat }) {
  const fichiers = useFichiersChat(chat.id);
  const [filtre, setFiltre] = useState<Source | "tous">("tous");
  const bridge = getBridge();
  const { menu, ouvrir: ouvrirMenu, fermer: fermerMenu } = useMenuContextuel<string>();
  const visibles = filtre === "tous" ? fichiers : fichiers.filter((f) => f.source === filtre);
  const compte = (s: Source) => fichiers.filter((f) => f.source === s).length;

  if (!fichiers.length) {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
        <span className="text-ui-s font-medium text-texte-principal">Aucun fichier dans cette conversation</span>
        <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">
          Les fichiers que tu joins et ceux que l’agent lit, crée ou modifie s’affichent ici.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div role="radiogroup" aria-label="Filtrer les fichiers" className="flex flex-wrap gap-1">
        {(["tous", "joint", "cree", "modifie", "lu"] as const).map((s) => {
          const n = s === "tous" ? fichiers.length : compte(s);
          if (s !== "tous" && !n) return null;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={filtre === s}
              onClick={() => setFiltre(s)}
              className={cn(
                "flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border-0 px-2.5 text-ui-xs font-medium transition-colors duration-[120ms]",
                filtre === s ? "klyra-surface-sombre text-texte-inverse" : "bg-fond-surface-grise text-texte-secondaire hover:text-texte-principal",
              )}
            >
              {s === "tous" ? "Tous" : `${SOURCES[s]}s`}
              <span className="klyra-mono opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {visibles.map((f) => {
          const nom = nomFichier(f.chemin);
          const dossier = f.chemin.slice(0, f.chemin.length - nom.length).replace(/[\\/]$/, "");
          return (
            <li key={f.chemin}>
              <button
                type="button"
                onClick={() => bridge && void bridge.fichiers.montrer(f.chemin)}
                onContextMenu={(e) => ouvrirMenu(e, f.chemin)}
                title={`${f.chemin}\nClic pour le montrer ${poste.dansExplorateur}`}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent p-1.5 text-left hover:bg-fond-survol"
              >
                <PastilleExtension chemin={f.chemin} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-ui-s font-medium text-texte-principal">{nom}</span>
                  <span className="truncate text-ui-2xs text-texte-tertiaire">
                    {SOURCES[f.source]} · {formatListDate(f.at)} · {dossier.replace(/^\/Users\/[^/]+/, "~")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {menu && <MenuFichierConversation menu={menu} fermer={fermerMenu} surCePc={!!bridge && !chat.lieu} />}
    </div>
  );
}

/* ─── Onglet Tâches ────────────────────────────────────────────── */

/** La marque d'une tâche : un rond vide, un arc qui tourne, ou plein avec la coche. */
function MarqueTache({ statut }: { statut: TacheAgent["statut"] }) {
  if (statut === "fait") {
    return (
      <span aria-label="Faite" className="flex size-4 shrink-0 items-center justify-center rounded-full bg-bleu-k1-500 text-texte-inverse">
        <Icon name="check-01" size={12} />
      </span>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} aria-label={statut === "en-cours" ? "En cours" : "À faire"} className="shrink-0">
      <circle cx="8" cy="8" r="6.5" fill="none" strokeWidth="1.5" className="stroke-bordure-forte" />
      {statut === "en-cours" && (
        <circle
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="30 100"
          className="origin-center animate-spin stroke-bleu-k1-500 [animation-duration:1.2s]"
        />
      )}
    </svg>
  );
}

function Taches({ chat }: { chat: Chat }) {
  const taches = chat.taches ?? [];
  const faites = taches.filter((t) => t.statut === "fait").length;
  if (!taches.length) {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
        <span className="text-ui-s font-medium text-texte-principal">Pas de tâches pour l’instant</span>
        <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">
          Quand l’agent découpe un travail en étapes, sa liste s’affiche ici et se coche au fil de l’eau.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-fond-surface-grise">
          <span
            className="block h-full rounded-pill bg-bleu-k1-500 transition-[width] duration-[480ms] ease-sortie"
            style={{ width: `${(faites / taches.length) * 100}%` }}
          />
        </span>
        <span className="klyra-mono text-ui-xs text-texte-secondaire">
          {faites}/{taches.length}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {taches.map((t, i) => (
          <li key={i} className="flex items-start gap-2.5 rounded-sm px-1.5 py-2">
            <span className="mt-0.5">
              <MarqueTache statut={t.statut} />
            </span>
            <span
              className={cn(
                "text-ui-s leading-[1.45]",
                t.statut === "fait" ? "text-texte-tertiaire line-through decoration-bordure-forte" : "text-texte-principal",
                t.statut === "en-cours" && "font-medium",
              )}
            >
              {t.texte}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Le panneau ───────────────────────────────────────────────── */

export function PanneauLateral({
  chat,
  maximise,
  onMaximiser,
  onFermer,
  etat,
  setEtat,
  images,
  imageActive,
  onChoisirImage,
  onFermerImage,
  projet,
  modifiedLabel = null,
  adresseApercu = null,
}: {
  chat: Chat;
  /** Une conversation de projet : les onglets Aperçu et Modifié. */
  projet?: Project;
  modifiedLabel?: string | null;
  /** Une adresse locale cliquée ou annoncée par un agent : l'onglet Aperçu l'affiche. */
  adresseApercu?: { url: string; n: number } | null;
  maximise: boolean;
  onMaximiser: () => void;
  onFermer: () => void;
  etat: EtatPanneau;
  setEtat: (fn: (e: EtatPanneau) => EtatPanneau) => void;
  /** Les images ouvertes, chacune son onglet. */
  images: string[];
  imageActive: string | null;
  /** Montre une image, ou (null) revient aux onglets du panneau. */
  onChoisirImage: (chemin: string | null) => void;
  onFermerImage: (chemin: string) => void;
}) {
  const [menuAjout, setMenuAjout] = useState(false);
  const [publier, setPublier] = useState(false);
  const panneau = useRef<HTMLElement>(null);
  const ordre = ordreDe(!!projet);
  /* Hors d'un projet, les onglets du projet restent dans l'état gardé, sans s'afficher. */
  const ouverts = etat.ouverts.filter((o) => ordre.includes(o));
  const fermes = ordre.filter((o) => !ouverts.includes(o));
  const actif = ouverts.includes(etat.actif) ? etat.actif : ouverts[0];

  const fermerOnglet = (o: Onglet) =>
    setEtat((e) => {
      const restants = e.ouverts.filter((x) => x !== o);
      return { ...e, ouverts: restants, actif: e.actif === o ? (restants.find((x) => ordre.includes(x)) ?? "reglages") : e.actif };
    });
  const ouvrirOnglet = (o: Onglet) => {
    onChoisirImage(null);
    setEtat((e) => ({ ...e, ouverts: ORDRE.filter((x) => x === o || e.ouverts.includes(x)), actif: o }));
  };

  /* Une adresse demandée (lien cliqué, site lancé par un agent) : l'onglet Aperçu passe devant. */
  const demande = projet ? (adresseApercu?.n ?? 0) : 0;
  useEffect(() => {
    if (!demande) return;
    onChoisirImage(null);
    setEtat((e) => ({ ...e, ouverts: ORDRE.filter((x) => x === "apercu" || e.ouverts.includes(x)), actif: "apercu" }));
  }, [demande, setEtat, onChoisirImage]);

  /* L'aperçu prend un peu plus de place, sans écraser la conversation. */
  const surApercu = !imageActive && actif === "apercu";
  useEffect(() => {
    if (!surApercu) return;
    const max = (panneau.current?.parentElement?.clientWidth ?? 1200) - 424;
    setEtat((s) => (s.largeur >= LARGEUR_APERCU ? s : { ...s, largeur: Math.max(s.largeur, Math.min(LARGEUR_APERCU, max)) }));
  }, [surApercu, setEtat]);

  /* Un agent passe la main à la personne sur une page : le Navigateur s'ouvre de lui-même. */
  const activite = useActiviteNavigateur(chat.id);
  useEffect(() => {
    if (activite !== "attente") return;
    onChoisirImage(null);
    setEtat((e) => ({ ...e, ouverts: ORDRE.filter((x) => x === "navigateur" || e.ouverts.includes(x)), actif: "navigateur" }));
  }, [activite, setEtat, onChoisirImage]);

  /* Plus aucun onglet : le panneau se ferme. */
  useEffect(() => {
    if (!ouverts.length && !images.length) onFermer();
  }, [ouverts.length, images.length, onFermer]);

  /* Une image a besoin de place : le panneau s'élargit, sans écraser la conversation. */
  useEffect(() => {
    if (!imageActive) return;
    const max = (panneau.current?.parentElement?.clientWidth ?? 1200) - 424;
    setEtat((s) => (s.largeur >= LARGEUR_IMAGE ? s : { ...s, largeur: Math.max(s.largeur, Math.min(LARGEUR_IMAGE, max)) }));
  }, [imageActive, setEtat]);

  /* Poignée : on tire le bord gauche. Double-clic : largeur par défaut. */
  const tirer = (depart: React.PointerEvent) => {
    const x0 = depart.clientX;
    const l0 = etat.largeur;
    const max = () => (panneau.current?.parentElement?.clientWidth ?? 1200) - 424;
    const bouger = (e: PointerEvent) =>
      setEtat((s) => ({ ...s, largeur: Math.max(LARGEUR_MIN, Math.min(max(), l0 + x0 - e.clientX)) }));
    const lacher = () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
  };
  const clavierPoignee = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setEtat((s) => ({ ...s, largeur: Math.max(LARGEUR_MIN, s.largeur + (e.key === "ArrowLeft" ? 12 : -12)) }));
  };

  return (
    <aside
      ref={panneau}
      aria-label="Panneau de la conversation"
      className={cn("relative flex min-w-0 shrink-0 flex-col border-l border-bordure-subtile bg-fond-surface", maximise && "flex-1 border-l-0")}
      style={maximise ? undefined : { width: etat.largeur }}
    >
      {!maximise && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Largeur du panneau"
          aria-valuenow={etat.largeur}
          tabIndex={0}
          onPointerDown={tirer}
          onDoubleClick={() => setEtat((s) => ({ ...s, largeur: LARGEUR_DEFAUT }))}
          onKeyDown={clavierPoignee}
          className="group/poignee absolute top-0 bottom-0 -left-2 z-10 w-4 cursor-col-resize"
        >
          <span className="absolute top-0 bottom-0 left-2 w-px bg-transparent transition-colors duration-[120ms] group-hover/poignee:bg-bleu-k1-500 group-focus-visible/poignee:bg-bleu-k1-500" />
        </div>
      )}

      {/* Onglets, et à droite : ajouter, agrandir, fermer. */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-bordure-subtile px-2">
        <div role="tablist" aria-label="Onglets du panneau" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {ouverts.map((o) => {
            const choisi = !imageActive && o === actif;
            return (
              <div
                key={o}
                className={cn(
                  "group/onglet flex h-7 shrink-0 items-center gap-1.5 rounded-sm pr-2 pl-1.5 text-ui-xs font-medium transition-colors duration-[120ms]",
                  choisi ? "bg-fond-surface-grise text-texte-principal" : "text-texte-secondaire hover:bg-fond-survol",
                )}
              >
                {/* Au survol, l'icône devient la croix qui ferme l'onglet. */}
                <button
                  type="button"
                  onClick={() => fermerOnglet(o)}
                  aria-label={`Fermer l’onglet ${ONGLETS[o].nom}`}
                  data-son="fermer"
                  className="flex size-4 cursor-pointer items-center justify-center rounded-2xs border-0 bg-transparent p-0 text-icone-secondaire"
                >
                  <Icon name={ONGLETS[o].icone} size={14} className="group-hover/onglet:hidden" />
                  <Icon name="x-01" size={12} className="hidden group-hover/onglet:block" />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={choisi}
                  onClick={() => {
                    onChoisirImage(null);
                    setEtat((e) => ({ ...e, actif: o }));
                  }}
                  className="cursor-pointer border-0 bg-transparent p-0 text-inherit"
                >
                  {ONGLETS[o].nom}
                </button>
                {o === "navigateur" && activite && (
                  <span
                    aria-label={activite === "attente" ? "Un agent t’attend dans le navigateur" : "Un agent utilise le navigateur"}
                    className={cn("size-1.5 rounded-full bg-bleu-k1-500", activite === "pilote" && "klyra-respire")}
                  />
                )}
              </div>
            );
          })}
          {images.map((chemin) => {
            const nom = nomImage(chemin);
            return (
              <div
                key={chemin}
                title={nomFichier(chemin)}
                className={cn(
                  "group/onglet flex h-7 min-w-0 items-center gap-1.5 rounded-sm pr-2 pl-1.5 text-ui-xs font-medium transition-colors duration-[120ms]",
                  chemin === imageActive ? "bg-fond-surface-grise text-texte-principal" : "text-texte-secondaire hover:bg-fond-survol",
                )}
              >
                <button
                  type="button"
                  onClick={() => onFermerImage(chemin)}
                  aria-label={`Fermer l’onglet ${nom}`}
                  data-son="fermer"
                  className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-2xs border-0 bg-transparent p-0 text-icone-secondaire"
                >
                  <Icon name="image-01" size={14} className="group-hover/onglet:hidden" />
                  <Icon name="x-01" size={12} className="hidden group-hover/onglet:block" />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={chemin === imageActive}
                  onClick={() => onChoisirImage(chemin)}
                  className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-inherit"
                >
                  {nom}
                </button>
              </div>
            );
          })}
        </div>

        {fermes.length > 0 && (
          <div className="relative">
            <BoutonIcone
              taille="mini"
              icone={<Icon name="plus-01" size={16} />}
              libelle="Ajouter un onglet"
              aria-expanded={menuAjout}
              onClick={() => setMenuAjout((v) => !v)}
              className="text-icone-secondaire"
            />
            {menuAjout && (
              <div data-flottant className="absolute top-full right-0 z-50 mt-1 flex w-44 flex-col rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-flottante">
                {fermes.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => {
                      ouvrirOnglet(o);
                      setMenuAjout(false);
                    }}
                    className="flex h-8 cursor-pointer items-center gap-2 rounded-2xs border-0 bg-transparent px-2 text-left text-ui-s text-texte-principal hover:bg-fond-survol"
                  >
                    <Icon name={ONGLETS[o].icone} size={16} className="text-icone-secondaire" />
                    {ONGLETS[o].nom}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <BoutonIcone
          taille="mini"
          icone={<Icon name={maximise ? "minimise-01" : "expand"} size={16} />}
          libelle={maximise ? "Réduire le panneau" : "Agrandir le panneau"}
          onClick={onMaximiser}
          className="text-icone-secondaire"
        />
        <BoutonIcone
          taille="mini"
          icone={<Icon name="layout-right" size={16} />}
          libelle="Fermer le panneau"
          data-son="fermer"
          onClick={onFermer}
          className="text-icone-secondaire"
        />
      </div>

      <div role="tabpanel" className={cn("min-h-0 flex-1", imageActive || actif === "navigateur" || actif === "apercu" ? "flex flex-col" : "overflow-y-auto")}>
        {/* L'aperçu reste monté derrière les autres onglets : ses pages ne se rechargent pas. */}
        {projet && ouverts.includes("apercu") && (
          <ApercuSite key={projet.id} project={projet} modifiedLabel={modifiedLabel} adresseDemandee={adresseApercu} visible={!imageActive && actif === "apercu"} />
        )}
        {imageActive ? (
          <VueImage key={imageActive} chemin={imageActive} />
        ) : (
          <>
            {actif === "reglages" && <ReglagesAgent key={chat.id} chat={chat} />}
            {actif === "modifie" && projet && <VueModifies project={projet} onPublier={() => setPublier(true)} />}
            {actif === "fichiers" && <Fichiers chat={chat} />}
            {actif === "taches" && <Taches chat={chat} />}
            {actif === "navigateur" && <PanneauNavigateur key={chat.id} chat={chat} />}
          </>
        )}
      </div>
      {publier && projet && <Publier project={projet} onFermer={() => setPublier(false)} />}
    </aside>
  );
}
