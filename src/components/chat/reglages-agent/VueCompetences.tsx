"use client";

import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { annoncer } from "@/lib/annonces";
import { getBridge, type Competence, type CompetencesAgent, type ContexteConnaissances } from "@/lib/bridge";
import { poste } from "@/lib/plateforme";
import type { Role } from "@/types/domain";
import type { Lecture } from "./donnees";
import { EnteteVue, Note, TitreGroupe } from "./elements";

/** Le nombre à montrer sur la ligne : celles de sa fiche, sinon celles qu'il peut utiliser. */
export function resumeCompetences(lecture: Lecture<CompetencesAgent>): string | undefined {
  if (lecture.etat !== "pret") return lecture.etat === "indisponible" ? "Sur le serveur" : undefined;
  const { fiche, poste: duPoste, projet } = lecture.valeur;
  if (fiche.length) return `${fiche.length} dans sa fiche`;
  const n = duPoste.length + projet.length;
  return n ? `${n} disponible${n > 1 ? "s" : ""}` : "Aucune";
}

function CarteCompetence({ competence, onMontrer }: { competence: Competence; onMontrer?: () => void }) {
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
          <span className="text-ui-xs leading-[1.45] text-texte-erreur">Introuvable sur {poste.ce} : l’agent ne la recevra pas.</span>
        )}
      </span>
      {onMontrer && competence.dossier && (
        <BoutonIcone variant="discret" taille="mini" libelle={`Montrer ${poste.dansExplorateur}`} icone={<Icon name="folder-open-01" size={14} />} onClick={onMontrer} />
      )}
    </li>
  );
}

function Liste({ titre, aide, competences, montrer }: { titre: string; aide: string; competences: Competence[]; montrer?: (nom: string) => void }) {
  if (!competences.length) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <TitreGroupe>{titre}</TitreGroupe>
      <ul className="m-0 flex list-none flex-col gap-px rounded-md border border-bordure-subtile bg-fond-surface p-1">
        {competences.map((c) => (
          <CarteCompetence key={`${c.nom}-${c.dossier ?? "absente"}`} competence={c} onMontrer={montrer ? () => montrer(c.nom) : undefined} />
        ))}
      </ul>
      <Note>{aide}</Note>
    </section>
  );
}

/**
 * Ses compétences : les skills que sa fiche précharge, celles du projet et du poste que tout agent peut
 * utiliser, et ce que sa description dit qu'il couvre.
 */
export function VueCompetences({
  role,
  contexte,
  lecture,
  onRetour,
}: {
  role: Role;
  contexte: ContexteConnaissances | null;
  lecture: Lecture<CompetencesAgent>;
  onRetour: () => void;
}) {
  const bridge = getBridge()?.agents;
  const montrer =
    contexte && bridge?.montrerCompetence
      ? (nom: string) => void bridge.montrerCompetence!(role.id, { dossier: contexte.dossier }, nom).then((r) => !r.ok && annoncer(r.message))
      : undefined;
  const c = lecture.etat === "pret" ? lecture.valeur : null;

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
      {lecture.etat === "indisponible" && <Note>Les compétences d’un agent sur un serveur ne se lisent pas encore d’ici.</Note>}
      {c && (
        <>
          <Liste
            titre="Dans sa fiche"
            aide="Préchargées : leur texte entre dans chaque appel de l’agent."
            competences={c.fiche}
            montrer={montrer}
          />
          <Liste titre="Du projet" aide="Dans le dossier .claude/skills du projet." competences={c.projet} montrer={montrer} />
          <Liste
            titre={`De ${poste.ce}`}
            aide="Tous tes agents peuvent s’en servir : seuls leur nom et leur description sont présentés à chaque appel."
            competences={c.poste}
            montrer={montrer}
          />
          {!c.fiche.length && !c.projet.length && !c.poste.length && (
            <Note>Aucune compétence sur {poste.ce} pour l’instant. Une skill de Claude Code ajoutée dans ton dossier personnel apparaîtra ici.</Note>
          )}
        </>
      )}
    </div>
  );
}
