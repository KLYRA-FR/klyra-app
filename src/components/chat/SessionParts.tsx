"use client";

/**
 * Ce qu'une session de Claude Code montre en plus dans le fil (cf. electron/session-claude.ts) : la réflexion
 * repliée, les questions à choix et le plan à lancer, le diff d'une modification, la sortie d'une commande, et
 * en fin de réponse les fichiers modifiés, à garder ou à annuler un par un.
 */
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Textarea } from "klyra-ui";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { Markdown } from "@/components/ui/Markdown";
import { Modale, useConfirmation } from "@/components/ui/Modale";
import { duree, cheminAffiche, fichiersModifies, modificationsDepuis, type FichierModifie } from "@/lib/session-agent";
import { moteurDe, PAR_DEFAUT } from "@/lib/fournisseurs";
import { useChatMessages, useWorkspace } from "@/lib/workspace";
import type { Chat, Message, MessagePart, ModifEtape } from "@/types/domain";
import type { ResultatAnnulation } from "@/lib/bridge";

/** Le temps qui passe, rafraîchi chaque seconde tant que `actif`. */
function useMaintenant(actif: boolean): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (!actif) return;
    const id = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(id);
  }, [actif]);
  return maintenant;
}

/* ─── Réflexion ───────────────────────────────────────────────── */

/**
 * « Réflexion · 12 s », replié : un clic montre ce que le modèle a réfléchi (résumé). Pendant qu'il réfléchit,
 * « Réfléchit… » et le temps qui passe.
 */
export function ReflexionView({ part, enCours }: { part: Extract<MessagePart, { type: "reflexion" }>; enCours: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const ouverte = part.fin === undefined && enCours;
  const maintenant = useMaintenant(ouverte);
  const temps = part.debut ? duree((part.fin ?? (ouverte ? maintenant : part.debut)) - part.debut) : null;
  const texte = part.texte.trim();
  return (
    <div className="flex max-w-[680px] flex-col gap-1" data-reflexion>
      <button
        type="button"
        aria-expanded={texte ? ouvert : undefined}
        disabled={!texte}
        onClick={() => setOuvert((v) => !v)}
        className="flex h-7 w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent px-1.5 text-left text-ui-xs text-texte-tertiaire transition-colors duration-[120ms] enabled:hover:bg-fond-survol enabled:hover:text-texte-principal disabled:cursor-default"
      >
        <Icon name="stars" size={14} className={cn("shrink-0", ouverte ? "text-icone-accent" : "text-icone-secondaire")} />
        <span className={cn(ouverte && "klyra-respire font-medium text-texte-secondaire")}>{ouverte ? "Réfléchit…" : "Réflexion"}</span>
        {temps && temps !== "0 s" && <span className="tabular-nums">· {temps}</span>}
        {texte && <Icon name="chevron-right" size={14} className={cn("shrink-0 transition-transform duration-[220ms] ease-sortie", ouvert && "rotate-90")} />}
      </button>
      {ouvert && texte && (
        <div className="ml-[11px] border-l border-bordure-subtile pl-3">
          <Markdown source={texte} className="gap-2 text-ui-s leading-[1.55] text-texte-secondaire" />
        </div>
      )}
      {/* Ce qu'il est en train de réfléchir : la dernière ligne, en direct, tant que c'est replié. */}
      {!ouvert && ouverte && texte && <p className="m-0 ml-[11px] line-clamp-1 border-l border-bordure-subtile pl-3 text-ui-xs text-texte-tertiaire">{texte.split("\n").filter(Boolean).at(-1)}</p>}
    </div>
  );
}

/* ─── Questions à choix ───────────────────────────────────────── */

const AUTRE = "__autre__";

/**
 * L'agent pose des questions et attend : une ligne par option (une seule, ou plusieurs), « Autre » pour écrire
 * sa propre réponse, puis « Répondre ». Une fois répondue, la carte se résume.
 */
export function CarteQuestions({ part, nomAgent, onRepondre }: { part: Extract<MessagePart, { type: "question" }>; nomAgent: string; onRepondre: (reponses: Record<string, string> | null) => void }) {
  const [choix, setChoix] = useState<Record<string, string[]>>({});
  const [autres, setAutres] = useState<Record<string, string>>({});
  if (part.statut !== "attente") {
    return (
      <div className="flex max-w-[680px] flex-col gap-1 px-1 text-ui-xs text-texte-tertiaire" data-questions={part.statut}>
        {part.statut === "repondue" && part.reponses ? (
          part.questions.map((q) => (
            <span key={q.question} className="flex min-w-0 items-center gap-1.5">
              <Icon name="check-01" size={14} className="shrink-0" />
              <span className="truncate">
                {q.entete || q.question} : <span className="text-texte-secondaire">{part.reponses?.[q.question] ?? "sans réponse"}</span>
              </span>
            </span>
          ))
        ) : (
          <span className="flex items-center gap-1.5">
            <Icon name="x-01" size={14} />
            Questions laissées sans réponse
          </span>
        )}
      </div>
    );
  }
  const reponseDe = (question: string): string => {
    const valeurs = (choix[question] ?? []).map((v) => (v === AUTRE ? (autres[question] ?? "").trim() : v)).filter(Boolean);
    return valeurs.join(", ");
  };
  const complet = part.questions.every((q) => reponseDe(q.question));
  const basculer = (question: string, valeur: string, multiple: boolean) =>
    setChoix((c) => {
      const avant = c[question] ?? [];
      if (!multiple) return { ...c, [question]: [valeur] };
      return { ...c, [question]: avant.includes(valeur) ? avant.filter((v) => v !== valeur) : [...avant, valeur] };
    });
  return (
    <div role="group" aria-label={`Questions de ${nomAgent}`} data-questions="attente" className="flex w-full max-w-[680px] flex-col gap-4 rounded-lg border border-bleu-k1-500 bg-fond-surface p-4 shadow-ombre-xs">
      <span className="text-ui-s font-semibold text-texte-principal">{nomAgent} te pose {part.questions.length > 1 ? `${part.questions.length} questions` : "une question"}</span>
      {part.questions.map((q) => {
        const choisis = choix[q.question] ?? [];
        return (
          <fieldset key={q.question} className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 flex flex-col gap-0.5 p-0">
              {q.entete && <span className="text-ui-2xs font-medium text-texte-tertiaire">{q.entete}</span>}
              <span className="text-ui-s text-texte-principal">{q.question}</span>
            </legend>
            <div role={q.multiple ? "group" : "radiogroup"} className="flex flex-col gap-1">
              {[...q.options, { libelle: AUTRE, description: "" }].map((o) => {
                const actif = choisis.includes(o.libelle);
                return (
                  <button
                    key={o.libelle}
                    type="button"
                    role={q.multiple ? "checkbox" : "radio"}
                    aria-checked={actif}
                    onClick={() => basculer(q.question, o.libelle, q.multiple)}
                    className={cn(
                      "flex min-h-9 w-full cursor-pointer items-start gap-2.5 rounded-sm border px-2.5 py-2 text-left transition-colors duration-[120ms]",
                      actif ? "border-bleu-k1-500 bg-fond-teinte-bleue" : "border-bordure-subtile bg-fond-surface hover:border-bordure-forte",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
                        q.multiple ? "rounded-[4px]" : "rounded-full",
                        actif ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte bg-fond-surface",
                      )}
                    >
                      {actif && <Icon name="check-01" size={10} />}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-ui-s font-medium text-texte-principal">{o.libelle === AUTRE ? "Autre réponse" : o.libelle}</span>
                      {o.description && <span className="text-ui-xs leading-[1.45] text-texte-secondaire">{o.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {choisis.includes(AUTRE) && (
              <Textarea
                size="sm"
                autoGrow
                aria-label={`Ta réponse : ${q.question}`}
                value={autres[q.question] ?? ""}
                placeholder="Écris ta réponse"
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setAutres((a) => ({ ...a, [q.question]: e.target.value }))}
                className="min-h-[56px]"
              />
            )}
          </fieldset>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Bouton variant="sombre" taille="compact" disabled={!complet} onClick={() => onRepondre(Object.fromEntries(part.questions.map((q) => [q.question, reponseDe(q.question)])))}>
          Répondre
        </Bouton>
        <Bouton variant="blanc" taille="compact" onClick={() => onRepondre(null)}>
          Passer
        </Bouton>
      </div>
    </div>
  );
}

/* ─── Plan ────────────────────────────────────────────────────── */

/**
 * Le plan proposé en mode plan : le lire, puis « Lancer le plan » (l'agent sort du mode plan et s'y met) ou
 * « Corriger » (ce qu'il faut changer, l'agent le reprend).
 */
export function CartePlan({ part, nomAgent, onRepondre }: { part: Extract<MessagePart, { type: "plan" }>; nomAgent: string; onRepondre: (lancer: boolean, message: string) => void }) {
  const [deplie, setDeplie] = useState(false);
  const [corriger, setCorriger] = useState(false);
  const [message, setMessage] = useState("");
  const long = part.plan.split("\n").length > 14 || part.plan.length > 1200;
  const etat =
    part.statut === "lance" ? "Plan lancé" : part.statut === "corrige" ? "Plan à corriger" : part.statut === "abandonne" ? "Plan laissé de côté" : null;
  return (
    <div
      role="group"
      aria-label={`Plan de ${nomAgent}`}
      data-plan={part.statut}
      className={cn("flex w-full max-w-[680px] flex-col gap-3 rounded-lg border bg-fond-surface p-4 shadow-ombre-xs", part.statut === "attente" ? "border-bleu-k1-500" : "border-bordure-subtile")}
    >
      <div className="flex items-center gap-2">
        <Icon name="list" size={16} className="text-icone-accent" />
        <span className="text-ui-s font-semibold text-texte-principal">{part.statut === "attente" ? `${nomAgent} propose un plan` : `Plan de ${nomAgent}`}</span>
        {etat && <span className="ml-auto text-ui-2xs text-texte-tertiaire">{etat}</span>}
      </div>
      <div className={cn("relative overflow-hidden", long && !deplie && "max-h-[260px]")}>
        <Markdown source={part.plan} className="gap-2 text-ui-s leading-[1.55] text-texte-principal" />
        {long && !deplie && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-fond-surface to-transparent" />}
      </div>
      {long && (
        <button type="button" onClick={() => setDeplie((v) => !v)} className="w-fit cursor-pointer rounded-2xs border-0 bg-transparent px-1 py-0 text-ui-xs text-texte-secondaire hover:text-texte-principal">
          {deplie ? "Replier" : "Lire tout le plan"}
        </button>
      )}
      {part.statut === "corrige" && part.message && <p className="m-0 rounded-md bg-fond-survol px-3 py-2 text-ui-xs text-texte-secondaire">Ta correction : {part.message}</p>}
      {part.statut === "attente" && !corriger && (
        <div className="flex flex-wrap gap-2">
          <Bouton variant="sombre" taille="compact" onClick={() => onRepondre(true, "")}>
            Lancer le plan
          </Bouton>
          <Bouton variant="blanc" taille="compact" onClick={() => setCorriger(true)}>
            Corriger
          </Bouton>
        </div>
      )}
      {part.statut === "attente" && corriger && (
        <div className="flex flex-col gap-2">
          <Textarea
            size="sm"
            autoGrow
            autoFocus
            aria-label="Ce qu’il faut changer au plan"
            value={message}
            placeholder="Ce qu’il faut changer, ajouter ou retirer"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
            className="min-h-[72px]"
          />
          <div className="flex flex-wrap gap-2">
            <Bouton variant="sombre" taille="compact" disabled={!message.trim()} onClick={() => onRepondre(false, message.trim())}>
              Envoyer la correction
            </Bouton>
            <Bouton variant="blanc" taille="compact" onClick={() => setCorriger(false)}>
              Retour
            </Bouton>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Diff et sortie ──────────────────────────────────────────── */

type LigneDiff = { genre: "entete" | "ajout" | "retrait" | "contexte"; texte: string; a: number | null; n: number | null };

/** Les numéros de l'ancien et du nouveau fichier de chaque ligne d'un diff unifié. */
function numeroterDiff(brutes: string[]): LigneDiff[] {
  const lignes: LigneDiff[] = [];
  let ancien = 0;
  let nouveau = 0;
  for (const l of brutes) {
    const entete = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (entete) {
      ancien = Number(entete[1]);
      nouveau = Number(entete[2]);
      lignes.push({ genre: "entete", texte: l, a: null, n: null });
    } else if (l.startsWith("+")) lignes.push({ genre: "ajout", texte: l.slice(1), a: null, n: nouveau++ });
    else if (l.startsWith("-")) lignes.push({ genre: "retrait", texte: l.slice(1), a: ancien++, n: null });
    else lignes.push({ genre: "contexte", texte: l.slice(1), a: ancien++, n: nouveau++ });
  }
  return lignes;
}

/** Les lignes d'un diff unifié, avec les numéros de l'ancien et du nouveau fichier. */
export function DiffLignes({ modif }: { modif: ModifEtape }) {
  const lignes = useMemo(() => numeroterDiff(modif.lignes), [modif.lignes]);
  if (!lignes.length) return <p className="m-0 text-ui-xs text-texte-tertiaire">Pas de différence à montrer.</p>;
  return (
    <div className="klyra-diff max-h-[360px] overflow-auto rounded-md border border-bordure-subtile bg-fond-page" data-diff>
      <table className="w-full border-collapse">
        <tbody>
          {lignes.map((l, i) =>
            l.genre === "entete" ? (
              <tr key={i} className="klyra-diff-entete">
                <td colSpan={3} className="px-2 py-0.5">
                  {l.texte}
                </td>
              </tr>
            ) : (
              <tr key={i} className={l.genre === "ajout" ? "klyra-diff-ajout" : l.genre === "retrait" ? "klyra-diff-retrait" : undefined}>
                <td className="klyra-diff-numero">{l.a ?? ""}</td>
                <td className="klyra-diff-numero">{l.n ?? ""}</td>
                <td className="klyra-diff-texte">
                  <span aria-hidden="true" className="klyra-diff-signe">
                    {l.genre === "ajout" ? "+" : l.genre === "retrait" ? "−" : " "}
                  </span>
                  <span className="sr-only">{l.genre === "ajout" ? "Ajouté : " : l.genre === "retrait" ? "Retiré : " : ""}</span>
                  {l.texte}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {modif.tronque && <p className="m-0 px-2 py-1 text-ui-2xs text-texte-tertiaire">Diff coupé : la suite est dans le fichier.</p>}
    </div>
  );
}

/** Ce qu'une commande a écrit, comme dans un terminal (la fin), en direct pendant qu'elle tourne. */
export function SortieCommande({ texte, enCours, lignesMax }: { texte: string; enCours: boolean; lignesMax?: number }) {
  const lignes = texte.replace(/\n+$/, "").split("\n");
  const visibles = lignesMax ? lignes.slice(-lignesMax) : lignes;
  return (
    <pre
      aria-live={enCours ? "polite" : undefined}
      data-sortie={enCours ? "en-cours" : "finie"}
      className="klyra-mono m-0 max-h-[280px] overflow-auto rounded-md border border-bordure-subtile bg-fond-page px-2.5 py-2 text-ui-2xs leading-[1.5] whitespace-pre-wrap text-texte-secondaire [overflow-wrap:anywhere]"
    >
      {visibles.join("\n") || (enCours ? "…" : "(rien d’écrit)")}
    </pre>
  );
}

/** « +12 −3 » d'une modification. */
export function Compte({ ajouts, retraits }: { ajouts: number; retraits: number }) {
  return (
    <span className="klyra-mono shrink-0 text-ui-2xs">
      <span className="klyra-diff-plus">+{ajouts}</span> <span className="klyra-diff-moins">−{retraits}</span>
    </span>
  );
}

/* ─── Fichiers modifiés d'une réponse ─────────────────────────── */

function LigneFichier({ fichier, dossier, occupe, onGarder, onAnnuler, raison }: { fichier: FichierModifie; dossier: string | null; occupe: boolean; onGarder: () => void; onAnnuler: () => void; raison?: string }) {
  const [voir, setVoir] = useState(false);
  const chemin = cheminAffiche(fichier.chemin, dossier);
  const nom = chemin.split("/").at(-1) ?? chemin;
  const dossierAffiche = chemin.slice(0, chemin.length - nom.length).replace(/\/$/, "");
  return (
    <li className="flex flex-col gap-1.5 py-1.5" data-fichier-modifie={fichier.etat}>
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-expanded={voir}
          onClick={() => setVoir((v) => !v)}
          title={fichier.chemin}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent p-0 text-left"
        >
          <Icon name="chevron-right" size={14} className={cn("shrink-0 text-icone-secondaire transition-transform duration-[220ms] ease-sortie", voir && "rotate-90")} />
          <span className={cn("truncate text-ui-xs font-medium", fichier.etat === "annulee" ? "text-texte-tertiaire line-through" : "text-texte-principal")}>{nom}</span>
          {dossierAffiche && <span className="truncate text-ui-2xs text-texte-tertiaire">{dossierAffiche}</span>}
          {fichier.cree && <span className="shrink-0 text-ui-3xs text-texte-tertiaire">créé</span>}
        </button>
        <Compte ajouts={fichier.ajouts} retraits={fichier.retraits} />
        {fichier.etat === "a-revoir" ? (
          <span className="flex shrink-0 gap-1">
            <Bouton variant="discret" taille="mini" disabled={occupe} onClick={onGarder}>
              Garder
            </Bouton>
            <Bouton variant="discret" taille="mini" disabled={occupe || !fichier.annulable} title={fichier.annulable ? undefined : "L’app n’a pas gardé ce fichier (trop gros, ou pas du texte)"} onClick={onAnnuler}>
              Annuler
            </Bouton>
          </span>
        ) : (
          <span className="shrink-0 text-ui-2xs text-texte-tertiaire">{fichier.etat === "annulee" ? "Annulé" : "Gardé"}</span>
        )}
      </div>
      {raison && <p className="m-0 pl-5 text-ui-2xs text-texte-erreur">{raison}</p>}
      {voir && (
        <div className="flex flex-col gap-2 pl-5">
          {fichier.diffs.map((d) => (
            <DiffLignes key={d.id} modif={d.modif} />
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Sous une réponse finie : les fichiers qu'elle a modifiés (+/−, le diff d'un clic), à garder ou à annuler un
 * par un, ou tous. Annuler remet le fichier comme avant la réponse, s'il n'a pas changé depuis.
 */
export function ModificationsReponse({ message, dossier }: { message: Message; dossier: string | null }) {
  const { annulerModifications, garderModifications } = useWorkspace();
  const [demander, fenetre] = useConfirmation();
  const [occupe, setOccupe] = useState(false);
  const [raisons, setRaisons] = useState<Record<string, string>>({});
  const fichiers = useMemo(() => fichiersModifies(message), [message]);
  if (!fichiers.length) return null;
  const aRevoir = fichiers.filter((f) => f.etat === "a-revoir");
  const ajouts = fichiers.reduce((n, f) => n + f.ajouts, 0);
  const retraits = fichiers.reduce((n, f) => n + f.retraits, 0);

  const annuler = async (liste: FichierModifie[]) => {
    setOccupe(true);
    try {
      const ids = liste.flatMap((f) => f.ids);
      let r = await annulerModifications(message.chatId, ids);
      const conflits = r.fichiers.filter((f) => f.etat === "conflit");
      if (conflits.length) {
        const forcer = await demander({
          titre: conflits.length > 1 ? `${conflits.length} fichiers ont changé depuis` : "Le fichier a changé depuis",
          texte: (
            <>
              {conflits.map((c) => cheminAffiche(c.chemin, dossier)).join(", ")} {conflits.length > 1 ? "ont été modifiés" : "a été modifié"} après cette réponse. Annuler {conflits.length > 1 ? "les" : "le"} remet tel qu’il était avant la réponse et perd ces changements-là.
            </>
          ),
          confirmer: "Annuler quand même",
          annuler: "Garder tel quel",
        });
        if (forcer) {
          const idsConflits = liste.filter((f) => conflits.some((c) => c.chemin === f.chemin)).flatMap((f) => f.ids);
          const force = await annulerModifications(message.chatId, idsConflits, true);
          r = { fichiers: [...r.fichiers.filter((f) => f.etat !== "conflit"), ...force.fichiers] };
        }
      }
      setRaisons(Object.fromEntries(r.fichiers.filter((f) => f.etat === "impossible" || f.etat === "conflit").map((f) => [f.chemin, f.raison ?? "Pas annulé."])));
    } catch (e) {
      setRaisons(Object.fromEntries(liste.map((f) => [f.chemin, e instanceof Error ? e.message : "Annulation impossible."])));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <section aria-label="Fichiers modifiés" data-modifications className="flex w-full max-w-[680px] flex-col rounded-lg border border-bordure-subtile bg-fond-surface px-3 py-2 shadow-ombre-xs">
      <div className="flex min-h-7 items-center gap-2">
        <Icon name="file-code" size={16} className="text-icone-secondaire" />
        <span className="text-ui-xs font-medium text-texte-principal">
          {fichiers.length} fichier{fichiers.length > 1 ? "s" : ""} modifié{fichiers.length > 1 ? "s" : ""}
        </span>
        <Compte ajouts={ajouts} retraits={retraits} />
        {aRevoir.length > 1 && (
          <span className="ml-auto flex gap-1">
            <Bouton variant="discret" taille="mini" disabled={occupe} onClick={() => garderModifications(message.id, aRevoir.flatMap((f) => f.ids))}>
              Tout garder
            </Bouton>
            <Bouton variant="discret" taille="mini" disabled={occupe || !aRevoir.some((f) => f.annulable)} onClick={() => void annuler(aRevoir.filter((f) => f.annulable))}>
              Tout annuler
            </Bouton>
          </span>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile p-0">
        {fichiers.map((f) => (
          <LigneFichier
            key={f.chemin}
            fichier={f}
            dossier={dossier}
            occupe={occupe}
            raison={raisons[f.chemin]}
            onGarder={() => garderModifications(message.id, f.ids)}
            onAnnuler={() => void annuler([f])}
          />
        ))}
      </ul>
      {fenetre as ReactNode}
    </section>
  );
}

/* ─── Revenir à avant un message ──────────────────────────────── */

/** Une case à cocher de la fenêtre (le bouton est la case : clavier et lecteur d'écran compris). */
function Case({ coche, desactive, onChange, titre, detail }: { coche: boolean; desactive?: boolean; onChange: (v: boolean) => void; titre: string; detail: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={coche}
      disabled={desactive}
      onClick={() => onChange(!coche)}
      className="flex w-full cursor-pointer items-start gap-2.5 rounded-sm border border-bordure-subtile bg-fond-surface px-3 py-2.5 text-left transition-colors duration-[120ms] enabled:hover:border-bordure-forte disabled:cursor-default disabled:opacity-60"
    >
      <span aria-hidden="true" className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border", coche ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte")}>
        {coche && <Icon name="check-01" size={10} />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ui-s font-medium text-texte-principal">{titre}</span>
        <span className="text-ui-xs leading-[1.45] text-texte-secondaire">{detail}</span>
      </span>
    </button>
  );
}

/**
 * « Revenir à avant ce message » : remettre les fichiers modifiés depuis comme ils étaient, et/ou reprendre la
 * conversation d'avant (les messages suivants retirés, le tien remis dans le champ, l'agent repart de là).
 * Un fichier changé depuis par quelqu'un d'autre : rien n'est touché sans « Remettre quand même ».
 */
export function FenetreRevenirAvant({ chat, messageId, onFermer }: { chat: Chat; messageId: string; onFermer: () => void }) {
  const messages = useChatMessages(chat.id);
  const { revenirAvant, state } = useWorkspace();
  const { chemins } = useMemo(() => modificationsDepuis(messages, messageId), [messages, messageId]);
  const suite = messages.length - messages.findIndex((m) => m.id === messageId) - 1;
  const avecClaude = moteurDe(chat) === PAR_DEFAUT;
  const [fichiers, setFichiers] = useState(chemins.length > 0);
  const [conversation, setConversation] = useState(true);
  const [occupe, setOccupe] = useState(false);
  const [resultat, setResultat] = useState<ResultatAnnulation | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const dossier = chat.kind === "equipe" ? (state.projects.find((p) => p.id === chat.projectId)?.folder ?? null) : null;
  const conflits = resultat?.fichiers.filter((f) => f.etat === "conflit") ?? [];

  const lancer = async (forcer: boolean) => {
    setOccupe(true);
    setErreur(null);
    try {
      const r = await revenirAvant(chat.id, messageId, { fichiers, conversation, forcer });
      setResultat(r);
      if (!r || !r.fichiers.some((f) => f.etat === "conflit" || f.etat === "impossible")) onFermer();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Retour impossible.");
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Modale
      titre="Revenir à avant ce message"
      onFermer={onFermer}
      className="w-[460px]"
      actions={
        <>
          <Bouton variant="blanc" taille="md" data-autofocus onClick={onFermer}>
            {resultat ? "Fermer" : "Annuler"}
          </Bouton>
          {conflits.length > 0 ? (
            <Bouton variant="sombre" taille="md" disabled={occupe} onClick={() => void lancer(true)}>
              Remettre quand même
            </Bouton>
          ) : (
            !resultat && (
              <Bouton variant="sombre" taille="md" disabled={occupe || (!fichiers && !conversation)} onClick={() => void lancer(false)}>
                Revenir
              </Bouton>
            )
          )}
        </>
      }
    >
      <div className="flex flex-col gap-2 pt-1">
        <Case
          coche={fichiers}
          desactive={!chemins.length}
          onChange={setFichiers}
          titre="Remettre les fichiers comme avant"
          detail={chemins.length ? `${chemins.length} fichier${chemins.length > 1 ? "s" : ""} modifié${chemins.length > 1 ? "s" : ""} depuis par les agents. Les commandes qu’ils ont lancées ne sont pas défaites.` : "Aucun fichier modifié depuis ce message."}
        />
        <Case
          coche={conversation}
          onChange={setConversation}
          titre="Reprendre la conversation d’avant ce message"
          detail={`${suite > 0 ? `${suite + 1} messages retirés (celui-ci compris)` : "Ce message retiré"} ; son texte revient dans le champ.${avecClaude ? " L’agent repart de là, sans souvenir de la suite." : " L’agent oublie cette conversation."}`}
        />
        {conflits.length > 0 && (
          <p role="alert" className="m-0 text-ui-xs text-texte-erreur">
            {conflits.map((c) => cheminAffiche(c.chemin, dossier)).join(", ")} {conflits.length > 1 ? "ont changé" : "a changé"} depuis la dernière modification d’un agent : rien n’a été touché. « Remettre quand même » perd ces changements.
          </p>
        )}
        {resultat?.fichiers
          .filter((f) => f.etat === "impossible")
          .map((f) => (
            <p key={f.chemin} className="m-0 text-ui-xs text-texte-erreur">
              {cheminAffiche(f.chemin, dossier)} : {f.raison}
            </p>
          ))}
        {erreur && (
          <p role="alert" className="m-0 text-ui-xs text-texte-erreur">
            {erreur}
          </p>
        )}
      </div>
    </Modale>
  );
}
