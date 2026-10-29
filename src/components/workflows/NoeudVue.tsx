"use client";

import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { MODELES } from "@/components/chat/ChoixModele";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { libelleFrequence, NOMS_JOURS } from "@/lib/planning";
import { texteSortie } from "@/lib/workflows/moteur";
import { useRoles } from "@/lib/workspace";
import type { Frequence, RoleTeinte } from "@/types/domain";
import type { EtapeWorkflow, Noeud, Valeur, Workflow } from "@/types/workflows";
import { ANCRE_NON, ANCRE_PORT, FICHES, LIBELLES_STATUT_ETAPE, largeurNoeud, nomNoeud } from "./catalogue";

/**
 * Une carte du canevas. Les étapes ont un en-tête (on la déplace par là), leurs
 * champs, leur dernier résultat et leurs ports ; les notes, textes et formes
 * se déplacent n'importe où et se redimensionnent par le coin.
 */

export interface ProprietesNoeud {
  noeud: Noeud;
  wf: Workflow;
  choisi: boolean;
  lecture: boolean;
  /** Le résultat montré : celui de l'exécution regardée. */
  etape: EtapeWorkflow | null;
  /** « 2 / 5 » et les flèches pour passer d'un résultat à l'autre. */
  resultats: { rang: number; total: number; precedent: () => void; suivant: () => void } | null;
  /** Le nœud reçoit un lien en cours de tracé (survol). */
  cible: "ok" | "refus" | null;
  onChamps: (patch: Record<string, Valeur>, fusion?: string) => void;
  onFrequence: (f: Frequence) => void;
  onPrise: (e: ReactPointerEvent<HTMLElement>) => void;
  onLienDepuis: (e: ReactPointerEvent<HTMLElement>, branche?: "oui" | "non") => void;
  onRedim: (e: ReactPointerEvent<HTMLElement>) => void;
  onLancer: () => void;
  onDecider: (approuver: boolean) => void;
  onWebhook: () => void;
  adresseWebhook: string | null;
}

const str = (v: Valeur | undefined) => (typeof v === "string" ? v : "");

/* ─── Petits morceaux ──────────────────────────────────────────── */

/** Un champ de texte qui grandit avec son contenu. Le clic n'attrape pas la carte. */
function ChampTexte({
  valeur,
  onChange,
  placeholder,
  lignes = 2,
  lecture,
  className,
}: {
  valeur: string;
  onChange: (v: string) => void;
  placeholder: string;
  lignes?: number;
  lecture: boolean;
  className?: string;
}) {
  return (
    <textarea
      value={valeur}
      readOnly={lecture}
      rows={lignes}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "w-full resize-none rounded-sm border border-bordure-subtile bg-fond-page px-2.5 py-2 text-ui-s leading-[1.45] text-texte-principal [field-sizing:content] placeholder:text-texte-tertiaire focus:border-bordure-forte focus:outline-none",
        className,
      )}
    />
  );
}

/** Un choix en puces (segments), comme les onglets de vue de l'agenda. */
function Segments<T extends string>({
  valeur,
  options,
  onChange,
  lecture,
}: {
  valeur: T;
  options: { id: T; nom: string }[];
  onChange: (v: T) => void;
  lecture: boolean;
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-0.5 self-start rounded-sm bg-fond-surface-grise p-0.5" onPointerDown={(e) => e.stopPropagation()}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={valeur === o.id}
          disabled={lecture}
          onClick={() => onChange(o.id)}
          className={cn(
            "h-6 cursor-pointer rounded-2xs border-0 px-2 text-ui-2xs font-medium transition-colors duration-[120ms] ease-sortie",
            valeur === o.id ? "bg-fond-surface text-texte-principal shadow-ombre-xs" : "bg-transparent text-texte-secondaire hover:text-texte-principal",
          )}
        >
          {o.nom}
        </button>
      ))}
    </div>
  );
}

/** Une liste déroulante compacte, posée dans la carte. */
function Liste({
  valeur,
  options,
  onChange,
  lecture,
  libelle,
}: {
  valeur: string;
  options: { id: string; nom: string }[];
  onChange: (v: string) => void;
  lecture: boolean;
  libelle: string;
}) {
  return (
    /* Un clic sur la liste ne déplace pas la carte. */
    <span className="inline-flex min-w-0" onPointerDown={(e) => e.stopPropagation()}>
      <ListeDeroulante
        variante="compact"
        libelle={libelle}
        value={valeur}
        disabled={lecture}
        options={options.map((o) => ({ value: o.id, label: o.nom }))}
        onChange={onChange}
        className="min-w-0"
      />
    </span>
  );
}

function Libelle({ children }: { children: ReactNode }) {
  return <span className="text-ui-2xs font-medium text-texte-tertiaire">{children}</span>;
}

/** Le point d'où part (ou où arrive) un lien. */
function Port({ cote, haut, titre, onPointerDown }: { cote: "entree" | "sortie"; haut: number; titre: string; onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void }) {
  return (
    <span
      role={onPointerDown ? "button" : undefined}
      aria-label={titre}
      title={titre}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute z-10 flex size-3.5 -translate-y-1/2 items-center justify-center rounded-full border-2 border-fond-surface bg-texte-tertiaire",
        cote === "entree" ? "-left-[7px]" : "-right-[7px] cursor-crosshair hover:scale-125 hover:bg-bleu-k1-500",
        "transition-transform duration-[120ms] ease-sortie",
      )}
      style={{ top: haut }}
    />
  );
}

/* ─── Les champs de chaque type ────────────────────────────────── */

function ChampsDeclencheur({ p }: { p: ProprietesNoeud }) {
  const { noeud: n, lecture, onChamps, onFrequence } = p;
  const type = str(n.champs.declencheur) || "manuel";
  const f: Frequence = n.frequence ?? { type: "jour", heure: "09:00" };
  const heure = "heure" in f ? f.heure : "09:00";
  const jour = "jour" in f ? f.jour : 1;
  const prochaine = p.wf.prochaines?.[n.id];
  return (
    <div className="flex flex-col gap-2.5">
      <Segments
        valeur={type}
        lecture={lecture}
        onChange={(v) => onChamps({ declencheur: v })}
        options={[
          { id: "manuel", nom: "Manuel" },
          { id: "planifie", nom: "Planifié" },
          { id: "webhook", nom: "Webhook" },
        ]}
      />
      {type === "planifie" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Liste
            libelle="Fréquence"
            valeur={f.type === "manuel" ? "jour" : f.type}
            lecture={lecture}
            options={[
              { id: "heure", nom: "Chaque heure" },
              { id: "jour", nom: "Chaque jour" },
              { id: "jours-ouvres", nom: "En semaine" },
              { id: "semaine", nom: "Chaque semaine" },
              { id: "mois", nom: "Chaque mois" },
            ]}
            onChange={(t) =>
              onFrequence(
                t === "heure"
                  ? { type: "heure" }
                  : t === "semaine"
                    ? { type: "semaine", jour, heure }
                    : t === "mois"
                      ? { type: "mois", jour, heure }
                      : { type: t as "jour" | "jours-ouvres", heure },
              )
            }
          />
          {f.type === "semaine" && (
            <Liste
              libelle="Jour"
              valeur={String(jour)}
              lecture={lecture}
              options={NOMS_JOURS.map((nom, i) => ({ id: String(i + 1), nom }))}
              onChange={(j) => onFrequence({ ...f, jour: Number(j) })}
            />
          )}
          {f.type === "mois" && (
            <Liste
              libelle="Jour du mois"
              valeur={String(jour)}
              lecture={lecture}
              options={Array.from({ length: 28 }, (_, i) => ({ id: String(i + 1), nom: i === 0 ? "le 1er" : `le ${i + 1}` }))}
              onChange={(j) => onFrequence({ ...f, jour: Number(j) })}
            />
          )}
          {f.type !== "heure" && f.type !== "manuel" && (
            <input
              type="time"
              aria-label="Heure"
              value={heure}
              readOnly={lecture}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => onFrequence({ ...f, heure: e.target.value })}
              className="h-7 rounded-sm border border-bordure-subtile bg-fond-surface px-2 text-ui-xs text-texte-principal"
            />
          )}
          <span className="w-full text-ui-2xs text-texte-tertiaire">
            {libelleFrequence(f)}
            {prochaine && ` · prochaine exécution ${new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(prochaine))}`}
          </span>
        </div>
      )}
      {type === "webhook" &&
        (p.adresseWebhook ? (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void navigator.clipboard.writeText(p.adresseWebhook ?? "")}
            title="Copier l’adresse du webhook"
            className="flex cursor-pointer items-center gap-1.5 truncate rounded-sm border border-bordure-subtile bg-fond-page px-2 py-1.5 text-left text-ui-2xs text-texte-secondaire hover:border-bordure-forte"
          >
            <Icon name="copy-left" size={14} className="shrink-0" />
            <span className="truncate">{p.adresseWebhook}</span>
          </button>
        ) : (
          <Bouton variant="blanc" taille="mini" disabled={lecture} onClick={p.onWebhook} className="self-start">
            Créer l’adresse du webhook
          </Bouton>
        ))}
      <Bouton variant="sombre" taille="mini" iconeGauche={<Icon name="play-01" size={14} />} disabled={lecture} onClick={p.onLancer} className="self-start">
        Lancer le workflow
      </Bouton>
    </div>
  );
}

function ChampsAgent({ p }: { p: ProprietesNoeud }) {
  const roles = useRoles();
  const { noeud: n, lecture, onChamps } = p;
  const agent = str(n.champs.agent);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <AgentRond roleId={agent || "principal"} taille={22} />
        <Liste
          libelle="Agent"
          valeur={agent}
          lecture={lecture}
          options={roles.map((r) => ({ id: r.id, nom: `${r.name} · ${r.tag}` }))}
          onChange={(v) => onChamps({ agent: v })}
        />
      </div>
      <ChampTexte
        valeur={str(n.champs.tache)}
        lecture={lecture}
        placeholder="Dis à l’agent quoi faire"
        lignes={3}
        onChange={(v) => onChamps({ tache: v }, `${n.id}:tache`)}
      />
    </div>
  );
}

function ChampsLlm({ p }: { p: ProprietesNoeud }) {
  const { noeud: n, lecture, onChamps } = p;
  const [systeme, setSysteme] = useState(!!str(n.champs.systeme));
  const modele = str(n.champs.modele) || "sonnet";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Liste libelle="Modèle" valeur={modele} lecture={lecture} options={MODELES.map((m) => ({ id: m.id, nom: m.nom }))} onChange={(v) => onChamps({ modele: v })} />
        {modele !== "haiku" && (
          <Liste
            libelle="Effort"
            valeur={str(n.champs.effort)}
            lecture={lecture}
            options={[
              { id: "", nom: "Effort par défaut" },
              { id: "low", nom: "Effort bas" },
              { id: "medium", nom: "Effort moyen" },
              { id: "high", nom: "Effort élevé" },
            ]}
            onChange={(v) => onChamps({ effort: v })}
          />
        )}
      </div>
      <ChampTexte valeur={str(n.champs.prompt)} lecture={lecture} placeholder="Saisis ton prompt ici" lignes={3} onChange={(v) => onChamps({ prompt: v }, `${n.id}:prompt`)} />
      {systeme ? (
        <ChampTexte valeur={str(n.champs.systeme)} lecture={lecture} placeholder="Prompt système (facultatif)" onChange={(v) => onChamps({ systeme: v }, `${n.id}:systeme`)} />
      ) : (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setSysteme(true)}
          className="cursor-pointer self-start border-0 bg-transparent p-0 text-ui-2xs text-texte-tertiaire hover:text-texte-principal"
        >
          + Prompt système
        </button>
      )}
    </div>
  );
}

function ChampsRessource({ p }: { p: ProprietesNoeud }) {
  const { noeud: n, lecture, onChamps } = p;
  const chemins = str(n.champs.chemins).split("\n").filter(Boolean);
  const choisir = async () => {
    const r = await getBridge()?.fichiers.choisir();
    if (r?.ok && r.data.length) onChamps({ chemins: [...new Set([...chemins, ...r.data])].join("\n") });
  };
  return (
    <div className="flex flex-col gap-1.5">
      {chemins.map((c) => (
        <span key={c} className="flex items-center gap-1.5 rounded-sm bg-fond-page px-2 py-1 text-ui-2xs text-texte-secondaire">
          <Icon name="file-01" size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={c}>
            {c.split("/").pop()}
          </span>
          {!lecture && (
            <button
              type="button"
              aria-label="Retirer"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onChamps({ chemins: chemins.filter((x) => x !== c).join("\n") })}
              className="cursor-pointer border-0 bg-transparent p-0 text-texte-tertiaire hover:text-texte-principal"
            >
              <Icon name="x-01" size={12} />
            </button>
          )}
        </span>
      ))}
      <Bouton variant="blanc" taille="mini" disabled={lecture} onClick={() => void choisir()} className="self-start">
        {chemins.length ? "Ajouter des fichiers" : "Choisir des fichiers"}
      </Bouton>
    </div>
  );
}

function ChampsSortie({ p }: { p: ProprietesNoeud }) {
  const { noeud: n, lecture, onChamps } = p;
  const cible = str(n.champs.cible) || "notification";
  return (
    <div className="flex flex-col gap-2">
      <Segments
        valeur={cible}
        lecture={lecture}
        onChange={(v) => onChamps({ cible: v })}
        options={[
          { id: "notification", nom: "Notification" },
          { id: "conversation", nom: "Conversation" },
          { id: "fichier", nom: "Fichier" },
        ]}
      />
      {cible === "fichier" ? (
        <ChampTexte valeur={str(n.champs.chemin)} lecture={lecture} lignes={1} placeholder="Chemin du fichier (ex. ~/Documents/rapport.md)" onChange={(v) => onChamps({ chemin: v }, `${n.id}:chemin`)} />
      ) : (
        <ChampTexte
          valeur={str(n.champs.titre)}
          lecture={lecture}
          lignes={1}
          placeholder={cible === "notification" ? "Titre de la notification" : "Nom de la conversation"}
          onChange={(v) => onChamps({ titre: v }, `${n.id}:titre`)}
        />
      )}
    </div>
  );
}

/* ─── Le résultat ──────────────────────────────────────────────── */

function Resultat({ p }: { p: ProprietesNoeud }) {
  const e = p.etape;
  const [copie, setCopie] = useState(false);
  if (!e) return null;
  const texte = texteSortie(e);
  const duree = e.fin ? Math.max(1, Math.round((new Date(e.fin).getTime() - new Date(e.debut).getTime()) / 1000)) : null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-bordure-subtile pt-2.5">
      <div className="flex items-center gap-1.5 text-ui-2xs text-texte-tertiaire">
        <span className="font-medium text-texte-secondaire">{e.statut === "fait" ? "Résultat" : LIBELLES_STATUT_ETAPE[e.statut]}</span>
        {e.branche && <span className="rounded-full bg-fond-surface-grise px-1.5">{e.branche === "oui" ? "Oui" : "Non"}</span>}
        {e.passe > 1 && <span>tour {e.passe}</span>}
        {duree && <span>{duree} s</span>}
        <span className="ml-auto flex items-center gap-0.5">
          {p.resultats && p.resultats.total > 1 && (
            <>
              <button type="button" aria-label="Résultat précédent" onPointerDown={(x) => x.stopPropagation()} onClick={p.resultats.precedent} className="cursor-pointer border-0 bg-transparent p-0.5 text-texte-tertiaire hover:text-texte-principal">
                <Icon name="chevron-left" size={12} />
              </button>
              <span className="tabular-nums">
                {p.resultats.rang}/{p.resultats.total}
              </span>
              <button type="button" aria-label="Résultat suivant" onPointerDown={(x) => x.stopPropagation()} onClick={p.resultats.suivant} className="cursor-pointer border-0 bg-transparent p-0.5 text-texte-tertiaire hover:text-texte-principal">
                <Icon name="chevron-right" size={12} />
              </button>
            </>
          )}
          {texte && (
            <button
              type="button"
              aria-label="Copier le résultat"
              onPointerDown={(x) => x.stopPropagation()}
              onClick={() => {
                void navigator.clipboard.writeText(texte);
                setCopie(true);
                setTimeout(() => setCopie(false), 1200);
              }}
              className="cursor-pointer border-0 bg-transparent p-0.5 text-texte-tertiaire hover:text-texte-principal"
            >
              {copie ? <PixelCheck className="h-2 w-3" /> : <Icon name="copy-left" size={12} />}
            </button>
          )}
        </span>
      </div>
      {e.erreur && <p className="m-0 text-ui-xs text-texte-erreur">{e.erreur}</p>}
      {texte && (
        <p
          onPointerDown={(x) => x.stopPropagation()}
          className="m-0 max-h-[132px] cursor-text overflow-y-auto rounded-sm bg-fond-page px-2.5 py-2 text-ui-xs leading-[1.5] whitespace-pre-wrap text-texte-principal select-text [overflow-wrap:anywhere]"
        >
          {texte}
        </p>
      )}
      {e.statut === "approbation" && (
        <div className="flex gap-1.5">
          <Bouton variant="sombre" taille="mini" onClick={() => p.onDecider(true)}>
            Approuver
          </Bouton>
          <Bouton variant="blanc" taille="mini" onClick={() => p.onDecider(false)}>
            Refuser
          </Bouton>
        </div>
      )}
    </div>
  );
}

/* ─── Les notes, textes et formes ──────────────────────────────── */

function CheminForme({ forme, l, h }: { forme: string; l: number; h: number }) {
  const m = 2;
  switch (forme) {
    case "cercle":
    case "ovale":
      return <ellipse cx={l / 2} cy={h / 2} rx={l / 2 - m} ry={(forme === "cercle" ? Math.min(l, h) : h) / 2 - m} />;
    case "losange":
      return <polygon points={`${l / 2},${m} ${l - m},${h / 2} ${l / 2},${h - m} ${m},${h / 2}`} />;
    case "triangle":
      return <polygon points={`${l / 2},${m} ${l - m},${h - m} ${m},${h - m}`} />;
    case "triangle-inverse":
      return <polygon points={`${m},${m} ${l - m},${m} ${l / 2},${h - m}`} />;
    case "etoile": {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 ? 0.42 : 1;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        return `${l / 2 + Math.cos(a) * (l / 2 - m) * r},${h / 2 + Math.sin(a) * (h / 2 - m) * r}`;
      });
      return <polygon points={pts.join(" ")} />;
    }
    default:
      return <rect x={m} y={m} width={l - m * 2} height={h - m * 2} rx={12} />;
  }
}

function Annotation({ p }: { p: ProprietesNoeud }) {
  const { noeud: n, lecture, onChamps, choisi } = p;
  const [edite, setEdite] = useState(false);
  const l = largeurNoeud(n);
  const h = n.taille?.h ?? FICHES[n.type].hauteur ?? 0;
  const teinte = (str(n.champs.teinte) || "jaune") as RoleTeinte;
  const pastel = AGENT_PASTELS[teinte] ?? AGENT_PASTELS.jaune;
  const zoneTexte = (classe: string, placeholder: string) =>
    edite && !lecture ? (
      <textarea
        autoFocus
        value={str(n.champs.texte)}
        placeholder={placeholder}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onChamps({ texte: e.target.value }, `${n.id}:texte`)}
        onBlur={() => setEdite(false)}
        className={cn("h-full w-full resize-none border-0 bg-transparent p-0 focus:outline-none", classe)}
      />
    ) : (
      <span className={cn("block h-full w-full whitespace-pre-wrap [overflow-wrap:anywhere]", classe, !str(n.champs.texte) && "text-texte-tertiaire")}>
        {str(n.champs.texte) || placeholder}
      </span>
    );

  const coin = choisi && !lecture && !n.verrouille && (
    <span
      role="button"
      aria-label="Redimensionner"
      onPointerDown={p.onRedim}
      className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-2xs border border-bleu-k1-500 bg-fond-surface"
    />
  );

  if (n.type === "note")
    return (
      <div
        onPointerDown={p.onPrise}
        onDoubleClick={() => setEdite(true)}
        className="relative flex cursor-grab flex-col gap-2 rounded-xs p-3 shadow-ombre-sm active:cursor-grabbing"
        style={{ width: l, height: h, background: pastel.bas, boxShadow: `inset 0 0 0 1px ${pastel.haut}` }}
      >
        <div className="min-h-0 flex-1">{zoneTexte("text-ui-s leading-[1.45] text-texte-principal", "Écris une note")}</div>
        {n.champs.montrerAuteur !== false && str(n.champs.auteur) && <span className="text-ui-2xs text-texte-tertiaire">— {str(n.champs.auteur)}</span>}
        {coin}
      </div>
    );

  if (n.type === "texte") {
    const corps = str(n.champs.corps) || "corps";
    const classe = cn(
      "text-texte-principal",
      corps === "titre" ? "text-h3 leading-[1.05] tracking-[-0.03em]" : corps === "intertitre" ? "text-h4 leading-[1.1]" : "text-ui leading-[1.5]",
      n.champs.gras ? "font-semibold" : "font-normal",
      str(n.champs.alignement) === "centre" ? "text-center" : str(n.champs.alignement) === "droite" ? "text-right" : str(n.champs.alignement) === "justifie" ? "text-justify" : "text-left",
    );
    return (
      <div onPointerDown={p.onPrise} onDoubleClick={() => setEdite(true)} className="relative cursor-grab p-1 active:cursor-grabbing" style={{ width: l, minHeight: 32 }}>
        {zoneTexte(classe, "Ajoute du texte")}
        {coin}
      </div>
    );
  }

  /* Forme */
  return (
    <div onPointerDown={p.onPrise} onDoubleClick={() => setEdite(true)} className="relative cursor-grab active:cursor-grabbing" style={{ width: l, height: h }}>
      <svg aria-hidden="true" width={l} height={h} className="absolute inset-0" style={{ fill: pastel.haut, stroke: pastel.accent, strokeWidth: 1.5 }}>
        <CheminForme forme={str(n.champs.forme)} l={l} h={h} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center p-4 text-center">{zoneTexte("text-ui-s font-medium text-texte-principal text-center", "")}</div>
      {coin}
    </div>
  );
}

/* ─── La carte ─────────────────────────────────────────────────── */

export function NoeudVue(p: ProprietesNoeud) {
  const { noeud: n, choisi, etape, lecture } = p;
  const fiche = FICHES[n.type];

  if (fiche.groupe === "annotations")
    return (
      <div data-noeud={n.id} className={cn("rounded-xs", choisi && "outline-2 outline-offset-4 outline-bleu-k1-500 outline")}>
        <Annotation p={p} />
      </div>
    );

  const statut = etape?.statut;
  const entree = n.type !== "declencheur" && n.type !== "prompt" && n.type !== "ressource";
  const sortie = n.type !== "sortie";

  return (
    <div
      data-noeud={n.id}
      className={cn(
        "relative flex flex-col rounded-lg border bg-fond-surface shadow-ombre-sm transition-[border-color,box-shadow] duration-[120ms] ease-sortie",
        p.cible === "ok"
          ? "border-bleu-k1-500 ring-2 ring-bleu-k1-500/20"
          : p.cible === "refus"
            ? "border-bordure-erreur"
            : choisi
              ? "border-bleu-k1-500"
              : statut === "en-cours" || statut === "approbation"
                ? "border-bleu-k2-500"
                : statut === "erreur"
                  ? "border-bordure-erreur"
                  : "border-bordure-subtile",
      )}
      style={{ width: largeurNoeud(n) }}
    >
      {/* L'en-tête : on attrape la carte par là. */}
      <div
        onPointerDown={p.onPrise}
        className={cn("flex h-11 items-center gap-2 px-3", !lecture && !n.verrouille && "cursor-grab active:cursor-grabbing")}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-xs bg-fond-surface-grise text-icone-secondaire">
          <Icon name={fiche.icone} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-ui-s font-semibold text-texte-principal">{nomNoeud(n)}</span>
        {n.verrouille && <Icon name="lock-01" size={14} className="text-icone-secondaire" />}
        {statut === "en-cours" && <Icon name="loader-01" size={14} className="text-icone-accent motion-safe:animate-spin" />}
        {statut === "fait" && <PixelCheck className="h-[9px] w-3" />}
        {statut === "erreur" && <span className="size-2 rounded-full bg-texte-erreur" />}
        {n.type !== "declencheur" && !lecture && (
          <button
            type="button"
            aria-label="Lancer l’étape"
            title="Lancer l’étape"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={p.onLancer}
            className="flex size-6 cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-icone-secondaire hover:bg-fond-survol hover:text-texte-principal"
          >
            <Icon name="play-01" size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-3 pb-3">
        {n.type === "declencheur" && <ChampsDeclencheur p={p} />}
        {n.type === "prompt" && (
          <ChampTexte valeur={str(n.champs.texte)} lecture={lecture} lignes={3} placeholder="Saisis ton prompt ici" onChange={(v) => p.onChamps({ texte: v }, `${n.id}:texte`)} />
        )}
        {n.type === "ressource" && <ChampsRessource p={p} />}
        {n.type === "agent" && <ChampsAgent p={p} />}
        {n.type === "llm" && <ChampsLlm p={p} />}
        {n.type === "image" && (
          <>
            <ChampTexte valeur={str(n.champs.description)} lecture={lecture} placeholder="Décris l’image" onChange={(v) => p.onChamps({ description: v }, `${n.id}:description`)} />
            <Segments
              valeur={str(n.champs.proportions) || "carre"}
              lecture={lecture}
              onChange={(v) => p.onChamps({ proportions: v })}
              options={[
                { id: "carre", nom: "Carré" },
                { id: "paysage", nom: "Paysage" },
                { id: "large", nom: "Large" },
                { id: "portrait", nom: "Portrait" },
              ]}
            />
            <span className="text-ui-2xs text-texte-tertiaire">{fiche.bientot}</span>
          </>
        )}
        {n.type === "condition" && (
          <>
            <Libelle>Règle</Libelle>
            <ChampTexte valeur={str(n.champs.regle)} lecture={lecture} placeholder="Décris quand l’exécution prend la branche Oui" onChange={(v) => p.onChamps({ regle: v }, `${n.id}:regle`)} />
          </>
        )}
        {n.type === "approbation" && (
          <ChampTexte valeur={str(n.champs.question)} lecture={lecture} placeholder="Demande-moi avant de continuer" onChange={(v) => p.onChamps({ question: v }, `${n.id}:question`)} />
        )}
        {n.type === "sortie" && <ChampsSortie p={p} />}
        <Resultat p={p} />
      </div>

      {entree && <Port cote="entree" haut={ANCRE_PORT} titre="Entrée" />}
      {sortie && n.type !== "condition" && <Port cote="sortie" haut={ANCRE_PORT} titre="Sortie : tire vers une autre carte" onPointerDown={(e) => p.onLienDepuis(e)} />}
      {n.type === "condition" && (
        <>
          <Port cote="sortie" haut={ANCRE_PORT} titre="Oui" onPointerDown={(e) => p.onLienDepuis(e, "oui")} />
          <span className="pointer-events-none absolute left-[calc(100%+12px)] text-ui-3xs font-medium text-texte-tertiaire" style={{ top: ANCRE_PORT - 16 }}>
            Oui
          </span>
          <Port cote="sortie" haut={ANCRE_NON} titre="Non" onPointerDown={(e) => p.onLienDepuis(e, "non")} />
          <span className="pointer-events-none absolute left-[calc(100%+12px)] text-ui-3xs font-medium text-texte-tertiaire" style={{ top: ANCRE_NON + 2 }}>
            Non
          </span>
        </>
      )}
    </div>
  );
}
