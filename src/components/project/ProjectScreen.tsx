"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "klyra-ui";
import { Pieces } from "@/components/chat/Composer";
import { PucesImages } from "@/components/chat/ImageJointe";
import { PromptBox } from "@/components/chat/PromptBox";
import { useAjoutFichiers } from "@/components/chat/useAjoutFichiers";
import { Icon, type IconName } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { TravauxProjet } from "@/components/project/TravauxProjet";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { PuceSelect, type PuceOption } from "@/components/ui/PuceSelect";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { derniereConversation } from "@/lib/conversation-projet";
import { emplacementProjet } from "@/lib/depot-projet";
import { estImage } from "@/lib/fichiers";
import { nomLieu, useServeursRelies } from "@/lib/lieux";
import { useProject, useRole, useRoles, useWorkspace } from "@/lib/workspace";
import type { Project, RoleId } from "@/types/domain";
import { ConsignesProjet } from "./ConsignesProjet";
import { AutorisationsProjet } from "./AutorisationsProjet";
import { SessionsTerminal } from "./SessionsTerminal";
import { DepotProjet } from "./DepotProjet";
import { useMenuProjet } from "./MenuProjet";

/** Pour commencer dans un projet : une phrase posée dans le champ, qu'on relit avant d'envoyer. */
const SUGGESTIONS: { libelle: string; icone: IconName; texte: string }[] = [
  { libelle: "Explique-moi ce projet", icone: "help-circle-contained", texte: "Explique-moi ce projet : à quoi il sert, comment il est organisé et comment le lancer." },
  { libelle: "Lance le site en local", icone: "globe-01", texte: "Lance le site en local et donne-moi son adresse." },
  { libelle: "Les derniers changements", icone: "clock-backward", texte: "Résume les derniers changements du dépôt (les commits récents) et ce qui reste en cours." },
];
/** Un dépôt ouvert depuis GitHub : ses agents lisent ses pull requests et ses tests (outils github_*). */
const SUGGESTION_GITHUB = { libelle: "Les pull requests ouvertes", icone: "git-branch-01" as IconName, texte: "Liste les pull requests ouvertes du dépôt, avec l’état de leurs tests et ce qui bloque." };

/**
 * Un projet s'ouvre comme un chat : sur sa dernière conversation (`/chat?id=…`). Sans conversation, ou avec
 * `&nouvelle=1` (le « + » du panneau), une conversation neuve : la fiche courte du projet, de quoi commencer,
 * et le champ pour écrire à un agent (l'assistant par défaut). Le premier message crée la conversation.
 */
export function ProjectScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const project = useProject(params.get("id"));
  const nouvelle = params.has("nouvelle");
  const { state } = useWorkspace();
  const derniere = project && !nouvelle ? derniereConversation(state.chats, project.id) : null;

  useEffect(() => {
    if (derniere) router.replace(`/chat?id=${encodeURIComponent(derniere)}`);
  }, [derniere, router]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <EmptyState title="Ce projet n’existe pas" description="Choisis un projet dans le menu." />
      </div>
    );
  }
  if (derniere) return <div className="h-full" />;
  return <NouvelleConversation key={project.id} project={project} />;
}

function NouvelleConversation({ project }: { project: Project }) {
  const router = useRouter();
  const roles = useRoles();
  const serveurs = useServeursRelies();
  const { startChat } = useWorkspace();
  const { ouvrirMenu, menuProjet } = useMenuProjet();
  const [agentId, setAgentId] = useState<RoleId>("principal");
  const agent = useRole(agentId);
  const [text, setText] = useState("");
  const champ = useRef<HTMLTextAreaElement>(null);
  const [fichiers, setFichiers] = useState<string[]>([]);
  const [alerte, setAlerte] = useState<string | null>(null);
  const { ajouter, coller } = useAjoutFichiers(fichiers, setFichiers, setAlerte);
  const bridge = getBridge();

  const joindre = async () => {
    if (!bridge) return setAlerte("Joindre des fichiers marche dans l’app de bureau.");
    const r = await bridge.fichiers.choisir();
    if (r.ok) ajouter(r.data);
  };
  const preRemplir = (debut: string) => {
    const avant = text.trimEnd();
    const suite = avant ? `${avant}\n${debut}` : debut;
    setText(suite);
    requestAnimationFrame(() => {
      const el = champ.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(suite.length, suite.length);
    });
  };
  const submit = () => {
    const message = text.trim() || (fichiers.length > 1 ? "Regarde ces fichiers." : "Regarde ce fichier.");
    router.push(`/chat?id=${encodeURIComponent(startChat(project.id, message, agentId, fichiers))}`);
  };

  const options: PuceOption<RoleId>[] = roles.map((r) => ({
    value: r.id,
    label: r.id === "principal" ? r.name : `${r.name} · ${r.tag}`,
    icone: <AgentRond roleId={r.id} taille={20} />,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* L'en-tête d'une conversation, avant son premier message. */}
      <header className="flex items-center gap-3 border-b border-bordure-subtile px-5 py-3">
        <AgentRond roleId={agent.id} taille={32} fondPastille="surface" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="m-0 truncate text-ui font-semibold text-texte-principal">Nouvelle conversation</p>
          <span className="truncate text-ui-xs text-texte-tertiaire">
            {project.name} · avec {agent.name}
          </span>
        </div>
        <BoutonIcone taille="compact" icone={<Icon name="dot-horizontal" size={16} />} libelle="Options du projet" aria-haspopup="menu" onClick={(e) => ouvrirMenu(e, project)} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-5 px-8 pt-10 pb-8">
          <div className="flex flex-col gap-2">
            {/* Titre KLYRA : semi-gras + regular, même couleur. */}
            <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
              <span className="font-semibold">{project.name}</span> {project.subtitle && <span className="font-normal">· {project.subtitle}</span>}
            </h1>
            {project.brief && <p className="m-0 text-body-s leading-[1.45] text-texte-secondaire">{project.brief}</p>}
            <span title={project.folder} className={cn(!project.lieu && "klyra-mono", "text-ui-xs text-texte-tertiaire [overflow-wrap:anywhere]")}>
              {emplacementProjet(project.folder, project.lieu, nomLieu(project.lieu, serveurs))}
            </span>
          </div>
          <DepotProjet key={`depot-${project.id}`} project={project} />
          <ConsignesProjet key={project.id} project={project} />
          <AutorisationsProjet key={`autorisations-${project.id}`} project={project} />
          <SessionsTerminal key={`sessions-${project.id}`} project={project} />
          <section aria-label="Pour commencer" className="flex flex-wrap gap-2">
            {[...SUGGESTIONS, ...(project.githubConnecte ? [SUGGESTION_GITHUB] : [])].map((s) => (
              <Bouton key={s.libelle} variant="blanc" taille="compact" iconeGauche={<Icon name={s.icone} size={16} className="text-icone-secondaire" />} onClick={() => preRemplir(s.texte)}>
                {s.libelle}
              </Bouton>
            ))}
          </section>
          <TravauxProjet projectId={project.id} />
        </div>
      </div>

      <div className="@container mx-auto w-full max-w-[880px] shrink-0 px-5 pt-1 pb-4">
        <PromptBox
          ref={champ}
          value={text}
          onChange={setText}
          onSubmit={submit}
          onJoindre={() => void joindre()}
          onColler={coller}
          aDesPieces={fichiers.length > 0}
          pieces={<Pieces fichiers={fichiers} onRetirer={(c) => setFichiers((f) => f.filter((x) => x !== c))} />}
          apresTexte={fichiers.some(estImage) && <PucesImages fichiers={fichiers} />}
          placeholder={`Écris à ${agent.name}, dans ${project.name}…`}
          puces={<PuceSelect libelle="Agent de la conversation" icone={<AgentRond roleId={agentId} taille={20} />} options={options} value={agentId} onChange={setAgentId} />}
        />
        {alerte && (
          <p role="alert" className="mt-2 mb-0 px-1 text-ui-2xs font-medium text-texte-erreur">
            {alerte}
          </p>
        )}
      </div>
      {menuProjet}
    </div>
  );
}
