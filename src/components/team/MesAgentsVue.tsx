"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CIRCUITS } from "@/data/agents";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Apparition } from "@/components/ui/Apparition";
import { AgentRond } from "@/components/roles/AgentRond";
import { useAgents, type AgentLocal } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { useBibliotheque } from "@/lib/bibliotheque";
import { useCompte } from "@/lib/compte";
import { useDecrireAAssistant } from "@/lib/decrire-a-assistant";
import { lienDe } from "@/lib/lien-bibliotheque";
import { poste } from "@/lib/plateforme";
import { useWorkspace } from "@/lib/workspace";
import { ModalePersonnaliserAssistant } from "./PersonnaliserAssistant";
import { AgentCard } from "./AgentCard";
import { CarteNouvelAgent } from "./CarteNouvelAgent";
import { ChiffresEquipe } from "./ChiffresEquipe";
import { CircuitsAnimes } from "./CircuitsAnimes";
import { dateCourte, etiquettesDe } from "./etats-agents";

const CLE_NOTE = "klyra:agents:note-reprise";
const BANDEAU = "flex flex-wrap items-center gap-3 rounded-md border px-4 py-3";

function noteFermee(): boolean {
  try {
    return localStorage.getItem(CLE_NOTE) === "fermee";
  } catch {
    return false;
  }
}

/** La note unique d'une installation existante, au premier passage après la mise à jour (spec §6). */
function NoteReprise({ nombre }: { nombre: number }) {
  const [fermee, setFermee] = useState(noteFermee);
  const [personnaliser, setPersonnaliser] = useState(false);
  if (fermee) return null;
  const fermer = () => {
    try {
      localStorage.setItem(CLE_NOTE, "fermee");
    } catch {
      /* sans stockage, elle reviendra au prochain lancement */
    }
    setFermee(true);
  };
  return (
    <div role="status" className={`${BANDEAU} border-bordure-accent-survol bg-fond-teinte-bleue`}>
      <p className="m-0 min-w-[240px] flex-1 text-ui-s text-texte-principal">
        {nombre > 0 ? `Tes ${nombre > 1 ? `${nombre} agents` : "agents"} et leurs conversations sont toujours là. ` : "Tes conversations sont toujours là. "}
        Nouveau : ton assistant peut porter le nom de ton choix, et la Bibliothèque KLYRA rassemble les agents à ajouter.
      </p>
      <Bouton variant="sombre" taille="compact" onClick={() => setPersonnaliser(true)}>
        Personnaliser l’assistant
      </Bouton>
      <BoutonIcone taille="compact" icone={<Icon name="x-01" size={16} />} libelle="Fermer la note" data-son="fermer" onClick={fermer} />
      <ModalePersonnaliserAssistant ouvert={personnaliser} onFermer={() => setPersonnaliser(false)} />
    </div>
  );
}

/** Une ligne pour tous les agents reçus dont le lien est suspendu, ou qui attendent le réseau (spec §7). */
function LigneEtatBibliotheque({ recus }: { recus: AgentLocal[] }) {
  const router = useRouter();
  const compte = useCompte();
  const bibliotheque = useBibliotheque();
  const session = { etat: bibliotheque.etat, moiId: bibliotheque.moiId, etats: bibliotheque.etats };
  if (!recus.length || compte.etat === "indisponible" || compte.etat === "chargement") return null;
  const suspendus = recus.filter((a) => lienDe(a, session).type === "suspendu").length;
  const ici = `Ils marchent normalement sur ${poste.ce}.`;
  const pluriel = (n: number) => (n > 1 ? `${n} agents reçus` : "1 agent reçu");
  let texte: string | null = null;
  let bouton = false;
  if (compte.etat === "deconnecte" && suspendus) {
    texte = `Non connecté : les liens de ${pluriel(suspendus)} de la bibliothèque sont suspendus. ${ici}`;
    bouton = true;
  } else if (compte.etat === "retire" && suspendus) {
    texte = `Ce compte ne fait plus partie de l’équipe : les liens de ${pluriel(suspendus)} sont suspendus. ${ici}`;
  } else if (compte.etat === "connecte" && suspendus) {
    texte = `${suspendus > 1 ? `${suspendus} agents ont été reçus` : "1 agent a été reçu"} avec un autre compte : ${suspendus > 1 ? "leurs liens sont suspendus" : "son lien est suspendu"} sous ce compte. ${suspendus > 1 ? "Ils marchent" : "Il marche"} normalement sur ${poste.ce}.`;
  } else if (bibliotheque.etat === "hors-ligne") {
    texte = "Hors ligne : les mises à jour de tes agents reçus attendent le réseau.";
  }
  if (!texte) return null;
  return (
    <div role="status" className={`${BANDEAU} border-bordure-subtile bg-fond-page`}>
      <p className="m-0 min-w-[240px] flex-1 text-ui-s text-texte-secondaire">{texte}</p>
      {bouton && (
        <Bouton variant="blanc" taille="compact" onClick={() => router.push("/reglages?section=equipe")}>
          Se connecter
        </Bouton>
      )}
    </div>
  );
}

/** « Hors de Mes agents » : les désactivés et les fiches trouvées sur l'ordinateur, en lignes (spec §7). */
function HorsDeMesAgents({ agents }: { agents: AgentLocal[] }) {
  const router = useRouter();
  const { activer, ajouter, dir } = useAgents();
  const [erreur, setErreur] = useState<string | null>(null);
  if (!agents.length) return null;
  const agir = async (agent: AgentLocal) => {
    setErreur(null);
    try {
      if (agent.statut === "desactive") {
        await activer(agent.role.id, true);
        annoncer(`${agent.role.name} réactivé.`);
      } else {
        await ajouter(agent.role.id);
        annoncer(`${agent.role.name} ajouté à tes agents.`);
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <details className="group rounded-3xl border border-bordure-subtile bg-fond-page p-5" data-hors-de-mes-agents>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-ui font-semibold text-texte-principal">
        <Icon name="chevron-right" size={16} className="text-icone-secondaire transition-transform duration-[220ms] ease-sortie group-open:rotate-90" />
        Hors de Mes agents · {agents.length}
      </summary>
      <p className="m-0 mt-2 text-ui-s text-texte-secondaire">Ces agents ne peuvent pas être appelés dans l’app.</p>
      <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-bordure-subtile p-0">
        {agents.map((a) => (
          <li key={a.role.id} className="flex flex-wrap items-center gap-3 py-3" data-agent-hors={a.role.id}>
            <span className="grayscale">
              <AgentRond roleId={a.role.id} taille={28} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-ui text-texte-secondaire">
                {a.role.name} · {a.role.tag}
              </span>
              <span className="truncate text-ui-xs text-texte-tertiaire">
                {a.statut === "desactive"
                  ? a.entree?.desactiveLe
                    ? `Désactivé le ${dateCourte(a.entree.desactiveLe)}`
                    : "Désactivé"
                  : `Trouvé sur ${poste.ce} · ${dir ? `${dir.replace(/^(?:\/(?:Users|home)\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, "~")}/` : "~/.claude/agents/"}${a.role.id}.md`}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Bouton variant="blanc" taille="compact" onClick={() => void agir(a)}>
                {a.statut === "desactive" ? "Réactiver" : "Ajouter à mes agents"}
              </Bouton>
              <Bouton variant="discret" taille="compact" onClick={() => router.push(`/equipe?agent=${a.role.id}`)}>
                Voir la fiche
              </Bouton>
            </span>
          </li>
        ))}
      </ul>
      {erreur && (
        <p role="alert" className="m-0 mt-2 text-ui-s text-texte-erreur">
          {erreur}
        </p>
      )}
    </details>
  );
}

/** Mes agents (`/equipe`) : l'assistant, les agents actifs, la place du prochain, puis ce qui est hors de Mes agents. */
export function MesAgentsVue() {
  const router = useRouter();
  const { roles, tous, mes, status } = useAgents();
  const { chats } = useWorkspace().state;
  const bibliotheque = useBibliotheque();
  const decrire = useDecrireAAssistant();
  const session = { etat: bibliotheque.etat, moiId: bibliotheque.moiId, etats: bibliotheque.etats };
  const [assistant, ...agents] = roles;
  const actifs = useMemo(() => tous.filter((a) => a.statut === "actif"), [tous]);
  const hors = useMemo(
    () => [
      ...tous.filter((a) => a.statut === "desactive").sort((a, b) => (b.entree?.desactiveLe ?? 0) - (a.entree?.desactiveLe ?? 0)),
      ...tous.filter((a) => a.statut === "disponible"),
    ],
    [tous],
  );
  const recus = actifs.filter((a) => a.entree?.origine.type === "bibliotheque");
  const ids = new Set(agents.map((r) => r.id));
  const circuits = CIRCUITS.filter((c) => c.steps.every((s) => s.roleId === null || ids.has(s.roleId)));
  const conversationsDe = (id: string) => chats.filter((c) => c.roleIds.includes(id)).length;

  return (
    <div className="flex flex-col gap-5">
      {mes?.depart === "reprise" && <NoteReprise nombre={agents.length} />}
      <LigneEtatBibliotheque recus={recus} />
      <ChiffresEquipe agents={agents.length} exemple={status === "exemple"} />

      {/* L'assistant d'abord, puis les agents actifs, puis la place du prochain. */}
      <Apparition className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-4" seuil={0.05}>
        <AgentCard key={assistant.id} role={assistant} chatCount={conversationsDe(assistant.id)} ordre={0} />
        {actifs.map((agent, i) => (
          <AgentCard
            key={agent.role.id}
            role={agent.role}
            chatCount={conversationsDe(agent.role.id)}
            ordre={i + 1}
            etiquettes={etiquettesDe(agent, lienDe(agent, session))}
          />
        ))}
        <CarteNouvelAgent actif={status === "disque"} delai={240 + (actifs.length + 1) * 60} />
      </Apparition>

      <HorsDeMesAgents agents={hors} />

      {agents.length === 0 ? (
        <section className="flex flex-col gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-5">
          <p className="m-0 text-ui text-texte-secondaire">
            <span className="font-semibold text-texte-principal">Pour l’instant, {assistant.name} travaille seul.</span> Quand un besoin revient
            souvent, crée l’agent qui s’en chargera, ou prends-en un dans la bibliothèque.
          </p>
          <div className="flex flex-wrap gap-2">
            <Bouton variant="sombre" taille="compact" disabled={status !== "disque"} onClick={decrire}>
              Le décrire à {assistant.name}
            </Bouton>
            <Bouton variant="blanc" taille="compact" onClick={() => router.replace("/equipe?vue=bibliotheque")}>
              Voir la bibliothèque
            </Bouton>
          </div>
        </section>
      ) : (
        circuits.length > 0 && (
          /* Même fond que le bandeau des chiffres ; chaque circuit dans sa carte blanche. */
          <Apparition role="region" aria-labelledby="circuits-titre" className="flex flex-col gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-3">
            <div className="flex flex-col gap-1 px-2 pt-2">
              <h2 id="circuits-titre" className="m-0 text-h4 leading-[1] font-semibold tracking-[-0.04em] text-texte-principal">
                Qui passe la main à qui
              </h2>
              <p className="m-0 text-ui text-texte-secondaire">Les circuits de tes agents, de la demande à la livraison.</p>
            </div>
            <CircuitsAnimes circuits={circuits} />
          </Apparition>
        )
      )}
    </div>
  );
}
