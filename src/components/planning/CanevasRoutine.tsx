"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { Textarea } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";
import { libelleFrequence, prochainPassage } from "@/lib/planning";
import { useProjects, useRole, useRoles, useWorkspace } from "@/lib/workspace";
import type { EtapePassage, RelaisRoutine, RoleId, Routine } from "@/types/domain";
import { etatPassage, LIBELLES_ETAT, MarqueEtat, quand, type Etat } from "./EtatPassage";

/**
 * Le canevas d'une routine : le déclencheur, puis la chaîne des agents. Chaque
 * flèche est un relais : quand un agent a répondu, sa réponse part au suivant
 * avec une consigne. On déplace les cartes à la main, le « + » d'une carte
 * passe la main à un autre agent.
 */

/** Largeur d'une carte, et hauteur où partent et arrivent les flèches. */
const CARTE = 232;
const ANCRE = 36;
const PAS_X = 300;
const PAS_Y = 150;
const DEPART = "depart";

type Point = { x: number; y: number };
type Choix = { type: "agent"; roleId: RoleId } | { type: "relais"; id: string } | null;

/** Les agents de la chaîne, dans l'ordre où la main passe, et leur rang. */
function ordreChaine(routine: Routine): { roleId: RoleId; rang: number; ligne: number }[] {
  const relais = routine.relais ?? [];
  const out: { roleId: RoleId; rang: number; ligne: number }[] = [];
  let niveau: RoleId[] = [routine.roleId];
  const vus = new Set(niveau);
  for (let rang = 0; niveau.length; rang++) {
    niveau.forEach((roleId, ligne) => out.push({ roleId, rang, ligne }));
    const suivant: RoleId[] = [];
    for (const id of niveau)
      for (const l of relais)
        if (l.de === id && !vus.has(l.vers)) {
          vus.add(l.vers);
          suivant.push(l.vers);
        }
    niveau = suivant;
  }
  return out;
}

/** Les relais encore reliés au premier agent (après un retrait, les autres tombent). */
function relaisAtteignables(roleId: RoleId, relais: RelaisRoutine[]): RelaisRoutine[] {
  const vus = new Set<RoleId>([roleId]);
  let change = true;
  while (change) {
    change = false;
    for (const l of relais)
      if (vus.has(l.de) && !vus.has(l.vers)) {
        vus.add(l.vers);
        change = true;
      }
  }
  return relais.filter((l) => vus.has(l.de));
}

function etatEtape(e: EtapePassage | undefined): Etat | null {
  return e ? e.statut : null;
}

/* ─── Les cartes ───────────────────────────────────────────────── */

/** Choisir l'agent à qui passer la main. */
function MenuAgents({ exclus, onChoisir, onFermer }: { exclus: RoleId[]; onChoisir: (id: RoleId) => void; onFermer: () => void }) {
  const roles = useRoles().filter((r) => !exclus.includes(r.id));
  return (
    <>
      <button type="button" aria-label="Fermer" onClick={onFermer} className="fixed inset-0 z-10 cursor-default border-0 bg-transparent" />
      <div
        ref={apparition}
        role="menu"
        className="absolute top-[52px] left-[calc(100%+8px)] z-20 flex max-h-[280px] w-[220px] flex-col overflow-y-auto rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-lg"
      >
        <span className="px-2 pt-1 pb-1.5 text-ui-2xs font-medium text-texte-tertiaire">Passer la main à…</span>
        {roles.map((r) => (
          <button
            key={r.id}
            type="button"
            role="menuitem"
            onClick={() => onChoisir(r.id)}
            className="flex cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left hover:bg-fond-survol"
          >
            <AgentRond roleId={r.id} taille={20} />
            <span className="truncate text-ui-s text-texte-principal">{r.name}</span>
            <span className="ml-auto shrink-0 text-ui-2xs text-texte-tertiaire">{r.tag}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function CarteAgent({
  roleId,
  premier,
  etat,
  choisie,
  exclus,
  onChoisir,
  onAjouter,
  onPrise,
}: {
  roleId: RoleId;
  premier: boolean;
  etat: Etat | null;
  choisie: boolean;
  exclus: RoleId[];
  onChoisir: () => void;
  onAjouter: (vers: RoleId) => void;
  onPrise: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const role = useRole(roleId);
  const [menu, setMenu] = useState(false);
  return (
    <div className="relative" style={{ width: CARTE }}>
      <div
        role="button"
        tabIndex={0}
        onPointerDown={onPrise}
        onClick={onChoisir}
        onKeyDown={(e) => e.key === "Enter" && onChoisir()}
        className={cn(
          "flex cursor-grab touch-none flex-col gap-2 rounded-lg border bg-fond-surface p-3 shadow-ombre-sm select-none active:cursor-grabbing",
          "transition-[border-color] duration-[120ms] ease-sortie",
          choisie ? "border-bleu-k1-500" : "border-bordure-subtile hover:border-bordure-forte",
        )}
      >
        <span className="flex items-center gap-2.5">
          <AgentRond roleId={roleId} taille={28} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ui-s font-semibold text-texte-principal">{role.name}</span>
            <span className="truncate text-ui-2xs text-texte-tertiaire">{role.tag}</span>
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-ui-2xs text-texte-tertiaire">
          {etat ? (
            <>
              <MarqueEtat etat={etat} />
              {LIBELLES_ETAT[etat]}
            </>
          ) : premier ? (
            "Ouvre la chaîne"
          ) : (
            "Prend la suite"
          )}
        </span>
      </div>
      {/* Le « + » : passer la main à un autre agent. */}
      <button
        type="button"
        aria-label={`Après ${role.name}, passer la main à…`}
        title="Passer la main à un autre agent"
        onClick={() => setMenu(true)}
        className="absolute top-[24px] -right-3 flex size-6 cursor-pointer items-center justify-center rounded-full border border-bordure-subtile bg-fond-surface text-icone-secondaire shadow-ombre-xs hover:border-bordure-forte hover:text-texte-principal"
      >
        <Icon name="plus-01" size={14} />
      </button>
      {menu && (
        <MenuAgents
          exclus={exclus}
          onFermer={() => setMenu(false)}
          onChoisir={(id) => {
            setMenu(false);
            onAjouter(id);
          }}
        />
      )}
    </div>
  );
}

function CarteDepart({ routine, onPrise }: { routine: Routine; onPrise: (e: ReactPointerEvent<HTMLDivElement>) => void }) {
  return (
    <div
      onPointerDown={onPrise}
      className="flex cursor-grab touch-none flex-col gap-1.5 rounded-lg border border-bordure-subtile bg-fond-surface-grise p-3 select-none active:cursor-grabbing"
      style={{ width: 200 }}
    >
      <span className="flex items-center gap-1.5 text-ui-2xs font-medium text-texte-tertiaire">
        <Icon name="clock-01" size={14} />
        Déclencheur
      </span>
      <span className="text-ui-s font-semibold text-texte-principal">{libelleFrequence(routine.frequence)}</span>
      <span className="text-ui-2xs text-texte-tertiaire">
        {routine.frequence.type === "manuel"
          ? "Quand tu cliques sur Lancer"
          : routine.active
            ? `Prochain : ${quand(new Date(routine.prochaine))}`
            : "En pause"}
      </span>
    </div>
  );
}

/* ─── Le panneau de droite ─────────────────────────────────────── */

/** Une consigne qu'on écrit : enregistrée quand on quitte le champ. */
function ChampConsigne({ label, aide, valeur, onEnregistrer }: { label: string; aide: string; valeur: string; onEnregistrer: (v: string) => void }) {
  const [texte, setTexte] = useState(valeur);
  return (
    <Champ label={label} aide={aide}>
      <Textarea
        size="sm"
        autoGrow
        value={texte}
        placeholder="Écris ce qu’il doit faire…"
        onChange={(e) => setTexte(e.target.value)}
        onBlur={() => texte !== valeur && onEnregistrer(texte)}
        className={cn(CHAMP, "min-h-[120px]")}
      />
    </Champ>
  );
}

function NomAgent({ roleId }: { roleId: RoleId }) {
  return <>{useRole(roleId).name}</>;
}

function Panneau({
  routine,
  choix,
  onChoix,
  onEnregistrer,
}: {
  routine: Routine;
  choix: Choix;
  onChoix: (c: Choix) => void;
  onEnregistrer: (r: Routine) => void;
}) {
  const { state } = useWorkspace();
  const relais = routine.relais ?? [];
  const historique = useMemo(
    () =>
      routine.historique.slice(0, 8).map((h) => ({
        h,
        etat: etatPassage(
          state.messages.filter((m) => m.chatId === h.chatId),
          h,
        ),
      })),
    [routine.historique, state.messages],
  );

  if (choix?.type === "relais") {
    const l = relais.find((x) => x.id === choix.id);
    if (!l) return null;
    return (
      <div className="flex flex-col gap-3">
        <span className="flex items-center gap-1.5 text-ui-s font-semibold text-texte-principal">
          <AgentRond roleId={l.de} taille={20} />
          <Icon name="chevron-right" size={14} className="text-icone-secondaire" />
          <AgentRond roleId={l.vers} taille={20} />
          <span className="truncate">
            <NomAgent roleId={l.de} /> → <NomAgent roleId={l.vers} />
          </span>
        </span>
        <ChampConsigne
          key={l.id}
          label="Le relais"
          aide="Ce qu’il doit faire avec la réponse qu’il reçoit."
          valeur={l.consigne}
          onEnregistrer={(consigne) =>
            onEnregistrer({ ...routine, relais: relais.map((x) => (x.id === l.id ? { ...x, consigne } : x)) })
          }
        />
        <Bouton
          variant="blanc"
          taille="mini"
          className="self-start"
          onClick={() => {
            onEnregistrer({ ...routine, relais: relaisAtteignables(routine.roleId, relais.filter((x) => x.id !== l.id)) });
            onChoix(null);
          }}
        >
          Supprimer ce relais
        </Bouton>
      </div>
    );
  }

  if (choix?.type === "agent") {
    const premier = choix.roleId === routine.roleId;
    const entrants = relais.filter((l) => l.vers === choix.roleId);
    return (
      <div className="flex flex-col gap-3">
        <span className="flex items-center gap-2 text-ui-s font-semibold text-texte-principal">
          <AgentRond roleId={choix.roleId} taille={24} />
          <NomAgent roleId={choix.roleId} />
        </span>
        {premier ? (
          <ChampConsigne
            key={routine.id}
            label="Sa consigne"
            aide="Ce qu’il reçoit à chaque passage, comme un message que tu lui écrirais."
            valeur={routine.consigne}
            onEnregistrer={(consigne) => consigne.trim() && onEnregistrer({ ...routine, consigne })}
          />
        ) : (
          <>
            <span className="text-ui-xs text-texte-tertiaire">Il reçoit la main de :</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {entrants.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => onChoix({ type: "relais", id: l.id })}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-sm border border-bordure-subtile bg-fond-surface px-2 py-1.5 text-left hover:border-bordure-forte"
                  >
                    <AgentRond roleId={l.de} taille={18} />
                    <span className="min-w-0 flex-1 truncate text-ui-xs text-texte-secondaire">
                      {l.consigne || "Consigne à écrire"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Bouton
              variant="blanc"
              taille="mini"
              className="self-start"
              onClick={() => {
                const reste = relais.filter((l) => l.de !== choix.roleId && l.vers !== choix.roleId);
                onEnregistrer({ ...routine, relais: relaisAtteignables(routine.roleId, reste) });
                onChoix(null);
              }}
            >
              Retirer de la chaîne
            </Bouton>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-ui-xs leading-[1.5] text-texte-tertiaire">
        Clique sur le « + » d’un agent pour lui faire passer la main, puis sur la flèche pour écrire le relais.
      </p>
      <div className="flex flex-col gap-1">
        <h4 className="m-0 text-ui-xs font-medium text-texte-tertiaire">Historique des passages</h4>
        {historique.length === 0 ? (
          <p className="m-0 text-ui-s text-texte-tertiaire">Aucun passage pour l’instant.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {historique.map(({ h, etat }) => (
              <li key={h.at}>
                <Link
                  href={`/chat?id=${h.chatId}`}
                  className="flex items-center gap-2 rounded-sm px-1.5 py-1.5 text-ui-s text-texte-principal no-underline hover:bg-fond-survol"
                >
                  <span className="flex-1">
                    {quand(new Date(h.at))}
                    {h.rattrapee && <span className="text-texte-tertiaire"> · rattrapé</span>}
                  </span>
                  <span className="sr-only">{LIBELLES_ETAT[etat]}</span>
                  <MarqueEtat etat={etat} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─── Le canevas ───────────────────────────────────────────────── */

export function CanevasRoutine({ routine, onModifier }: { routine: Routine; onModifier: () => void }) {
  const { state, enregistrerRoutine, supprimerRoutine, lancerRoutine } = useWorkspace();
  const projet = useProjects().find((p) => p.id === routine.projectId);
  const [choix, setChoix] = useState<Choix>(null);
  const [confirmer, setConfirmer] = useState(false);
  const [glisse, setGlisse] = useState<{ id: string; p: Point } | null>(null);
  const prise = useRef<{ id: string; px: number; py: number; depart: Point; bouge: boolean } | null>(null);

  const relais = useMemo(() => routine.relais ?? [], [routine.relais]);
  const agents = useMemo(() => ordreChaine(routine), [routine]);
  const positions = useMemo(() => {
    const p: Record<string, Point> = { [DEPART]: { x: 32, y: 56 } };
    for (const a of agents) p[a.roleId] = { x: 32 + 240 + a.rang * PAS_X, y: 48 + a.ligne * PAS_Y };
    Object.assign(p, routine.positions);
    if (glisse) p[glisse.id] = glisse.p;
    return p;
  }, [agents, routine.positions, glisse]);

  const dernier = routine.historique[0];
  const etatDe = (roleId: RoleId): Etat | null => {
    if (dernier?.etapes) return etatEtape(dernier.etapes.find((e) => e.roleId === roleId));
    if (roleId !== routine.roleId || !dernier) return null;
    return etatPassage(
      state.messages.filter((m) => m.chatId === dernier.chatId),
      dernier,
    );
  };

  const prendre = (id: string, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    prise.current = { id, px: e.clientX, py: e.clientY, depart: positions[id], bouge: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const bouger = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = prise.current;
    if (!p) return;
    const dx = e.clientX - p.px;
    const dy = e.clientY - p.py;
    if (!p.bouge && Math.hypot(dx, dy) < 4) return;
    p.bouge = true;
    setGlisse({ id: p.id, p: { x: Math.max(0, p.depart.x + dx), y: Math.max(0, p.depart.y + dy) } });
  };
  const lacher = () => {
    const p = prise.current;
    prise.current = null;
    if (!p?.bouge || !glisse) return;
    enregistrerRoutine({ ...routine, positions: { ...routine.positions, [glisse.id]: glisse.p } });
    setGlisse(null);
  };

  const ajouter = (de: RoleId, vers: RoleId) => {
    const l: RelaisRoutine = { id: crypto.randomUUID(), de, vers, consigne: "" };
    const nouvelles = { ...routine.positions };
    if (!positions[vers]) {
      const sortants = relais.filter((x) => x.de === de).length;
      nouvelles[vers] = { x: positions[de].x + PAS_X, y: positions[de].y + sortants * PAS_Y };
    }
    enregistrerRoutine({ ...routine, relais: [...relais, l], positions: nouvelles });
    setChoix({ type: "relais", id: l.id });
  };

  /* Les flèches : du bord droit d'une carte au bord gauche de la suivante. */
  const fleche = (a: Point, largeur: number, b: Point) => {
    const x1 = a.x + largeur;
    const y1 = a.y + ANCRE;
    const x2 = b.x;
    const y2 = b.y + ANCRE;
    const c = Math.max(48, Math.abs(x2 - x1) / 2);
    return { d: `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2 - 6} ${y2}`, milieu: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
  };
  const premiere = fleche(positions[DEPART], 200, positions[routine.roleId]);

  return (
    <section aria-label={`Routine ${routine.nom}`} className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex min-w-0 flex-col">
          <h2 className="m-0 truncate text-h4 leading-[1.1] font-semibold tracking-[-0.03em] text-texte-principal">{routine.nom}</h2>
          <span className="text-ui-xs text-texte-tertiaire">
            {libelleFrequence(routine.frequence)}
            {projet ? ` · projet ${projet.name}` : " · sans projet"}
            {!routine.active && " · en pause"}
          </span>
        </div>
        <Bouton variant="sombre" taille="compact" iconeGauche={<Icon name="play-01" size={16} />} onClick={() => lancerRoutine(routine.id)}>
          Lancer
        </Bouton>
        {routine.frequence.type !== "manuel" &&
          (routine.active ? (
            <BoutonIcone
              taille="compact"
              icone={<Icon name="pause-01" size={16} />}
              libelle="Mettre en pause"
              onClick={() => enregistrerRoutine({ ...routine, active: false })}
            />
          ) : (
            <Bouton
              variant="blanc"
              taille="compact"
              onClick={() =>
                // Reprise : on repart du prochain passage à venir, sans rattraper la pause.
                enregistrerRoutine({ ...routine, active: true, prochaine: prochainPassage(routine.frequence, new Date()).toISOString() })
              }
            >
              Reprendre
            </Bouton>
          ))}
        <Bouton variant="blanc" taille="compact" onClick={onModifier}>
          Modifier
        </Bouton>
        <BoutonIcone taille="compact" icone={<Icon name="trash-01" size={16} />} libelle="Supprimer" onClick={() => setConfirmer(true)} />
      </header>
      {confirmer && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-fond-surface-grise p-3">
          <span className="flex-1 text-ui-s text-texte-principal">Supprimer « {routine.nom} » ? Les conversations déjà faites restent.</span>
          <Bouton variant="sombre" taille="compact" onClick={() => supprimerRoutine(routine.id)}>
            Supprimer
          </Bouton>
          <Bouton variant="blanc" taille="compact" onClick={() => setConfirmer(false)}>
            Annuler
          </Bouton>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-[minmax(0,1fr)_280px]">
        <div
          className="relative h-[460px] overflow-auto rounded-lg border border-bordure-subtile bg-fond-page"
          onPointerMove={bouger}
          onPointerUp={lacher}
          onPointerCancel={lacher}
        >
          <div
            className="relative"
            style={{
              width: 1600,
              height: 900,
              backgroundImage: "radial-gradient(var(--color-bordure-forte) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
            onClick={(e) => e.target === e.currentTarget && setChoix(null)}
          >
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={1600} height={900}>
              <defs>
                <marker id="fleche-relais" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M0 0 L8 4 L0 8 z" className="fill-texte-tertiaire" />
                </marker>
              </defs>
              <path d={premiere.d} fill="none" strokeWidth={1.5} className="stroke-texte-tertiaire" markerEnd="url(#fleche-relais)" />
              {relais.map((l) => {
                if (!positions[l.de] || !positions[l.vers]) return null;
                const f = fleche(positions[l.de], CARTE, positions[l.vers]);
                const actif = choix?.type === "relais" && choix.id === l.id;
                return (
                  <path
                    key={l.id}
                    d={f.d}
                    fill="none"
                    strokeWidth={actif ? 2 : 1.5}
                    className={actif ? "stroke-bleu-k1-500" : "stroke-texte-tertiaire"}
                    markerEnd="url(#fleche-relais)"
                  />
                );
              })}
            </svg>

            {/* L'étiquette de chaque relais, au milieu de sa flèche : un clic pour écrire sa consigne. */}
            {relais.map((l) => {
              if (!positions[l.de] || !positions[l.vers]) return null;
              const { milieu } = fleche(positions[l.de], CARTE, positions[l.vers]);
              const actif = choix?.type === "relais" && choix.id === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setChoix({ type: "relais", id: l.id })}
                  className={cn(
                    "absolute max-w-[180px] -translate-x-1/2 -translate-y-1/2 cursor-pointer truncate rounded-full border px-2 py-0.5 text-ui-2xs",
                    actif
                      ? "border-bleu-k1-500 bg-fond-surface text-texte-principal"
                      : l.consigne
                        ? "border-bordure-subtile bg-fond-surface text-texte-secondaire hover:border-bordure-forte"
                        : "border-dashed border-bordure-forte bg-fond-surface text-texte-tertiaire hover:text-texte-principal",
                  )}
                  style={{ left: milieu.x, top: milieu.y }}
                >
                  {l.consigne || "Écrire le relais"}
                </button>
              );
            })}

            <div className="absolute" style={{ left: positions[DEPART].x, top: positions[DEPART].y }}>
              <CarteDepart routine={routine} onPrise={(e) => prendre(DEPART, e)} />
            </div>
            {agents.map(({ roleId }, i) => (
              <div key={roleId} className="absolute" style={{ left: positions[roleId].x, top: positions[roleId].y }}>
                <CarteAgent
                  roleId={roleId}
                  premier={i === 0}
                  etat={etatDe(roleId)}
                  choisie={choix?.type === "agent" && choix.roleId === roleId}
                  exclus={[roleId, routine.roleId, ...relais.filter((l) => l.de === roleId).map((l) => l.vers)]}
                  onChoisir={() => !glisse && setChoix({ type: "agent", roleId })}
                  onAjouter={(vers) => ajouter(roleId, vers)}
                  onPrise={(e) => prendre(roleId, e)}
                />
              </div>
            ))}
          </div>
        </div>

        <aside aria-label="Réglages de la chaîne" className="flex flex-col gap-3 self-start rounded-lg border border-bordure-subtile bg-fond-surface p-3.5">
          <Panneau key={routine.id} routine={routine} choix={choix} onChoix={setChoix} onEnregistrer={enregistrerRoutine} />
        </aside>
      </div>
    </section>
  );
}
