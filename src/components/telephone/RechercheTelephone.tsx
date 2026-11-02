"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { formatListDate } from "@/lib/format";
import { analyserRequete, normaliser, surligner, type Morceau, type Portee, type Requete } from "@/lib/recherche";
import { retenirRequete } from "@/lib/recherche-session";
import { agentDe, type ConversationLue } from "@/lib/telephone/chats";
import { GrappeChat, RondAgent, useCartes } from "./AgentsChat";

const PORTEES: { id: Portee; libelle: string }[] = [
  { id: "tout", libelle: "Tout" },
  { id: "agents", libelle: "Agents" },
  { id: "projets", libelle: "Projets" },
  { id: "conversation", libelle: "Cette conversation" },
];
/** Comme au bureau : d'abord 3 conversations au plus dont le titre correspond, puis les messages. */
const CONVERSATIONS_MAX = 3;

const estDAgent = (origine: string) => origine.startsWith("dm-") || origine.startsWith("klyra-fil-");

function Surligne({ morceaux }: { morceaux: Morceau[] }) {
  return (
    <>
      {morceaux.map((m, i) =>
        m.trouve ? (
          <mark key={i} className="rounded-2xs bg-fond-surface-grise font-semibold text-texte-principal">
            {m.texte}
          </mark>
        ) : (
          <span key={i}>{m.texte}</span>
        ),
      )}
    </>
  );
}

/**
 * T-04. Page pleine, champ en haut (focus et clavier ouverts), portées en puces, groupes
 * « Conversations » et « Messages ». La recherche porte sur les conversations du compte (Compte) :
 * les titres sur le téléphone, les messages par l'index du compte. Un message s'ouvre centré et surligné.
 */
export function RechercheTelephone() {
  const router = useRouter();
  const params = useSearchParams();
  const dansConversation = params.get("id");
  const [saisie, setSaisie] = useState("");
  const [requete, setRequete] = useState("");
  const [portee, setPortee] = useState<Portee>(dansConversation ? "conversation" : "tout");
  const champ = useRef<HTMLInputElement>(null);
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const { nom } = useCartes();

  /* Au fil de la frappe, sans une requête par lettre. */
  useEffect(() => {
    const minuteur = setTimeout(() => setRequete(saisie.trim()), 200);
    return () => clearTimeout(minuteur);
  }, [saisie]);
  useEffect(() => champ.current?.focus(), []);

  const analysee: Requete | null = useMemo(() => analyserRequete(requete), [requete]);
  const lus = useQuery(
    api.conversationsCompte.chercher,
    analysee ? { requete, portee, ...(portee === "conversation" && dansConversation ? { conversationOrigine: dansConversation } : {}) } : "skip",
  );
  /* Les résultats précédents restent affichés pendant que les suivants arrivent. */
  const [precedents, setPrecedents] = useState<typeof lus>(undefined);
  if (lus !== undefined && lus !== precedents) setPrecedents(lus);
  const messages = analysee ? (lus ?? precedents) : undefined;

  const parOrigine = useMemo(() => new Map((conversations ?? []).map((c) => [c.origine, c])), [conversations]);
  const titreDe = (origine: string, c: ConversationLue | undefined) => (c && (c.kind === "equipe" || c.parent) ? c.titre : nom(agentDe(origine, c) ?? origine));

  const trouvees = useMemo(() => {
    if (!analysee || portee === "conversation") return [];
    return (conversations ?? [])
      .filter((c) => (portee === "agents" ? estDAgent(c.origine) : portee === "projets" ? !estDAgent(c.origine) : true))
      .map((c) => ({ c, titre: c.kind === "equipe" || c.parent ? c.titre : nom(agentDe(c.origine, c) ?? c.origine) }))
      .filter(({ titre }) => {
        const normal = normaliser(titre).texte;
        return analysee.termes.every((t) => normal.includes(t));
      })
      .slice(0, CONVERSATIONS_MAX);
  }, [analysee, portee, conversations, nom]);

  const ouvrir = (origine: string, message: string | null) => {
    if (message) retenirRequete(analysee);
    router.push(`/chat?id=${encodeURIComponent(origine)}${message ? `&message=${encodeURIComponent(message)}` : ""}`);
  };

  const portees = PORTEES.filter((p) => p.id !== "conversation" || dansConversation);
  const rien = !!analysee && messages !== undefined && messages.length === 0 && trouvees.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 bg-fond-page px-2 pt-[env(safe-area-inset-top)]">
        <div className="flex h-[52px] items-center gap-1">
          <BoutonIcone variant="discret" className="size-11" libelle="Retour" icone={<Icon name="chevron-left" size={24} />} onClick={() => router.push(dansConversation ? `/chat?id=${encodeURIComponent(dansConversation)}` : "/chats")} />
          <input
            ref={champ}
            type="search"
            enterKeyHint="search"
            aria-label="Rechercher dans les conversations"
            placeholder="Rechercher dans les conversations"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            className="h-11 min-w-0 flex-1 rounded-md border border-bordure-champ bg-fond-surface px-3 text-body-s text-texte-principal"
          />
        </div>
        <div role="radiogroup" aria-label="Où chercher" className="flex gap-2 overflow-x-auto px-2 pb-2 [scrollbar-width:none]">
          {portees.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={portee === p.id}
              onClick={() => setPortee(p.id)}
              className={cn(
                "h-11 shrink-0 rounded-xs px-3 text-ui font-medium",
                portee === p.id ? "klyra-surface-sombre text-texte-inverse" : "bg-fond-surface-grise text-texte-secondaire",
              )}
            >
              {p.libelle}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {!saisie.trim() ? (
          <p className="pt-4 text-ui text-texte-secondaire">
            Cherche un mot, une décision ou un lien dans tes conversations avec les agents et dans les conversations de projet.
          </p>
        ) : !analysee ? (
          <p className="pt-4 text-ui text-texte-secondaire">Ajoute un mot pour préciser.</p>
        ) : rien ? (
          <div className="flex flex-col items-start gap-2 pt-4">
            <p role="status" className="text-ui text-texte-secondaire">
              Aucun message ne correspond à « {requete} ».
            </p>
            {portee !== "tout" ? (
              <button type="button" className="min-h-11 text-ui font-medium text-texte-principal" onClick={() => setPortee("tout")}>
                Chercher partout
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {trouvees.length > 0 ? (
              <section aria-label="Conversations" className="pt-3">
                <h2 className="text-ui font-medium text-texte-secondaire">Conversations</h2>
                <ul>
                  {trouvees.map(({ c, titre }) => {
                    const agent = c.kind === "equipe" ? null : agentDe(c.origine, c);
                    return (
                      <li key={c.origine}>
                        <Link
                          href={`/chat?id=${encodeURIComponent(c.origine)}`}
                          className="flex min-h-14 items-center gap-3 border-b border-bordure-subtile py-2 no-underline last:border-b-0 active:bg-fond-survol"
                        >
                          {agent ? <RondAgent id={agent} /> : <GrappeChat roleIds={c.roleIds} />}
                          <span className="min-w-0 flex-1 truncate text-body-s text-texte-principal">
                            <Surligne morceaux={surligner(titre, analysee)} />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            {messages && messages.length > 0 ? (
              <section aria-label="Messages" className="pt-3">
                <h2 className="text-ui font-medium text-texte-secondaire">Messages</h2>
                <ul>
                  {messages.map((m) => {
                    const c = parOrigine.get(m.conversationOrigine);
                    const auteur = m.auteurKind === "user" ? "Toi" : nom(m.auteurId ?? "");
                    return (
                      <li key={m.origine}>
                        <button
                          type="button"
                          onClick={() => ouvrir(m.conversationOrigine, m.origine)}
                          className="flex w-full flex-col gap-1 border-b border-bordure-subtile py-3 text-left last:border-b-0 active:bg-fond-survol"
                        >
                          <span className="flex min-w-0 items-center gap-1.5 text-ui-xs text-texte-secondaire">
                            <span className="truncate font-medium text-texte-principal">{auteur}</span>
                            <span className="truncate">· {titreDe(m.conversationOrigine, c)}</span>
                            <span className="ml-auto shrink-0">{formatListDate(m.creeLe)}</span>
                          </span>
                          <span className="line-clamp-3 text-ui text-texte-secondaire [overflow-wrap:anywhere]">
                            <Surligne morceaux={surligner(m.extrait, analysee)} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : messages === undefined ? (
              <p className="pt-4 text-ui text-texte-secondaire" aria-busy="true">
                Recherche…
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
