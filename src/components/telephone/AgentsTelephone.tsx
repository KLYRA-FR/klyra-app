"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { fondCarte } from "@/components/team/AgentVisuel";
import { Bouton } from "@/components/ui/Bouton";
import { Onglets } from "@/components/ui/Onglets";
import { messageErreur } from "@/lib/compte";
import { useDecrireAAssistant } from "@/lib/decrire-a-assistant";
import { useLecturePoste } from "@/lib/poste/client";
import { idDirect } from "@/lib/workspace";
import { classerActifs, ID_ASSISTANT, libelleRetour, nonLusAgent, texteConversations, type EtatsAgentsPoste, type LigneAgent } from "@/lib/telephone/agents";
import { nouvelIdFil } from "@/lib/telephone/chats";
import type { ChiffresEquipe } from "@/lib/telephone/gestes-agents";
import { useGesteTelephone } from "@/lib/telephone/geste";
import { BibliothequeAgentsTelephone, DefinitionAgentTelephone } from "./BibliothequeAgentsTelephone";
import { ErreurGeste, ONGLETS_TELEPHONE, TitreGroupe, useCartesAgents } from "./CommunAgentsTelephone";
import { ComparerFicheTelephone } from "./ComparerFicheTelephone";
import { EditeurFicheTelephone } from "./EditeurFicheTelephone";
import { PageOnglet } from "./EnteteTelephone";
import { FicheAgentTelephone, HistoriqueFicheTelephone } from "./FicheAgentTelephone";
import { ConfirmationFeuille, MenuFeuille, useAppuiLong, type ActionMenu } from "./Feuille";
import { LecturesAgentTelephone } from "./LecturesAgentTelephone";
import { LouAgentTelephone } from "./LouAgentTelephone";
import { useAnnonce } from "./Annonce";
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
    if (mode === "souvenirs" || mode === "competences" || mode === "utilisation") {
      return <LecturesAgentTelephone key={`${agent}-${mode}`} id={agent} mode={mode} />;
    }
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

/** Mes agents : cartes teintées, l'assistant, les actifs, les masqués, « Hors de Mes agents », puis les chiffres. */
function MesAgentsTelephone({ onCreer }: { onCreer: () => void }) {
  const router = useRouter();
  const { liste, conversations } = useCartesAgents();
  const etats = useLecturePoste<EtatsAgentsPoste>("agents.etats", {});
  const { agir, occupe, ouvert, bandeau, erreur } = useGesteTelephone();
  const { postes } = usePostes();
  const annoncer = useAnnonce();
  const creerFil = useMutation(api.operationsFile.creerFil);
  const lire = useMutation(api.operationsFile.marquerLu);
  const aucunPoste = postes?.length === 0;
  const [menu, setMenu] = useState<LigneAgent | null>(null);
  const [desactiver, setDesactiver] = useState<LigneAgent | null>(null);
  const [masquesOuverts, setMasquesOuverts] = useState(false);
  const [enRetrait, setEnRetrait] = useState<string | null>(null);
  const [echecFile, setEchecFile] = useState<string | null>(null);
  const [squelette, setSquelette] = useState(false);
  const prefs = etats.etat === "ok" ? etats.data.agents : etats.etat === "ferme" ? (etats.gardee?.data.agents ?? null) : null;
  const frais = etats.etat === "ok";
  const etatDe = (id: string) => prefs?.find((a) => a.id === id);

  useEffect(() => {
    if (liste) return;
    const minuteur = window.setTimeout(() => setSquelette(true), 300);
    return () => window.clearTimeout(minuteur);
  }, [liste]);
  const sectionMasquesOuverte = !ouvert || masquesOuverts;
  const retraitEnCours = enRetrait && prefs?.some((a) => a.id === enRetrait && a.masque) ? null : enRetrait;

  if (!liste) {
    if (!squelette) return <div className="mt-4 min-h-16" aria-busy="true" />;
    return (
      <ul className="mt-4 flex flex-col gap-3" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="h-28 rounded-2xl bg-fond-surface-grise" />
        ))}
      </ul>
    );
  }

  const vide = liste.actifs.length === 0 && liste.hors.length === 0;
  const assistant = liste.assistant;
  const classes = classerActifs(liste.actifs, prefs);
  const visibles = classes.visibles.filter((a) => a.id !== retraitEnCours);
  const masques = retraitEnCours
    ? [...classes.masques, ...liste.actifs.filter((a) => a.id === retraitEnCours && classes.masques.every((m) => m.id !== a.id))]
    : classes.masques;
  const directeDe = (id: string) => conversations?.find((c) => c.kind === "direct" && !c.parent && c.roleIds.includes(id));
  const ecrireVers = (id: string) => directeDe(id)?.origine ?? idDirect(id);
  const remettre = (agent: LigneAgent) =>
    void agir("agents.activer", { id: agent.id, actif: true }, `${agent.nom} est de retour dans tes agents.`).then((ok) => ok && etats.relancer());
  const posteFerme = { desactivee: !ouvert || occupe, note: ouvert ? undefined : <NotePoste /> };

  const masquer = (agent: LigneAgent) => {
    setEnRetrait(agent.id);
    annoncer({
      texte: `${agent.nom} quitte la liste. Il reste appelable.`,
      action: {
        libelle: "Annuler",
        onChoisir: () => setEnRetrait((id) => (id === agent.id ? null : id)),
      },
      onFin: () => {
        void agir("agents.preference", { id: agent.id, masque: true }, `${agent.nom} masqué.`).then((ok) => {
          if (ok) etats.relancer();
          else setEnRetrait((courant) => (courant === agent.id ? null : courant));
        });
      },
    });
  };

  const actions = (agent: LigneAgent): ActionMenu[] => {
    const etat = etatDe(agent.id);
    const directe = directeDe(agent.id);
    const assistantCarte = agent.id === ID_ASSISTANT;
    const ecrire = { libelle: "Écrire", onChoisir: () => router.push(`/chat?id=${encodeURIComponent(ecrireVers(agent.id))}`) };
    const nouveauFil = {
      libelle: "Nouveau fil",
      onChoisir: () => {
        const origine = nouvelIdFil();
        void creerFil({ origine, roleId: agent.id })
          .then(() => router.push(`/chat?id=${encodeURIComponent(origine)}`))
          .catch((e: unknown) => setEchecFile(messageErreur(e)));
      },
    };
    const fiche = { libelle: "Voir la fiche", onChoisir: () => router.push(`/equipe?agent=${encodeURIComponent(agent.id)}`) };
    const listeActions: ActionMenu[] = [
      ecrire,
      nouveauFil,
      ...(!assistantCarte
        ? [
            {
              libelle: etat?.epingle ? "Désépingler" : "Épingler",
              onChoisir: () => void agir("agents.preference", { id: agent.id, epingle: !etat?.epingle }, etat?.epingle ? `${agent.nom} n’est plus épinglé.` : `${agent.nom} épinglé.`).then((ok) => ok && etats.relancer()),
              ...posteFerme,
            },
          ]
        : []),
      {
        libelle: etat?.muet ? "En sourdine" : "Sourdine",
        onChoisir: () => void agir("agents.preference", { id: agent.id, muet: !etat?.muet }, etat?.muet ? `${agent.nom} te prévient de nouveau.` : `${agent.nom} en sourdine.`).then((ok) => ok && etats.relancer()),
        ...posteFerme,
      },
    ];
    if ((directe?.nonLus ?? 0) > 0 && directe) {
      listeActions.push({
        libelle: "Marquer comme lu",
        onChoisir: () => void lire({ conversationOrigine: directe.origine }).catch((e: unknown) => setEchecFile(messageErreur(e))),
      });
    }
    if (frais && etat?.enCours) {
      listeActions.push({
        libelle: "Arrêter son travail",
        onChoisir: () => void agir("agents.arreter", { id: agent.id }, "Arrêt demandé.").then((ok) => ok && etats.relancer()),
        ...posteFerme,
      });
    }
    listeActions.push(
      { libelle: "Ses tickets", onChoisir: () => router.push(`/tickets?agent=${encodeURIComponent(agent.id)}`) },
      { libelle: "Ses routines", onChoisir: () => router.push(`/routines?vue=routines&agent=${encodeURIComponent(agent.id)}`) },
      fiche,
      {
        libelle: `Copier la mention @${agent.nom}`,
        onChoisir: () => void navigator.clipboard?.writeText(`@${agent.nom}`).then(
          () => undefined,
          () => setEchecFile("La mention n’a pas été copiée."),
        ),
      },
    );
    if (!assistantCarte && agent.actif) {
      listeActions.push(
        {
          libelle: "Masquer de la liste",
          onChoisir: () => masquer(agent),
          ...posteFerme,
          note: ouvert ? <p className="text-ui-xs text-texte-secondaire">Il reste actif et appelable.</p> : <NotePoste />,
        },
        { libelle: "Désactiver", onChoisir: () => setDesactiver(agent), danger: true, ...posteFerme },
      );
    }
    if (!assistantCarte && !agent.actif) {
      listeActions.push({ libelle: libelleRetour(etat), onChoisir: () => remettre(agent), ...posteFerme });
    }
    return listeActions;
  };

  const carte = (agent: LigneAgent, detail: string, grise = false) => {
    const etat = etatDe(agent.id);
    const nonLus = nonLusAgent(agent.id, conversations ?? []);
    return (
      <CarteAgentTelephone
        key={agent.id}
        agent={agent}
        detail={detail}
        grise={grise}
        travaille={frais && etat?.enCours === true}
        nonLus={nonLus}
        muet={etat?.muet === true}
        epingle={etat?.epingle === true}
        onMenu={() => setMenu(agent)}
      />
    );
  };

  return (
    <>
      <ul className="mt-4 flex list-none flex-col gap-3 p-0">
        <li>{carte(assistant, "Ton assistant")}</li>
        {visibles.map((agent) => (
          <li key={agent.id}>{carte(agent, agent.roleCourt || "Agent")}</li>
        ))}
      </ul>
      {vide ? (
        aucunPoste ? (
          <AucunPoste forme="encadre" className="mt-4 px-0" phrase={(sur) => `tes agents et leurs fiches sont sur ${sur}. Ils s’affichent quand KLYRA y est ouverte.`} />
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-ui text-texte-secondaire">Pour l’instant, {assistant.nom} travaille seul.</p>
            <Bouton variant="blanc" taille="md" onClick={() => router.replace("/equipe?vue=bibliotheque")}>
              Choisir dans la bibliothèque
            </Bouton>
          </div>
        )
      ) : null}
      <Bouton variant="blanc" taille="md" className="mt-4 w-full" iconeGauche={<Icon name="users-profiles-plus" size={20} />} onClick={onCreer}>
        Créer un agent
      </Bouton>

      {masques.length ? (
        <div className="mt-6">
          <button type="button" className="flex min-h-11 w-full items-center gap-2 text-left text-body-s text-texte-principal" aria-expanded={sectionMasquesOuverte} onClick={() => { if (ouvert) setMasquesOuverts((v) => !v); }}>
            <Icon name="chevron-right" size={20} className={sectionMasquesOuverte ? "rotate-90 text-icone-secondaire" : "text-icone-secondaire"} />
            Agents masqués · {masques.length}
          </button>
          {sectionMasquesOuverte ? (
            <ul className="mt-2 flex list-none flex-col gap-3 p-0">
              {masques.map((agent) => (
                <li key={agent.id}>
                  {carte(agent, "Masqué · il reste appelable")}
                  <Bouton
                    variant="blanc"
                    taille="md"
                    className="mt-2"
                    disabled={!ouvert || occupe || agent.id === retraitEnCours}
                    onClick={() => {
                      setEnRetrait((id) => (id === agent.id ? null : id));
                      void agir("agents.preference", { id: agent.id, masque: false }, `${agent.nom} de retour dans la liste.`).then((ok) => ok && etats.relancer());
                    }}
                  >
                    Afficher
                  </Bouton>
                  {ouvert ? null : <NotePoste />}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {liste.hors.length ? (
        <>
          <TitreGroupe>Hors de Mes agents · {liste.hors.length}</TitreGroupe>
          <p className="text-ui-xs text-texte-secondaire">Ces agents ne peuvent pas être appelés dans l’app.</p>
          <ul className="mt-2 flex list-none flex-col gap-3 p-0">
            {liste.hors.map((agent) => {
              const etat = etatDe(agent.id);
              const detail = etat?.statut === "desactive" ? "Désactivé" : etat?.statut === "disponible" ? "Pas encore dans Mes agents" : agent.roleCourt || "Hors de Mes agents";
              return (
                <li key={agent.id}>
                  {carte(agent, detail, true)}
                  <Bouton variant="blanc" taille="md" className="mt-2" disabled={!ouvert || occupe} onClick={() => remettre(agent)}>
                    {libelleRetour(etat)}
                  </Bouton>
                  {ouvert ? null : <NotePoste />}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <ErreurGeste message={erreur?.message ?? echecFile} className="mt-3" />

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

/**
 * Carte teintée (lot 5) : ouverture de la fiche, appui long pour le menu.
 * Le bouton Actions est là pour le clavier : pas de « ⋯ » sur la carte.
 */
export function CarteAgentTelephone({
  agent,
  detail,
  onMenu,
  grise = false,
  travaille = false,
  nonLus = 0,
  muet = false,
  epingle = false,
}: {
  agent: LigneAgent;
  detail: string;
  onMenu: () => void;
  grise?: boolean;
  travaille?: boolean;
  nonLus?: number;
  muet?: boolean;
  epingle?: boolean;
}) {
  const appui = useAppuiLong(onMenu);
  const etats = [travaille ? "Travaille" : null, nonLus > 0 ? (nonLus === 1 ? "1 non lu" : `${nonLus} non lus`) : null, muet ? "Sourdine" : null, epingle ? "Épinglé" : null].filter(Boolean);
  return (
    <article className="flex flex-col gap-2 rounded-2xl p-2" {...appui} style={{ ...appui.style, backgroundImage: fondCarte(agent.teinte) }}>
        <div className="flex items-start gap-2 rounded-lg border border-white bg-fond-surface px-3 py-3">
          <Link
            href={`/equipe?agent=${encodeURIComponent(agent.id)}`}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md active:scale-[.98] motion-reduce:active:scale-100"
            aria-label={`${agent.nom}${detail ? `, ${detail}` : ""}${etats.length ? `, ${etats.join(", ")}` : ""}`}
          >
            <span className={grise ? "grayscale" : undefined}>
              <RondApercu agentId={agent.id} nom={agent.nom} teinte={agent.teinte} taille={44} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body font-semibold text-texte-principal">{agent.nom}</span>
              {detail ? <span className="truncate text-ui text-texte-secondaire">{detail}</span> : null}
              {etats.length ? (
                <span className="truncate text-ui-xs text-texte-secondaire">
                  {travaille ? <span className="mr-1 inline-block size-1.5 rounded-full bg-texte-accent motion-safe:animate-pulse" aria-hidden="true" /> : null}
                  {etats.join(" · ")}
                </span>
              ) : null}
            </span>
          </Link>
          <button type="button" className="sr-only focus:not-sr-only focus:min-h-11 focus:px-2 focus:text-ui" onClick={onMenu}>
            Actions pour {agent.nom}
          </button>
        </div>
        <div className="rounded-lg border border-white bg-fond-surface px-3 py-2 text-ui-xs text-texte-principal">{texteConversations(agent.conversations)}</div>
      </article>
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
