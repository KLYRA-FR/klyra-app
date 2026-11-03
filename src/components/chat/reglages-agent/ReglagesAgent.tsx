"use client";

import { useState } from "react";
import { ChoixModele } from "@/components/chat/ChoixModele";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { NIVEAUX_ACCES } from "@/lib/acces";
import { parseAgentFile, serializeAgentFile, setFields } from "@/lib/agent-file";
import { useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { useReglages } from "@/lib/reglages";
import { useRoutines } from "@/lib/routines";
import { useProject, useRole, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";
import { contexteDe, useCompetencesAgent, useConsommationAgent, useMemoireAgent } from "./donnees";
import { ChampEnLigne, Groupe, LigneReglage, TitreGroupe } from "./elements";
import { resumeCompetences, VueCompetences } from "./VueCompetences";
import { VueRoutines } from "./VueRoutines";
import { VueSouvenirs } from "./VueSouvenirs";
import { resumeUtilisation, VueUtilisation } from "./VueUtilisation";

type Vue = "accueil" | "souvenirs" | "competences" | "routines" | "utilisation";

/**
 * L'onglet Réglages du panneau d'une conversation : l'agent et le choix du modèle en tête, puis, comme
 * le panneau d'OpenBot, sa description et des groupes de lignes qui ouvrent chacune sa sous-vue dans le
 * panneau (souvenirs, compétences, routines, utilisation) ou mènent à son réglage (accès, dossier, fiche).
 */
export function ReglagesAgent({ chat }: { chat: Chat }) {
  const role = useRole(chat.roleIds[0] ?? "principal");
  const project = useProject(chat.projectId);
  const travail = useTravail(chat.id);
  const { nouvelleConversation, state } = useWorkspace();
  const { tous, canEdit, save } = useAgents();
  const { reglages } = useReglages();
  const routines = useRoutines();
  const [vue, setVue] = useState<Vue>("accueil");
  const [confirmer, setConfirmer] = useState(false);
  const [ouvertLe] = useState(() => Date.now());

  const assistant = role.id === "principal";
  const contexte = contexteDe(chat, project, role.id);
  // Relue à la fin de chaque travail : l'agent a pu écrire un souvenir.
  const memoire = useMemoireAgent(role.id, contexte, !!travail);
  const competences = useCompetencesAgent(role.id, contexte);
  const consommation = useConsommationAgent(role.id);

  const local = tous.find((a) => a.role.id === role.id) ?? null;
  // Reçu de la bibliothèque : sa fiche suit la version de l'auteur (la changer ferait une copie privée).
  const lie = local?.entree?.origine.type === "bibliotheque";
  const coupee = reglages ? !reglages.configuration.memoireAgents : false;
  const fiche = assistant ? "/equipe?agent=principal" : role.file ? `/equipe?agent=${role.id}&mode=modifier` : `/equipe?agent=${role.id}`;
  const nbRoutines = routines.routines.filter((r) => r.agentId === role.id).length;
  const dossier = chat.lieu ? "Sur le serveur" : chat.kind === "equipe" && project ? project.folder : `~/.klyra/atelier/${role.id}`;
  const retour = () => setVue("accueil");

  if (vue === "souvenirs")
    return (
      <VueSouvenirs
        role={role}
        contexte={contexte}
        lecture={memoire.lecture}
        actualiser={memoire.actualiser}
        coupee={coupee}
        lienFiche={!assistant && role.file && !lie ? fiche : null}
        onRetour={retour}
      />
    );
  if (vue === "competences") return <VueCompetences role={role} contexte={contexte} lecture={competences} onRetour={retour} />;
  if (vue === "routines") return <VueRoutines role={role} api={routines} onRetour={retour} />;
  if (vue === "utilisation") return <VueUtilisation role={role} lecture={consommation} onRetour={retour} />;

  const resumeMemoire = (() => {
    const l = memoire.lecture;
    if (l.etat === "indisponible") return "Sur le serveur";
    if (l.etat !== "pret") return undefined;
    if (!l.valeur) return "Sans mémoire";
    const n = l.valeur.souvenirs.filter((s) => !s.toujours).length;
    const texte = n ? `${n} enregistré${n > 1 ? "s" : ""}` : l.valeur.souvenirs.length ? "Index seul" : "Aucun";
    return coupee ? `${texte} · coupée` : texte;
  })();

  /** Écrit la description dans sa fiche, par `save` (historique, refus si le fichier a changé). */
  const ecrireDescription = async (description: string) => {
    if (!role.file) throw new Error("Cette fiche n’est pas sur le disque.");
    const { frontmatter, body } = parseAgentFile(role.file.content);
    await save(role.id, serializeAgentFile({ frontmatter: setFields(frontmatter, { description }), body }), {}, role.file.modifiedAt);
  };
  // Une fiche dont l'en-tête a des listes sur plusieurs lignes (`tools:`, `skills:` en liste) : l'éditeur
  // d'en-tête de l'app ne les relit pas, on ne la réécrit donc pas d'ici.
  const enteteSimple = !!role.file && !/^---\r?\n[\s\S]*?^\s+-\s/m.test(/^---\r?\n[\s\S]*?\r?\n---/.exec(role.file.content)?.[0] ?? "");
  const descriptionModifiable = canEdit && !assistant && !lie && enteteSimple;

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex items-center gap-3">
        <AgentRond roleId={role.id} taille={52} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-ui font-semibold text-texte-principal">{role.name}</span>
          <span className="truncate text-ui-xs text-texte-tertiaire">{role.title}</span>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <TitreGroupe>Cerveau</TitreGroupe>
        <ChoixModele chat={chat} variante="champ" />
        <p className="m-0 px-0.5 text-ui-2xs leading-[1.45] text-texte-tertiaire">Pour cette conversation. Sans choix, l’agent prend le modèle de sa fiche.</p>
      </section>

      {assistant ? (
        role.whenToCall && <ChampEnLigne libelle="Quand l’appeler" valeur={role.whenToCall} multiligne lectureSeule />
      ) : (
        <ChampEnLigne
          key={role.id}
          libelle="Description"
          valeur={role.description}
          multiligne
          lectureSeule={!descriptionModifiable}
          enregistrer={descriptionModifiable ? ecrireDescription : undefined}
          valider={(d) => (d ? null : "Écris quand l’appeler : c’est ce que l’IA lit pour choisir l’agent.")}
          aide={
            lie
              ? "Elle suit la version partagée : pour la changer, ouvre sa fiche."
              : descriptionModifiable
                ? "Ce que l’IA lit pour savoir quand l’appeler. Enregistrée dans sa fiche en quittant le champ."
                : undefined
          }
        />
      )}

      <Groupe titre="Connaissances">
        <LigneReglage icone="note-01" libelle="Souvenirs" valeur={resumeMemoire} onClick={() => setVue("souvenirs")} />
        <LigneReglage icone="layers-01" libelle="Compétences" valeur={resumeCompetences(competences)} onClick={() => setVue("competences")} />
      </Groupe>

      <Groupe titre="Actions">
        <LigneReglage
          icone="clock-01"
          libelle="Routines"
          valeur={routines.charge ? (nbRoutines ? `${nbRoutines} configurée${nbRoutines > 1 ? "s" : ""}` : "Aucune") : undefined}
          onClick={() => setVue("routines")}
        />
        <LigneReglage icone="clock-backward" libelle="Utilisation" valeur={resumeUtilisation(consommation, ouvertLe)} onClick={() => setVue("utilisation")} />
      </Groupe>

      <Groupe titre="Règles">
        <LigneReglage
          icone="shield-check"
          libelle="Accès"
          valeur={NIVEAUX_ACCES.find((n) => n.id === state.acces)?.nom}
          href="/reglages?section=agents&reglage=acces"
          titre="Le même pour tous tes agents"
        />
        <LigneReglage
          icone="folder"
          libelle="Dossier"
          valeur={<span className="klyra-mono text-ui-xs">{dossier}</span>}
          titre={dossier}
          onClick={!chat.lieu && chat.kind !== "equipe" && getBridge()?.rendus ? () => void getBridge()?.rendus.dossierAgent(role.id, "atelier") : undefined}
          fleche={false}
        />
        <LigneReglage icone="file-code" libelle="Avancé" valeur={assistant ? "Sa fiche" : "Fiche complète"} href={fiche} />
      </Groupe>

      <section className="flex flex-col gap-1.5">
        <TitreGroupe>Conversation</TitreGroupe>
        {confirmer ? (
          <div className="flex flex-col gap-2 rounded-md border border-bordure-subtile bg-fond-page p-3">
            <p className="m-0 text-ui-s leading-[1.45] text-texte-principal">Les messages et ce que {role.name} retient de cette conversation seront effacés.</p>
            <div className="flex gap-2">
              <Bouton
                variant="sombre"
                taille="compact"
                onClick={() => {
                  nouvelleConversation(chat.id);
                  setConfirmer(false);
                }}
              >
                Effacer et repartir
              </Bouton>
              <Bouton variant="blanc" taille="compact" onClick={() => setConfirmer(false)}>
                Annuler
              </Bouton>
            </div>
          </div>
        ) : (
          <Bouton
            variant="blanc"
            taille="compact"
            disabled={!!travail}
            iconeGauche={<Icon name="refresh-01" size={16} />}
            onClick={() => setConfirmer(true)}
            className="self-start"
          >
            Nouvelle conversation
          </Bouton>
        )}
      </section>
    </div>
  );
}
