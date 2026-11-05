"use client";

import { useId, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import { Input, Textarea } from "klyra-ui";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Interrupteur } from "@/components/reglages/ui";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { CHAMP } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { rendezVousEntre } from "@/lib/agenda-equipe";
import {
  celluleLisible,
  MAX_LIGNES,
  totalColonne,
  type Cellule,
  type ColonneTableau,
  type LigneTableau,
  dateLisible,
  dureeLisible,
  LIBELLES_GENRE,
  manquantsCarte,
  occupations,
  texteReponse,
  valeurDepart,
  valeurLisible,
  type Carte,
  type ChampCarte,
  type GenreCarte,
  type ReponseCarte,
  type ValeurChamp,
} from "@/lib/cartes-interactives";
import { cn } from "@/lib/cn";
import { useWorkspace } from "@/lib/workspace";
import type { Evenement, MessagePart } from "@/types/domain";

/**
 * Une carte interactive d'un agent dans le fil (outil `proposer_carte`) : un formulaire, une
 * comparaison, une liste à valider ou des créneaux. La personne la remplit et l'envoie d'un clic :
 * le message part en son nom, lisible tel quel, et la carte se fige avec ce qu'elle a choisi. Elle
 * se fige aussi si la personne répond autrement (un message écrit, ou depuis son téléphone).
 * Règles pures : electron/cartes-interactives.ts.
 */

type PartCarte = Extract<MessagePart, { type: "carte" }>;

const ICONES: Record<GenreCarte, IconName> = {
  formulaire: "text-input-01",
  comparaison: "layers-01",
  liste: "list",
  creneaux: "calendar-01",
  tableau: "note-01",
};

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Les valeurs de départ d'une carte : ce que l'agent a pré-rempli, les éléments cochés. */
function depart(carte: Carte): ReponseCarte {
  switch (carte.genre) {
    case "formulaire":
      return { valeurs: Object.fromEntries(carte.champs.flatMap((c) => (valeurDepart(c) === null ? [] : [[c.id, valeurDepart(c)!]]))) };
    case "liste":
      return { coches: carte.elements.filter((e) => e.coche).map((e) => e.id) };
    case "tableau":
      return { lignes: carte.lignes };
    default:
      return {};
  }
}

/** La carte dans le fil du bureau : ce qu'elle envoie est noté sur la carte, les créneaux lisent le planning. */
export function CarteInteractive({
  part,
  messageId,
  actif,
  repondu,
  onEnvoyer,
}: {
  part: PartCarte;
  messageId: string;
  /** La dernière réponse de l'agent, terminée, à laquelle rien n'a encore été répondu. */
  actif: boolean;
  /** Ce que la personne a écrit après ce message, s'il y a lieu. */
  repondu: string | null;
  onEnvoyer: (texte: string) => void;
}) {
  const { state, repondreCarte } = useWorkspace();
  // Le planning de la personne sur les jours proposés : ses rendez-vous, et ceux de l'équipe.
  const planning = (() => {
    if (part.carte.genre !== "creneaux") return [];
    const jours = part.carte.creneaux.map((c) => c.date).sort();
    const premier = new Date(`${jours[0]}T00:00:00`);
    const dernier = new Date(`${jours.at(-1)}T00:00:00`);
    dernier.setDate(dernier.getDate() + 1);
    return [...state.evenements, ...rendezVousEntre(state.profilCompte !== null && state.evenementsCompte !== null, state.evenementsCompte, premier, dernier)];
  })();
  return (
    <CarteInteractiveVue
      // La carte finale repart de ses valeurs de départ, pas de celles d'une version en cours d'écriture.
      key={part.provisoire ? "provisoire" : "finale"}
      etapeId={part.etapeId}
      carte={part.carte}
      envoyee={part.reponse ?? null}
      provisoire={!!part.provisoire}
      actif={actif}
      repondu={repondu}
      planning={planning}
      onEnvoyer={(texte, reponse) => {
        repondreCarte(messageId, part.etapeId, reponse);
        onEnvoyer(texte);
      }}
    />
  );
}

/** La carte elle-même, la même au bureau et sur le téléphone. */
export function CarteInteractiveVue({
  etapeId,
  carte,
  envoyee: noteeEnvoyee,
  provisoire,
  actif,
  repondu,
  planning,
  onEnvoyer,
}: {
  etapeId: string;
  carte: Carte;
  /** Ce qui a été envoyé depuis cette carte (noté sur elle), sinon null. */
  envoyee: ReponseCarte | null;
  provisoire: boolean;
  actif: boolean;
  repondu: string | null;
  /** Les rendez-vous à croiser avec des créneaux proposés (vide : rien à signaler). */
  planning: Evenement[];
  onEnvoyer: (texte: string, reponse: ReponseCarte) => void;
}) {
  const part = { etapeId, provisoire, reponse: noteeEnvoyee };
  const [reponse, setReponse] = useState<ReponseCarte>(() => part.reponse ?? depart(carte));
  const envoyee = !!part.reponse;
  const figee = envoyee || repondu !== null || !actif || !!part.provisoire;
  // Ce qui est montré une fois envoyée : ce qui a été noté sur la carte.
  const vue = part.reponse ?? (provisoire ? depart(carte) : reponse);
  const manque = manquantsCarte(carte, reponse);
  const changer = (r: Partial<ReponseCarte>) => setReponse((x) => ({ ...x, ...r }));

  const envoyer = () => {
    if (figee || manque.length) return;
    onEnvoyer(texteReponse(carte, reponse), reponse);
  };

  const etat = part.provisoire ? "L’agent prépare la carte…" : envoyee ? "Envoyée" : repondu !== null ? "Répondu dans ton message" : !actif ? "Plus d’actualité" : null;

  return (
    <section
      data-carte={part.etapeId}
      data-genre={carte.genre}
      data-etat={envoyee ? "envoyee" : figee ? "figee" : "ouverte"}
      aria-label={carte.titre}
      className="klyra-arrivee flex w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-bordure-subtile bg-fond-surface shadow-ombre-sm"
    >
      <header className="flex flex-col gap-1.5 px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-ui-2xs font-medium text-texte-tertiaire">
            <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-md bg-fond-teinte-bleue text-icone-accent">
              <Icon name={ICONES[carte.genre]} size={14} />
            </span>
            {LIBELLES_GENRE[carte.genre]}
          </span>
          {etat && (
            <span className={cn("flex items-center gap-1 text-ui-2xs", envoyee ? "text-texte-accent" : "text-texte-tertiaire", part.provisoire && "klyra-respire")}>
              {envoyee && <Icon name="check-01" size={12} />}
              {etat}
            </span>
          )}
        </div>
        <h3 className="m-0 text-ui leading-[1.3] font-semibold text-texte-principal">{carte.titre}</h3>
        {carte.intro && <p className="m-0 text-ui-s leading-[1.45] text-texte-secondaire">{carte.intro}</p>}
      </header>

      <div className="px-4 py-4">
        {carte.genre === "formulaire" && <Formulaire carte={carte} valeurs={vue.valeurs ?? {}} figee={figee} onChange={(id, v) => changer({ valeurs: Object.fromEntries(Object.entries({ ...reponse.valeurs, [id]: v }).filter((e): e is [string, ValeurChamp] => e[1] !== null)) })} />}
        {carte.genre === "comparaison" && <Comparaison carte={carte} choix={vue.choix} figee={figee} onChoisir={(choix) => changer({ choix })} />}
        {carte.genre === "liste" && <Liste carte={carte} coches={vue.coches ?? []} figee={figee} onChange={(coches) => changer({ coches })} />}
        {carte.genre === "creneaux" && <Creneaux carte={carte} choisi={vue.creneau} figee={figee} planning={planning} onChoisir={(creneau) => changer({ creneau })} />}
        {carte.genre === "tableau" && <Tableau carte={carte} lignes={vue.lignes ?? carte.lignes} figee={figee} onChange={(lignes) => changer({ lignes })} />}
        {(carte.genre === "comparaison" || carte.genre === "creneaux") && !figee && (reponse.choix !== undefined || reponse.creneau !== undefined) && (
          <Textarea
            size="sm"
            autoGrow
            value={reponse.mot ?? ""}
            placeholder="Un mot à ajouter (facultatif)"
            aria-label="Un mot à ajouter"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => changer({ mot: e.target.value })}
            className={cn(CHAMP, "mt-3 min-h-[44px]")}
          />
        )}
        {figee && envoyee && part.reponse?.mot && <p className="m-0 mt-3 text-ui-s leading-[1.45] whitespace-pre-wrap text-texte-secondaire">« {part.reponse.mot} »</p>}
      </div>

      {!figee && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-bordure-subtile bg-fond-surface-grise/60 px-4 py-3">
          <span className="text-ui-xs text-texte-tertiaire">{manque.length ? `Il manque ${manque.join(", ")}.` : "Envoyé comme ton message, l’agent le lit à son tour."}</span>
          <Bouton variant="sombre" taille="compact" iconeGauche={<Icon name="send-01" size={14} />} disabled={!!manque.length} onClick={envoyer}>
            {libelleEnvoi(carte, reponse)}
          </Bouton>
        </footer>
      )}
    </section>
  );
}

function libelleEnvoi(carte: Carte, r: ReponseCarte): string {
  switch (carte.genre) {
    case "formulaire":
      return "Envoyer";
    case "comparaison": {
      const o = carte.options.find((x) => x.id === r.choix);
      return o ? `Choisir « ${o.titre.length > 28 ? `${o.titre.slice(0, 27)}…` : o.titre} »` : "Choisir";
    }
    case "liste":
      return "Valider la liste";
    case "creneaux":
      return "Confirmer le créneau";
    case "tableau":
      return "Envoyer le tableau";
  }
}

/* ─── Formulaire ───────────────────────────────────────────────── */

/** Les champs qui prennent toute la largeur (les autres vont deux par ligne). */
const LARGES = new Set(["long", "multiple", "curseur"]);

function Formulaire({
  carte,
  valeurs,
  figee,
  onChange,
}: {
  carte: Extract<Carte, { genre: "formulaire" }>;
  valeurs: Record<string, ValeurChamp>;
  figee: boolean;
  onChange: (id: string, v: ValeurChamp | null) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 max-[560px]:grid-cols-1">
      {carte.champs.map((c) => (
        <div key={c.id} data-champ={c.id} className={cn("flex min-w-0 flex-col gap-1.5", (LARGES.has(c.type) || (c.type === "choix" && c.options.length <= 4)) && "col-span-2 max-[560px]:col-span-1")}>
          <ChampVue champ={c} valeur={valeurs[c.id] ?? null} figee={figee} onChange={(v) => onChange(c.id, v)} />
        </div>
      ))}
    </div>
  );
}

function Libelle({ id, champ, valeur }: { id: string; champ: ChampCarte; valeur?: ReactNode }) {
  return (
    <span id={id} className="flex items-baseline justify-between gap-2 text-ui-s font-medium text-texte-principal">
      <span>
        {champ.libelle}
        {champ.requis && <span className="text-texte-tertiaire"> *</span>}
      </span>
      {valeur}
    </span>
  );
}

function ChampVue({ champ: c, valeur, figee, onChange }: { champ: ChampCarte; valeur: ValeurChamp | null; figee: boolean; onChange: (v: ValeurChamp | null) => void }) {
  const id = useId();
  const aide = c.aide ? <span className="text-ui-xs leading-[1.4] text-texte-tertiaire">{c.aide}</span> : null;
  /* Figée : la valeur envoyée, en texte. */
  if (figee && c.type !== "interrupteur") {
    return (
      <>
        <Libelle id={id} champ={c} />
        <span className={cn("text-ui-s leading-[1.45] whitespace-pre-wrap", valeurLisible(c, valeur) ? "text-texte-secondaire" : "text-texte-tertiaire")}>{valeurLisible(c, valeur) || "—"}</span>
      </>
    );
  }
  switch (c.type) {
    case "texte":
    case "nombre":
    case "date":
      return (
        <>
          <Libelle id={id} champ={c} />
          <span className="flex items-center gap-2">
            <Input
              size="sm"
              type={c.type === "texte" ? "text" : c.type}
              aria-labelledby={id}
              value={valeur === null ? "" : String(valeur)}
              min={c.min ?? undefined}
              max={c.max ?? undefined}
              step={c.pas ?? undefined}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const v = e.target.value;
                onChange(c.type === "nombre" ? (v === "" || Number.isNaN(Number(v)) ? null : Number(v)) : v || null);
              }}
              className={cn(CHAMP, "min-w-0 flex-1")}
            />
            {c.unite && <span className="shrink-0 text-ui-s text-texte-tertiaire">{c.unite}</span>}
          </span>
          {aide}
        </>
      );
    case "long":
      return (
        <>
          <Libelle id={id} champ={c} />
          <Textarea size="sm" autoGrow aria-labelledby={id} value={typeof valeur === "string" ? valeur : ""} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value || null)} className={cn(CHAMP, "min-h-[72px]")} />
          {aide}
        </>
      );
    case "choix":
      return (
        <>
          <Libelle id={id} champ={c} />
          {c.options.length <= 4 ? (
            <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
              {c.options.map((o) => (
                <Puce key={o} role="radio" coche={valeur === o} onClick={() => onChange(o)}>
                  {o}
                </Puce>
              ))}
            </div>
          ) : (
            <ListeDeroulante libelle={c.libelle} options={c.options.map((o) => ({ value: o, label: o }))} value={typeof valeur === "string" ? valeur : ""} placeholder="Choisir…" onChange={(v) => onChange(v)} />
          )}
          {aide}
        </>
      );
    case "multiple": {
      const choisies = Array.isArray(valeur) ? valeur : [];
      return (
        <>
          <Libelle id={id} champ={c} />
          <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
            {c.options.map((o) => (
              <Puce key={o} role="checkbox" coche={choisies.includes(o)} onClick={() => onChange(choisies.includes(o) ? choisies.filter((x) => x !== o) : c.options.filter((x) => x === o || choisies.includes(x)))}>
                {o}
              </Puce>
            ))}
          </div>
          {aide}
        </>
      );
    }
    case "interrupteur":
      return (
        <span className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-bordure-subtile px-3 py-2">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ui-s font-medium text-texte-principal">{c.libelle}</span>
            {c.aide && <span className="text-ui-xs text-texte-tertiaire">{c.aide}</span>}
          </span>
          <Interrupteur actif={valeur === true} libelle={c.libelle} disabled={figee} onChange={(v) => onChange(v)} />
        </span>
      );
    case "curseur": {
      const min = c.min ?? 0;
      const max = c.max ?? 100;
      const v = typeof valeur === "number" ? valeur : min;
      return (
        <>
          <Libelle id={id} champ={c} valeur={<span className="klyra-mono text-ui-s font-semibold text-texte-accent">{valeurLisible(c, v)}</span>} />
          <input
            type="range"
            aria-labelledby={id}
            min={min}
            max={max}
            step={c.pas ?? 1}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
            className="klyra-curseur w-full"
            style={{ "--klyra-curseur": `${((v - min) / (max - min)) * 100}%` } as CSSProperties}
          />
          <span className="flex justify-between text-ui-2xs text-texte-tertiaire">
            <span>{valeurLisible(c, min)}</span>
            <span>{valeurLisible(c, max)}</span>
          </span>
          {aide}
        </>
      );
    }
  }
}

/** Une réponse à cocher : un vrai bouton, coché en bleu. */
function Puce({ role, coche, onClick, children, disabled }: { role: "radio" | "checkbox"; coche: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={coche}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-8 cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 py-1 text-left text-ui-s leading-[1.3] transition-[border-color,background-color,transform] duration-[220ms] ease-sortie active:scale-[0.97] disabled:cursor-default disabled:active:scale-100",
        coche ? "border-bleu-k1-500 bg-fond-teinte-bleue text-texte-accent" : "border-bordure-defaut bg-fond-surface text-texte-principal hover:border-bordure-accent-survol",
      )}
    >
      {role === "checkbox" && (
        <span aria-hidden="true" className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px]", coche ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte")}>
          {coche && <Icon name="check-01" size={12} />}
        </span>
      )}
      {children}
    </button>
  );
}

/* ─── Comparaison ──────────────────────────────────────────────── */

function Comparaison({ carte, choix, figee, onChoisir }: { carte: Extract<Carte, { genre: "comparaison" }>; choix: string | undefined; figee: boolean; onChoisir: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label={carte.titre} className={cn("grid gap-3", carte.options.length === 2 || carte.options.length === 4 ? "grid-cols-2" : "grid-cols-3", "max-[560px]:grid-cols-1")}>
      {carte.options.map((o) => {
        const choisie = o.id === choix;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={choisie}
            data-piste={o.id}
            disabled={figee}
            onClick={() => onChoisir(o.id)}
            className={cn(
              "flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow,opacity] duration-[220ms] ease-sortie disabled:cursor-default",
              choisie ? "border-bleu-k1-500 bg-fond-teinte-bleue/50 shadow-ombre-sm" : "border-bordure-subtile bg-fond-surface hover:border-bordure-accent-survol",
              figee && !choisie && "opacity-50",
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="text-ui-s leading-[1.3] font-semibold text-texte-principal">{o.titre}</span>
              {choisie ? (
                <span aria-hidden="true" className="klyra-etoile-allumee flex size-5 shrink-0 items-center justify-center rounded-full bg-bleu-k1-500 text-texte-inverse">
                  <Icon name="check-01" size={12} />
                </span>
              ) : (
                <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-[1.5px] border-bordure-forte" />
              )}
            </span>
            {o.recommandee && (
              <span className="flex w-fit items-center gap-1 rounded-xs bg-fond-teinte-bleue px-1.5 py-0.5 text-ui-2xs font-medium text-texte-accent">
                <Icon name="stars" size={11} />
                Recommandée
              </span>
            )}
            {o.resume && <span className="text-ui-xs leading-[1.45] text-texte-secondaire">{o.resume}</span>}
            {(o.pour.length > 0 || o.contre.length > 0) && (
              <span className="flex flex-col gap-1 border-t border-bordure-subtile pt-2 text-ui-xs leading-[1.4]">
                {o.pour.map((p) => (
                  <span key={`+${p}`} className="flex gap-1.5 text-texte-principal">
                    <span aria-hidden="true" className="font-semibold text-texte-accent">+</span>
                    <span className="sr-only">Atout : </span>
                    {p}
                  </span>
                ))}
                {o.contre.map((p) => (
                  <span key={`-${p}`} className="flex gap-1.5 text-texte-tertiaire">
                    <span aria-hidden="true" className="font-semibold">−</span>
                    <span className="sr-only">Limite : </span>
                    {p}
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Liste à valider ──────────────────────────────────────────── */

function Liste({ carte, coches, figee, onChange }: { carte: Extract<Carte, { genre: "liste" }>; coches: string[]; figee: boolean; onChange: (coches: string[]) => void }) {
  const ordre = (ids: string[]) => carte.elements.filter((e) => ids.includes(e.id)).map((e) => e.id);
  return (
    <div className="flex flex-col gap-2">
      <ul role="group" aria-label={carte.titre} className="m-0 flex list-none flex-col gap-1 p-0">
        {carte.elements.map((e) => {
          const coche = coches.includes(e.id);
          return (
            <li key={e.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={coche}
                data-element={e.id}
                disabled={figee}
                onClick={() => onChange(ordre(coche ? coches.filter((x) => x !== e.id) : [...coches, e.id]))}
                className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left transition-colors duration-[220ms] ease-sortie hover:bg-fond-survol disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors duration-[220ms] ease-sortie",
                    coche ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte bg-fond-surface",
                  )}
                >
                  {coche && <Icon name="check-01" size={14} />}
                </span>
                <span className={cn("text-ui-s leading-[1.45]", coche ? "text-texte-principal" : "text-texte-tertiaire line-through decoration-bordure-forte")}>{e.texte}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-2 px-2">
        <span className="klyra-mono text-ui-2xs text-texte-tertiaire">
          {coches.length} / {carte.elements.length} gardé{coches.length > 1 ? "s" : ""}
        </span>
        {!figee && (
          <span className="flex gap-1">
            <Bouton variant="discret" taille="mini" disabled={coches.length === carte.elements.length} onClick={() => onChange(carte.elements.map((e) => e.id))}>
              Tout garder
            </Bouton>
            <Bouton variant="discret" taille="mini" disabled={!coches.length} onClick={() => onChange([])}>
              Tout retirer
            </Bouton>
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Créneaux ─────────────────────────────────────────────────── */

function Creneaux({
  carte,
  choisi,
  figee,
  planning,
  onChoisir,
}: {
  carte: Extract<Carte, { genre: "creneaux" }>;
  choisi: number | undefined;
  figee: boolean;
  planning: Evenement[];
  onChoisir: (i: number) => void;
}) {
  const jours = [...new Set(carte.creneaux.map((c) => c.date))];
  const occupe = (i: number) => occupations(carte.creneaux[i], planning);
  const conflits = choisi !== undefined ? occupe(choisi) : [];
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={carte.titre} className="flex flex-col gap-3">
        {jours.map((jour) => (
          <div key={jour} className="flex flex-col gap-1.5">
            <span className="text-ui-xs font-medium text-texte-secondaire">{majuscule(dateLisible(jour))}</span>
            <div className="flex flex-wrap gap-2">
              {carte.creneaux.map((c, i) => {
                if (c.date !== jour) return null;
                const pris = occupe(i).length > 0;
                const coche = i === choisi;
                return (
                  <button
                    key={`${c.date}-${c.heure}`}
                    type="button"
                    role="radio"
                    aria-checked={coche}
                    aria-label={`${dateLisible(c.date)} à ${c.heure}, ${dureeLisible(c.duree)}${pris ? ", un rendez-vous à ce moment-là" : ""}`}
                    data-creneau={i}
                    disabled={figee}
                    onClick={() => onChoisir(i)}
                    className={cn(
                      "relative flex min-h-9 cursor-pointer items-center gap-1.5 rounded-sm border px-3 py-1.5 text-ui-s transition-[border-color,background-color,transform,opacity] duration-[220ms] ease-sortie active:scale-[0.97] disabled:cursor-default disabled:active:scale-100",
                      coche ? "border-bleu-k1-500 bg-fond-teinte-bleue text-texte-accent" : "border-bordure-defaut bg-fond-surface text-texte-principal hover:border-bordure-accent-survol",
                      figee && !coche && "opacity-45",
                    )}
                  >
                    <span className="klyra-mono font-semibold">{c.heure}</span>
                    <span className={coche ? "text-texte-accent" : "text-texte-tertiaire"}>· {dureeLisible(c.duree)}</span>
                    {pris && <span aria-hidden="true" className="size-1.5 rounded-full bg-orange-k1-500" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {conflits.length > 0 && (
        <p role="status" className="m-0 flex items-start gap-1.5 rounded-md bg-fond-tag-orange px-2.5 py-2 text-ui-xs leading-[1.45] text-texte-accent-orange">
          <Icon name="clock-01" size={14} className="mt-px shrink-0" />
          Tu as déjà {conflits.map((e) => `« ${e.titre} »${e.debut ? ` à ${e.debut}` : " ce jour-là"}`).join(", ")}.
        </p>
      )}
      {carte.creneaux.some((_, i) => occupe(i).length) && !conflits.length && (
        <p className="m-0 flex items-center gap-1.5 text-ui-2xs text-texte-tertiaire">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-orange-k1-500" />
          Un rendez-vous de ton planning à ce moment-là.
        </p>
      )}
    </div>
  );
}

/* ─── Tableau à compléter ──────────────────────────────────────── */

/** Un identifiant pour une ligne ajoutée par la personne (distinct de ceux de l'agent). */
const nouvelleLigne = (): LigneTableau => ({ id: `ajout-${Math.random().toString(36).slice(2, 8)}`, cellules: {} });

function Tableau({
  carte,
  lignes,
  figee,
  onChange,
}: {
  carte: Extract<Carte, { genre: "tableau" }>;
  lignes: LigneTableau[];
  figee: boolean;
  onChange: (lignes: LigneTableau[]) => void;
}) {
  const totaux = carte.colonnes.filter((c) => c.total);
  const ecrire = (id: string, colonne: string, v: Cellule | null) =>
    onChange(
      lignes.map((l) => {
        if (l.id !== id) return l;
        const cellules = { ...l.cellules };
        if (v === null || v === "") delete cellules[colonne];
        else cellules[colonne] = v;
        return { ...l, cellules };
      }),
    );
  return (
    <div className="flex flex-col gap-2">
      <div className="klyra-defilement-fin overflow-x-auto rounded-lg border border-bordure-subtile">
        <table className="w-full border-collapse text-left text-ui-s">
          <thead>
            <tr className="bg-fond-surface-grise/60">
              {carte.colonnes.map((c) => (
                <th key={c.id} scope="col" className={cn("border-b border-bordure-subtile px-2.5 py-2 text-ui-2xs font-medium whitespace-nowrap text-texte-tertiaire", c.type === "nombre" && "text-right")}>
                  {c.titre}
                  {c.requis && " *"}
                  {c.unite && <span className="font-normal"> ({c.unite})</span>}
                </th>
              ))}
              {carte.ajout && !figee && <th aria-label="Retirer" className="w-9 border-b border-bordure-subtile" />}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={l.id} data-ligne={l.id} className="group/ligne border-b border-bordure-subtile last:border-b-0">
                {carte.colonnes.map((c) => (
                  <td key={c.id} className={cn("px-1.5 py-1 align-middle", c.type === "nombre" && "text-right")}>
                    <CelluleVue colonne={c} valeur={l.cellules[c.id]} figee={figee} libelle={`${c.titre}, ligne ${i + 1}`} onChange={(v) => ecrire(l.id, c.id, v)} />
                  </td>
                ))}
                {carte.ajout && !figee && (
                  <td className="w-9 px-1 text-center">
                    <BoutonIcone
                      taille="mini"
                      icone={<Icon name="x-01" size={14} />}
                      libelle={`Retirer la ligne ${i + 1}`}
                      className="opacity-60 group-hover/ligne:opacity-100 focus-visible:opacity-100"
                      onClick={() => onChange(lignes.filter((x) => x.id !== l.id))}
                    />
                  </td>
                )}
              </tr>
            ))}
            {!lignes.length && (
              <tr>
                <td colSpan={carte.colonnes.length + 1} className="px-2.5 py-3 text-center text-ui-xs text-texte-tertiaire">
                  Aucune ligne pour l’instant.
                </td>
              </tr>
            )}
          </tbody>
          {totaux.length > 0 && lignes.length > 0 && (
            <tfoot>
              <tr className="border-t border-bordure-defaut bg-fond-surface-grise/40">
                {carte.colonnes.map((c, i) => (
                  <td key={c.id} className={cn("px-2.5 py-2 text-ui-xs font-semibold text-texte-principal", c.type === "nombre" && "klyra-mono text-right")}>
                    {c.total ? celluleLisible(c, totalColonne(c, lignes)) : i === 0 ? "Total" : ""}
                  </td>
                ))}
                {carte.ajout && !figee && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {carte.ajout && !figee && (
        <div className="flex items-center justify-between gap-2">
          <Bouton variant="discret" taille="mini" iconeGauche={<Icon name="plus-01" size={14} />} disabled={lignes.length >= MAX_LIGNES} onClick={() => onChange([...lignes, nouvelleLigne()])}>
            Ajouter une ligne
          </Bouton>
          <span className="klyra-mono text-ui-2xs text-texte-tertiaire">
            {lignes.length} / {MAX_LIGNES}
          </span>
        </div>
      )}
    </div>
  );
}

function CelluleVue({ colonne: c, valeur, figee, libelle, onChange }: { colonne: ColonneTableau; valeur: Cellule | undefined; figee: boolean; libelle: string; onChange: (v: Cellule | null) => void }) {
  if (figee) return <span className={cn("block px-1 py-1 text-ui-s", c.type === "nombre" && "klyra-mono", celluleLisible(c, valeur) ? "text-texte-principal" : "text-texte-tertiaire")}>{celluleLisible(c, valeur) || "—"}</span>;
  switch (c.type) {
    case "texte":
    case "nombre":
      return (
        <input
          type={c.type === "nombre" ? "number" : "text"}
          aria-label={libelle}
          value={valeur === undefined ? "" : String(valeur)}
          onChange={(e) => {
            const v = e.target.value;
            onChange(c.type === "nombre" ? (v === "" || Number.isNaN(Number(v)) ? null : Number(v)) : v);
          }}
          className={cn(
            "h-8 w-full min-w-[96px] rounded-xs border border-transparent bg-transparent px-1.5 text-ui-s text-texte-principal outline-none transition-colors duration-[160ms] ease-sortie hover:border-bordure-subtile focus:border-focus focus:bg-fond-surface",
            c.type === "nombre" && "klyra-mono text-right",
          )}
        />
      );
    case "choix":
      return (
        <ListeDeroulante
          variante="compact"
          libelle={libelle}
          options={c.options.map((o) => ({ value: o, label: o }))}
          value={typeof valeur === "string" ? valeur : ""}
          placeholder="Choisir"
          onChange={(v) => onChange(v)}
        />
      );
    case "interrupteur":
      return <Interrupteur actif={valeur === true} libelle={libelle} onChange={(v) => onChange(v)} />;
  }
}
