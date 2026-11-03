"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { ChoixTeinte } from "@/components/roles/ChoixTeinte";
import { AgentFormes } from "@/components/team/AgentFormes";
import { fondCarte } from "@/components/team/AgentVisuel";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { Infobulle } from "@/components/ui/Infobulle";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { roleFromContent, useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import {
  corpsFiche,
  descriptionFiche,
  ficheAgent,
  identifiantPropose,
  jetonsBrouillon,
  manques,
  optionsRetenues,
  piliersNouveaux,
  piliersRemplis,
  PILIERS,
  texteDuChoix,
  type EtatAtelier,
  type Pilier,
} from "@/lib/atelier-agent";
import { cn } from "@/lib/cn";
import { eclatDePoints, envoler } from "@/lib/naissance-agent";
import { comparable, nomDejaPris, nomPropre } from "@/lib/noms-agents";
import { SEUIL_FICHE_LONGUE } from "@/lib/poids-fiche";
import { confierAEditeur } from "@/lib/proposition-agent";
import { jouer } from "@/lib/sons/sons";
import { useIdDirect, useWorkspace } from "@/lib/workspace";
import type { MessagePart, RoleTeinte } from "@/types/domain";

/**
 * L'atelier d'un agent dans le fil : la carte qui se complète à chaque réponse (outil
 * `proposer_agent`), et les réponses toutes prêtes sous les questions de l'assistant (outil
 * `proposer_choix`). Règles pures : src/lib/atelier-agent.ts.
 */

/** Les cartes déjà fêtées (son et étoiles qui s'allument) : une seule fois, pendant que l'assistant écrit. */
const FETEES = new Set<string>();

/* ─── Les cinq étoiles et la jauge ─────────────────────────────── */

function Etoiles({ remplis, nouveaux = [], taille = 16 }: { remplis: Set<Pilier>; nouveaux?: Pilier[]; taille?: number }) {
  const libelle = `${remplis.size} pilier${remplis.size > 1 ? "s" : ""} sur 5${remplis.size ? ` : ${PILIERS.filter((p) => remplis.has(p.cle)).map((p) => p.titre.toLowerCase()).join(", ")}` : ""}`;
  return (
    <span role="img" aria-label={libelle} className="flex items-center gap-0.5">
      {PILIERS.map((p, i) => {
        const allume = remplis.has(p.cle);
        return (
          <Infobulle key={p.cle} texte={`${p.titre}${allume ? "" : " : à remplir"}`} cote="haut">
            <span
              aria-hidden="true"
              className={cn("flex", allume ? "text-icone-accent" : "text-bordure-forte", nouveaux.includes(p.cle) && "klyra-etoile-allumee")}
              style={nouveaux.includes(p.cle) ? { animationDelay: `${i * 60}ms` } : undefined}
            >
              <Icon name="stars" size={taille} />
            </span>
          </Infobulle>
        );
      })}
    </span>
  );
}

/** Le poids de la fiche, relue à chaque appel ; le trait marque les 1 500 jetons conseillés. */
function Jauge({ jetons }: { jetons: number }) {
  const lourde = jetons > SEUIL_FICHE_LONGUE;
  const echelle = SEUIL_FICHE_LONGUE / 0.6;
  return (
    <span className="flex w-[112px] flex-col gap-1">
      <span className={cn("klyra-mono text-right text-ui-2xs", lourde ? "text-texte-accent-orange" : "text-texte-secondaire")}>
        ~{jetons.toLocaleString("fr-FR")} jetons
      </span>
      <span
        role="meter"
        aria-label="Poids de la fiche, relue à chaque appel de l’agent"
        aria-valuemin={0}
        aria-valuemax={Math.round(echelle)}
        aria-valuenow={jetons}
        aria-valuetext={`Environ ${jetons.toLocaleString("fr-FR")} jetons${lourde ? ", au-delà des 1 500 conseillés" : ""}`}
        className="relative h-1.5 rounded-pill bg-white/70"
      >
        <span
          className={cn("absolute inset-y-0 left-0 rounded-pill transition-[width] duration-[480ms] ease-sortie", lourde ? "bg-orange-k1-500" : "bg-bleu-k1-500")}
          style={{ width: `${Math.min(jetons / echelle, 1) * 100}%` }}
        />
        <span aria-hidden="true" className="absolute -top-[3px] -bottom-[3px] left-[60%] w-0.5 rounded-pill bg-texte-principal/35" />
      </span>
    </span>
  );
}

/* ─── Un appel plus ancien de la série : une ligne ─────────────── */

function LigneAtelier({ etat }: { etat: EtatAtelier }) {
  const b = etat.apres;
  const id = identifiantPropose(b);
  const teinte = etat.teinte ?? roleFromContent(id, "", {}, null).teinte;
  const nouveaux = piliersNouveaux(etat);
  const nom = nomPropre(b.nom) || "l’agent";
  return (
    <div className="flex min-w-0 items-center gap-2 text-ui-xs text-texte-tertiaire">
      <span aria-hidden="true" className="flex">
        <RondApercu agentId={id} nom={nom} teinte={teinte} taille={20} />
      </span>
      <span className="min-w-0 truncate">
        {nouveaux.length ? `Carte de ${nom} : ${nouveaux.map((p) => PILIERS.find((x) => x.cle === p)!.titre.toLowerCase()).join(", ")}` : `Carte de ${nom} mise à jour`}
      </span>
      <Etoiles remplis={piliersRemplis(b)} taille={12} />
    </div>
  );
}

/* ─── La carte vivante ─────────────────────────────────────────── */

export function CarteAtelier({
  part,
  etat,
  messageId,
  enDirect,
}: {
  part: Extract<MessagePart, { type: "atelier-agent" }>;
  etat: EtatAtelier | undefined;
  messageId: string;
  /** L'assistant est en train d'écrire ce message : les nouvelles étoiles s'allument et sonnent. */
  enDirect: boolean;
}) {
  if (!etat) return null;
  if (!etat.dernier) return <LigneAtelier etat={etat} />;
  return <CarteVivante etapeId={part.etapeId} etat={etat} messageId={messageId} enDirect={enDirect} />;
}

type Creation = { type: "repos" } | { type: "creation" } | { type: "nee" } | { type: "erreur"; message: string };

function CarteVivante({ etapeId, etat, messageId, enDirect }: { etapeId: string; etat: EtatAtelier; messageId: string; enDirect: boolean }) {
  const router = useRouter();
  const { roles, create, identifiantLibre } = useAgents();
  const { marquerAtelier } = useWorkspace();
  const idDirect = useIdDirect();
  const b = etat.apres;
  const visuel = useRef<HTMLDivElement>(null);
  const [retournee, setRetournee] = useState(false);
  const [creation, setCreation] = useState<Creation>({ type: "repos" });

  const idPropose = identifiantPropose(b);
  // Créé ici, ou déjà dans l'équipe sous ce nom (enregistré depuis l'éditeur).
  const dejaLa = roles.find((r) => r.id === idPropose && comparable(r.name) === comparable(b.nom));
  const idCree = etat.cree ?? dejaLa?.id ?? null;
  const agentCree = idCree ? (roles.find((r) => r.id === idCree) ?? null) : null;
  const id = idCree ?? idPropose;
  const teinte: RoleTeinte = agentCree?.teinte ?? etat.teinte ?? roleFromContent(idPropose, "", {}, null).teinte;
  const remplis = piliersRemplis(b);
  // Gardés pour toute la vie de la carte : un nouveau rendu (l'assistant écrit encore) ne coupe pas l'animation.
  const [nouveaux] = useState(() => (enDirect && !FETEES.has(etapeId) ? piliersNouveaux(etat) : []));
  const fiche = ficheAgent(b, id);
  const jetons = jetonsBrouillon(b);
  const manque = manques(b);
  const pris = !idCree && creation.type === "repos" && b.nom ? nomDejaPris(b.nom, roles) : null;
  // Une carte plus ancienne, jamais créée : l'assistant en a ouvert une autre.
  const remplacee = !idCree && !etat.courante && creation.type === "repos";
  const nom = nomPropre(b.nom) || "Nouvel agent";

  /* Un pilier qui s'allume pendant que l'assistant écrit : une fois. */
  useEffect(() => {
    if (!nouveaux.length) return;
    FETEES.add(etapeId);
    jouer("atelier-etoile");
  }, [nouveaux, etapeId]);

  const creer = async () => {
    if (manque.length || pris || creation.type !== "repos") return;
    setCreation({ type: "creation" });
    setRetournee(false);
    const nouvelId = identifiantLibre(idPropose);
    try {
      await create(nouvelId, ficheAgent(b, nouvelId), { tag: b.role, teinte });
      marquerAtelier(messageId, etapeId, { cree: nouvelId });
      setCreation({ type: "nee" });
      jouer("agent-ne");
      annoncer(`Agent créé : ${nom}. Il rejoint ton équipe.`);
      const p = AGENT_PASTELS[teinte];
      if (visuel.current) {
        eclatDePoints(visuel.current, ["#003fe4", "#3365e9", "#99b2f4", "#ccd9fa", "#01a4ff", p.accent, p.haut]);
        await new Promise((r) => setTimeout(r, 900));
        if (visuel.current) await envoler(visuel.current, nouvelId, fondCarte(teinte));
      }
    } catch (e) {
      setCreation({ type: "erreur", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const ajuster = () => {
    confierAEditeur({ id: idPropose, nom: b.nom, role: b.role, description: descriptionFiche(b), consignes: corpsFiche(b) });
    router.push(`/equipe?nouveau=1&proposition=${encodeURIComponent(etapeId)}`);
  };

  const note = remplacee
    ? "Remplacée par une autre carte, plus bas."
    : creation.type === "erreur"
      ? creation.message
      : idCree
        ? agentCree?.file?.path
          ? `Fiche écrite dans ${agentCree.file.path}, active dans Mes agents.`
          : "Actif dans Mes agents."
        : pris
          ? `Tu as déjà un agent qui s’appelle ${pris.name} : demande un autre prénom.`
          : manque.length
            ? `Il lui manque ${manque.join(", ")}.`
            : "Rien n’est écrit sur ton poste avant ce clic.";

  return (
    <div className="flex w-full max-w-[360px] flex-col gap-3">
      <span className="text-ui-xs text-texte-tertiaire">{idCree ? "Dans ton équipe" : "Atelier · nouvel agent"}</span>
      <div className="[perspective:1400px]">
        <div data-retournee={retournee || undefined} className="klyra-carte-3d relative h-[420px]">
          {/* Recto : son visuel, son nom, sa mission, ses piliers et le poids de sa fiche. */}
          <div
            aria-hidden={retournee || undefined}
            className={cn("klyra-face absolute inset-0 flex flex-col overflow-hidden rounded-3xl shadow-ombre-levee", creation.type === "nee" && "klyra-reflet")}
            style={{ backgroundImage: fondCarte(teinte) }}
          >
            <div ref={visuel} className="relative h-[200px] shrink-0 overflow-hidden">
              <AgentFormes
                key={id}
                agentId={id}
                className={cn("klyra-formes-entree absolute top-1/2 left-1/2 aspect-square h-[86%] w-auto -translate-x-1/2 -translate-y-1/2", creation.type === "nee" && "klyra-rassemble")}
              />
              {idCree && (
                <span className="klyra-etoile-allumee absolute top-4 left-4 flex items-center gap-1.5 rounded-sm bg-white/85 px-2 py-1 text-ui-2xs font-semibold text-texte-principal">
                  <Icon name="check-01" size={12} className="text-icone-accent" />
                  Dans ton équipe
                </span>
              )}
            </div>
            <div className="mt-auto flex min-w-0 flex-col gap-2 px-5 pb-5">
              <span className="truncate text-ui-xs" style={{ color: AGENT_PASTELS[teinte].encre }}>
                {b.role || "Son rôle viendra"}
              </span>
              <span className="truncate text-h3 leading-[1] font-semibold tracking-[-0.05em] text-texte-principal">
                {nom}
              </span>
              <p className={cn("m-0 line-clamp-3 text-ui-s leading-[1.45]", b.mission || b.description ? "text-texte-secondaire" : "text-texte-tertiaire")}>
                {b.mission || b.description || "Sa mission s’écrira ici, au fil de la conversation."}
              </p>
              <div className="mt-1 flex items-end justify-between gap-2 border-t border-white/60 pt-3">
                <Etoiles remplis={remplis} nouveaux={nouveaux} />
                <Jauge jetons={jetons} />
              </div>
            </div>
          </div>
          {/* Verso : la fiche telle qu'elle sera écrite. */}
          <div
            aria-hidden={!retournee || undefined}
            className="klyra-face klyra-face-dos absolute inset-0 flex flex-col overflow-hidden rounded-3xl border border-bordure-defaut bg-fond-surface shadow-ombre-levee"
          >
            <div className="flex items-center justify-between gap-2 border-b border-bordure-subtile px-4 py-3 text-ui-xs text-texte-tertiaire">
              <span className="truncate font-medium text-texte-principal">{id}.md</span>
              <span className="klyra-mono shrink-0">~{jetons.toLocaleString("fr-FR")} jetons</span>
            </div>
            <pre tabIndex={retournee ? 0 : -1} className="m-0 min-h-0 flex-1 overflow-auto px-4 py-3 font-sans text-ui-2xs leading-[1.55] break-words whitespace-pre-wrap text-texte-secondaire">
              {fiche}
            </pre>
          </div>
        </div>
      </div>

      {!idCree && !remplacee && creation.type === "repos" && (
        <ChoixTeinte valeur={teinte} onChange={(t) => marquerAtelier(messageId, etapeId, { teinte: t })} libelle={`Couleur de ${nom}`} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {idCree ? (
          <>
            {agentCree && (
              <Bouton variant="sombre" iconeGauche={<Icon name="message-square" size={16} />} onClick={() => router.push(`/chat?id=${encodeURIComponent(idDirect(idCree))}`)}>
                Lui écrire
              </Bouton>
            )}
            <Bouton variant="blanc" onClick={() => router.push(`/equipe?agent=${encodeURIComponent(idCree)}`)}>
              Voir sa fiche
            </Bouton>
          </>
        ) : remplacee ? null : (
          <>
            <Bouton variant="blanc" iconeGauche={<Icon name="align-left" size={16} />} aria-pressed={retournee} onClick={() => setRetournee((r) => !r)}>
              {retournee ? "Retourner la carte" : "Voir sa fiche"}
            </Bouton>
            <Bouton variant="discret" onClick={ajuster} disabled={creation.type !== "repos" || !b.nom}>
              Ajuster dans l’éditeur
            </Bouton>
          </>
        )}
      </div>
      {!idCree && !remplacee && (
        <BoutonPrincipal onClick={() => void creer()} disabled={!!manque.length || !!pris || creation.type !== "repos"} className="self-start">
          {creation.type === "creation" ? "Création…" : "Créer l’agent"}
        </BoutonPrincipal>
      )}
      <p role={creation.type === "erreur" ? "alert" : undefined} className={cn("m-0 text-ui-xs [overflow-wrap:anywhere]", creation.type === "erreur" || pris ? "text-texte-erreur" : "text-texte-tertiaire")}>
        {note}
      </p>
    </div>
  );
}

/* ─── Les réponses toutes prêtes ───────────────────────────────── */

export function ChoixReponses({
  part,
  actif,
  repondu,
  onRepondre,
}: {
  part: Extract<MessagePart, { type: "choix" }>;
  /** Rien n'a encore été répondu, et l'assistant a fini d'écrire. */
  actif: boolean;
  /** Le message de la personne qui a suivi, s'il y en a un. */
  repondu: string | null;
  onRepondre: (texte: string) => void;
}) {
  const [coches, setCoches] = useState<string[]>([]);
  const retenues = repondu !== null ? optionsRetenues(part.options, repondu) : null;
  const figees = !actif || retenues !== null;

  const repondre = (choisies: string[]) => {
    if (figees || !choisies.length) return;
    onRepondre(texteDuChoix(part.options.filter((o) => choisies.includes(o))));
  };

  return (
    <div role="group" aria-label={part.question || "Réponses proposées"} className="flex max-w-[640px] flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {part.options.map((option) => {
          const choisie = retenues ? retenues.has(option) : coches.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={part.multiple || retenues ? choisie : undefined}
              disabled={figees}
              onClick={() => (part.multiple ? setCoches((c) => (c.includes(option) ? c.filter((x) => x !== option) : [...c, option])) : repondre([option]))}
              className={cn(
                "flex min-h-9 cursor-pointer items-center gap-2 rounded-sm border px-3 py-1.5 text-left text-ui-s leading-[1.35] shadow-ombre-xs transition-[border-color,background-color,opacity,transform] duration-[220ms] ease-sortie active:scale-[0.97]",
                choisie ? "border-bleu-k1-500 bg-fond-teinte-bleue text-texte-accent" : "border-bordure-defaut bg-fond-surface text-texte-principal hover:border-bordure-accent-survol",
                figees && "cursor-default shadow-none active:scale-100",
                figees && !choisie && "opacity-45",
              )}
            >
              {part.multiple && (
                <span
                  aria-hidden="true"
                  className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px]", choisie ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte")}
                >
                  {choisie && <Icon name="check-01" size={14} />}
                </span>
              )}
              {option}
            </button>
          );
        })}
      </div>
      {part.multiple && !figees && (
        <div className="flex flex-wrap items-center gap-2">
          <Bouton variant="sombre" disabled={!coches.length} onClick={() => repondre(coches)}>
            Envoyer
          </Bouton>
          <span className="text-ui-xs text-texte-tertiaire">Coche ce qui va ensemble, ou écris ta réponse.</span>
        </div>
      )}
    </div>
  );
}
