"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { fondCarte } from "@/components/team/AgentVisuel";
import { PRINCIPAL } from "@/data/agents";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Onglets } from "@/components/ui/Onglets";
import { messageErreur } from "@/lib/compte";
import { useDecrireAAssistant } from "@/lib/decrire-a-assistant";
import { useLecturePoste } from "@/lib/poste/client";
import { idDirect } from "@/lib/workspace";
import { classerActifs, competencesCarte, ID_ASSISTANT, libelleRetour, nonLusAgent, texteConversations, type EtatsAgentsPoste, type LigneAgent } from "@/lib/telephone/agents";
import { nouvelIdFil } from "@/lib/telephone/chats";
import type { ChiffresEquipe } from "@/lib/telephone/gestes-agents";
import { useGesteTelephone } from "@/lib/telephone/geste";
import { BibliothequeAgentsTelephone, DefinitionAgentTelephone } from "./BibliothequeAgentsTelephone";
import { ErreurGeste, LigneAvecGeste, LigneRoleAgent, ONGLETS_TELEPHONE, RondAgentTelephone, useCartesAgents } from "./CommunAgentsTelephone";
import { ComparerFicheTelephone } from "./ComparerFicheTelephone";
import { EditeurFicheTelephone } from "./EditeurFicheTelephone";
import { PageOnglet } from "./EnteteTelephone";
import { FicheAgentTelephone, HistoriqueFicheTelephone } from "./FicheAgentTelephone";
import { ConfirmationFeuille, Feuille, MenuFeuille, useAppuiLong, type ActionMenu, type ActionRapide } from "./Feuille";
import { LecturesAgentTelephone } from "./LecturesAgentTelephone";
import { LouAgentTelephone } from "./LouAgentTelephone";
import { useAnnonce } from "./Annonce";
import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileChiffre, TuileIcone } from "./Liste";
import { AucunPoste, NotePoste, PosteFerme, VueLecture } from "./etats";
import { usePostes } from "./poste";

/**
 * Agents sur le téléphone (spec mobile T-08, T-09), à l'adresse du bureau : `/equipe` (Mes agents),
 * `?vue=bibliotheque`, `?agent=<id>` (sa fiche ; `&mode=modifier | lou | historique | maj`),
 * `?definition=<id>`, `?creer=1` (ou `?nouveau=1`, l'adresse du bureau) pour créer un agent.
 */
export function AgentsTelephone() {
  const params = useSearchParams();
  const agent = params.get("agent");
  /* E2-45 : les Détails du fil ouvrent `&section=souvenirs|competences|routines|utilisation`. */
  const section = params.get("section");
  const mode = params.get("mode") ?? section;
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
    if (mode === "routines") return <VersRoutines id={agent} />;
    return <FicheAgentTelephone key={agent} id={agent} />;
  }
  return <ListeAgentsTelephone />;
}

/** Les routines d'un agent vivent dans Automatisations : `section=routines` y mène, sans rester ici. */
function VersRoutines({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/routines?vue=routines&agent=${encodeURIComponent(id)}`);
  }, [id, router]);
  return null;
}

type Vue = "mes-agents" | "bibliotheque";

/** Les deux onglets à la même adresse, comme au bureau. */
function ListeAgentsTelephone() {
  const router = useRouter();
  const params = useSearchParams();
  const { liste } = useCartesAgents();
  const vue: Vue = params.get("vue") === "bibliotheque" ? "bibliotheque" : "mes-agents";
  const [creer, setCreer] = useState(false);
  return (
    <PageOnglet
      titre="Agents"
      sous={liste ? (liste.actifs.length ? `Ton assistant et ${liste.actifs.length} agent${liste.actifs.length > 1 ? "s" : ""}` : "Ton assistant") : undefined}
      droite={<BoutonIcone variant="discret" className="size-11" libelle="Créer un agent" onClick={() => setCreer(true)} icone={<Icon name="users-profiles-plus" size={24} />} />}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <Onglets<Vue>
          libelle="Agents"
          className={ONGLETS_TELEPHONE}
          valeur={vue}
          onChange={(v) => router.replace(v === "bibliotheque" ? "/equipe?vue=bibliotheque" : "/equipe")}
          onglets={[
            { id: "mes-agents", label: liste?.actifs.length ? `Mes agents ${liste.actifs.length}` : "Mes agents" },
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

  /* D-8 : « seul » n'est vrai qu'une fois les états du poste lus. */
  const vide = liste.actifs.length === 0 && liste.hors.length === 0;
  const etatsLus = prefs !== null;
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

  const actions = (agent: LigneAgent): { rapides: ActionRapide[]; lignes: ActionMenu[] } => {
    const etat = etatDe(agent.id);
    const directe = directeDe(agent.id);
    const assistantCarte = agent.id === ID_ASSISTANT;
    const ecrire = () => router.push(`/chat?id=${encodeURIComponent(ecrireVers(agent.id))}`);
    const nouveauFil = () => {
      const origine = nouvelIdFil();
      void creerFil({ origine, roleId: agent.id })
        .then(() => router.push(`/chat?id=${encodeURIComponent(origine)}`))
        .catch((e: unknown) => setEchecFile(messageErreur(e)));
    };
    const basculerEpingle = () => void agir("agents.preference", { id: agent.id, epingle: !etat?.epingle }, etat?.epingle ? `${agent.nom} n’est plus épinglé.` : `${agent.nom} épinglé.`).then((ok) => ok && etats.relancer());
    const basculerSourdine = () => void agir("agents.preference", { id: agent.id, muet: !etat?.muet }, etat?.muet ? `${agent.nom} te prévient de nouveau.` : `${agent.nom} en sourdine.`).then((ok) => ok && etats.relancer());
    const rapides: ActionRapide[] = [
      { libelle: "Écrire", icone: "message-square", onChoisir: ecrire },
      { libelle: "Nouveau fil", icone: "message-plus-01", onChoisir: nouveauFil },
    ];
    if (!assistantCarte) rapides.push({ libelle: etat?.epingle ? "Épinglé" : "Épingler", icone: "pin-01", actif: !!etat?.epingle, desactivee: !ouvert || occupe, onChoisir: basculerEpingle });
    rapides.push({ libelle: "Sourdine", icone: etat?.muet ? "volume-01" : "bell-01", actif: !!etat?.muet, desactivee: !ouvert || occupe, onChoisir: basculerSourdine });
    const listeActions: ActionMenu[] = [];
    if ((directe?.nonLus ?? 0) > 0 && directe) {
      listeActions.push({
        libelle: "Marquer comme lu",
        icone: "check-01",
        onChoisir: () => void lire({ conversationOrigine: directe.origine }).catch((e: unknown) => setEchecFile(messageErreur(e))),
      });
    }
    if (frais && etat?.enCours) {
      listeActions.push({
        libelle: "Arrêter son travail",
        icone: "stop-01",
        onChoisir: () => void agir("agents.arreter", { id: agent.id }, "Arrêt demandé.").then((ok) => ok && etats.relancer()),
        ...posteFerme,
      });
    }
    listeActions.push(
      { libelle: "Ses tickets", icone: "list", chevron: true, onChoisir: () => router.push(`/tickets?agent=${encodeURIComponent(agent.id)}`) },
      { libelle: "Ses routines", icone: "clock-01", chevron: true, onChoisir: () => router.push(`/routines?vue=routines&agent=${encodeURIComponent(agent.id)}`) },
      {
        libelle: `Copier la mention @${agent.nom}`,
        icone: "copy-left",
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
          icone: "minimise-01",
          separateurAvant: true,
          onChoisir: () => masquer(agent),
          ...posteFerme,
          note: ouvert ? "Il reste actif et appelable" : <NotePoste />,
        },
        { libelle: "Désactiver…", icone: "lock-01", onChoisir: () => setDesactiver(agent), danger: true, ...posteFerme },
      );
    }
    if (!assistantCarte && !agent.actif) {
      listeActions.push({ libelle: libelleRetour(etat), icone: "refresh-01", separateurAvant: true, onChoisir: () => remettre(agent), ...posteFerme });
    }
    return { rapides, lignes: listeActions };
  };

  const carte = (agent: LigneAgent, detail: string) => {
    const etat = etatDe(agent.id);
    const assistantCarte = agent.id === ID_ASSISTANT;
    return (
      <CarteAgentTelephone
        key={agent.id}
        agent={agent}
        role={detail}
        titre={etat?.titre}
        competences={competencesCarte(assistantCarte ? PRINCIPAL.skills : (etat?.competences ?? []))}
        travaille={frais && etat?.enCours === true}
        nonLus={nonLusAgent(agent.id, conversations ?? [])}
        muet={etat?.muet === true}
        epingle={etat?.epingle === true}
        miseAJour={etat?.miseAJour === true}
        onMenu={() => setMenu(agent)}
      />
    );
  };
  const nbConversations = (id: string) => texteConversations(liste.actifs.concat(liste.hors).find((a) => a.id === id)?.conversations ?? 0);

  return (
    <>
      <ul className="mt-4 flex list-none flex-col gap-3 p-0">
        <li>{carte(assistant, "Ton assistant")}</li>
        {visibles.map((agent) => (
          <li key={agent.id}>{carte(agent, agent.roleCourt)}</li>
        ))}
      </ul>
      {vide ? (
        aucunPoste ? (
          <AucunPoste forme="encadre" className="mt-4 px-0" phrase={(sur) => `tes agents et leurs fiches sont sur ${sur}. Ils s’affichent quand KLYRA y est ouverte.`} />
        ) : !etatsLus ? (
          <PosteFerme forme="encadre" phrase={(sur) => `tes agents s’affichent quand KLYRA est ouverte sur ${sur}.`} />
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-ui text-texte-secondaire">Pour l’instant, {assistant.nom} travaille seul.</p>
            <Bouton variant="blanc" taille="md" onClick={() => router.replace("/equipe?vue=bibliotheque")}>
              Choisir dans la bibliothèque
            </Bouton>
          </div>
        )
      ) : null}
      <button type="button" onClick={onCreer} className="mt-3 flex min-h-[72px] w-full items-center gap-3 rounded-2xl border border-dashed border-bordure-forte bg-fond-page px-4 py-3.5 text-left active:bg-fond-survol">
        <TuileIcone icone="users-profiles-plus" bleue />
        <span className="min-w-0">
          <span className="block text-body-s font-medium text-texte-principal">Créer un agent</span>
          <span className="mt-0.5 block text-ui leading-[1.35] text-texte-secondaire">Le décrire à {assistant.nom}, remplir sa fiche ou le choisir dans la bibliothèque.</span>
        </span>
      </button>

      {masques.length ? (
        <GroupeListe className="mt-4">
          <LigneListe
            debut={<TuileIcone icone="minimise-01" />}
            retrait="tuile"
            nom={masques.length === 1 ? "1 agent masqué" : `${masques.length} agents masqués`}
            ligne2={sectionMasquesOuverte ? "Toujours actifs et appelables" : masques.map((a) => a.nom).join(", ")}
            uneLigne
            onClick={ouvert ? () => setMasquesOuverts((v) => !v) : undefined}
            fin={ouvert ? <Icon name={sectionMasquesOuverte ? "chevron-down" : "chevron-right"} size={20} className="shrink-0 text-icone-secondaire" /> : null}
          />
          {sectionMasquesOuverte
            ? masques.map((agent) => (
                <LigneAvecGeste
                  key={agent.id}
                  href={`/equipe?agent=${encodeURIComponent(agent.id)}`}
                  debut={<RondAgentTelephone agentId={agent.id} nom={agent.nom} teinte={agent.teinte} taille={40} />}
                  nom={agent.nom}
                  etiquette={agent.roleCourt ? <Etiquette>{agent.roleCourt}</Etiquette> : null}
                  ligne2={`Masqué de la liste · ${nbConversations(agent.id)}`}
                  geste={
                    <Bouton
                      variant="blanc"
                      disabled={!ouvert || occupe || agent.id === retraitEnCours}
                      onClick={() => {
                        setEnRetrait((id) => (id === agent.id ? null : id));
                        void agir("agents.preference", { id: agent.id, masque: false }, `${agent.nom} de retour dans la liste.`).then((ok) => ok && etats.relancer());
                      }}
                    >
                      Afficher
                    </Bouton>
                  }
                />
              ))
            : null}
        </GroupeListe>
      ) : null}

      {liste.hors.length ? (
        <SectionListe titre="Hors de Mes agents" compte={liste.hors.length} className="mt-6">
          <p className="mb-2 px-1 text-ui text-texte-secondaire">Ces agents ne peuvent pas être appelés dans l’app.</p>
          <GroupeListe>
            {liste.hors.map((agent) => {
              const etat = etatDe(agent.id);
              const detail = etat?.statut === "desactive" ? "Désactivé" : etat?.statut === "disponible" ? "Pas encore dans Mes agents" : agent.roleCourt || "Hors de Mes agents";
              return (
                <LigneAvecGeste
                  key={agent.id}
                  href={`/equipe?agent=${encodeURIComponent(agent.id)}`}
                  debut={<RondAgentTelephone agentId={agent.id} nom={agent.nom} teinte={agent.teinte} taille={40} grise />}
                  nom={agent.nom}
                  ligne2={`${detail} · ${nbConversations(agent.id)}`}
                  geste={
                    <Bouton variant="blanc" disabled={!ouvert || occupe} onClick={() => remettre(agent)}>
                      {libelleRetour(etat)}
                    </Bouton>
                  }
                />
              );
            })}
          </GroupeListe>
          {ouvert ? null : <NotePoste className="mt-2 px-1" />}
        </SectionListe>
      ) : null}
      <ErreurGeste message={erreur?.message ?? echecFile} className="mt-3" />

      <ChiffresTelephone />

      {menu ? (
        <MenuFeuille
          titre={menu.nom}
          objet={{
            visuel: <RondAgentTelephone agentId={menu.id} nom={menu.nom} teinte={menu.teinte} taille={40} nonLus={nonLusAgent(menu.id, conversations ?? [])} travaille={frais && etatDe(menu.id)?.enCours === true} />,
            sous: [menu.id === ID_ASSISTANT ? "Ton assistant" : etatDe(menu.id)?.titre || menu.roleCourt, frais && etatDe(menu.id)?.enCours ? "travaille" : null, nonLusAgent(menu.id, conversations ?? []) ? `${nonLusAgent(menu.id, conversations ?? [])} non lu${nonLusAgent(menu.id, conversations ?? []) > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ") || undefined,
          }}
          rapides={actions(menu).rapides}
          noteRapides={ouvert ? undefined : <NotePoste />}
          actions={actions(menu).lignes}
          onFermer={() => setMenu(null)}
        />
      ) : null}
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
 * Carte teintée du bureau (lot 5) : toute la carte ouvre la fiche, l'appui long ouvre le menu.
 * Le bouton Actions est là pour le clavier et les lecteurs d'écran : pas de « ⋯ » sur la carte (D-7).
 */
export function CarteAgentTelephone({
  agent,
  role,
  titre,
  competences,
  onMenu,
  travaille = false,
  nonLus = 0,
  muet = false,
  epingle = false,
  miseAJour = false,
}: {
  agent: LigneAgent;
  role: string;
  titre?: string;
  competences?: string;
  onMenu: () => void;
  travaille?: boolean;
  nonLus?: number;
  muet?: boolean;
  epingle?: boolean;
  miseAJour?: boolean;
}) {
  const appui = useAppuiLong(onMenu);
  const etats = [role, travaille ? "Travaille" : null, nonLus > 0 ? (nonLus === 1 ? "1 non lu" : `${nonLus} non lus`) : null, muet ? "Sourdine" : null, epingle ? "Épinglé" : null, miseAJour ? "Mise à jour" : null].filter(Boolean);
  return (
    <article className="relative rounded-2xl p-1.5 transition-transform duration-[120ms] ease-sortie active:scale-[.98] motion-reduce:active:scale-100" {...appui} style={{ ...appui.style, backgroundImage: fondCarte(agent.teinte) }}>
      <Link href={`/equipe?agent=${encodeURIComponent(agent.id)}`} className="block no-underline" aria-label={[agent.nom, ...etats].join(", ")}>
        <span className="block rounded-xl border border-white bg-fond-surface px-3.5 pt-3.5 pb-3">
          <span className="flex items-center gap-3">
            <RondAgentTelephone agentId={agent.id} nom={agent.nom} teinte={agent.teinte} nonLus={nonLus} travaille={travaille} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-h4 leading-[1.1] font-semibold tracking-title text-texte-principal">{agent.nom}</span>
                {epingle ? <Icon name="pin-01" size={16} className="shrink-0 text-icone-secondaire" /> : null}
                {miseAJour ? (
                  <span className="ml-auto shrink-0">
                    <Etiquette ton="bleue">Mise à jour</Etiquette>
                  </span>
                ) : null}
              </span>
              <LigneRoleAgent teinte={agent.teinte} role={role} titre={titre} className="mt-1" />
            </span>
          </span>
          {competences ? <span className="mt-2.5 line-clamp-2 block text-ui-xs leading-[1.4] text-texte-secondaire">{competences}</span> : null}
        </span>
        <span className="flex min-h-[30px] items-center justify-between gap-3 px-2 text-ui-xs text-texte-principal">
          <span className="min-w-0 truncate">
            {texteConversations(agent.conversations)}
            {muet ? " · en sourdine" : ""}
          </span>
          {travaille ? <span className="shrink-0 font-semibold text-texte-accent">Travaille…</span> : <span className="shrink-0 text-texte-secondaire">{nonLus > 0 ? (nonLus === 1 ? "1 non lu" : `${nonLus} non lus`) : "Voir la fiche"}</span>}
        </span>
      </Link>
      <button type="button" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:right-2 focus:min-h-11 focus:rounded-xs focus:bg-fond-surface focus:px-2 focus:text-ui" onClick={onMenu}>
        Actions pour {agent.nom}
      </button>
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
  const lignes = [
    { nom: `Le décrire à ${assistant}`, icone: "message-square", bleue: true, texte: "Dis-lui ce dont tu as besoin : il prépare la fiche avec toi.", onClick: decrire, inactive: false },
    { nom: "Remplir la fiche moi-même", icone: "file-plus-01", bleue: false, texte: "Pour qui sait déjà ce qu’il veut écrire.", onClick: () => router.push("/equipe?creer=1"), inactive: !ouvert },
    { nom: "Choisir dans la bibliothèque", icone: "layers-01", bleue: false, texte: "Des agents prêts, partagés par l’équipe ou par KLYRA.", onClick: () => router.replace("/equipe?vue=bibliotheque"), inactive: false },
  ] as const;
  return (
    <Feuille titre="Créer un agent" onFermer={onFermer}>
      <GroupeListe>
        {lignes.map((l) => (
          <LigneListe
            key={l.nom}
            debut={<TuileIcone icone={l.icone} bleue={l.bleue} />}
            retrait="tuile"
            nom={l.nom}
            ligne2={l.texte}
            fin="chevron"
            inactive={l.inactive}
            raison={<NotePoste />}
            onClick={() => {
              onFermer();
              l.onClick();
            }}
          />
        ))}
      </GroupeListe>
    </Feuille>
  );
}

/** « L'équipe en chiffres » : calculée sur l'ordinateur, lue seulement quand on la déplie. */
function ChiffresTelephone() {
  const [deplie, setDeplie] = useState(true);
  const lecture = useLecturePoste<ChiffresEquipe>("agents.chiffres", deplie ? {} : null);
  return (
    <details open className="group mt-6" onToggle={(e) => setDeplie(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-1 text-ui font-semibold text-texte-principal">
        L’équipe en chiffres
        <Icon name="chevron-right" size={20} className="ml-auto text-icone-secondaire transition-transform duration-[220ms] ease-sortie group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      {deplie ? (
        <div className="-mx-4 mt-1">
          <VueLecture lecture={lecture} lignes={4} verrou={false} ferme={(sur) => `les chiffres de l’équipe se calculent sur ${sur}. Ils s’affichent quand KLYRA y est ouverte.`}>
            {(c) => (
              <div className="grid grid-cols-2 gap-2 px-4">
                <TuileChiffre icone="users-profiles-01" valeur={c.agents} libelle="Agents" detail="Dans Mes agents" />
                <TuileChiffre icone="message-square" valeur={c.chats} libelle="Chats en cours" detail={`${c.chatsAujourdhui} actif${c.chatsAujourdhui > 1 ? "s" : ""} aujourd’hui`} />
                <TuileChiffre icone="folder" valeur={c.projetsActifs} libelle="Projets actifs" detail={`Sur ${c.projets} projets`} />
                <TuileChiffre icone="stars" valeur={c.tachesEnCours} libelle="Tâches en cours" detail={`${c.tachesFaites} déjà faite${c.tachesFaites > 1 ? "s" : ""}`} />
              </div>
            )}
          </VueLecture>
        </div>
      ) : null}
    </details>
  );
}
