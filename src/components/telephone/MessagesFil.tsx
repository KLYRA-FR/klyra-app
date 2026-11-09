"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Markdown } from "@/components/ui/Markdown";
import { plagesDans, SURLIGNAGE } from "@/components/recherche/surligner";
import { cn } from "@/lib/cn";
import { lireParties, type Activite, type PartieCompte } from "@/lib/copie-compte";
import { formatDaySeparator, formatJourHeure, formatTime, isSameDay } from "@/lib/format";
import { attenteEnvoi } from "@/lib/poste-texte";
import { confierAEditeur } from "@/lib/proposition-agent";
import { requeteRetenue } from "@/lib/recherche-session";
import { ajouterAuBrouillon } from "@/lib/brouillons";
import { messageErreur } from "@/lib/compte";
import { repondreA } from "@/lib/repondre";
import { estDemandeResume, idDirect, NOMS_REACTIONS, type ConversationLue } from "@/lib/telephone/chats";
import { citationDuMessage } from "@/lib/telephone/citation";
import type { MessageLu } from "@/lib/telephone/export";
import { taillePiece } from "@/lib/telephone/pieces";
import { useAnnonce } from "./Annonce";
import { useAppuiLong } from "./Feuille";
import { NotePoste } from "./etats";
import { usePostes, useSupport } from "./poste";
import { RondAgent, useCartes } from "./AgentsChat";
import { CarteAccordChat } from "./CarteAccordChat";
import { CarteAtelierTelephone, ChoixTelephone, LigneAtelierTelephone } from "./AtelierTelephone";
import { CarteEquipeTelephone, LigneEquipeTelephone } from "./EquipeTelephone";
import { CarteTelephone } from "./CarteTelephone";
import { ActionsMessage, arreterLecture } from "./ActionsMessage";
import { AvecLiensFilsTelephone } from "./LienFilTelephone";
import type { MessageEnAttente } from "@/lib/telephone/chats";

/** Deux messages du même auteur à moins de 5 min d'écart forment un groupe : un seul nom, un seul rond (comme au bureau). */
const GROUPE_MS = 5 * 60 * 1000;
const ECLAIRAGE_MS = 1800;

const memeAuteur = (a: MessageLu, b: MessageLu) => a.auteurKind === b.auteurKind && (a.auteurKind === "user" || a.auteurId === b.auteurId);

/** Ce que le fil donne à chaque message pour agir : envoyer un message (action proposée), ouvrir un fichier du projet. */
export interface ContexteFil {
  origine: string;
  projetId: string | null;
  activite: Activite | null;
  /** Le modèle choisi pour la conversation (null : celui de la fiche). */
  modele: string | null;
  /** Envoie un message court par la file (une action proposée par l'agent, « Réessayer »…). */
  envoyer: (texte: string, options: Record<string, unknown>) => void;
  onBandeau: (texte: string) => void;
  /** Mettre ou retirer une réaction : une marque du compte, jamais un message à l'agent. */
  reagir: (messageOrigine: string, emoji: string, mise: boolean) => void;
  conversation: ConversationLue | undefined;
}

/* ─── Les parties d'un message ─────────────────────────────────── */

const lienFichier = (projetId: string | null, chemin: string | null) =>
  projetId && chemin ? `/projet?id=${encodeURIComponent(projetId)}&fichier=${encodeURIComponent(chemin)}` : null;

/**
 * Les liens d'une réponse : le web s'ouvre dans le navigateur du téléphone ; un chemin du projet ouvre
 * la visionneuse (T-13) ; une adresse locale reste sur l'ordinateur.
 */
function suivreLien(e: MouseEvent, projetId: string | null, router: ReturnType<typeof useRouter>, onLocal: () => void) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  const url = new URL(a.href, window.location.href);
  e.preventDefault();
  e.stopPropagation();
  if (/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) return onLocal();
  /* `Lien` du bureau a fait « http://docs/README.md » d'un chemin relatif : un hôte sans point. */
  if (!url.hostname.includes(".") && url.protocol.startsWith("http")) {
    const chemin = `${url.hostname}${decodeURIComponent(url.pathname)}`.replace(/\/$/, "");
    const lien = lienFichier(projetId, chemin);
    if (lien) router.push(lien);
    return;
  }
  if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") window.open(url.href, "_blank", "noreferrer");
}

function Bulle({ texte, ton, projetId, onLocal }: { texte: string; ton: "user" | "role"; projetId: string | null; onLocal: () => void }) {
  const router = useRouter();
  if (ton === "user") {
    return (
      <div data-cherchable className="w-fit max-w-[85%] self-end rounded-xl bg-fond-inverse px-3.5 py-2 text-body-s leading-[1.5] whitespace-pre-wrap text-texte-inverse [overflow-wrap:anywhere]">
        {texte}
      </div>
    );
  }
  return (
    <div data-cherchable onClickCapture={(e) => suivreLien(e, projetId, router, onLocal)} className="w-fit max-w-full min-w-0 rounded-xl bg-fond-survol px-3.5 py-2.5 [overflow-wrap:anywhere]">
      <AvecLiensFilsTelephone>
        <Markdown source={texte} className="gap-2 text-body-s leading-[1.55] text-texte-principal" />
      </AvecLiensFilsTelephone>
    </div>
  );
}

const SOURCES = { cree: "Créé", modifie: "Modifié", lu: "Lu" } as const;

/** « 6 étapes · 2 fichiers modifiés », replié ; l'étape en cours pendant le travail ; dépliée : les fichiers touchés. */
function Etapes({ partie, enCours, projetId }: { partie: Extract<PartieCompte, { type: "etapes" }>; enCours: boolean; projetId: string | null }) {
  const [ouvert, setOuvert] = useState(false);
  if (!partie.n) return null;
  const resume = [
    `${partie.n} étape${partie.n > 1 ? "s" : ""}`,
    partie.modifies ? `${partie.modifies} fichier${partie.modifies > 1 ? "s" : ""} modifié${partie.modifies > 1 ? "s" : ""}` : null,
    partie.erreurs ? `${partie.erreurs} en erreur` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const fichiers = partie.fichiers ?? [];
  const contenu =
    enCours && partie.enCours && !ouvert ? <span className="klyra-respire truncate font-medium text-texte-principal">{partie.enCours}…</span> : <span className="truncate">{resume}</span>;
  if (!fichiers.length) return <p className="flex min-h-8 items-center px-1 text-ui text-texte-secondaire">{contenu}</p>;
  return (
    <div className="flex flex-col gap-1">
      <button type="button" aria-expanded={ouvert} onClick={() => setOuvert((v) => !v)} className="flex min-h-11 w-fit max-w-full items-center gap-1.5 px-1 text-left text-ui text-texte-secondaire">
        <Icon name="chevron-right" size={16} className={cn("shrink-0 transition-transform duration-[220ms] ease-sortie", ouvert && "rotate-90")} />
        {contenu}
      </button>
      {ouvert ? (
        <ul className="ml-3 flex flex-col border-l border-bordure-subtile pl-3">
          {fichiers.map((f, i) => {
            const lien = lienFichier(projetId, f.chemin);
            const ligne = (
              <>
                <span className="truncate text-texte-principal">{f.nom}</span>
                <span className="shrink-0">· {SOURCES[f.source]}</span>
              </>
            );
            return (
              <li key={`${f.chemin ?? f.nom}-${i}`} className="text-ui text-texte-secondaire">
                {lien ? (
                  <Link href={lien} className="flex min-h-11 items-center gap-1.5 no-underline">
                    {ligne}
                  </Link>
                ) : (
                  <span className="flex min-h-9 items-center gap-1.5">{ligne}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function Passation({ partie }: { partie: Extract<PartieCompte, { type: "passation" }> }) {
  const { nom } = useCartes();
  const libelle = partie.statut === "en-cours" ? "Confié à" : partie.statut === "fait" ? "Rendu par" : "Arrêté chez";
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 self-center px-2 text-center text-ui text-texte-secondaire">
      <span className={cn(partie.statut === "en-cours" && "klyra-respire")}>{libelle}</span>
      <Link href={`/chat?id=${encodeURIComponent(idDirect(partie.roleId))}`} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-texte-principal no-underline">
        <RondAgent id={partie.roleId} taille={24} />
        {nom(partie.roleId)}
      </Link>
      {partie.consigne ? <span className="[overflow-wrap:anywhere]">· {partie.consigne}</span> : null}
      {partie.etapes ? <span>· {partie.etapes} étape{partie.etapes > 1 ? "s" : ""}</span> : null}
    </div>
  );
}

function Proposition({ partie, remplacee }: { partie: Extract<PartieCompte, { type: "proposition-agent" }>; remplacee: boolean }) {
  const { ouvert } = usePostes();
  return (
    <div className={cn("flex w-full flex-col gap-3 rounded-xl border border-bordure-subtile bg-fond-surface p-4", remplacee && "text-texte-secondaire")}>
      <span className="text-ui-xs text-texte-secondaire">Proposition d’agent</span>
      <span className="text-body-s text-texte-principal">
        <strong className="font-semibold">{partie.nom}</strong>
        {partie.role ? ` · ${partie.role}` : ""}
      </span>
      {partie.description ? <p className="line-clamp-3 text-ui text-texte-secondaire">{partie.description}</p> : null}
      {remplacee ? (
        <span className="text-ui-xs">Remplacée par la proposition suivante</span>
      ) : ouvert ? (
        /* C-5 : l'éditeur ne reprend la proposition qu'avec `&proposition=1`, et le brouillon confié avant. */
        <Link
          href="/equipe?creer=1&proposition=1"
          onClick={() => confierAEditeur({ id: "", nom: partie.nom, role: partie.role, description: partie.description, consignes: "" })}
          className="flex h-11 items-center justify-center self-start rounded-xs px-4 text-ui font-medium text-texte-inverse no-underline klyra-surface-sombre"
        >
          Ouvrir pour ajuster
        </Link>
      ) : (
        <div>
          <Bouton variant="sombre" className="h-11 text-ui" disabled>
            Ouvrir pour ajuster
          </Bouton>
          <NotePoste />
        </div>
      )}
    </div>
  );
}

const STATUTS_TACHE = {
  fait: {
    libelle: "Fait",
    icone: (
      <span className="flex size-4 items-center justify-center rounded-full bg-bleu-k1-500 text-texte-inverse">
        <Icon name="check-01" size={12} />
      </span>
    ),
  },
  "en-cours": { libelle: "En cours", icone: <Icon name="loader-01" size={16} className="text-icone-accent motion-safe:animate-spin" /> },
  "a-venir": { libelle: "À venir", icone: <Icon name="circle" size={16} className="text-icone-secondaire" /> },
} as const;

function Taches({ partie }: { partie: Extract<PartieCompte, { type: "tasks" }> }) {
  const { nom } = useCartes();
  return (
    <ul className="w-full divide-y divide-bordure-subtile rounded-md border border-bordure-subtile bg-fond-surface">
      {partie.tasks.map((t, i) => (
        <li key={i} className="flex min-h-11 items-center gap-2.5 px-3 py-2 text-ui">
          <span className="flex w-[18px] shrink-0 justify-center">{STATUTS_TACHE[t.status].icone}</span>
          {t.roleId ? <span className="shrink-0 font-medium text-texte-principal">{nom(t.roleId)}</span> : null}
          <span className={cn("min-w-0 flex-1 truncate", t.status === "en-cours" ? "font-medium text-texte-principal" : "text-texte-secondaire")}>{t.label}</span>
          <span className={cn("shrink-0 text-ui-xs font-medium", t.status === "en-cours" ? "text-texte-accent" : "text-texte-secondaire")}>{STATUTS_TACHE[t.status].libelle}</span>
        </li>
      ))}
    </ul>
  );
}

function Options({ partie }: { partie: Extract<PartieCompte, { type: "options" }> }) {
  const [choisie, setChoisie] = useState(partie.options.findIndex((o) => o.selected));
  return (
    <div role="radiogroup" aria-label="Options proposées" className="flex w-full flex-col gap-2">
      {partie.options.map((o, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={i === choisie}
          onClick={() => setChoisie(i)}
          className={cn(
            "flex min-h-11 items-center gap-2 rounded-md border px-3 text-left text-ui",
            i === choisie ? "border-bordure-forte font-medium text-texte-principal" : "border-bordure-subtile text-texte-secondaire",
          )}
        >
          <Icon name={i === choisie ? "check-01" : "circle"} size={16} className="shrink-0 text-icone-secondaire" />
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PartieFil({
  partie,
  message,
  ton,
  contexte,
  remplacee,
  choix,
}: {
  partie: PartieCompte;
  message: MessageLu;
  ton: "user" | "role";
  contexte: ContexteFil;
  remplacee: boolean;
  /** Les réponses toutes prêtes : actives sur la dernière réponse, figées une fois répondues. */
  choix?: { actif: boolean; repondu: string | null };
}) {
  const sur = useSupport();
  const local = () => contexte.onBandeau(`Sur ${sur} : l’aperçu est servi par ton ordinateur.`);
  switch (partie.type) {
    case "text":
      return partie.text.trim() ? <Bulle texte={partie.text} ton={ton} projetId={contexte.projetId} onLocal={local} /> : null;
    case "fichiers":
      return partie.fichiers?.length ? (
        <ul className={cn("flex w-full max-w-[85%] flex-col gap-1.5", ton === "user" && "self-end")}>
          {partie.fichiers.map((f, i) => {
            const lien = lienFichier(contexte.projetId, f.chemin);
            const carte = (
              <>
                <Icon name="file-attach-01" size={20} className="shrink-0 text-icone-secondaire" />
                <span className="truncate text-ui font-medium text-texte-principal">{/^capture-\d{4}/.test(f.nom) ? "Capture collée" : f.nom}</span>
              </>
            );
            return (
              <li key={`${f.nom}-${i}`}>
                {lien ? (
                  <Link href={lien} className="flex min-h-12 items-center gap-2.5 rounded-md border border-bordure-subtile bg-fond-surface px-3 no-underline">
                    {carte}
                  </Link>
                ) : (
                  <span className="flex min-h-12 items-center gap-2.5 rounded-md border border-bordure-subtile bg-fond-surface px-3">{carte}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null;
    case "etapes":
      return <Etapes partie={partie} enCours={message.statut === "en-cours"} projetId={contexte.projetId} />;
    case "autorisation":
      return partie.statut === "attente" ? (
        <CarteAccordChat
          demande={{
            conversationOrigine: contexte.origine,
            roleId: message.auteurId ?? "principal",
            messageId: message.origine,
            accord: { id: partie.id, libelle: partie.libelle, detail: partie.detail, description: partie.description, toujours: partie.toujours },
          }}
        />
      ) : (
        <p className="flex items-center gap-1.5 px-1 text-ui text-texte-secondaire">
          <Icon name={partie.statut === "acceptee" ? "check-01" : "x-01"} size={16} className="shrink-0" />
          <span className="truncate">
            {partie.statut === "acceptee" ? "Accordé" : "Refusé"} : {partie.libelle}
          </span>
        </p>
      );
    case "passation":
      /* Une ligne du fil, sur toute sa largeur : elle sort de la colonne de contenu (avatar 32 + espace 10). */
      return (
        <div className="-ml-[42px] flex w-[calc(100%+42px)] justify-center">
          <Passation partie={partie} />
        </div>
      );
    case "proposition-agent":
      return <Proposition partie={partie} remplacee={remplacee} />;
    case "tasks":
      return <Taches partie={partie} />;
    case "options":
      return <Options partie={partie} />;
    case "worklog":
      return (
        <p className="flex min-h-8 items-center gap-2 px-1 text-ui text-texte-secondaire">
          <Icon name="code-01" size={16} className="text-icone-secondaire" />A travaillé {partie.durationMin} min · {partie.files.length}{" "}
          {partie.files.length > 1 ? "fichiers modifiés" : "fichier modifié"}
        </p>
      );
    case "atelier-agent":
      return partie.carte ? (
        <CarteAtelierTelephone etapeId={partie.etapeId} carte={partie.carte} conversation={contexte.origine} />
      ) : partie.ligne ? (
        <LigneAtelierTelephone ligne={partie.ligne} />
      ) : null;
    case "atelier-equipe":
      return partie.carte ? (
        <CarteEquipeTelephone etapeId={partie.etapeId} carte={partie.carte} conversation={contexte.origine} />
      ) : partie.ligne ? (
        <LigneEquipeTelephone ligne={partie.ligne} />
      ) : null;
    case "carte":
      return (
        <CarteTelephone
          etapeId={partie.etapeId}
          carte={partie.carte}
          envoyee={partie.reponse ?? null}
          actif={choix?.actif ?? false}
          repondu={choix?.repondu ?? null}
          onEnvoyer={(texte) => contexte.envoyer(texte, message.auteurId ? { a: message.auteurId } : {})}
        />
      );
    case "choix":
      return (
        <ChoixTelephone
          partie={partie}
          actif={choix?.actif ?? false}
          repondu={choix?.repondu ?? null}
          onRepondre={(texte) => contexte.envoyer(texte, message.auteurId ? { a: message.auteurId } : {})}
        />
      );
    case "actions":
      return (
        <div className="flex flex-wrap gap-2">
          {partie.actions.map((a) => (
            <Bouton
              key={a.label}
              variant={a.primary ? "sombre" : "blanc"}
              className="h-11 text-ui"
              onClick={() => contexte.envoyer(a.label, message.auteurId ? { a: message.auteurId } : {})}
            >
              {a.label}
            </Bouton>
          ))}
        </div>
      );
    default:
      return null;
  }
}

/* ─── Les messages ─────────────────────────────────────────────── */

/** Le temps passé, affiché après 5 s : « 12 s », « 1 min 04 » (comme au bureau). */
function useChrono(depuis: string | null): string | null {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (!depuis) return;
    const id = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(id);
  }, [depuis]);
  if (!depuis) return null;
  const s = Math.max(0, Math.floor((maintenant - Date.parse(depuis)) / 1000));
  if (s < 5 || !Number.isFinite(s)) return null;
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

function EnTravail({ roleId, depuis, vide, attente }: { roleId: string; depuis: string | null; vide: boolean; attente: boolean }) {
  const { nom } = useCartes();
  const chrono = useChrono(depuis);
  return (
    <p className="flex min-h-6 items-center gap-1.5 text-ui text-texte-secondaire">
      <span className="klyra-respire font-medium">{attente ? `${nom(roleId)} attend ton accord` : vide ? `${nom(roleId)} réfléchit…` : `${nom(roleId)} travaille…`}</span>
      {chrono ? <span>{chrono}</span> : null}
    </p>
  );
}

/** Une tâche de fond, et depuis combien de temps elle tourne. */
function LigneFond({ description, depuis }: { description: string; depuis: string }) {
  const chrono = useChrono(depuis);
  return (
    <li className="flex min-w-0 items-baseline gap-1.5">
      <span aria-hidden="true" className="size-1 shrink-0 translate-y-[-2px] rounded-full bg-icone-secondaire" />
      <span className="truncate">{description}</span>
      {chrono ? <span className="shrink-0 tabular-nums">{chrono}</span> : null}
    </li>
  );
}

/**
 * « Iris continue en arrière-plan · Capture de la vidéo · 2 min » sous le fil, comme au bureau (`EnFond`) :
 * sa réponse est rendue, une commande ou un agent qu'elle a lancé tourne encore ; « Iris reprend… » quand
 * l'un d'eux revient. Copié par l'ordinateur ouvert (`activiteFond`).
 */
function EnFondTelephone({ activite }: { activite: Extract<Activite, { etat: "fond" }> }) {
  const { nom } = useCartes();
  const seule = activite.taches.length === 1 ? activite.taches[0] : null;
  const chrono = useChrono(activite.reprise || !seule ? null : seule.depuis);
  const detail = activite.reprise ? (activite.taches.length ? `${activite.libelle} encore en fond` : "une tâche de fond est terminée") : seule ? activite.libelle : `${activite.libelle} en cours`;
  return (
    <div data-en-fond={activite.roleId} className="mt-2 flex flex-col gap-1 text-ui text-texte-secondaire">
      <p className="flex min-h-6 min-w-0 items-center gap-1.5">
        <Icon name="loader-01" size={16} className="shrink-0 animate-spin text-icone-accent [animation-duration:1.5s]" />
        {/* Seul l'état est annoncé, pas le temps qui passe. */}
        <span aria-live="polite" className="klyra-respire shrink-0 font-medium">
          {activite.reprise ? `${nom(activite.roleId)} reprend…` : `${nom(activite.roleId)} continue en arrière-plan`}
        </span>
        {detail ? <span className="truncate">· {detail}</span> : null}
        {chrono ? <span className="shrink-0 tabular-nums">· {chrono}</span> : null}
      </p>
      {!seule && !activite.reprise && activite.taches.length > 1 ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pl-6 text-ui-s">
          {activite.taches.map((t, i) => (
            <LigneFond key={i} description={t.description} depuis={t.depuis} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Les réactions sous la bulle (E2-40) : toucher la sienne la retire ; elles ne font pas répondre l'agent. */
function ReactionsSousBulle({ message, contexte }: { message: MessageLu; contexte: ContexteFil }) {
  if (!message.reactions.length) return null;
  return (
    <ul aria-label="Réactions" className="flex flex-wrap gap-1">
      {message.reactions.map((emoji) => (
        <li key={emoji}>
          <button
            type="button"
            aria-pressed
            aria-label={`Retirer la réaction ${NOMS_REACTIONS[emoji] ?? emoji}`}
            onClick={() => contexte.reagir(message.origine, emoji, false)}
            className="relative flex h-8 min-w-11 items-center justify-center gap-1 rounded-pill border border-bordure-subtile bg-fond-surface px-2.5 text-ui after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
          >
            <span aria-hidden="true">{emoji}</span>
            <span aria-hidden="true" className="text-ui-xs text-texte-secondaire">
              1
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MessageAgent({
  message,
  suite,
  contexte,
  propositionCourante,
  choix,
  derniere,
}: {
  message: MessageLu;
  suite: boolean;
  contexte: ContexteFil;
  propositionCourante: string | null;
  choix: { actif: boolean; repondu: string | null };
  /** La dernière réponse achevée porte ses actions en clair (D2-3) ; les autres, « ⋯ » et l'appui long. */
  derniere: boolean;
}) {
  const { nom, encre, carte } = useCartes();
  const annoncer = useAnnonce();
  const [actions, setActions] = useState(false);
  const appui = useAppuiLong(() => setActions(true));
  const roleId = message.auteurId ?? "principal";
  const parties = useMemo(() => lireParties(message.parties), [message.parties]);
  const toutes = parties.filter((p) => p.type !== "text" || p.text.trim());
  /* La passation qui ouvre le message passe avant l'avatar et le nom (§ 2). */
  const nbTete = toutes.findIndex((p) => p.type !== "passation");
  const tete = nbTete < 0 ? toutes : toutes.slice(0, nbTete);
  const visibles = nbTete < 0 ? [] : toutes.slice(nbTete);
  const enCours = message.statut === "en-cours";
  const activite = contexte.activite?.messageId === message.origine ? contexte.activite : null;
  const texte = message.texte.trim();
  /* Des réponses toutes prêtes attendent : les actions restent derrière « ⋯ », la maquette montre l'heure seule (E2-20). */
  const actionsEnClair = derniere && !(choix.actif && parties.some((p) => p.type === "choix"));

  return (
    <div className={cn(!suite && "mt-4")}>
    {tete.map((p, i) => (p.type === "passation" ? <div key={i} className="flex justify-center pb-3"><Passation partie={p} /></div> : null))}
    <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-2.5">
      <div className="pt-0.5">{!suite ? <RondAgent id={roleId} taille={32} /> : null}</div>
      <div className="flex min-w-0 flex-col items-start gap-1.5" {...(texte && !enCours ? appui : {})}>
        {!suite ? (
          <p className="flex items-baseline gap-2">
            <span className="text-ui font-semibold" style={{ color: encre(roleId) }}>
              {nom(roleId)}
            </span>
            <span className="text-ui-xs text-texte-secondaire">{carte(roleId)?.roleCourt}</span>
          </p>
        ) : null}
        {visibles.map((partie, i) => (
          <PartieFil
            key={i}
            partie={partie}
            message={message}
            ton="role"
            contexte={contexte}
            remplacee={partie.type === "proposition-agent" && partie.etapeId !== propositionCourante}
            choix={choix}
          />
        ))}
        {/* Ordinateur fermé, l'activité tombe : une réponse interrompue ne « réfléchit » pas indéfiniment. */}
        {enCours && contexte.activite ? <EnTravail roleId={roleId} depuis={activite?.depuis ?? message.creeLe} vide={toutes.length === 0} attente={activite?.etat === "accord"} /> : null}
        {message.statut === "erreur" ? (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-bordure-erreur bg-fond-surface py-1 pr-1 pl-3 text-ui text-texte-erreur">
            <span className="min-w-0 flex-1">{nom(roleId)} s’est arrêté sur une erreur.</span>
            <Bouton variant="blanc" className="h-11 shrink-0 text-ui" onClick={() => contexte.envoyer("Réessayer", { reessayer: { messageId: message.origine, facon: "reessayer" } })}>
              Réessayer
            </Bouton>
          </div>
        ) : null}
        <ReactionsSousBulle message={message} contexte={contexte} />
        {message.compaction && !enCours ? (
          <p className="flex items-center gap-1 px-1 text-ui-xs text-texte-secondaire">
            <Icon name="check-01" size={14} className="shrink-0" />
            Conversation résumée
          </p>
        ) : null}
        {!enCours && texte ? (
          <div className="-ml-2 flex items-center text-ui-xs text-texte-secondaire">
            {actionsEnClair ? (
              <>
                <BoutonIcone
                  variant="discret"
                  className="size-11"
                  libelle="Copier la réponse"
                  icone={<Icon name="copy-left" size={20} />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(message.texte).then(
                      () => annoncer("Réponse copiée"),
                      () => annoncer({ texte: "La copie n’est pas possible ici : sélectionne le texte du message.", erreur: true }),
                    );
                  }}
                />
                <BoutonIcone variant="discret" className="size-11" libelle="Réagir" aria-haspopup="dialog" icone={<Icon name="face-smile" size={20} />} onClick={() => setActions(true)} />
                <BoutonIcone
                  variant="discret"
                  className="size-11"
                  libelle="Répondre à ce message"
                  icone={<Icon name="reply-01" size={20} />}
                  onClick={() => {
                    const citation = citationDuMessage(message);
                    if (citation) repondreA(contexte.origine, citation);
                  }}
                />
              </>
            ) : null}
            {actionsEnClair ? null : <span className="pr-0.5 pl-2">{formatTime(message.creeLe)}</span>}
            <BoutonIcone variant="discret" className="size-11" libelle="Actions sur la réponse" icone={<Icon name="dot-horizontal" size={20} />} aria-haspopup="dialog" onClick={() => setActions(true)} />
            {actionsEnClair ? <span className="pl-1">{formatTime(message.creeLe)}</span> : null}
          </div>
        ) : null}
      </div>
      {actions ? <ActionsMessage message={message} contexte={contexte} conversation={contexte.conversation} onFermer={() => setActions(false)} /> : null}
    </div>
    </div>
  );
}

/** Une ligne du système dans le fil (« Résumé demandé », E2-43). */
function LigneSysteme({ children }: { children: ReactNode }) {
  return <p className="mt-4 self-center text-center text-ui text-texte-secondaire">{children}</p>;
}

function MessageMoi({ message, suite, contexte }: { message: MessageLu; suite: boolean; contexte: ContexteFil }) {
  const [actions, setActions] = useState(false);
  const appui = useAppuiLong(() => setActions(true));
  const parties = useMemo(() => lireParties(message.parties), [message.parties]);
  const visibles = parties.length ? parties : [{ type: "text" as const, text: message.texte }];
  if (estDemandeResume(message.texte)) return <LigneSysteme>Résumé demandé</LigneSysteme>;
  return (
    <div className={cn("flex flex-col items-end gap-1", !suite && "mt-4")} {...(message.texte.trim() ? appui : {})}>
      {visibles.map((partie, i) => (
        <PartieFil key={i} partie={partie} message={message} ton="user" contexte={contexte} remplacee={false} />
      ))}
      <span className="text-ui-xs text-texte-secondaire">{formatTime(message.creeLe)}</span>
      {actions ? <ActionsMessage message={message} contexte={contexte} conversation={contexte.conversation} onFermer={() => setActions(false)} /> : null}
    </div>
  );
}

/** Un message écrit sur le téléphone, pas encore pris par l'ordinateur (P-4). */
function MessageEnFile({ message }: { message: MessageEnAttente }) {
  const { principal } = usePostes();
  const annoncer = useAnnonce();
  const annuler = useMutation(api.conversationsCompte.annuler);
  const [annulation, setAnnulation] = useState(false);
  /* E2-21 : le texte revient dans le champ, à la suite d'un nouveau brouillon. Déjà pris : il est parti, on le dit. */
  const annulerEnvoi = () => {
    setAnnulation(true);
    annuler({ id: message._id }).then(
      (annule) => {
        if (annule) {
          ajouterAuBrouillon(message.conversationOrigine, message.texte);
          annoncer(message.pieces.length ? "Envoi annulé : ton texte est revenu, les pièces jointes sont retirées" : "Envoi annulé : ton texte est revenu");
        } else annoncer("Ton message était déjà parti : il n’a pas pu être annulé");
      },
      (err: unknown) => {
        setAnnulation(false);
        annoncer({ texte: messageErreur(err), erreur: true });
      },
    );
  };
  if (estDemandeResume(message.texte)) {
    return (
      <LigneSysteme>
        Résumé demandé · {attenteEnvoi(principal)}
      </LigneSysteme>
    );
  }
  return (
    <div className="mt-4 flex flex-col items-end gap-1">
      <div className="w-fit max-w-[85%] rounded-xl bg-fond-inverse px-3.5 py-2 text-body-s leading-[1.5] whitespace-pre-wrap text-texte-inverse opacity-80 [overflow-wrap:anywhere]">
        {message.texte}
      </div>
      {message.pieces.length ? (
        <ul className="flex max-w-[85%] flex-col items-end gap-1">
          {message.pieces.map((p, i) => (
            <li key={i} className="flex items-center gap-1.5 text-ui text-texte-secondaire">
              <Icon name="paperclip" size={16} />
              <span className="truncate">{p.nom}</span>
              <span className="shrink-0">· {taillePiece(p.taille)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="flex items-center gap-1 text-ui-xs text-texte-secondaire">
        {attenteEnvoi(principal)} ·
        <button type="button" disabled={annulation} className="min-h-11 px-1 font-medium text-texte-principal underline underline-offset-2 disabled:opacity-60" onClick={annulerEnvoi}>
          Annuler l’envoi
        </button>
      </p>
    </div>
  );
}

/**
 * Arriver sur un message depuis la recherche (`&message=<id>`) : il est centré, éclairé, ses mots
 * trouvés sont surlignés, il prend le focus et un lecteur d'écran l'annonce. Puis le paramètre part.
 */
function useArrivee(
  zoneRef: React.RefObject<HTMLDivElement | null>,
  origine: string,
  messages: MessageLu[] | undefined,
  annonceRef: React.RefObject<HTMLParagraphElement | null>,
  ancreRef: React.RefObject<boolean>,
) {
  const cible = useSearchParams().get("message");
  const router = useRouter();
  const { nom } = useCartes();
  const annoncer = useAnnonce();
  useEffect(() => {
    if (!cible || !messages) return;
    const el = zoneRef.current;
    const bloc = el?.querySelector<HTMLElement>(`[data-message="${CSS.escape(cible)}"]`);
    const message = messages.find((m) => m.origine === cible);
    router.replace(`/chat?id=${encodeURIComponent(origine)}`, { scroll: false });
    if (!el || !bloc || !message) {
      /* La cible n'est pas dans les 400 récents : on le dit, sans faire semblant de l'avoir trouvée. */
      annoncer("Ce message n’est pas dans les messages disponibles ici");
      return;
    }
    const requete = requeteRetenue();
    const { textes } = requete ? plagesDans(bloc, requete) : { textes: [] };
    if (typeof Highlight !== "undefined" && CSS.highlights) {
      if (textes.length) CSS.highlights.set(SURLIGNAGE, new Highlight(...textes));
      else CSS.highlights.delete(SURLIGNAGE);
    }
    const haut = el.getBoundingClientRect().top - el.scrollTop;
    const viser = textes[0]?.getBoundingClientRect() ?? bloc.getBoundingClientRect();
    ancreRef.current = true;
    const doux = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: Math.max(0, viser.top - haut + viser.height / 2 - el.clientHeight / 2), behavior: doux ? "smooth" : "instant" });
    bloc.removeAttribute("data-eclaire");
    void bloc.offsetWidth;
    bloc.setAttribute("data-eclaire", "");
    const eteindre = setTimeout(() => bloc.removeAttribute("data-eclaire"), ECLAIRAGE_MS);
    bloc.tabIndex = -1;
    bloc.focus({ preventScroll: true });
    if (annonceRef.current) annonceRef.current.textContent = `Message de ${message.auteurKind === "user" ? "toi" : nom(message.auteurId ?? "")}, ${formatJourHeure(message.creeLe)}`;
    return () => clearTimeout(eteindre);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois par message visé, quand le fil est là
  }, [cible, messages === undefined]);
  useEffect(
    () => () => {
      CSS.highlights?.delete(SURLIGNAGE);
    },
    [],
  );
}

/**
 * Le fil (T-02) : une colonne, texte 16 px, les parties de chaque message dans leur forme du bureau,
 * la réponse qui s'écrit, les messages qui attendent l'ordinateur, et « ↓ » pour revenir en bas.
 */
export function MessagesFil({
  messages,
  coupe = false,
  enFile,
  contexte,
  vide,
  apres,
}: {
  messages: MessageLu[] | undefined;
  /** Le compte n'a rendu que les 400 messages les plus récents. */
  coupe?: boolean;
  enFile: MessageEnAttente[];
  contexte: ContexteFil;
  /** Ce qui s'affiche dans une conversation encore vide (l'agent, les suggestions). */
  vide: ReactNode;
  /** Après les messages et la file : les échanges envoyés au VPS, ordinateur fermé. */
  apres?: ReactNode;
}) {
  const zone = useRef<HTMLDivElement>(null);
  const enBas = useRef(true);
  const ancre = useRef(false);
  const annonce = useRef<HTMLParagraphElement>(null);
  const [loin, setLoin] = useState(false);
  const [nouveaux, setNouveaux] = useState(0);
  const vusAvant = useRef<string | null>(null);
  const [squelette, setSquelette] = useState(false);
  const { nom } = useCartes();

  useEffect(() => {
    if (messages !== undefined) return;
    const minuteur = setTimeout(() => setSquelette(true), 300);
    return () => clearTimeout(minuteur);
  }, [messages]);

  /* Collé en bas comme une messagerie, tant qu'on n'est pas remonté lire plus haut. */
  const dernier = messages?.at(-1);
  const taille = (dernier?.texte.length ?? 0) + (dernier?.parties.length ?? 0);
  useEffect(() => {
    const el = zone.current;
    if (el && enBas.current && !ancre.current) el.scrollTop = el.scrollHeight;
  }, [messages?.length, taille, enFile.length, contexte.activite?.etat]);

  /* La personne lit plus haut : sa position ne bouge pas, ↓ compte les messages arrivés depuis. Le plafond de 400 fait glisser le début : on suit le dernier vu, pas la longueur. */
  const dernierId = messages?.at(-1)?.origine ?? null;
  useEffect(() => {
    if (!messages || !dernierId) return;
    const avant = vusAvant.current;
    vusAvant.current = dernierId;
    if (avant === null || avant === dernierId || enBas.current) return;
    const depuis = messages.findIndex((m) => m.origine === avant);
    const arrives = depuis < 0 ? 1 : messages.length - 1 - depuis;
    if (arrives > 0) queueMicrotask(() => setNouveaux((n) => n + arrives));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- à chaque nouveau dernier message
  }, [dernierId]);

  /* La réponse qui s'écrit est annoncée à sa fin, pas mot par mot (spec § 9). */
  const derniereReponse = messages?.findLast((m) => m.auteurKind === "role");
  const precedent = useRef<{ id: string; statut: MessageLu["statut"] } | null>(null);
  useEffect(() => {
    if (!derniereReponse) return;
    const avant = precedent.current;
    if (avant?.id === derniereReponse.origine && avant.statut === "en-cours" && derniereReponse.statut !== "en-cours" && annonce.current) {
      annonce.current.textContent = derniereReponse.statut === "erreur" ? `${nom(derniereReponse.auteurId ?? "")} s’est arrêté sur une erreur` : `${nom(derniereReponse.auteurId ?? "")} a répondu`;
    }
    precedent.current = { id: derniereReponse.origine, statut: derniereReponse.statut };
  }, [derniereReponse, nom]);

  useArrivee(zone, contexte.origine, messages, annonce, ancre);
  useEffect(() => arreterLecture, [contexte.origine]);

  const propositionCourante = useMemo(() => {
    for (const m of [...(messages ?? [])].reverse()) {
      const p = lireParties(m.parties).findLast((x) => x.type === "proposition-agent");
      if (p?.type === "proposition-agent") return p.etapeId;
    }
    return null;
  }, [messages]);

  /* Les réponses toutes prêtes : ce que la personne a répondu ensuite (un message, ou un envoi qui attend l'ordinateur). */
  const reponses = useMemo(() => {
    const apres = new Map<string, string>();
    let suivante: string | null = enFile[0]?.texte ?? null;
    for (const m of [...(messages ?? [])].reverse()) {
      if (m.auteurKind === "user") suivante = m.texte;
      else if (suivante !== null) apres.set(m.origine, suivante);
    }
    return apres;
  }, [messages, enFile]);

  /* La dernière réponse achevée de l'agent, seulement si rien ne s'écrit après elle (D2-3). */
  const reponseFinale = messages?.at(-1)?.auteurKind === "role" && messages.at(-1)?.statut !== "en-cours" ? messages.at(-1)?.origine : null;
  const derniereAchevee = reponseFinale ?? messages?.findLast((m) => m.auteurKind === "role" && m.statut !== "en-cours" && m.texte.trim())?.origine ?? null;

  const allerEnBas = () => {
    const el = zone.current;
    if (!el) return;
    ancre.current = false;
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={zone}
        onScroll={(e) => {
          const el = e.currentTarget;
          const ecart = el.scrollHeight - el.scrollTop - el.clientHeight;
          enBas.current = ecart < 80;
          if (enBas.current) setNouveaux(0);
          setLoin(ecart > 400);
        }}
        onTouchStart={() => {
          ancre.current = false;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-4"
      >
        {messages === undefined ? (
          squelette ? (
            <div aria-busy="true" aria-label="Chargement du fil" className="flex flex-col gap-4 pt-4">
              {[60, 85, 40, 75].map((l, i) => (
                <div key={i} className={cn("h-12 rounded-xl bg-fond-surface-grise motion-safe:animate-pulse", i % 2 ? "self-end" : "self-start")} style={{ width: `${l}%` }} />
              ))}
            </div>
          ) : null
        ) : (
          <div className="flex min-h-full flex-col justify-end">
            {coupe ? <p className="pt-2 pb-1 text-center text-ui-xs text-texte-secondaire">Les 400 derniers messages sont disponibles ici.</p> : null}
            {messages.length === 0 && enFile.length === 0 ? vide : null}
            {messages.map((message, i) => {
              const avant = messages[i - 1];
              const jour = !avant || !isSameDay(avant.creeLe, message.creeLe);
              const suite = !!avant && !jour && memeAuteur(avant, message) && Date.parse(message.creeLe) - Date.parse(avant.creeLe) < GROUPE_MS;
              return (
                <Fragment key={message.origine}>
                  {jour ? <p className="pt-4 pb-1 text-center text-ui-xs font-medium text-texte-secondaire">{formatDaySeparator(message.creeLe)}</p> : null}
                  <div data-message={message.origine} data-auteur={message.auteurKind} className={suite ? "mt-1.5" : undefined}>
                    {message.auteurKind === "user" ? (
                      <MessageMoi message={message} suite={suite} contexte={contexte} />
                    ) : (
                      <MessageAgent
                        message={message}
                        suite={suite}
                        contexte={contexte}
                        propositionCourante={propositionCourante}
                        derniere={message.origine === derniereAchevee}
                        choix={{
                          actif: i === messages.length - 1 && message.statut !== "en-cours" && !reponses.has(message.origine),
                          repondu: reponses.get(message.origine) ?? null,
                        }}
                      />
                    )}
                  </div>
                </Fragment>
              );
            })}
            {contexte.activite?.etat === "fond" ? <EnFondTelephone activite={contexte.activite} /> : null}
            {enFile.map((m) => (
              <MessageEnFile key={m._id} message={m} />
            ))}
            {apres}
          </div>
        )}
      </div>
      {loin || nouveaux > 0 ? (
        <div className="absolute right-4 bottom-3">
          <BoutonIcone
            variant="blanc"
            className="size-11 rounded-full shadow-ombre-flottante"
            libelle={nouveaux > 0 ? `Aller au dernier message, ${nouveaux} nouveau${nouveaux > 1 ? "x" : ""}` : "Aller au dernier message"}
            icone={<Icon name="chevron-down" size={22} />}
            onClick={allerEnBas}
          />
          {nouveaux > 0 ? (
            <span aria-hidden="true" className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bleu-k1-500 px-1 text-ui-xs leading-none font-semibold text-texte-inverse">
              {nouveaux > 9 ? "9+" : nouveaux}
            </span>
          ) : null}
        </div>
      ) : null}
      <p ref={annonce} aria-live="polite" className="sr-only" />
    </div>
  );
}
