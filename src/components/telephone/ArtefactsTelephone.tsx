"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "klyra-ui";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { useAbonnement } from "@/lib/bibliotheque";
import { ArtefactsEquipeProvider, useArtefactsEquipe, type ArtefactEquipe, type EtatArtefactsEquipe } from "@/lib/artefacts-equipe";
import { cn } from "@/lib/cn";
import { codeErreur, messageErreur, useCompte } from "@/lib/compte";
import { useLieuActif } from "@/lib/lieux";
import { useLecturePoste } from "@/lib/poste/client";
import { majuscule } from "@/lib/poste-texte";
import { filtrerArtefacts, imageApercu, LIEN_ARTEFACT, listeDeLEspace, type ArtefactLu, type ListeArtefacts, type RenduLu } from "@/lib/telephone/gestes-artefacts";
import { useGesteTelephone } from "@/lib/telephone/geste";
import type { TypeRendu } from "@/types/domain";
import { api } from "../../../convex/_generated/api";
import { DESCRIPTION_MAX, lienArtefact } from "../../../convex/model/artefacts";
import { useAnnonce } from "./Annonce";
import { ChampTelephone, CHAMP_TELEPHONE, ErreurGeste, MenuPage } from "./CommunAgentsTelephone";
import { ChampRecherche, Puce, RangeePuces, Segments } from "./Controles";
import { EnteteTelephone } from "./EnteteTelephone";
import { ChoixFeuille, Feuille, MenuFeuille, useFermerFeuille, type ActionMenu, type OptionChoix } from "./Feuille";
import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { PagePleine } from "./PagePleine";
import { useRetour } from "./retour";
import { BandeauEtat, CarteSuite, DemandeEnCours, EtatEcran, NoteGeste, PasDeReponse, ErreurPoste, Squelette, VueLecture, useVueGardeeAffichee, useAccesGeste } from "./etats";
import { useSupport } from "./poste";

/**
 * Artefacts sur le téléphone (lot 7, E7-39 à E7-60). Mes artefacts vit sur l'ordinateur : ses rendus
 * d'agents et ses liens claude.ai, lus par `artefacts.liste` ; ordinateur fermé, sa dernière vue lue
 * sur ce téléphone (les liens restent ouvrables et partageables). Équipe vit dans le compte
 * (`convex/artefactsEquipe.ts`, `documentsKlyra`) : elle se lit sans ordinateur, rien n'en est gardé.
 */

const dateCourte = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const quand = (date: string | number) => dateCourte.format(new Date(date));

const TYPES: Record<TypeRendu, { libelle: string; icone: IconName }> = {
  page: { libelle: "Page", icone: "globe-01" },
  image: { libelle: "Image", icone: "image-01" },
  video: { libelle: "Vidéo", icone: "play-01" },
  pdf: { libelle: "PDF", icone: "file-01" },
  document: { libelle: "Document", icone: "file-01" },
};

const ECLAIRAGE_MS = 1800;
const urlArtefacts = (equipe = false) => (equipe ? "/artefacts?onglet=equipe" : "/artefacts");
/* Le rendu ouvert est dans l'adresse : le retour du système ferme l'aperçu (E7-44). */
const urlApercu = (id: string) => `/artefacts?rendu=${encodeURIComponent(id)}`;

/** Ouvre une page publique dans le navigateur du téléphone. */
function ouvrirLien(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function explorateur(sur: string): string {
  return sur === "ton Mac" ? "le Finder" : sur === "ton PC" ? "l’Explorateur" : "le dossier";
}

const TEXTES_EQUIPE: Record<Exclude<EtatArtefactsEquipe, "pret" | "chargement">, string> = {
  indisponible: "Le compte d’équipe n’est pas disponible sur ce téléphone.",
  deconnecte: "Connecte-toi à ton compte d’équipe pour voir les artefacts partagés.",
  retire: "Ce compte ne fait plus partie de l’équipe.",
  "hors-ligne": "Les artefacts de l’équipe reviendront avec le réseau.",
  erreur: "Le serveur de l’équipe ne répond pas.",
};

/** Les pages HTML que l'équipe a partagées depuis Ce PC : lues dans le compte, sans adresse ni contenu. */
interface PageEquipe {
  _id: string;
  titre: string;
  description: string;
  majLe: number;
  auteur: { nom: string };
  deMoi: boolean;
}

function usePagesEquipe(tour: number, lieu: string | null): PageEquipe[] | null {
  const { etat } = useCompte();
  const liste = useAbonnement(api.documentsKlyra.lister, etat === "connecte" ? { lieu } : null, tour);
  return liste.valeur?.documents ?? null;
}

export function ArtefactsTelephone() {
  return (
    <ArtefactsEquipeProvider>
      <Ecran />
    </ArtefactsEquipeProvider>
  );
}

function Ecran() {
  const params = useSearchParams();
  const onglet = params.get("onglet") === "equipe" ? "equipe" : "miens";
  const renduOuvert = params.get("rendu");
  /* L'espace que ce téléphone a choisi : ses rendus, ses pages partagées ; les liens claude.ai seulement sur Ce PC. */
  const lieu = useLieuActif();
  const lecture = useLecturePoste<ListeArtefacts>("artefacts.liste", { lieu });
  const equipeCompte = useArtefactsEquipe();
  const equipe = lieu ? { ...equipeCompte, artefacts: [] } : equipeCompte;
  const [tourPages, setTourPages] = useState(0);
  const pages = usePagesEquipe(tourPages, lieu);
  const lue = lecture.etat === "ok" ? lecture.data : lecture.etat === "ferme" ? (lecture.gardee?.data ?? null) : null;
  const liste = lue ? listeDeLEspace(lue, lieu) : null;
  const pretEquipe = equipe.etat === "pret" && pages !== null;
  /* Un compte seulement quand la source a été lue : jamais de faux zéro. */
  const nombreMiens = liste ? liste.rendus.length + liste.artefacts.length : undefined;
  const nombreEquipe = pretEquipe ? equipe.artefacts.length + pages.length : undefined;
  const relireEquipe = () => {
    equipe.reessayer();
    setTourPages((n) => n + 1);
  };

  const rendu = renduOuvert ? (liste?.rendus.find((r) => r.id === renduOuvert) ?? null) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onglet === "equipe" ? (
        <>
          <EnteteTelephone titre="Artefacts" parent="/plus" droite={<MenuPage titre="Artefacts" actions={[{ libelle: "Relire la liste", icone: "list", onChoisir: relireEquipe }]} />} />
          <div className="min-h-0 flex-1 overflow-y-auto pb-6">
            <div className="px-4 pt-2 pb-4">
              <SegmentsArtefacts onglet="equipe" miens={nombreMiens} equipe={nombreEquipe} />
            </div>
            <OngletEquipe pages={pages} relire={relireEquipe} surServeur={!!lieu} />
          </div>
        </>
      ) : (
        <OngletMiens lecture={lecture} lieu={lieu} liste={liste} nombreMiens={nombreMiens} nombreEquipe={nombreEquipe} />
      )}
      {renduOuvert ? <PageApercu id={renduOuvert} lieu={lieu} rendu={rendu} liste={liste} relire={lecture.relancer} /> : null}
    </div>
  );
}

function SegmentsArtefacts({ onglet, miens, equipe }: { onglet: "miens" | "equipe"; miens?: number; equipe?: number }) {
  const router = useRouter();
  return (
    <Segments<"miens" | "equipe">
      libelle="Artefacts"
      valeur={onglet}
      onChange={(o) => router.replace(urlArtefacts(o === "equipe"))}
      segments={[
        { id: "miens", label: "Mes artefacts", icone: <Icon name="user-profile-01" size={16} />, nombre: miens },
        { id: "equipe", label: "Équipe", icone: <Icon name="users-profiles-01" size={16} />, nombre: equipe },
      ]}
    />
  );
}

/* ─── E7-39 à E7-49, E7-55 à E7-60 : Mes artefacts ─────────────── */

function OngletMiens({
  lecture,
  lieu,
  liste,
  nombreMiens,
  nombreEquipe,
}: {
  lecture: ReturnType<typeof useLecturePoste<ListeArtefacts>>;
  lieu: string | null;
  liste: (ListeArtefacts & { ancien: boolean }) | null;
  nombreMiens?: number;
  nombreEquipe?: number;
}) {
  const { possible } = useAccesGeste();
  const { agir, occupe, bandeau, erreur } = useGesteTelephone();
  const [recherche, setRecherche] = useState("");
  const [projet, setProjet] = useState("");
  const [lien, setLien] = useState(false);
  const [sync, setSync] = useState(false);

  const synchroniser = async () => {
    setSync(true);
    const r = await agir<{ total: number; nouveaux: number }>("artefacts.synchroniser", {}, (x) => `${x.total} artefact${x.total > 1 ? "s" : ""} sur ton compte claude.ai · ${x.nouveaux} nouveau${x.nouveaux > 1 ? "x" : ""}.`, { delai: 60_000 });
    setSync(false);
    if (r) lecture.relancer();
  };
  const note = possible ? undefined : <NoteGeste className="text-ui-xs text-texte-secondaire" />;
  const avecClaude = liste?.claude ?? true;
  const actions: ActionMenu[] = [
    ...(avecClaude ? [{ libelle: "Relire claude.ai", icone: "refresh-01" as IconName, desactivee: !possible || occupe, note: note ?? "Ajoute à la liste ce que tu as publié sur claude.ai.", onChoisir: () => void synchroniser() }] : []),
    {
      libelle: "Refaire les aperçus",
      icone: "image-01",
      desactivee: !possible || occupe,
      note: note ?? "Se refont sur l’ordinateur, en fond.",
      onChoisir: () => void agir<{ lances: number }>("artefacts.apercus", {}, (x) => `Aperçus demandés à l’ordinateur (${x.lances}).`),
    },
    ...(avecClaude ? [{ libelle: "Ajouter un lien", icone: "plus-01" as IconName, desactivee: !possible || occupe, note, onChoisir: () => setLien(true) }] : []),
    { libelle: "Relire la liste", icone: "list", onChoisir: lecture.relancer },
  ];

  return (
    <>
      <EnteteTelephone titre="Artefacts" parent="/plus" droite={<MenuPage titre="Artefacts" actions={actions} />} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="px-4 pt-2 pb-4">
          <SegmentsArtefacts onglet="miens" miens={nombreMiens} equipe={nombreEquipe} />
        </div>
        {sync ? (
          <div className="px-4 pb-3">
            <BandeauEtat icone={<Icon name="loader-01" size={20} className="motion-safe:animate-spin" />}>Lecture de claude.ai…</BandeauEtat>
          </div>
        ) : null}
        <ErreurGeste message={erreur?.message} className="px-5 pb-3" />
        {lecture.etat === "attente" ? (
          <div aria-busy="true">
            {lecture.lent ? (
              <div className="px-4">
                <ChampRecherche valeur={recherche} onChange={setRecherche} placeholder="Chercher un artefact…" libelle="Chercher un artefact" />
              </div>
            ) : null}
            <DemandeEnCours lent={lecture.lent} lignes={5} />
          </div>
        ) : (
          <VueLecture
            lecture={lecture}
            lignes={5}
            verrou={false}
            formeAucun="encadre"
            phraseAucun="Les rendus de tes agents et ta liste d’artefacts sont sur ton ordinateur."
            apresAucun={<p className="-mt-2 px-5 pb-6 text-ui-xs text-texte-secondaire">Les liens partagés par l’équipe sont dans l’onglet Équipe, même sans ordinateur.</p>}
            carteFerme={<CarteEquipeFerme />}
            gestes="Ouvrir un rendu, modifier, retirer"
            ferme={(sur) => `tes artefacts sont listés sur ${sur}. Ils s’affichent ici quand KLYRA y est ouverte.`}
          >
            {(lue) => <ListeMiens liste={listeDeLEspace(lue, lieu)} lieu={lieu} recherche={recherche} setRecherche={setRecherche} projet={projet} setProjet={setProjet} relire={lecture.relancer} onAjouter={() => setLien(true)} />}
          </VueLecture>
        )}
      </div>
      {lien ? <FeuilleLien projets={liste?.projets ?? []} onFermer={() => setLien(false)} onFait={lecture.relancer} /> : null}
      {bandeau}
    </>
  );
}

function CarteEquipeFerme() {
  const sur = useSupport();
  return <CarteSuite icone="users-profiles-01" texte={`Les liens partagés par l’équipe se lisent sans ${sur}.`} lien="Voir l’onglet Équipe" href={urlArtefacts(true)} />;
}

function ListeMiens({
  liste,
  lieu,
  recherche,
  setRecherche,
  projet,
  setProjet,
  relire,
  onAjouter,
}: {
  liste: ListeArtefacts & { ancien: boolean };
  lieu: string | null;
  recherche: string;
  setRecherche: (v: string) => void;
  projet: string;
  setProjet: (v: string) => void;
  relire: () => void;
  onAjouter: () => void;
}) {
  const router = useRouter();
  const sur = useSupport();
  const { possible } = useAccesGeste();
  const gardee = !!useVueGardeeAffichee();
  const annoncer = useAnnonce();
  const equipe = useArtefactsEquipe();
  const [lienMenu, setLienMenu] = useState<ArtefactLu | null>(null);
  const [renduMenu, setRenduMenu] = useState<RenduLu | null>(null);
  const [eclaire, setEclaire] = useState<string | null>(null);
  useEffect(() => {
    if (!eclaire) return;
    const minuteur = setTimeout(() => setEclaire(null), ECLAIRAGE_MS);
    return () => clearTimeout(minuteur);
  }, [eclaire]);

  const rendus = useMemo(() => filtrerArtefacts(liste.rendus, recherche, projet), [liste.rendus, recherche, projet]);
  const liens = useMemo(() => filtrerArtefacts(liste.artefacts, recherche, projet), [liste.artefacts, recherche, projet]);
  const total = liste.rendus.length + liste.artefacts.length;
  const filtre = !!recherche.trim() || !!projet;
  const partageDe = (a: ArtefactLu) => {
    const url = lienArtefact(a.url);
    return equipe.etat === "pret" && url ? equipe.artefacts.find((x) => x.url === url) : undefined;
  };

  /* Un ordinateur d'avant ce contrat ne dit rien de ses rendus : pas de « Rien pour l'instant ». */
  if (!total && liste.ancien) {
    return <EtatEcran forme="encadre" icone="computer" titre="Mets KLYRA à jour" texte={`La version de KLYRA sur ${sur} ne sait pas encore montrer ses rendus à ce téléphone.`} />;
  }
  if (!total) {
    return (
      <div className="flex flex-col">
        <EtatEcran
          forme="encadre"
          icone="artefacts-forme"
          titre="Rien pour l’instant"
          texte={`Quand un agent livre une page, une maquette, une capture ou une vidéo, elle arrive ici.${liste.claude ? " Tu peux aussi y ajouter tes liens claude.ai." : ""}`}
          action={
            liste.claude ? (
              <Bouton variant="blanc" taille="md" disabled={!possible} iconeGauche={<Icon name="plus-01" size={20} />} onClick={onAjouter}>
                Ajouter un lien
              </Bouton>
            ) : null
          }
        />
        {liste.claude && !possible ? <NoteGeste className="-mt-3 px-5 pb-4 text-center text-ui-xs text-texte-secondaire" /> : null}
        {liste.rendusAilleurs ? <NoteAilleurs nombre={liste.rendusAilleurs} surServeur={!!lieu} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4">
      <div className="flex flex-col gap-3">
        <ChampRecherche valeur={recherche} onChange={setRecherche} placeholder="Chercher un artefact…" libelle="Chercher un artefact" />
        {liste.projets.length ? (
          <RangeePuces libelle="Filtrer par projet">
            <Puce choisie={!projet} onClick={() => setProjet("")}>
              Tous les projets
            </Puce>
            {liste.projets.map((p) => (
              <Puce key={p.id} choisie={projet === p.id} onClick={() => setProjet(p.id)}>
                {p.nom}
              </Puce>
            ))}
          </RangeePuces>
        ) : null}
      </div>
      {filtre ? (
        <p aria-live="polite" className="-mt-1.5 px-1 text-ui-xs text-texte-secondaire">
          {rendus.length + liens.length} artefact{rendus.length + liens.length > 1 ? "s" : ""}
        </p>
      ) : null}
      {filtre && !rendus.length && !liens.length ? (
        <EtatEcran
          forme="encadre"
          icone="search-01"
          titre="Aucun résultat"
          className="px-0 pb-0"
          action={
            <Bouton
              variant="blanc"
              taille="md"
              onClick={() => {
                setRecherche("");
                setProjet("");
              }}
            >
              Effacer les filtres
            </Bouton>
          }
        />
      ) : null}
      {rendus.length ? (
        <SectionListe titre="Rendus des agents" compte={rendus.length}>
          {/* Vue gardée : ces images et ces fichiers attendent l'ordinateur (E7-56). */}
          <fieldset disabled={gardee} className={cn("m-0 min-w-0 border-0 p-0", gardee && "opacity-55")}>
            <GroupeListe>
              {rendus.map((r) => (
                <LigneListe
                  key={r.id}
                  debut={<TuileIcone icone={TYPES[r.type].icone} />}
                  retrait="tuile"
                  nom={r.titre}
                  etiquette={<Etiquette>{TYPES[r.type].libelle}</Etiquette>}
                  ligne2={[r.agent, r.projet, quand(r.date)].filter(Boolean).join(" · ")}
                  uneLigne
                  onClick={() => (r.apercu ? router.push(urlApercu(r.id)) : setRenduMenu(r))}
                  onMenu={() => setRenduMenu(r)}
                  menuVisible
                />
              ))}
            </GroupeListe>
          </fieldset>
        </SectionListe>
      ) : null}
      {liens.length ? (
        <SectionListe titre="Artefacts claude.ai" compte={liens.length}>
          <GroupeListe>
            {liens.map((a) => (
              <LigneListe
                key={a.id}
                debut={<TuileIcone icone="link" />}
                retrait="tuile"
                nom={a.titre}
                etiquette={partageDe(a) ? <Etiquette ton="bleue">Partagé</Etiquette> : null}
                ligne2={
                  <>
                    {[a.description, a.projet, quand(a.date)].filter(Boolean).join(" · ")}
                    <span className="sr-only"> (s’ouvre dans le navigateur)</span>
                  </>
                }
                eclairee={eclaire === a.id}
                onClick={() => ouvrirLien(a.url)}
                onMenu={() => setLienMenu(a)}
                menuVisible
              />
            ))}
          </GroupeListe>
        </SectionListe>
      ) : null}
      {liste.rendusAilleurs ? <NoteAilleurs nombre={liste.rendusAilleurs} surServeur={!!lieu} /> : null}
      {lienMenu ? (
        <MenuLien
          key={lienMenu.id}
          artefact={lienMenu}
          projets={liste.projets}
          partage={partageDe(lienMenu)}
          relire={relire}
          onFermer={() => setLienMenu(null)}
          onPartage={() => {
            setEclaire(lienMenu.id);
            annoncer({ texte: `« ${lienMenu.titre} » partagé avec l’équipe.`, icone: "check-01" });
          }}
        />
      ) : null}
      {renduMenu ? <MenuRendu rendu={renduMenu} lieu={lieu} sur={sur} relire={relire} onFermer={() => setRenduMenu(null)} /> : null}
    </div>
  );

}

/** Les rendus d'un autre espace : on dit qu'ils existent, sans les mêler à ceux-ci. */
function NoteAilleurs({ nombre, surServeur }: { nombre: number; surServeur: boolean }) {
  return (
    <p className="px-5 pb-2 text-ui-xs text-texte-secondaire">
      {nombre} autre{nombre > 1 ? "s" : ""} rendu{nombre > 1 ? "s" : ""} dans un autre espace : {surServeur ? "change de serveur" : "choisis son serveur"} dans Plus › Serveurs.
    </p>
  );
}

/* ─── E7-42, E7-45 à E7-49 : un lien claude.ai ─────────────────── */

function MenuLien({ artefact, projets, partage, relire, onFermer, onPartage }: { artefact: ArtefactLu; projets: ListeArtefacts["projets"]; partage?: ArtefactEquipe; relire: () => void; onFermer: () => void; onPartage: () => void }) {
  const { possible } = useAccesGeste();
  const { agir, occupe } = useGesteTelephone();
  const annoncer = useAnnonce();
  const equipe = useArtefactsEquipe();
  /* Le menu joue sa sortie pendant que la feuille suivante monte : il ne ferme tout que s'il n'y en a pas. */
  const [menu, setMenu] = useState(true);
  const [suite, setSuite] = useState<"modifier" | "partager" | null>(null);
  const note = possible ? undefined : <NoteGeste className="text-ui-xs text-texte-secondaire" />;
  const sansCompte = equipe.etat === "hors-ligne" ? "Possible quand ce téléphone est en ligne" : equipe.etat !== "pret" ? (equipe.etat === "chargement" ? "Lecture de l’équipe…" : TEXTES_EQUIPE[equipe.etat]) : undefined;
  return (
    <>
      {menu ? (
        <MenuFeuille
          titre={artefact.titre}
          objet={{ visuel: <TuileIcone grande icone="link" />, sous: ["Artefact claude.ai", artefact.projet].filter(Boolean).join(" · ") }}
          onFermer={() => {
            setMenu(false);
            if (!suite) onFermer();
          }}
          actions={[
            { libelle: "Ouvrir dans le navigateur", icone: "link-external", onChoisir: () => ouvrirLien(artefact.url) },
            ...(partage ? [] : [{ libelle: "Partager avec l’équipe", icone: "users-profiles-plus" as IconName, desactivee: !!sansCompte, note: sansCompte, onChoisir: () => setSuite("partager") }]),
            { libelle: "Modifier le titre et la description", icone: "pencil-01", desactivee: !possible || occupe, note, onChoisir: () => setSuite("modifier") },
            {
              libelle: "Retirer de la liste…",
              icone: "trash-01",
              danger: true,
              separateurAvant: true,
              desactivee: !possible || occupe,
              note,
              confirmation: { titre: "Retirer de la liste ?", texte: "L’artefact reste sur claude.ai.", confirmer: "Retirer" },
              onChoisir: () =>
                void agir("artefacts.retirer", { id: artefact.id }).then((ok) => {
                  if (ok) annoncer({ texte: "Retiré de la liste.", icone: "check-01" });
                  else annoncer({ texte: "Le retrait n’a pas abouti : l’artefact reste dans la liste.", erreur: true });
                  relire();
                }),
            },
          ]}
        />
      ) : null}
      {suite === "modifier" ? <FeuilleModifier artefact={artefact} projets={projets} onFermer={onFermer} onFait={relire} /> : null}
      {suite === "partager" ? <FeuillePartager artefact={artefact} partage={partage} onFermer={onFermer} onPartage={onPartage} /> : null}
    </>
  );
}

/** E7-45, E7-46 : un geste du compte, qui marche ordinateur fermé. La feuille reste ouverte jusqu'au résultat. */
function FeuillePartager({ artefact, partage, onFermer, onPartage }: { artefact: ArtefactLu; partage?: ArtefactEquipe; onFermer: () => void; onPartage: () => void }) {
  const equipe = useArtefactsEquipe();
  const [phase, setPhase] = useState<"confirmer" | "envoi" | "erreur" | "deja">(partage ? "deja" : "confirmer");
  const [erreur, setErreur] = useState<string | null>(null);
  /* Arrivé fenêtre ouverte : quelqu'un l'a partagé entre-temps. Pendant notre envoi, c'est sans doute le nôtre. */
  if (partage && phase !== "envoi" && phase !== "deja") setPhase("deja");
  const indisponible = phase === "envoi" || equipe.etat === "pret" ? null : equipe.etat === "chargement" ? "Lecture de l’équipe…" : TEXTES_EQUIPE[equipe.etat];
  return (
    <Feuille titre={phase === "deja" ? "Déjà partagé avec l’équipe" : `Partager « ${artefact.titre} » avec l’équipe ?`} role="alertdialog" sansEnTete onFermer={onFermer}>
      <ContenuPartager artefact={artefact} partage={partage} phase={phase} setPhase={setPhase} erreur={erreur} setErreur={setErreur} indisponible={indisponible} onPartage={onPartage} />
    </Feuille>
  );
}

function ContenuPartager({
  artefact,
  partage,
  phase,
  setPhase,
  erreur,
  setErreur,
  indisponible,
  onPartage,
}: {
  artefact: ArtefactLu;
  partage?: ArtefactEquipe;
  phase: "confirmer" | "envoi" | "erreur" | "deja";
  setPhase: (p: "confirmer" | "envoi" | "erreur" | "deja") => void;
  erreur: string | null;
  setErreur: (e: string | null) => void;
  indisponible: string | null;
  onPartage: () => void;
}) {
  const equipe = useArtefactsEquipe();
  const fermer = useFermerFeuille();
  const envoyer = async () => {
    if (phase === "envoi") return;
    setPhase("envoi");
    setErreur(null);
    try {
      await equipe.partager({ url: artefact.url, titre: artefact.titre, description: artefact.description.slice(0, DESCRIPTION_MAX) });
    } catch (e) {
      if (e instanceof Error && codeErreur(e.cause) === "deja_partage") setPhase("deja");
      else {
        setErreur(e instanceof Error ? e.message : String(e));
        setPhase("erreur");
      }
      return;
    }
    onPartage();
    fermer();
  };
  if (phase === "deja") {
    return (
      <div className="px-1">
        <p className="mt-2 text-body-s text-texte-secondaire">{partage?.deMoi ? "Tu l’as déjà partagé : il est dans l’onglet Équipe." : partage ? `${partage.auteur.nom} l’a déjà partagé : il est dans l’onglet Équipe.` : "Cet artefact est déjà dans l’onglet Équipe."}</p>
        <div className="mt-6">
          <Bouton variant="sombre" taille="md" className="w-full" data-autofocus onClick={fermer}>
            Fermer
          </Bouton>
        </div>
      </div>
    );
  }
  return (
    <div className="px-1">
      <p className="mt-2 text-body-s text-texte-secondaire">Chacun verra ce lien dans l’onglet Équipe.</p>
      <BandeauEtat icone={<Icon name="link" size={20} />} className="mt-3.5">
        Pour l’ouvrir, il faut aussi que l’artefact soit partagé sur claude.ai.
      </BandeauEtat>
      {phase === "erreur" && erreur ? (
        <BandeauEtat ton="erreur" icone={<Icon name="help-circle-contained" size={20} />} className="mt-3">
          <p className="font-medium">Le partage n’a pas abouti. Rien n’a été partagé.</p>
          <p>{erreur}</p>
        </BandeauEtat>
      ) : null}
      {indisponible ? <p className="mt-3 text-ui text-texte-secondaire">{indisponible}</p> : null}
      <div className="mt-6 flex flex-col gap-2">
        <Bouton variant="sombre" taille="md" className="w-full" disabled={phase === "envoi" || !!indisponible} onClick={() => void envoyer()}>
          {phase === "envoi" ? "Partage…" : phase === "erreur" ? "Réessayer" : "Partager"}
        </Bouton>
        <Bouton variant="blanc" taille="md" className="w-full" data-autofocus disabled={phase === "envoi"} onClick={fermer}>
          Annuler
        </Bouton>
      </div>
    </div>
  );
}

/** La ligne « Projet » d'une feuille : elle ouvre une feuille de choix (D-6). */
function ChampProjet({ projets, valeur, onChange }: { projets: ListeArtefacts["projets"]; valeur: string; onChange: (v: string) => void }) {
  const [choix, setChoix] = useState(false);
  const options: OptionChoix<string>[] = [{ value: "", label: "Aucun" }, ...projets.map((p) => ({ value: p.id, label: p.nom }))];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-ui font-medium text-texte-principal">Projet</span>
      <GroupeListe>
        <LigneListe nom={options.find((o) => o.value === valeur)?.label ?? "Aucun"} fin="chevron" onClick={() => setChoix(true)} />
      </GroupeListe>
      {choix ? <ChoixFeuille titre="Projet" valeur={valeur} options={options} onChoisir={onChange} onFermer={() => setChoix(false)} /> : null}
    </div>
  );
}

/** Le pied d'une feuille à enregistrer : l'action, et pourquoi elle attend. */
function PiedFeuille({ libelle, occupe, disabled, onValider, note }: { libelle: string; occupe: boolean; disabled: boolean; onValider: () => void; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Bouton variant="sombre" taille="md" className="w-full" disabled={disabled} onClick={onValider}>
        {occupe ? `${libelle}…` : libelle}
      </Bouton>
      {note}
    </div>
  );
}

function FeuilleModifier({ artefact, projets, onFermer, onFait }: { artefact: ArtefactLu; projets: ListeArtefacts["projets"]; onFermer: () => void; onFait: () => void }) {
  const { agir, occupe, erreur } = useGesteTelephone();
  const { possible } = useAccesGeste();
  const annoncer = useAnnonce();
  const [titre, setTitre] = useState(artefact.titre);
  const [description, setDescription] = useState(artefact.description);
  const [projet, setProjet] = useState(artefact.projetId ?? "");
  const enregistrer = async () => {
    const ok = await agir("artefacts.modifier", { id: artefact.id, titre, description, projetId: projet || null });
    if (!ok) return;
    annoncer({ texte: "Artefact modifié.", icone: "check-01" });
    onFermer();
    onFait();
  };
  return (
    <Feuille
      titre="Modifier le titre et la description"
      onFermer={onFermer}
      pied={<PiedFeuille libelle={occupe ? "Enregistrement" : "Enregistrer"} occupe={occupe} disabled={!possible || occupe || !titre.trim()} onValider={() => void enregistrer()} note={possible ? null : <NoteGeste className="px-1 text-ui-xs text-texte-secondaire" />} />}
    >
      <div className="flex flex-col gap-4 pt-1">
        <ChampTelephone label="Titre" erreur={titre.trim() ? null : "Donne-lui un titre."}>
          <Input size="lg" value={titre} maxLength={200} onChange={(e) => setTitre(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        <ChampTelephone label="À quoi il sert">
          <Input size="lg" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        <ChampProjet projets={projets} valeur={projet} onChange={setProjet} />
        <ErreurGeste message={erreur?.message} />
      </div>
    </Feuille>
  );
}

/** E7-48 : « Coller » lit le presse-papiers après ce geste, sinon on saisit ; l'artefact rejoint la liste de l'ordinateur. */
function FeuilleLien({ projets, onFermer, onFait }: { projets: ListeArtefacts["projets"]; onFermer: () => void; onFait: () => void }) {
  const { agir, occupe, erreur } = useGesteTelephone();
  const { possible } = useAccesGeste();
  const annoncer = useAnnonce();
  const [url, setUrl] = useState("");
  const [titre, setTitre] = useState("");
  const [projet, setProjet] = useState("");
  const [essai, setEssai] = useState(false);
  const erreurs = {
    url: LIEN_ARTEFACT.test(url.trim()) ? null : "Colle un lien claude.ai/artifact/…",
    titre: titre.trim() ? null : "Donne-lui un titre.",
  };
  const ajouter = async () => {
    setEssai(true);
    if (erreurs.url || erreurs.titre) return;
    const ok = await agir("artefacts.ajouter", { url: url.trim(), titre, projetId: projet || null });
    if (!ok) return;
    annoncer({ texte: "Lien ajouté à la liste.", icone: "check-01" });
    onFermer();
    onFait();
  };
  const coller = async () => {
    try {
      setUrl((await navigator.clipboard.readText()).trim());
    } catch {
      /* le système a refusé : on tape ou on colle à la main */
    }
  };
  return (
    <Feuille
      titre="Ajouter un lien"
      onFermer={onFermer}
      pied={<PiedFeuille libelle={occupe ? "Ajout" : "Ajouter"} occupe={occupe} disabled={!possible || occupe} onValider={() => void ajouter()} note={possible ? null : <NoteGeste className="px-1 text-ui-xs text-texte-secondaire" />} />}
    >
      <div className="flex flex-col gap-4 pt-1">
        <div className="flex flex-col gap-2">
          <label htmlFor="lien-artefact" className="text-ui font-medium text-texte-principal">
            Lien
          </label>
          <span className="flex gap-2">
            <Input
              id="lien-artefact"
              size="lg"
              value={url}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://claude.ai/artifact/…"
              aria-invalid={essai && !!erreurs.url}
              onChange={(e) => setUrl(e.target.value)}
              className={cn(CHAMP_TELEPHONE, "min-w-0 flex-1")}
            />
            <Bouton variant="blanc" taille="md" className="px-3" iconeGauche={<Icon name="copy-left" size={20} />} onClick={() => void coller()}>
              Coller
            </Bouton>
          </span>
          <ErreurGeste message={essai ? erreurs.url : null} />
        </div>
        <ChampTelephone label="Titre" erreur={essai ? erreurs.titre : null}>
          <Input size="lg" value={titre} maxLength={200} onChange={(e) => setTitre(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        <ChampProjet projets={projets} valeur={projet} onChange={setProjet} />
        <ErreurGeste message={erreur?.message} />
      </div>
    </Feuille>
  );
}

/* ─── E7-43, E7-44, E7-49 : un rendu d'agent ───────────────────── */

function MenuRendu({ rendu, lieu, sur, relire, onFermer }: { rendu: RenduLu; lieu: string | null; sur: string; relire: () => void; onFermer: () => void }) {
  const router = useRouter();
  const { possible } = useAccesGeste();
  const { agir, occupe } = useGesteTelephone();
  const annoncer = useAnnonce();
  const note = possible ? undefined : <NoteGeste className="text-ui-xs text-texte-secondaire" />;
  const tag = <Etiquette>Sur {sur}</Etiquette>;
  return (
    <MenuFeuille
      titre={rendu.titre}
      objet={{ visuel: <TuileIcone grande icone={TYPES[rendu.type].icone} />, sous: [TYPES[rendu.type].libelle, rendu.agent, rendu.projet].filter(Boolean).join(" · ") }}
      onFermer={onFermer}
      actions={[
        { libelle: "Voir l’aperçu", icone: "expand", desactivee: !rendu.apercu || !possible, note: !rendu.apercu ? "Pas d’aperçu pour ce type de fichier." : note, onChoisir: () => router.push(urlApercu(rendu.id)) },
        {
          libelle: `Ouvrir sur ${sur}`,
          icone: "link-external",
          desactivee: !possible || occupe,
          note,
          onChoisir: () =>
            void agir("rendus.ouvrir", { id: rendu.id, lieu }).then((ok) => {
              if (ok) annoncer({ texte: `Ouvert sur ${sur}.`, icone: "check-01" });
              else annoncer({ texte: `Ce rendu n’a pas pu s’ouvrir sur ${sur}.`, erreur: true });
            }),
        },
        { libelle: "Enregistrer dans un dossier…", icone: "download-02", desactivee: true, note: "Le dossier se choisit sur l’ordinateur.", fin: tag, onChoisir: () => undefined },
        { libelle: `Montrer dans ${explorateur(sur)}`, icone: "folder-open-01", desactivee: true, note: "S’ouvre sur l’écran de l’ordinateur.", fin: tag, onChoisir: () => undefined },
        {
          libelle: "Retirer de la liste…",
          icone: "trash-01",
          danger: true,
          separateurAvant: true,
          desactivee: !possible || occupe,
          note,
          confirmation: { titre: "Retirer de la liste ?", texte: "La copie gardée par KLYRA est supprimée, et son partage avec l’équipe s’il y en a un ; l’original de l’agent et ce que tu as enregistré ailleurs restent.", confirmer: "Retirer" },
          onChoisir: () =>
            void agir("rendus.retirer", { id: rendu.id, lieu }).then((ok) => {
              if (ok) annoncer({ texte: "Retiré de la liste.", icone: "check-01" });
              else annoncer({ texte: "Le retrait n’a pas abouti : le rendu reste dans la liste.", erreur: true });
              relire();
            }),
        },
      ]}
    />
  );
}

/**
 * E7-44 : l'aperçu est une image dessinée par l'ordinateur, jamais la page elle-même (pas de tunnel
 * vers une adresse du poste). Son absence se dit : ce n'est pas un rendu vide.
 */
function PageApercu({ id, lieu, rendu, liste, relire }: { id: string; lieu: string | null; rendu: RenduLu | null; liste: ListeArtefacts | null; relire: () => void }) {
  const onFermer = useRetour("/artefacts");
  const sur = useSupport();
  const { possible } = useAccesGeste();
  const lecture = useLecturePoste<{ image: string | null }>("rendus.apercu", { id, lieu }, { delai: 30_000, garder: false });
  const { agir, occupe, erreur } = useGesteTelephone();
  const annoncer = useAnnonce();
  const [menu, setMenu] = useState(false);
  const titre = rendu?.titre ?? "Aperçu";
  const image = lecture.etat === "ok" ? imageApercu(lecture.data.image) : null;
  const ouvrir = () =>
    void agir("rendus.ouvrir", { id, lieu }).then((ok) => {
      if (ok) annoncer({ texte: `Ouvert sur ${sur}.`, icone: "check-01" });
    });
  return (
    <PagePleine
      titre={titre}
      onFermer={onFermer}
      droite={rendu ? <BoutonIcone variant="discret" className="size-11" libelle="Plus d’options" aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => setMenu(true)} /> : undefined}
      pied={
        <div className="flex flex-col gap-2">
          <BandeauEtat ton="info" icone={<Icon name="help-circle-contained" size={20} />}>
            Aperçu dessiné par {sur}. La page, avec ses liens et ses formulaires, s’ouvre sur l’ordinateur.
          </BandeauEtat>
          <ErreurGeste message={erreur?.message} />
          <Bouton variant="blanc" taille="md" className="w-full" disabled={!possible || occupe} iconeGauche={<Icon name="link-external" size={20} />} onClick={ouvrir}>
            Ouvrir sur {sur}
          </Bouton>
          {!possible ? <NoteGeste className="px-1 text-ui-xs text-texte-secondaire" /> : null}
        </div>
      }
    >
      <div className="-mx-4 -mt-2 flex min-h-full flex-1 flex-col">
        {rendu ? <p className="truncate border-b border-bordure-defaut px-4 pb-2.5 text-ui-xs text-texte-secondaire">{[TYPES[rendu.type].libelle, rendu.agent, rendu.projet, quand(rendu.date)].filter(Boolean).join(" · ")}</p> : null}
        <div className="-mb-6 flex min-h-[58dvh] flex-1 items-center justify-center bg-fond-surface-grise p-4">
          {lecture.etat === "ok" ? (
            image ? (
              // eslint-disable-next-line @next/next/no-img-element -- une image en data URL, dessinée par l'ordinateur
              <img src={image} alt={`Aperçu de ${titre}`} className="h-auto max-h-full w-full rounded-[6px] object-contain shadow-ombre-md" />
            ) : (
              <EtatEcran forme="plein" icone="image-01" titre="Pas d’aperçu" texte={`${majuscule(sur)} n’a pas pu en dessiner une image. Le rendu reste entier sur l’ordinateur.`} className="p-0" />
            )
          ) : lecture.etat === "attente" ? (
            <div className="w-full">
              <DemandeEnCours lent={lecture.lent} lignes={2} />
            </div>
          ) : lecture.etat === "delai" ? (
            <PasDeReponse relancer={lecture.relancer} />
          ) : lecture.etat === "erreur" ? (
            <ErreurPoste code={lecture.code} message={lecture.message} relancer={lecture.relancer} />
          ) : (
            <EtatEcran icone="computer" titre={lecture.etat === "aucun" ? "Aucun ordinateur relié" : `${majuscule(sur)} est fermé`} texte="L’aperçu est dessiné par l’ordinateur : il n’est pas gardé sur ce téléphone." className="p-0" />
          )}
        </div>
      </div>
      {menu && rendu && liste ? <MenuRendu rendu={rendu} lieu={lieu} sur={sur} relire={relire} onFermer={() => setMenu(false)} /> : null}
    </PagePleine>
  );
}

/* ─── E7-50 à E7-54 : l'onglet Équipe, lu dans le compte ───────── */

function OngletEquipe({ pages, relire, surServeur }: { pages: PageEquipe[] | null; relire: () => void; surServeur: boolean }) {
  const router = useRouter();
  const equipeCompte = useArtefactsEquipe();
  /* Les liens claude.ai de l'équipe sont ceux de Ce PC, comme au bureau. */
  const equipe = surServeur ? { ...equipeCompte, artefacts: [] } : equipeCompte;
  const [recherche, setRecherche] = useState("");
  const [menu, setMenu] = useState<ArtefactEquipe | null>(null);
  const q = recherche.trim().toLowerCase();
  const liens = equipe.artefacts.filter((a) => !q || `${a.titre} ${a.description} ${a.auteur.nom}`.toLowerCase().includes(q));
  const docs = (pages ?? []).filter((d) => !q || `${d.titre} ${d.description} ${d.auteur.nom}`.toLowerCase().includes(q));

  if (equipe.etat === "hors-ligne") return <EtatEcran icone="globe-01" titre="Hors ligne" texte={TEXTES_EQUIPE["hors-ligne"]} className="pt-8" />;
  if (equipe.etat === "chargement" || (equipe.etat === "pret" && pages === null)) {
    return (
      <div aria-busy="true" className="px-4">
        <Squelette lignes={4} />
      </div>
    );
  }
  if (equipe.etat !== "pret") {
    return (
      <EtatEcran
        erreur={equipe.etat === "erreur"}
        icone="help-circle-contained"
        titre={equipe.etat === "erreur" ? (equipe.message ?? TEXTES_EQUIPE.erreur) : TEXTES_EQUIPE[equipe.etat]}
        className="pt-8"
        action={
          equipe.etat === "erreur" ? (
            <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="refresh-01" size={20} />} onClick={relire}>
              Réessayer
            </Bouton>
          ) : null
        }
      />
    );
  }
  if (!equipe.artefacts.length && !pages?.length) {
    return (
      <EtatEcran
        forme="encadre"
        icone="users-profiles-01"
        titre="Rien de partagé pour l’instant"
        texte={surServeur ? "Les pages que l’équipe partage depuis ce serveur arrivent ici." : "Dans Mes artefacts, partage un lien claude.ai avec l’équipe : chacun le retrouvera ici."}
        action={
          <Bouton variant="blanc" taille="md" onClick={() => router.replace(urlArtefacts())}>
            Voir Mes artefacts
          </Bouton>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3.5 px-4">
      <p className="-mt-1 px-1 text-ui-xs leading-[1.4] text-texte-secondaire">Les liens que l’équipe partage : chacun y ajoute les siens depuis Mes artefacts.</p>
      <ChampRecherche valeur={recherche} onChange={setRecherche} placeholder="Chercher un artefact…" libelle="Chercher un artefact" />
      {liens.length ? (
        <GroupeListe>
          {liens.map((a) => (
            <LigneListe
              key={a._id}
              debut={<TuileIcone icone="link" />}
              retrait="tuile"
              nom={a.titre}
              ligne2={
                <>
                  {a.description ? <span className="block truncate">{a.description}</span> : null}
                  <span className="block truncate">{a.deMoi ? "Partagé par toi" : `Partagé par ${a.auteur.nom}`} · {quand(a.majLe)}</span>
                  <span className="sr-only"> (s’ouvre dans le navigateur)</span>
                </>
              }
              onClick={() => ouvrirLien(a.url)}
              onMenu={() => setMenu(a)}
              menuVisible
            />
          ))}
        </GroupeListe>
      ) : null}
      {docs.length ? <SectionPages docs={docs} /> : null}
      {q && !liens.length && !docs.length ? (
        <EtatEcran
          forme="encadre"
          icone="search-01"
          titre="Aucun résultat"
          className="px-0 pb-0"
          action={
            <Bouton variant="blanc" taille="md" onClick={() => setRecherche("")}>
              Effacer les filtres
            </Bouton>
          }
        />
      ) : null}
      {menu ? <MenuEquipe key={menu._id} artefact={menu} onFermer={() => setMenu(null)} /> : null}
    </div>
  );
}

/** Les pages HTML partagées à l'équipe : elles se lisent dans la fenêtre isolée de l'ordinateur, pas ici. */
function SectionPages({ docs }: { docs: PageEquipe[] }) {
  const sur = useSupport();
  return (
    <SectionListe titre="Pages partagées" compte={docs.length}>
      <GroupeListe>
        {docs.map((d) => (
          <LigneListe
            key={d._id}
            debut={<TuileIcone icone="globe-01" />}
            retrait="tuile"
            nom={d.titre}
            etiquette={<Etiquette>Sur {sur}</Etiquette>}
            ligne2={
              <>
                {d.description ? <span className="block truncate">{d.description}</span> : null}
                <span className="block truncate">{d.deMoi ? "Partagé par toi" : `Partagé par ${d.auteur.nom}`} · {quand(d.majLe)}</span>
              </>
            }
          />
        ))}
      </GroupeListe>
    </SectionListe>
  );
}

function MenuEquipe({ artefact, onFermer }: { artefact: ArtefactEquipe; onFermer: () => void }) {
  const equipe = useArtefactsEquipe();
  const annoncer = useAnnonce();
  const [menu, setMenu] = useState(true);
  const [modifier, setModifier] = useState(false);
  const sous = `${artefact.deMoi ? "Partagé par toi" : `Partagé par ${artefact.auteur.nom}`} · ${quand(artefact.majLe)}`;
  return (
    <>
      {menu ? (
        <MenuFeuille
          titre={artefact.titre}
          objet={{ visuel: <TuileIcone grande icone="link" />, sous }}
          onFermer={() => {
            setMenu(false);
            if (!modifier) onFermer();
          }}
          actions={[
            { libelle: "Ouvrir dans le navigateur", icone: "link-external", onChoisir: () => ouvrirLien(artefact.url) },
            ...(artefact.deMoi
              ? [
                  { libelle: "Modifier le titre et la description", icone: "pencil-01" as IconName, desactivee: equipe.etat !== "pret", onChoisir: () => setModifier(true) },
                  {
                    libelle: "Ne plus partager…",
                    icone: "x-01" as IconName,
                    danger: true,
                    separateurAvant: true,
                    desactivee: equipe.etat !== "pret",
                    confirmation: { titre: "Ne plus partager avec l’équipe ?", texte: "L’artefact reste sur claude.ai et dans tes artefacts.", confirmer: "Ne plus partager" },
                    onChoisir: () =>
                      void equipe.retirer(artefact._id).then(
                        () => annoncer({ texte: `« ${artefact.titre} » n’est plus partagé.`, icone: "check-01" }),
                        (e: unknown) => annoncer({ texte: e instanceof Error ? e.message : messageErreur(e), erreur: true }),
                      ),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      {modifier ? <FeuilleModifierEquipe artefact={artefact} onFermer={onFermer} /> : null}
    </>
  );
}

function FeuilleModifierEquipe({ artefact, onFermer }: { artefact: ArtefactEquipe; onFermer: () => void }) {
  const equipe = useArtefactsEquipe();
  const annoncer = useAnnonce();
  const [titre, setTitre] = useState(artefact.titre);
  const [description, setDescription] = useState(artefact.description);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const enregistrer = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      await equipe.modifier(artefact._id, { titre: titre.trim(), description: description.trim() });
      annoncer({ texte: "Artefact modifié.", icone: "check-01" });
      onFermer();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };
  return (
    <Feuille
      titre="Modifier le titre et la description"
      onFermer={onFermer}
      pied={<PiedFeuille libelle={occupe ? "Enregistrement" : "Enregistrer"} occupe={occupe} disabled={occupe || !titre.trim() || equipe.etat !== "pret"} onValider={() => void enregistrer()} />}
    >
      <div className="flex flex-col gap-4 pt-1">
        <ChampTelephone label="Titre" erreur={titre.trim() ? null : "Donne-lui un titre."}>
          <Input size="lg" value={titre} maxLength={80} onChange={(e) => setTitre(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        <ChampTelephone label="À quoi il sert">
          <Input size="lg" value={description} maxLength={DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        <ErreurGeste message={erreur} />
      </div>
    </Feuille>
  );
}
