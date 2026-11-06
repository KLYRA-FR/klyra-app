"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { AgentRond, RondApercu } from "@/components/roles/AgentRond";
import { ChoixTeinte } from "@/components/roles/ChoixTeinte";
import { AgentFormes } from "@/components/team/AgentFormes";
import { fondCarte } from "@/components/team/AgentVisuel";
import { Bouton } from "@/components/ui/Bouton";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { useAgents } from "@/lib/agents";
import { ficheAgent, jetonsBrouillon, piliersRemplis, PILIERS } from "@/lib/atelier-agent";
import { ligneProposee, tachesDuGroupe, type BrouillonEquipe, type ChoixEquipe, type EtatEquipe } from "@/lib/atelier-equipe";
import { cn } from "@/lib/cn";
import { useIdDirect } from "@/lib/workspace";
import { Jauge } from "../EtoilesAtelier";
import { nomAffiche, type Equipe, type Membre } from "./useEquipe";

/**
 * Le troisième temps de l'atelier d'une équipe : un agent par groupe, posé sur la table. L'agent
 * choisi montre d'où vient chaque ligne de sa fiche (d'après elle, ou proposée par l'assistant, à
 * garder ou retirer), attend le prénom qu'elle choisit, et « Qui s'en charge » relie ses tâches,
 * avec ses mots, à leur responsable.
 */

export function CartesMembres({
  b,
  equipe,
  choisi,
  touches,
  onChoisir,
  petites = false,
}: {
  b: BrouillonEquipe;
  equipe: Equipe;
  choisi: string | null;
  /** Les membres que le dernier appel vient de changer : ils s'allument. */
  touches: Set<string>;
  onChoisir: (cle: string) => void;
  /** Dans le fil : l'éventail, plus serré. */
  petites?: boolean;
}) {
  const n = equipe.liste.length;
  const pourElle = (b.taches ?? []).filter((t) => t.pourElle);
  return (
    <div role="group" aria-label="Les agents de l’équipe" className={cn("flex items-end justify-center", petites ? "-space-x-3" : "gap-6")}>
      {equipe.liste.map((x, i) => {
        const rang = i - (n - 1) / 2;
        const pastel = AGENT_PASTELS[x.teinte];
        const remplis = piliersRemplis(x.fiche);
        const taches = x.m.groupe ? tachesDuGroupe(b, x.m.groupe).length : 0;
        return (
          <button
            key={x.m.cle}
            type="button"
            aria-pressed={!petites && x.m.cle === choisi}
            aria-label={`${nomAffiche(x)}${x.fiche.role ? `, ${x.fiche.role}` : ""}${x.idCree ? ", dans ton équipe" : x.ecarte ? ", laissé de côté" : ""}`}
            data-membre={x.m.cle}
            data-ecarte={x.ecarte || undefined}
            data-touche={touches.has(x.m.cle) || undefined}
            onClick={() => onChoisir(x.m.cle)}
            style={{ "--r": `${rang * (petites ? 6 : 3)}deg`, "--y": `${petites ? Math.abs(rang) * 6 : 0}px`, zIndex: 1 + i } as CSSProperties}
            className={cn(
              "klyra-carte-atelier relative cursor-pointer rounded-2xl border-0 p-0 text-left outline-offset-4 focus-visible:outline-2 focus-visible:outline-bleu-k1-500 aria-pressed:outline-2 aria-pressed:outline-bleu-k1-500",
              petites ? "w-[112px]" : "w-[152px]",
            )}
          >
            <div
              ref={(el) => {
                if (el) equipe.faces.current.set(x.m.cle, el);
                else equipe.faces.current.delete(x.m.cle);
              }}
              className="relative flex aspect-[3/4] flex-col overflow-hidden rounded-2xl shadow-ombre-sm"
              style={{ backgroundImage: fondCarte(x.teinte) }}
            >
              <AgentFormes agentId={x.m.cle} className="klyra-formes-entree mx-auto mt-[10%] aspect-square w-[70%]" />
              <span className="mt-auto flex min-w-0 flex-col gap-0.5 px-3 pb-3">
                <span className={cn("truncate leading-[1.1] font-semibold", petites ? "text-ui-s" : "text-ui", x.nom ? "text-texte-principal" : "font-medium text-texte-tertiaire italic")}>{nomAffiche(x)}</span>
                <span className="truncate text-ui-3xs" style={{ color: pastel.encre }}>
                  {x.fiche.role || "Son rôle viendra"}
                </span>
                <span aria-hidden="true" className="mt-0.5 flex gap-px">
                  {PILIERS.map((p) => (
                    <span key={p.cle} className={cn("flex", remplis.has(p.cle) ? "text-icone-accent" : "text-bordure-forte")}>
                      <Icon name="stars" size={9} />
                    </span>
                  ))}
                </span>
              </span>
              {!petites && taches > 0 && !x.idCree && (
                <span className="absolute top-2 left-2 rounded-pill bg-white/90 px-1.5 py-0.5 text-ui-3xs font-semibold text-texte-secondaire">
                  {taches} tâche{taches > 1 ? "s" : ""}
                </span>
              )}
              {touches.has(x.m.cle) && !x.idCree && (
                <span className="klyra-a-jour absolute top-2 right-2 flex items-center gap-1 rounded-pill bg-white/90 px-1.5 py-0.5 text-ui-3xs font-semibold text-texte-accent shadow-ombre-xs">À jour</span>
              )}
              {x.idCree && (
                <span className="klyra-etoile-allumee absolute top-2 left-2 flex size-5 items-center justify-center rounded-full bg-white/90 text-icone-accent shadow-ombre-xs">
                  <Icon name="check-01" size={12} />
                </span>
              )}
              {x.ecarte && <span className="absolute top-2 left-2 rounded-xs bg-white/90 px-1.5 py-0.5 text-ui-3xs font-medium text-texte-secondaire">De côté</span>}
            </div>
          </button>
        );
      })}
      {!petites && pourElle.length > 0 && (
        <div className="flex aspect-[3/4] w-[152px] flex-col justify-end gap-1 rounded-2xl border-[1.5px] border-bordure-defaut bg-fond-survol/70 p-3">
          <span aria-hidden="true" className="size-7 rounded-full bg-fond-inverse" />
          <span className="text-ui font-semibold text-texte-principal">Toi</span>
          <span className="line-clamp-4 text-ui-3xs leading-[1.35] text-texte-tertiaire">{pourElle.map((t) => t.texte).join(" · ")}</span>
        </div>
      )}
    </div>
  );
}

/* ─── L'agent choisi ───────────────────────────────────────────── */

const LISTES = [
  { cle: "declencheurs", titre: "Quand l’appeler" },
  { cle: "livrables", titre: "Ce qu’il livre" },
  { cle: "limites", titre: "Ses limites" },
  { cle: "verification", titre: "Comment il vérifie" },
  { cle: "methode", titre: "Comment il travaille" },
] as const;

export function DetailMembre({
  x,
  equipe,
  assistant,
  onEnvoyer,
}: {
  x: Membre;
  equipe: Equipe;
  assistant: string;
  onEnvoyer: ((texte: string) => void) | null;
}) {
  const router = useRouter();
  const idDirect = useIdDirect();
  const [fiche, setFiche] = useState(false);
  const [libre, setLibre] = useState("");
  const a = x.m.agent;
  const editable = equipe.modifiable && !x.idCree;
  const choisir = (c: ChoixEquipe) => editable && equipe.choisir(c);
  const nomEcrit = x.nom || "cet agent";
  // « Quand l'appeler » : ce que l'assistant a écrit, sinon les tâches de son groupe (dites ou gardées).
  const lignes = (cle: (typeof LISTES)[number]["cle"]) => (cle === "declencheurs" && !a.declencheurs.length ? x.fiche.declencheurs : a[cle]);
  const prenomLibre = () => {
    const p = libre.trim();
    if (p) choisir({ prenoms: { [x.m.cle]: p } });
  };

  return (
    <div className="klyra-arrivee mx-auto grid w-full max-w-[1000px] grid-cols-[minmax(0,1fr)_248px] gap-8 px-8 pt-7 pb-2 @max-[820px]:grid-cols-1 @max-[820px]:gap-5">
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-3.5">
          <span aria-hidden="true" className="flex">
            <RondApercu agentId={x.m.cle} nom={nomAffiche(x)} teinte={x.teinte} taille={56} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cn("truncate text-h4 leading-[1] font-semibold tracking-[-0.04em]", x.nom ? "text-texte-principal" : "font-medium text-texte-tertiaire")}>{nomAffiche(x)}</span>
            <span className="truncate text-ui-s" style={{ color: AGENT_PASTELS[x.teinte].encre }}>
              {a.role || "Son rôle viendra"}
            </span>
          </span>
        </div>
        {editable && (
          <div className="mt-3.5 flex flex-wrap items-center gap-1.5 text-ui-xs text-texte-secondaire">
            <span>Son prénom :</span>
            {x.m.prenoms.map((p) => (
              <Bouton key={p} variant="blanc" taille="mini" actif={p === x.nom} aria-pressed={p === x.nom} className="aria-pressed:border-bordure-accent-survol aria-pressed:bg-fond-teinte-bleue aria-pressed:text-texte-accent" onClick={() => choisir({ prenoms: { [x.m.cle]: p } })}>
                {p}
              </Bouton>
            ))}
            <input
              aria-label={`Un autre prénom pour ${nomEcrit}`}
              placeholder={x.m.prenoms.length ? "Ou écris le tien" : "Écris son prénom"}
              value={libre}
              onChange={(e) => setLibre(e.target.value)}
              onBlur={prenomLibre}
              onKeyDown={(e) => {
                if (e.key === "Enter") prenomLibre();
              }}
              maxLength={40}
              className="h-7 w-[150px] rounded-xs border border-bordure-champ bg-fond-surface px-2.5 text-ui-xs text-texte-principal outline-none placeholder:text-texte-placeholder focus:border-bordure-champ-survol"
            />
          </div>
        )}
        <p className={cn("m-0 mt-3.5 text-body-s leading-[1.5] tracking-[-0.01em]", a.mission || a.description ? "text-texte-principal" : "text-texte-tertiaire")}>{a.mission || a.description || "Sa mission s’écrira ici."}</p>
        <span className="mt-1 mb-4 text-ui-2xs text-texte-tertiaire">Écrite par {assistant} d’après tes tâches · à corriger en lui parlant</span>
        <div className="grid grid-cols-2 gap-3 @max-[560px]:grid-cols-1">
          {LISTES.map((l) => {
            const items = lignes(l.cle);
            return (
              <section key={l.cle} aria-label={l.titre} className={cn("flex min-w-0 flex-col gap-2 rounded-2xl border border-bordure-subtile bg-fond-surface px-4 py-3.5", l.cle === "methode" && "col-span-2 @max-[560px]:col-span-1")}>
                <span className="flex items-center gap-1.5 text-ui-2xs font-medium text-texte-tertiaire">
                  <span aria-hidden="true" className={cn("flex", items.length ? "text-icone-accent" : "text-bordure-forte")}>
                    <Icon name="stars" size={12} />
                  </span>
                  {l.titre}
                </span>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {items.map((t) =>
                    ligneProposee(x.m, t) ? (
                      <li key={t} data-ligne-proposee className="klyra-ligne-proposee flex min-w-0 items-start gap-2 rounded-sm px-2 py-1.5 text-ui-s leading-[1.45] text-texte-secondaire">
                        <span className="min-w-0 flex-1">{t}</span>
                        {editable && (
                          <span className="flex shrink-0 gap-1">
                            <Bouton variant="blanc" taille="mini" className="h-6 px-2 text-texte-accent" onClick={() => choisir({ lignes: { [x.m.cle]: { [t]: true } } })}>
                              Garder
                            </Bouton>
                            <Bouton variant="blanc" taille="mini" className="h-6 px-2" onClick={() => choisir({ lignes: { [x.m.cle]: { [t]: false } } })}>
                              Retirer
                            </Bouton>
                          </span>
                        )}
                      </li>
                    ) : (
                      <li key={t} className="text-ui-s leading-[1.45] text-texte-principal">
                        {t}
                        <span className="ml-1.5 inline-block rounded-pill bg-fond-survol px-1.5 align-[1px] text-ui-3xs leading-[17px] font-semibold whitespace-nowrap text-texte-tertiaire">d’après toi</span>
                      </li>
                    ),
                  )}
                  {!items.length && <li className="text-ui-s text-texte-tertiaire italic">{assistant} te le demandera</li>}
                </ul>
              </section>
            );
          })}
        </div>
        {fiche && (
          <pre tabIndex={0} className="m-0 mt-3 max-h-[320px] overflow-auto rounded-lg border border-bordure-subtile bg-fond-surface px-3 py-2.5 font-sans text-ui-2xs leading-[1.55] break-words whitespace-pre-wrap text-texte-secondaire">
            {ficheAgent(x.fiche, x.idCree ?? x.m.cle)}
          </pre>
        )}
        {x.pris && <p className="m-0 mt-3 text-ui-xs text-texte-erreur">Tu as déjà un agent qui s’appelle {x.pris.name} : choisis un autre prénom.</p>}
      </div>
      <aside className="flex flex-col gap-5 pt-1">
        {editable && (
          <div className="flex flex-col gap-2">
            <span className="text-ui-2xs font-medium text-texte-tertiaire">Sa couleur</span>
            <ChoixTeinte valeur={x.teinte} onChange={(t) => equipe.teindre(x.m.cle, t)} libelle={`Couleur de ${nomEcrit}`} />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-ui-2xs font-medium text-texte-tertiaire">Avec {nomEcrit}</span>
          {x.idCree ? (
            <>
              {x.agent && (
                <Bouton variant="sombre" iconeGauche={<Icon name="message-square" size={16} />} className="justify-start" onClick={() => router.push(`/chat?id=${encodeURIComponent(idDirect(x.idCree!))}`)}>
                  Lui écrire
                </Bouton>
              )}
              <Bouton variant="blanc" className="justify-start" onClick={() => router.push(`/equipe?agent=${encodeURIComponent(x.idCree!)}`)}>
                Voir sa fiche
              </Bouton>
            </>
          ) : (
            <>
              <Bouton variant="blanc" className="justify-start" iconeGauche={<Icon name="align-left" size={16} />} aria-pressed={fiche} onClick={() => setFiche((f) => !f)}>
                {fiche ? "Masquer sa fiche" : "Voir sa fiche"}
              </Bouton>
              {onEnvoyer && !x.ecarte && (
                <Bouton variant="blanc" className="justify-start" iconeGauche={<Icon name="stars" size={16} />} onClick={() => onEnvoyer(`Affinons ${x.nom || `l’agent « ${a.role || x.m.cle} »`} avant de créer l’équipe.`)}>
                  L’affiner et l’éprouver
                </Bouton>
              )}
              {editable && (
                <Bouton variant="discret" className="justify-start" onClick={() => equipe.ecarter(x.m.cle, !x.ecarte)}>
                  {x.ecarte ? "Le reprendre dans l’équipe" : "Le laisser de côté"}
                </Bouton>
              )}
            </>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Jauge jetons={jetonsBrouillon(x.fiche)} fond="bg-fond-survol" />
          <p className="m-0 text-ui-2xs leading-[1.5] text-texte-tertiaire">Sa fiche, relue à chaque appel. Une ligne en pointillés n’y entre que si tu la gardes.</p>
        </div>
      </aside>
    </div>
  );
}

/* ─── Qui s'en charge ──────────────────────────────────────────── */

/**
 * Ses tâches telles qu'elle les a dites, et qui s'en occupe (ou ses vraies demandes, pour une carte
 * d'avant les tâches). Une fois l'équipe née, une demande se lance d'un clic.
 */
export function QuiSenCharge({ etat, equipe, choisi, confier }: { etat: EtatEquipe; equipe: Equipe; choisi: string | null; confier: ((texte: string) => void) | null }) {
  const { roles } = useAgents();
  const b = etat.apres;
  const taches = (b.taches ?? []).filter((t) => t.origine === "personne" || t.gardee);
  const lignes = taches.length
    ? taches.map((t) => ({ demande: t.texte, membre: t.pourElle ? null : (equipe.liste.find((x) => x.m.groupe && x.m.groupe === t.groupe)?.m.cle ?? null), elle: t.pourElle }))
    : b.exemples.map((e) => ({ demande: e.demande, membre: e.membre, elle: false }));
  if (!lignes.length) return null;
  return (
    <section aria-label="Qui s’en charge" className="mx-auto flex w-full max-w-[1000px] flex-col gap-2 px-8 pt-5 pb-9">
      <span className="text-ui-s font-semibold text-texte-principal">Qui s’en charge</span>
      <span className="text-ui-xs text-texte-tertiaire">{taches.length ? "Tes tâches telles que tu les as dites, et qui s’en occupe." : "Une demande, un responsable : ton assistant confie chaque livrable à un seul agent."}</span>
      <ul className="m-0 mt-1 grid list-none grid-cols-2 gap-2 p-0 @max-[680px]:grid-cols-1">
        {lignes.map((e) => {
          const membre = e.membre ? equipe.liste.find((x) => x.m.cle === e.membre) : undefined;
          const role = !membre && e.membre ? roles.find((r) => r.id === e.membre) : undefined;
          const vise = !!membre && membre.m.cle === choisi;
          return (
            <li
              key={e.demande}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 transition-[border-color,background-color] duration-[220ms] ease-sortie",
                vise ? "border-bordure-accent-survol bg-fond-teinte-bleue" : "border-bordure-subtile bg-fond-surface",
                membre?.ecarte && "opacity-50",
              )}
            >
              <span className="min-w-0 flex-1 text-ui-xs leading-[1.4] text-texte-principal">«&nbsp;{e.demande}&nbsp;»</span>
              <Icon name="chevron-right" size={14} className="shrink-0 text-icone-secondaire" />
              <span className="flex shrink-0 items-center gap-1.5 text-ui-xs font-medium text-texte-principal">
                {e.elle ? (
                  <>
                    <span aria-hidden="true" className="size-5 rounded-full bg-fond-inverse" />
                    Toi
                  </>
                ) : membre ? (
                  <>
                    <RondApercu agentId={membre.m.cle} nom={nomAffiche(membre)} teinte={membre.teinte} taille={20} />
                    {nomAffiche(membre)}
                  </>
                ) : role ? (
                  <>
                    <AgentRond roleId={role.id} taille={20} />
                    {role.name}
                  </>
                ) : (
                  <span className="text-texte-tertiaire">À ranger</span>
                )}
              </span>
              {confier && !e.elle && (membre?.idCree || role) && (
                <Bouton variant="blanc" taille="mini" className="shrink-0" onClick={() => confier(e.demande)}>
                  Lancer
                </Bouton>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
