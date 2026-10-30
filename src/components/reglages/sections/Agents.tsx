"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { MODELES } from "@/components/team/AgentEditor";
import { ModalePersonnaliserAssistant } from "@/components/team/PersonnaliserAssistant";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { NIVEAUX_ACCES } from "@/lib/acces";
import { getField, parseAgentFile } from "@/lib/agent-file";
import { useAgents } from "@/lib/agents";
import { BridgeError, getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { useRole, useWorkspace } from "@/lib/workspace";
import type { Role } from "@/types/domain";
import { ancreReglage, Erreur, Groupe, Ligne, SeulementBureau } from "../ui";

function ChoixAcces() {
  const { state, choisirAcces } = useWorkspace();
  return (
    <div role="radiogroup" aria-label="Accès des agents" className="flex w-full flex-col gap-2">
      {NIVEAUX_ACCES.map((n) => {
        const choisi = state.acces === n.id;
        return (
          <button
            key={n.id}
            type="button"
            role="radio"
            aria-checked={choisi}
            onClick={() => choisirAcces(n.id)}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border bg-fond-surface p-3.5 text-left transition-colors duration-[120ms] ease-sortie",
              choisi ? "border-bleu-k1-500" : "border-bordure-subtile hover:border-bordure-forte",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                choisi ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte",
              )}
            >
              {choisi && <Icon name="check-01" size={12} />}
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-ui-s font-semibold text-texte-principal">{n.nom}</span>
              <span className="text-ui-xs leading-[1.45] text-texte-secondaire">{n.detail}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Le modèle d'un agent, comme depuis sa fiche : écrit dans le fichier, ou préférence d'un agent reçu (sans le détacher). */
function ModeleAgent({ role }: { role: Role }) {
  const { changerModele, canEdit } = useAgents();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const parsed = role.file ? parseAgentFile(role.file.content) : null;
  const actuel = (parsed && getField(parsed.frontmatter, "model")) ?? "inherit";
  const options = MODELES.some((m) => m.value === actuel) ? MODELES : [...MODELES, { value: actuel, label: actuel }];

  const changer = async (model: string) => {
    if (!role.file || !parsed) return;
    setErreur(null);
    setEnCours(true);
    try {
      await changerModele(role.id, model);
    } catch (e) {
      setErreur(
        e instanceof BridgeError && e.code === "conflit"
          ? "La fiche a changé sur le disque : rouvre les Réglages pour repartir de la dernière version."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <ListeDeroulante
          variante="compact"
          libelle={`Modèle de ${role.name}`}
          value={actuel}
          options={options}
          disabled={!canEdit || !role.file || enCours}
          onChange={(m) => void changer(m)}
          className="min-w-[150px]"
        />
        <Link
          href={`/equipe?agent=${encodeURIComponent(role.id)}`}
          aria-label={`Fiche de ${role.name}`}
          title="Ouvrir sa fiche"
          className="flex size-7 items-center justify-center rounded-sm text-icone-secondaire transition-colors duration-[120ms] hover:bg-fond-survol hover:text-texte-principal"
        >
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
      {erreur && <Erreur>{erreur}</Erreur>}
    </div>
  );
}

/** L'assistant en tête du groupe : son avatar, son nom, et la fenêtre pour les changer. */
function LigneAssistant() {
  const assistant = useRole("principal");
  const { canEdit } = useAgents();
  const [ouvert, setOuvert] = useState(false);
  return (
    <div id={ancreReglage("assistant")} className="klyra-reglage -mx-4 flex scroll-mt-6 items-center gap-3 px-4 py-2.5">
      <AgentRond roleId="principal" taille={28} fondPastille="surface" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui-s font-medium text-texte-principal">
          {assistant.name} <span className="font-normal text-texte-tertiaire">· Ton assistant</span>
        </span>
        <span className="truncate text-ui-xs text-texte-tertiaire">Son nom et sa couleur, partout dans l’app.</span>
      </span>
      <Bouton variant="blanc" taille="compact" disabled={!canEdit} onClick={() => setOuvert(true)}>
        Personnaliser
      </Bouton>
      <ModalePersonnaliserAssistant ouvert={ouvert} onFermer={() => setOuvert(false)} />
    </div>
  );
}

export function Agents() {
  const router = useRouter();
  const { roles, status, dir, canEdit } = useAgents();
  const agents = roles.filter((r) => r.id !== "principal");
  const pont = getBridge()?.reglages;

  return (
    <>
      <Groupe titre="Accès des agents" description="Ce qu’un agent peut faire sans te demander. Le reste, il te le demande dans la conversation.">
        <Ligne id="acces" libelle="Niveau d’accès" description="S’applique aux prochaines réponses. Les fichiers restent limités au dossier du projet (ou à ~/.klyra/atelier hors projet)." pile>
          <ChoixAcces />
        </Ligne>
      </Groupe>

      <Groupe
        titre="Modèle de chaque agent"
        description={
          canEdit
            ? "Écrit dans la fiche de l’agent, comme depuis Mes agents. Dans une conversation, tu peux encore choisir un autre modèle pour une réponse."
            : "Les fiches se lisent et s’écrivent dans l’app de bureau."
        }
      >
        <LigneAssistant />
        <div id="reglage-modeles" className="klyra-reglage -mx-4 scroll-mt-6 px-0">
          {status === "chargement" ? (
            <Ligne libelle="Lecture des fiches…" />
          ) : agents.length === 0 ? (
            <Ligne libelle="Pas encore d’autre agent" description="Ton assistant travaille seul. Crée un agent ou prends-en un dans la bibliothèque.">
              <Bouton variant="blanc" taille="compact" onClick={() => router.push("/equipe")}>
                Mes agents
              </Bouton>
            </Ligne>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile p-0">
              {agents.map((role) => (
                <li key={role.id} className="flex items-center gap-3 px-4 py-2.5">
                  <AgentRond roleId={role.id} taille={28} fondPastille="surface" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-ui-s font-medium text-texte-principal">
                      {role.name} <span className="font-normal text-texte-tertiaire">· {role.tag}</span>
                    </span>
                    <span className="truncate text-ui-xs text-texte-tertiaire">{role.title}</span>
                  </span>
                  <ModeleAgent role={role} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Groupe>

      <Groupe titre="Fiches">
        <Ligne
          id="dossier-agents"
          libelle="Dossier des fiches"
          description={dir ? <span className="klyra-mono">{dir.replace(/^\/(Users|home)\/[^/]+/, "~")}</span> : "~/.claude/agents, lu par Claude Code."}
        >
          {pont ? (
            <Bouton
              variant="blanc"
              taille="compact"
              iconeGauche={<Icon name="folder-open-01" size={16} />}
              onClick={() => void pont.ouvrirDossier("agents")}
            >
              Ouvrir
            </Bouton>
          ) : (
            <SeulementBureau />
          )}
        </Ligne>
      </Groupe>
    </>
  );
}
