"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Interrupteur } from "@/components/reglages/ui";
import { BoutonIcone } from "@/components/ui/Bouton";
import { annoncer } from "@/lib/annonces";
import { getBridge, type Competence, type CompetencesAgent, type ContexteConnaissances } from "@/lib/bridge";
import { poste } from "@/lib/plateforme";
import type { Role } from "@/types/domain";
import type { Lecture } from "./donnees";
import { EnteteVue, messageErreur, Note, TitreGroupe } from "./elements";

/** Le nombre à montrer sur la ligne : celles de sa fiche, sinon celles qu'il peut utiliser. */
export function resumeCompetences(lecture: Lecture<CompetencesAgent>): string | undefined {
  if (lecture.etat !== "pret") return undefined;
  const { fiche, poste: duPoste, projet, plugins = [] } = lecture.valeur;
  if (fiche.length) return `${fiche.length} dans sa fiche`;
  const n = duPoste.length + projet.length + plugins.length;
  return n ? `${n} disponible${n > 1 ? "s" : ""}` : "Aucune";
}

/** Le dernier dossier d'un chemin (le nom d'une skill sur le disque), sans module Node côté écran. */
const dossierDe = (chemin: string | null) => chemin?.split(/[\\/]/).filter(Boolean).pop() ?? null;

function CarteCompetence({
  competence,
  onMontrer,
  prechargee,
  onBasculer,
  occupe,
  ou,
}: {
  competence: Competence;
  onMontrer?: () => void;
  prechargee: boolean;
  onBasculer?: (oui: boolean) => void;
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
 * du poste que tout agent peut suivre, et ce que sa description dit qu'il couvre.
 */
export function VueCompetences({
  role,
  contexte,
  lecture,
  attribuer,
  pourquoiFige,
  onRetour,
}: {
  role: Role;
  contexte: ContexteConnaissances | null;
  lecture: Lecture<CompetencesAgent>;
  /** Ajoute ou retire une compétence préchargée par sa fiche ; absent : figé (cf. `pourquoiFige`). */
  attribuer?: (nom: string, oui: boolean) => Promise<void>;
  pourquoiFige: keyof typeof POURQUOI | null;
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

  const basculer = attribuer
    ? (s: Competence) => async (oui: boolean) => {
        setEnCours(s.nom);
        setErreur(null);
        try {
          await attribuer(s.nom, oui);
          annoncer(oui ? `${s.nom} préchargée pour ${role.name}.` : `${s.nom} n’est plus préchargée.`);
        } catch (e) {
          setErreur(messageErreur(e));
        } finally {
          setEnCours(null);
        }
      }
    : null;

  const liste = (titre: string, aide: string, competences: Competence[], prechargees: boolean) =>
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
              occupe={enCours !== null}
              ou={ou}
            />
          ))}
        </ul>
        <Note>{aide}</Note>
      </section>
    );

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
          {liste("Du projet", "Rangées dans le dossier .claude/skills du projet.", c.projet.filter((s) => !dansLaFiche(s)), false)}
          {liste(
            surServeur ? "Du serveur" : "De l’app",
            surServeur
              ? "Tous tes agents sur ce serveur peuvent s’en servir : leur nom et leur description sont présentés à chaque appel, leur texte n’est lu qu’au besoin. Tape « / » au début d’un message pour en demander une."
              : "Celles que KLYRA garde, copiées une fois depuis .claude/skills. Tous tes agents peuvent s’en servir : leur nom et leur description sont présentés à chaque appel, leur texte n’est lu qu’au besoin. Tape « / » au début d’un message pour en demander une.",
            c.poste.filter((s) => !dansLaFiche(s)),
            false,
          )}
          {liste(
            "Des plugins",
            "Apportées par les plugins de Claude Code activés : comme les autres, présentées à chaque appel et lues au besoin.",
            (c.plugins ?? []).filter((s) => !dansLaFiche(s)),
            false,
          )}
          {!c.fiche.length && !c.projet.length && !c.poste.length && !(c.plugins ?? []).length && (
            <Note>
              {surServeur
                ? "Aucune compétence sur le serveur pour l’instant. Une skill de Claude Code rangée dans le dossier .claude/skills de l’utilisateur klyra du VPS apparaîtra ici."
                : "Aucune compétence dans l’app pour l’instant. Celles de .claude/skills sont reprises au premier lancement. Une skill ajoutée ensuite dans ce dossier n’apparaît pas ici."}
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
