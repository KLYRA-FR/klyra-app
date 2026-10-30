"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Input, Textarea } from "klyra-ui";
import { Icon, type IconName } from "@/components/icons/Icon";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { CHAMP } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { cn } from "@/lib/cn";
import { aujourdhui, cleJour, depuisCle, grilleMois } from "@/lib/dates";
import { evenementsEquipeEntre } from "@/lib/agenda-equipe";
import { joursSpeciauxEntre, type GenreJour, type JourSpecial } from "@/lib/jours-speciaux";
import { usePassagesRoutines } from "@/lib/routines-passages";
import { useProjects, useWorkspace } from "@/lib/workspace";
import type { Evenement, RoleTeinte, Tache } from "@/types/domain";
import type { Routine } from "@/types/routines";
import { CaseTache } from "./Rappels";

/**
 * Le calendrier, comme Calendrier d'Apple : un jour, une semaine ou un mois.
 * En jour et en semaine, la grille des heures avec les événements à leur
 * place, la ligne de l'heure actuelle, et un clic sur un créneau pour créer.
 */

type Vue = "jour" | "semaine" | "mois";

/** Hauteur d'une heure dans la grille, en px. */
const HEURE = 44;
/** La journée de travail : la grille montre de 8 h à 18 h, on fait défiler pour le reste. */
const DEBUT_JOURNEE = 8;
const FIN_JOURNEE = 18;
const JOURS = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."];
const fmtMois = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const fmtMoisCourt = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const fmtJour = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const capitaliser = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const enMinutes = (h: string) => {
  const [a, b] = h.split(":").map(Number);
  return (a || 0) * 60 + (b || 0);
};
const versHeure = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Le lundi de la semaine d'un jour. */
function lundi(cle: string): Date {
  const d = depuisCle(cle);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function decaler(cle: string, vue: Vue, sens: number): string {
  const d = depuisCle(cle);
  if (vue === "jour") d.setDate(d.getDate() + sens);
  if (vue === "semaine") d.setDate(d.getDate() + 7 * sens);
  if (vue === "mois") {
    d.setDate(1);
    d.setMonth(d.getMonth() + sens);
  }
  return cleJour(d);
}

/* ─── Ce qui tombe chaque jour ─────────────────────────────────── */

interface Passage {
  routine: Routine;
  heure: string;
}

function useContenu(debut: Date, fin: Date) {
  const { state } = useWorkspace();
  const passagesRoutines = usePassagesRoutines(debut, fin);
  return useMemo(() => {
    const evenements = new Map<string, Evenement[]>();
    const taches = new Map<string, Tache[]>();
    const passages = new Map<string, Passage[]>();
    const pousser = <T,>(m: Map<string, T[]>, cle: string, v: T) => m.set(cle, [...(m.get(cle) ?? []), v]);
    for (const e of [...state.evenements, ...evenementsEquipeEntre(debut, fin)]) pousser(evenements, e.date, e);
    for (const t of state.taches) {
      if (!t.date) continue;
      /* Un rappel sur plusieurs jours apparaît chaque jour, du premier au dernier. */
      const jour = depuisCle(t.date);
      const dernier = t.fin && t.fin > t.date ? t.fin : t.date;
      for (let i = 0; i < 366 && cleJour(jour) <= dernier; i++, jour.setDate(jour.getDate() + 1)) pousser(taches, cleJour(jour), t);
    }
    for (const { routine, at } of passagesRoutines) {
      const date = new Date(at);
      pousser(passages, cleJour(date), { routine, heure: fmtHeure.format(date) });
    }
    return { evenements, taches, passages, speciaux: joursSpeciauxEntre(debut, fin) };
  }, [state.evenements, state.taches, passagesRoutines, debut, fin]);
}

/* ─── Les petites formes du calendrier, comme dans Calendrier d'Apple ── */

/** Jours fériés en vert, fêtes en rose, changements d'heure en violet (pastels des catégories). */
const TEINTE_JOUR: Record<GenreJour, RoleTeinte> = { ferie: "vert", fete: "rose", heure: "violet" };
const ICONE_JOUR: Record<GenreJour, IconName> = { ferie: "calendar-01", fete: "calendar-01", heure: "clock-01" };

/** Un jour férié, une fête ou un changement d'heure : une pastille teintée sur toute la largeur. */
function PastilleJour({ jour }: { jour: JourSpecial }) {
  const p = AGENT_PASTELS[TEINTE_JOUR[jour.genre]];
  return (
    <span title={jour.nom} className="flex h-5 min-w-0 shrink-0 items-center gap-1 rounded-full pr-2 pl-0.5 text-ui-2xs font-medium" style={{ background: p.bas, color: p.encre }}>
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-full text-texte-inverse" style={{ background: p.accent }}>
        <Icon name={ICONE_JOUR[jour.genre]} size={10} />
      </span>
      <span className="truncate">{jour.nom}</span>
    </span>
  );
}

/** Un événement sur toute la journée : pastille bleue claire. */
function PastilleEvenement({ titre, onClick }: { titre: string; onClick?: () => void }) {
  return (
    <span
      role={onClick ? "button" : undefined}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      className="flex h-5 min-w-0 shrink-0 items-center rounded-full bg-fond-teinte-bleue px-2 text-ui-2xs font-medium text-texte-accent"
    >
      <span className="truncate">{titre}</span>
    </span>
  );
}

type Genre = "e" | "t" | "tf" | "r";

/** Devant un élément à heure : un trait pour un événement, un rond pour un rappel (plein s'il est fait). */
function Repere({ type, couleur }: { type: Genre; couleur?: string }) {
  if (type === "e") return <span aria-hidden="true" className="h-3.5 w-[3px] shrink-0 rounded-full bg-bleu-k1-500" />;
  if (type === "r") return <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full border border-dashed border-bordure-forte" />;
  return (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-full border-2 border-bordure-forte"
      style={couleur ? (type === "tf" ? { background: couleur, borderColor: couleur } : { borderColor: couleur }) : undefined}
    />
  );
}

/** Les événements d'un jour placés en colonnes quand ils se chevauchent. */
function placer(evenements: Evenement[]) {
  const avecHeure = evenements
    .filter((e) => e.debut)
    .map((e) => {
      const debut = enMinutes(e.debut!);
      const fin = Math.max(debut + 30, e.fin ? enMinutes(e.fin) : debut + 60);
      return { e, debut, fin, colonne: 0, colonnes: 1 };
    })
    .sort((a, b) => a.debut - b.debut);
  const ouverts: typeof avecHeure = [];
  for (const x of avecHeure) {
    for (let i = ouverts.length - 1; i >= 0; i--) if (ouverts[i].fin <= x.debut) ouverts.splice(i, 1);
    const prises = new Set(ouverts.map((o) => o.colonne));
    let c = 0;
    while (prises.has(c)) c++;
    x.colonne = c;
    ouverts.push(x);
    const n = Math.max(...ouverts.map((o) => o.colonne)) + 1;
    for (const o of ouverts) o.colonnes = Math.max(o.colonnes, n);
  }
  return avecHeure;
}

/* ─── Créer ou modifier un événement ───────────────────────────── */

function FenetreEvenement({ initial, onFermer }: { initial: Evenement; onFermer: () => void }) {
  const { enregistrerEvenement, supprimerEvenement, state } = useWorkspace();
  const projects = useProjects();
  const [e, setE] = useState(initial);
  const existe = state.evenements.some((x) => x.id === initial.id);
  const journee = e.debut === null;

  useEffect(() => {
    const echap = (ev: KeyboardEvent) => ev.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer]);

  const enregistrer = (ev: FormEvent) => {
    ev.preventDefault();
    if (!e.titre.trim()) return;
    enregistrerEvenement({
      ...e,
      titre: e.titre.trim(),
      notifie: e.date === initial.date && e.debut === initial.debut ? e.notifie : false,
    });
    onFermer();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-fond-inverse-fort/20 p-6"
      onMouseDown={onFermer}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Événement"
        onSubmit={enregistrer}
        onMouseDown={(x) => x.stopPropagation()}
        className="flex w-[380px] max-w-full flex-col gap-3 rounded-xl border border-bordure-subtile bg-fond-surface p-4 shadow-ombre-flottante"
      >
        <input
          autoFocus
          value={e.titre}
          placeholder="Nouvel événement"
          onChange={(x) => setE({ ...e, titre: x.target.value })}
          className="border-0 bg-transparent p-0 text-ui font-semibold text-texte-principal outline-none placeholder:text-texte-tertiaire"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            type="date"
            value={e.date}
            onChange={(x) => x.target.value && setE({ ...e, date: x.target.value })}
            className={cn(CHAMP, "w-[150px]")}
          />
          {!journee && (
            <>
              <Input
                size="sm"
                type="time"
                value={e.debut ?? ""}
                onChange={(x) => setE({ ...e, debut: x.target.value || "09:00" })}
                className={cn(CHAMP, "w-[96px]")}
              />
              <span className="text-ui-s text-texte-tertiaire">à</span>
              <Input
                size="sm"
                type="time"
                value={e.fin ?? ""}
                onChange={(x) => setE({ ...e, fin: x.target.value || null })}
                className={cn(CHAMP, "w-[96px]")}
              />
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-ui-s text-texte-principal">
          <input
            type="checkbox"
            checked={journee}
            onChange={() => setE({ ...e, debut: journee ? "09:00" : null, fin: journee ? "10:00" : null })}
            className="size-4 accent-bleu-k1-500"
          />
          Toute la journée
        </label>
        <ListeDeroulante
          libelle="Projet"
          value={e.projectId ?? ""}
          options={[{ value: "", label: "Aucun projet" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(v) => setE({ ...e, projectId: v || null })}
        />
        <Textarea
          size="sm"
          autoGrow
          value={e.notes}
          placeholder="Notes"
          onChange={(x) => setE({ ...e, notes: x.target.value })}
          className={cn(CHAMP, "min-h-[56px]")}
        />
        <div className="flex flex-wrap gap-2">
          <Bouton type="submit" variant="sombre" taille="compact" disabled={!e.titre.trim()}>
            {existe ? "Enregistrer" : "Ajouter"}
          </Bouton>
          <Bouton variant="blanc" taille="compact" onClick={onFermer}>
            Annuler
          </Bouton>
          {existe && (
            <Bouton
              variant="discret"
              taille="compact"
              iconeGauche={<Icon name="trash-01" size={16} />}
              onClick={() => {
                supprimerEvenement(e.id);
                onFermer();
              }}
              className="ml-auto"
            >
              Supprimer
            </Bouton>
          )}
        </div>
      </form>
    </div>
  );
}

/* ─── Jour et semaine : la grille des heures ───────────────────── */

/** Largeur de la marge des heures, en px. */
const MARGE = 56;

/** Le créneau d'une demi-heure à une hauteur de la grille, en minutes depuis minuit. */
const creneauA = (y: number) => Math.max(0, Math.min(23 * 60 + 30, Math.floor((y / HEURE) * 2) * 30));

/**
 * Le survol de la grille : le créneau sous la souris prend un fond léger et
 * affiche son heure, et l'heure correspondante passe en valeur dans la marge.
 * Écrit directement dans le DOM, sans état : la grille ne se re-rend pas
 * quand la souris bouge. Rien sur un événement ou un rappel (le clic l'ouvre).
 */
function useSurvolCreneau(nbJours: number) {
  const grille = useRef<HTMLDivElement>(null);
  const pointeur = useRef<{ x: number; y: number } | null>(null);
  const actif = useRef<{ jour: number; min: number } | null>(null);

  /* Un créneau par colonne (`data-creneau`) : il passe sur le grisé des heures
     creuses, sous les événements. Les heures de la marge : `data-libelle`. */
  const trouver = (attribut: string, valeur: number) =>
    grille.current?.querySelector<HTMLElement>(`[${attribut}="${valeur}"]`) ?? null;

  const afficher = (creneau: { jour: number; min: number } | null) => {
    const avant = actif.current;
    if (avant?.jour === creneau?.jour && avant?.min === creneau?.min) return;
    actif.current = creneau;
    if (avant) {
      trouver("data-libelle", Math.floor(avant.min / 60))?.removeAttribute("data-survol");
      if (avant.jour !== creneau?.jour) trouver("data-creneau", avant.jour)?.removeAttribute("data-actif");
    }
    const el = creneau && trouver("data-creneau", creneau.jour);
    if (!creneau || !el) return;
    el.style.transform = `translateY(${(creneau.min / 60) * HEURE}px)`;
    const texte = el.querySelector("[data-heure]");
    if (texte) texte.textContent = versHeure(creneau.min);
    el.setAttribute("data-actif", "");
    trouver("data-libelle", Math.floor(creneau.min / 60))?.setAttribute("data-survol", "");
  };

  const suivre = (cible: Element | null) => {
    const g = grille.current;
    const p = pointeur.current;
    if (!g || !p) return afficher(null);
    const r = g.getBoundingClientRect();
    const x = p.x - r.left;
    const y = p.y - r.top;
    const jour = Math.floor((x - MARGE) / ((r.width - MARGE) / nbJours));
    if (x < MARGE || jour >= nbJours || y < 0 || cible?.closest("button, [data-bloc]")) return afficher(null);
    afficher({ jour, min: creneauA(y) });
  };

  const bouger = (ev: ReactMouseEvent<HTMLDivElement>) => {
    pointeur.current = { x: ev.clientX, y: ev.clientY };
    suivre(ev.target as Element);
  };
  const quitter = () => {
    pointeur.current = null;
    afficher(null);
  };
  /* La grille défile sous la souris immobile : le créneau change aussi. */
  const defiler = () => {
    const p = pointeur.current;
    if (p) suivre(document.elementFromPoint(p.x, p.y));
  };

  return { grille, bouger, quitter, defiler };
}

function GrilleHeures({
  jours,
  onCreer,
  onOuvrir,
}: {
  jours: Date[];
  onCreer: (cle: string, heure: string) => void;
  onOuvrir: (e: Evenement) => void;
}) {
  const { enregistrerTache, state } = useWorkspace();
  const teinteDe = (t: Tache) => (state.categories.find((c) => c.id === t.liste) ?? state.categories[0])?.teinte;
  const debut = jours[0];
  const fin = useMemo(() => {
    const d = new Date(jours[jours.length - 1]);
    d.setDate(d.getDate() + 1);
    return d;
  }, [jours]);
  const { evenements, taches, passages, speciaux } = useContenu(debut, fin);
  const zone = useRef<HTMLDivElement>(null);
  const auj = aujourdhui();
  const [minute, setMinute] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());

  useEffect(() => {
    const id = setInterval(() => setMinute(new Date().getHours() * 60 + new Date().getMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);
  /* À l'ouverture, la grille commence à 8 h. */
  useEffect(() => {
    if (zone.current) zone.current.scrollTop = DEBUT_JOURNEE * HEURE;
  }, []);

  const colonnes = `${MARGE}px repeat(${jours.length}, minmax(0, 1fr))`;
  const { grille, bouger, quitter, defiler } = useSurvolCreneau(jours.length);
  const tacheCochee = (t: Tache) =>
    enregistrerTache({ ...t, faite: !t.faite, faiteLe: t.faite ? null : new Date().toISOString() });

  const cliquer = (cle: string, ev: ReactMouseEvent<HTMLDivElement>) => {
    const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
    onCreer(cle, versHeure(creneauA(y)));
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-bordure-subtile bg-fond-surface">
      {/* Les jours */}
      <div className="grid border-b border-bordure-subtile" style={{ gridTemplateColumns: colonnes }}>
        <span />
        {jours.map((d) => {
          const cle = cleJour(d);
          return (
            <div
              key={cle}
              className="flex items-center justify-center gap-1.5 border-l border-bordure-subtile py-2 text-ui-s"
            >
              <span className="text-texte-secondaire">{JOURS[(d.getDay() + 6) % 7]}</span>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full font-semibold",
                  cle === auj ? "bg-bleu-k1-500 text-texte-inverse" : "text-texte-principal",
                )}
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Toute la journée : événements sans heure et tâches à date sans heure */}
      <div className="grid border-b border-bordure-subtile" style={{ gridTemplateColumns: colonnes }}>
        <span className="px-1.5 py-1.5 text-right text-ui-3xs leading-tight text-texte-tertiaire">Journée</span>
        {jours.map((d) => {
          const cle = cleJour(d);
          return (
            <div key={cle} className="flex min-h-8 min-w-0 flex-col gap-0.5 border-l border-bordure-subtile p-1">
              {(speciaux.get(cle) ?? []).map((j) => (
                <PastilleJour key={j.nom} jour={j} />
              ))}
              {(evenements.get(cle) ?? [])
                .filter((e) => !e.debut)
                .map((e) => (
                  <PastilleEvenement key={e.id} titre={e.titre} onClick={() => onOuvrir(e)} />
                ))}
              {(taches.get(cle) ?? [])
                .filter((t) => !t.heure)
                .map((t) => (
                  <span key={t.id} className="flex min-w-0 items-center gap-1 px-0.5 text-ui-3xs">
                    <span className="scale-75">
                      <CaseTache faite={t.faite} onChange={() => tacheCochee(t)} libelle={t.titre} teinte={teinteDe(t)} />
                    </span>
                    <span
                      className={cn("truncate", t.faite ? "text-texte-tertiaire line-through" : "text-texte-principal")}
                    >
                      {t.titre}
                    </span>
                  </span>
                ))}
            </div>
          );
        })}
      </div>

      {/* Les heures */}
      <div
        ref={zone}
        onScroll={defiler}
        className="relative overflow-y-auto"
        style={{ height: (FIN_JOURNEE - DEBUT_JOURNEE) * HEURE }}
      >
        <div
          ref={grille}
          onMouseMove={bouger}
          onMouseLeave={quitter}
          className="grid"
          style={{ gridTemplateColumns: colonnes, height: 24 * HEURE }}
        >
          <div className="relative">
            {/* L'heure qu'il est, dans la marge, comme dans Calendrier. */}
            {jours.some((d) => cleJour(d) === auj) && (
              <span
                aria-label={`Il est ${versHeure(minute)}`}
                className="klyra-mono absolute right-1 z-20 -translate-y-1/2 rounded-full bg-bleu-k1-500 px-1.5 py-px text-ui-3xs font-semibold text-texte-inverse"
                style={{ top: (minute / 60) * HEURE }}
              >
                {versHeure(minute)}
              </span>
            )}
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                data-libelle={h}
                className="klyra-mono absolute right-2 -translate-y-1/2 text-ui-3xs text-texte-tertiaire data-survol:font-semibold data-survol:text-texte-principal"
                style={{ top: h * HEURE }}
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          {jours.map((d, i) => {
            const cle = cleJour(d);
            const places = placer(evenements.get(cle) ?? []);
            return (
              <div
                key={cle}
                onClick={(ev) => cliquer(cle, ev)}
                className="relative cursor-pointer border-l border-bordure-subtile"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--color-bordure-subtile) 0 1px, transparent 1px ${HEURE}px)`,
                }}
              >
                {/* Avant 8 h et après 18 h : grisé. */}
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 bg-fond-page/70" style={{ height: DEBUT_JOURNEE * HEURE }} />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 bg-fond-page/70"
                  style={{ top: FIN_JOURNEE * HEURE }}
                />
                {/* Le créneau sous la souris, montré par useSurvolCreneau. */}
                <span
                  data-creneau={i}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 opacity-0 transition-opacity duration-[120ms] ease-sortie data-actif:opacity-100"
                  style={{ height: HEURE / 2 }}
                >
                  <span className="absolute inset-x-[2px] inset-y-px flex items-center gap-1 rounded-sm bg-fond-survol pl-2 text-texte-secondaire">
                    <Icon name="plus-01" size={12} className="shrink-0 text-icone-secondaire" />
                    <span data-heure className="klyra-mono text-ui-2xs leading-4 font-semibold" />
                  </span>
                </span>
                {places.map(({ e, debut, fin, colonne, colonnes: n }) => {
                  /* Comme dans Calendrier : un bloc teinté, un trait à gauche ; passé, il se grise en hachures. */
                  const passe = cle < auj || (cle === auj && fin <= minute);
                  const hauteur = Math.max(22, ((fin - debut) / 60) * HEURE - 2);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      disabled={e.equipe}
                      title={e.equipe ? `${e.titre} · ${e.notes} · chaque semaine` : undefined}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOuvrir(e);
                      }}
                      className={cn(
                        "absolute flex cursor-pointer flex-col gap-0.5 overflow-hidden rounded-sm border-0 py-1 pr-1.5 pl-3 text-left transition-[filter] duration-[120ms] hover:brightness-[0.97] disabled:cursor-default",
                        passe ? "text-texte-tertiaire" : "bg-fond-teinte-bleue text-texte-accent",
                      )}
                      style={{
                        top: (debut / 60) * HEURE + 1,
                        height: hauteur,
                        left: `calc(${(colonne / n) * 100}% + 2px)`,
                        width: `calc(${100 / n}% - 4px)`,
                        backgroundImage: passe
                          ? "repeating-linear-gradient(135deg, var(--color-fond-surface-grise) 0 6px, var(--color-fond-page) 6px 12px)"
                          : undefined,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute top-1 bottom-1 left-1 w-[3px] rounded-full",
                          passe ? "bg-gris-k1-100" : e.equipe ? "bg-bleu-k2-500" : "bg-bleu-k1-500",
                        )}
                      />
                      <span className="flex min-w-0 items-start gap-1">
                        <span className="min-w-0 flex-1 truncate text-ui-2xs leading-4 font-semibold">{e.titre}</span>
                        {e.repete && <Icon name="refresh-01" size={12} className="mt-0.5 shrink-0" />}
                      </span>
                      {hauteur >= 38 && (
                        <span className="flex min-w-0 items-center gap-1 text-ui-3xs leading-4 opacity-85">
                          <Icon name={e.equipe ? "users-profiles-01" : "clock-01"} size={11} className="shrink-0" />
                          <span className="klyra-mono truncate">
                            {e.debut}
                            {e.fin ? ` – ${e.fin}` : ""}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
                {(taches.get(cle) ?? [])
                  .filter((t) => t.heure)
                  .map((t) => (
                    <span
                      key={t.id}
                      data-bloc
                      onClick={(ev) => ev.stopPropagation()}
                      className="absolute right-1 left-1 flex h-5 items-center gap-1 rounded-2xs bg-fond-surface px-1 text-ui-3xs shadow-ombre-xs"
                      style={{ top: (enMinutes(t.heure!) / 60) * HEURE }}
                    >
                      <span className="scale-75">
                        <CaseTache faite={t.faite} onChange={() => tacheCochee(t)} libelle={t.titre} teinte={teinteDe(t)} />
                      </span>
                      <span
                        className={cn(
                          "truncate",
                          t.faite ? "text-texte-tertiaire line-through" : "text-texte-principal",
                        )}
                      >
                        {t.titre}
                      </span>
                    </span>
                  ))}
                {(passages.get(cle) ?? []).map((p) => (
                  <span
                    key={`${p.routine.id}-${p.heure}`}
                    title={`${p.routine.name} (routine)`}
                    className="absolute right-1 left-1 flex h-5 items-center gap-1 rounded-2xs border border-dashed border-bordure-forte bg-fond-surface px-1 text-ui-3xs text-texte-secondaire"
                    style={{ top: (enMinutes(p.heure) / 60) * HEURE }}
                  >
                    <AgentRond roleId={p.routine.agentId} taille={12} />
                    <span className="truncate">{p.routine.name}</span>
                  </span>
                ))}
                {/* L'heure qu'il est */}
                {cle === auj && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-0 left-0 z-10 h-px bg-bleu-k1-500"
                    style={{ top: (minute / 60) * HEURE }}
                  >
                    <span className="absolute -top-[3px] -left-[4px] size-[7px] rounded-full bg-bleu-k1-500" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── Mois ─────────────────────────────────────────────────────── */

function Mois({ cle, onJour }: { cle: string; onJour: (cle: string) => void }) {
  const ref = useMemo(() => depuisCle(cle), [cle]);
  const jours = useMemo(() => grilleMois(ref.getFullYear(), ref.getMonth()), [ref]);
  const fin = useMemo(() => {
    const d = new Date(jours[41]);
    d.setDate(d.getDate() + 1);
    return d;
  }, [jours]);
  const { evenements, taches, passages, speciaux } = useContenu(jours[0], fin);
  const { state } = useWorkspace();
  const couleurDe = (t: Tache) => {
    const teinte = (state.categories.find((c) => c.id === t.liste) ?? state.categories[0])?.teinte;
    return teinte ? AGENT_PASTELS[teinte]?.accent : undefined;
  };
  const auj = aujourdhui();

  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-bordure-subtile bg-fond-surface">
      {JOURS.map((j) => (
        <div
          key={j}
          className="border-b border-bordure-subtile px-2 py-1.5 text-right text-ui-2xs font-medium text-texte-tertiaire"
        >
          {j}
        </div>
      ))}
      {jours.map((d, i) => {
        const c = cleJour(d);
        const dansMois = d.getMonth() === ref.getMonth();
        const items = [
          ...(evenements.get(c) ?? [])
            .filter((e) => e.debut)
            .map((e) => ({ id: e.id, texte: e.titre, heure: e.debut, type: "e" as Genre, couleur: undefined as string | undefined })),
          ...(taches.get(c) ?? []).map((t) => ({
            id: t.id,
            texte: t.titre,
            heure: t.heure,
            type: (t.faite ? "tf" : "t") as Genre,
            couleur: couleurDe(t),
          })),
          ...(passages.get(c) ?? []).map((p) => ({
            id: `${p.routine.id}${p.heure}`,
            texte: p.routine.name,
            heure: p.heure,
            type: "r" as Genre,
            couleur: undefined as string | undefined,
          })),
        ].sort((a, b) => (a.heure ?? "").localeCompare(b.heure ?? ""));
        const speciauxDuJour = speciaux.get(c) ?? [];
        const journee = (evenements.get(c) ?? []).filter((e) => !e.debut);
        const pastilles = speciauxDuJour.length + journee.length;
        const reste = Math.max(0, 4 - pastilles);
        const weekEnd = i % 7 >= 5;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onJour(c)}
            className={cn(
              "flex min-h-[112px] min-w-0 cursor-pointer flex-col gap-0.5 border-0 p-1.5 text-left transition-colors duration-[120ms] hover:bg-fond-survol",
              i % 7 !== 6 && "border-r border-bordure-subtile",
              i < 35 && "border-b border-bordure-subtile",
              weekEnd ? "bg-fond-page" : "bg-fond-surface",
            )}
          >
            {/* Le numéro en haut à droite ; le 1er du mois porte aussi le mois, comme dans Calendrier. */}
            <span
              className={cn(
                "mb-0.5 ml-auto flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-ui font-medium",
                c === auj ? "bg-bleu-k1-500 text-texte-inverse" : dansMois && !weekEnd ? "text-texte-principal" : "text-texte-tertiaire",
              )}
            >
              {d.getDate() === 1 ? `1 ${fmtMoisCourt.format(d)}` : d.getDate()}
            </span>
            {speciauxDuJour.map((j) => (
              <PastilleJour key={j.nom} jour={j} />
            ))}
            {journee.map((e) => (
              <PastilleEvenement key={e.id} titre={e.titre} />
            ))}
            {items.slice(0, reste).map((it) => (
              <span key={it.id} className="flex min-w-0 items-center gap-1.5 px-0.5 text-ui-2xs leading-5">
                <Repere type={it.type} couleur={it.couleur} />
                <span className={cn("truncate", it.type === "tf" ? "text-texte-tertiaire line-through" : "text-texte-principal")}>{it.texte}</span>
                {it.heure && <span className="klyra-mono ml-auto shrink-0 text-ui-3xs text-texte-tertiaire">{it.heure}</span>}
              </span>
            ))}
            {items.length > reste && <span className="px-0.5 text-ui-3xs text-texte-tertiaire">+ {items.length - reste} autres</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Le calendrier ────────────────────────────────────────────── */

export function Agenda() {
  const [vue, setVue] = useState<Vue>("semaine");
  const [cle, setCle] = useState(aujourdhui());
  const [edition, setEdition] = useState<Evenement | null>(null);

  const jours = useMemo(() => {
    if (vue === "jour") return [depuisCle(cle)];
    const l = lundi(cle);
    return Array.from({ length: 7 }, (_, i) => new Date(l.getFullYear(), l.getMonth(), l.getDate() + i));
  }, [vue, cle]);

  const titre =
    vue === "jour"
      ? capitaliser(fmtJour.format(depuisCle(cle)))
      : capitaliser(fmtMois.format(vue === "mois" ? depuisCle(cle) : jours[0]));

  const creer = (date: string, debut: string | null) =>
    setEdition({
      id: crypto.randomUUID(),
      titre: "",
      date,
      debut,
      fin: debut ? versHeure(enMinutes(debut) + 60) : null,
      notes: "",
      projectId: null,
      notifie: false,
    });

  return (
    <section aria-label="Calendrier" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 mr-auto text-h4 leading-[1.1] font-semibold tracking-[-0.03em] text-texte-principal">
          {titre}
        </h2>
        <div role="radiogroup" aria-label="Vue" className="flex gap-0.5 rounded-sm bg-fond-surface-grise p-0.5">
          {(["jour", "semaine", "mois"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={vue === v}
              onClick={() => setVue(v)}
              className={cn(
                "h-7 cursor-pointer rounded-2xs border-0 px-3 text-ui-xs font-medium capitalize transition-colors duration-[220ms] ease-sortie",
                vue === v
                  ? "bg-fond-surface text-texte-principal shadow-ombre-xs"
                  : "bg-transparent text-texte-secondaire hover:text-texte-principal",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <BoutonIcone
            taille="compact"
            icone={<Icon name="chevron-left" size={16} />}
            libelle="Précédent"
            onClick={() => setCle(decaler(cle, vue, -1))}
          />
          <Bouton variant="blanc" taille="compact" onClick={() => setCle(aujourdhui())}>
            Aujourd’hui
          </Bouton>
          <BoutonIcone
            taille="compact"
            icone={<Icon name="chevron-right" size={16} />}
            libelle="Suivant"
            onClick={() => setCle(decaler(cle, vue, 1))}
          />
        </div>
        <Bouton
          variant="sombre"
          taille="compact"
          iconeGauche={<Icon name="plus-01" size={16} />}
          onClick={() => creer(cle, "09:00")}
        >
          Événement
        </Bouton>
      </header>

      {vue === "mois" ? (
        <Mois
          cle={cle}
          onJour={(c) => {
            setCle(c);
            setVue("jour");
          }}
        />
      ) : (
        <GrilleHeures jours={jours} onCreer={creer} onOuvrir={setEdition} />
      )}

      {edition && <FenetreEvenement key={edition.id} initial={edition} onFermer={() => setEdition(null)} />}
    </section>
  );
}
