"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { ajouterAuBrouillon } from "@/lib/brouillons";
import { useCompte } from "@/lib/compte";
import { formatListDate } from "@/lib/format";
import { attenteEnvoi } from "@/lib/poste-texte";
import { roleLisible } from "@/lib/telephone/agents";
import { aTraiter, auTravail, etatLigne, idDirect, sections, ASSISTANT, SUGGESTIONS, type ConversationLue, type ElementATraiter } from "@/lib/telephone/chats";
import { bonjour, dateDuJour } from "@/lib/telephone/journee";
import { CarteJournee, RailAuTravail } from "./AccueilChats";
import { PageOnglet } from "./EnteteTelephone";
import { useHorsLigne } from "./BandeauReseau";
import { AucunPoste, Squelette, useBandeau } from "./etats";
import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { usePostes } from "./poste";
import { GrappeChat, RondAgent, useCartes } from "./AgentsChat";
import { CarteAccordChat } from "./CarteAccordChat";
import { useMenuChat } from "./MenuChat";
import { NouveauChat } from "./NouveauChat";
import { RechercheTelephone } from "./RechercheTelephone";

/** Le squelette n'apparaît qu'après 300 ms (spec § 5) : une liste rapide ne clignote pas. */
export function useApres(ms: number, actif = true): boolean {
  const [passe, setPasse] = useState(false);
  useEffect(() => {
    if (!actif) return;
    const minuteur = setTimeout(() => setPasse(true), ms);
    return () => clearTimeout(minuteur);
  }, [ms, actif]);
  return actif && passe;
}

/** L'avatar d'une ligne (40 px) et ses non-lus en pastille bleue. */
function AvatarLigne({ children, nonLus }: { children: ReactNode; nonLus: number }) {
  return (
    <span className="relative shrink-0">
      {children}
      {nonLus > 0 ? (
        <span
          aria-label={`${nonLus} non lu${nonLus > 1 ? "s" : ""}`}
          className="absolute -right-[5px] -bottom-[3px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-fond-surface bg-bleu-k1-500 px-1 text-ui-xs leading-none font-semibold text-texte-inverse"
        >
          {nonLus > 9 ? "9+" : nonLus}
        </span>
      ) : null}
    </span>
  );
}

const CARTE = "flex min-h-16 items-center gap-3 rounded-xl border border-bordure-subtile bg-fond-surface px-4 py-3 no-underline shadow-ombre-ambiante transition-transform duration-[120ms] ease-sortie active:scale-[0.98]";

/** Une carte de « À traiter » autre qu'un accord : l'agent attend ta réponse (ouvre le message), ou tes messages attendent l'ordinateur. */
function CarteATraiter({ element, titre }: { element: Exclude<ElementATraiter, { genre: "accord" }>; titre: string }) {
  const { nom } = useCartes();
  const { principal } = usePostes();
  if (element.genre === "question") {
    const { roleId, messageId, depuis } = element.activite;
    const c = element.conversation;
    return (
      <Link href={`/chat?id=${encodeURIComponent(c.origine)}&message=${encodeURIComponent(messageId)}`} className={CARTE}>
        <AvatarLigne nonLus={c.nonLus}>
          <RondAgent id={roleId} taille={40} />
        </AvatarLigne>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-body-s font-semibold text-texte-principal">{nom(roleId)} attend ta réponse</span>
            <span className="ml-auto shrink-0 text-ui-xs text-texte-secondaire">{formatListDate(c.extraitLe ?? depuis)}</span>
          </span>
          <span className="line-clamp-2 text-ui text-texte-secondaire">{c.extrait ? (c.kind === "equipe" ? `${titre} : ${c.extrait}` : c.extrait) : titre}</span>
        </span>
        <Icon name="chevron-right" size={20} className="shrink-0 text-icone-secondaire" />
      </Link>
    );
  }
  const n = element.messages.length;
  return (
    <Link href={`/chat?id=${encodeURIComponent(element.conversationOrigine)}`} className={CARTE}>
      <TuileIcone icone="clock-01" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-s font-semibold text-texte-principal">
          {n > 1 ? `${n} messages` : "Un message"} · {titre}
        </span>
        <span className="truncate text-ui text-texte-secondaire">{attenteEnvoi(principal)}</span>
      </span>
      <Icon name="chevron-right" size={20} className="shrink-0 text-icone-secondaire" />
    </Link>
  );
}

/** T-01, l'écran d'ouverture (et T-04 par `?vue=recherche`). Les conversations viennent du compte : elles se lisent ordinateur fermé. */
export function ChatsTelephone() {
  const params = useSearchParams();
  if (params.get("vue") === "recherche") return <RechercheTelephone />;
  /* `?ecrire=1` : « Écrire à un agent » d'un écran dont l'ordinateur est fermé (S-19) ouvre le choix de l'agent. */
  return <ListeChats ecrire={params.get("ecrire") === "1"} />;
}

/**
 * Chats (lot 2, E2-01 à E2-07, D2-1) : le bonjour, « Ta journée », « Au travail », « À traiter », puis
 * les conversations en groupes blancs. Une ligne qui a sa page n'a pas de « ⋯ » visible (D-7) : appui
 * long, ou « Actions pour {nom} » pour les lecteurs d'écran.
 */
function ListeChats({ ecrire }: { ecrire: boolean }) {
  const router = useRouter();
  const { moi } = useCompte();
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const enAttente = useQuery(api.conversationsCompte.enAttente, {});
  const { cartes, nom } = useCartes();
  const horsLigne = useHorsLigne();
  const { postes, ouvert } = usePostes();
  const [nouveau, setNouveau] = useState(ecrire);
  const [bandeau, montrer] = useBandeau();
  const menu = useMenuChat({ onBandeau: montrer });
  const [date] = useState(() => dateDuJour(new Date()));
  const charge = conversations !== undefined && cartes !== undefined;
  const squelette = useApres(300, !charge);

  const liste = (conversations ?? []).filter((c) => !c.archiveLe);
  const parOrigine = new Map(liste.map((c) => [c.origine, c]));
  /* Hors ligne, une copie d'activité ne dit plus rien du travail en cours (E2-07). */
  const vif = ouvert && !horsLigne;
  const { epinglees, agents, equipe } = sections(liste, cartes ?? [], nom, ouvert, horsLigne);
  const traiter = aTraiter(liste, enAttente ?? []);
  const travail = auTravail(liste, vif);
  const titreDe = (origine: string) => {
    const c = parOrigine.get(origine);
    return c && (c.kind === "equipe" || c.parent) ? c.titre : origine.startsWith("dm-") ? nom(origine.slice(3)) : c?.titre || "Cette conversation";
  };
  const sansPoste = postes?.length === 0;
  const premierJour = charge && liste.length === 0;

  const ligneEquipe = (c: ConversationLue) => {
    const etat = etatLigne(c, nom, ouvert, horsLigne);
    return (
      <LigneListe
        key={c.origine}
        href={`/chat?id=${encodeURIComponent(c.origine)}`}
        retrait="avatar"
        debut={
          <AvatarLigne nonLus={c.nonLus}>
            <GrappeChat roleIds={c.roleIds} grande />
          </AvatarLigne>
        }
        nom={c.titre}
        nonLu={c.nonLus > 0}
        etiquette={c.projetNom ? <Etiquette>{c.projetNom}</Etiquette> : null}
        meta={etat?.enCours ? "En cours" : c.extraitLe ? formatListDate(c.extraitLe) : null}
        metaAccent={!!etat?.enCours}
        ligne2={etat ? <span className={etat.enCours ? "text-texte-principal" : undefined}>{etat.texte}</span> : c.extrait || "Nouvelle conversation"}
        onMenu={() => menu.ouvrir(c.origine, c)}
      />
    );
  };

  return (
    <PageOnglet
      titre="Chats"
      surtitre={date}
      grandTitre={bonjour(moi?.nom)}
      droite={
        <>
          <BoutonIcone variant="discret" className="size-11" libelle="Rechercher" icone={<Icon name="search-01" size={24} />} onClick={() => router.push("/chats?vue=recherche")} />
          <BoutonIcone variant="discret" className="size-11" libelle="Nouveau chat" icone={<Icon name="message-plus-01" size={24} />} aria-haspopup="dialog" onClick={() => setNouveau(true)} />
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <CarteJournee />

        {sansPoste ? (
          <AucunPoste forme="encadre" className="mt-6 px-0 pb-0" phrase={(sur) => `Les agents travaillent sur ${sur}. Tes conversations du compte restent ici.`} />
        ) : null}

        <RailAuTravail agents={travail} />

        {!charge ? (
          squelette ? (
            <div aria-busy="true" aria-label="Chargement des conversations" className="mt-6">
              <Squelette lignes={5} />
            </div>
          ) : null
        ) : (
          <>
            {traiter.length > 0 ? (
              <SectionListe titre="À traiter" compte={traiter.length} className="mt-6">
                <ul className="flex flex-col gap-2">
                  {traiter.map((element) => (
                    <li key={element.genre === "attente" ? `attente-${element.conversationOrigine}` : `${element.genre}-${element.conversation.origine}`}>
                      {element.genre === "accord" ? (
                        <CarteAccordChat
                          compacte
                          titre={[titreDe(element.conversation.origine), element.conversation.projetNom].filter(Boolean).join(" · ")}
                          demande={{
                            conversationOrigine: element.conversation.origine,
                            roleId: element.activite.roleId,
                            messageId: element.activite.messageId,
                            accord: element.activite.accord,
                          }}
                        />
                      ) : (
                        <CarteATraiter element={element} titre={titreDe(element.genre === "attente" ? element.conversationOrigine : element.conversation.origine)} />
                      )}
                    </li>
                  ))}
                </ul>
              </SectionListe>
            ) : null}

            {epinglees.length > 0 ? (
              <SectionListe titre="Épinglées" className="mt-6">
                <GroupeListe>{epinglees.map(ligneEquipe)}</GroupeListe>
              </SectionListe>
            ) : null}

            {premierJour ? (
              <SectionListe titre="Pour commencer" className="mt-6">
                <GroupeListe>
                  {SUGGESTIONS.map((s) => (
                    <LigneListe
                      key={s.libelle}
                      retrait="tuile"
                      debut={<TuileIcone icone="message-plus-01" />}
                      nom={s.libelle}
                      ligne2={`Avec ${nom(ASSISTANT)} · rien ne part avant que tu envoies`}
                      uneLigne
                      onClick={() => {
                        ajouterAuBrouillon(idDirect(ASSISTANT), s.texte);
                        router.push(`/chat?id=${encodeURIComponent(idDirect(ASSISTANT))}`);
                      }}
                    />
                  ))}
                </GroupeListe>
              </SectionListe>
            ) : null}

            {/* Le compte : les agents réellement affichés, l'assistant compris ; « Créer un agent » n'en est pas un. */}
            <SectionListe titre="Mes agents" compte={agents.length} className="mt-6">
              <GroupeListe>
                {agents.map(({ carte, conversation, etat }) => (
                  <LigneListe
                    key={carte.origine}
                    href={`/chat?id=${encodeURIComponent(idDirect(carte.origine))}`}
                    retrait="avatar"
                    debut={
                      <AvatarLigne nonLus={conversation?.nonLus ?? 0}>
                        <RondAgent id={carte.origine} taille={40} />
                      </AvatarLigne>
                    }
                    nom={carte.nom}
                    nonLu={(conversation?.nonLus ?? 0) > 0}
                    etiquette={<Etiquette>{carte.origine === ASSISTANT ? "Assistant" : roleLisible(carte.roleCourt, carte.origine)}</Etiquette>}
                    meta={etat?.enCours ? "En cours" : conversation?.extraitLe ? formatListDate(conversation.extraitLe) : null}
                    metaAccent={!!etat?.enCours}
                    ligne2={etat ? <span className={etat.enCours ? "text-texte-principal" : undefined}>{etat.texte}</span> : conversation?.extrait || "Pas encore de message"}
                    onMenu={() => menu.ouvrir(idDirect(carte.origine), conversation)}
                  />
                ))}
                <LigneListe href="/equipe?creer=1" retrait="avatar" debut={<span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-fond-surface-grise text-icone-defaut"><Icon name="plus-01" size={22} /></span>} nom="Créer un agent" />
              </GroupeListe>
            </SectionListe>

            {equipe.length > 0 ? (
              <SectionListe titre="Conversations d’équipe" compte={equipe.length} className="mt-6">
                <GroupeListe>{equipe.map(ligneEquipe)}</GroupeListe>
              </SectionListe>
            ) : null}
          </>
        )}
      </div>
      {nouveau ? (
        <NouveauChat
          onFermer={() => {
            setNouveau(false);
            if (ecrire) router.replace("/chats");
          }}
        />
      ) : null}
      {menu.rendu}
      {bandeau}
    </PageOnglet>
  );
}
