"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { ajouterAuBrouillon } from "@/lib/brouillons";
import { messageErreur } from "@/lib/compte";
import { activiteDe, agentDe, ASSISTANT, etatLigne, nouvelIdFil, resumeEnAttente, SUGGESTIONS } from "@/lib/telephone/chats";
import { lireCitation } from "@/lib/telephone/citation";
import { roleLisible } from "@/lib/telephone/agents";
import { useEnvoyerMessage } from "@/lib/telephone/envoi";
import { lireModele, type OptionsMessage } from "@/lib/telephone/options";
import { useAnnonce } from "./Annonce";
import { useHorsLigne } from "./BandeauReseau";
import { EnteteTelephone } from "./EnteteTelephone";
import { EtatEcran, useBandeau } from "./etats";
import { usePostes } from "./poste";
import { GrappeChat, RondAgent, useCartes } from "./AgentsChat";
import { ComposeurFil } from "./ComposeurFil";
import { DetailsFil } from "./DetailsFil";
import { FilsPuces } from "./FilsPuces";
import { useMenuChat } from "./MenuChat";
import { MessagesFil, type ContexteFil } from "./MessagesFil";
import { EchangesVps } from "./EchangesVps";
import { useEchangesDirects } from "@/lib/telephone/vps-direct";

/**
 * Le composeur suit le clavier : quand il s'ouvre, le fil prend la hauteur visible de l'écran
 * (`visualViewport`), sinon la page entière glisserait sous le clavier.
 */
function useCadreVisible(): CSSProperties | undefined {
  const [cadre, setCadre] = useState<CSSProperties | undefined>(undefined);
  useEffect(() => {
    const vue = window.visualViewport;
    if (!vue) return;
    const suivre = () => {
      const clavier = window.innerHeight - vue.height > 120;
      setCadre(clavier ? { position: "fixed", left: 0, right: 0, top: vue.offsetTop, height: vue.height } : undefined);
    };
    suivre();
    vue.addEventListener("resize", suivre);
    vue.addEventListener("scroll", suivre);
    return () => {
      vue.removeEventListener("resize", suivre);
      vue.removeEventListener("scroll", suivre);
    };
  }, []);
  return cadre;
}

/** T-02. Le fil se lit dans le compte ; l'envoi passe par la file. La barre du bas est cachée par la coque. */
export function FilTelephone() {
  const params = useSearchParams();
  const router = useRouter();
  const nouveauProjet = params.get("nouveau");
  /* C-5 : `/chat?nouveau=<projet>` ouvre une conversation neuve, créée au premier envoi. */
  const [idNeuf] = useState(() => crypto.randomUUID());
  const id = params.get("id") ?? (nouveauProjet ? idNeuf : "");
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const fil = useQuery(api.conversationsCompte.messages, id ? { origine: id } : "skip");
  const attente = useQuery(api.conversationsCompte.enAttente, {});
  const projets = useQuery(api.conversationsCompte.projets, nouveauProjet ? {} : "skip");
  const marquerLu = useMutation(api.operationsFile.marquerLu);
  const reagir = useMutation(api.operationsFile.reagir);
  const creerFil = useMutation(api.operationsFile.creerFil);
  const annoncer = useAnnonce();
  const horsLigne = useHorsLigne();
  const envoyerMessage = useEnvoyerMessage();
  const { nom, carte } = useCartes();
  const { ouvert } = usePostes();
  const [details, setDetails] = useState(false);
  const [bandeau, montrer] = useBandeau();
  const menu = useMenuChat({ onDetails: () => setDetails(true), onBandeau: montrer });
  const cadre = useCadreVisible();
  const composeur = useRef<{ ouvrirModele: () => void }>(null);

  const conversation = conversations?.find((c) => c.origine === id);
  const agent = agentDe(id, conversation);
  const equipe = conversation ? conversation.kind === "equipe" : !!nouveauProjet;
  const activite = activiteDe(conversation);
  /* Ordinateur fermé, plus rien ne s'écrit : l'activité copiée avant la fermeture ne vaut plus (sauf la question). */
  const activiteVive = activite && (ouvert || activite.etat === "question") ? activite : null;
  const projetNouveau = projets?.find((p) => p.origine === nouveauProjet);
  /* C-2b : jamais « Conversation » ; le fil d'un agent porte son nom (l'assistant par défaut). */
  const titre = equipe ? (conversation?.titre ?? "Nouvelle conversation") : nom(agent ?? conversation?.roleIds[0] ?? ASSISTANT);
  /* La ligne sous le nom : ce que fait l'agent, sinon son rôle (jamais répété) ; le projet et l'équipe pour une conversation d'équipe. */
  const etat = etatLigne(conversation, nom, ouvert);
  const sous = etat
    ? etat.texte
    : equipe
      ? [conversation?.projetNom ?? projetNouveau?.nom, conversation && conversation.roleIds.length > 1 ? `${conversation.roleIds.length} agents` : null].filter(Boolean).join(" · ")
      : agent === ASSISTANT
        ? "Ton assistant"
        : agent
          ? roleLisible(carte(agent)?.roleCourt, agent)
          : null;
  const visuel = equipe ? conversation ? <GrappeChat roleIds={conversation.roleIds} /> : null : <RondAgent id={agent ?? conversation?.roleIds[0] ?? ASSISTANT} taille={32} />;
  const enFile = (attente ?? []).filter((m) => m.conversationOrigine === id);
  /* Envoyés au VPS ordinateur fermé : affichés ici jusqu'à ce que le compte les ait repris. */
  const repris = useMemo(() => new Set((fil?.messages ?? []).map((m) => m.origine)), [fil?.messages]);
  const echanges = useEchangesDirects(id, repris);

  /* Lue sur le téléphone : ses non-lus tombent dans le compte, et l'ordinateur la marque lue à son ouverture. */
  const nonLus = conversation?.nonLus ?? 0;
  const question = activite?.etat === "question";
  useEffect(() => {
    if (id && (nonLus > 0 || question)) void marquerLu({ conversationOrigine: id }).catch(() => undefined);
  }, [id, nonLus, question, marquerLu]);

  const envoyer = (texte: string, options: Record<string, unknown>) => {
    void envoyerMessage({ conversationOrigine: id, texte, options: options as OptionsMessage }).catch((err: unknown) => montrer(messageErreur(err)));
  };
  const contexte: ContexteFil = {
    origine: id,
    projetId: conversation?.projetId ?? null,
    activite: activiteVive,
    modele: lireModele(conversation?.modele)?.modele ?? null,
    envoyer,
    onBandeau: montrer,
    conversation,
    reagir: (messageOrigine, emoji, mise) => {
      if (horsLigne) return annoncer({ texte: "Possible quand ce téléphone est en ligne", erreur: true });
      reagir({ messageOrigine, emoji, mise }).catch((err: unknown) => annoncer({ texte: messageErreur(err), erreur: true }));
    },
  };
  const nouveauFil = () => {
    if (!agent) return;
    const suivant = nouvelIdFil();
    creerFil({ origine: suivant, roleId: agent }).then(
      () => router.push(`/chat?id=${encodeURIComponent(suivant)}`),
      (err: unknown) => annoncer({ texte: messageErreur(err), erreur: true }),
    );
  };
  /* E2-26 : un id qui n'est ni un agent, ni une conversation du compte, ni une conversation neuve : on le dit, sans fil vide trompeur. */
  const indisponible = !!id && conversations !== undefined && !conversation && !id.startsWith("dm-") && !nouveauProjet && fil !== undefined && fil.messages.length === 0;
  /* E2-41 : un fil tiré d'un passage, encore vide : le passage attend dans le champ. */
  const passage = typeof window !== "undefined" && fil?.messages.length === 0 ? lireCitation(id) : null;

  /* Conversation vide : qui est l'agent, et les suggestions de l'accueil du bureau (avec l'assistant, ou dans un projet). */
  const vide = (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      {agent ? <RondAgent id={agent} taille={56} /> : null}
      <h2 className="text-h4 leading-[1.1] text-texte-principal">
        {passage && agent ? (
          <>
            <span className="font-semibold">Nouveau fil</span> <span className="font-normal">avec {nom(agent)}</span>
          </>
        ) : agent ? (
          <>
            <span className="font-semibold">{nom(agent)}</span> <span className="font-normal">{agent === ASSISTANT ? "Ton assistant" : roleLisible(carte(agent)?.roleCourt, agent)}</span>
          </>
        ) : (
          <span className="font-semibold">Écris à l’équipe</span>
        )}
      </h2>
      {passage ? <p className="text-body-s text-texte-secondaire">Le passage cité attend dans le champ :</p> : null}
      {!passage && agent === ASSISTANT ? <p className="text-ui text-texte-secondaire">Il répond et fait lui-même ce qui est simple ; il confie le reste à tes agents.</p> : null}
      {!passage && (agent === ASSISTANT || equipe) ? (
        <ul aria-label="Suggestions" className="mt-2 flex w-full flex-col gap-2">
          {SUGGESTIONS.map((s) => (
            <li key={s.libelle}>
              <Bouton variant="blanc" className="h-11 w-full justify-start text-ui" onClick={() => ajouterAuBrouillon(id, s.texte)}>
                {s.libelle}
              </Bouton>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  if (indisponible) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-fond-page" style={cadre}>
        <EnteteTelephone titre="Conversation" parent="/chats" />
        <EtatEcran
          icone="message-square"
          titre="Conversation indisponible"
          texte="Elle a été retirée de ton compte, ou n’y est pas encore arrivée."
          action={
            <Bouton variant="sombre" taille="md" onClick={() => router.replace("/chats")}>
              Retour aux Chats
            </Bouton>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-fond-page" style={cadre}>
      <EnteteTelephone
        titre={titre}
        visuel={visuel}
        sous={sous}
        parent="/chats"
        droite={
          <BoutonIcone
            variant="discret"
            className="size-11"
            libelle="Options de la conversation"
            aria-haspopup="dialog"
            icone={<Icon name="dot-horizontal" size={22} />}
            onClick={() => menu.ouvrir(id, conversation, true)}
          />
        }
      />
      {agent && !equipe && conversations ? <FilsPuces agentId={agent} courant={id} conversations={conversations} onBandeau={montrer} /> : null}
      <MessagesFil messages={fil?.messages} coupe={fil?.coupe} enFile={enFile} contexte={contexte} vide={vide} apres={echanges.length ? <EchangesVps echanges={echanges} /> : null} />
      <ComposeurFil key={id} origine={id} conversation={conversation} equipe={equipe} nouveauProjet={nouveauProjet} agentId={equipe ? null : agent} activite={activiteVive} resumeAttendu={resumeEnAttente(fil?.messages, enFile)} onNouveauFil={nouveauFil} poignee={composeur} />
      {details ? (
        <DetailsFil
          origine={id}
          conversation={conversation}
          messages={fil?.messages ?? []}
          onExporter={() => void menu.exporter(id, conversation)}
          onModele={() => composeur.current?.ouvrirModele()}
          onFermer={() => setDetails(false)}
        />
      ) : null}
      {menu.rendu}
      {bandeau}
    </div>
  );
}
