"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "klyra-ui";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { useAgents, type AgentLocal } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { demanderEcriture } from "@/lib/brouillons";
import { formatTime } from "@/lib/format";
import { jouer } from "@/lib/sons/sons";
import { dansEspace, useLieuActif } from "@/lib/lieux";
import { AutreServeur } from "@/components/shell/AutreServeur";
import { texteDe, useChat, useChatMessages, useProject, useRoles, useWorkspace } from "@/lib/workspace";
import { AgentsEnCours } from "./AgentsEnCours";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { ConseilContexte } from "./ConseilContexte";
import { MessageThread } from "./MessageThread";
import { MessageExport } from "./MessageExport";
import { useExporterConversation } from "./useExporterConversation";
import { OngletsFils } from "./OngletsFils";
import { useImagesOuvertes } from "./ImageJointe";
import { OUVRIR_PANNEAU_AGENT, PanneauLateral, surReglages, usePanneauLateral } from "./PanneauLateral";
import { useActiviteNavigateur } from "@/lib/navigateur";
import { AtelierEquipe } from "./atelier-equipe/AtelierEquipe";
import { OUVRIR_ATELIER_EQUIPE, type DemandeAtelierEquipe } from "./atelier-equipe/ouvrir";
import type { DemandeApercu } from "@/components/ui/Lien";

/** « Modifié par Dev · 09:52 » : dernier journal de travail du chat. */
function useModifiedLabel(chatId: string): string | null {
  const messages = useChatMessages(chatId);
  const roles = useRoles();
  return useMemo(() => {
    const last = messages.findLast((m) => m.parts.some((p) => p.type === "worklog"));
    if (!last || last.author.kind !== "role") return null;
    const { roleId } = last.author;
    const name = roles.find((r) => r.id === roleId)?.name;
    return `Modifié par ${name} · ${formatTime(last.createdAt)}`;
  }, [messages, roles]);
}

/** Une adresse de serveur local dans un texte : « localhost:3000 », « http://127.0.0.1:5173/page ». */
const ADRESSE_LOCALE = /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):\d{2,5}(?:\/[^\s)`'"*<>]*)?/;

/** La dernière adresse locale donnée par un agent (ex. après « j'ai lancé le site »), avec son message. */
function useAdresseAnnoncee(chatId: string): { id: string; url: string } | null {
  const messages = useChatMessages(chatId);
  return useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.author.kind !== "role" || m.statut !== "fait") continue;
      const trouve = texteDe(m).match(ADRESSE_LOCALE);
      if (trouve) return { id: m.id, url: trouve[0].replace(/^https?:\/\//, "").replace(/[.,;:]+$/, "") };
    }
    return null;
  }, [messages]);
}

/**
 * La conversation d'un agent hors de Mes agents se lit sans composeur : à sa
 * place, ce qui se passe et le geste pour le remettre (désactivé : Réactiver ;
 * trouvé sur l'ordinateur : l'ajouter). Le composeur revient aussitôt, prêt à écrire.
 */
function BarreHorsDeMesAgents({ agent, chatId }: { agent: AgentLocal; chatId: string }) {
  const { activer, ajouter } = useAgents();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const { id, name } = agent.role;
  const desactive = agent.statut === "desactive";

  const agir = async () => {
    setEnCours(true);
    setErreur(null);
    try {
      if (desactive) await activer(id, true);
      else await ajouter(id);
      demanderEcriture(chatId);
      if (!desactive) jouer("validation");
      annoncer(desactive ? `${name} réactivé.` : `${name} ajouté à tes agents.`);
    } catch (e) {
      const raison = e instanceof Error ? e.message : String(e);
      setErreur(desactive ? `La réactivation n’a pas abouti : ${raison}` : `L’ajout n’a pas abouti : ${raison}`);
      setEnCours(false);
    }
  };

  return (
    <div className="border-t border-bordure-subtile bg-fond-page px-4 py-3">
      <div className="mx-auto flex w-full max-w-[880px] flex-wrap items-center gap-x-3 gap-y-2">
        <p className="m-0 min-w-0 flex-1 text-ui-s text-texte-secondaire">
          {desactive ? `${name} n’est plus dans Mes agents. Ses messages restent lisibles.` : `${name} n’est pas dans Mes agents.`}
        </p>
        <Bouton variant="sombre" taille="compact" disabled={enCours} onClick={() => void agir()}>
          {desactive ? "Réactiver" : "Ajouter à mes agents"}
        </Bouton>
      </div>
      {erreur && (
        <p role="alert" className="mx-auto mt-2 mb-0 w-full max-w-[880px] text-ui-xs text-texte-erreur">
          {erreur}
        </p>
      )}
    </div>
  );
}

/** Ouverte depuis un lien (notification, ancien lien) alors qu'un autre serveur est affiché : on propose d'y passer. */
/** Largeur de fenêtre sous laquelle le panneau de l'agent part fermé. */
const PANNEAU_MIN_FENETRE = 1280;

export function ChatScreen() {
  const chatId = useSearchParams().get("id");
  const chat = useChat(chatId);
  const { tous } = useAgents();
  /* Conversation directe (ou fil) d'un agent désactivé ou pas encore dans Mes agents : en lecture. */
  const horsDeMesAgents =
    chat?.kind === "direct" ? tous.find((a) => a.role.id === chat.roleIds[0] && a.statut !== "actif") : undefined;
  const project = useProject(chat?.projectId ?? null);
  const espace = useLieuActif();
  const exportConversation = useExporterConversation(chat, project);
  const modifiedLabel = useModifiedLabel(chat?.id ?? "");
  /* Le panneau de l'agent (réglages, fichiers, tâches, navigateur ; aperçu et Git dans un projet) à droite. */
  // Sous 1280 px, conversation + panneaux ne tiennent pas : le panneau part fermé.
  const [panneauOuvert, setPanneauOuvert] = useState(() => window.innerWidth >= PANNEAU_MIN_FENETRE);
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < PANNEAU_MIN_FENETRE) setPanneauOuvert(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [maximise, setMaximise] = useState(false);
  const [etatPanneau, setEtatPanneau] = usePanneauLateral();
  /* Un lien local cliqué dans une conversation de projet : il s'ouvre dans l'aperçu. */
  /* La demande garde sa conversation : elle ne suit pas dans une autre. `apercuVu` : la dernière que le panneau a montrée. */
  const [demandeApercu, setAdresseApercu] = useState<{ url: string; n: number; chatId: string } | null>(null);
  const [apercuVu, setApercuVu] = useState(0);
  const adresseApercu = demandeApercu && demandeApercu.chatId === chatId ? demandeApercu : null;
  const apercuAMontrer = adresseApercu && adresseApercu.n !== apercuVu ? adresseApercu : null;
  const equipe = chat?.kind === "equipe";
  /* Toute conversation se lit comme le chat d'un agent : son en-tête et son panneau. Celle d'un projet a en plus
     l'aperçu du site et Git ; celle d'une routine ou d'un workflow sans projet, les onglets d'un chat. */
  const projetConv = equipe && !!project;

  /* Une image jointe cliquée : un onglet du panneau. */
  const images = useImagesOuvertes(
    chat?.id ?? "",
    useCallback(() => setPanneauOuvert(true), []),
  );
  const { choisir: choisirImage } = images;

  /* Un agent annonce l'adresse du site qu'il vient de lancer : l'aperçu l'ouvre tout seul,
     et le projet la garde pour la prochaine fois. */
  const { enregistrerProjet } = useWorkspace();
  const annonce = useAdresseAnnoncee(chat?.id ?? "");
  const [annonceVue, setAnnonceVue] = useState<string | null>(null);
  if (projetConv && annonce && annonce.id !== annonceVue) {
    setAnnonceVue(annonce.id);
    setPanneauOuvert(true);
    setAdresseApercu((a) => ({ url: annonce.url, n: (a?.n ?? 0) + 1, chatId: chat?.id ?? "" }));
  }
  useEffect(() => {
    if (!annonce || !project || !equipe) return;
    const racine = annonce.url.replace(/\/.*$/, "");
    if (project.previewUrl !== racine) enregistrerProjet({ ...project, previewUrl: racine });
  }, [annonce, project, equipe, enregistrerProjet]);

  /* Hors d'un projet, pas d'aperçu : le lien s'ouvre comme ailleurs. */
  useEffect(() => {
    if (!projetConv) return;
    const prendre = (e: Event) => {
      const demande = (e as CustomEvent<DemandeApercu>).detail;
      demande.pris = true;
      setPanneauOuvert(true);
      setAdresseApercu((a) => ({ url: demande.url, n: (a?.n ?? 0) + 1, chatId: chatId ?? "" }));
    };
    window.addEventListener("klyra:apercu", prendre);
    return () => window.removeEventListener("klyra:apercu", prendre);
  }, [projetConv, chatId]);

  /* Un agent passe la main à la personne sur une page du navigateur : le panneau s'ouvre pour qu'elle la voie. */
  const activiteNavigateur = useActiviteNavigateur(chat?.id ?? "");
  const [attenteVue, setAttenteVue] = useState(false);
  if ((activiteNavigateur === "attente") !== attenteVue) {
    setAttenteVue(activiteNavigateur === "attente");
    if (activiteNavigateur === "attente") setPanneauOuvert(true);
  }
  /* Avatar ou prénom de l'agent cliqué : le panneau s'ouvre sur ses réglages. */
  useEffect(() => {
    const ouvrir = () => {
      setPanneauOuvert(true);
      choisirImage(null);
      setEtatPanneau(surReglages);
    };
    window.addEventListener(OUVRIR_PANNEAU_AGENT, ouvrir);
    return () => window.removeEventListener(OUVRIR_PANNEAU_AGENT, ouvrir);
  }, [setEtatPanneau, choisirImage]);

  const fermerPanneau = useCallback(() => {
    setPanneauOuvert(false);
    setMaximise(false);
  }, []);

  /* L'atelier d'une équipe en grand, ouvert depuis sa carte dans le fil (n : chaque demande compte). */
  const [atelierEquipe, setAtelierEquipe] = useState<{ chatId: string; membre?: string; n: number } | null>(null);
  useEffect(() => {
    const ouvrir = (e: Event) => {
      const d = (e as CustomEvent<DemandeAtelierEquipe>).detail;
      if (d.chatId !== chatId) return;
      setAtelierEquipe((a) => ({ chatId: d.chatId, membre: d.membre, n: (a?.n ?? 0) + 1 }));
    };
    window.addEventListener(OUVRIR_ATELIER_EQUIPE, ouvrir);
    return () => window.removeEventListener(OUVRIR_ATELIER_EQUIPE, ouvrir);
  }, [chatId]);
  const fermerAtelierEquipe = useCallback(() => setAtelierEquipe(null), []);

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <EmptyState
          title="Ce chat n’existe pas"
          description="Il a peut-être été supprimé. Choisis un chat récent dans la barre latérale."
          action={<BoutonPrincipal href="/">Retour à l’accueil</BoutonPrincipal>}
        />
      </div>
    );
  }

  const conseilEtComposeur = horsDeMesAgents ? (
    <BarreHorsDeMesAgents key={`hors-${chat.id}`} agent={horsDeMesAgents} chatId={chat.id} />
  ) : (
    <>
      <ConseilContexte chat={chat} />
      <Composer key={`composer-${chat.id}`} chat={chat} project={project} />
    </>
  );

  /* L'atelier d'une équipe en grand : la table à la place de la conversation, qui passe à droite. */
  if (atelierEquipe?.chatId === chat.id) {
    return (
      <div className="flex h-full min-h-0">
        <AtelierEquipe
          chat={chat}
          demande={atelierEquipe}
          onFermer={fermerAtelierEquipe}
          fil={
            <>
              <MessageThread key={chat.id} chatId={chat.id} messageExport={null} />
              <AgentsEnCours chatId={chat.id} />
            </>
          }
          composeur={conseilEtComposeur}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Panneau agrandi : il prend toute la place, la conversation se cache. */}
      <section aria-label={chat.title} className={maximise ? "hidden" : "relative flex min-w-0 flex-1 flex-col"}>
        {chat.kind === "direct" && <OngletsFils roleId={chat.roleIds[0] ?? "principal"} chatId={chat.id} />}
        <ChatHeader
          key={`header-${chat.id}`}
          chat={chat}
          actionExport={exportConversation.action}
          previewOpen={panneauOuvert}
          onTogglePreview={() => setPanneauOuvert((v) => !v)}
        />
        {!dansEspace(chat.lieu, espace) && <AutreServeur lieu={chat.lieu ?? null} quoi="Cette conversation" />}
        <MessageThread key={chat.id} chatId={chat.id} messageExport={exportConversation.message &&
          <MessageExport key={exportConversation.numero} message={exportConversation.message} onFermer={exportConversation.fermer} />} />
        <AgentsEnCours chatId={chat.id} />
        {conseilEtComposeur}
      </section>
      {panneauOuvert && (
        <PanneauLateral
          key={projetConv ? `projet-${project?.id}` : "agent"}
          chat={chat}
          projet={projetConv ? project : undefined}
          modifiedLabel={modifiedLabel}
          adresseApercu={projetConv ? adresseApercu : null}
          apercuAMontrer={projetConv ? apercuAMontrer : null}
          onApercuMontre={setApercuVu}
          maximise={maximise}
          onMaximiser={() => setMaximise((v) => !v)}
          onFermer={fermerPanneau}
          etat={etatPanneau}
          setEtat={setEtatPanneau}
          images={images.ouvertes}
          imageActive={images.active}
          onChoisirImage={images.choisir}
          onFermerImage={images.fermer}
        />
      )}
    </div>
  );
}
