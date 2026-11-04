"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Markdown } from "@/components/ui/Markdown";
import { plagesDans, SURLIGNAGE } from "@/components/recherche/surligner";
import { cn } from "@/lib/cn";
import { lireParties, type Activite, type PartieCompte } from "@/lib/copie-compte";
import { formatDaySeparator, formatJourHeure, formatTime, isSameDay } from "@/lib/format";
import { attenteEnvoi } from "@/lib/poste-texte";
import { requeteRetenue } from "@/lib/recherche-session";
import { idDirect } from "@/lib/telephone/chats";
import type { MessageLu } from "@/lib/telephone/export";
import { taillePiece } from "@/lib/telephone/pieces";
import { useAppuiLong } from "./Feuille";
import { NotePoste } from "./etats";
import { usePostes, useSupport } from "./poste";
import { RondAgent, useCartes } from "./AgentsChat";
import { CarteAccordChat } from "./CarteAccordChat";
import { CarteAtelierTelephone, ChoixTelephone, LigneAtelierTelephone } from "./AtelierTelephone";
import { ActionsMessage, arreterLecture } from "./ActionsMessage";
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
      <Markdown source={texte} className="gap-2 text-body-s leading-[1.55] text-texte-principal" />
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
        <Link href="/equipe?creer=1" className="flex h-11 items-center justify-center self-start rounded-xs px-4 text-ui font-medium text-texte-inverse no-underline klyra-surface-sombre">
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
  fait: { libelle: "Fait", icone: <PixelCheck className="h-[13px] w-[18px]" /> },
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
          <span className="min-w-0 flex-1 truncate text-texte-secondaire">{t.label}</span>
          <span className="shrink-0 text-ui-xs font-medium text-texte-secondaire">{STATUTS_TACHE[t.status].libelle}</span>
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
            accord: { id: partie.id, libelle: partie.libelle, detail: partie.detail, description: partie.description },
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
      return <Passation partie={partie} />;
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

function MessageAgent({
  message,
  suite,
  contexte,
  propositionCourante,
  choix,
}: {
  message: MessageLu;
  suite: boolean;
  contexte: ContexteFil;
  propositionCourante: string | null;
  choix: { actif: boolean; repondu: string | null };
}) {
  const { nom, encre, carte } = useCartes();
  const [actions, setActions] = useState(false);
  const appui = useAppuiLong(() => setActions(true));
  const roleId = message.auteurId ?? "principal";
  const parties = useMemo(() => lireParties(message.parties), [message.parties]);
  const visibles = parties.filter((p) => p.type !== "text" || p.text.trim());
  const enCours = message.statut === "en-cours";
  const activite = contexte.activite?.messageId === message.origine ? contexte.activite : null;
  const texte = message.texte.trim();

  return (
    <div className={cn("grid grid-cols-[32px_minmax(0,1fr)] gap-x-2.5", !suite && "mt-4")}>
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
        {enCours && contexte.activite ? <EnTravail roleId={roleId} depuis={activite?.depuis ?? message.creeLe} vide={visibles.length === 0} attente={activite?.etat === "accord"} /> : null}
        {message.statut === "erreur" ? (
          <p role="alert" className="rounded-md border border-bordure-erreur bg-fond-surface px-3 py-2 text-ui text-texte-erreur">
            L’agent s’est arrêté sur une erreur.
          </p>
        ) : null}
        {!enCours && texte ? (
          <div className="-ml-2 flex items-center gap-1 text-ui-xs text-texte-secondaire">
            <BoutonIcone
              variant="discret"
              className="size-11"
              libelle="Actions sur la réponse"
              icone={<Icon name="dot-horizontal" size={20} />}
              aria-haspopup="dialog"
              onClick={() => setActions(true)}
            />
            <span>{formatTime(message.creeLe)}</span>
          </div>
        ) : null}
      </div>
      {actions ? <ActionsMessage message={message} contexte={contexte} onFermer={() => setActions(false)} /> : null}
    </div>
  );
}

function MessageMoi({ message, suite, contexte }: { message: MessageLu; suite: boolean; contexte: ContexteFil }) {
  const parties = useMemo(() => lireParties(message.parties), [message.parties]);
  const visibles = parties.length ? parties : [{ type: "text" as const, text: message.texte }];
  return (
    <div className={cn("flex flex-col items-end gap-1", !suite && "mt-4")}>
      {visibles.map((partie, i) => (
        <PartieFil key={i} partie={partie} message={message} ton="user" contexte={contexte} remplacee={false} />
      ))}
      <span className="text-ui-xs text-texte-secondaire">{formatTime(message.creeLe)}</span>
    </div>
  );
}

/** Un message écrit sur le téléphone, pas encore pris par l'ordinateur (P-4). */
function MessageEnFile({ message }: { message: MessageEnAttente }) {
  const { principal } = usePostes();
  const annuler = useMutation(api.conversationsCompte.annuler);
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
        <button type="button" className="min-h-11 px-1 font-medium text-texte-principal" onClick={() => void annuler({ id: message._id })}>
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
  useEffect(() => {
    if (!cible || !messages) return;
    const el = zoneRef.current;
    const bloc = el?.querySelector<HTMLElement>(`[data-message="${CSS.escape(cible)}"]`);
    const message = messages.find((m) => m.origine === cible);
    router.replace(`/chat?id=${encodeURIComponent(origine)}`, { scroll: false });
    if (!el || !bloc || !message) return;
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
  enFile,
  contexte,
  vide,
  apres,
}: {
  messages: MessageLu[] | undefined;
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
  }, [messages?.length, taille, enFile.length]);

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
            {enFile.map((m) => (
              <MessageEnFile key={m._id} message={m} />
            ))}
            {apres}
          </div>
        )}
      </div>
      {loin ? (
        <BoutonIcone
          variant="blanc"
          className="absolute right-4 bottom-3 size-11 rounded-full shadow-ombre-flottante"
          libelle="Aller au dernier message"
          icone={<Icon name="chevron-down" size={22} />}
          onClick={allerEnBas}
        />
      ) : null}
      <p ref={annonce} aria-live="polite" className="sr-only" />
    </div>
  );
}
