"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ModalePartager } from "@/components/bibliotheque/ModalePartager";
import { Icon } from "@/components/icons/Icon";
import { AgentRond, RondApercu } from "@/components/roles/AgentRond";
import { ChoixTeinte } from "@/components/roles/ChoixTeinte";
import { AgentFormes } from "@/components/team/AgentFormes";
import { fondCarte } from "@/components/team/AgentVisuel";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { useConfirmation } from "@/components/ui/Modale";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { teinteNouvelAgent, useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import {
  appliquerAjouts,
  casEpreuve,
  corpsFiche,
  descriptionFiche,
  ficheAgent,
  identifiantPropose,
  jetonsBrouillon,
  manques,
  optionsRetenues,
  piliersEnAlerte,
  piliersNouveaux,
  piliersRemplis,
  PILIERS,
  routineProposee,
  texteDuChoix,
  type EtatAtelier,
  type Pilier,
} from "@/lib/atelier-agent";
import { useBibliotheque } from "@/lib/bibliotheque";
import { Etoiles, Jauge } from "./EtoilesAtelier";
import { jouerEpreuve } from "@/lib/epreuve-atelier";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { useCompte } from "@/lib/compte";
import { eclatDePoints, envoler } from "@/lib/naissance-agent";
import { comparable, nomDejaPris, nomPropre } from "@/lib/noms-agents";
import { confierAEditeur } from "@/lib/proposition-agent";
import { CLE_BROUILLON_ROUTINE, libellePlanning } from "@/lib/routines-affichage";
import { jouer } from "@/lib/sons/sons";
import { useIdDirect, useWorkspace } from "@/lib/workspace";
import type { AjoutFiche, BrouillonAgent, MessagePart, RoleTeinte } from "@/types/domain";
import { empreinteFiche, LIBELLES_CAS, type ResultatCas } from "../../../electron/epreuve";

/**
 * L'atelier d'un agent dans le fil : la carte qui se complète à chaque réponse (outil
 * `proposer_agent`, et pendant que l'assistant l'écrit), son épreuve sur trois demandes, sa
 * naissance, puis ce qu'on peut lui confier ; les réponses toutes prêtes sous les questions de
 * l'assistant (outil `proposer_choix`) ; la barre de l'atelier en haut du fil. Règles pures :
 * src/lib/atelier-agent.ts et electron/epreuve.ts.
 */

const MODELES: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };
const teinteParDefaut = teinteNouvelAgent;

/* ─── Un appel plus ancien de la série : une ligne ─────────────── */

function LigneAtelier({ etat }: { etat: EtatAtelier }) {
  const b = etat.apres;
  const id = identifiantPropose(b);
  const teinte = etat.teinte ?? teinteParDefaut(id);
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
  chatId,
  lieu,
  enDirect,
}: {
  part: Extract<MessagePart, { type: "atelier-agent" }>;
  etat: EtatAtelier | undefined;
  messageId: string;
  /** La conversation et sa machine : sur un VPS, l'épreuve tourne là-bas. */
  chatId: string;
  lieu: string | null;
  /** L'assistant est en train d'écrire ce message : les nouvelles étoiles s'allument et sonnent. */
  enDirect: boolean;
}) {
  if (!etat) return null;
  if (!etat.dernier) return <LigneAtelier etat={etat} />;
  return <CarteVivante etapeId={part.etapeId} etat={etat} messageId={messageId} chatId={chatId} lieu={lieu} enDirect={enDirect} />;
}

type Creation = { type: "repos" } | { type: "creation" } | { type: "nee" } | { type: "erreur"; message: string };

function CarteVivante({
  etapeId,
  etat,
  messageId,
  chatId,
  lieu,
  enDirect,
}: {
  etapeId: string;
  etat: EtatAtelier;
  messageId: string;
  chatId: string;
  lieu: string | null;
  enDirect: boolean;
}) {
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
  const teinte: RoleTeinte = agentCree?.teinte ?? etat.teinte ?? teinteParDefaut(idPropose);
  const remplis = piliersRemplis(b);
  // Ce que cet appel allume, pendant que l'assistant écrit (les autres étoiles l'étaient déjà).
  const avant = piliersRemplis(etat.avant);
  const animer = new Set(enDirect ? [...remplis].filter((p) => !avant.has(p)) : []);
  const alerte = idCree ? new Set<Pilier>() : piliersEnAlerte(etat.resultats, etat.ajouts);
  const fiche = ficheAgent(b, id);
  const jetons = jetonsBrouillon(b);
  const manque = manques(b);
  const pris = !idCree && creation.type === "repos" && b.nom ? nomDejaPris(b.nom, roles) : null;
  // Une carte plus ancienne, jamais créée : l'assistant en a ouvert une autre.
  const remplacee = !idCree && !etat.courante && creation.type === "repos";
  const nom = nomPropre(b.nom) || "Nouvel agent";

  /* Un pilier qui s'allume pendant que l'assistant écrit : un son, une fois par pilier et par carte. */
  const entendus = useRef(enDirect ? avant.size : remplis.size);
  useEffect(() => {
    if (remplis.size > entendus.current) {
      if (enDirect) jouer("atelier-etoile");
      entendus.current = remplis.size;
    }
  }, [remplis.size, enDirect]);

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
    <div data-carte-atelier={etapeId} className="flex w-full max-w-[360px] flex-col gap-3">
      <span className={cn("text-ui-xs text-texte-tertiaire", etat.provisoire && "klyra-respire")}>
        {idCree ? "Dans ton équipe" : etat.provisoire ? "L’assistant écrit sa carte…" : "Atelier · nouvel agent"}
      </span>
      {!idCree && !remplacee && <Voisins voisins={b.voisins} />}
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
              <span className="truncate text-h3 leading-[1] font-semibold tracking-[-0.05em] text-texte-principal">{nom}</span>
              <p className={cn("m-0 line-clamp-3 text-ui-s leading-[1.45]", b.mission || b.description ? "text-texte-secondaire" : "text-texte-tertiaire", etat.provisoire && "klyra-curseur-texte")}>
                {b.mission || b.description || "Sa mission s’écrira ici, au fil de la conversation."}
              </p>
              <div className="mt-1 flex items-end justify-between gap-2 border-t border-white/60 pt-3">
                <Etoiles remplis={remplis} animer={animer} alerte={alerte} />
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

      {!remplacee && !etat.provisoire && (
        <Epreuve
          b={b}
          id={id}
          nom={nom}
          teinte={teinte}
          etat={etat}
          messageId={messageId}
          etapeId={etapeId}
          chatId={chatId}
          lieu={lieu}
          lectureSeule={!!idCree || creation.type !== "repos"}
        />
      )}

      {!idCree && !remplacee && (
        <BoutonPrincipal onClick={() => void creer()} disabled={!!manque.length || !!pris || creation.type !== "repos" || etat.provisoire} className="self-start">
          {creation.type === "creation" ? "Création…" : "Créer l’agent"}
        </BoutonPrincipal>
      )}
      <p role={creation.type === "erreur" ? "alert" : undefined} className={cn("m-0 text-ui-xs [overflow-wrap:anywhere]", creation.type === "erreur" || pris ? "text-texte-erreur" : "text-texte-tertiaire")}>
        {note}
      </p>
      {idCree && agentCree && <Suites b={b} idCree={idCree} />}
    </div>
  );
}

/* ─── Ses voisins dans l'équipe ────────────────────────────────── */

/** Les agents actifs qui font déjà une partie de ce travail : on le voit avant de créer un doublon. */
function Voisins({ voisins }: { voisins: BrouillonAgent["voisins"] }) {
  const { roles } = useAgents();
  const presents = voisins.map((v) => ({ ...v, role: roles.find((r) => r.id === v.id) })).filter((v) => v.role);
  if (!presents.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {presents.map((v) => (
        <li key={v.id} className="flex items-start gap-2 text-ui-xs leading-[1.45] text-texte-secondaire">
          <AgentRond roleId={v.id} taille={20} />
          <span>
            <strong className="font-semibold text-texte-principal">{v.role!.name}</strong> fait déjà une partie de ce travail : {v.raison}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ─── L'épreuve ────────────────────────────────────────────────── */

/**
 * Trois demandes proposées par l'assistant, jouées pour de vrai par la fiche (sans outil, sans rien
 * écrire), puis jugées par un tour de Haiku. Un essai raté propose la phrase qui manque à la fiche :
 * l'ajouter rejoue cet essai. Les résultats restent sur la carte (cf. electron/epreuve.ts).
 */
function Epreuve({
  b,
  id,
  nom,
  teinte,
  etat,
  messageId,
  etapeId,
  chatId,
  lieu,
  lectureSeule,
}: {
  b: BrouillonAgent;
  id: string;
  nom: string;
  teinte: RoleTeinte;
  etat: EtatAtelier;
  messageId: string;
  etapeId: string;
  chatId: string;
  lieu: string | null;
  lectureSeule: boolean;
}) {
  const { marquerAtelier } = useWorkspace();
  const [lues, setLues] = useState<string[]>([]);
  const [indisponible, setIndisponible] = useState<string | null>(null);
  // Les essais qui tournent sont notés sur la carte : lancés d'ici ou du téléphone, les deux le voient.
  const enCours: string[] = etat.essais;
  const cas = casEpreuve(b);
  if (!cas) return null;
  const empreinte = empreinteFiche(ficheAgent(b, id));
  const resultatDe = (type: string) => etat.resultats?.find((r) => r.type === type) ?? null;
  const resultats = cas.map((c) => resultatDe(c.type));
  const joues = resultats.filter((r): r is ResultatCas => !!r);
  const reussis = joues.filter((r) => r.verdict === "ok").length;
  const jetons = joues.reduce((t, r) => t + r.jetons, 0);
  const anciens = joues.filter((r) => r.empreinte !== empreinte).length;
  const modele = MODELES[b.modele || "opus"];
  if (lectureSeule && !joues.length) return null;

  const lancer = async (types: string[], brouillon: BrouillonAgent = b, ajouts: AjoutFiche[] = etat.ajouts) => {
    const essayer = getBridge()?.claude.essayer;
    if (!essayer) {
      setIndisponible("L’épreuve se lance dans l’app de bureau, avec Claude Code.");
      return;
    }
    setIndisponible(null);
    await jouerEpreuve(
      essayer,
      marquerAtelier,
      { b: brouillon, id, cas: cas.filter((c) => types.includes(c.type) && !enCours.includes(c.type)), ajouts, lieu, conversation: chatId, messageId, etapeId, depart: etat.resultats ?? [] },
      (resultat) => jouer(resultat.verdict === "ok" ? "validation" : "desactive"),
    );
  };

  const corriger = (correction: AjoutFiche, type: string) => {
    marquerAtelier(messageId, etapeId, (part) => ({ ajouts: [...(part.ajouts ?? []), correction] }));
    annoncer(`Ajouté à la fiche de ${nom} : ${correction.texte}`);
    void lancer([type], appliquerAjouts(b, [correction]), [...etat.ajouts, correction]);
  };

  return (
    <section aria-label={`Épreuve de ${nom}`} className="flex flex-col gap-2 rounded-xl border border-bordure-defaut bg-fond-surface p-3 shadow-ombre-xs">
      <header className="flex items-baseline justify-between gap-2">
        <span className="text-ui-s font-semibold text-texte-principal">L’épreuve</span>
        <span aria-live="polite" className="klyra-mono text-ui-2xs text-texte-tertiaire">
          {enCours.length ? `${3 - enCours.length} / 3 joués` : joues.length ? `${reussis} / 3 réussi${reussis > 1 ? "s" : ""}` : `avec ${modele}`}
        </span>
      </header>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {cas.map((c, i) => {
          const r = resultats[i];
          const joue = enCours.includes(c.type);
          const ajoutee = !!r?.correction && etat.ajouts.some((a) => comparable(a.texte) === comparable(r.correction!.texte));
          const longue = (r?.reponse.length ?? 0) > 280;
          const lue = lues.includes(c.type);
          return (
            <li
              key={c.type}
              data-cas={c.type}
              data-verdict={joue ? "en-cours" : (r?.verdict ?? (r ? "aucun" : "attente"))}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border p-2.5 transition-[border-color,box-shadow] duration-[220ms] ease-sortie",
                joue ? "border-bordure-accent-survol shadow-ombre-levee" : r?.verdict === "ko" ? "border-orange-k1-500/40" : "border-bordure-subtile",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-ui-2xs text-texte-tertiaire">{LIBELLES_CAS[c.type]}</span>
                {!joue && r?.verdict === "ok" && (
                  <span className="klyra-etoile-allumee flex items-center gap-1 rounded-sm bg-fond-teinte-bleue px-1.5 py-0.5 text-ui-2xs font-medium text-texte-accent">
                    <Icon name="check-01" size={12} />
                    Réussi
                  </span>
                )}
                {!joue && r?.verdict === "ko" && (
                  <span className="klyra-etoile-allumee rounded-sm bg-fond-tag-orange px-1.5 py-0.5 text-ui-2xs font-medium text-texte-accent-orange">{ajoutee ? "Corrigé, à rejouer" : "À corriger"}</span>
                )}
              </div>
              <p className="m-0 text-ui-s leading-[1.4] text-texte-principal">« {c.demande} »</p>
              {joue ? (
                <span aria-label={`${nom} répond…`} className="klyra-chargement mt-1 h-2.5 w-3/4 rounded-xs" />
              ) : r?.erreur ? (
                <p className="m-0 text-ui-xs text-texte-erreur [overflow-wrap:anywhere]">{r.erreur}</p>
              ) : r ? (
                <div className="flex items-start gap-2">
                  <span aria-hidden="true" className="flex pt-0.5">
                    <RondApercu agentId={id} nom={nom} teinte={teinte} taille={20} />
                  </span>
                  <div className="flex min-w-0 flex-col items-start gap-1">
                    <p className={cn("m-0 text-ui-s leading-[1.45] whitespace-pre-wrap text-texte-secondaire [overflow-wrap:anywhere]", longue && !lue && "line-clamp-5")}>{r.reponse}</p>
                    {longue && (
                      <Bouton variant="discret" taille="mini" onClick={() => setLues((l) => (lue ? l.filter((x) => x !== c.type) : [...l, c.type]))}>
                        {lue ? "Replier" : "Lire toute la réponse"}
                      </Bouton>
                    )}
                  </div>
                </div>
              ) : null}
              {!joue && r?.raison && <p className="m-0 text-ui-xs leading-[1.45] text-texte-tertiaire">{r.raison}</p>}
              {!joue && r?.empreinte && r.empreinte !== empreinte && <p className="m-0 text-ui-2xs text-texte-tertiaire">Joué sur une version précédente de la fiche.</p>}
              {!joue && !lectureSeule && r?.verdict === "ko" && r.correction && !ajoutee && (
                <div className="flex flex-col gap-2 rounded-md bg-fond-teinte-bleue px-2.5 py-2">
                  <span className="text-ui-xs leading-[1.45] text-texte-accent">
                    <span aria-hidden="true" className="mr-1 font-semibold">+</span>
                    {r.correction.texte}
                  </span>
                  <Bouton variant="sombre" taille="mini" className="self-start" onClick={() => corriger(r.correction!, c.type)}>
                    Ajouter à sa fiche et rejouer
                  </Bouton>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!lectureSeule && (
        <div className="flex flex-wrap items-center gap-2">
          {!joues.length ? (
            <Bouton variant="sombre" iconeGauche={<Icon name="shield-check" size={16} />} disabled={!!enCours.length || !!manques(b).length} onClick={() => void lancer(cas.map((c) => c.type))}>
              {enCours.length ? "Épreuve en cours…" : "Lancer l’épreuve"}
            </Bouton>
          ) : (
            (anciens > 0 || reussis < 3) && (
              <Bouton variant="blanc" taille="mini" disabled={!!enCours.length} onClick={() => void lancer(cas.map((c) => c.type))}>
                Rejouer l’épreuve
              </Bouton>
            )
          )}
        </div>
      )}
      <p className="m-0 text-ui-2xs leading-[1.45] text-texte-tertiaire">
        {indisponible ??
          (joues.length
            ? `${joues.length} essai${joues.length > 1 ? "s" : ""} et leur avis : ${jetons.toLocaleString("fr-FR")} jetons, ${lieu ? "sur le compte Claude du VPS" : "sur ton compte Claude"}.`
            : `Trois vrais essais de ${nom} avec ${modele}${lieu ? " sur le VPS" : ""}, sans outil et sans rien écrire, puis un avis rapide sur chacun. ${lieu ? "Sur le compte Claude du VPS." : "Sur ton compte Claude."}`)}
      </p>
    </section>
  );
}

/* ─── Et ensuite ───────────────────────────────────────────────── */

/** Une fois né : la routine proposée par l'assistant (à relire dans Automatisations), le partage avec l'équipe. */
function Suites({ b, idCree }: { b: BrouillonAgent; idCree: string }) {
  const router = useRouter();
  const { tous } = useAgents();
  const compte = useCompte();
  const bibliotheque = useBibliotheque();
  const [demander, fenetre] = useConfirmation();
  const [partage, setPartage] = useState(false);
  const local = tous.find((a) => a.role.id === idCree) ?? null;
  const routine = routineProposee(b, idCree, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const raisonPartage =
    compte.etat === "indisponible" || compte.etat === "deconnecte" || compte.etat === "chargement"
      ? "Connecte-toi à ton compte d’équipe pour le partager."
      : compte.etat === "retire"
        ? "Ce compte ne fait plus partie de l’équipe."
        : bibliotheque.etat === "hors-ligne"
          ? "Hors ligne : partage-le plus tard depuis sa fiche."
          : null;

  const confierRoutine = async () => {
    if (!routine) return;
    let existant: string | null = null;
    try {
      existant = localStorage.getItem(CLE_BROUILLON_ROUTINE);
    } catch {
      /* sans stockage : pas de brouillon à remplacer */
    }
    if (
      existant &&
      !(await demander({
        titre: "Remplacer le brouillon de routine ?",
        texte: "Une routine non enregistrée attend dans Automatisations. Celle-ci prendra sa place.",
        confirmer: "Remplacer",
        annuler: "Garder l’autre",
      }))
    )
      return;
    try {
      localStorage.setItem(CLE_BROUILLON_ROUTINE, JSON.stringify({ initiale: null, valeurs: routine, cle: 0 }));
    } catch {
      /* sans stockage : l'écran s'ouvre sur ses routines, sans brouillon */
    }
    router.push(`/routines?vue=routines&agent=${encodeURIComponent(idCree)}&reprendre=1`);
  };

  return (
    <div className="flex flex-col gap-2 border-t border-bordure-subtile pt-3">
      {fenetre}
      <span className="text-ui-xs text-texte-tertiaire">Et ensuite</span>
      <div className="flex flex-wrap gap-2">
        {routine && b.routine && (
          <Bouton variant="blanc" iconeGauche={<Icon name="clock-01" size={16} />} className="h-auto min-h-8 py-1.5 text-left whitespace-normal" onClick={() => void confierRoutine()}>
            <span>
              Lui confier : {b.routine.nom} <span className="text-texte-tertiaire">· {libellePlanning(routine.schedule)}</span>
            </span>
          </Bouton>
        )}
        {local && (
          <Bouton variant="blanc" iconeGauche={<Icon name="send-01" size={16} />} disabled={!!raisonPartage} onClick={() => setPartage(true)}>
            Partager avec l’équipe
          </Bouton>
        )}
      </div>
      {raisonPartage && <p className="m-0 text-ui-2xs text-texte-tertiaire">{raisonPartage}</p>}
      {routine && <p className="m-0 text-ui-2xs text-texte-tertiaire">La routine s’ouvre dans Automatisations pour que tu la relises : rien n’est planifié avant que tu l’enregistres.</p>}
      {local && partage && <ModalePartager agent={local} mode="partager" ouvert onFermer={() => setPartage(false)} />}
    </div>
  );
}

/* ─── La barre de l'atelier, en haut du fil ────────────────────── */

/**
 * Quand la carte en cours (pas encore créée) sort de l'écran, l'agent reste visible en haut du fil :
 * son visuel, son nom, ses piliers et son poids ; un clic ramène à la carte.
 */
export function BarreAtelier({ zone, ateliers }: { zone: RefObject<HTMLDivElement | null>; ateliers: Map<string, EtatAtelier> }) {
  const courante = [...ateliers.entries()].find(([, e]) => e.dernier && e.courante && !e.cree) ?? null;
  const etapeId = courante?.[0] ?? null;
  // La carte observée hors de l'écran (par son étape : une nouvelle carte repart visible).
  const [horsVue, setHorsVue] = useState<string | null>(null);

  useEffect(() => {
    const racine = zone.current;
    if (!racine || !etapeId) return;
    const carte = racine.querySelector(`[data-carte-atelier="${CSS.escape(etapeId)}"]`);
    if (!carte) return;
    const observateur = new IntersectionObserver(([e]) => setHorsVue(e.isIntersecting ? null : etapeId), { root: racine, threshold: 0.12 });
    observateur.observe(carte);
    return () => observateur.disconnect();
  }, [zone, etapeId]);

  if (!courante || horsVue !== etapeId) return null;
  const [, etat] = courante;
  const b = etat.apres;
  const id = identifiantPropose(b);
  const nom = nomPropre(b.nom) || "Nouvel agent";
  const revenir = () =>
    zone.current
      ?.querySelector(`[data-carte-atelier="${CSS.escape(etapeId!)}"]`)
      ?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });

  return (
    <div className="klyra-arrivee absolute inset-x-0 top-0 z-10 border-b border-bordure-subtile bg-fond-surface/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[880px] min-w-0 items-center gap-3 px-7 py-2">
        <span aria-hidden="true" className="flex">
          <RondApercu agentId={id} nom={nom} teinte={etat.teinte ?? teinteParDefaut(id)} taille={36} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui-s font-semibold text-texte-principal">
            {nom} {b.role && <span className="text-ui-2xs font-normal text-texte-tertiaire">{b.role}</span>}
          </span>
          <span className="truncate text-ui-xs text-texte-secondaire">{b.mission || b.description || "Sa mission s’écrira ici."}</span>
        </span>
        <Etoiles remplis={piliersRemplis(b)} alerte={piliersEnAlerte(etat.resultats, etat.ajouts)} />
        <span className="max-[760px]:hidden">
          <Jauge jetons={jetonsBrouillon(b)} fond="bg-fond-survol" />
        </span>
        <Bouton variant="blanc" taille="mini" onClick={revenir}>
          Voir la carte
        </Bouton>
      </div>
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
