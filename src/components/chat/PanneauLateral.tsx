"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NIVEAUX_ACCES } from "@/lib/acces";
import { Icon, type IconName } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { nomFichier } from "@/lib/fichiers";
import { formatListDate } from "@/lib/format";
import { poste } from "@/lib/plateforme";
import { useChatMessages, useProject, useRole, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat, TacheAgent } from "@/types/domain";
import { ChoixModele } from "./ChoixModele";
import { PastilleExtension } from "./PastilleExtension";

/**
 * Panneau à droite d'une conversation, à onglets : les réglages de l'agent,
 * les fichiers de la conversation, ses tâches. On ferme un onglet, on le
 * rouvre avec « + », on élargit le panneau à la poignée ou on l'agrandit.
 */

export type Onglet = "reglages" | "fichiers" | "taches";

const ONGLETS: Record<Onglet, { nom: string; icone: IconName }> = {
  reglages: { nom: "Réglages", icone: "settings" },
  fichiers: { nom: "Fichiers", icone: "folder" },
  taches: { nom: "Tâches", icone: "list" },
};
const ORDRE: Onglet[] = ["reglages", "fichiers", "taches"];

const LARGEUR_DEFAUT = 340;
const LARGEUR_MIN = 296;
const CLE = "klyra-panneau-lateral";

interface EtatPanneau {
  ouverts: Onglet[];
  actif: Onglet;
  largeur: number;
}

/** L'état du panneau, gardé d'une session à l'autre (préférence de cet écran seulement). */
export function usePanneauLateral() {
  const [etat, setEtat] = useState<EtatPanneau>(() => {
    try {
      const brut = JSON.parse(localStorage.getItem(CLE) ?? "null") as EtatPanneau | null;
      if (brut?.ouverts?.length) return brut;
    } catch {
      /* stockage indisponible */
    }
    return { ouverts: [...ORDRE], actif: "reglages", largeur: LARGEUR_DEFAUT };
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

/* ─── Onglet Réglages ──────────────────────────────────────────── */

function Groupe({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-ui-xs font-medium text-texte-tertiaire">{titre}</h3>
      {children}
    </section>
  );
}

function Ligne({ libelle, valeur }: { libelle: string; valeur: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-ui-s">
      <span className="shrink-0 text-texte-secondaire">{libelle}</span>
      <span className="min-w-0 text-right text-texte-principal">{valeur}</span>
    </div>
  );
}

function Reglages({ chat }: { chat: Chat }) {
  const router = useRouter();
  const role = useRole(chat.roleIds[0] ?? "principal");
  const project = useProject(chat.projectId);
  const travail = useTravail(chat.id);
  const { nouvelleConversation, state } = useWorkspace();
  const acces = state.acces;
  const [confirmer, setConfirmer] = useState(false);
  const dossier = chat.kind === "equipe" ? (project?.folder ?? "—") : "~/.klyra/atelier";

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-3">
        <AgentRond roleId={role.id} taille={52} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-ui font-semibold text-texte-principal">{role.name}</span>
          <span className="truncate text-ui-xs text-texte-tertiaire">{role.title}</span>
        </div>
      </div>

      <Groupe titre="Cerveau">
        <ChoixModele chat={chat} variante="champ" />
        <p className="m-0 text-ui-2xs leading-[1.45] text-texte-tertiaire">
          Pour cette conversation. Sans choix, l’agent prend le modèle de sa fiche.
        </p>
      </Groupe>

      {role.whenToCall && (
        <Groupe titre="Quand l’appeler">
          <p className="m-0 text-ui-s leading-[1.5] text-texte-principal">{role.whenToCall}</p>
        </Groupe>
      )}

      {role.skills.length > 0 && (
        <Groupe titre="Ce qu’il sait faire">
          <div className="flex flex-wrap gap-1.5">
            {role.skills.map((s) => (
              <span key={s} className="rounded-2xs bg-fond-surface-grise px-2 py-0.5 text-ui-xs text-texte-principal">
                {s}
              </span>
            ))}
          </div>
        </Groupe>
      )}

      <Groupe titre="Travail">
        <div className="flex flex-col divide-y divide-bordure-subtile rounded-md border border-bordure-subtile px-3">
          <Ligne libelle="Dossier" valeur={<span className="klyra-mono text-ui-xs [overflow-wrap:anywhere]">{dossier}</span>} />
          <Ligne
            libelle="Accès"
            valeur={
              <Link href="/reglages" className="text-texte-principal underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent">
                {NIVEAUX_ACCES.find((n) => n.id === acces)?.nom}
              </Link>
            }
          />
          <Ligne libelle="Mémoire" valeur={role.memory || "—"} />
        </div>
      </Groupe>

      <Groupe titre="Conversation">
        {confirmer ? (
          <div className="flex flex-col gap-2 rounded-md border border-bordure-subtile bg-fond-page p-3">
            <p className="m-0 text-ui-s leading-[1.45] text-texte-principal">
              Les messages et ce que {role.name} retient de cette conversation seront effacés.
            </p>
            <div className="flex gap-2">
              <Bouton
                variant="sombre"
                taille="compact"
                onClick={() => {
                  nouvelleConversation(chat.id);
                  setConfirmer(false);
                }}
              >
                Effacer et repartir
              </Bouton>
              <Bouton variant="blanc" taille="compact" onClick={() => setConfirmer(false)}>
                Annuler
              </Bouton>
            </div>
          </div>
        ) : (
          <Bouton
            variant="blanc"
            taille="compact"
            disabled={!!travail}
            iconeGauche={<Icon name="refresh-01" size={16} />}
            onClick={() => setConfirmer(true)}
            className="self-start"
          >
            Nouvelle conversation
          </Bouton>
        )}
        {role.file && (
          <Bouton
            variant="discret"
            taille="compact"
            iconeGauche={<Icon name="file-code" size={16} />}
            onClick={() => router.push(`/equipe?agent=${role.id}&mode=modifier`)}
            className="self-start"
          >
            Modifier la fiche de {role.name}
          </Bouton>
        )}
      </Groupe>
    </div>
  );
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

function Fichiers({ chat }: { chat: Chat }) {
  const fichiers = useFichiersChat(chat.id);
  const [filtre, setFiltre] = useState<Source | "tous">("tous");
  const bridge = getBridge();
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
}: {
  chat: Chat;
  maximise: boolean;
  onMaximiser: () => void;
  onFermer: () => void;
  etat: EtatPanneau;
  setEtat: (fn: (e: EtatPanneau) => EtatPanneau) => void;
}) {
  const [menuAjout, setMenuAjout] = useState(false);
  const panneau = useRef<HTMLElement>(null);
  const fermes = ORDRE.filter((o) => !etat.ouverts.includes(o));
  const actif = etat.ouverts.includes(etat.actif) ? etat.actif : etat.ouverts[0];

  const fermerOnglet = (o: Onglet) =>
    setEtat((e) => {
      const ouverts = e.ouverts.filter((x) => x !== o);
      return { ...e, ouverts, actif: e.actif === o ? (ouverts[0] ?? "reglages") : e.actif };
    });
  const ouvrirOnglet = (o: Onglet) =>
    setEtat((e) => ({ ...e, ouverts: ORDRE.filter((x) => x === o || e.ouverts.includes(x)), actif: o }));

  /* Plus aucun onglet : le panneau se ferme. */
  useEffect(() => {
    if (!etat.ouverts.length) onFermer();
  }, [etat.ouverts.length, onFermer]);

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
      <div className="flex h-[57px] shrink-0 items-center gap-1 border-b border-bordure-subtile px-2">
        <div role="tablist" aria-label="Onglets du panneau" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {etat.ouverts.map((o) => {
            const choisi = o === actif;
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
                  onClick={() => setEtat((e) => ({ ...e, actif: o }))}
                  className="cursor-pointer border-0 bg-transparent p-0 text-inherit"
                >
                  {ONGLETS[o].nom}
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
              <div className="absolute top-full right-0 z-50 mt-1 flex w-44 flex-col rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-flottante">
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

      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
        {actif === "reglages" && <Reglages chat={chat} />}
        {actif === "fichiers" && <Fichiers chat={chat} />}
        {actif === "taches" && <Taches chat={chat} />}
      </div>
    </aside>
  );
}
