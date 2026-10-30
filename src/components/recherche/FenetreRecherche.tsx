"use client";

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Kbd } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Grappe } from "@/components/shell/LignesBarre";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { formatDateComplete, formatListDate } from "@/lib/format";
import { apparition } from "@/lib/mouvement";
import {
  chercher,
  LIMITE,
  LONGUEUR_MIN,
  normaliser,
  type ConversationCherchable,
  type Morceau,
  type Portee,
  type Recherche,
  type Requete,
} from "@/lib/recherche";
import { retenirRequete, signalerRecherche } from "@/lib/recherche-session";
import { idDirect, useRoles, useWorkspace } from "@/lib/workspace";
import type { Chat, Role } from "@/types/domain";

/**
 * Rechercher dans les conversations (spec d'Iris, point 6) : une fenêtre
 * par-dessus l'écran, construite comme `Modale`, ouverte par le bouton du rail
 * ou ⌘K (événement `klyra:recherche`). Montée une seule fois : la requête, la
 * portée et la ligne ouverte restent en mémoire jusqu'à la fermeture de l'app.
 * Elle ne touche ni au composeur ni à la file : choisir un résultat ouvre la
 * conversation sur le message (`/chat?id=…&message=…`, cf. `MessageThread`).
 */

/** Les résultats suivent la frappe après ce délai (`--duration-fast`). */
const DELAI_FRAPPE = 120;

const FOCUSABLES = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PORTEES: { id: Portee; libelle: string }[] = [
  { id: "tout", libelle: "Tout" },
  { id: "agents", libelle: "Agents" },
  { id: "projets", libelle: "Projets" },
  { id: "conversation", libelle: "Cette conversation" },
];

const MARQUE = "rounded-2xs bg-fond-teinte-bleue px-px text-texte-principal";
const ETIQUETTE = "shrink-0 rounded-2xs bg-fond-surface-grise px-1.5 py-px text-ui-3xs font-medium text-texte-secondaire";

function Morceaux({ morceaux }: { morceaux: Morceau[] }) {
  return morceaux.map((m, i) =>
    m.trouve ? (
      <mark key={i} className={MARQUE}>
        {m.texte}
      </mark>
    ) : (
      <Fragment key={i}>{m.texte}</Fragment>
    ),
  );
}

/** Une ligne de la liste : un titre de conversation, ou un message. */
type Ligne =
  | { cle: string; genre: "conversation"; conversation: ConversationCherchable; titre: Morceau[] }
  | {
      cle: string;
      genre: "message";
      conversation: ConversationCherchable;
      messageId: string;
      date: string;
      prefixe: string;
      extrait: Morceau[];
    };

type Actif = { cle: string | null; index: number };
const PREMIERE: Actif = { cle: null, index: 0 };

/** Les lignes de la liste : les titres trouvés, puis les messages, avec le préfixe de la barre latérale (« Toi : », « Hugo : »). Les pièces jointes ne sont pas cherchées. */
function lignesDe(resultat: Recherche | null, roles: Role[]): Ligne[] {
  if (!resultat) return [];
  return [
    ...resultat.conversations.map((c): Ligne => ({ cle: `c:${c.conversation.chat.id}`, genre: "conversation", conversation: c.conversation, titre: c.titre })),
    ...resultat.messages.map((m): Ligne => {
      const { message, conversation } = m;
      const auteur = message.author;
      const prefixe =
        auteur.kind === "user"
          ? "Toi : "
          : conversation.chat.kind === "equipe"
            ? `${roles.find((r) => r.id === auteur.roleId)?.name ?? auteur.roleId} : `
            : "";
      return { cle: `m:${message.id}`, genre: "message", conversation, messageId: message.id, date: message.createdAt, prefixe, extrait: m.extrait };
    }),
  ];
}

/** Comment on reconnaît la conversation, comme dans la barre latérale : son nom et son étiquette. */
function identite(chat: Chat, titre: string, roles: Role[], projets: Map<string, string>): { nom: string; etiquette?: string; roleId: string | null } {
  if (chat.kind === "equipe") return { nom: titre, etiquette: (chat.projectId && projets.get(chat.projectId)) || undefined, roleId: null };
  const roleId = chat.fil?.roleId ?? chat.roleIds[0] ?? "principal";
  const role = roles.find((r) => r.id === roleId);
  if (chat.fil) return { nom: titre, etiquette: `${role?.name ?? roleId} · ${chat.fil.statut === "archive" ? "fil archivé" : "fil"}`, roleId };
  return { nom: role?.name ?? titre, etiquette: role?.tag, roleId };
}

function Visuel({ chat, roleId, roles, petit }: { chat: Chat; roleId: string | null; roles: Role[]; petit: boolean }) {
  if (roleId) return <AgentRond roleId={roleId} taille={petit ? 24 : 36} fondPastille="surface" />;
  return <Grappe chat={chat} roles={roles} petite={petit} />;
}

export function FenetreRecherche() {
  const { state, rouvrirFil } = useWorkspace();
  const roles = useRoles();
  const router = useRouter();
  const pathname = usePathname();
  const idCourant = useSearchParams().get("id");
  const uid = useId();

  const [ouverte, setOuverte] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [requete, setRequete] = useState("");
  const [portee, setPortee] = useState<Portee>("tout");
  /* La ligne active, et sa place : si elle disparaît (conversation vidée), celle qui prend sa place devient active. */
  const [actif, setActif] = useState<Actif>(PREMIERE);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);
  const carte = useRef<HTMLDivElement | null>(null);
  /* L'élément qui avait le focus avant l'ouverture : il le retrouve si l'on renonce. */
  const avant = useRef<HTMLElement | null>(null);

  const chatCourant = pathname === "/chat" && idCourant ? idCourant : null;

  const fermer = useCallback((rendreFocus: boolean) => {
    setOuverte(false);
    signalerRecherche(false);
    if (rendreFocus) avant.current?.focus?.();
    avant.current = null;
  }, []);

  /* Ouverture par le rail ou ⌘K (qui ferme aussi). */
  useEffect(() => {
    const surDemande = (e: Event) => {
      const basculer = (e as CustomEvent<{ basculer?: boolean }>).detail?.basculer;
      if (ouverte) {
        if (basculer) fermer(true);
        return;
      }
      avant.current = document.activeElement as HTMLElement | null;
      setOuverte(true);
      signalerRecherche(true);
      /* La ligne ouverte la dernière fois redevient active ; « Cette conversation » hors d'un chat revient à Tout. */
      setActif(ouvert ? { cle: ouvert, index: 0 } : PREMIERE);
      if (portee === "conversation" && !chatCourant) setPortee("tout");
    };
    window.addEventListener("klyra:recherche", surDemande);
    return () => window.removeEventListener("klyra:recherche", surDemande);
  }, [ouverte, ouvert, fermer, portee, chatCourant]);

  const porteeEffective: Portee = portee === "conversation" && !chatCourant ? "tout" : portee;
  const changerPortee = (p: Portee) => {
    setPortee(p);
    setActif(PREMIERE);
  };

  /* La requête mémorisée, présélectionnée : on peut retaper par-dessus. */
  useEffect(() => {
    if (!ouverte) return;
    champ.current?.focus();
    champ.current?.select();
  }, [ouverte]);

  /* Nouvelle requête : la première ligne redevient active. */
  useEffect(() => {
    if (saisie === requete) return;
    const t = setTimeout(() => {
      setRequete(saisie);
      setActif(PREMIERE);
    }, DELAI_FRAPPE);
    return () => clearTimeout(t);
  }, [saisie, requete]);

  const projets = useMemo(() => new Map(state.projects.map((p) => [p.id, p.name])), [state.projects]);

  /* Les conversations où l'on cherche, avec leur titre et la date de leur dernier message. Calculé seulement fenêtre ouverte. */
  const conversations = useMemo<ConversationCherchable[]>(() => {
    if (!ouverte) return [];
    const derniere = new Map<string, string>();
    for (const m of state.messages) {
      if (m.statut === "en-cours") continue;
      const d = derniere.get(m.chatId);
      if (!d || m.createdAt > d) derniere.set(m.chatId, m.createdAt);
    }
    const liste: ConversationCherchable[] = state.chats.map((chat) => ({
      chat,
      titre: chat.kind === "direct" && !chat.fil ? (roles.find((r) => r.id === chat.roleIds[0])?.name ?? chat.title) : chat.title,
      derniere: derniere.get(chat.id) ?? null,
    }));
    /* La conversation directe d'un agent existe dès qu'on l'ouvre, même absente de la liste des chats. */
    const connues = new Set(state.chats.map((c) => c.id));
    for (const role of roles) {
      const id = idDirect(role.id);
      if (connues.has(id) || !derniere.has(id)) continue;
      liste.push({
        chat: { id, kind: "direct", projectId: null, title: role.name, roleIds: [role.id], updatedAt: derniere.get(id)!, sessions: {}, luJusqua: null },
        titre: role.name,
        derniere: derniere.get(id)!,
      });
    }
    return liste;
  }, [ouverte, state.chats, state.messages, roles]);

  const resultat = useMemo(
    () => (ouverte && state.charge ? chercher(conversations, state.messages, requete, porteeEffective, chatCourant) : null),
    [ouverte, state.charge, conversations, state.messages, requete, porteeEffective, chatCourant],
  );

  const lignes = useMemo(() => lignesDe(resultat, roles), [resultat, roles]);

  const indexChoisi = lignes.findIndex((l) => l.cle === actif.cle);
  const index = lignes.length ? (indexChoisi >= 0 ? indexChoisi : Math.min(actif.index, lignes.length - 1)) : -1;
  const idLigne = useCallback((i: number) => `${uid}-ligne-${i}`, [uid]);

  useEffect(() => {
    if (index >= 0) document.getElementById(idLigne(index))?.scrollIntoView({ block: "nearest" });
  }, [index, ouverte, idLigne]);

  const choisir = (ligne: Ligne, i: number, requeteChoisie: Requete) => {
    setActif({ cle: ligne.cle, index: i });
    setOuvert(ligne.cle);
    fermer(false);
    const { chat } = ligne.conversation;
    if (chat.fil?.statut === "archive") rouvrirFil(chat.id);
    const id = encodeURIComponent(chat.id);
    if (ligne.genre === "message") {
      retenirRequete(requeteChoisie);
      router.push(`/chat?id=${id}&message=${encodeURIComponent(ligne.messageId)}`);
    } else {
      router.push(`/chat?id=${id}`);
    }
  };

  const surToucheChamp = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!lignes.length) return;
      const suivant = e.key === "ArrowDown" ? Math.min(index + 1, lignes.length - 1) : Math.max(index - 1, 0);
      setActif({ cle: lignes[suivant].cle, index: suivant });
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (saisie !== requete) {
        /* Entrée tout de suite après la frappe : les résultats de ce qui est tapé, jamais ceux d'avant. */
        const tout = state.charge ? chercher(conversations, state.messages, saisie, porteeEffective, chatCourant) : null;
        setRequete(saisie);
        setActif(PREMIERE);
        const premiere = lignesDe(tout, roles)[0];
        if (tout && premiere) choisir(premiere, 0, tout.requete);
      } else if (resultat && index >= 0) choisir(lignes[index], index, resultat.requete);
    }
  };

  /* Échap ferme, Tab tourne dans la fenêtre (comme `Modale`). */
  const surToucheCarte = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      fermer(true);
      return;
    }
    if (e.key !== "Tab" || !carte.current) return;
    const focusables = Array.from(carte.current.querySelectorAll<HTMLElement>(FOCUSABLES));
    if (!focusables.length) return;
    const premier = focusables[0];
    const dernier = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === premier) {
      e.preventDefault();
      dernier.focus();
    } else if (!e.shiftKey && document.activeElement === dernier) {
      e.preventDefault();
      premier.focus();
    }
  };

  /* Ref stable : recréée, elle relancerait l'animation à chaque rendu. */
  const refCarte = useCallback((el: HTMLDivElement | null) => {
    carte.current = el;
    apparition(el);
  }, []);

  if (!ouverte) return null;

  const tapee = normaliser(requete).texte;
  const total = resultat ? resultat.conversations.length + resultat.totalMessages : 0;
  const montres = resultat ? resultat.conversations.length + resultat.messages.length : 0;
  const compteur = !resultat || !total ? "" : montres < total ? `${montres} premiers résultats sur ${total}` : `${total} résultat${total > 1 ? "s" : ""}`;
  const deuxGroupes = !!resultat?.conversations.length && !!resultat?.messages.length;

  let contenu: ReactNode;
  if (!state.charge) {
    contenu = <p className="m-0 px-4 py-6 text-ui-xs text-texte-tertiaire">Chargement des conversations…</p>;
  } else if (!tapee) {
    contenu = (
      <p className="m-0 px-4 py-6 text-ui-xs text-texte-tertiaire">
        Cherche un mot, une décision ou un lien dans tes conversations avec les agents et dans les conversations de projet.
      </p>
    );
  } else if (!resultat) {
    contenu = <p className="m-0 px-4 py-6 text-ui-xs text-texte-tertiaire">Tape au moins {LONGUEUR_MIN} caractères.</p>;
  } else if (!lignes.length) {
    contenu = (
      <div className="flex flex-col items-start gap-2 px-4 py-6">
        <p role="status" className="m-0 text-ui-xs text-texte-tertiaire">
          Aucun message ne correspond à « {requete.trim()} ».
        </p>
        {porteeEffective !== "tout" && (
          <Bouton variant="discret" taille="compact" onClick={() => changerPortee("tout")}>
            Chercher partout
          </Bouton>
        )}
      </div>
    );
  } else {
    contenu = null;
  }

  const ligneVue = (ligne: Ligne, i: number) => {
    const { chat, titre } = ligne.conversation;
    const qui = identite(chat, titre, roles, projets);
    const active = i === index;
    const commun = {
      id: idLigne(i),
      role: "option" as const,
      "aria-selected": active,
      "data-chat": chat.id,
      onMouseMove: () => !active && setActif({ cle: ligne.cle, index: i }),
      /* Le focus reste dans le champ : on peut continuer à taper. */
      onMouseDown: (e: MouseEvent) => e.preventDefault(),
      onClick: () => resultat && choisir(ligne, i, resultat.requete),
    };
    const classes = cn(
      "flex cursor-pointer gap-2.5 rounded-md px-2.5 transition-[background-color,scale] duration-[120ms] ease-sortie active:scale-[0.99]",
      active && "bg-fond-survol",
    );
    if (ligne.genre === "conversation") {
      const date = ligne.conversation.derniere;
      return (
        <div key={ligne.cle} {...commun} className={cn(classes, "h-11 items-center")}>
          <Visuel chat={chat} roleId={qui.roleId} roles={roles} petit />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <strong className="truncate text-ui-s font-semibold text-texte-principal">
              <Morceaux morceaux={ligne.titre} />
            </strong>
            {qui.etiquette && <span className={ETIQUETTE}>{qui.etiquette}</span>}
            {date && (
              <span title={formatDateComplete(date)} className="ml-auto shrink-0 pl-1 text-ui-3xs text-texte-tertiaire">
                {formatListDate(date)}
              </span>
            )}
          </span>
        </div>
      );
    }
    return (
      <div key={ligne.cle} {...commun} data-message={ligne.messageId} className={cn(classes, "min-h-14 items-start py-2")}>
        <Visuel chat={chat} roleId={qui.roleId} roles={roles} petit={false} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <strong className="truncate text-ui-s font-semibold text-texte-principal">{qui.nom}</strong>
            {qui.etiquette && <span className={ETIQUETTE}>{qui.etiquette}</span>}
            <span title={formatDateComplete(ligne.date)} className="ml-auto shrink-0 pl-1 text-ui-3xs text-texte-tertiaire">
              {formatListDate(ligne.date)}
            </span>
          </span>
          <span className="line-clamp-2 text-ui-xs leading-[1.45] text-texte-secondaire [overflow-wrap:anywhere]">
            {ligne.prefixe}
            <Morceaux morceaux={ligne.extrait} />
          </span>
        </span>
      </div>
    );
  };

  const nbConversations = resultat?.conversations.length ?? 0;
  const titreConversations = `${uid}-conversations`;
  const titreMessages = `${uid}-messages`;

  /* Rendue à la racine de la page, comme `Modale`. */
  return createPortal(
    <div
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && fermer(true)}
      className="klyra-voile fixed inset-0 z-[60] flex items-start justify-center bg-fond-inverse-fort/40 px-4 pt-[12vh]"
    >
      <div
        ref={refCarte}
        role="dialog"
        aria-modal="true"
        aria-label="Rechercher dans les conversations"
        data-recherche=""
        onKeyDown={surToucheCarte}
        className="relative flex max-h-[calc(88vh-16px)] w-[640px] max-w-full flex-col overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-lg"
      >
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-bordure-subtile pr-12 pl-4 focus-within:border-focus">
          <Icon name="search-01" size={18} className="shrink-0 text-icone-secondaire" />
          <input
            ref={champ}
            type="text"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={surToucheChamp}
            placeholder="Rechercher dans les conversations…"
            role="combobox"
            aria-expanded={lignes.length > 0}
            aria-controls={`${uid}-liste`}
            aria-activedescendant={index >= 0 ? idLigne(index) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 border-0 bg-transparent text-ui text-texte-principal placeholder:text-texte-placeholder focus:outline-none"
          />
        </div>

        <div role="radiogroup" aria-label="Où chercher" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-bordure-subtile px-4 py-2.5">
          {PORTEES.filter((p) => p.id !== "conversation" || chatCourant).map((p) => (
            <Fragment key={p.id}>
              {p.id === "conversation" && <span aria-hidden="true" className="mx-1 h-4 w-px bg-bordure-subtile" />}
              <button
                type="button"
                role="radio"
                aria-checked={porteeEffective === p.id}
                onClick={() => changerPortee(p.id)}
                className={cn(
                  "flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border-0 px-2.5 text-ui-xs font-medium transition-colors duration-[120ms]",
                  porteeEffective === p.id ? "klyra-surface-sombre text-texte-inverse" : "bg-fond-surface-grise text-texte-secondaire hover:text-texte-principal",
                )}
              >
                {p.libelle}
                {resultat && <span className="klyra-mono opacity-70">{resultat.parPortee[p.id]}</span>}
              </button>
            </Fragment>
          ))}
        </div>

        {/* Après les puces dans l'ordre du clavier (champ, puces, Fermer), en haut à droite à l'écran. */}
        <BoutonIcone
          taille="mini"
          libelle="Fermer la recherche"
          icone={<Icon name="x-01" size={16} />}
          onClick={() => fermer(true)}
          className="absolute top-3.5 right-3"
        />

        {/* Les états (aide, chargement, aucun résultat) à côté de la liste, qui ne contient que des résultats. */}
        {contenu}
        <div
          id={`${uid}-liste`}
          role="listbox"
          aria-label="Résultats"
          className={cn("klyra-defilement-fin min-h-0 flex-1 overflow-y-auto p-1.5", !!contenu && "hidden")}
        >
          {!contenu && (
            <>
              {nbConversations > 0 && (
                <div role="group" aria-labelledby={deuxGroupes ? titreConversations : undefined}>
                  {deuxGroupes && (
                    <div id={titreConversations} role="presentation" className="px-2.5 pt-2 pb-1 text-ui-2xs font-medium text-texte-tertiaire">
                      Conversations
                    </div>
                  )}
                  {lignes.slice(0, nbConversations).map((l, i) => ligneVue(l, i))}
                </div>
              )}
              {lignes.length > nbConversations && (
                <div role="group" aria-labelledby={deuxGroupes ? titreMessages : undefined}>
                  {deuxGroupes && (
                    <div id={titreMessages} role="presentation" className="px-2.5 pt-2 pb-1 text-ui-2xs font-medium text-texte-tertiaire">
                      Messages
                    </div>
                  )}
                  {lignes.slice(nbConversations).map((l, i) => ligneVue(l, i + nbConversations))}
                </div>
              )}
              {resultat && resultat.totalMessages > LIMITE && (
                <p role="presentation" className="m-0 px-2.5 py-2 text-ui-xs text-texte-tertiaire">
                  Ajoute un mot pour préciser.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex h-9 shrink-0 items-center gap-3 border-t border-bordure-subtile px-4 text-ui-2xs text-texte-tertiaire">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> choisir · <Kbd>Entrée</Kbd> ouvrir · <Kbd>Échap</Kbd> fermer
          </span>
          <span role="status" aria-live="polite" className="ml-auto">
            {compteur}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
