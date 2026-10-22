"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { aujourdhui, enRetard, libelleEcheance } from "@/lib/dates";
import { useWorkspace } from "@/lib/workspace";
import { ROLE_TEINTES, type Categorie, type RoleTeinte, type Tache } from "@/types/domain";

/**
 * Rappels, comme l'app d'Apple, rangés en catégories côte à côte (Perso,
 * Clients, École…). Chaque colonne a sa couleur et son icône ; une ligne vide
 * est toujours prête en bas pour écrire un rappel. On ajoute si on veut une
 * date, une heure (notification) et l'urgence.
 */

/** Les icônes qu'on peut donner à une catégorie (set officiel). */
const ICONES: IconName[] = [
  "home-01",
  "users-profiles-01",
  "file-01",
  "folder",
  "calendar-01",
  "bell-01",
  "code-01",
  "image-01",
  "globe-01",
  "message-square",
  "layers-01",
  "computer",
  "list",
  "clock-01",
];

export function nouvelleTache(partiel: Partial<Tache> = {}): Tache {
  return {
    id: crypto.randomUUID(),
    titre: "",
    notes: "",
    liste: "perso",
    date: null,
    heure: null,
    priorite: 0,
    signalee: false,
    faite: false,
    faiteLe: null,
    projectId: null,
    creeLe: new Date().toISOString(),
    notifiee: false,
    ...partiel,
  };
}

/** La pastille d'une catégorie : son icône sur sa couleur. */
export function PastilleCategorie({ categorie, taille = 28 }: { categorie: Categorie; taille?: number }) {
  const { haut, encre } = AGENT_PASTELS[categorie.teinte] ?? AGENT_PASTELS.violet;
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: taille, height: taille, background: haut, color: encre }}
    >
      <Icon name={(categorie.icone as IconName) ?? "list"} size={Math.round(taille * 0.55)} />
    </span>
  );
}

/** Le rond à cocher : vide (bordé de la couleur de la catégorie), puis plein avec la coche. */
export function CaseTache({
  faite,
  onChange,
  libelle,
  teinte,
}: {
  faite: boolean;
  onChange: () => void;
  libelle: string;
  teinte?: RoleTeinte;
}) {
  const couleur = teinte ? AGENT_PASTELS[teinte]?.accent : undefined;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={faite}
      aria-label={faite ? `Rouvrir ${libelle}` : `Terminer ${libelle}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      style={couleur ? (faite ? { background: couleur, borderColor: couleur } : { borderColor: couleur }) : undefined}
      className={cn(
        "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-[1.5px] p-0 transition-[background-color,border-color,scale] duration-[220ms] ease-sortie active:scale-90",
        faite ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte bg-transparent hover:border-bleu-k1-500",
      )}
    >
      {faite && <Icon name="check-01" size={14} />}
    </button>
  );
}

/** Une date, une heure, l'urgence : les petits réglages d'un rappel. */
function Reglages({
  date,
  heure,
  priorite,
  onChange,
}: {
  date: string | null;
  heure: string | null;
  priorite: Tache["priorite"];
  onChange: (patch: Partial<Pick<Tache, "date" | "heure" | "priorite">>) => void;
}) {
  const puce = "flex h-7 items-center gap-1.5 rounded-sm border border-bordure-subtile bg-fond-surface px-2 text-ui-xs text-texte-secondaire";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className={cn(puce, date && "border-bleu-k1-500/40 text-texte-accent")}>
        <Icon name="calendar-01" size={14} />
        <input
          type="date"
          value={date ?? ""}
          onChange={(e) => onChange({ date: e.target.value || null, heure: e.target.value ? heure : null })}
          aria-label="Date"
          className="w-[112px] border-0 bg-transparent p-0 text-ui-xs text-inherit outline-none"
        />
      </label>
      <label className={cn(puce, heure && "border-bleu-k1-500/40 text-texte-accent")}>
        <Icon name="clock-01" size={14} />
        <input
          type="time"
          value={heure ?? ""}
          onChange={(e) => onChange({ heure: e.target.value || null, date: e.target.value ? (date ?? aujourdhui()) : date })}
          aria-label="Heure"
          className="w-[60px] border-0 bg-transparent p-0 text-ui-xs text-inherit outline-none"
        />
      </label>
      <button
        type="button"
        onClick={() => onChange({ priorite: ((priorite + 1) % 4) as Tache["priorite"] })}
        title="Urgence : clique pour changer"
        className={cn(puce, "cursor-pointer font-semibold", priorite > 0 && "border-bleu-k1-500/40 text-texte-accent")}
      >
        {priorite === 0 ? "Urgence" : "!".repeat(priorite)}
      </button>
    </div>
  );
}

function LigneRappel({ tache, teinte }: { tache: Tache; teinte: RoleTeinte }) {
  const { enregistrerTache, supprimerTache } = useWorkspace();
  const [titre, setTitre] = useState(tache.titre);
  const [ouverte, setOuverte] = useState(false);
  const retard = !tache.faite && enRetard(tache.date, tache.heure);
  const maj = (patch: Partial<Tache>) => enregistrerTache({ ...tache, ...patch });

  return (
    <li className="group/rappel flex items-start gap-2.5 border-b border-bordure-subtile py-2 last:border-b-0">
      <span className="pt-0.5">
        <CaseTache
          faite={tache.faite}
          libelle={tache.titre}
          teinte={teinte}
          onChange={() => maj({ faite: !tache.faite, faiteLe: tache.faite ? null : new Date().toISOString() })}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-1.5">
          {tache.priorite > 0 && <span className="shrink-0 text-ui-s leading-[1.45] font-semibold text-texte-accent">{"!".repeat(tache.priorite)}</span>}
          {/* Le texte passe à la ligne : un long rappel se lit en entier. Entrée valide. */}
          <textarea
            rows={1}
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            onBlur={() => titre.trim() && titre.trim() !== tache.titre && maj({ titre: titre.trim() })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            aria-label="Rappel"
            className={cn(
              "min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-ui-s leading-[1.45] outline-none [field-sizing:content]",
              tache.faite ? "text-texte-tertiaire line-through decoration-bordure-forte" : "text-texte-principal",
            )}
          />
          <button
            type="button"
            onClick={() => setOuverte((o) => !o)}
            aria-label="Date, heure et urgence"
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-icone-secondaire opacity-0 transition-opacity duration-[120ms] group-hover/rappel:opacity-100 hover:bg-fond-survol focus-visible:opacity-100"
          >
            <Icon name="dot-horizontal" size={16} />
          </button>
          <button
            type="button"
            onClick={() => supprimerTache(tache.id)}
            aria-label={`Supprimer ${tache.titre}`}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-icone-secondaire opacity-0 transition-opacity duration-[120ms] group-hover/rappel:opacity-100 hover:bg-fond-survol focus-visible:opacity-100"
          >
            <Icon name="trash-01" size={14} />
          </button>
        </div>
        {!ouverte && tache.date && (
          <span className={cn("text-ui-xs", retard ? "font-medium text-texte-erreur" : "text-texte-tertiaire")}>
            {libelleEcheance(tache.date, tache.heure)}
          </span>
        )}
        {ouverte && (
          <Reglages date={tache.date} heure={tache.heure} priorite={tache.priorite} onChange={(patch) => maj({ ...patch, notifiee: false })} />
        )}
      </div>
    </li>
  );
}

/** Tri : datés d'abord (par échéance), puis les autres dans l'ordre d'écriture. */
function trier(taches: Tache[]) {
  return [...taches].sort((a, b) => {
    const da = a.date ? `${a.date}T${a.heure ?? "23:59"}` : "~";
    const db = b.date ? `${b.date}T${b.heure ?? "23:59"}` : "~";
    return da.localeCompare(db) || b.priorite - a.priorite || a.creeLe.localeCompare(b.creeLe);
  });
}

/* ─── Modifier une catégorie : nom, couleur, icône ─────────────── */

function ReglageCategorie({ categorie, onFermer }: { categorie: Categorie; onFermer: () => void }) {
  const { state, changerCategories, enregistrerTache } = useWorkspace();
  const [nom, setNom] = useState(categorie.nom);
  const zone = useRef<HTMLDivElement>(null);
  const maj = (patch: Partial<Categorie>) => changerCategories(state.categories.map((c) => (c.id === categorie.id ? { ...c, ...patch } : c)));

  useEffect(() => {
    const dehors = (e: MouseEvent) => !zone.current?.contains(e.target as Node) && onFermer();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", echap);
    };
  }, [onFermer]);

  const supprimer = () => {
    const reste = state.categories.filter((c) => c.id !== categorie.id);
    // Les rappels de la catégorie passent dans la première qui reste.
    for (const t of state.taches) if (t.liste === categorie.id) enregistrerTache({ ...t, liste: reste[0].id });
    changerCategories(reste);
    onFermer();
  };

  return (
    <div ref={zone} className="absolute top-12 right-3 left-3 z-30 flex flex-col gap-3 rounded-lg border border-bordure-subtile bg-fond-surface p-3 shadow-ombre-flottante">
      <input
        autoFocus
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        onBlur={() => nom.trim() && maj({ nom: nom.trim() })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label="Nom de la catégorie"
        className="h-9 rounded-sm border border-bordure-champ bg-fond-surface px-2.5 text-ui-s font-medium text-texte-principal outline-none focus:border-bordure-champ-survol"
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-ui-2xs font-medium text-texte-tertiaire">Couleur</span>
        <div className="grid grid-cols-6 gap-1.5">
          {ROLE_TEINTES.map((t) => (
            <button
              key={t}
              type="button"
              aria-label={t}
              aria-pressed={categorie.teinte === t}
              onClick={() => maj({ teinte: t })}
              className={cn(
                "size-7 cursor-pointer rounded-full border-2 p-0",
                categorie.teinte === t ? "border-texte-principal" : "border-transparent",
              )}
              style={{ background: AGENT_PASTELS[t].accent }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-ui-2xs font-medium text-texte-tertiaire">Icône</span>
        <div className="grid grid-cols-7 gap-1">
          {ICONES.map((i) => (
            <button
              key={i}
              type="button"
              aria-label={i}
              aria-pressed={categorie.icone === i}
              onClick={() => maj({ icone: i })}
              className={cn(
                "flex size-8 cursor-pointer items-center justify-center rounded-sm border-0 text-icone-secondaire",
                categorie.icone === i ? "bg-fond-surface-grise text-texte-principal" : "bg-transparent hover:bg-fond-survol",
              )}
            >
              <Icon name={i} size={16} />
            </button>
          ))}
        </div>
      </div>
      {state.categories.length > 1 && (
        <Bouton variant="discret" taille="compact" iconeGauche={<Icon name="trash-01" size={16} />} onClick={supprimer} className="self-start">
          Supprimer la catégorie
        </Bouton>
      )}
    </div>
  );
}

/* ─── Une colonne ──────────────────────────────────────────────── */

function Colonne({ categorie, taches, voirFaits }: { categorie: Categorie; taches: Tache[]; voirFaits: boolean }) {
  const { enregistrerTache } = useWorkspace();
  const [reglage, setReglage] = useState(false);
  const [titre, setTitre] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [heure, setHeure] = useState<string | null>(null);
  const [priorite, setPriorite] = useState<Tache["priorite"]>(0);
  const [saisie, setSaisie] = useState(false);
  const champ = useRef<HTMLTextAreaElement>(null);
  const { accent } = AGENT_PASTELS[categorie.teinte] ?? AGENT_PASTELS.violet;

  const aFaire = trier(taches.filter((t) => !t.faite));
  const faits = taches.filter((t) => t.faite);

  const ajouter = () => {
    if (!titre.trim()) return;
    enregistrerTache(nouvelleTache({ titre: titre.trim(), date, heure, priorite, liste: categorie.id }));
    setTitre("");
    setDate(null);
    setHeure(null);
    setPriorite(0);
    champ.current?.focus();
  };

  return (
    <section aria-label={categorie.nom} className="klyra-carte-flottante relative flex w-[300px] shrink-0 flex-col rounded-lg px-4 pt-3 pb-2">
      <header className="flex items-center gap-2.5 pb-1">
        <PastilleCategorie categorie={categorie} />
        <h3 className="m-0 min-w-0 flex-1 truncate text-ui font-semibold" style={{ color: AGENT_PASTELS[categorie.teinte]?.encre }}>
          {categorie.nom}
        </h3>
        <span className="text-ui-s font-semibold text-texte-tertiaire">{aFaire.length}</span>
        <button
          type="button"
          onClick={() => setReglage((v) => !v)}
          aria-label={`Modifier la catégorie ${categorie.nom}`}
          aria-expanded={reglage}
          className="flex size-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-icone-secondaire hover:bg-fond-survol"
        >
          <Icon name="dot-horizontal" size={16} />
        </button>
      </header>
      {reglage && <ReglageCategorie categorie={categorie} onFermer={() => setReglage(false)} />}

      <ul className="m-0 flex list-none flex-col p-0">
        {aFaire.map((t) => (
          <LigneRappel key={t.id} tache={t} teinte={categorie.teinte} />
        ))}
        {voirFaits && faits.map((t) => <LigneRappel key={t.id} tache={t} teinte={categorie.teinte} />)}

        {/* La ligne toujours prête : un rond, on tape, Entrée. */}
        <li className="flex items-start gap-2.5 py-2">
          <span aria-hidden="true" className="mt-0.5 size-5 shrink-0 rounded-full border-[1.5px] border-dashed" style={{ borderColor: accent }} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <textarea
              ref={champ}
              rows={1}
              value={titre}
              placeholder="Nouveau rappel"
              onChange={(e) => setTitre(e.target.value)}
              onFocus={() => setSaisie(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ajouter();
                }
                if (e.key === "Escape") {
                  setTitre("");
                  setSaisie(false);
                  e.currentTarget.blur();
                }
              }}
              className="min-w-0 resize-none border-0 bg-transparent p-0 text-ui-s leading-[1.45] text-texte-principal outline-none [field-sizing:content] placeholder:text-texte-tertiaire"
            />
            {(saisie || titre) && (
              <Reglages
                date={date}
                heure={heure}
                priorite={priorite}
                onChange={(p) => {
                  if ("date" in p) setDate(p.date ?? null);
                  if ("heure" in p) setHeure(p.heure ?? null);
                  if (p.priorite !== undefined) setPriorite(p.priorite);
                }}
              />
            )}
          </div>
        </li>
      </ul>
    </section>
  );
}

/* ─── Les rappels ──────────────────────────────────────────────── */

export function Rappels() {
  const { state, changerCategories } = useWorkspace();
  const [voirFaits, setVoirFaits] = useState(false);
  const categories = state.categories;
  const ids = new Set(categories.map((c) => c.id));
  const faits = state.taches.filter((t) => t.faite).length;

  /* Un rappel sans catégorie connue va dans la première colonne. */
  const deLaColonne = (c: Categorie, i: number) => state.taches.filter((t) => t.liste === c.id || (i === 0 && !ids.has(t.liste)));

  const nouvelleCategorie = () => {
    const teinte = ROLE_TEINTES[categories.length % ROLE_TEINTES.length];
    changerCategories([...categories, { id: crypto.randomUUID(), nom: "Nouvelle catégorie", teinte, icone: "list" }]);
  };

  return (
    <section aria-label="Rappels" className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h2 className="m-0 text-h4 leading-[1.1] font-semibold tracking-[-0.03em] text-texte-principal">Rappels</h2>
        <span className="text-ui-s text-texte-tertiaire">{state.taches.filter((t) => !t.faite).length} à faire</span>
        {faits > 0 && (
          <button
            type="button"
            onClick={() => setVoirFaits((v) => !v)}
            className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-ui-xs text-texte-tertiaire underline decoration-bordure-forte underline-offset-2 hover:text-texte-principal"
          >
            {voirFaits ? "Masquer les terminés" : `Afficher les terminés (${faits})`}
          </button>
        )}
      </header>

      {/* Les catégories côte à côte ; on fait défiler s'il y en a beaucoup. */}
      <div className="-mx-1 flex items-start gap-3 overflow-x-auto px-1 pb-2">
        {categories.map((c, i) => (
          <Colonne key={c.id} categorie={c} taches={deLaColonne(c, i)} voirFaits={voirFaits} />
        ))}
        <button
          type="button"
          onClick={nouvelleCategorie}
          className="flex h-[120px] w-[200px] shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-bordure-forte bg-transparent text-ui-s text-texte-secondaire hover:border-bleu-k1-500 hover:text-texte-principal"
        >
          <Icon name="plus-01" size={20} />
          Nouvelle catégorie
        </button>
      </div>
    </section>
  );
}
