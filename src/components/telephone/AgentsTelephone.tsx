"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { Onglets } from "@/components/ui/Onglets";
import { useDecrireAAssistant } from "@/lib/decrire-a-assistant";
import { useLecturePoste } from "@/lib/poste/client";
import { useLieuActif } from "@/lib/lieux";
import { useDirectEspace } from "@/lib/telephone/espace";
import { ID_ASSISTANT, libelleRetour, texteConversations, type EtatsAgentsPoste, type LigneAgent } from "@/lib/telephone/agents";
import type { ChiffresEquipe } from "@/lib/telephone/gestes-agents";
import { useGesteTelephone } from "@/lib/telephone/geste";
import { BibliothequeAgentsTelephone, DefinitionAgentTelephone } from "./BibliothequeAgentsTelephone";
import { BoutonMenu, ErreurGeste, ONGLETS_TELEPHONE, TitreGroupe, useCartesAgents } from "./CommunAgentsTelephone";
import { ComparerFicheTelephone } from "./ComparerFicheTelephone";
import { EditeurFicheTelephone } from "./EditeurFicheTelephone";
import { PageOnglet } from "./EnteteTelephone";
import { FicheAgentTelephone, HistoriqueFicheTelephone } from "./FicheAgentTelephone";
import { ConfirmationFeuille, MenuFeuille, useAppuiLong, type ActionMenu } from "./Feuille";
import { LouAgentTelephone } from "./LouAgentTelephone";
import { AucunPoste, NotePoste, VueLecture } from "./etats";
import { usePostes } from "./poste";

/**
 * Agents sur le téléphone (spec mobile T-08, T-09), à l'adresse du bureau : `/equipe` (Mes agents),
 * `?vue=bibliotheque`, `?agent=<id>` (sa fiche ; `&mode=modifier | lou | historique | maj`),
 * `?definition=<id>`, `?creer=1` (ou `?nouveau=1`, l'adresse du bureau) pour créer un agent.
 */
export function AgentsTelephone() {
  const params = useSearchParams();
  const agent = params.get("agent");
  const mode = params.get("mode");
  const definition = params.get("definition");
  if (params.get("creer") || params.get("nouveau")) return <EditeurFicheTelephone id={null} />;
  if (definition) return <DefinitionAgentTelephone id={definition} />;
  if (agent) {
    if (mode === "modifier") return <EditeurFicheTelephone key={agent} id={agent} />;
    if (mode === "lou") return <LouAgentTelephone key={agent} id={agent} />;
    if (mode === "historique") return <HistoriqueFicheTelephone key={agent} id={agent} />;
    if (mode === "maj") return <ComparerFicheTelephone key={agent} id={agent} />;
    return <FicheAgentTelephone key={agent} id={agent} />;
  }
  return <ListeAgentsTelephone />;
}

type Vue = "mes-agents" | "bibliotheque";

/** Les deux onglets à la même adresse, comme au bureau. */
function ListeAgentsTelephone() {
  const router = useRouter();
  const params = useSearchParams();
  const vue: Vue = params.get("vue") === "bibliotheque" ? "bibliotheque" : "mes-agents";
  const [creer, setCreer] = useState(false);
  return (
    <PageOnglet titre="Agents">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <Onglets<Vue>
          libelle="Agents"
          className={ONGLETS_TELEPHONE}
          valeur={vue}
          onChange={(v) => router.replace(v === "bibliotheque" ? "/equipe?vue=bibliotheque" : "/equipe")}
          onglets={[
            { id: "mes-agents", label: "Mes agents" },
            { id: "bibliotheque", label: "Bibliothèque KLYRA" },
          ]}
        />
        {vue === "bibliotheque" ? <BibliothequeAgentsTelephone /> : <MesAgentsTelephone onCreer={() => setCreer(true)} />}
      </div>
      {creer ? <FeuilleCreerAgent onFermer={() => setCreer(false)} /> : null}
    </PageOnglet>
  );
}

/** Mes agents : l'assistant, les agents actifs, « Hors de Mes agents », puis l'équipe en chiffres (repliée). */
function MesAgentsTelephone({ onCreer }: { onCreer: () => void }) {
  const lieu = useLieuActif();
  const direct = useDirectEspace();
  const router = useRouter();
  const { liste } = useCartesAgents();
  const etats = useLecturePoste<EtatsAgentsPoste>("agents.etats", {});
  const { agir, occupe, ouvert, bandeau, erreur } = useGesteTelephone();
  const { postes } = usePostes();
  const aucunPoste = postes?.length === 0;
  const [menu, setMenu] = useState<LigneAgent | null>(null);
  const [desactiver, setDesactiver] = useState<LigneAgent | null>(null);
  const etatDe = (id: string) => (etats.etat === "ok" ? etats.data.agents.find((a) => a.id === id) : undefined);

  if (!liste) {
    return (
      <ul className="mt-4 flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="h-16 rounded-md bg-fond-surface-grise" />
        ))}
      </ul>
    );
  }

  const vide = liste.actifs.length === 0 && liste.hors.length === 0;
  const assistant = liste.assistant;
  const remettre = (agent: LigneAgent) =>
    void agir("agents.activer", { id: agent.id, actif: true }, `${agent.nom} est de retour dans tes agents.`).then((ok) => ok && etats.relancer());

  const actions = (agent: LigneAgent): ActionMenu[] => {
    /* Les fiches d'un VPS se modifient depuis l'app de bureau, sur ce serveur : ce geste-là irait à l'ordinateur. */
    const poste = lieu
      ? { desactivee: true, note: <span>Depuis l’app de bureau, sur ce serveur.</span> }
      : { desactivee: !ouvert || occupe, note: ouvert ? undefined : <NotePoste /> };
    const fiche = { libelle: "Voir la fiche", onChoisir: () => router.push(`/equipe?agent=${encodeURIComponent(agent.id)}`) };
    if (agent.id === ID_ASSISTANT) return [{ libelle: "Écrire", onChoisir: () => router.push(`/chat?id=${encodeURIComponent(direct(agent.id))}`) }, fiche];
    if (agent.actif) {
      return [
        { libelle: "Écrire", onChoisir: () => router.push(`/chat?id=${encodeURIComponent(direct(agent.id))}`) },
        fiche,
        { libelle: "Désactiver", onChoisir: () => setDesactiver(agent), danger: true, ...poste },
      ];
    }
    return [fiche, { libelle: libelleRetour(etatDe(agent.id)), onChoisir: () => remettre(agent), ...poste }];
  };

  return (
    <>
      <ul className="mt-3">
        <LigneAgentTelephone agent={assistant} detail={`Ton assistant · ${texteConversations(assistant.conversations)}`} onMenu={() => setMenu(assistant)} />
        {liste.actifs.map((agent) => (
          <LigneAgentTelephone key={agent.id} agent={agent} detail={`${agent.roleCourt} · ${texteConversations(agent.conversations)}`} onMenu={() => setMenu(agent)} />
        ))}
      </ul>
      {/* C-1d : jamais « Aucun agent » au-dessus de la ligne de l'assistant ; sans ordinateur, comment le relier. */}
      {vide ? (
        aucunPoste ? (
          <AucunPoste forme="encadre" className="mt-4 px-0" phrase={(sur) => `tes agents et leurs fiches sont sur ${sur}. Ils s’affichent quand KLYRA y est ouverte.`} />
        ) : (
          <p className="mt-2 text-ui text-texte-secondaire">Pour l’instant, {assistant.nom} travaille seul.</p>
        )
      ) : null}
      <Bouton variant="blanc" taille="md" className="mt-4 w-full" iconeGauche={<Icon name="users-profiles-plus" size={20} />} onClick={onCreer}>
        Créer un agent
      </Bouton>

      {liste.hors.length ? (
        <>
          <TitreGroupe>Hors de Mes agents · {liste.hors.length}</TitreGroupe>
          <p className="text-ui-xs text-texte-secondaire">Ces agents ne peuvent pas être appelés dans l’app.</p>
          <ul>
            {liste.hors.map((agent) => {
              const etat = etatDe(agent.id);
              const detail = etat?.statut === "desactive" ? "Désactivé" : etat?.statut === "disponible" ? "Pas encore dans Mes agents" : agent.roleCourt;
              return <LigneAgentTelephone key={agent.id} agent={agent} detail={`${detail} · ${texteConversations(agent.conversations)}`} grise onMenu={() => setMenu(agent)} />;
            })}
          </ul>
        </>
      ) : null}
      <ErreurGeste message={erreur?.message} className="mt-3" />

      <ChiffresTelephone />

      {menu ? <MenuFeuille titre={menu.nom} actions={actions(menu)} onFermer={() => setMenu(null)} /> : null}
      {desactiver ? (
        <ConfirmationFeuille
          titre={`Désactiver ${desactiver.nom} ?`}
          texte={`${desactiver.nom} ne pourra plus être appelé dans KLYRA : ni par toi, ni par ${assistant.nom}, ni par tes autres agents. S’il travaille, sa réponse en cours s’arrête. Ses conversations et sa fiche sont gardées, et tu pourras le réactiver.`}
          confirmer="Désactiver"
          danger
          onConfirmer={() => void agir("agents.activer", { id: desactiver.id, actif: false }, `${desactiver.nom} désactivé.`).then((ok) => ok && etats.relancer())}
          onFermer={() => setDesactiver(null)}
        />
      ) : null}
      {bandeau}
    </>
  );
}

/** Une ligne de 64 px : avatar 36, nom, rôle court et conversations ; « ⋯ » et l'appui long ouvrent le même menu. */
export function LigneAgentTelephone({ agent, detail, onMenu, grise = false }: { agent: LigneAgent; detail: string; onMenu: () => void; grise?: boolean }) {
  const appui = useAppuiLong(onMenu);
  return (
    <li className="flex min-h-16 items-center gap-2 border-b border-bordure-subtile" {...appui}>
      <Link href={`/equipe?agent=${encodeURIComponent(agent.id)}`} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 active:bg-fond-survol">
        <span className={grise ? "grayscale" : undefined}>
          <RondApercu agentId={agent.id} nom={agent.nom} teinte={agent.teinte} taille={36} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-s text-texte-principal">{agent.nom}</span>
          <span className="truncate text-ui-xs text-texte-secondaire">{detail}</span>
        </span>
      </Link>
      <BoutonMenu libelle={`Options de ${agent.nom}`} onClick={onMenu} />
    </li>
  );
}

/** « Créer un agent » (spec T-08) : le décrire à l'assistant (File), la fiche (Poste), la bibliothèque. */
export function FeuilleCreerAgent({ onFermer }: { onFermer: () => void }) {
  const router = useRouter();
  const decrire = useDecrireAAssistant();
  const { liste } = useCartesAgents();
  const { ouvert } = usePostes();
  const assistant = liste?.assistant.nom ?? "ton assistant";
  const detail = (texte: string) => <p className="text-ui-xs text-texte-secondaire">{texte}</p>;
  return (
    <MenuFeuille
      titre="Créer un agent"
      onFermer={onFermer}
      actions={[
        { libelle: `Le décrire à ${assistant}`, onChoisir: decrire, note: detail("Dis-lui ce dont tu as besoin : il prépare la fiche.") },
        {
          libelle: "Remplir la fiche moi-même",
          onChoisir: () => router.push("/equipe?creer=1"),
          desactivee: !ouvert,
          note: ouvert ? detail("Pour qui sait déjà ce qu’il veut écrire.") : <NotePoste />,
        },
        { libelle: "Choisir dans la bibliothèque", onChoisir: () => router.replace("/equipe?vue=bibliotheque"), note: detail("Des agents prêts, partagés par l’équipe ou par KLYRA.") },
      ]}
    />
  );
}

/** « L'équipe en chiffres » : calculée sur l'ordinateur, lue seulement quand on la déplie. */
function ChiffresTelephone() {
  const [deplie, setDeplie] = useState(false);
  const lecture = useLecturePoste<ChiffresEquipe>("agents.chiffres", deplie ? {} : null);
  return (
    <details className="group mt-6 border-t border-bordure-subtile" onToggle={(e) => setDeplie(e.currentTarget.open)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-body-s text-texte-principal">
        <Icon name="chevron-right" size={20} className="text-icone-secondaire transition-transform duration-[220ms] ease-sortie group-open:rotate-90 motion-reduce:transition-none" />
        L’équipe en chiffres
      </summary>
      {deplie ? (
        <div className="-mx-4">
          <VueLecture lecture={lecture} lignes={4} ferme={(sur) => `les chiffres de l’équipe se calculent sur ${sur}. Ils s’affichent quand KLYRA y est ouverte.`}>
            {(c) => (
              <ul className="px-4">
                {[
                  ["Agents dans l’équipe", c.agents, "Dans Mes agents"],
                  ["Chats en cours", c.chats, `${c.chatsAujourdhui} actif${c.chatsAujourdhui > 1 ? "s" : ""} aujourd’hui`],
                  ["Projets actifs", c.projetsActifs, `Sur ${c.projets} projets`],
                  ["Tâches en cours", c.tachesEnCours, `${c.tachesFaites} déjà faite${c.tachesFaites > 1 ? "s" : ""}`],
                ].map(([libelle, valeur, detail]) => (
                  <li key={libelle} className="flex min-h-12 items-center justify-between gap-3 border-b border-bordure-subtile py-2">
                    <span className="flex flex-col">
                      <span className="text-body-s text-texte-principal">{libelle}</span>
                      <span className="text-ui-xs text-texte-secondaire">{detail}</span>
                    </span>
                    <span className="klyra-mono text-h4 font-semibold text-texte-principal">{valeur}</span>
                  </li>
                ))}
              </ul>
            )}
          </VueLecture>
        </div>
      ) : null}
    </details>
  );
}
