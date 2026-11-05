"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { AgentRond, RondApercu } from "@/components/roles/AgentRond";
import { ChoixTeinte } from "@/components/roles/ChoixTeinte";
import { AgentFormes } from "@/components/team/AgentFormes";
import { fondCarte } from "@/components/team/AgentVisuel";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { teinteNouvelAgent, useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { ficheAgent, jetonsBrouillon, piliersRemplis, PILIERS, type Pilier } from "@/lib/atelier-agent";
import { bilanEquipe, identifiantsLibres, membresNouveaux, membresVus, type EtatEquipe, type MembreVu } from "@/lib/atelier-equipe";
import { cn } from "@/lib/cn";
import { eclatDePoints, envoler } from "@/lib/naissance-agent";
import { nomPropre } from "@/lib/noms-agents";
import { jouer } from "@/lib/sons/sons";
import { useIdDirect, useRole, useWorkspace } from "@/lib/workspace";
import type { MessagePart, Role, RoleTeinte } from "@/types/domain";
import { Jauge } from "./EtoilesAtelier";

/**
 * L'atelier d'une équipe dans le fil : les agents que l'assistant compose avec la personne, posés en
 * éventail sur une table (ils arrivent un à un pendant qu'il écrit), l'agent choisi en détail, qui
 * serait responsable de ses vraies demandes, puis la naissance de toute l'équipe d'un clic. Règles
 * pures : electron/atelier-equipe.ts et src/lib/atelier-equipe.ts.
 */

type PartEquipe = Extract<MessagePart, { type: "atelier-equipe" }>;

/** Un membre tel que la carte le montre, avec son agent s'il est né. */
type Membre = MembreVu & { agent: Role | null };

const membres = (etat: EtatEquipe, roles: Role[]): Membre[] =>
  membresVus(etat, roles, teinteNouvelAgent).map((x) => ({ ...x, agent: x.idCree ? (roles.find((r) => r.id === x.idCree) ?? null) : null }));

/* ─── Un appel plus ancien de la série : une ligne ─────────────── */

function LigneEquipe({ etat }: { etat: EtatEquipe }) {
  const nouveaux = membresNouveaux(etat);
  const nom = etat.apres.nom || "l’équipe";
  return (
    <div className="flex min-w-0 items-center gap-2 text-ui-xs text-texte-tertiaire">
      <span aria-hidden="true" className="flex -space-x-1.5">
        {(nouveaux.length ? nouveaux : etat.apres.membres).slice(0, 4).map((m) => (
          <RondApercu key={m.cle} agentId={m.cle} nom={m.agent.nom} teinte={etat.teintes[m.cle] ?? teinteNouvelAgent(m.cle)} taille={20} />
        ))}
      </span>
      <span className="min-w-0 truncate">
        {nouveaux.length ? `Équipe ${nom} : ${nouveaux.map((m) => nomPropre(m.agent.nom) || m.cle).join(", ")} arrive${nouveaux.length > 1 ? "nt" : ""}` : `Équipe ${nom} mise à jour`}
      </span>
    </div>
  );
}

/* ─── La carte ─────────────────────────────────────────────────── */

export function CarteEquipe({
  part,
  etat,
  messageId,
  enDirect,
  onEnvoyer,
}: {
  part: PartEquipe;
  etat: EtatEquipe | undefined;
  messageId: string;
  /** L'assistant est en train d'écrire ce message : les nouveaux agents arrivent sur la table. */
  enDirect: boolean;
  /** Un message de la personne à l'assistant (affiner un agent, confier une première demande). */
  onEnvoyer: (texte: string) => void;
}) {
  if (!etat) return null;
  if (!etat.dernier) return <LigneEquipe etat={etat} />;
  return <TableEquipe etapeId={part.etapeId} etat={etat} messageId={messageId} enDirect={enDirect} onEnvoyer={onEnvoyer} />;
}

type Creation = { type: "repos" } | { type: "creation"; faits: number; total: number } | { type: "erreur"; message: string };

function TableEquipe({ etapeId, etat, messageId, enDirect, onEnvoyer }: { etapeId: string; etat: EtatEquipe; messageId: string; enDirect: boolean; onEnvoyer: (texte: string) => void }) {
  const { roles, create, identifiantLibre } = useAgents();
  const { marquerEquipe } = useWorkspace();
  const assistant = useRole("principal");
  const b = etat.apres;
  const liste = membres(etat, roles);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [creation, setCreation] = useState<Creation>({ type: "repos" });
  const faces = useRef(new Map<string, HTMLDivElement>());

  const selection = liste.find((x) => x.m.cle === choisi) ?? liste.at(-1) ?? null;
  const bilan = bilanEquipe(etat, liste);
  const aCreer = bilan.aCreer as Membre[];
  const nes = bilan.nes as Membre[];
  const { nee, jetons } = bilan;
  const remplacee = bilan.remplacee && creation.type === "repos";
  const modifiable = !remplacee && !nee && !etat.provisoire && creation.type === "repos";
  const manque = bilan.manques;
  const nouveaux = new Set(membresNouveaux(etat).map((m) => m.cle));

  /* Un agent qui arrive sur la table pendant que l'assistant écrit : un son, une fois par agent. */
  const entendus = useRef(enDirect ? etat.avant.membres.length : b.membres.length);
  useEffect(() => {
    if (b.membres.length > entendus.current) {
      if (enDirect) jouer("atelier-etoile");
      entendus.current = b.membres.length;
    }
  }, [b.membres.length, enDirect]);

  const ecarter = (cle: string, oui: boolean) =>
    marquerEquipe(messageId, etapeId, (p) => ({ ecartes: oui ? [...new Set([...(p.ecartes ?? etat.ecartes), cle])] : (p.ecartes ?? etat.ecartes).filter((c) => c !== cle) }));

  const creer = async () => {
    if (!modifiable || manque.length || !aCreer.length) return;
    const total = aCreer.length;
    setCreation({ type: "creation", faits: 0, total });
    // Un identifiant libre sur le poste pour chacun, et distinct de ceux que cette équipe prend.
    const ids = identifiantsLibres(aCreer.map((x) => x.m.cle), identifiantLibre);
    const nouveauxNes: { cle: string; id: string; teinte: RoleTeinte }[] = [];
    try {
      for (const [i, x] of aCreer.entries()) {
        const id = ids[i];
        await create(id, ficheAgent(x.m.agent, id), { tag: x.m.agent.role, teinte: x.teinte });
        // Noté à chaque naissance : une erreur plus loin garde ceux qui sont déjà là.
        marquerEquipe(messageId, etapeId, (p) => ({ crees: { ...(p.crees ?? {}), [x.m.cle]: id }, teintes: { ...(p.teintes ?? {}), [x.m.cle]: x.teinte } }));
        nouveauxNes.push({ cle: x.m.cle, id, teinte: x.teinte });
        jouer("atelier-etoile");
        setCreation({ type: "creation", faits: nouveauxNes.length, total });
      }
      setCreation({ type: "repos" });
      jouer("agent-ne");
      annoncer(`Équipe créée : ${aCreer.map((x) => x.nom).join(", ")}. Ils rejoignent ton équipe.`);
      /* Un éclat sous chaque carte, puis chacun s'envole à sa place dans la barre, l'un après l'autre. */
      await Promise.all(
        nouveauxNes.map(async (n, i) => {
          await new Promise((r) => setTimeout(r, i * 160));
          const face = faces.current.get(n.cle);
          if (!face) return;
          const p = AGENT_PASTELS[n.teinte];
          eclatDePoints(face, ["#003fe4", "#3365e9", "#99b2f4", "#ccd9fa", p.accent, p.haut]);
          await new Promise((r) => setTimeout(r, 700));
          if (faces.current.get(n.cle)) await envoler(face, n.id, fondCarte(n.teinte));
        }),
      );
    } catch (e) {
      setCreation({ type: "erreur", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const etiquette = nee
    ? "Ton équipe est née"
    : etat.provisoire
      ? `${assistant.name} compose ton équipe…`
      : remplacee
        ? "Atelier · équipe remplacée"
        : "Atelier · nouvelle équipe";

  const note = remplacee
    ? "Remplacée par une autre équipe, plus bas."
    : creation.type === "erreur"
      ? creation.message
      : nee
        ? `${nes.length} agent${nes.length > 1 ? "s" : ""} actif${nes.length > 1 ? "s" : ""} dans Mes agents, leurs fiches écrites sur ton poste.`
        : manque.length
          ? `Il manque ${manque.join(" ; ")}.`
          : "Rien n’est écrit sur ton poste avant ce clic.";

  return (
    <div data-carte-equipe={etapeId} className="flex w-full max-w-[600px] flex-col gap-3">
      <span className={cn("text-ui-xs text-texte-tertiaire", etat.provisoire && "klyra-respire")}>{etiquette}</span>
      <section
        aria-label={`Équipe ${b.nom || "en préparation"}`}
        className={cn("flex flex-col overflow-hidden rounded-3xl border border-bordure-subtile bg-fond-surface shadow-ombre-levee", remplacee && "opacity-70")}
      >
        <header className="flex min-w-0 items-start justify-between gap-4 px-5 pt-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="truncate text-h3 leading-[1] font-semibold tracking-[-0.05em] text-texte-principal">{b.nom || "Ton équipe"}</span>
            <p className={cn("m-0 text-ui-s leading-[1.45]", b.but ? "text-texte-secondaire" : "text-texte-tertiaire", etat.provisoire && "klyra-curseur-texte")}>
              {b.but || "Ce qu’elle fera pour toi s’écrira ici, au fil de la conversation."}
            </p>
          </div>
          <span className="klyra-mono shrink-0 pt-1 text-ui-2xs text-texte-tertiaire">
            {b.membres.length} agent{b.membres.length > 1 ? "s" : ""}
          </span>
        </header>

        <Tablee liste={liste} selection={selection?.m.cle ?? null} nouveaux={enDirect || etat.provisoire ? nouveaux : new Set()} existants={b.existants.map((e) => e.id)} faces={faces} onChoisir={setChoisi} />

        {selection && <Detail key={selection.m.cle} x={selection} modifiable={modifiable} onTeinte={(t) => marquerEquipe(messageId, etapeId, (p) => ({ teintes: { ...(p.teintes ?? {}), [selection.m.cle]: t } }))} onEcarter={(oui) => ecarter(selection.m.cle, oui)} onAffiner={etat.courante && !selection.idCree && !etat.provisoire && creation.type === "repos" ? () => onEnvoyer(`Affinons ${selection.nom} avant de créer l’équipe.`) : null} />}

        {b.exemples.length > 0 && <QuiSenCharge etat={etat} liste={liste} selection={selection?.m.cle ?? null} confier={nee && etat.courante ? onEnvoyer : null} />}

        {!remplacee && (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-bordure-subtile bg-fond-surface-grise/60 px-5 py-4">
            {nee ? (
              <EtEnsuite nes={nes} />
            ) : (
              <>
                <span className="text-ui-xs text-texte-secondaire">
                  {aCreer.length} agent{aCreer.length > 1 ? "s" : ""} à créer · <span className="klyra-mono">~{jetons.toLocaleString("fr-FR")} jetons</span> de fiches
                </span>
                <BoutonPrincipal onClick={() => void creer()} disabled={!modifiable || !!manque.length || !aCreer.length}>
                  {creation.type === "creation" ? `Création… ${creation.faits}/${creation.total}` : nes.length ? `Créer les ${aCreer.length} autres` : aCreer.length > 1 ? `Créer l’équipe` : "Créer l’agent"}
                </BoutonPrincipal>
              </>
            )}
          </footer>
        )}
      </section>
      <p role={creation.type === "erreur" ? "alert" : undefined} className={cn("m-0 text-ui-xs [overflow-wrap:anywhere]", creation.type === "erreur" ? "text-texte-erreur" : "text-texte-tertiaire")}>
        {note}
      </p>
    </div>
  );
}

/* ─── La table : les agents en éventail ────────────────────────── */

function Tablee({
  liste,
  selection,
  nouveaux,
  existants,
  faces,
  onChoisir,
}: {
  liste: Membre[];
  selection: string | null;
  /** Les agents qui viennent d'arriver : ils sont distribués sur la table. */
  nouveaux: Set<string>;
  existants: string[];
  faces: RefObject<Map<string, HTMLDivElement>>;
  onChoisir: (cle: string) => void;
}) {
  const n = liste.length;
  // Plus il y a d'agents, plus l'éventail se resserre.
  const angle = n > 1 ? Math.min(7, 26 / (n - 1)) : 0;
  return (
    <div className="klyra-tablee relative mt-4 h-[248px] border-y border-bordure-subtile">
      {existants.length > 0 && (
        <div className="absolute top-3 left-4 z-20 flex items-center gap-1.5 rounded-sm bg-fond-surface/90 px-2 py-1 text-ui-2xs text-texte-secondaire shadow-ombre-xs">
          <span className="flex -space-x-1">
            {existants.slice(0, 4).map((id) => (
              <AgentRond key={id} roleId={id} taille={18} />
            ))}
          </span>
          déjà dans ton équipe
        </div>
      )}
      {!n && (
        <div className="absolute inset-0 flex items-center justify-center text-ui-s text-texte-tertiaire">
          <span className="klyra-respire">Les agents arriveront ici.</span>
        </div>
      )}
      <div role="group" aria-label="Les agents de l’équipe" className="absolute inset-x-0 bottom-6 h-0">
        {liste.map((x, i) => {
          const rang = i - (n - 1) / 2;
          const style = { "--i": rang, "--angle": `${angle}deg`, "--arc": Math.round(rang * rang * 5), zIndex: 1 + i } as CSSProperties;
          const remplis = piliersRemplis(x.m.agent);
          const pastel = AGENT_PASTELS[x.teinte];
          return (
            <button
              key={x.m.cle}
              type="button"
              aria-pressed={x.m.cle === selection}
              aria-label={`${x.nom}${x.m.agent.role ? `, ${x.m.agent.role}` : ""}${x.idCree ? ", dans ton équipe" : x.ecarte ? ", laissé de côté" : ""}`}
              data-ecarte={x.ecarte || undefined}
              data-membre={x.m.cle}
              onClick={() => onChoisir(x.m.cle)}
              style={style}
              className={cn(
                "klyra-carte-membre absolute bottom-0 left-1/2 cursor-pointer rounded-2xl p-0 text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-bleu-k1-500 aria-pressed:outline-2 aria-pressed:outline-bleu-k1-500",
                nouveaux.has(x.m.cle) && "klyra-carte-distribuee",
              )}
            >
              <div
                ref={(el) => {
                  if (el) faces.current.set(x.m.cle, el);
                  else faces.current.delete(x.m.cle);
                }}
                className="relative flex aspect-[3/4] flex-col overflow-hidden rounded-2xl shadow-ombre-sm"
                style={{ backgroundImage: fondCarte(x.teinte) }}
              >
                <AgentFormes agentId={x.m.cle} className="klyra-formes-entree mx-auto mt-[8%] aspect-square w-[78%]" />
                <span className="mt-auto flex min-w-0 flex-col gap-0.5 px-2.5 pb-2.5">
                  <span className="truncate text-ui-s leading-[1.1] font-semibold text-texte-principal">{x.nom}</span>
                  <span className="truncate text-ui-3xs" style={{ color: pastel.encre }}>
                    {x.m.agent.role || "Son rôle viendra"}
                  </span>
                  <span aria-hidden="true" className="mt-0.5 flex gap-px">
                    {PILIERS.map((p) => (
                      <span key={p.cle} className={cn("flex", remplis.has(p.cle) ? "text-icone-accent" : "text-bordure-forte")}>
                        <Icon name="stars" size={9} />
                      </span>
                    ))}
                  </span>
                </span>
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
      </div>
    </div>
  );
}

/* ─── L'agent choisi ───────────────────────────────────────────── */

const LISTES: { cle: Exclude<Pilier, "mission">; titre: string }[] = [
  { cle: "declencheurs", titre: "Quand l’appeler" },
  { cle: "livrables", titre: "Ce qu’il livre" },
  { cle: "limites", titre: "Ses limites" },
  { cle: "verification", titre: "Comment il vérifie" },
];

function Detail({
  x,
  modifiable,
  onTeinte,
  onEcarter,
  onAffiner,
}: {
  x: Membre;
  modifiable: boolean;
  onTeinte: (t: RoleTeinte) => void;
  onEcarter: (oui: boolean) => void;
  onAffiner: (() => void) | null;
}) {
  const router = useRouter();
  const idDirect = useIdDirect();
  const [fiche, setFiche] = useState(false);
  const a = x.m.agent;
  const id = x.idCree ?? x.m.cle;
  const editable = modifiable && !x.idCree;
  return (
    <div className="klyra-arrivee flex flex-col gap-3 px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="flex">
          <RondApercu agentId={x.m.cle} nom={x.nom} teinte={x.teinte} taille={40} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-semibold text-texte-principal">{x.nom}</span>
          <span className="truncate text-ui-xs" style={{ color: AGENT_PASTELS[x.teinte].encre }}>
            {a.role || "Son rôle viendra"}
          </span>
        </span>
        <Jauge jetons={jetonsBrouillon(a)} fond="bg-fond-survol" />
      </div>
      <p className={cn("m-0 text-ui-s leading-[1.45]", a.mission || a.description ? "text-texte-secondaire" : "text-texte-tertiaire")}>
        {a.mission || a.description || "Sa mission s’écrira ici."}
      </p>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 max-[560px]:grid-cols-1">
        {LISTES.map((l) => {
          const items = a[l.cle];
          return (
            <div key={l.cle} className="flex min-w-0 flex-col gap-1">
              <dt className="flex items-center gap-1 text-ui-2xs font-medium text-texte-tertiaire">
                <span aria-hidden="true" className={cn("flex", items.length ? "text-icone-accent" : "text-bordure-forte")}>
                  <Icon name="stars" size={11} />
                </span>
                {l.titre}
              </dt>
              <dd className="m-0 text-ui-xs leading-[1.45] text-texte-secondaire">
                {items.length ? (
                  <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                    {items.slice(0, 3).map((t) => (
                      <li key={t} className="line-clamp-2">
                        {t}
                      </li>
                    ))}
                    {items.length > 3 && <li className="text-texte-tertiaire">et {items.length - 3} de plus</li>}
                  </ul>
                ) : (
                  <span className="text-texte-tertiaire">À préciser</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {fiche && (
        <pre tabIndex={0} className="m-0 max-h-[260px] overflow-auto rounded-lg border border-bordure-subtile bg-fond-page px-3 py-2.5 font-sans text-ui-2xs leading-[1.55] break-words whitespace-pre-wrap text-texte-secondaire">
          {ficheAgent(a, id)}
        </pre>
      )}
      {editable && <ChoixTeinte valeur={x.teinte} onChange={onTeinte} libelle={`Couleur de ${x.nom}`} />}
      <div className="flex flex-wrap items-center gap-2">
        {x.idCree ? (
          <>
            {x.agent && (
              <Bouton variant="sombre" taille="mini" iconeGauche={<Icon name="message-square" size={14} />} onClick={() => router.push(`/chat?id=${encodeURIComponent(idDirect(x.idCree!))}`)}>
                Lui écrire
              </Bouton>
            )}
            <Bouton variant="blanc" taille="mini" onClick={() => router.push(`/equipe?agent=${encodeURIComponent(x.idCree!)}`)}>
              Voir sa fiche
            </Bouton>
          </>
        ) : (
          <>
            <Bouton variant="blanc" taille="mini" iconeGauche={<Icon name="align-left" size={14} />} aria-pressed={fiche} onClick={() => setFiche((f) => !f)}>
              {fiche ? "Masquer sa fiche" : "Voir sa fiche"}
            </Bouton>
            {editable && (
              <Bouton variant="discret" taille="mini" onClick={() => onEcarter(!x.ecarte)}>
                {x.ecarte ? "Le reprendre dans l’équipe" : "Le laisser de côté"}
              </Bouton>
            )}
            {onAffiner && !x.ecarte && (
              <Bouton variant="discret" taille="mini" iconeGauche={<Icon name="stars" size={14} />} onClick={onAffiner}>
                L’affiner et l’éprouver
              </Bouton>
            )}
          </>
        )}
      </div>
      {x.pris && <p className="m-0 text-ui-xs text-texte-erreur">Tu as déjà un agent qui s’appelle {x.pris.name} : demande un autre prénom.</p>}
    </div>
  );
}

/* ─── Qui s'en charge ──────────────────────────────────────────── */

/** Ses vraies demandes, et l'agent qui en serait seul responsable ; une fois l'équipe née, on peut les lui confier. */
function QuiSenCharge({ etat, liste, selection, confier }: { etat: EtatEquipe; liste: Membre[]; selection: string | null; confier: ((texte: string) => void) | null }) {
  const { roles } = useAgents();
  return (
    <section aria-label="Qui s’en charge" className="flex flex-col gap-2 border-t border-bordure-subtile px-5 py-4">
      <span className="text-ui-s font-semibold text-texte-principal">Qui s’en charge</span>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {etat.apres.exemples.map((e) => {
          const membre = liste.find((x) => x.m.cle === e.membre);
          const role = membre ? null : roles.find((r) => r.id === e.membre);
          const nom = membre?.nom ?? role?.name ?? e.membre;
          const vise = membre && membre.m.cle === selection;
          return (
            <li
              key={`${e.demande}-${e.membre}`}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 transition-[border-color,background-color] duration-[220ms] ease-sortie",
                vise ? "border-bordure-accent-survol bg-fond-teinte-bleue" : "border-bordure-subtile",
                membre?.ecarte && "opacity-50",
              )}
            >
              <span className="min-w-0 flex-1 text-ui-xs leading-[1.4] text-texte-principal">« {e.demande} »</span>
              <Icon name="chevron-right" size={14} className="shrink-0 text-icone-secondaire" />
              <span className="flex shrink-0 items-center gap-1.5 text-ui-xs font-medium text-texte-principal">
                {membre ? <RondApercu agentId={membre.m.cle} nom={membre.nom} teinte={membre.teinte} taille={20} /> : <AgentRond roleId={e.membre} taille={20} />}
                {nom}
              </span>
              {confier && (membre?.idCree || role) && (
                <Bouton variant="blanc" taille="mini" className="shrink-0" onClick={() => confier(e.demande)}>
                  Lancer
                </Bouton>
              )}
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-ui-2xs leading-[1.45] text-texte-tertiaire">
        {confier ? "« Lancer » envoie la demande à ton assistant, qui la confie à son responsable." : "Une demande, un responsable : ton assistant confie chaque livrable à un seul agent."}
      </p>
    </section>
  );
}

/* ─── Et ensuite ───────────────────────────────────────────────── */

function EtEnsuite({ nes }: { nes: Membre[] }) {
  const router = useRouter();
  return (
    <>
      <span className="flex min-w-0 items-center gap-2 text-ui-xs text-texte-secondaire">
        <span aria-hidden="true" className="flex -space-x-1.5">
          {nes.slice(0, 5).map((x) => (
            <AgentRond key={x.idCree} roleId={x.idCree!} taille={22} />
          ))}
        </span>
        Dans ton équipe
      </span>
      <Bouton variant="blanc" iconeGauche={<Icon name="users-profiles-01" size={16} />} onClick={() => router.push("/equipe")}>
        Voir Mes agents
      </Bouton>
    </>
  );
}
