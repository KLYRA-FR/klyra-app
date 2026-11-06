"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Interrupteur } from "@/components/reglages/ui";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { annoncer } from "@/lib/annonces";
import { getBridge, type Competence, type CompetencesAgent, type ContexteConnaissances } from "@/lib/bridge";
import { poste } from "@/lib/plateforme";
import { useReglagesAgents } from "@/lib/reglages-agents";
import { resumeFiche } from "@/lib/skills";
import type { Role } from "@/types/domain";
import { definirSkill, type OrigineSkill } from "../../../../electron/skills-par-agent";
import type { Lecture } from "./donnees";
import { EnteteVue, messageErreur, Note, TitreGroupe } from "./elements";

/**
 * Le nombre à montrer sur la ligne : celles de sa fiche (et combien lui sont coupées), sinon celles qu'il
 * reçoit. Une skill coupée dans Réglages › Agents ne lui arrive pas, même nommée dans sa fiche.
 */
export function resumeCompetences(lecture: Lecture<CompetencesAgent>): string | undefined {
  if (lecture.etat !== "pret") return undefined;
  const { fiche, poste: duPoste, projet, plugins = [], coupees = [] } = lecture.valeur;
  const coupee = (s: Competence) => coupees.includes(s.nom);
  if (fiche.length) return resumeFiche(fiche.length, fiche.filter(coupee).length);
  const n = [...duPoste, ...projet, ...plugins].filter((s) => !coupee(s)).length;
  return n ? `${n} disponible${n > 1 ? "s" : ""}` : "Aucune";
}

/** Le dernier dossier d'un chemin (le nom d'une skill sur le disque), sans module Node côté écran. */
const dossierDe = (chemin: string | null) => chemin?.split(/[\\/]/).filter(Boolean).pop() ?? null;

function CarteCompetence({
  competence,
  onMontrer,
  prechargee,
  onBasculer,
  alerte,
  onDonner,
  occupe,
  ou,
}: {
  competence: Competence;
  onMontrer?: () => void;
  prechargee: boolean;
  onBasculer?: (oui: boolean) => void;
  /** Pourquoi elle ne lui arrive pas, quand ça contredit sa fiche. */
  alerte?: string;
  /** La lui donner (Réglages › Agents) : seulement pour une skill qui lui est coupée. */
  onDonner?: () => void;
  occupe: boolean;
  /** Où l'agent travaille : « ce Mac », « ce PC » ou « le serveur ». */
  ou: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-sm px-2.5 py-2">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-fond-surface-grise text-icone-accent">
        <Icon name="layers-01" size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-ui-s font-medium text-texte-principal">{competence.nom}</span>
          {competence.version && <span className="shrink-0 text-ui-2xs text-texte-tertiaire">v{competence.version}</span>}
        </span>
        {competence.dossier ? (
          competence.description && <span className="line-clamp-2 text-ui-xs leading-[1.45] text-texte-tertiaire">{competence.description}</span>
        ) : (
          <span className="text-ui-xs leading-[1.45] text-texte-erreur">Introuvable sur {ou} : l’agent ne la recevra pas.</span>
        )}
        {alerte && <span className="text-ui-xs leading-[1.45] text-texte-erreur">{alerte}</span>}
        {onDonner && (
          <Bouton variant="gris" taille="mini" className="mt-1 self-start" disabled={occupe} onClick={onDonner}>
            Lui donner
          </Bouton>
        )}
      </span>
      {onMontrer && competence.dossier && (
        <BoutonIcone variant="discret" taille="mini" libelle={`Montrer ${poste.dansExplorateur}`} icone={<Icon name="folder-open-01" size={14} />} onClick={onMontrer} />
      )}
      {onBasculer && (
        <span className="mt-1.5 shrink-0">
          <Interrupteur
            actif={prechargee}
            libelle={prechargee ? `Ne plus précharger « ${competence.nom} »` : `Précharger « ${competence.nom} » dans sa fiche`}
            disabled={occupe}
            onChange={onBasculer}
          />
        </span>
      )}
    </li>
  );
}

const POURQUOI: Record<"assistant" | "partage" | "sans-fiche", string> = {
  assistant: "Ton assistant n’a pas de fiche : il charge la compétence qu’il lui faut quand la tâche s’y prête, ou quand tu la demandes avec « / » dans ton message.",
  partage: "Sa fiche suit la version partagée : ses compétences préchargées se changent dans sa fiche, en copie privée.",
  "sans-fiche": "Cette fiche n’est pas sur le disque : ses compétences préchargées ne se changent pas d’ici.",
};

/**
 * Ses compétences : les skills que sa fiche précharge (à ajouter ou retirer d'ici), celles du projet et
 * du poste qu'il reçoit, celles que Réglages › Agents lui coupe (à lui donner d'ici), et ce que sa
 * description dit qu'il couvre. Les coupées viennent du serveur de la conversation, comme à l'envoi.
 */
export function VueCompetences({
  role,
  contexte,
  lecture,
  attribuer,
  pourquoiFige,
  actualiser,
  onRetour,
}: {
  role: Role;
  contexte: ContexteConnaissances | null;
  lecture: Lecture<CompetencesAgent>;
  /** Ajoute ou retire une compétence préchargée par sa fiche ; absent : figé (cf. `pourquoiFige`). */
  attribuer?: (nom: string, oui: boolean) => Promise<void>;
  pourquoiFige: keyof typeof POURQUOI | null;
  /** Relit ses compétences (après lui avoir donné une skill). */
  actualiser?: () => void;
  onRetour: () => void;
}) {
  const bridge = getBridge()?.agents;
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // Sur un VPS : ses compétences sont celles du serveur, et leur dossier n'est pas sur ce poste.
  const surServeur = !!contexte?.lieu;
  const ou = surServeur ? "le serveur" : poste.ce;
  const montrer =
    contexte && !surServeur && bridge?.montrerCompetence
      ? (nom: string) => void bridge.montrerCompetence!(role.id, { dossier: contexte.dossier }, nom).then((r) => !r.ok && annoncer(r.message))
      : undefined;
  const c = lecture.etat === "pret" ? lecture.valeur : null;
  // Une skill de la fiche se reconnaît par son nom ou par le dossier où elle est rangée.
  const dansLaFiche = (s: Competence) => !!c?.fiche.some((f) => f.nom === s.nom || f.nom === dossierDe(s.dossier));

  /* Ce que Réglages › Agents lui retire, sur le serveur de la conversation (le même filtre qu'à l'envoi). */
  const reglagesSkills = useReglagesAgents(contexte?.lieu ?? null);
  const coupees = new Set(c?.coupees ?? []);
  const estCoupee = (s: Competence) => coupees.has(s.nom);
  // Comme à l'envoi : une skill de l'app (ou du serveur) l'emporte sur celle du projet du même nom.
  const origineDe = (nom: string): OrigineSkill => (c?.poste.some((s) => s.nom === nom) ? "poste" : "projet");
  const choix = reglagesSkills.reglages?.skillsParAgent ?? null;
  /** Lui donne une skill coupée, pour lui seul ; vrai si c'est écrit. */
  const donnerA = async (nom: string): Promise<boolean> => {
    if (!choix?.fige) {
      setErreur("Les réglages des agents ne sont pas encore lus : réessaie dans un instant.");
      return false;
    }
    const ok = await reglagesSkills.changerSkills(definirSkill(choix, role.id, nom, origineDe(nom), true));
    actualiser?.();
    return ok;
  };
  const donner = (s: Competence) => async () => {
    setEnCours(s.nom);
    setErreur(null);
    try {
      if (await donnerA(s.nom)) annoncer(`${s.nom} donnée à ${role.name}.`);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(null);
    }
  };

  const basculer = attribuer
    ? (s: Competence) => async (oui: boolean) => {
        setEnCours(s.nom);
        setErreur(null);
        try {
          // Précharger une skill qu'il ne reçoit pas : la lui donner d'abord, sinon sa fiche la demanderait pour rien.
          if (oui && estCoupee(s) && !(await donnerA(s.nom))) return;
          await attribuer(s.nom, oui);
          annoncer(oui ? `${s.nom} préchargée pour ${role.name}.` : `${s.nom} n’est plus préchargée.`);
        } catch (e) {
          setErreur(messageErreur(e));
        } finally {
          setEnCours(null);
        }
      }
    : null;

  const ouReglages = surServeur ? "Réglages › Agents de ce serveur" : "Réglages › Agents";
  const liste = (titre: string, aide: ReactNode, competences: Competence[], prechargees: boolean) =>
    competences.length > 0 && (
      <section className="flex flex-col gap-1.5">
        <TitreGroupe>{titre}</TitreGroupe>
        <ul className="m-0 flex list-none flex-col gap-px rounded-md border border-bordure-subtile bg-fond-surface p-1">
          {competences.map((s) => (
            <CarteCompetence
              key={`${s.nom}-${s.dossier ?? "absente"}`}
              competence={s}
              onMontrer={montrer ? () => montrer(s.nom) : undefined}
              prechargee={prechargees}
              onBasculer={basculer ? (oui) => void basculer(s)(oui) : undefined}
              alerte={prechargees && estCoupee(s) ? `Coupée pour ${role.name} dans ${ouReglages} : sa fiche la demande, mais il ne la reçoit pas.` : undefined}
              onDonner={estCoupee(s) ? () => void donner(s)() : undefined}
              occupe={enCours !== null}
              ou={ou}
            />
          ))}
        </ul>
        <Note>{aide}</Note>
      </section>
    );
  // Les coupées hors de sa fiche, une fois chacune (un même nom dans l'app et le projet n'a qu'un réglage).
  const coupeesHorsFiche = c ? [...new Map([...c.projet, ...c.poste].filter((s) => estCoupee(s) && !dansLaFiche(s)).map((s) => [s.nom, s])).values()] : [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <EnteteVue titre="Compétences" onRetour={onRetour} />

      {role.skills.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <TitreGroupe>Ce qu’il couvre</TitreGroupe>
          <div className="flex flex-wrap gap-1.5">
            {role.skills.map((s) => (
              <span key={s} className="rounded-2xs bg-fond-surface-grise px-2 py-0.5 text-ui-xs text-texte-principal">
                {s}
              </span>
            ))}
          </div>
          <Note>D’après sa description.</Note>
        </section>
      )}

      {lecture.etat === "chargement" && <Note>Lecture de ses compétences…</Note>}
      {lecture.etat === "erreur" && <Note erreur>{lecture.message}</Note>}
      {lecture.etat === "indisponible" && <Note>Les compétences se lisent dans l’app de bureau.</Note>}
      {erreur && <Note erreur>{erreur}</Note>}
      {c && (
        <>
          {liste(
            "Préchargées par sa fiche",
            `Leur texte entre dans chaque appel de ${role.name}, qu’il travaille seul ou pour un autre agent. Précharge seulement ce qui sert à presque chaque tâche : le reste, il le charge au besoin.`,
            c.fiche,
            true,
          )}
          {liste("Du projet", "Rangées dans le dossier .claude/skills du projet.", c.projet.filter((s) => !dansLaFiche(s) && !estCoupee(s)), false)}
          {liste(
            surServeur ? "Du serveur" : "De l’app",
            surServeur
              ? `Celles de ce serveur que ${role.name} reçoit : leur nom et leur description lui sont présentés à chaque appel, leur texte n’est lu qu’au besoin. Tape « / » au début d’un message pour en demander une.`
              : `Celles que KLYRA garde, copiées une fois depuis .claude/skills, et que ${role.name} reçoit : leur nom et leur description lui sont présentés à chaque appel, leur texte n’est lu qu’au besoin. Tape « / » au début d’un message pour en demander une.`,
            c.poste.filter((s) => !dansLaFiche(s) && !estCoupee(s)),
            false,
          )}
          {liste(
            "Des plugins",
            "Apportées par les plugins de Claude Code activés : comme les autres, présentées à chaque appel et lues au besoin.",
            (c.plugins ?? []).filter((s) => !dansLaFiche(s)),
            false,
          )}
          {liste(
            `Coupées pour ${role.name}`,
            <>
              {ouReglages} les lui retire : il ne les voit pas et ne peut pas les charger, même avec « / ». « Lui donner » en allume une pour lui seul ; la précharger la lui
              donne aussi.{" "}
              <Link href="/reglages?section=agents" className="text-texte-principal underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent">
                Ouvrir Réglages › Agents
              </Link>
            </>,
            coupeesHorsFiche,
            false,
          )}
          {reglagesSkills.erreur && <Note erreur>{reglagesSkills.erreur}</Note>}
          {!c.fiche.length && !c.projet.length && !c.poste.length && !(c.plugins ?? []).length && (
            <Note>
              {surServeur
                ? "Aucune compétence sur le serveur pour l’instant. Une skill de Claude Code rangée dans le dossier .claude/skills de l’utilisateur klyra du VPS apparaîtra ici."
                : "Aucune compétence dans l’app pour l’instant. Celles de .claude/skills sont reprises au premier lancement. Une skill ajoutée ensuite dans ce dossier n’apparaît pas ici : « Importer depuis le poste », dans Réglages › Agents, la reprend éteinte."}
            </Note>
          )}
          {surServeur && attribuer && (
            <Note>
              Sa fiche est celle de {poste.ce}, copiée sur le serveur à chaque échange : une compétence que tu précharges ici l’est aussi sur {poste.ce}, si elle y est
              rangée.
            </Note>
          )}
          {pourquoiFige && <Note>{POURQUOI[pourquoiFige]}</Note>}
        </>
      )}
    </div>
  );
}
