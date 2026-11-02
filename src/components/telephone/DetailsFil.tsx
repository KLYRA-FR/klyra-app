"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { Onglets } from "@/components/ui/Onglets";
import { cn } from "@/lib/cn";
import { lireParties } from "@/lib/copie-compte";
import { formatListDate } from "@/lib/format";
import { useLecturePoste } from "@/lib/poste/client";
import { agentDe, type ConversationLue } from "@/lib/telephone/chats";
import type { MessageLu } from "@/lib/telephone/export";
import { Feuille } from "./Feuille";
import { PosteFerme, SurLePoste, VueLecture } from "./etats";
import { usePostes } from "./poste";
import { RondAgent, useCartes } from "./AgentsChat";

type Onglet = "agent" | "fichiers" | "taches" | "apercu";
type Source = "joint" | "cree" | "modifie" | "lu";
const SOURCES: Record<Source, string> = { joint: "Joint", cree: "Créé", modifie: "Modifié", lu: "Lu" };
const FILTRES: { id: Source | "tous"; libelle: string }[] = [
  { id: "tous", libelle: "Tous" },
  { id: "joint", libelle: "Joint" },
  { id: "cree", libelle: "Créé" },
  { id: "modifie", libelle: "Modifié" },
];

interface FichierFil {
  nom: string;
  chemin: string | null;
  source: Source;
  le: string;
}

/** Les fichiers du fil, comme le panneau du bureau : joints par toi, créés, modifiés ou lus par l'agent. */
export function fichiersDuFil(messages: MessageLu[]): FichierFil[] {
  const parCle = new Map<string, FichierFil>();
  const rang: Record<Source, number> = { lu: 0, joint: 1, modifie: 2, cree: 3 };
  const noter = (f: FichierFil) => {
    const cle = f.chemin ?? `~${f.nom}`;
    const avant = parCle.get(cle);
    if (!avant || rang[f.source] >= rang[avant.source]) parCle.set(cle, f);
  };
  for (const m of messages) {
    for (const p of lireParties(m.parties)) {
      if (p.type === "fichiers") p.fichiers?.forEach((f) => noter({ ...f, source: "joint", le: m.creeLe }));
      if (p.type === "etapes") p.fichiers?.forEach((f) => noter({ nom: f.nom, chemin: f.chemin, source: f.source, le: m.creeLe }));
    }
  }
  return [...parCle.values()].sort((a, b) => b.le.localeCompare(a.le));
}

function Agent({ conversation, origine }: { conversation: ConversationLue | undefined; origine: string }) {
  const { nom, carte } = useCartes();
  const { ouvert } = usePostes();
  const agent = agentDe(origine, conversation);
  const ids = agent ? [agent] : (conversation?.roleIds ?? []);
  if (!ouvert) return <PosteFerme phrase={(sur) => `la fiche de ${agent ? nom(agent) : "chaque agent"} est sur ${sur}. Elle s’affiche quand KLYRA y est ouverte.`} />;
  return (
    <ul className="pt-2">
      {ids.map((id) => (
        <li key={id}>
          <Link href={`/equipe?agent=${encodeURIComponent(id)}`} className="flex min-h-16 items-center gap-3 border-b border-bordure-subtile py-2 no-underline last:border-b-0">
            <RondAgent id={id} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-s text-texte-principal">{nom(id)}</span>
              <span className="truncate text-ui text-texte-secondaire">{carte(id)?.roleCourt}</span>
            </span>
            <span className="text-ui text-texte-secondaire">Voir la fiche</span>
            <Icon name="chevron-right" size={18} className="text-icone-secondaire" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Fichiers({ messages, projetId }: { messages: MessageLu[]; projetId: string | null }) {
  const fichiers = useMemo(() => fichiersDuFil(messages), [messages]);
  const [filtre, setFiltre] = useState<Source | "tous">("tous");
  const visibles = filtre === "tous" ? fichiers : fichiers.filter((f) => f.source === filtre);
  if (!fichiers.length) {
    return (
      <div className="pt-6">
        <p className="text-body-s text-texte-principal">Rien de modifié</p>
        <p className="mt-1 text-ui text-texte-secondaire">Les fichiers que tu joins et ceux que l’agent lit, crée ou modifie s’affichent ici.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 pt-2">
      <div role="radiogroup" aria-label="Filtrer les fichiers" className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {FILTRES.map((f) => {
          const n = f.id === "tous" ? fichiers.length : fichiers.filter((x) => x.source === f.id).length;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filtre === f.id}
              onClick={() => setFiltre(f.id)}
              className={cn("flex h-11 shrink-0 items-center gap-1.5 rounded-xs px-3 text-ui font-medium", filtre === f.id ? "klyra-surface-sombre text-texte-inverse" : "bg-fond-surface-grise text-texte-secondaire")}
            >
              {f.libelle}
              <span className="opacity-80">{n}</span>
            </button>
          );
        })}
      </div>
      {visibles.length === 0 ? <p className="text-ui text-texte-secondaire">Aucun fichier de ce genre.</p> : null}
      <ul>
        {visibles.map((f) => {
          const dossier = f.chemin && f.chemin.includes("/") ? f.chemin.slice(0, f.chemin.lastIndexOf("/")) : null;
          const ligne = (
            <>
              <Icon name="file-01" size={20} className="shrink-0 text-icone-secondaire" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-s text-texte-principal">{f.nom}</span>
                <span className="truncate text-ui-xs text-texte-secondaire">
                  {SOURCES[f.source]} · {formatListDate(f.le)}
                  {dossier ? ` · ${dossier}` : ""}
                </span>
              </span>
            </>
          );
          return (
            <li key={`${f.chemin ?? f.nom}-${f.source}`} className="border-b border-bordure-subtile last:border-b-0">
              {projetId && f.chemin ? (
                <Link href={`/projet?id=${encodeURIComponent(projetId)}&fichier=${encodeURIComponent(f.chemin)}`} className="flex min-h-14 items-center gap-3 py-2 no-underline">
                  {ligne}
                  <Icon name="chevron-right" size={18} className="text-icone-secondaire" />
                </Link>
              ) : (
                <span className="flex min-h-14 items-center gap-3 py-2">{ligne}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const MARQUES = { "a-faire": "À faire", "en-cours": "En cours", fait: "Faite" } as const;

function Taches({ conversation }: { conversation: ConversationLue | undefined }) {
  const json = conversation?.taches ?? "[]";
  const taches = useMemo(() => {
    try {
      const brut = JSON.parse(json) as { texte?: unknown; statut?: unknown }[];
      return Array.isArray(brut)
        ? brut.filter((t): t is { texte: string; statut: keyof typeof MARQUES } => typeof t.texte === "string" && typeof t.statut === "string" && t.statut in MARQUES)
        : [];
    } catch {
      return [];
    }
  }, [json]);
  if (!taches.length) {
    return (
      <div className="pt-6">
        <p className="text-body-s text-texte-principal">Pas de tâches</p>
        <p className="mt-1 text-ui text-texte-secondaire">Quand l’agent découpe un travail en étapes, sa liste s’affiche ici et se coche au fil de l’eau.</p>
      </div>
    );
  }
  const faites = taches.filter((t) => t.statut === "fait").length;
  return (
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-ui text-texte-secondaire">
        {faites} sur {taches.length} faites
      </p>
      <ul>
        {taches.map((t, i) => (
          <li key={i} className="flex min-h-11 items-start gap-3 py-2">
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                t.statut === "fait" ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : t.statut === "en-cours" ? "border-bleu-k1-500" : "border-bordure-forte",
              )}
            >
              {t.statut === "fait" ? <Icon name="check-01" size={14} /> : null}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={cn("text-body-s", t.statut === "fait" ? "text-texte-secondaire line-through" : "text-texte-principal", t.statut === "en-cours" && "font-medium")}>{t.texte}</span>
              <span className="text-ui-xs text-texte-secondaire">{MARQUES[t.statut]}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Apercu({ origine, conversation }: { origine: string; conversation: ConversationLue | undefined }) {
  const lecture = useLecturePoste<{ adresse: string | null; locale: boolean }>("fil.apercu", conversation?.projetId ? { conversation: origine } : null);
  if (!conversation?.projetId) return <p className="pt-6 text-ui text-texte-secondaire">Pas d’aperçu : cette conversation n’est pas dans un projet.</p>;
  return (
    <VueLecture lecture={lecture} ferme={(sur) => `l’aperçu de ce projet est sur ${sur}. Il s’affiche quand KLYRA y est ouverte.`} lignes={1}>
      {({ adresse, locale }) =>
        adresse ? (
          <div className="pt-4">
            <p className="truncate text-ui text-texte-secondaire">{adresse}</p>
            <a href={adresse} target="_blank" rel="noreferrer" className="klyra-surface-sombre mt-3 flex h-11 items-center justify-center rounded-xs px-4 text-body-s text-texte-inverse no-underline">
              Ouvrir dans le navigateur
            </a>
          </div>
        ) : locale ? (
          <SurLePoste titre="Aperçu" raison="l’aperçu est servi par ton ordinateur." />
        ) : (
          <p className="pt-6 text-ui text-texte-secondaire">Ce projet n’a pas d’adresse d’aperçu.</p>
        )
      }
    </VueLecture>
  );
}

/**
 * T-03 : le panneau latéral du bureau devient une feuille haute à onglets. Agent (la fiche, sur
 * l'ordinateur), Fichiers (tirés du fil, Compte), Tâches (Compte), Aperçu (Poste), et l'export.
 */
export function DetailsFil({
  origine,
  conversation,
  messages,
  onExporter,
  onFermer,
}: {
  origine: string;
  conversation: ConversationLue | undefined;
  messages: MessageLu[];
  onExporter: () => void;
  onFermer: () => void;
}) {
  const [onglet, setOnglet] = useState<Onglet>("agent");
  return (
    <Feuille
      titre="Détails"
      haute
      onFermer={onFermer}
      pied={
        <button type="button" className="flex h-11 w-full items-center justify-center gap-2 rounded-xs border border-bordure-subtile text-body-s text-texte-principal" onClick={onExporter}>
          <Icon name="download-02" size={18} />
          Exporter en Markdown…
        </button>
      }
    >
      <Onglets
        libelle="Détails de la conversation"
        className="mt-1 flex w-full [&>*]:min-h-11 [&>*]:flex-1"
        valeur={onglet}
        onChange={setOnglet}
        onglets={[
          { id: "agent", label: "Agent" },
          { id: "fichiers", label: "Fichiers" },
          { id: "taches", label: "Tâches" },
          { id: "apercu", label: "Aperçu" },
        ]}
      />
      <div role="tabpanel" aria-label={onglet}>
        {onglet === "agent" ? <Agent conversation={conversation} origine={origine} /> : null}
        {onglet === "fichiers" ? <Fichiers messages={messages} projetId={conversation?.projetId ?? null} /> : null}
        {onglet === "taches" ? <Taches conversation={conversation} /> : null}
        {onglet === "apercu" ? <Apercu origine={origine} conversation={conversation} /> : null}
      </div>
    </Feuille>
  );
}
