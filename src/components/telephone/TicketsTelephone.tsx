"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { cn } from "@/lib/cn";
import { useCompte } from "@/lib/compte";
import { aujourdhui, libelleEcheance } from "@/lib/dates";
import { formatListDate } from "@/lib/format";
import { useGestePoste } from "@/lib/poste/client";
import { majuscule, texteErreurPoste } from "@/lib/poste-texte";
import { etatLigne, tachesDe, type ConversationLue } from "@/lib/telephone/chats";
import { COLONNES_TELEPHONE, NOMS_COLONNES, demandeEnCours, derniereErreur, disponibilite, extraitBorne, libelleMoment, progression, tableauTelephone, texteAttente, ticketAttendu, type DemandeLue, type LigneTicket, lireTicket } from "@/lib/telephone/tickets";
import type { ColonneTicket } from "@/lib/tickets";
import { useCartes, RondAgent } from "./AgentsChat";
import { useAnnonce } from "./Annonce";
import { useHorsLigne } from "./BandeauReseau";
import { useApres } from "./ChatsTelephone";
import { CocheChoix, MessageErreur, Puce } from "./Controles";
import { useDemandeTicket } from "./DemandesTickets";
import { EnteteTelephone } from "./EnteteTelephone";
import { MenuFeuille, useAppuiLong, useFermerFeuille, type ActionMenu } from "./Feuille";
import { AucunPoste, EtatEcran, Squelette } from "./etats";
import { Carte, Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { PrevenirOuverture } from "./PastillePoste";
import { usePostes, useSupport } from "./poste";

const PRIORITES = ["Aucune", "Basse", "Moyenne", "Haute"] as const;
const SANS_RESEAU = "Possible quand ce téléphone est en ligne";
const VIDES: Record<ColonneTicket, { titre: string; texte: string }> = {
  "a-valider": { titre: "Rien à valider", texte: "Quand un agent a fini, son ticket arrive ici pour que tu le valides." },
  bloque: { titre: "Rien de bloqué", texte: "Quand un agent attend quelque chose de toi (un accès, une réponse), son ticket arrive ici." },
  "en-cours": { titre: "Rien en cours", texte: "Quand un agent travaille sur un ticket, il arrive ici." },
  "a-faire": { titre: "Rien à faire", texte: "Un ticket qui attend encore un agent arrive ici." },
  termine: { titre: "Rien de terminé", texte: "Les tickets validés et fermés arrivent ici." },
};

const lienFil = (origine: string) => `/chat?id=${encodeURIComponent(origine)}`;

/**
 * Tickets sur le téléphone (lot 4, E4-02 à E4-18). Un ticket reste un fil : les étapes et le tri sont ceux
 * du bureau, lus sur la copie du compte. Ce qui est demandé s'affiche à part de l'état confirmé : la carte
 * ne bouge qu'à l'accusé de l'ordinateur. Parent : Plus (`/tickets`), puis la liste avec son filtre (`?id=`).
 */
export function TicketsTelephone() {
  const params = useSearchParams();
  const id = params.get("id");
  return id ? <DetailTicket key={id} origine={id} /> : <ListeTickets />;
}

/** Ce que la liste et le détail partagent. */
function useLectureTickets() {
  const { etat } = useCompte();
  const conversations = useQuery(api.conversationsCompte.liste, etat === "connecte" ? {} : "skip");
  const { demandes, envoyer } = useDemandeTicket();
  const { postes, principal, ouvert } = usePostes();
  const sur = useSupport();
  const horsLigne = useHorsLigne();
  const annoncer = useAnnonce();

  const agir = async (ligne: Pick<LigneTicket, "conversation" | "ticket">, type: DemandeLue["type"], valeur: Record<string, unknown> = {}) => {
    const erreur = await envoyer(ligne.conversation.origine, type, valeur, ligne.ticket.revision);
    if (erreur) annoncer({ texte: erreur, erreur: true });
    else if (!ouvert) annoncer({ texte: `Demande enregistrée. Elle partira à l’ouverture de ${sur}.`, icone: "clock-backward" });
  };
  return { conversations, demandes, postes, principal, posteOuvert: ouvert, sur, horsLigne, agir };
}
type Lecture = ReturnType<typeof useLectureTickets>;

/* ─── La liste ───────────────────────────────────────────────────── */

function ListeTickets() {
  const params = useSearchParams();
  const router = useRouter();
  const lecture = useLectureTickets();
  const { conversations, postes, principal, posteOuvert, sur } = lecture;
  const { nom } = useCartes();
  const brut = params.get("etape");
  const etape = (COLONNES_TELEPHONE as string[]).includes(brut ?? "") ? (brut as ColonneTicket) : null;
  const agent = params.get("agent");
  const projet = params.get("projet");
  const [tous, setTous] = useState(false);
  const [menu, setMenu] = useState(false);
  const [maintenant] = useState(() => new Date());
  const zone = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const apresValidation = useRef<string | null>(null);
  const dispo = disponibilite(conversations);
  const chargement = useApres(300, dispo === "chargement" || postes === undefined);

  const lues = useMemo(() => (conversations ?? []).filter((c) => (!agent || c.roleIds[0] === agent) && (!projet || c.projetId === projet)), [conversations, agent, projet]);
  const { colonnes, termines } = useMemo(() => tableauTelephone(lues, { posteOuvert, maintenant, tousTermines: tous }), [lues, posteOuvert, maintenant, tous]);
  const compte = (c: ColonneTicket) => (c === "termine" ? termines : colonnes[c].length);
  const ouverts = colonnes["a-valider"].length + colonnes.bloque.length + colonnes["en-cours"].length + colonnes["a-faire"].length;

  /* Le filtre change sur place : la position de chaque vue reste où on l'a laissée (E4-03). */
  const cleVue = etape ?? "tout";
  const choisir = (suivante: ColonneTicket | null) => {
    if (zone.current) positions.current.set(cleVue, zone.current.scrollTop);
    const p = new URLSearchParams(params);
    if (suivante) p.set("etape", suivante);
    else p.delete("etape");
    const q = p.toString();
    router.replace(q ? `/tickets?${q}` : "/tickets", { scroll: false });
  };
  useLayoutEffect(() => {
    if (zone.current) zone.current.scrollTop = positions.current.get(cleVue) ?? 0;
  }, [cleVue]);

  /* Après une validation confirmée, le focus va à la carte suivante, ou au titre de la section (§ 4). */
  const aValider = colonnes["a-valider"];
  useEffect(() => {
    const parti = apresValidation.current;
    if (!parti || aValider.some((l) => l.conversation.origine === parti)) return;
    apresValidation.current = null;
    const suivante = aValider[0]?.conversation.origine;
    const cible = suivante ? zone.current?.querySelector<HTMLElement>(`[data-ticket="${CSS.escape(suivante)}"] button`) : zone.current?.querySelector<HTMLElement>("h2");
    if (cible && !suivante) cible.tabIndex = -1;
    cible?.focus();
  }, [aValider]);

  const pret = dispo !== "chargement" && postes !== undefined;
  const avecPuces = pret ? dispo === "compatible" : true;
  const droite = pret && dispo === "compatible" ? <BoutonIcone variant="discret" className="size-11" libelle="Options des tickets" aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => setMenu(true)} /> : null;
  const colonnesVues = etape ? [etape] : COLONNES_TELEPHONE;
  const parent = (p: string) => (etape ? `${p}&etape=${etape}` : p);

  let contenu;
  if (!pret) {
    contenu = chargement ? (
      <div aria-busy="true" className="flex flex-col gap-3 px-4 pt-2">
        <Squelette lignes={3} />
      </div>
    ) : null;
  } else if (postes.length === 0) {
    contenu = <AucunPoste phrase={() => "tes agents travaillent sur ton ordinateur ; leurs tickets arrivent ici."} />;
  } else if (dispo !== "compatible") {
    contenu = posteOuvert ? (
      <EtatEcran icone="computer" titre="KLYRA est à mettre à jour" texte={`Les tickets arrivent ici avec une version récente de KLYRA sur ${sur}. Tes conversations restent utilisables dans Chats.`} />
    ) : (
      <EtatEcran
        icone="computer"
        titre={`${majuscule(sur)} est fermé`}
        texte={`Les tickets de tes agents arrivent ici quand KLYRA est ouverte sur ${sur}, et y restent ensuite, même fermé.`}
        action={principal ? <PrevenirOuverture cle={principal.cle} /> : null}
      />
    );
  } else {
    const videFiltre = etape !== null && colonnes[etape].length === 0 && compte(etape) === 0;
    const toutVide = etape === null && ouverts === 0;
    contenu = (
      <div className="flex flex-col gap-6 px-4 pb-8">
        {!posteOuvert && principal ? (
          <p className="flex gap-3 rounded-xl bg-fond-surface-grise p-3 text-ui text-texte-secondaire">
            <Icon name="computer" size={20} className="mt-0.5 shrink-0 text-icone-secondaire" />
            <span>
              {majuscule(sur)} est fermé depuis {libelleMoment(principal.dernierSignal, maintenant)} : les tickets sont tels qu’il les a laissés. Ce que tu fais ici partira à son ouverture.
            </span>
          </p>
        ) : null}
        {videFiltre ? <EtatEcran forme="encadre" className="px-0 pb-0" icone="check-01" titre={VIDES[etape].titre} texte={VIDES[etape].texte} /> : null}
        {toutVide ? (
          <EtatEcran
            className="px-0 pt-8 pb-0"
            icone="list"
            titre="Aucun ticket ouvert"
            texte="Un ticket naît quand tu ouvres un fil dans le chat d’un agent, quand tu lui confies un rappel, ou quand un agent ouvre un fil."
            action={
              <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="message-plus-01" size={20} />} onClick={() => router.push("/chats?ecrire=1")}>
                Écrire à un agent
              </Bouton>
            }
          />
        ) : null}
        {colonnesVues.map((colonne) => {
          const lignes = colonnes[colonne];
          if (lignes.length === 0 && !(colonne === "termine" && termines > 0)) return null;
          const titre = colonne === "en-cours" && !posteOuvert ? "En cours · dernière vue" : NOMS_COLONNES[colonne];
          return (
            <SectionListe key={colonne} titre={titre} compte={colonne === "termine" ? (etape ? termines : lignes.length) : lignes.length} compteAccent={colonne === "a-valider"}>
              <ul className="flex flex-col gap-3">
                {lignes.map((ligne) => (
                  <li key={ligne.conversation.origine}>
                    <CarteTicket ligne={ligne} lecture={lecture} lien={parent(`/tickets?id=${encodeURIComponent(ligne.conversation.origine)}`)} onValider={() => (apresValidation.current = ligne.conversation.origine)} maintenant={maintenant} />
                  </li>
                ))}
              </ul>
              {colonne === "termine" && !tous && termines > lignes.length ? (
                <button type="button" onClick={() => setTous(true)} className="mt-1 min-h-11 px-1 text-left text-ui font-medium text-texte-principal">
                  Tous les fils fermés ({termines})
                </button>
              ) : null}
            </SectionListe>
          );
        })}
        <p role="status" className="sr-only">
          {etape ? `${compte(etape)} ${NOMS_COLONNES[etape].toLowerCase()}` : `${ouverts} tickets ouverts`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Tickets" parent="/plus" pastille={false} droite={droite} />
      <div ref={zone} className="min-h-0 flex-1 overflow-y-auto">
        {avecPuces && (pret ? postes.length > 0 : chargement) ? (
          <div role="group" aria-label="Filtrer par étape" className="sticky top-0 z-10 flex gap-2 overflow-x-auto bg-fond-page px-4 py-2 [scrollbar-width:none]">
            <Puce choisie={etape === null} onClick={() => choisir(null)}>
              Tout
            </Puce>
            {COLONNES_TELEPHONE.map((c) => (
              <Puce key={c} choisie={etape === c} onClick={() => choisir(c)}>
                {NOMS_COLONNES[c]}
                {pret ? <span className={cn("font-normal", etape !== c && (c === "a-valider" && compte(c) > 0 ? "font-semibold text-texte-accent" : "text-texte-secondaire"))}>{compte(c)}</span> : null}
              </Puce>
            ))}
          </div>
        ) : null}
        {agent || projet ? (
          <div className="px-4 pb-2">
            <Puce
              onClick={() => {
                const p = new URLSearchParams(params);
                p.delete("agent");
                p.delete("projet");
                router.replace(p.toString() ? `/tickets?${p}` : "/tickets", { scroll: false });
              }}
            >
              {agent ? nom(agent) : (lues[0]?.projetNom ?? "Ce projet")}
              <Icon name="x-01" size={14} />
            </Puce>
          </div>
        ) : null}
        {contenu}
      </div>
      {menu ? (
        <MenuFeuille
          titre="Tickets"
          onFermer={() => setMenu(false)}
          actions={[
            { libelle: "Écrire à un agent", icone: "message-plus-01", onChoisir: () => router.push("/chats?ecrire=1") },
            tous
              ? { libelle: "Seulement les 7 derniers jours", icone: "clock-backward", onChoisir: () => setTous(false) }
              : { libelle: `Tous les fils fermés (${termines})`, icone: "clock-backward", onChoisir: () => setTous(true) },
          ]}
        />
      ) : null}
    </div>
  );
}

/* ─── Une carte ──────────────────────────────────────────────────── */

const metaDeCarte = (ligne: LigneTicket, posteOuvert: boolean, maintenant: Date): { texte: string; accent: boolean } => {
  const { conversation: c, ticket, colonne } = ligne;
  if (colonne === "termine") {
    const quand = ticket.fermeLe ? formatListDate(ticket.fermeLe, maintenant) : "";
    return { texte: quand ? `Fermé ${/^\d/.test(quand) ? "à " : ""}${/^\d/.test(quand) ? quand : quand.toLowerCase()}` : "Fermé", accent: false };
  }
  if (colonne === "en-cours") {
    if (posteOuvert) return { texte: "En cours", accent: true };
    return { texte: `Vue à ${libelleMoment(ticket.fermeLe ?? c.misAJour, maintenant)}`, accent: false };
  }
  return { texte: formatListDate(c.extraitLe ?? c.misAJour, maintenant), accent: false };
};

function BarreProgression({ faites, total, className }: { faites: number; total: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={faites} aria-label="Tâches faites" className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-fond-surface-grise">
        <div className="h-full rounded-full bg-fond-accent" style={{ width: `${total ? (faites / total) * 100 : 0}%` }} />
      </div>
      <span className="shrink-0 text-ui-xs text-texte-secondaire">
        {faites}/{total} tâches
      </span>
    </div>
  );
}

function Priorite({ valeur }: { valeur: number }) {
  if (valeur === 0) return null;
  return (
    <>
      <span aria-hidden="true" className="mr-1 font-semibold text-texte-accent">
        {"!".repeat(valeur)}
      </span>
      <span className="sr-only">Priorité {PRIORITES[valeur].toLowerCase()} : </span>
    </>
  );
}

function EtiquetteEcheance({ echeance }: { echeance: string }) {
  const retard = echeance < aujourdhui();
  const texte = `Échéance ${libelleEcheance(echeance, null).toLowerCase()}`;
  return retard ? <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-fond-surface-grise px-1.5 text-ui-xs font-medium whitespace-nowrap text-texte-erreur">{texte}</span> : <Etiquette>{texte}</Etiquette>;
}

function CarteTicket({ ligne, lecture, lien, onValider, maintenant }: { ligne: LigneTicket; lecture: Lecture; lien: string; onValider: () => void; maintenant: Date }) {
  const router = useRouter();
  const { nom, carte } = useCartes();
  const { demandes, posteOuvert, horsLigne, sur, agir } = lecture;
  const [menu, setMenu] = useState(false);
  const appui = useAppuiLong(() => setMenu(true));
  const { conversation: c, ticket, colonne, roleId } = ligne;
  const attente = demandeEnCours(demandes, c.origine);
  const termine = colonne === "termine";
  const avance = progression(c);
  const meta = metaDeCarte(ligne, posteOuvert, maintenant);
  const accessible = [c.titre, nom(roleId), NOMS_COLONNES[colonne].toLowerCase(), ticket.priorite ? `priorité ${PRIORITES[ticket.priorite].toLowerCase()}` : null].filter(Boolean).join(" ; ");

  return (
    <article data-ticket={c.origine} className={cn("relative rounded-xl border border-bordure-subtile p-4", termine ? "bg-transparent" : "bg-fond-surface shadow-ombre-ambiante")}>
      <button type="button" {...appui} aria-label={accessible} onClick={() => router.push(lien)} className="block w-full text-left">
        <span className="flex min-w-0 items-center gap-2">
          <RondAgent id={roleId} taille={24} />
          <span className="truncate text-ui font-medium text-texte-principal">{nom(roleId)}</span>
          {carte(roleId)?.roleCourt ? <span className="truncate text-ui-xs text-texte-secondaire">{carte(roleId)?.roleCourt}</span> : null}
          <span className={cn("ml-auto shrink-0 pl-2 text-ui-xs whitespace-nowrap", meta.accent ? "font-semibold text-texte-accent" : "text-texte-secondaire")}>{meta.texte}</span>
        </span>
        <span className={cn("mt-2 line-clamp-2 block text-body-s [overflow-wrap:anywhere]", termine ? "text-texte-secondaire" : "font-medium text-texte-principal")}>
          <Priorite valeur={ticket.priorite} />
          {c.titre}
        </span>
        {colonne === "bloque" && ticket.raison ? (
          <span className="mt-1.5 flex items-start gap-1.5 text-ui text-texte-erreur">
            <Icon name="help-circle-contained" size={16} className="mt-0.5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{ticket.raison}</span>
          </span>
        ) : null}
        {colonne === "en-cours" && avance ? <BarreProgression faites={avance.faites} total={avance.total} className="mt-2.5" /> : null}
        {!termine && (ticket.projetNom || ticket.rappel || ticket.echeance || ticket.lancePar) ? (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {ticket.projetNom ? <Etiquette>{ticket.projetNom}</Etiquette> : null}
            {ticket.rappel ? <Etiquette>Vient d’un rappel</Etiquette> : null}
            {ticket.echeance ? <EtiquetteEcheance echeance={ticket.echeance} /> : null}
            {ticket.lancePar ? <Etiquette>Lancé par {nom(ticket.lancePar)}</Etiquette> : null}
          </span>
        ) : null}
      </button>
      {attente ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-ui text-texte-secondaire">
          <Icon name="clock-backward" size={16} className="shrink-0" />
          {texteAttente(attente, sur, posteOuvert)}
        </p>
      ) : colonne === "a-valider" && !horsLigne ? (
        <Bouton
          variant="gris"
          taille="compact"
          className="mt-2.5 h-10 px-3.5 text-ui"
          iconeGauche={<Icon name="check-01" size={16} />}
          onClick={() => {
            onValider();
            void agir(ligne, "fermer");
          }}
        >
          Valider et fermer
        </Bouton>
      ) : null}
      <button type="button" aria-haspopup="dialog" onClick={() => setMenu(true)} className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:right-2 focus:rounded-xs focus:bg-fond-surface focus:p-2 focus:text-ui">
        Actions pour {c.titre}
      </button>
      {menu ? <MenuTicket ligne={ligne} lecture={lecture} onFermer={() => setMenu(false)} /> : null}
    </article>
  );
}

/* ─── Le menu d'un ticket (E4-08, E4-09, E4-10, E4-12) ───────────── */

function useArret(origine: string, sur: string) {
  const { faire, occupe } = useGestePoste();
  const annoncer = useAnnonce();
  const [demande, setDemande] = useState(false);
  const arreter = async () => {
    const r = await faire("fil.arreter", { conversation: origine });
    if (r.ok) {
      setDemande(true);
      annoncer({ texte: "Arrêt demandé", icone: "clock-backward" });
    } else annoncer({ texte: texteErreurPoste(r, sur), erreur: true });
  };
  return { arreter, occupe, demande };
}

function ChoixPriorite({ ligne, lecture }: { ligne: LigneTicket; lecture: Lecture }) {
  const fermer = useFermerFeuille();
  return (
    <GroupeListe>
      {PRIORITES.map((libelle, rang) => (
        <LigneListe
          key={libelle}
          nom={libelle}
          uneLigne
          etiquette={rang > 0 ? <Etiquette ton="bleue">{"!".repeat(rang)}</Etiquette> : undefined}
          fin={<CocheChoix choisi={ligne.ticket.priorite === rang} />}
          onClick={() => {
            if (rang !== ligne.ticket.priorite) void lecture.agir(ligne, "priorite", { priorite: rang });
            fermer();
          }}
        />
      ))}
    </GroupeListe>
  );
}

/** Rendu sans composant autour : passer du menu à sa sous-page garde la même feuille, et son entrée d'historique. */
const feuillePriorite = (ligne: LigneTicket, lecture: Lecture, onFermer: () => void, onRetour?: () => void) => (
  <MenuFeuille titre="Priorité" sousTitre={ligne.conversation.titre} retour={onRetour} entete={<ChoixPriorite ligne={ligne} lecture={lecture} />} actions={[]} onFermer={onFermer} />
);

function MenuTicket({ ligne, lecture, onFermer, surDetail = false }: { ligne: LigneTicket; lecture: Lecture; onFermer: () => void; surDetail?: boolean }) {
  const router = useRouter();
  const { nom } = useCartes();
  const { demandes, horsLigne, posteOuvert, sur, agir } = lecture;
  const { conversation: c, ticket, colonne, roleId } = ligne;
  const [priorite, setPriorite] = useState(false);
  const { arreter } = useArret(c.origine, sur);
  const attente = demandeEnCours(demandes, c.origine);
  const bloque = horsLigne || !!attente;
  const note = horsLigne ? SANS_RESEAU : attente ? texteAttente(attente, sur, posteOuvert) : undefined;
  const termine = colonne === "termine";
  const agent = nom(roleId);
  if (priorite) return feuillePriorite(ligne, lecture, onFermer, () => setPriorite(false));

  const actions: ActionMenu[] = [
    { libelle: "Ouvrir le fil", icone: "message-square", onChoisir: () => router.push(lienFil(c.origine)) },
    ...(termine
      ? []
      : [{ libelle: "Priorité", icone: "star-01" as const, sousPage: true, valeur: PRIORITES[ticket.priorite], desactivee: bloque, note, onChoisir: () => setPriorite(true) }]),
    ...(colonne === "en-cours"
      ? [{ libelle: `Arrêter ${agent}`, icone: "square" as const, desactivee: !posteOuvert || horsLigne, note: horsLigne ? SANS_RESEAU : posteOuvert ? undefined : `Possible quand ${sur} est ouvert`, onChoisir: () => void arreter() }]
      : []),
    ...(termine
      ? [{ libelle: "Rouvrir", icone: "arrow-rotate-left-01" as const, separateurAvant: true, desactivee: bloque, note, onChoisir: () => void agir(ligne, "rouvrir") }]
      : [
          ...(colonne !== "a-faire" ? [{ libelle: "Remettre à faire", icone: "arrow-rotate-left-01" as const, separateurAvant: true, desactivee: bloque, onChoisir: () => void agir(ligne, "etape", { etape: "a-faire" }) }] : []),
          { libelle: colonne === "a-valider" ? "Valider et fermer" : "Fermer", icone: colonne === "a-valider" ? ("check-01" as const) : ("x-01" as const), desactivee: bloque, onChoisir: () => void agir(ligne, "fermer") },
        ]),
    {
      libelle: "Supprimer…",
      icone: "trash-01",
      danger: !bloque,
      desactivee: bloque,
      note,
      confirmation: {
        titre: `Supprimer « ${c.titre} » ?`,
        texte: `Le fil quitte les tickets et les fils archivés de ${agent}. Rien n’est effacé sur ${sur}${ticket.rappel ? ", et le rappel d’où il vient n’est pas coché" : ""}.`,
        confirmer: "Supprimer",
      },
      onChoisir: () => {
        void agir(ligne, "supprimer");
        if (surDetail) router.back();
      },
    },
  ];
  return <MenuFeuille titre={c.titre} objet={{ visuel: <RondAgent id={roleId} taille={36} />, sous: `${agent} · ${NOMS_COLONNES[colonne].toLowerCase()}` }} onFermer={onFermer} actions={actions} />;
}

/* ─── Le détail (E4-05, E4-06, E4-07) ────────────────────────────── */

function DerniereReponse({ c, agent }: { c: ConversationLue; agent: string }) {
  const router = useRouter();
  const lus = useQuery(api.conversationsCompte.messages, { origine: c.origine });
  const reponse = lus ? [...lus.messages].reverse().find((m) => m.auteurKind === "role" && !m.compaction && m.statut !== "en-cours" && m.texte.trim()) : null;
  if (lus === undefined) return <Squelette lignes={2} />;
  if (!reponse) {
    return (
      <Carte>
        <p className="text-ui text-texte-secondaire">Ouvre le fil pour lire le résultat.</p>
        <button type="button" onClick={() => router.push(lienFil(c.origine))} className="mt-1 inline-flex min-h-11 items-center gap-1 text-ui font-medium text-texte-principal">
          Ouvrir le fil
          <Icon name="chevron-right" size={16} />
        </button>
      </Carte>
    );
  }
  const extrait = extraitBorne(reponse.texte);
  return (
    <Carte>
      <p className="text-ui-xs font-medium text-texte-secondaire">
        Dernière réponse de {agent} · {libelleMoment(reponse.creeLe)}
      </p>
      <p className="mt-2 text-ui whitespace-pre-wrap text-texte-principal [overflow-wrap:anywhere]">{extrait.texte}</p>
      <button type="button" onClick={() => router.push(lienFil(c.origine))} className="mt-1 inline-flex min-h-11 items-center gap-1 text-ui font-medium text-texte-principal">
        {extrait.coupe ? "Lire la suite dans le fil" : "Lire tout le fil"}
        <Icon name="chevron-right" size={16} />
      </button>
    </Carte>
  );
}

function TachesTicket({ c, agent }: { c: ConversationLue; agent: string }) {
  const taches = tachesDe(c);
  if (taches.length === 0) return null;
  return (
    <SectionListe titre={`Tâches de ${agent} ${taches.filter((t) => t.statut === "fait").length}/${taches.length}`} className="mt-6">
      <GroupeListe>
        {taches.map((t, i) => (
          <li key={i} className="flex min-h-11 items-center gap-3 border-b border-bordure-subtile px-4 py-2 last:border-b-0">
            {t.statut === "fait" ? (
              <Icon name="check-01" size={16} className="shrink-0 text-icone-accent" />
            ) : t.statut === "en-cours" ? (
              <Icon name="loader-01" size={16} className="shrink-0 text-icone-accent" />
            ) : (
              <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-bordure-forte" />
            )}
            <span className={cn("min-w-0 text-ui [overflow-wrap:anywhere]", t.statut === "fait" ? "text-texte-secondaire" : "text-texte-principal")}>{t.texte}</span>
          </li>
        ))}
      </GroupeListe>
    </SectionListe>
  );
}

function DetailTicket({ origine }: { origine: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const lecture = useLectureTickets();
  const { conversations, demandes, posteOuvert, horsLigne, sur, agir } = lecture;
  const { nom, carte } = useCartes();
  const [menu, setMenu] = useState(false);
  const [prioriteOuverte, setPrioriteOuverte] = useState(false);
  const [maintenant] = useState(() => new Date());
  const { arreter, occupe: arretEnCours, demande: arretDemande } = useArret(origine, sur);
  const etape = params.get("etape");
  const parent = etape ? `/tickets?etape=${encodeURIComponent(etape)}` : "/tickets";
  const chargement = useApres(300, conversations === undefined);

  const ligne = useMemo((): LigneTicket | null => {
    const c = conversations?.find((x) => x.origine === origine);
    if (!c || !lireTicket(c.ticket)) return null;
    const { colonnes } = tableauTelephone([c], { posteOuvert, maintenant, tousTermines: true });
    return COLONNES_TELEPHONE.flatMap((col) => colonnes[col])[0] ?? null;
  }, [conversations, origine, posteOuvert, maintenant]);

  const droite = ligne ? <BoutonIcone variant="discret" className="size-11" libelle={`Actions pour ${ligne.conversation.titre}`} aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => setMenu(true)} /> : null;

  if (!ligne) {
    const attendu = conversations === undefined || ticketAttendu(demandes, origine);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EnteteTelephone titre="Ticket" parent={parent} pastille={false} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2">
          {attendu ? (
            chargement || conversations !== undefined ? <Squelette lignes={3} /> : null
          ) : (
            <EtatEcran
              className="px-0"
              icone="list"
              titre="Ce ticket n’est plus accessible"
              action={
                <Bouton variant="blanc" taille="md" onClick={() => router.replace(parent)}>
                  Retour aux tickets
                </Bouton>
              }
            />
          )}
        </div>
      </div>
    );
  }

  const { conversation: c, ticket, colonne, roleId } = ligne;
  const agent = nom(roleId);
  const attente = demandeEnCours(demandes, origine);
  const erreur = derniereErreur(demandes, origine, c.titre);
  const bloque = horsLigne || !!attente;
  const avance = progression(c);
  const activite = etatLigne(c, nom, posteOuvert, horsLigne);
  const ouvrirFil = () => router.push(lienFil(origine));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Ticket" parent={parent} pastille={false} droite={droite} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <div className="flex items-center gap-3 pt-2">
          <RondAgent id={roleId} taille={44} />
          <div className="min-w-0">
            <p className="truncate text-ui font-medium text-texte-principal">{agent}</p>
            {carte(roleId)?.roleCourt ? <p className="truncate text-ui-xs text-texte-secondaire">{carte(roleId)?.roleCourt}</p> : null}
          </div>
        </div>
        <h1 className="mt-3 text-[22px] leading-7 font-medium tracking-title text-texte-principal [overflow-wrap:anywhere]">
          <Priorite valeur={ticket.priorite} />
          {c.titre}
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-ui text-texte-secondaire">
          {colonne === "bloque" ? (
            <span className="inline-flex h-5 items-center rounded-sm bg-fond-surface-grise px-1.5 text-ui-xs font-medium text-texte-erreur">{NOMS_COLONNES[colonne]}</span>
          ) : (
            <Etiquette ton={colonne === "termine" ? "neutre" : "bleue"}>{NOMS_COLONNES[colonne]}</Etiquette>
          )}
          depuis {libelleMoment(ticket.fermeLe ?? c.misAJour, maintenant)}
        </p>

        {attente ? (
          <p role="status" className="mt-4 flex items-center gap-2 rounded-xl bg-fond-surface-grise p-3 text-ui text-texte-secondaire">
            <Icon name="clock-backward" size={18} className="shrink-0" />
            {texteAttente(attente, sur, posteOuvert)}
          </p>
        ) : null}
        {erreur ? <MessageErreur className="mt-4">{erreur}</MessageErreur> : null}

        {colonne === "bloque" && ticket.raison ? (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-bordure-erreur bg-fond-surface p-3 text-ui text-texte-erreur">
            <Icon name="help-circle-contained" size={18} className="mt-0.5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{ticket.raison}</span>
          </p>
        ) : null}

        {colonne === "en-cours" ? (
          <Carte className="mt-4">
            <p className="flex items-center gap-2 text-ui text-texte-principal">
              {posteOuvert && activite?.enCours ? <span aria-hidden="true" className="klyra-respire size-1.5 shrink-0 rounded-full bg-bleu-k1-500" /> : null}
              {posteOuvert ? (activite?.texte ?? "Au travail…") : `Dernier état reçu · vu à ${libelleMoment(c.misAJour, maintenant)}`}
            </p>
            {avance ? <BarreProgression faites={avance.faites} total={avance.total} className="mt-3" /> : null}
          </Carte>
        ) : (
          <div className="mt-4">
            <DerniereReponse c={c} agent={agent} />
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {colonne === "a-valider" ? (
            <>
              <BoutonPrincipal disabled={bloque} className="w-full justify-between" onClick={() => void agir(ligne, "fermer")}>
                Valider et fermer
              </BoutonPrincipal>
              {horsLigne ? <p className="text-ui-xs text-texte-secondaire">{SANS_RESEAU}</p> : null}
              <Bouton variant="blanc" taille="md" className="w-full" iconeGauche={<Icon name="message-square" size={20} />} onClick={ouvrirFil}>
                Répondre dans le fil
              </Bouton>
            </>
          ) : colonne === "bloque" ? (
            <>
              <BoutonPrincipal className="w-full justify-between" onClick={ouvrirFil}>
                Répondre dans le fil
              </BoutonPrincipal>
              <Bouton variant="blanc" taille="md" className="w-full" disabled={bloque} iconeGauche={<Icon name="arrow-rotate-left-01" size={20} />} onClick={() => void agir(ligne, "etape", { etape: "a-faire" })}>
                Remettre à faire
              </Bouton>
            </>
          ) : colonne === "en-cours" ? (
            <>
              <BoutonPrincipal className="w-full justify-between" onClick={ouvrirFil}>
                Ouvrir le fil
              </BoutonPrincipal>
              <Bouton variant="blanc" taille="md" className="w-full" disabled={!posteOuvert || horsLigne || arretEnCours || arretDemande} iconeGauche={<Icon name="square" size={20} />} onClick={() => void arreter()}>
                {arretDemande ? "Arrêt demandé" : `Arrêter ${agent}`}
              </Bouton>
              {!posteOuvert ? <p className="text-ui-xs text-texte-secondaire">Possible quand {sur} est ouvert</p> : null}
            </>
          ) : colonne === "termine" ? (
            <>
              <BoutonPrincipal className="w-full justify-between" onClick={ouvrirFil}>
                Ouvrir le fil
              </BoutonPrincipal>
              <Bouton variant="blanc" taille="md" className="w-full" disabled={bloque} iconeGauche={<Icon name="arrow-rotate-left-01" size={20} />} onClick={() => void agir(ligne, "rouvrir")}>
                Rouvrir
              </Bouton>
            </>
          ) : (
            <BoutonPrincipal className="w-full justify-between" onClick={ouvrirFil}>
              Ouvrir le fil
            </BoutonPrincipal>
          )}
        </div>

        <TachesTicket c={c} agent={agent} />

        <GroupeListe className="mt-6">
          {colonne !== "termine" ? <LigneListe retrait="tuile" debut={<TuileIcone icone="star-01" />} nom="Priorité" uneLigne meta={PRIORITES[ticket.priorite]} fin="chevron" inactive={bloque} raison={bloque ? (horsLigne ? SANS_RESEAU : undefined) : undefined} onClick={bloque ? undefined : () => setPrioriteOuverte(true)} /> : null}
          {ticket.echeance ? <LigneListe retrait="tuile" debut={<TuileIcone icone="calendar-01" />} nom="Échéance" uneLigne meta={libelleEcheance(ticket.echeance, null)} /> : null}
          {ticket.projetNom ? <LigneListe retrait="tuile" debut={<TuileIcone icone="projets-dossier" />} nom="Projet" uneLigne meta={ticket.projetNom} /> : null}
          {ticket.lancePar ? <LigneListe retrait="tuile" debut={<TuileIcone icone="users-profiles-01" />} nom="Lancé par" uneLigne meta={nom(ticket.lancePar)} /> : null}
          {ticket.rappel ? <LigneListe retrait="tuile" debut={<TuileIcone icone="list" />} nom="Vient d’un rappel" uneLigne href="/planning?onglet=rappels" fin="chevron" /> : null}
        </GroupeListe>
      </div>
      {menu ? <MenuTicket ligne={ligne} lecture={lecture} surDetail onFermer={() => setMenu(false)} /> : null}
      {prioriteOuverte ? feuillePriorite(ligne, lecture, () => setPrioriteOuverte(false)) : null}
    </div>
  );
}
