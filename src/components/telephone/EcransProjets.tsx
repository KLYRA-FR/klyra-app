"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { Onglets } from "@/components/ui/Onglets";
import { cn } from "@/lib/cn";
import { formatListDate } from "@/lib/format";
import { useLieuActif } from "@/lib/lieux";
import { useGestePoste, useLecturePoste } from "@/lib/poste/client";
import { texteErreurPoste } from "@/lib/poste-texte";
import { compteChats, libelleModifie, libelleStatut, tonStatut, urlProjet, vueProjet, type OngletProjet, type ProjetModifiable } from "@/lib/telephone/dossiers";
import { useConversationsEspace, useProjetsEspace } from "@/lib/telephone/espace";
import type { FicheProjet } from "@/lib/telephone/fiche-projet";
import { RondAgent } from "./AgentsChat";
import { useAnnonce } from "./Annonce";
import { useHorsLigne } from "./BandeauReseau";
import { ONGLETS_TELEPHONE } from "./CommunAgentsTelephone";
import { DossierTelephone, ListeDossier, useNiveau } from "./DossierTelephone";
import { EnteteTelephone, PageOnglet } from "./EnteteTelephone";
import { MenuFeuille, type ActionMenu } from "./Feuille";
import { FicheProjetTelephone, type CarteProjetLue } from "./FicheProjetTelephone";
import { AucunPoste, EtatEcran, Squelette, useGestePossible, useMaintenant } from "./etats";
import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { PageModifierProjet } from "./ModifierProjetTelephone";
import { usePostes, useSupport } from "./poste";
import { VisionneuseTelephone } from "./VisionneuseTelephone";

/**
 * Projets, un projet, un dossier, un fichier (lot 6). Routes : /projets, puis /projet?id=… avec
 * `onglet=fichiers|projet`, `dossier=…` ou `fichier=…`. La liste et les chats viennent du compte et se
 * lisent ordinateur fermé ; le dossier, les fichiers et l'enrichissement de la fiche, du poste ouvert.
 */

const RAISON_DOSSIER = "Le dossier d’un projet se choisit sur l’ordinateur.";
const SEGMENTS = cn(ONGLETS_TELEPHONE, "[&>[role=tab][aria-selected=true]]:font-semibold [&_.text-texte-tertiaire]:font-normal [&_.text-texte-tertiaire]:text-texte-secondaire");
const ECLAIRAGE_MS = 1800;

function useApresDelai(ms: number, actif: boolean): boolean {
  const [passe, setPasse] = useState(false);
  useEffect(() => {
    if (!actif) return;
    const minuteur = setTimeout(() => setPasse(true), ms);
    return () => clearTimeout(minuteur);
  }, [ms, actif]);
  return actif && passe;
}

function chatsDe(conversations: { projetId: string | null; archiveLe?: string | null }[] | undefined, projetId: string): number | null {
  if (!conversations) return null;
  return conversations.filter((c) => c.projetId === projetId && !c.archiveLe).length;
}

/**
 * Le menu d'un projet (E6-02, E6-11) : Nouveau chat toujours ; Épingler et Modifier passent par le poste
 * et attendent sa réponse ; `zone` : ce qui concerne l'onglet affiché (Relire) ; dossier et retrait
 * restent sur l'ordinateur (P-8).
 */
function MenuProjet({ carte, chats, zone = [], onModifier, onFermer }: { carte: CarteProjetLue; chats: number | null; zone?: ActionMenu[]; onModifier: () => void; onFermer: () => void }) {
  const router = useRouter();
  const sur = useSupport();
  const annoncer = useAnnonce();
  const { faire } = useGestePoste();
  const { possible, raison } = useGestePossible();
  const { ouvert } = usePostes();
  const lieu = useLieuActif();
  const statut = libelleStatut(carte.statut);
  const sous = [statut, !ouvert && !lieu ? `${sur} est fermé` : chats === null ? null : compteChats(chats)].filter(Boolean).join(" · ");
  const surPoste = <Etiquette>{lieu ? "App de bureau" : `Sur ${sur}`}</Etiquette>;

  const epingler = async () => {
    const r = await faire<ProjetModifiable>("projets.epingler", { projetId: carte.origine, epingle: !carte.epingle });
    if (r.ok) annoncer({ texte: r.data.epingle ? "Projet épinglé" : "Projet désépinglé", icone: "check-01" });
    else annoncer({ texte: texteErreurPoste(r, sur), erreur: true });
  };

  const actions: ActionMenu[] = [
    { libelle: "Nouveau chat dans ce projet", icone: "message-plus-01", onChoisir: () => router.push(`/chat?${new URLSearchParams({ nouveau: carte.origine })}`) },
    { libelle: carte.epingle ? "Désépingler" : "Épingler", icone: carte.epingle ? "pin-off-01" : "pin-01", onChoisir: () => void epingler(), desactivee: !possible, note: raison },
    { libelle: "Modifier le projet", icone: "pencil-01", onChoisir: onModifier, desactivee: !possible, note: raison },
    ...zone,
    { libelle: "Changer de dossier", icone: "folder", onChoisir: () => undefined, desactivee: true, note: RAISON_DOSSIER, fin: surPoste, separateurAvant: true },
    { libelle: "Retirer de l’app", icone: "trash-01", onChoisir: () => undefined, desactivee: true, note: RAISON_DOSSIER, fin: surPoste },
  ];
  return <MenuFeuille titre={carte.nom} objet={{ visuel: <TuileIcone icone="folder" grande />, sous }} actions={actions} onFermer={onFermer} />;
}

/** E6-01 à E6-05. La liste vient du compte : épinglés d'abord, puis les autres. */
export function ProjetsTelephone() {
  const router = useRouter();
  const projets = useProjetsEspace();
  const conversations = useConversationsEspace();
  const sur = useSupport();
  const lieu = useLieuActif();
  const { postes } = usePostes();
  const annoncer = useAnnonce();
  const maintenant = useMaintenant();
  const [menu, setMenu] = useState<CarteProjetLue | null>(null);
  const [modifier, setModifier] = useState<string | null>(null);
  const squelette = useApresDelai(300, projets === undefined);
  const liste = [...(projets ?? [])].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const epingles = liste.filter((p) => p.epingle);
  const autres = liste.filter((p) => !p.epingle);
  const ligne = (projet: (typeof liste)[number]) => (
    <LigneProjet key={projet.origine} projet={projet} chats={chatsDe(conversations, projet.origine)} maintenant={maintenant} onMenu={() => setMenu(projet)} />
  );

  return (
    <PageOnglet titre="Projets" sous={liste.length ? `${liste.length} projet${liste.length > 1 ? "s" : ""} sur ${lieu ? "ce serveur" : sur}` : "Les dossiers où travaillent tes agents"}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
        {projets === undefined ? (
          squelette ? (
            <div aria-busy="true">
              <Squelette lignes={3} />
            </div>
          ) : null
        ) : liste.length === 0 ? (
          postes?.length === 0 && !lieu ? (
            <AucunPoste forme="encadre" className="px-0" phrase={(s) => `tes projets et leurs fichiers vivent sur ${s}.`} />
          ) : (
            <EtatEcran
              forme="encadre"
              className="px-0"
              icone="projets-dossier"
              titre="Aucun projet pour l’instant"
              texte={
                lieu
                  ? "Un projet de ce serveur se crée depuis l’app de bureau : Projets › Nouveau projet, choisis son dossier. Il apparaît ici aussitôt."
                  : `Un projet se crée sur ${sur} : dans KLYRA, Projets › Nouveau projet, choisis son dossier. Il apparaît ici aussitôt.`
              }
            />
          )
        ) : (
          <>
            {epingles.length ? (
              <SectionListe titre="Épinglés" compte={epingles.length}>
                <GroupeListe>{epingles.map(ligne)}</GroupeListe>
              </SectionListe>
            ) : null}
            {autres.length ? (
              <SectionListe titre="Projets" compte={autres.length}>
                <GroupeListe>{autres.map(ligne)}</GroupeListe>
              </SectionListe>
            ) : null}
            <GroupeListe>
              <LigneListe debut={<TuileIcone icone="plus-01" />} retrait="tuile" nom="Nouveau projet" etiquette={<Etiquette>{lieu ? "App de bureau" : `Sur ${sur}`}</Etiquette>} ligne2={RAISON_DOSSIER} />
            </GroupeListe>
          </>
        )}
      </div>
      {menu ? <MenuProjet carte={menu} chats={chatsDe(conversations, menu.origine)} onModifier={() => setModifier(menu.origine)} onFermer={() => setMenu(null)} /> : null}
      {modifier ? (
        <PageModifierProjet
          projetId={modifier}
          onFermer={() => setModifier(null)}
          onEnregistre={() => {
            annoncer({ texte: "Projet enregistré", icone: "check-01" });
            router.push(`${urlProjet(modifier, "projet")}&enregistre=1`);
          }}
        />
      ) : null}
    </PageOnglet>
  );
}

function LigneProjet({
  projet,
  chats,
  maintenant,
  onMenu,
}: {
  projet: CarteProjetLue & { misAJour: string | null };
  chats: number | null;
  maintenant: number;
  onMenu: () => void;
}) {
  const statut = libelleStatut(projet.statut);
  const details = [chats === null ? null : compteChats(chats), libelleModifie(projet.misAJour, maintenant)].filter(Boolean).join(" · ");
  /* D-7 : un projet a sa page ; son menu s'ouvre par l'appui long, le ⋯ de sa page, ou le bouton des lecteurs d'écran. */
  return (
    <LigneListe
      href={urlProjet(projet.origine)}
      debut={<TuileIcone icone="folder" />}
      retrait="tuile"
      nom={projet.nom}
      etiquette={statut ? <Etiquette ton={tonStatut(projet.statut)}>{statut}</Etiquette> : undefined}
      ligne2={
        projet.accroche || details ? (
          <>
            {projet.accroche ? <span className="block truncate">{projet.accroche}</span> : null}
            {details ? <span className="block truncate">{details}</span> : null}
          </>
        ) : undefined
      }
      fin="chevron"
      onMenu={onMenu}
    />
  );
}

/** Selon l'adresse : la visionneuse, un dossier, ou le projet et ses trois onglets. */
export function ProjetTelephone() {
  const params = useSearchParams();
  const projetId = params.get("id") ?? "";
  const projets = useProjetsEspace();
  const carte = projets?.find((p) => p.origine === projetId) ?? null;
  const nom = carte?.nom ?? "Projet";
  const vue = vueProjet(params);

  if (!projetId) return <ProjetsTelephone />;
  if (vue.vue === "fichier") {
    return <VisionneuseTelephone key={`${vue.chemin}#${vue.retour.length}`} projetId={projetId} nomProjet={nom} chemin={vue.chemin} ancre={vue.ancre} retour={vue.retour} />;
  }
  if (vue.vue === "dossier") return <DossierTelephone key={vue.chemin} projetId={projetId} nomProjet={nom} chemin={vue.chemin} />;
  if (projets !== undefined && !carte) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EnteteTelephone titre="Projet" parent="/projets" />
        <EtatEcran icone="help-circle-contained" titre="Ce projet n’est pas dans cet espace" texte="Il a pu être retiré, ou appartenir à un autre serveur (Plus › Serveurs)." />
      </div>
    );
  }
  return <OngletsProjet projetId={projetId} carte={carte ?? { origine: projetId, nom, accroche: "", statut: "", epingle: false }} onglet={vue.onglet} />;
}

/** Chats (compte), Fichiers (le premier niveau du dossier), Projet (la fiche). L'onglet Projets reste allumé. */
function OngletsProjet({ projetId, carte, onglet }: { projetId: string; carte: CarteProjetLue; onglet: OngletProjet }) {
  const router = useRouter();
  const params = useSearchParams();
  const annoncer = useAnnonce();
  const enLigne = !useHorsLigne();
  /* Relire n'écrit rien : c'est la lecture de l'écran, possible aussi sur un serveur. */
  const { possible, raison } = useGestePossible({ lecture: true });
  const conversations = useConversationsEspace();
  const [menu, setMenu] = useState(false);
  const [modifier, setModifier] = useState(false);
  const [eclaire, setEclaire] = useState(false);
  const niveau = useNiveau(projetId, "", onglet === "fichiers");
  const fiche = useLecturePoste<FicheProjet>("projets.fiche", onglet === "projet" ? { projetId } : null, { horsLigne: !enLigne });
  const { relancer: relireFiche } = fiche;
  const chats = chatsDe(conversations, projetId);

  /* E6-36 : après un enregistrement confirmé, la fiche est relue et s'éclaire 1 800 ms ; l'adresse se nettoie. */
  const enregistre = params.get("enregistre") === "1";
  if (enregistre && !eclaire) setEclaire(true);
  const adresse = urlProjet(projetId, onglet);
  useEffect(() => {
    if (!eclaire) return;
    router.replace(adresse);
    relireFiche();
    const minuteur = setTimeout(() => setEclaire(false), ECLAIRAGE_MS);
    return () => clearTimeout(minuteur);
  }, [eclaire, adresse, relireFiche, router]);

  const relire: ActionMenu[] =
    onglet === "fichiers"
      ? [niveau.actions[0]]
      : onglet === "projet"
        ? [{ libelle: "Relire", icone: "refresh-01", onChoisir: relireFiche, desactivee: !possible, note: raison }]
        : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone
        titre={carte.nom}
        parent="/projets"
        droite={<BoutonIcone variant="discret" className="size-11" libelle={`Actions pour ${carte.nom}`} aria-haspopup="dialog" onClick={() => setMenu(true)} icone={<Icon name="dot-horizontal" size={24} />} />}
      />
      <div className="shrink-0 px-4 pt-2 pb-1">
        <Onglets
          libelle="Contenu du projet"
          onglets={[
            { id: "chats", label: "Chats", nombre: chats ?? undefined, zero: true },
            { id: "fichiers", label: "Fichiers" },
            { id: "projet", label: "Projet" },
          ]}
          valeur={onglet}
          onChange={(id) => router.replace(urlProjet(projetId, id))}
          className={SEGMENTS}
        />
      </div>
      {onglet === "chats" ? (
        <ChatsDuProjet projetId={projetId} nom={carte.nom} />
      ) : onglet === "fichiers" ? (
        <ListeDossier projetId={projetId} niveau={niveau} />
      ) : (
        <FicheProjetTelephone carte={carte} lecture={fiche} eclaire={eclaire} relireActif={possible} />
      )}
      {menu ? <MenuProjet carte={carte} chats={chats} zone={relire} onModifier={() => setModifier(true)} onFermer={() => setMenu(false)} /> : null}
      {modifier ? (
        <PageModifierProjet
          projetId={projetId}
          onFermer={() => setModifier(false)}
          onEnregistre={() => {
            setModifier(false);
            annoncer({ texte: "Projet enregistré", icone: "check-01" });
            router.replace(`${urlProjet(projetId, "projet")}&enregistre=1`);
          }}
        />
      ) : null}
    </div>
  );
}

/** E6-06, E6-07 : l'entrée « Nouveau chat dans {nom}… » puis les chats du projet (compte). */
function ChatsDuProjet({ projetId, nom }: { projetId: string; nom: string }) {
  const conversations = useConversationsEspace();
  const squelette = useApresDelai(300, conversations === undefined);
  const liste = (conversations ?? [])
    .filter((c) => c.projetId === projetId && !c.archiveLe)
    .sort((a, b) => Number(!!b.epingleLe) - Number(!!a.epingleLe) || b.misAJour.localeCompare(a.misAJour));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-6">
      <Link
        /* C-5 : le fil lit l'id du projet dans `nouveau` (`FilTelephone`). */
        href={`/chat?${new URLSearchParams({ nouveau: projetId })}`}
        className="flex min-h-14 shrink-0 items-center gap-3 rounded-xl border border-bordure-subtile bg-fond-surface py-1.5 pr-2 pl-4 text-icone-secondaire no-underline shadow-ombre-ambiante transition-transform duration-[120ms] ease-sortie active:scale-[0.98]"
      >
        <Icon name="message-plus-01" size={20} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-body-s text-texte-secondaire">Nouveau chat dans {nom}…</span>
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xs bg-fond-survol">
          <Icon name="arrow-up" size={18} />
        </span>
      </Link>
      {conversations === undefined ? (
        squelette ? (
          <div aria-busy="true">
            <Squelette lignes={3} />
          </div>
        ) : null
      ) : liste.length === 0 ? (
        <EtatEcran forme="encadre" className="px-0 pb-0" icone="message-square" titre="Aucun chat dans ce projet" texte="Un chat ouvert ici donne à l’agent le dossier du projet." />
      ) : (
        <SectionListe titre="Chats du projet" compte={liste.length}>
          <GroupeListe>
            {liste.map((conversation) => (
              <LigneListe
                key={conversation.origine}
                href={`/chat?id=${encodeURIComponent(conversation.origine)}`}
                debut={<RondAgent id={conversation.roleIds[0] ?? "principal"} taille={40} />}
                retrait="avatar"
                nom={conversation.titre}
                meta={
                  <span className="inline-flex items-center gap-1">
                    {conversation.epingleLe ? <Icon name="pin-01" size={14} className="text-icone-secondaire" /> : null}
                    {formatListDate(conversation.extraitLe ?? conversation.misAJour)}
                  </span>
                }
                ligne2={conversation.extrait || undefined}
              />
            ))}
          </GroupeListe>
        </SectionListe>
      )}
    </div>
  );
}
