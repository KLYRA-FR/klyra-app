"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { useCompte } from "@/lib/compte";
import { aujourdhui, echeance, enRetard, libellePeriode } from "@/lib/dates";
import { jouer } from "@/lib/sons/sons";
import { useWorkspace } from "@/lib/workspace";
import { ROLE_TEINTES, type Categorie, type RoleTeinte, type Tache } from "@/types/domain";
import { MenuReporter } from "./MenuReporter";
import { LignesCompte, RappelsCompte, rappelsDansColonne } from "./RappelsCompte";

/** Annoncer un report au lecteur d'écran (la région `aria-live` de `Rappels`). */
const AnnonceRappels = createContext<(texte: string) => void>(() => {});

/**
 * Rappels, comme l'app d'Apple, rangés en catégories côte à côte (Perso,
 * Clients, École…). Chaque colonne a sa couleur et son icône ; une ligne vide
 * est toujours prête en bas pour écrire un rappel. On ajoute si on veut une
 * date, une heure (notification) et l'urgence. Coché, un rappel reste dans sa
 * colonne, barré ; seule la poubelle le supprime.
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
        // Un rappel fait : une validation qui s'entend. Le rouvrir reste silencieux.
        if (!faite) jouer("validation");
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
  fin,
  heure,
  priorite,
  onChange,
}: {
  date: string | null;
  fin: string | null;
  heure: string | null;
  priorite: Tache["priorite"];
  onChange: (patch: Partial<Pick<Tache, "date" | "fin" | "heure" | "priorite">>) => void;
}) {
  const puce = "flex h-7 items-center gap-1.5 rounded-sm border border-bordure-subtile bg-fond-surface px-2 text-ui-xs text-texte-secondaire";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className={cn(puce, date && "border-bleu-k1-500/40 text-texte-accent")}>
        <Icon name="calendar-01" size={14} />
        <input
          type="date"
          value={date ?? ""}
          onChange={(e) => {
            const d = e.target.value || null;
            /* Sans date, pas de fin ; une fin avant le début est retirée. */
            onChange({ date: d, heure: d ? heure : null, fin: d && fin && fin > d ? fin : null });
          }}
          aria-label="Date"
          className="w-[112px] border-0 bg-transparent p-0 text-ui-xs text-inherit outline-none"
        />
      </label>
      {/* Jusqu'au : pour un rappel sur plusieurs jours. */}
      {date && (
        <label className={cn(puce, fin && "border-bleu-k1-500/40 text-texte-accent")}>
          <span aria-hidden="true">→</span>
          <input
            type="date"
            value={fin ?? ""}
            min={date}
            onChange={(e) => onChange({ fin: e.target.value && e.target.value > date ? e.target.value : null })}
            aria-label="Jusqu’au"
            title="Jusqu’au (facultatif)"
            className="w-[112px] border-0 bg-transparent p-0 text-ui-xs text-inherit outline-none"
          />
        </label>
      )}
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
  const annoncer = useContext(AnnonceRappels);
  const [titre, setTitre] = useState(tache.titre);
  const [ouverte, setOuverte] = useState(false);
  const ligne = useRef<HTMLLIElement>(null);
  const retard = !tache.faite && enRetard(echeance(tache), tache.fin ? null : tache.heure);
  const maj = (patch: Partial<Tache>) => enregistrerTache({ ...tache, ...patch });

  return (
    <li ref={ligne} data-rappel={tache.id} className="group/rappel flex items-start gap-2.5 border-b border-bordure-subtile py-2 last:border-b-0">
      {/* Le rond (20 px) et la première ligne du texte (20 px) partagent le même centre. */}
      <CaseTache
        faite={tache.faite}
        libelle={tache.titre}
        teinte={teinte}
        onChange={() => maj({ faite: !tache.faite, faiteLe: tache.faite ? null : new Date().toISOString() })}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-1.5">
          {tache.priorite > 0 && <span className="shrink-0 text-ui-s leading-5 font-semibold text-texte-accent">{"!".repeat(tache.priorite)}</span>}
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
              "min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-ui-s leading-5 outline-none [field-sizing:content]",
              tache.faite ? "text-texte-tertiaire line-through decoration-bordure-forte" : "text-texte-principal",
            )}
          />
          {!tache.faite && (
            <MenuReporter
              tache={tache}
              onReporte={({ annonce }) => {
                /* Le panneau se referme pour montrer la nouvelle date, et la ligne, retriée, reste à l'écran. */
                setOuverte(false);
                annoncer(annonce);
                requestAnimationFrame(() =>
                  ligne.current?.scrollIntoView({
                    block: "nearest",
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
                  }),
                );
              }}
            />
          )}
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
            data-supprimer-rappel
            onClick={(e) => {
              if (e.detail > 1) return;
              const colonne = ligne.current?.closest("section");
              const lignes = Array.from(colonne?.querySelectorAll<HTMLElement>("[data-rappel]") ?? []);
              const index = lignes.indexOf(ligne.current!);
              const suivante = lignes[index + 1] ?? lignes[index - 1];
              const cible = suivante?.querySelector<HTMLElement>("[data-supprimer-rappel]") ??
                colonne?.querySelector<HTMLElement>('textarea[placeholder="Nouveau rappel"]');
              const focusDedans = ligne.current?.contains(document.activeElement);
              supprimerTache(tache.id);
              if (focusDedans) requestAnimationFrame(() => {
                if (cible?.isConnected) cible.focus({ preventScroll: true });
              });
            }}
            aria-label={`Supprimer ${tache.titre}`}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-icone-secondaire opacity-0 transition-opacity duration-[120ms] group-hover/rappel:opacity-100 hover:bg-fond-survol focus-visible:opacity-100"
          >
            <Icon name="trash-01" size={14} />
          </button>
        </div>
        {!ouverte && tache.date && (
          <span
            data-echeance={tache.id}
            className={cn("-mx-1 self-start rounded-2xs px-1 text-ui-xs", retard ? "font-medium text-texte-erreur" : "text-texte-tertiaire")}
          >
            {libellePeriode(tache.date, tache.heure, tache.fin)}
          </span>
        )}
        {ouverte && (
          <Reglages date={tache.date} fin={tache.fin ?? null} heure={tache.heure} priorite={tache.priorite} onChange={(patch) => maj({ ...patch, notifiee: false })} />
        )}
      </div>
    </li>
  );
}

/** Tri : datés d'abord (par échéance), puis les autres dans l'ordre d'écriture. */
function trier(taches: Tache[]) {
  return [...taches].sort((a, b) => {
    // "~" peut précéder les chiffres avec localeCompare : les sans date vont explicitement après.
    if (Boolean(a.date) !== Boolean(b.date)) return a.date ? -1 : 1;
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

function Colonne({ categorie, taches, voirFaits, avant }: { categorie: Categorie; taches: Tache[]; voirFaits: boolean; avant?: ReactNode }) {
  const { enregistrerTache } = useWorkspace();
  const [reglage, setReglage] = useState(false);
  const [titre, setTitre] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [heure, setHeure] = useState<string | null>(null);
  const [fin, setFin] = useState<string | null>(null);
  const [priorite, setPriorite] = useState<Tache["priorite"]>(0);
  const [saisie, setSaisie] = useState(false);
  const champ = useRef<HTMLTextAreaElement>(null);
  const { accent } = AGENT_PASTELS[categorie.teinte] ?? AGENT_PASTELS.violet;

  const aFaire = trier(taches.filter((t) => !t.faite));
  const faits = taches.filter((t) => t.faite);

  const ajouter = () => {
    if (!titre.trim()) return;
    enregistrerTache(nouvelleTache({ titre: titre.trim(), date, fin, heure, priorite, liste: categorie.id }));
    setTitre("");
    setDate(null);
    setFin(null);
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
        {avant}
        {aFaire.map((t) => (
          <LigneRappel key={t.id} tache={t} teinte={categorie.teinte} />
        ))}
        {voirFaits && faits.map((t) => <LigneRappel key={t.id} tache={t} teinte={categorie.teinte} />)}

        {/* La ligne toujours prête : un rond, on tape, Entrée. */}
        <li className="flex items-start gap-2.5 py-2">
          <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-[1.5px] border-dashed" style={{ borderColor: accent }} />
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
              className="min-w-0 resize-none border-0 bg-transparent p-0 text-ui-s leading-5 text-texte-principal outline-none [field-sizing:content] placeholder:text-texte-tertiaire"
            />
            {(saisie || titre) && (
              <Reglages
                date={date}
                fin={fin}
                heure={heure}
                priorite={priorite}
                onChange={(p) => {
                  if ("date" in p) setDate(p.date ?? null);
                  if ("fin" in p) setFin(p.fin ?? null);
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
  const compte = useCompte();
  const moi = compte.moi;
  const connecte = compte.etat === "connecte" && moi !== null;
  /* Un rappel coché reste là, barré : il ne part qu'avec la poubelle. */
  const [voirFaits, setVoirFaits] = useState(true);
  const [annonce, setAnnonce] = useState("");
  const [masques, setMasques] = useState<ReadonlySet<string>>(() => new Set());
  const recevoirMasques = useCallback((ids: ReadonlySet<string>) => {
    setMasques((avant) => (avant.size === ids.size && [...ids].every((id) => avant.has(id)) ? avant : ids));
  }, []);
  const categories = state.categories;
  const ids = new Set(categories.map((c) => c.id));
  /* Importé dans le compte : on ne le montre plus ici. La copie locale reste. */
  const taches = connecte ? state.taches.filter((t) => !masques.has(t.id)) : state.taches;
  const faits = taches.filter((t) => t.faite).length;

  /* Un rappel sans catégorie connue va dans la première colonne. */
  const deLaColonne = (c: Categorie, i: number) => taches.filter((t) => t.liste === c.id || (i === 0 && !ids.has(t.liste)));

  const nouvelleCategorie = () => {
    const teinte = ROLE_TEINTES[categories.length % ROLE_TEINTES.length];
    changerCategories([...categories, { id: crypto.randomUUID(), nom: "Nouvelle catégorie", teinte, icone: "list" }]);
  };

  const colonnes = (avant?: (categorie: Categorie, index: number) => ReactNode) => (
    <AnnonceRappels.Provider value={setAnnonce}>
      {categories.map((c, i) => (
        <Colonne key={c.id} categorie={c} taches={deLaColonne(c, i)} voirFaits={voirFaits} avant={avant?.(c, i)} />
      ))}
      <button
        type="button"
        onClick={nouvelleCategorie}
        className="flex h-[120px] w-[200px] shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-bordure-forte bg-transparent text-ui-s text-texte-secondaire hover:border-bleu-k1-500 hover:text-texte-principal"
      >
        <Icon name="plus-01" size={20} />
        Nouvelle catégorie
      </button>
    </AnnonceRappels.Provider>
  );

  return (
    <section aria-label="Rappels" className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h2 className="m-0 text-h4 leading-[1.1] font-semibold tracking-[-0.03em] text-texte-principal">Rappels</h2>
        {!connecte && <span className="text-ui-s text-texte-tertiaire">{taches.filter((t) => !t.faite).length} à faire</span>}
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

      {connecte && moi ? (
        <RappelsCompte
          categories={categories}
          idsCategories={ids}
          tachesLocales={state.taches}
          voirFaits={voirFaits}
          onMasques={recevoirMasques}
        >
          {(mes) => colonnes((categorie, index) => (
            <LignesCompte
              rappels={rappelsDansColonne(mes, moi._id, categorie.id, index, ids)}
              moiId={moi._id}
              categories={categories}
              voirFaits={voirFaits}
            />
          ))}
        </RappelsCompte>
      ) : (
        <div className="-mx-1 flex items-start gap-3 overflow-x-auto px-1 pb-2">{colonnes()}</div>
      )}
      <p aria-live="polite" className="sr-only">
        {annonce}
      </p>
    </section>
  );
}
