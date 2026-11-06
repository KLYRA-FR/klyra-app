"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as EvenementSouris, type PointerEvent as EvenementPointeur } from "react";
import { Icon } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { BoutonIcone } from "@/components/ui/Bouton";
import { ElementContextuel, MenuContextuel, useMenuContextuel } from "@/components/ui/MenuContextuel";
import { ajouterAuBrouillon } from "@/lib/brouillons";
import { teinteNouvelAgent } from "@/lib/agents";
import { A_CONFIER, ELLE, tacheProposee, type BrouillonEquipe, type ChoixEquipe, type TacheEquipe } from "@/lib/atelier-equipe";
import { cn } from "@/lib/cn";

/**
 * Les deux premiers temps de l'atelier d'une équipe : ses tâches posées sur la table avec ses mots
 * (une proposition de l'assistant en pointillés, à garder ou retirer), puis leur regroupement (une
 * tâche se glisse d'un groupe à l'autre, au pointeur, par son menu ou par Alt + ← / →).
 */

/** Une colonne de l'étape des groupes : un groupe, ce qu'elle garde, ou ce qui reste à ranger. */
interface Zone {
  id: string;
  nom: string;
  detail: string;
  taches: TacheEquipe[];
  genre: "groupe" | "elle" | "a-ranger";
}

function zonesDe(b: BrouillonEquipe): Zone[] {
  const taches = b.taches ?? [];
  const aRanger = taches.filter((t) => !t.pourElle && !t.groupe);
  return [
    ...(aRanger.length ? [{ id: A_CONFIER, nom: "À ranger", detail: "Glisse-les dans un groupe.", taches: aRanger, genre: "a-ranger" as const }] : []),
    ...(b.groupes ?? []).map((g) => ({ id: g.id, nom: g.nom || "Un groupe", detail: g.pourquoi, taches: taches.filter((t) => !t.pourElle && t.groupe === g.id), genre: "groupe" as const })),
    { id: ELLE, nom: "Pour toi", detail: "Ce que tu gardes.", taches: taches.filter((t) => t.pourElle), genre: "elle" as const },
  ];
}

/** Un léger désordre de notes posées à la main, toujours le même pour une tâche. */
const rotation = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 9) - 4) * 0.5;
};

export function TableTaches({
  b,
  vue,
  modifiable,
  chatId,
  assistant,
  onChoisir,
}: {
  b: BrouillonEquipe;
  vue: "taches" | "groupes";
  /** C'est l'étape en cours, et rien n'est en train de s'écrire : elle peut agir sur la table. */
  modifiable: boolean;
  chatId: string;
  assistant: string;
  onChoisir: (c: ChoixEquipe) => void;
}) {
  const menu = useMenuContextuel<TacheEquipe>();
  const zones = zonesDe(b);
  const groupes = zones.filter((z) => z.genre === "groupe");
  const placer = (t: TacheEquipe, place: string) => onChoisir({ places: { [t.id]: place } });
  const trancher = (t: TacheEquipe, garder: boolean) => onChoisir({ taches: { [t.id]: garder } });

  /* Le glisser d'une tâche, aux événements du pointeur. */
  const [tenue, setTenue] = useState<{ id: string; dx: number; dy: number; zone: string | null } | null>(null);
  const depart = useRef<{ id: string; x: number; y: number; bouge: boolean } | null>(null);
  const zoneSous = (x: number, y: number) => (document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.dataset.zone) as HTMLElement | undefined)?.dataset.zone ?? null;
  const glisser = {
    onPointerDown: (e: EvenementPointeur<HTMLElement>, t: TacheEquipe) => {
      if (vue !== "groupes" || !modifiable || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      depart.current = { id: t.id, x: e.clientX, y: e.clientY, bouge: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: EvenementPointeur<HTMLElement>) => {
      const d = depart.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.bouge && Math.hypot(dx, dy) < 5) return;
      d.bouge = true;
      setTenue({ id: d.id, dx, dy, zone: zoneSous(e.clientX, e.clientY) });
    },
    onPointerUp: (e: EvenementPointeur<HTMLElement>, t: TacheEquipe) => {
      const d = depart.current;
      depart.current = null;
      setTenue(null);
      if (!d?.bouge) return;
      const zone = zoneSous(e.clientX, e.clientY);
      const actuelle = t.pourElle ? ELLE : t.groupe || A_CONFIER;
      if (zone && zone !== actuelle) placer(t, zone);
    },
    onPointerCancel: () => {
      depart.current = null;
      setTenue(null);
    },
  };

  /* Au clavier : Alt + ← / → passe la tâche dans la colonne voisine. */
  const clavier = (e: KeyboardEvent<HTMLElement>, t: TacheEquipe) => {
    if (vue !== "groupes" || !modifiable || !e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const ordre = zones.filter((z) => z.genre !== "a-ranger").map((z) => z.id);
    const actuelle = t.pourElle ? ELLE : t.groupe;
    const i = ordre.indexOf(actuelle);
    const cible = ordre[Math.max(0, Math.min(ordre.length - 1, (i === -1 ? 0 : i) + (e.key === "ArrowRight" ? 1 : -1)))];
    if (cible && cible !== actuelle) placer(t, cible);
  };

  const note = (t: TacheEquipe) => (
    <NoteTache
      key={t.id}
      t={t}
      modifiable={modifiable}
      tenue={tenue?.id === t.id ? tenue : null}
      penchee={vue === "taches"}
      pleine={vue === "groupes"}
      onTrancher={(garder) => trancher(t, garder)}
      onMenu={(e) => menu.ouvrir(e, t)}
      onKeyDown={(e) => clavier(e, t)}
      glisser={{
        onPointerDown: (e) => glisser.onPointerDown(e, t),
        onPointerMove: glisser.onPointerMove,
        onPointerUp: (e) => glisser.onPointerUp(e, t),
        onPointerCancel: glisser.onPointerCancel,
      }}
    />
  );

  const taches = b.taches ?? [];
  return (
    <>
      {vue === "taches" ? (
        <div className="flex flex-wrap content-start gap-x-7 gap-y-6 px-8 pt-2 pb-10">
          {taches.filter((t) => !t.pourElle).map(note)}
          {taches.filter((t) => t.pourElle).map(note)}
          {modifiable && (
            <button
              type="button"
              onClick={() => ajouterAuBrouillon(chatId, "J’oublie : je fais aussi ")}
              className="flex h-[84px] w-[208px] cursor-pointer items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-bordure-forte bg-transparent text-ui-xs font-medium text-texte-tertiaire transition-colors duration-[220ms] ease-sortie hover:border-bleu-k1-200 hover:text-texte-accent"
            >
              <Icon name="plus-01" size={16} />
              Une tâche de plus
            </button>
          )}
          {!taches.length && <p className="m-0 w-full text-ui-s text-texte-tertiaire">Tes tâches arriveront ici, avec tes mots, au fil de ta conversation avec {assistant}.</p>}
        </div>
      ) : (
        <div className="grid auto-cols-[minmax(184px,1fr)] grid-flow-col gap-3 overflow-x-auto px-6 pt-2 pb-8 [scrollbar-width:thin]">
          {zones.map((z) => (
            <section
              key={z.id}
              aria-label={z.nom}
              data-zone={z.id}
              data-survol={tenue?.zone === z.id || undefined}
              className={cn(
                "klyra-zone-groupe flex min-h-[360px] flex-col gap-2.5 rounded-2xl border-[1.5px] p-3",
                z.genre === "groupe" ? "border-dashed border-bordure-forte bg-white/40" : z.genre === "elle" ? "border-bordure-defaut bg-fond-surface-grise/40" : "border-dashed border-bordure-accent-survol bg-fond-teinte-bleue/40",
              )}
            >
              <header className="flex min-w-0 flex-col gap-0.5 px-0.5">
                <span className="flex min-w-0 items-center gap-1.5 text-ui-s font-semibold text-texte-principal">
                  {z.genre === "groupe" ? (
                    <RondApercu agentId={z.id} nom={z.nom} teinte={teinteNouvelAgent(z.id)} taille={14} />
                  ) : z.genre === "elle" ? (
                    <span aria-hidden="true" className="size-3.5 shrink-0 rounded-full bg-fond-inverse" />
                  ) : null}
                  <span className="min-w-0 truncate">{z.nom}</span>
                  {z.genre === "groupe" && <span className="ml-auto shrink-0 rounded-pill bg-fond-teinte-bleue px-1.5 text-ui-3xs font-semibold text-texte-accent">proposé</span>}
                </span>
                <span className="text-ui-2xs leading-[1.35] text-texte-tertiaire">
                  {z.taches.length} tâche{z.taches.length > 1 ? "s" : ""}
                  {z.detail ? ` · ${z.detail}` : ""}
                </span>
              </header>
              {z.taches.map(note)}
              {!z.taches.length && <span className="m-auto text-ui-xs text-texte-tertiaire">{modifiable ? "Glisse une tâche ici" : "Vide"}</span>}
            </section>
          ))}
        </div>
      )}
      {menu.menu && (
        <MenuContextuel x={menu.menu.x} y={menu.menu.y} libelle={`Tâche « ${menu.menu.cible.texte} »`} onFermer={menu.fermer}>
          {(() => {
            const t = menu.menu.cible;
            return (
              <>
                {tacheProposee(t) && (
                  <>
                    <ElementContextuel icone="check-01" onChoisir={() => trancher(t, true)}>
                      La garder
                    </ElementContextuel>
                    <ElementContextuel icone="trash-01" danger onChoisir={() => trancher(t, false)}>
                      La retirer
                    </ElementContextuel>
                  </>
                )}
                {vue === "groupes" &&
                  groupes
                    .filter((g) => g.id !== t.groupe || t.pourElle)
                    .map((g) => (
                      <ElementContextuel key={g.id} icone="layers-01" onChoisir={() => placer(t, g.id)}>
                        Dans « {g.nom} »
                      </ElementContextuel>
                    ))}
                {t.pourElle ? (
                  <ElementContextuel icone="users-profiles-01" onChoisir={() => placer(t, A_CONFIER)}>
                    À confier
                  </ElementContextuel>
                ) : (
                  <ElementContextuel icone="user-profile-01" onChoisir={() => placer(t, ELLE)}>
                    Je la garde pour moi
                  </ElementContextuel>
                )}
              </>
            );
          })()}
        </MenuContextuel>
      )}
    </>
  );
}

function NoteTache({
  t,
  modifiable,
  tenue,
  penchee,
  pleine,
  onTrancher,
  onMenu,
  onKeyDown,
  glisser,
}: {
  t: TacheEquipe;
  modifiable: boolean;
  tenue: { dx: number; dy: number } | null;
  penchee: boolean;
  /** Dans une colonne de groupe : la largeur de la colonne. */
  pleine: boolean;
  onTrancher: (garder: boolean) => void;
  onMenu: (e: EvenementSouris<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  glisser: {
    onPointerDown: (e: EvenementPointeur<HTMLElement>) => void;
    onPointerMove: (e: EvenementPointeur<HTMLElement>) => void;
    onPointerUp: (e: EvenementPointeur<HTMLElement>) => void;
    onPointerCancel: () => void;
  };
}) {
  const proposee = tacheProposee(t);
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`${t.texte}${proposee ? ", proposée par l’assistant" : t.pourElle ? ", tu la gardes" : ""}`}
      data-tache={t.id}
      data-proposee={proposee || undefined}
      data-tenue={tenue ? true : undefined}
      onContextMenu={modifiable ? onMenu : undefined}
      onKeyDown={onKeyDown}
      {...(modifiable ? glisser : {})}
      title={proposee && t.pourquoi ? t.pourquoi : undefined}
      style={{ "--r": `${penchee ? rotation(t.id) : 0}deg`, ...(tenue ? { translate: `${tenue.dx}px ${tenue.dy}px` } : {}) } as CSSProperties}
      className={cn(
        "klyra-note-tache group/note relative flex shrink-0 flex-col gap-1.5 rounded-lg px-3 py-2.5 outline-offset-2 focus-visible:outline-2 focus-visible:outline-bleu-k1-500",
        pleine ? "w-full" : "w-[208px]",
        t.pourElle ? "bg-fond-survol" : proposee ? "bg-white/70" : "bg-fond-surface shadow-ombre-sm",
      )}
    >
      <span className="line-clamp-3 text-ui-s leading-[1.35] text-texte-principal">«&nbsp;{t.texte}&nbsp;»</span>
      {proposee && t.pourquoi && <span className="line-clamp-2 text-ui-2xs leading-[1.35] text-texte-tertiaire">{t.pourquoi}</span>}
      <span className="mt-auto flex min-h-5 items-center gap-1.5 text-ui-3xs text-texte-tertiaire">
        {t.pourElle ? (
          <>
            <span aria-hidden="true" className="size-2.5 rounded-full bg-fond-inverse" />
            <b className="font-semibold">Tu la gardes</b>
          </>
        ) : proposee ? (
          <b className="font-semibold text-texte-accent">Proposée</b>
        ) : (
          <b className="font-semibold">{t.origine === "assistant" ? "Gardée" : "Tu l’as dit"}</b>
        )}
        {proposee && modifiable && (
          <span className="ml-auto flex gap-1">
            <button type="button" onClick={() => onTrancher(true)} className="h-5 cursor-pointer rounded-[5px] border border-bordure-defaut bg-fond-surface px-1.5 text-ui-3xs font-semibold text-texte-accent">
              Garder
            </button>
            <button type="button" onClick={() => onTrancher(false)} className="h-5 cursor-pointer rounded-[5px] border border-bordure-defaut bg-fond-surface px-1.5 text-ui-3xs font-semibold text-texte-secondaire">
              Retirer
            </button>
          </span>
        )}
        {modifiable && (
          <BoutonIcone
            variant="discret"
            taille="mini"
            libelle="Que faire de cette tâche"
            icone={<Icon name="dot-horizontal" size={14} />}
            onClick={onMenu}
            className={cn("size-5 opacity-0 transition-opacity group-hover/note:opacity-100 focus-visible:opacity-100", !(proposee && modifiable) && "ml-auto")}
          />
        )}
      </span>
    </div>
  );
}
