"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { Onglets } from "@/components/ui/Onglets";
import { cn } from "@/lib/cn";
import { useGestePoste, useLecturePoste } from "@/lib/poste/client";
import { texteErreurPoste } from "@/lib/poste-texte";
import { libelleStatut, STATUTS, urlProjet, vueProjet, type ProjetModifiable } from "@/lib/telephone/dossiers";
import { DossierTelephone, ListeDossier, useNiveau } from "./DossierTelephone";
import { EnteteTelephone, PageOnglet } from "./EnteteTelephone";
import { MenuFeuille, type ActionMenu } from "./Feuille";
import { EtatEcran, NotePoste, Squelette, SurLePoste, useBandeau, VueLecture } from "./etats";
import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { usePostes, useSupport } from "./poste";
import { VisionneuseTelephone } from "./VisionneuseTelephone";
import { ONGLETS_TELEPHONE } from "./CommunAgentsTelephone";
import { CaseRonde, CHAMP_TELEPHONE } from "./Controles";

/**
 * Projets, projet, dossier et visionneuse (spec mobile T-10 à T-13). Routes : /projets, puis
 * /projet?id=… avec `onglet=fichiers`, `dossier=…` (T-12) ou `fichier=…` (T-13).
 * La liste et les chats viennent du compte ; le dossier et les fichiers, du poste ouvert.
 */

const DOSSIER_SUR_POSTE = "le dossier d’un projet se choisit sur l’ordinateur.";
const CHAMP = cn("mt-1", CHAMP_TELEPHONE);

/** Le menu « ⋯ » d'un projet : modifier (Poste, P-7 fermé) ; dossier et retrait restent sur l'ordinateur (P-8). */
function actionsProjet(ouvert: boolean, modifier: () => void): ActionMenu[] {
  const rien = () => undefined;
  return [
    { libelle: "Modifier", onChoisir: modifier, desactivee: !ouvert, note: ouvert ? undefined : <NotePoste /> },
    { libelle: "Changer de dossier", onChoisir: rien, desactivee: true, note: <SurLePoste raison={DOSSIER_SUR_POSTE} /> },
    { libelle: "Retirer", onChoisir: rien, desactivee: true, note: <SurLePoste raison={DOSSIER_SUR_POSTE} /> },
  ];
}

/** T-10. Une colonne : nom, ligne, statut, chats, épingle. Les cartes viennent du compte (M-4). */
export function ProjetsTelephone() {
  const projets = useQuery(api.conversationsCompte.projets, {});
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const sur = useSupport();
  const { ouvert } = usePostes();
  const [menu, setMenu] = useState<{ origine: string; nom: string } | null>(null);
  const [modifier, setModifier] = useState<{ origine: string; nom: string } | null>(null);
  const [bandeau, dire] = useBandeau();
  const liste = [...(projets ?? [])].sort((a, b) => Number(b.epingle) - Number(a.epingle) || a.nom.localeCompare(b.nom, "fr"));
  const chats = (origine: string) => (conversations ?? []).filter((c) => c.projetId === origine).length;

  return (
    <PageOnglet titre="Projets" sous={projets?.length ? `${projets.length} projet${projets.length > 1 ? "s" : ""} sur ${sur}` : undefined}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {projets === undefined ? (
          <Squelette lignes={4} />
        ) : liste.length === 0 ? (
          <EtatEcran forme="encadre" icone="projets-dossier" titre={`Ajoute un projet sur ${sur}`} texte="Le dossier d’un projet se choisit sur l’ordinateur. Il s’affiche ici ensuite." />
        ) : (
          <SectionListe titre="Projets" compte={liste.length}>
            <GroupeListe>
              {liste.map((projet) => (
                <LigneProjet key={projet.origine} projet={projet} chats={conversations ? chats(projet.origine) : null} onMenu={() => setMenu(projet)} />
              ))}
            </GroupeListe>
          </SectionListe>
        )}
        <div className="px-1 pt-2">
          <SurLePoste titre="Nouveau projet" raison={DOSSIER_SUR_POSTE} />
        </div>
      </div>
      {menu ? (
        <MenuFeuille
          titre={menu.nom}
          objet={{ visuel: <TuileIcone icone="folder" />, sous: "Projet" }}
          actions={actionsProjet(ouvert, () => setModifier(menu))}
          onFermer={() => setMenu(null)}
        />
      ) : null}
      {modifier ? <PageModifierProjet projetId={modifier.origine} nom={modifier.nom} onFermer={() => setModifier(null)} onEnregistre={() => dire("Enregistré")} /> : null}
      {bandeau}
    </PageOnglet>
  );
}

function LigneProjet({
  projet,
  chats,
  onMenu,
}: {
  projet: { origine: string; nom: string; accroche: string; statut: string; epingle: boolean };
  chats: number | null;
  onMenu: () => void;
}) {
  const details = [projet.accroche, libelleStatut(projet.statut), chats === null ? null : `${chats} chat${chats > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  /* D-7 : un projet a sa page ; son menu s'ouvre par l'appui long, le ⋯ de sa page, ou le bouton des lecteurs d'écran. */
  return (
    <LigneListe
      href={urlProjet(projet.origine)}
      debut={<TuileIcone icone="folder" />}
      retrait="tuile"
      nom={projet.nom}
      etiquette={projet.epingle ? <Etiquette>Épinglé</Etiquette> : undefined}
      ligne2={details}
      fin="chevron"
      onMenu={onMenu}
    />
  );
}

/**
 * Modifier le nom, la ligne, le brief, le statut, l'épingle : un geste sur le poste (M-6), lu puis
 * écrit dans `conversations.json` par l'ordinateur. Page pleine (M-10) : le brief est long.
 */
function PageModifierProjet({ projetId, nom, onFermer, onEnregistre }: { projetId: string; nom: string; onFermer: () => void; onEnregistre: () => void }) {
  const lecture = useLecturePoste<ProjetModifiable>("projets.lire", { projetId });
  return (
    <div role="dialog" aria-label={`Modifier ${nom}`} className="fixed inset-0 z-30 flex flex-col bg-fond-page">
      <EnteteTelephone titre={`Modifier ${nom}`} retour={onFermer} />
      <VueLecture lecture={lecture} ferme={(sur) => `ce projet est enregistré sur ${sur}. Il se modifie quand KLYRA y est ouverte.`} lignes={3}>
        {(initial) => (
          <FormulaireProjet
            projetId={projetId}
            initial={initial}
            onFini={(enregistre) => {
              onFermer();
              if (enregistre) onEnregistre();
            }}
          />
        )}
      </VueLecture>
    </div>
  );
}

function FormulaireProjet({ projetId, initial, onFini }: { projetId: string; initial: ProjetModifiable; onFini: (enregistre: boolean) => void }) {
  const { faire, occupe } = useGestePoste();
  const { ouvert } = usePostes();
  const sur = useSupport();
  const [valeurs, setValeurs] = useState(initial);
  const [erreur, setErreur] = useState<string | null>(null);
  const changer = <K extends keyof ProjetModifiable>(cle: K, valeur: ProjetModifiable[K]) => setValeurs((v) => ({ ...v, [cle]: valeur }));

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    if (!valeurs.nom.trim()) return setErreur("Donne-lui un nom.");
    setErreur(null);
    const r = await faire<ProjetModifiable>("projets.modifier", { projetId, ...valeurs });
    if (r.ok) return onFini(true);
    setErreur(texteErreurPoste(r, sur));
  };

  return (
    <form onSubmit={(e) => void enregistrer(e)} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <label className="mt-2 block text-ui text-texte-principal">
          Nom
          <input value={valeurs.nom} maxLength={120} onChange={(e) => changer("nom", e.target.value)} className={CHAMP} />
        </label>
        <label className="mt-4 block text-ui text-texte-principal">
          En une ligne
          <input value={valeurs.accroche} maxLength={200} onChange={(e) => changer("accroche", e.target.value)} className={CHAMP} />
        </label>
        <label className="mt-4 block text-ui text-texte-principal">
          Brief
          <textarea
            value={valeurs.brief}
            onChange={(e) => changer("brief", e.target.value)}
            className="mt-1 min-h-32 w-full rounded-md border border-bordure-champ bg-fond-surface px-3 py-2 text-body-s text-texte-principal"
          />
          <span className="mt-1 block text-ui-xs text-texte-secondaire">Ce que les agents doivent savoir du projet : le client, l’objectif, l’échéance.</span>
        </label>
        <fieldset className="mt-4">
          <legend className="text-ui text-texte-principal">Statut</legend>
          <div role="radiogroup" aria-label="Statut" className="mt-1 flex gap-2">
            {STATUTS.map((s) => (
              <button
                key={s.valeur}
                type="button"
                role="radio"
                aria-checked={valeurs.statut === s.valeur}
                onClick={() => changer("statut", s.valeur)}
                className={cn(
                  "min-h-11 flex-1 rounded-xs border px-2 text-ui",
                  valeurs.statut === s.valeur ? "border-bordure-forte bg-fond-surface-grise font-medium text-texte-principal" : "border-bordure-subtile text-texte-secondaire",
                )}
              >
                {s.libelle}
              </button>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          role="checkbox"
          aria-checked={valeurs.epingle}
          onClick={() => changer("epingle", !valeurs.epingle)}
          className="mt-4 flex min-h-11 items-center gap-3 text-left text-ui text-texte-principal"
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            <CaseRonde faite={valeurs.epingle} />
          </span>
          Épingler : la marque du projet est pleine dans le menu
        </button>
        <SurLePoste titre="Dossier" raison={DOSSIER_SUR_POSTE} />
        {erreur ? (
          <p role="alert" className="mt-2 text-ui text-texte-erreur">
            {erreur}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-bordure-subtile px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <div className="flex gap-2">
          <Bouton type="button" variant="blanc" taille="md" className="flex-1" onClick={() => onFini(false)}>
            Annuler
          </Bouton>
          <BoutonPrincipal type="submit" disabled={!ouvert || occupe}>
            Enregistrer
          </BoutonPrincipal>
        </div>
        {ouvert ? null : <NotePoste />}
      </div>
    </form>
  );
}

/** T-11 à T-13, selon l'adresse : la visionneuse, un dossier, ou le projet et ses onglets. */
export function ProjetTelephone() {
  const params = useSearchParams();
  const projetId = params.get("id") ?? "";
  const projets = useQuery(api.conversationsCompte.projets, {});
  const nom = projets?.find((p) => p.origine === projetId)?.nom ?? "Projet";
  const vue = vueProjet(params);

  if (!projetId) return <ProjetsTelephone />;
  if (vue.vue === "fichier") {
    return <VisionneuseTelephone key={`${vue.chemin}#${vue.retour.length}`} projetId={projetId} nomProjet={nom} chemin={vue.chemin} ancre={vue.ancre} retour={vue.retour} />;
  }
  if (vue.vue === "dossier") return <DossierTelephone key={vue.chemin} projetId={projetId} nomProjet={nom} chemin={vue.chemin} />;
  return <OngletsProjet projetId={projetId} nom={nom} onglet={vue.onglet} />;
}

/** T-11 : « Chats » (compte) et « Fichiers » (le premier niveau du dossier, comme T-12). */
function OngletsProjet({ projetId, nom, onglet }: { projetId: string; nom: string; onglet: "chats" | "fichiers" }) {
  const router = useRouter();
  const { ouvert } = usePostes();
  const [menu, setMenu] = useState(false);
  const [modifier, setModifier] = useState(false);
  const [bandeau, dire] = useBandeau();
  const niveau = useNiveau(projetId, "", onglet === "fichiers");
  const actions = [...actionsProjet(ouvert, () => setModifier(true)), ...(onglet === "fichiers" ? niveau.actions : [])];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone
        titre={nom}
        parent="/projets"
        droite={<BoutonIcone variant="discret" taille="md" libelle="Actions du projet" onClick={() => setMenu(true)} icone={<Icon name="dot-horizontal" size={24} />} />}
      />
      <div className="shrink-0 px-4 pb-2">
        <Onglets
          libelle="Contenu du projet"
          onglets={[
            { id: "chats", label: "Chats" },
            { id: "fichiers", label: "Fichiers" },
          ]}
          valeur={onglet}
          onChange={(id) => router.replace(urlProjet(projetId, id))}
          className={ONGLETS_TELEPHONE}
        />
      </div>
      {onglet === "chats" ? <ChatsDuProjet projetId={projetId} nom={nom} /> : <ListeDossier projetId={projetId} niveau={niveau} />}
      {menu ? <MenuFeuille titre={nom} actions={actions} onFermer={() => setMenu(false)} /> : null}
      {modifier ? <PageModifierProjet projetId={projetId} nom={nom} onFermer={() => setModifier(false)} onEnregistre={() => dire("Enregistré")} /> : null}
      {bandeau}
    </div>
  );
}

/** « Chats du projet » (compte) et « Nouveau chat dans {nom}… » (file, écran du fil). */
function ChatsDuProjet({ projetId, nom }: { projetId: string; nom: string }) {
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const liste = (conversations ?? [])
    .filter((c) => c.projetId === projetId)
    .sort((a, b) => Number(!!b.epingleLe) - Number(!!a.epingleLe) || b.misAJour.localeCompare(a.misAJour));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <h2 className="mt-2 text-ui text-texte-secondaire">Chats du projet</h2>
      {conversations === undefined ? (
        <div className="mt-2 flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-14 rounded-md bg-fond-surface-grise" />
          ))}
        </div>
      ) : liste.length === 0 ? (
        <p className="mt-3 text-body-s text-texte-principal">Pas encore de chat dans ce projet.</p>
      ) : (
        <ul>
          {liste.map((conversation) => (
            <li key={conversation.origine}>
              <Link href={`/chat?id=${encodeURIComponent(conversation.origine)}`} className="flex min-h-16 flex-col justify-center gap-0.5 border-b border-bordure-subtile py-2 active:bg-fond-survol">
                <span className="truncate text-body-s text-texte-principal">{conversation.titre}</span>
                {conversation.extrait ? <span className="truncate text-ui-xs text-texte-secondaire">{conversation.extrait}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        /* C-5 : le fil lit l'id du projet dans `nouveau` (`FilTelephone`). */
        href={`/chat?${new URLSearchParams({ nouveau: projetId })}`}
        className="mt-3 flex min-h-11 items-center gap-2 text-ui text-texte-principal"
      >
        <Icon name="plus-01" size={20} className="text-icone-secondaire" />
        Nouveau chat dans {nom}…
      </Link>
    </div>
  );
}
