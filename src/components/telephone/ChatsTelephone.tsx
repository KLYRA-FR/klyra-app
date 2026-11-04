"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { formatListDate } from "@/lib/format";
import { attenteEnvoi } from "@/lib/poste-texte";
import { roleLisible } from "@/lib/telephone/agents";
import { aTraiter, etatLigne, idDirect, sections, type ConversationLue, type ElementATraiter } from "@/lib/telephone/chats";
import { EnteteTelephone } from "./EnteteTelephone";
import { useBandeau } from "./etats";
import { usePostes } from "./poste";
import { GrappeChat, RondAgent, useCartes } from "./AgentsChat";
import { CarteAccordChat } from "./CarteAccordChat";
import { useAppuiMenu, useMenuChat } from "./MenuChat";
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

/** Une ligne de 64 px : avatar 36, nom, état ou dernier message, heure, non lus, et « ⋯ » (appui long : le même menu). */
function LigneChat({
  href,
  avatar,
  titre,
  etiquette,
  texte,
  enCours,
  heure,
  nonLus,
  epinglee,
  onMenu,
}: {
  href: string;
  avatar: ReactNode;
  titre: string;
  etiquette?: string | null;
  texte: string;
  enCours: boolean;
  heure: string | null;
  nonLus: number;
  epinglee?: boolean;
  onMenu: () => void;
}) {
  const { className: sansMenuSysteme, ...appui } = useAppuiMenu(onMenu);
  return (
    <li className="flex items-center gap-1 border-b border-bordure-subtile last:border-b-0">
      <Link href={href} {...appui} className={cn("flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 no-underline active:bg-fond-survol", sansMenuSysteme)}>
        <span className="relative shrink-0">
          {avatar}
          {nonLus > 0 ? (
            <span
              aria-label={`${nonLus} non lu${nonLus > 1 ? "s" : ""}`}
              className="absolute -right-[5px] -bottom-[3px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-fond-page bg-bleu-k1-500 px-1 text-ui-xs leading-none font-semibold text-texte-inverse"
            >
              {nonLus > 9 ? "9+" : nonLus}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-body-s font-medium text-texte-principal">{titre}</span>
            {etiquette ? <span className="shrink-0 truncate text-ui-xs text-texte-secondaire">· {etiquette}</span> : null}
            {heure ? <span className="ml-auto shrink-0 pl-1 text-ui-xs text-texte-secondaire">{heure}</span> : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("min-w-0 flex-1 truncate text-ui", enCours ? "klyra-respire font-medium text-texte-principal" : "text-texte-secondaire")}>{texte}</span>
            {epinglee ? (
              <span role="img" aria-label="Épinglée" className="flex shrink-0 text-icone-secondaire">
                <Icon name="pin-01" size={14} />
              </span>
            ) : null}
          </span>
        </span>
      </Link>
      <BoutonIcone
        variant="discret"
        className="size-11 shrink-0"
        libelle={`Options de ${titre}`}
        icone={<Icon name="dot-horizontal" size={20} />}
        aria-haspopup="dialog"
        onClick={onMenu}
      />
    </li>
  );
}

function Section({ titre, nombre, children }: { titre: string; nombre?: number; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-3" aria-label={titre}>
      <h2 className="flex items-baseline gap-1.5 text-ui font-medium text-texte-secondaire">
        {titre}
        {nombre !== undefined ? <span className="text-ui-xs">· {nombre}</span> : null}
      </h2>
      {children}
    </section>
  );
}

const CARTE = "flex min-h-16 items-center gap-3 rounded-xl border border-bordure-subtile bg-fond-surface px-4 py-3 no-underline active:bg-fond-survol";

/** Une carte de « À traiter » autre qu'un accord : l'agent attend ta réponse, ou tes messages attendent l'ordinateur. */
function CarteATraiter({ element, titre }: { element: Exclude<ElementATraiter, { genre: "accord" }>; titre: string }) {
  const { nom } = useCartes();
  const { principal } = usePostes();
  if (element.genre === "question") {
    const roleId = element.activite.roleId;
    return (
      <Link href={`/chat?id=${encodeURIComponent(element.conversation.origine)}`} className={CARTE}>
        <RondAgent id={roleId} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-s text-texte-principal">
            <span className="font-medium">{nom(roleId)}</span> · Attend ta réponse
          </span>
          <span className="truncate text-ui text-texte-secondaire">{element.conversation.extrait || titre}</span>
        </span>
      </Link>
    );
  }
  const n = element.messages.length;
  return (
    <Link href={`/chat?id=${encodeURIComponent(element.conversationOrigine)}`} className={CARTE}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-fond-surface-grise text-icone-secondaire">
        <Icon name="clock-01" size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-s text-texte-principal">
          {n > 1 ? `${n} messages` : "Un message"} · {titre}
        </span>
        <span className="truncate text-ui text-texte-secondaire">{attenteEnvoi(principal)}</span>
      </span>
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

function ListeChats({ ecrire }: { ecrire: boolean }) {
  const router = useRouter();
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const enAttente = useQuery(api.conversationsCompte.enAttente, {});
  const { cartes, nom } = useCartes();
  const { postes, ouvert } = usePostes();
  const [nouveau, setNouveau] = useState(ecrire);
  const [bandeau, montrer] = useBandeau();
  const menu = useMenuChat({ onBandeau: montrer });
  const charge = conversations !== undefined && cartes !== undefined;
  const squelette = useApres(300, !charge);

  const liste = (conversations ?? []).filter((c) => !c.archiveLe);
  const parOrigine = new Map(liste.map((c) => [c.origine, c]));
  const { epinglees, agents, equipe } = sections(liste, cartes ?? [], nom, ouvert);
  const traiter = aTraiter(liste, enAttente ?? []);
  const titreDe = (origine: string) => {
    const c = parOrigine.get(origine);
    return c && (c.kind === "equipe" || c.parent) ? c.titre : origine.startsWith("dm-") ? nom(origine.slice(3)) : c?.titre || "Cette conversation";
  };
  const sansPoste = postes?.length === 0;

  const ligneEquipe = (c: ConversationLue) => {
    const etat = etatLigne(c, nom, ouvert);
    return (
      <LigneChat
        key={c.origine}
        href={`/chat?id=${encodeURIComponent(c.origine)}`}
        avatar={<GrappeChat roleIds={c.roleIds} />}
        titre={c.titre}
        etiquette={c.projetNom}
        texte={etat?.texte ?? (c.extrait || "Nouvelle conversation")}
        enCours={!!etat?.enCours}
        heure={c.extraitLe ? formatListDate(c.extraitLe) : null}
        nonLus={c.nonLus}
        epinglee={!!c.epingleLe}
        onMenu={() => menu.ouvrir(c.origine, c)}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone
        titre="Chats"
        droite={
          <>
            <BoutonIcone variant="discret" className="size-11" libelle="Rechercher" icone={<Icon name="search-01" size={22} />} onClick={() => router.push("/chats?vue=recherche")} />
            <BoutonIcone variant="discret" className="size-11" libelle="Nouveau chat" icone={<Icon name="pencil-01" size={22} />} aria-haspopup="dialog" onClick={() => setNouveau(true)} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {!charge ? (
          squelette ? (
            <ul aria-busy="true" aria-label="Chargement des conversations" className="mt-4 flex flex-col gap-3">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="flex h-16 items-center gap-3">
                  <span className="size-9 rounded-sm bg-fond-surface-grise motion-safe:animate-pulse" />
                  <span className="h-10 flex-1 rounded-md bg-fond-surface-grise motion-safe:animate-pulse" />
                </li>
              ))}
            </ul>
          ) : null
        ) : sansPoste && liste.length === 0 ? (
          <div className="pt-8">
            <h2 className="text-body-s font-medium text-texte-principal">Aucun ordinateur relié</h2>
            <p className="mt-2 text-ui text-texte-secondaire">
              Connecte-toi à ton compte dans KLYRA sur ton ordinateur (Réglages › Équipe) pour retrouver tes conversations ici.
            </p>
          </div>
        ) : (
          <>
            {traiter.length > 0 ? (
              <Section titre="À traiter" nombre={traiter.length}>
                <ul className="mt-2 flex flex-col gap-2">
                  {traiter.map((element) => (
                    <li key={element.genre === "attente" ? `attente-${element.conversationOrigine}` : `${element.genre}-${element.conversation.origine}`}>
                      {element.genre === "accord" ? (
                        <CarteAccordChat
                          compacte
                          titre={titreDe(element.conversation.origine)}
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
              </Section>
            ) : null}

            {epinglees.length > 0 ? (
              <Section titre="Épinglées">
                <ul>{epinglees.map(ligneEquipe)}</ul>
              </Section>
            ) : null}

            <Section titre="Mes agents" nombre={agents.length > 1 ? agents.length - 1 : undefined}>
              <ul>
                {agents.map(({ carte, conversation, etat }) => (
                  <LigneChat
                    key={carte.origine}
                    href={`/chat?id=${encodeURIComponent(idDirect(carte.origine))}`}
                    avatar={<RondAgent id={carte.origine} />}
                    titre={carte.nom}
                    etiquette={carte.origine === "principal" ? "assistant" : roleLisible(carte.roleCourt, carte.origine)}
                    texte={etat?.texte ?? (conversation?.extrait || "Pas encore de message")}
                    enCours={!!etat?.enCours}
                    heure={conversation?.extraitLe ? formatListDate(conversation.extraitLe) : null}
                    nonLus={conversation?.nonLus ?? 0}
                    onMenu={() => menu.ouvrir(idDirect(carte.origine), conversation)}
                  />
                ))}
              </ul>
              <Link href="/equipe?creer=1" className="mt-1 flex min-h-11 items-center gap-2 text-ui text-texte-principal no-underline">
                <Icon name="plus-01" size={20} className="text-icone-secondaire" />
                Créer un agent
              </Link>
            </Section>

            {equipe.length > 0 ? (
              <Section titre="Conversations d’équipe" nombre={equipe.length}>
                <ul>{equipe.map(ligneEquipe)}</ul>
              </Section>
            ) : null}

            {liste.length === 0 ? (
              <div className="pt-6">
                <p className="text-body-s text-texte-principal">Écris à un agent ou à ton assistant</p>
                <button type="button" className="mt-2 min-h-11 text-ui font-medium text-texte-principal" onClick={() => setNouveau(true)}>
                  Nouveau chat
                </button>
              </div>
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
    </div>
  );
}
