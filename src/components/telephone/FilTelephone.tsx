"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { ajouterAuBrouillon } from "@/lib/brouillons";
import { messageErreur } from "@/lib/compte";
import { DEBUT_DEMANDE_AGENT } from "@/lib/decrire-a-assistant";
import { activiteDe, agentDe, ASSISTANT } from "@/lib/telephone/chats";
import { useEnvoyerMessage } from "@/lib/telephone/envoi";
import { lireModele, type OptionsMessage } from "@/lib/telephone/options";
import { EnteteTelephone } from "./EnteteTelephone";
import { useBandeau } from "./etats";
import { usePostes } from "./poste";
import { RondAgent, useCartes } from "./AgentsChat";
import { ComposeurFil } from "./ComposeurFil";
import { DetailsFil } from "./DetailsFil";
import { FilsPuces } from "./FilsPuces";
import { useMenuChat } from "./MenuChat";
import { MessagesFil, type ContexteFil } from "./MessagesFil";

/** Les suggestions de l'accueil du bureau : chacune remplit le composeur, sans rien envoyer. */
const SUGGESTIONS = [
  { libelle: "Aide-moi à organiser ma semaine", texte: "Aide-moi à organiser ma semaine" },
  { libelle: "Résume ce document", texte: "Résume ce document" },
  { libelle: "Crée-moi un agent pour…", texte: DEBUT_DEMANDE_AGENT },
];

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
  const id = params.get("id") ?? "";
  const nouveauProjet = params.get("nouveau");
  const router = useRouter();
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const fil = useQuery(api.conversationsCompte.messages, id ? { origine: id } : "skip");
  const attente = useQuery(api.conversationsCompte.enAttente, {});
  const projets = useQuery(api.conversationsCompte.projets, nouveauProjet ? {} : "skip");
  const marquerLu = useMutation(api.operationsFile.marquerLu);
  const envoyerMessage = useEnvoyerMessage();
  const { nom, carte } = useCartes();
  const { ouvert } = usePostes();
  const [details, setDetails] = useState(false);
  const [bandeau, montrer] = useBandeau();
  const menu = useMenuChat({ onDetails: () => setDetails(true), onBandeau: montrer });
  const cadre = useCadreVisible();

  const conversation = conversations?.find((c) => c.origine === id);
  const agent = agentDe(id, conversation);
  const equipe = conversation ? conversation.kind === "equipe" : !!nouveauProjet;
  const activite = activiteDe(conversation);
  /* Ordinateur fermé, plus rien ne s'écrit : l'activité copiée avant la fermeture ne vaut plus (sauf la question). */
  const activiteVive = activite && (ouvert || activite.etat === "question") ? activite : null;
  const projetNouveau = projets?.find((p) => p.origine === nouveauProjet);
  const titre = equipe
    ? (conversation?.titre ?? (projetNouveau ? `Nouvelle conversation · ${projetNouveau.nom}` : "Nouvelle conversation"))
    : agent
      ? `${nom(agent)}${carte(agent)?.roleCourt ? ` · ${carte(agent)?.roleCourt}` : ""}`
      : "Conversation";
  const enFile = (attente ?? []).filter((m) => m.conversationOrigine === id);

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
  };

  /* Conversation vide : qui est l'agent, et les suggestions de l'accueil du bureau (avec l'assistant, ou dans un projet). */
  const vide = (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      {agent ? <RondAgent id={agent} taille={56} /> : null}
      <h2 className="text-h4 leading-[1.1] text-texte-principal">
        {agent ? (
          <>
            <span className="font-semibold">{nom(agent)}</span> <span className="font-normal">{carte(agent)?.roleCourt}</span>
          </>
        ) : (
          <span className="font-semibold">Écris à l’équipe</span>
        )}
      </h2>
      {agent === ASSISTANT || equipe ? (
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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-fond-page" style={cadre}>
      <EnteteTelephone
        titre={titre}
        retour={() => router.push("/chats")}
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
      <MessagesFil messages={fil?.messages} enFile={enFile} contexte={contexte} vide={vide} />
      <ComposeurFil key={id} origine={id} conversation={conversation} equipe={equipe} nouveauProjet={nouveauProjet} agentId={equipe ? null : agent} activite={activiteVive} />
      {details ? (
        <DetailsFil origine={id} conversation={conversation} messages={fil?.messages ?? []} onExporter={() => void menu.exporter(id, conversation)} onFermer={() => setDetails(false)} />
      ) : null}
      {menu.rendu}
      {bandeau}
    </div>
  );
}
