"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import type { IconName } from "@/components/icons/icon-data";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { Modale } from "@/components/ui/Modale";
import { Onglets } from "@/components/ui/Onglets";
import { annoncer } from "@/lib/annonces";
import { ArtefactsEquipeProvider, useArtefactsEquipe, type ArtefactEquipe, type EtatArtefactsEquipe } from "@/lib/artefacts-equipe";
import { useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { codeErreur } from "@/lib/compte";
import { DocumentsKlyraProvider, useDocumentsKlyra, type DocumentKlyra, type EtatDocuments } from "@/lib/documents-klyra";
import { hoteDe, useLieuActif } from "@/lib/lieux";
import { apparition } from "@/lib/mouvement";
import { poste } from "@/lib/plateforme";
import { nomDuFichier } from "@/lib/rendus";
import { lieuDuRendu, renduDansEspace, texteEspace } from "@/lib/rendus-espace";
import { jouer } from "@/lib/sons/sons";
import { useIdDirect, useProjects, useRole, useWorkspace } from "@/lib/workspace";
import type { Artefact, Rendu, TypeRendu } from "@/types/domain";
import { DESCRIPTION_MAX, lienArtefact } from "../../../convex/model/artefacts";

const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** Un lien d'artefact Claude : claude.ai/artifact/… ou claude.ai/code/artifact/… */
const LIEN_ARTEFACT = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+\/?$/;

/* ─── Session claude.ai et vignettes ───────────────────────────── */

/** Dernière lecture du compte pendant cette session de l'app : l'écran relit à l'ouverture, au plus toutes les 10 minutes. */
let derniereSynchro = 0;
const INTERVALLE_SYNCHRO_MS = 10 * 60_000;

/** Les vignettes déjà lues pendant cette session de l'app. */
const vignettes = new Map<string, string | null>();

/** D'où vient une vignette : la page claude.ai (session de l'app) ou le fichier d'un rendu d'agent. */
type SourceVignette = { type: "claude"; url: string } | { type: "rendu"; chemin: string };

/** La vignette d'un artefact, demandée quand la carte arrive à l'écran (`actif` : on peut la demander). */
function useVignette(source: SourceVignette, actif: boolean, version: number) {
  const bridge = getBridge();
  const cle = source.type === "claude" ? source.url : `fichier:${source.chemin}`;
  const [image, setImage] = useState<string | null | undefined>(() => vignettes.get(cle));
  const carte = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!bridge || !actif) return;
    const el = carte.current;
    if (!el) return;
    let vivant = true;
    const observer = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      observer.disconnect();
      const valeur = cle.startsWith("fichier:") ? bridge.rendus.vignette(cle.slice(8), version > 0) : bridge.artefacts.vignette(cle, version > 0);
      void valeur.then((r) => {
        const v = r.ok ? r.data : null;
        vignettes.set(cle, v);
        if (vivant) setImage(v);
      });
    });
    observer.observe(el);
    return () => {
      vivant = false;
      observer.disconnect();
    };
  }, [bridge, cle, actif, version]);

  return { image, carte };
}

/** La vignette : un clic ouvre l'artefact en grand. */
function Apercu({ titre, image, sansImage, icone = "layers-01", onOuvrir, ref }: {
  titre: string;
  image: string | null | undefined;
  /** Ce que dit la carte sans vignette (sinon « Aperçu… » puis « Aperçu indisponible »). */
  sansImage?: string;
  icone?: IconName;
  onOuvrir: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOuvrir}
      aria-label={`Ouvrir ${titre}`}
      className="relative block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-lg border border-white bg-fond-page p-0 shadow-ombre-sm"
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- vignette locale en data URL
        <img
          src={image}
          alt=""
          className="size-full object-cover object-top transition-[scale] duration-[480ms] ease-sortie group-hover/artefact:scale-[1.02]"
        />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-2 text-texte-tertiaire">
          <span className="klyra-orbe flex size-10 items-center justify-center rounded-full">
            <Icon name={icone} size={20} />
          </span>
          <span className="text-ui-2xs">{sansImage ?? (image === null ? "Aperçu indisponible" : "Aperçu…")}</span>
        </span>
      )}
    </button>
  );
}

/** Ouvre un artefact dans une fenêtre de l'app (session claude.ai), ou dans le navigateur hors de l'app. */
function ouvrirArtefact(url: string, titre: string) {
  const bridge = getBridge();
  if (bridge) void bridge.artefacts.ouvrir(url, titre);
  else window.open(url, "_blank", "noreferrer");
}

/** Une confirmation dans la carte, comme « Retirer de la liste ? ». */
function Confirmation({ texte, action, erreur, enCours, onConfirmer, onAnnuler }: {
  texte: string;
  action: string;
  erreur?: string | null;
  enCours?: boolean;
  onConfirmer: () => void;
  onAnnuler: () => void;
}) {
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md bg-fond-page p-2.5">
      <p className="m-0 text-ui-xs leading-[1.45] text-texte-principal">{texte}</p>
      <div className="flex flex-wrap gap-2">
        <Bouton variant="sombre" taille="compact" onClick={onConfirmer} disabled={enCours}>
          {action}
        </Bouton>
        <Bouton variant="blanc" taille="compact" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
      {erreur && <p className="m-0 text-ui-xs text-texte-erreur">{erreur}</p>}
    </div>
  );
}

/** Où en est la fenêtre de partage d'un artefact. */
type PhasePartage = "confirmer" | "envoi" | "erreur" | "deja";

/**
 * « Partager avec l'équipe » d'un artefact claude.ai : une fenêtre de l'app, hors de la carte (#127),
 * comme `ModalePartager` pour un agent. Focus sur Annuler : Entrée par réflexe ne partage pas. Pendant
 * l'envoi, rien ne la ferme (le partage aboutirait quand même) et le bouton est `aria-disabled`, pas
 * `disabled` : le focus reste dessus.
 */
function ModalePartageArtefact({ artefact, partage, onFermer, onPartage }: {
  artefact: Artefact;
  /** Le lien dans la liste de l'équipe : arrivé fenêtre ouverte, quelqu'un l'a partagé entre-temps. */
  partage: ArtefactEquipe | undefined;
  onFermer: () => void;
  onPartage: () => void;
}) {
  const equipe = useArtefactsEquipe();
  const [phase, setPhase] = useState<PhasePartage>("confirmer");
  const [erreur, setErreur] = useState<string | null>(null);
  const principal = useRef<HTMLButtonElement>(null);
  const fermer = useRef<HTMLButtonElement>(null);

  /* Pendant notre envoi, c'est sans doute le nôtre : la fenêtre va se fermer. */
  if (partage && phase !== "envoi" && phase !== "deja") setPhase("deja");

  useEffect(() => {
    if (phase === "erreur") principal.current?.focus();
    else if (phase === "deja") fermer.current?.focus();
  }, [phase]);

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
  };

  /* Hors ligne, Convex garderait la mutation en attente et « Partage… » resterait affiché. */
  const indisponible =
    equipe.etat === "pret" || phase === "envoi"
      ? null
      : equipe.etat === "hors-ligne"
        ? "Hors ligne : tu pourras partager quand le réseau reviendra."
        : texteEtatEquipe(equipe.etat, equipe.message);
  const texteDeja = partage?.deMoi
    ? "Tu l’as déjà partagé : il est dans l’onglet Équipe."
    : partage
      ? `${partage.auteur.nom} l’a déjà partagé : il est dans l’onglet Équipe.`
      : "Cet artefact est déjà dans l’onglet Équipe.";

  return (
    <Modale
      role="alertdialog"
      titre={phase === "deja" ? "Déjà partagé avec l’équipe" : `Partager « ${artefact.titre} » avec l’équipe ?`}
      onFermer={() => {
        if (phase !== "envoi") onFermer();
      }}
      actions={
        phase === "deja" ? (
          <Bouton ref={fermer} variant="sombre" taille="md" onClick={onFermer}>
            Fermer
          </Bouton>
        ) : (
          <>
            <Bouton variant="blanc" taille="md" data-autofocus disabled={phase === "envoi"} onClick={onFermer}>
              Annuler
            </Bouton>
            <Bouton
              ref={principal}
              variant="sombre"
              taille="md"
              disabled={indisponible !== null}
              aria-disabled={phase === "envoi" || undefined}
              className="aria-disabled:pointer-events-none aria-disabled:opacity-60"
              onClick={() => void envoyer()}
            >
              {phase === "envoi" ? "Partage…" : phase === "erreur" ? "Réessayer" : "Partager"}
            </Bouton>
          </>
        )
      }
    >
      {phase === "deja" ? (
        <p className="m-0">{texteDeja}</p>
      ) : (
        <div className="flex flex-col gap-3 text-pretty">
          <p className="m-0">Chacun verra ce lien dans l’onglet Équipe.</p>
          <div className="flex items-start gap-2.5 rounded-md bg-fond-page px-3 py-2.5">
            <Icon name="link" size={16} className="mt-0.5 shrink-0 text-icone-secondaire" />
            <p className="m-0">Pour l’ouvrir, il faut aussi que l’artefact soit partagé sur claude.ai.</p>
          </div>
          {phase === "erreur" && erreur && (
            <div role="alert" className="flex flex-col gap-0.5 rounded-md border border-bordure-erreur bg-fond-surface p-3 text-ui-s text-texte-erreur">
              <p className="m-0 font-medium">Le partage n’a pas abouti. Rien n’a été partagé.</p>
              <p className="m-0">{erreur}</p>
            </div>
          )}
          {indisponible && <p className="m-0 text-ui-s text-texte-secondaire">{indisponible}</p>}
        </div>
      )}
    </Modale>
  );
}

/* ─── Une carte ────────────────────────────────────────────────── */

function CarteArtefact({ artefact, session, version }: { artefact: Artefact; session: boolean; version: number }) {
  const router = useRouter();
  const projects = useProjects();
  const projet = projects.find((p) => p.id === artefact.projectId);
  const { modifierArtefact, supprimerArtefact } = useWorkspace();
  const idDirect = useIdDirect();
  const { image, carte } = useVignette({ type: "claude", url: artefact.url }, session, version);
  const [edition, setEdition] = useState(false);
  const [titre, setTitre] = useState(artefact.titre);
  const [description, setDescription] = useState(artefact.description);
  const [projectId, setProjectId] = useState(artefact.projectId ?? "");
  const [retirer, setRetirer] = useState(false);
  const equipe = useArtefactsEquipe();
  const lien = lienArtefact(artefact.url);
  const partage = equipe.artefacts.find((a) => a.url === lien);
  const [fenetrePartage, setFenetrePartage] = useState(false);
  /* La puce « Équipe » n'entre en mouvement qu'après un partage fait depuis cette carte. */
  const [vientDePartager, setVientDePartager] = useState(false);
  const boutonPartage = useRef<HTMLButtonElement>(null);
  const apercu = useRef<HTMLButtonElement>(null);
  /* Où va le focus quand la fenêtre se ferme : l'icône de partage si elle est encore là, sinon l'aperçu. */
  const focusApres = useRef<"icone" | "apercu" | null>(null);

  /* Après le nettoyage de la Modale (qui rend le focus à l'icône, même si elle va disparaître) : les
     nettoyages d'une validation passent avant ses effets. */
  useEffect(() => {
    if (fenetrePartage || !focusApres.current) return;
    const cible = focusApres.current === "icone" && boutonPartage.current?.isConnected ? boutonPartage.current : apercu.current;
    focusApres.current = null;
    cible?.focus();
  }, [fenetrePartage]);

  const ouvrir = () => ouvrirArtefact(artefact.url, artefact.titre);
  const fermerPartage = () => {
    focusApres.current = "icone";
    setFenetrePartage(false);
  };
  /* Le bouton de partage disparaît avec le partage : le focus va sur l'aperçu. */
  const partageFait = () => {
    focusApres.current = "apercu";
    setFenetrePartage(false);
    setVientDePartager(true);
    jouer("validation");
    annoncer(`« ${artefact.titre} » partagé avec l’équipe.`);
  };
  const modifierAvecAgent = () => {
    const brouillon = `Modifie l’artefact « ${artefact.titre} » (${artefact.url}) : `;
    router.push(`/chat?id=${encodeURIComponent(idDirect("principal"))}&brouillon=${encodeURIComponent(brouillon)}`);
  };

  return (
    /* Comme les cartes d'agents : un bloc gris, l'aperçu en haut, les infos dans un bloc blanc en dessous. */
    <li
      ref={carte}
      className="group/artefact flex flex-col gap-2 rounded-2xl bg-fond-surface-grise p-2 transition-[box-shadow,translate] duration-[300ms] ease-sortie hover:-translate-y-0.5 hover:shadow-ombre-ambiante"
    >
      <Apercu ref={apercu} titre={artefact.titre} image={image} sansImage={session ? undefined : "Connecte claude.ai pour voir l’aperçu"} onOuvrir={ouvrir} />

      {edition ? (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!titre.trim()) return;
            modifierArtefact(artefact.id, {
              titre: titre.trim(),
              titrePerso: titre.trim() !== artefact.titre || artefact.titrePerso,
              description: description.trim(),
              projectId: projectId || null,
            });
            setEdition(false);
          }}
          className="flex flex-col gap-3 rounded-lg border border-white bg-fond-surface px-4 py-3 shadow-ombre-sm"
        >
          <Champ label="Titre">
            <Input size="sm" value={titre} onChange={(e) => setTitre(e.target.value)} className={CHAMP} />
          </Champ>
          <Champ label="À quoi il sert">
            <Input size="sm" value={description} onChange={(e) => setDescription(e.target.value)} className={CHAMP} />
          </Champ>
          <Champ label="Projet">
            <ListeDeroulante
              value={projectId}
              options={[{ value: "", label: "Aucun" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={setProjectId}
            />
          </Champ>
          <div className="flex gap-2">
            <Bouton type="submit" variant="sombre" taille="compact">
              Enregistrer
            </Bouton>
            <Bouton variant="blanc" taille="compact" onClick={() => setEdition(false)}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5 rounded-lg border border-white bg-fond-surface px-4 py-3 shadow-ombre-sm">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-ui font-semibold text-texte-principal">{artefact.titre}</span>
            <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover/artefact:opacity-100 focus-within:opacity-100">
              {equipe.etat === "pret" && !partage && lien && (
                <BoutonIcone
                  ref={boutonPartage}
                  taille="mini"
                  icone={<Icon name="users-profiles-plus" size={16} />}
                  libelle="Partager avec l’équipe"
                  aria-haspopup="dialog"
                  onClick={() => setFenetrePartage(true)}
                  className="text-icone-secondaire"
                />
              )}
              <BoutonIcone taille="mini" icone={<Icon name="file-code" size={16} />} libelle="Modifier le titre et la description" onClick={() => setEdition(true)} className="text-icone-secondaire" />
              <BoutonIcone taille="mini" icone={<Icon name="trash-01" size={16} />} libelle="Retirer de la liste" onClick={() => setRetirer(true)} className="text-icone-secondaire" />
            </span>
          </div>
          {artefact.description && <p className="m-0 line-clamp-2 text-ui-s leading-[1.45] text-texte-secondaire">{artefact.description}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-ui-2xs text-texte-tertiaire">
            {projet && <span className="rounded-2xs bg-fond-surface-grise px-1.5 py-px font-medium text-texte-secondaire">{projet.name}</span>}
            {partage && (
              <span
                ref={vientDePartager ? apparition : undefined}
                title={partage.deMoi ? "Tu l’as partagé avec l’équipe" : `Partagé par ${partage.auteur.nom}`}
                className="rounded-2xs bg-fond-surface-grise px-1.5 py-px font-medium text-texte-secondaire">
                Équipe
              </span>
            )}
            <span>{date.format(new Date(artefact.misAJour ?? artefact.ajouteLe))}</span>
            <span className="ml-auto flex gap-2">
              <button type="button" onClick={modifierAvecAgent} className="cursor-pointer border-0 bg-transparent p-0 text-ui-2xs text-texte-tertiaire underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent">
                Modifier avec un agent
              </button>
              <a href={artefact.url} target="_blank" rel="noreferrer" title="Ouvrir dans le navigateur" className="flex text-texte-tertiaire hover:text-texte-accent">
                <Icon name="link-external" size={14} />
              </a>
            </span>
          </div>
          {retirer && (
            <Confirmation texte="Retirer de la liste ? L’artefact reste sur claude.ai." action="Retirer" onConfirmer={() => supprimerArtefact(artefact.id)} onAnnuler={() => setRetirer(false)} />
          )}
        </div>
      )}
      {fenetrePartage && <ModalePartageArtefact artefact={artefact} partage={partage} onFermer={fermerPartage} onPartage={partageFait} />}
    </li>
  );
}

/* ─── Un rendu d'agent ─────────────────────────────────────────── */

const RENDUS: Record<TypeRendu, { libelle: string; icone: IconName }> = {
  page: { libelle: "Page", icone: "globe-01" },
  image: { libelle: "Image", icone: "image-01" },
  video: { libelle: "Vidéo", icone: "play-01" },
  pdf: { libelle: "PDF", icone: "file-01" },
  document: { libelle: "Document", icone: "file-01" },
};

/** Un fichier publié par un agent (`publier_artefact`) : son aperçu, qui l'a fait, où ; un clic l'ouvre. */
function CarteRendu({ rendu, version }: { rendu: Rendu; version: number }) {
  const bridge = getBridge();
  const projects = useProjects();
  const projet = projects.find((p) => p.id === rendu.projectId);
  const agent = useRole(rendu.roleId);
  const { retirerRendu } = useWorkspace();
  const documents = useDocumentsKlyra();
  const partage = documents.documents.find((d) => d.deMoi && d.origine === rendu.origine) ?? null;
  const { image, carte } = useVignette({ type: "rendu", chemin: rendu.chemin || "vide" }, !!rendu.chemin, version);
  const [retirer, setRetirer] = useState(false);
  const [reprendre, setReprendre] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState<string | null>(null);
  const type = RENDUS[rendu.type];
  const page = rendu.type === "page";

  const ouvrir = () => {
    if (!bridge) return;
    setErreur(null);
    if (rendu.chemin) {
      void bridge.rendus.ouvrir(rendu.chemin).then((r) => !r.ok && setErreur(r.message));
      return;
    }
    const lieu = lieuDuRendu(rendu.origine);
    if (!rendu.distantId || !lieu || !bridge.rendus.ouvrirVps) {
      setErreur("Ce document est sur le serveur : ouvre-le depuis l’espace de ce serveur.");
      return;
    }
    void bridge.rendus.ouvrirVps(lieu, rendu.distantId, rendu.roleId, nomDuFichier(rendu.origine), rendu.dossier === true).then((r) => !r.ok && setErreur(r.message));
  };
  const agir = (action: "ouvrir" | "montrer", chemin = rendu.chemin) => {
    if (!bridge || !chemin) return;
    setErreur(null);
    void bridge.rendus[action](chemin).then((r) => !r.ok && setErreur(r.message));
  };
  const partager = () => {
    if (envoi || documents.etat !== "pret") return;
    const lieu = lieuDuRendu(rendu.origine);
    if (!rendu.chemin && !(rendu.distantId && lieu)) {
      setErreur("Ce document n’est pas dans cet espace.");
      return;
    }
    setErreur(null);
    setEnvoi(true);
    void documents
      .partager({
        chemin: rendu.chemin,
        distant: rendu.chemin || !rendu.distantId || !lieu ? null : { lieu, id: rendu.distantId, dossier: rendu.dossier === true },
        titre: rendu.titre,
        description: rendu.description,
        origine: rendu.origine,
        agent: rendu.roleId,
      })
      .then(
        () => setEnvoi(false),
        (e: unknown) => {
          setEnvoi(false);
          setErreur(e instanceof Error ? e.message : String(e));
        },
      );
  };
  const retirerIci = () => {
    void (async () => {
      if (partage) {
        try {
          await documents.supprimer(partage._id);
        } catch (e) {
          setErreur(e instanceof Error ? e.message : String(e));
          return;
        }
      }
      retirerRendu(rendu.id);
    })();
  };
  /* « Enregistrer dans… » : une copie dans le dossier choisi, celui du projet proposé d'abord. */
  const enregistrer = () => {
    if (!bridge) return;
    setErreur(null);
    void bridge.rendus.enregistrer(rendu.chemin, projet?.folder ?? null).then((r) => {
      if (!r.ok) setErreur(r.message);
      else if (r.data) setEnregistre(r.data);
    });
  };

  return (
    <li
      ref={carte}
      className="group/artefact flex flex-col gap-2 rounded-2xl bg-fond-surface-grise p-2 transition-[box-shadow,translate] duration-[300ms] ease-sortie hover:-translate-y-0.5 hover:shadow-ombre-ambiante"
    >
      <Apercu
        titre={rendu.titre}
        image={image}
        icone={type.icone}
        sansImage={rendu.chemin ? (rendu.type === "page" || rendu.type === "image" ? undefined : type.libelle) : "Sur le serveur"}
        onOuvrir={ouvrir}
      />
      <div className="flex flex-1 flex-col gap-1.5 rounded-lg border border-white bg-fond-surface px-4 py-3 shadow-ombre-sm">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-ui font-semibold text-texte-principal">{rendu.titre}</span>
          <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover/artefact:opacity-100 focus-within:opacity-100">
            {page && documents.etat === "pret" && (
              <BoutonIcone
                taille="mini"
                icone={<Icon name="users-profiles-plus" size={16} />}
                libelle={partage ? "Mettre à jour le partage" : "Partager à l’équipe"}
                onClick={partager}
                className="text-icone-secondaire"
              />
            )}
            {rendu.chemin && <BoutonIcone taille="mini" icone={<Icon name="download-02" size={16} />} libelle="Enregistrer dans un dossier…" onClick={enregistrer} className="text-icone-secondaire" />}
            {rendu.chemin && <BoutonIcone taille="mini" icone={<Icon name="folder-open-01" size={16} />} libelle={`Montrer ${poste.dansExplorateur}`} onClick={() => agir("montrer")} className="text-icone-secondaire" />}
            <BoutonIcone taille="mini" icone={<Icon name="trash-01" size={16} />} libelle="Retirer de la liste" onClick={() => setRetirer(true)} className="text-icone-secondaire" />
          </span>
        </div>
        {rendu.description && <p className="m-0 line-clamp-2 text-ui-s leading-[1.45] text-texte-secondaire">{rendu.description}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-ui-2xs text-texte-tertiaire">
          <span className="flex items-center gap-1.5 font-medium text-texte-secondaire">
            <AgentRond roleId={rendu.roleId} taille={16} fondPastille="surface" />
            {agent.name}
          </span>
          {projet && <span className="rounded-2xs bg-fond-surface-grise px-1.5 py-px font-medium text-texte-secondaire">{projet.name}</span>}
          <span className="rounded-2xs bg-fond-surface-grise px-1.5 py-px font-medium text-texte-secondaire">{type.libelle}</span>
          {partage && <span className="rounded-2xs bg-fond-surface-grise px-1.5 py-px font-medium text-texte-secondaire">Équipe</span>}
          <span className="ml-auto">{date.format(new Date(rendu.misAJour))}</span>
        </div>
        {partage && (
          <button type="button" onClick={() => setReprendre(true)} className="m-0 w-fit cursor-pointer border-0 bg-transparent p-0 text-left text-ui-2xs text-texte-tertiaire underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent">
            Ne plus partager
          </button>
        )}
        {erreur && <p className="m-0 text-ui-xs text-texte-erreur">{erreur}</p>}
        {enregistre && (
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-ui-xs text-texte-secondaire">
            <span className="min-w-0 truncate">Enregistré : {nomDuFichier(enregistre)}</span>
            <button type="button" onClick={() => agir("montrer", enregistre)} className="cursor-pointer border-0 bg-transparent p-0 text-ui-xs text-texte-secondaire underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent">
              Montrer
            </button>
          </p>
        )}
        {reprendre && partage && (
          <Confirmation
            texte="Ne plus partager avec l’équipe ? Le fichier quitte le compte. Il reste dans Mes artefacts de cet espace."
            action="Ne plus partager"
            onConfirmer={() => {
              void documents.reprendre(partage._id).then(
                () => setReprendre(false),
                (e: unknown) => setErreur(e instanceof Error ? e.message : String(e)),
              );
            }}
            onAnnuler={() => setReprendre(false)}
          />
        )}
        {retirer && (
          <Confirmation
            texte={
              partage
                ? "Retirer de la liste ? Le partage quitte le compte. L’original de l’agent reste où il est."
                : rendu.chemin
                  ? "Retirer de la liste ? La copie gardée par KLYRA est supprimée ; l’original de l’agent et ce que tu as enregistré ailleurs restent."
                  : "Retirer de la liste ? Le fichier reste sur le serveur."
            }
            action="Retirer"
            onConfirmer={retirerIci}
            onAnnuler={() => setRetirer(false)}
          />
        )}
      </div>
    </li>
  );
}

/* ─── Une carte de l'équipe ────────────────────────────────────── */

/** Un artefact partagé par un membre : qui l'a partagé le modifie ou le retire, les autres l'ouvrent. */
function CarteEquipe({ artefact, session, version }: { artefact: ArtefactEquipe; session: boolean; version: number }) {
  const equipe = useArtefactsEquipe();
  const { image, carte } = useVignette({ type: "claude", url: artefact.url }, session, version);
  const [edition, setEdition] = useState(false);
  const [titre, setTitre] = useState(artefact.titre);
  const [description, setDescription] = useState(artefact.description);
  const [retirer, setRetirer] = useState(false);
  const [envoi, setEnvoi] = useState<{ enCours: boolean; erreur: string | null }>({ enCours: false, erreur: null });

  const envoyer = async (f: () => Promise<void>, apres: () => void) => {
    setEnvoi({ enCours: true, erreur: null });
    try {
      await f();
      setEnvoi({ enCours: false, erreur: null });
      apres();
    } catch (e) {
      setEnvoi({ enCours: false, erreur: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <li
      ref={carte}
      className="group/artefact flex flex-col gap-2 rounded-2xl bg-fond-surface-grise p-2 transition-[box-shadow,translate] duration-[300ms] ease-sortie hover:-translate-y-0.5 hover:shadow-ombre-ambiante"
    >
      <Apercu titre={artefact.titre} image={image} sansImage={session ? undefined : "Connecte claude.ai pour voir l’aperçu"} onOuvrir={() => ouvrirArtefact(artefact.url, artefact.titre)} />

      {edition ? (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!titre.trim()) return;
            void envoyer(() => equipe.modifier(artefact._id, { titre: titre.trim(), description: description.trim() }), () => setEdition(false));
          }}
          className="flex flex-col gap-3 rounded-lg border border-white bg-fond-surface px-4 py-3 shadow-ombre-sm"
        >
          <Champ label="Titre">
            <Input size="sm" value={titre} maxLength={80} onChange={(e) => setTitre(e.target.value)} className={CHAMP} />
          </Champ>
          <Champ label="À quoi il sert" erreur={envoi.erreur ?? undefined}>
            <Input size="sm" value={description} maxLength={DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} className={CHAMP} />
          </Champ>
          <div className="flex gap-2">
            <Bouton type="submit" variant="sombre" taille="compact" disabled={envoi.enCours}>
              Enregistrer
            </Bouton>
            <Bouton variant="blanc" taille="compact" onClick={() => setEdition(false)}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5 rounded-lg border border-white bg-fond-surface px-4 py-3 shadow-ombre-sm">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-ui font-semibold text-texte-principal">{artefact.titre}</span>
            {artefact.deMoi && (
              <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover/artefact:opacity-100 focus-within:opacity-100">
                <BoutonIcone taille="mini" icone={<Icon name="file-code" size={16} />} libelle="Modifier le titre et la description" onClick={() => setEdition(true)} className="text-icone-secondaire" />
                <BoutonIcone taille="mini" icone={<Icon name="trash-01" size={16} />} libelle="Ne plus partager" onClick={() => setRetirer(true)} className="text-icone-secondaire" />
              </span>
            )}
          </div>
          {artefact.description && <p className="m-0 line-clamp-2 text-ui-s leading-[1.45] text-texte-secondaire">{artefact.description}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-ui-2xs text-texte-tertiaire">
            <span>{artefact.deMoi ? "Partagé par toi" : `Partagé par ${artefact.auteur.nom}`}</span>
            <span>{date.format(new Date(artefact.majLe))}</span>
            <a href={artefact.url} target="_blank" rel="noreferrer" title="Ouvrir dans le navigateur" className="ml-auto flex text-texte-tertiaire hover:text-texte-accent">
              <Icon name="link-external" size={14} />
            </a>
          </div>
          {retirer && (
            <Confirmation
              texte="Ne plus partager avec l’équipe ? L’artefact reste sur claude.ai et dans tes artefacts."
              action="Ne plus partager"
              enCours={envoi.enCours}
              erreur={envoi.erreur}
              onConfirmer={() => void envoyer(() => equipe.retirer(artefact._id), () => setRetirer(false))}
              onAnnuler={() => setRetirer(false)}
            />
          )}
        </div>
      )}
    </li>
  );
}

/** Vignette d'une page partagée. Le HTML ne reste pas dans l'état de la carte. */
function useVignetteDocument(id: string, majLe: number, version: number) {
  const { vignette } = useDocumentsKlyra();
  const cle = `${id}:${majLe}:${version}`;
  /* La vignette vit dans le cache du module : l'état ne sert qu'à redessiner la carte quand elle arrive. */
  const [, redessiner] = useState(0);
  const image = vignettes.get(cle);
  const carte = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (vignettes.has(cle)) return;
    const el = carte.current;
    if (!el) return;
    let vivant = true;
    const observer = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      observer.disconnect();
      void vignette(id, majLe, version > 0).then((v) => {
        vignettes.set(cle, v);
        if (vivant) redessiner((n) => n + 1);
      });
    });
    observer.observe(el);
    return () => {
      vivant = false;
      observer.disconnect();
    };
  }, [vignette, id, majLe, version, cle]);
  return { image, carte };
}

/** Une page HTML partagée depuis cet espace. L'ouverture ne reçoit pas l'adresse Convex. */
function CarteDocument({ document, version }: { document: DocumentKlyra; version: number }) {
  const documents = useDocumentsKlyra();
  const { image, carte } = useVignetteDocument(document._id, document.majLe, version);
  const [reprendre, setReprendre] = useState(false);
  const [ouverture, setOuverture] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<{ enCours: boolean; erreur: string | null }>({ enCours: false, erreur: null });
  const ouvrir = () => {
    setOuverture(null);
    void documents.ouvrir(document._id, document.titre).catch((e: unknown) => setOuverture(e instanceof Error ? e.message : String(e)));
  };
  const envoyer = async () => {
    setEnvoi({ enCours: true, erreur: null });
    try {
      await documents.reprendre(document._id);
      setEnvoi({ enCours: false, erreur: null });
      setReprendre(false);
    } catch (e) {
      setEnvoi({ enCours: false, erreur: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <li ref={carte} className="group/artefact flex flex-col gap-2 rounded-2xl bg-fond-surface-grise p-2 transition-[box-shadow,translate] duration-[300ms] ease-sortie hover:-translate-y-0.5 hover:shadow-ombre-ambiante">
      <Apercu titre={document.titre} image={image} icone="globe-01" onOuvrir={ouvrir} />
      <div className="flex flex-1 flex-col gap-1.5 rounded-lg border border-white bg-fond-surface px-4 py-3 shadow-ombre-sm">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-ui font-semibold text-texte-principal">{document.titre}</span>
        </div>
        {document.description && <p className="m-0 line-clamp-2 text-ui-s leading-[1.45] text-texte-secondaire">{document.description}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-ui-2xs text-texte-tertiaire">
          <span>{document.deMoi ? "Partagé par toi" : `Partagé par ${document.auteur.nom}`}</span>
          <span>{date.format(new Date(document.majLe))}</span>
        </div>
        {ouverture && <p className="m-0 text-ui-xs text-texte-erreur">{ouverture}</p>}
        {document.deMoi && (
          <button type="button" onClick={() => setReprendre(true)} className="m-0 w-fit cursor-pointer border-0 bg-transparent p-0 text-left text-ui-2xs text-texte-tertiaire underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent">
            Ne plus partager
          </button>
        )}
        {reprendre && (
          <Confirmation
            texte="Ne plus partager avec l’équipe ? Le fichier quitte le compte. Il reste dans Mes artefacts de cet espace."
            action="Ne plus partager"
            enCours={envoi.enCours}
            erreur={envoi.erreur}
            onConfirmer={() => void envoyer()}
            onAnnuler={() => setReprendre(false)}
          />
        )}
      </div>
    </li>
  );
}

/** Ce qu'on dit des artefacts de l'équipe quand la liste n'est pas là (onglet Équipe, fenêtre de partage). */
function texteEtatEquipe(etat: EtatArtefactsEquipe, message: string | null): string {
  const textes: Record<EtatArtefactsEquipe, string> = {
    indisponible: "Le compte d’équipe n’est pas disponible sur ce poste.",
    deconnecte: "Connecte-toi à ton compte d’équipe pour voir les artefacts partagés.",
    retire: "Ce compte ne fait plus partie de l’équipe.",
    chargement: "Lecture des artefacts de l’équipe…",
    "hors-ligne": "Hors ligne : les artefacts de l’équipe reviendront avec le réseau.",
    erreur: message ?? "Le serveur de l’équipe ne répond pas.",
    pret: "",
  };
  return textes[etat];
}

/* ─── Ajout à la main ──────────────────────────────────────────── */

function AjoutArtefact({ onFermer }: { onFermer: () => void }) {
  const projects = useProjects();
  const { ajouterArtefact } = useWorkspace();
  const [url, setUrl] = useState("");
  const [titre, setTitre] = useState("");
  const [projectId, setProjectId] = useState("");
  const [essai, setEssai] = useState(false);
  const erreurs = {
    url: LIEN_ARTEFACT.test(url.trim()) ? undefined : "Colle un lien claude.ai/artifact/…",
    titre: titre.trim() ? undefined : "Donne-lui un titre.",
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setEssai(true);
        if (erreurs.url || erreurs.titre) return;
        ajouterArtefact({ url: url.trim(), titre: titre.trim(), description: "", projectId: projectId || null, source: "manuel" });
        onFermer();
      }}
      className="klyra-carte-flottante @container grid grid-cols-1 gap-4 rounded-lg p-5 @2xl:grid-cols-[2fr_1.4fr_1fr_auto] @2xl:items-end"
    >
      <Champ label="Lien" erreur={essai ? erreurs.url : undefined}>
        <Input size="sm" value={url} placeholder="https://claude.ai/artifact/…" onChange={(e) => setUrl(e.target.value)} className={cn(CHAMP, "klyra-mono")} />
      </Champ>
      <Champ label="Titre" erreur={essai ? erreurs.titre : undefined}>
        <Input size="sm" value={titre} onChange={(e) => setTitre(e.target.value)} className={CHAMP} />
      </Champ>
      <Champ label="Projet">
        <ListeDeroulante value={projectId} options={[{ value: "", label: "Aucun" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={setProjectId} />
      </Champ>
      <div className="flex gap-2">
        <Bouton type="submit" variant="sombre" taille="md">
          Ajouter
        </Bouton>
        <Bouton variant="blanc" taille="md" onClick={onFermer}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

/* ─── L'écran ──────────────────────────────────────────────────── */

/** Artefacts : les livrables des agents et, en option, les artefacts claude.ai, en blocs avec leur aperçu ;
 *  et les liens que l'équipe a partagés. */
export function ArtefactsScreen() {
  return (
    <ArtefactsEquipeProvider>
      <DocumentsKlyraProvider>
        <Ecran />
      </DocumentsKlyraProvider>
    </ArtefactsEquipeProvider>
  );
}

/** Une carte de Mes artefacts : un rendu d'agent ou un artefact claude.ai. */
type Element = { type: "rendu"; rendu: Rendu; date: string } | { type: "claude"; artefact: Artefact; date: string };

function texteEtatDocuments(etat: EtatDocuments, message: string | null): string {
  const textes: Record<EtatDocuments, string> = {
    indisponible: "Le compte d’équipe n’est pas disponible sur ce poste.",
    deconnecte: "Connecte-toi à ton compte d’équipe pour voir les pages partagées.",
    retire: "Ce compte ne fait plus partie de l’équipe.",
    chargement: "Lecture des pages partagées…",
    "hors-ligne": "Hors ligne : les pages partagées reviendront avec le réseau.",
    erreur: message ?? "Le serveur de l’équipe ne répond pas.",
    pret: "",
  };
  return textes[etat];
}

function EtatDocuments() {
  const router = useRouter();
  const documents = useDocumentsKlyra();
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <p className="m-0 text-ui-s text-texte-secondaire">{texteEtatDocuments(documents.etat, documents.message)}</p>
      {documents.etat === "deconnecte" && (
        <Bouton variant="sombre" taille="compact" onClick={() => router.push("/reglages?section=equipe")}>
          Me connecter
        </Bouton>
      )}
      {documents.etat === "erreur" && (
        <Bouton variant="blanc" taille="compact" onClick={documents.reessayer}>
          Réessayer
        </Bouton>
      )}
    </div>
  );
}

function Ecran() {
  const bridge = getBridge();
  const equipe = useArtefactsEquipe();
  const documents = useDocumentsKlyra();
  const lieu = useLieuActif();
  const [vue, setVue] = useState<"miens" | "equipe">("miens");
  const { state, synchroniserArtefacts, choisirArtefactsClaude } = useWorkspace();
  const { roles, tous } = useAgents();
  const projects = useProjects();
  const claude = state.artefactsClaude;
  const [ajout, setAjout] = useState(false);
  const [sync, setSync] = useState<{ enCours: boolean; message: string | null; erreur: boolean }>({ enCours: false, message: null, erreur: false });
  const [session, setSession] = useState(false);
  const [version, setVersion] = useState(0);
  const [recherche, setRecherche] = useState("");
  const [filtreProjet, setFiltreProjet] = useState("");
  const [filtreAgent, setFiltreAgent] = useState("");

  useEffect(() => {
    if (!bridge || !claude) return;
    let actif = true;
    void bridge.artefacts.etatSession().then((r) => actif && r.ok && setSession(r.data));
    return () => {
      actif = false;
    };
  }, [bridge, claude]);

  /** Lit le compte claude.ai et rend ce que l'écran doit en dire. `auto` : la lecture faite à l'ouverture
   *  de l'écran, qui ne dit rien quand rien n'est arrivé. */
  const lire = (auto: boolean) => {
    derniereSynchro = Date.now();
    return synchroniserArtefacts().then(
      ({ total, nouveaux }) => ({
        enCours: false,
        message: auto && !nouveaux ? null : `${total} artefact${total > 1 ? "s" : ""} sur ton compte claude.ai · ${nouveaux} nouveau${nouveaux > 1 ? "x" : ""}.`,
        erreur: false,
      }),
      (e: unknown) => ({ enCours: false, message: e instanceof Error ? e.message : String(e), erreur: true }),
    );
  };

  const synchroniser = () => {
    setSync({ enCours: true, message: null, erreur: false });
    void lire(false).then(setSync);
  };

  /* À l'ouverture de l'écran (ou dès que l'app a lu ses données, si l'écran s'ouvre avant), au plus toutes les 10 minutes. */
  useEffect(() => {
    if (!bridge || !claude || !state.charge || Date.now() - derniereSynchro <= INTERVALLE_SYNCHRO_MS) return;
    derniereSynchro = Date.now();
    void Promise.resolve()
      .then(() => setSync({ enCours: true, message: null, erreur: false }))
      .then(() => lire(true))
      .then(setSync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, claude, state.charge]);

  const activerClaude = (actif: boolean) => {
    choisirArtefactsClaude(actif);
    setAjout(false);
    setSync({ enCours: false, message: null, erreur: false });
    if (actif && bridge) synchroniser();
  };

  const connecter = async () => {
    if (!bridge) return;
    const r = await bridge.artefacts.connecter();
    if (r.ok) {
      setSession(r.data);
      if (r.data) setVersion((v) => v + 1);
    }
  };

  const nomAgent = (id: string) => (roles.find((r) => r.id === id) ?? tous.find((a) => a.role.id === id)?.role)?.name ?? id;
  const rendusIci = useMemo(() => state.rendus.filter((r) => renduDansEspace(r.origine, lieu)), [state.rendus, lieu]);
  const elements = useMemo<Element[]>(() => {
    const q = recherche.trim().toLowerCase();
    const rendus = rendusIci
      .filter((r) => !filtreAgent || r.roleId === filtreAgent)
      .map((r): Element => ({ type: "rendu", rendu: r, date: r.misAJour }));
    const liens = claude && !filtreAgent && lieu === null ? state.artefacts.map((a): Element => ({ type: "claude", artefact: a, date: a.misAJour ?? a.ajouteLe })) : [];
    return [...rendus, ...liens]
      .filter((e) => !filtreProjet || (e.type === "rendu" ? e.rendu.projectId : e.artefact.projectId) === filtreProjet)
      .filter((e) => {
        if (!q) return true;
        const texte = e.type === "rendu" ? `${e.rendu.titre} ${e.rendu.description} ${nomAgent(e.rendu.roleId)}` : `${e.artefact.titre} ${e.artefact.description} claude.ai`;
        return texte.toLowerCase().includes(q);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendusIci, state.artefacts, claude, lieu, recherche, filtreProjet, filtreAgent, roles, tous]);
  const totalMiens = rendusIci.length + (claude && lieu === null ? state.artefacts.length : 0);
  const agentsDesRendus = [...new Set(rendusIci.map((r) => r.roleId))];

  const visiblesEquipe = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return lieu === null ? equipe.artefacts.filter((a) => !q || `${a.titre} ${a.description} ${a.auteur.nom}`.toLowerCase().includes(q)) : [];
  }, [equipe.artefacts, recherche, lieu]);
  const visiblesDocuments = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return documents.documents.filter((d) => !q || `${d.titre} ${d.description} ${d.auteur.nom}`.toLowerCase().includes(q));
  }, [documents.documents, recherche]);
  const nombreEquipe = (documents.etat === "pret" ? visiblesDocuments.length : 0) + visiblesEquipe.length;
  const nombre = vue === "miens" ? elements.length : nombreEquipe;
  const nomEspace = lieu ? hoteDe(lieu) : "Ce PC";

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
              <span className="font-semibold">Artefacts</span> <span className="font-normal">du studio</span>
            </h1>
            <p className="m-0 text-ui-s text-texte-secondaire">
              {vue === "miens" ? "Ce que tes agents ont produit : pages, maquettes, captures, vidéos, documents." : "Ce que l’équipe a partagé depuis cet espace."}
            </p>
            <p className="m-0 text-ui-2xs text-texte-tertiaire">
              {nomEspace}
              {documents.espace ? ` · ${texteEspace(documents.espace.octets, documents.espace.complet)}` : ""}
            </p>
          </div>
          {claude && lieu === null && vue === "miens" && (
            <div className="flex flex-wrap items-center gap-2">
              <Bouton variant="blanc" taille="md" onClick={() => setAjout(true)} disabled={ajout}>
                Ajouter un lien
              </Bouton>
              <BoutonPrincipal onClick={synchroniser} disabled={sync.enCours || !bridge}>
                {sync.enCours ? "Lecture de claude.ai…" : "Relire claude.ai"}
              </BoutonPrincipal>
            </div>
          )}
        </header>

        {claude && lieu === null && vue === "miens" && (sync.message || (bridge && !session)) && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bordure-subtile bg-fond-page px-4 py-3">
            {sync.message && <span className={cn("text-ui-s", sync.erreur ? "text-texte-erreur" : "text-texte-principal")}>{sync.message}</span>}
            {bridge && !session && (
              <>
                <span className="flex-1 text-ui-s text-texte-secondaire">Pour voir l’aperçu des artefacts claude.ai, connecte claude.ai une fois dans l’app.</span>
                <Bouton variant="sombre" taille="compact" onClick={() => void connecter()}>
                  Connecter claude.ai
                </Bouton>
              </>
            )}
          </div>
        )}

        {ajout && <AjoutArtefact onFermer={() => setAjout(false)} />}

        <section aria-label="Artefacts" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Onglets
              libelle="Artefacts"
              valeur={vue}
              onChange={setVue}
              onglets={[
                { id: "miens", label: "Mes artefacts", icone: <Icon name="user-profile-01" size={16} />, nombre: totalMiens },
                { id: "equipe", label: "Équipe", icone: <Icon name="users-profiles-01" size={16} />, nombre: documents.etat === "pret" || visiblesEquipe.length > 0 ? nombreEquipe : undefined },
              ]}
            />
            <div className="w-[260px] max-w-full">
              <Input size="sm" placeholder="Chercher un artefact…" value={recherche} onChange={(e) => setRecherche(e.target.value)} className={CHAMP} />
            </div>
            {vue === "miens" && agentsDesRendus.length > 1 && (
              <div className="w-[200px]">
                <ListeDeroulante libelle="Filtrer par agent" value={filtreAgent} options={[{ value: "", label: "Tous les agents" }, ...agentsDesRendus.map((id) => ({ value: id, label: nomAgent(id), icone: <AgentRond roleId={id} taille={20} /> }))]} onChange={setFiltreAgent} />
              </div>
            )}
            {vue === "miens" && projects.length > 0 && (
              <div className="w-[200px]">
                <ListeDeroulante libelle="Filtrer par projet" value={filtreProjet} options={[{ value: "", label: "Tous les projets" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={setFiltreProjet} />
              </div>
            )}
            <span className="ml-auto text-ui-xs text-texte-tertiaire">{nombre} artefact{nombre > 1 ? "s" : ""}</span>
            <BoutonIcone taille="compact" icone={<Icon name="refresh-01" size={16} />} libelle="Refaire les aperçus" onClick={() => { vignettes.clear(); setVersion((v) => v + 1); }} className="text-icone-secondaire" />
          </div>
          {vue === "equipe" ? (
            documents.etat !== "pret" && visiblesEquipe.length === 0 ? (
              <EtatDocuments />
            ) : nombreEquipe ? (
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
                {documents.etat === "pret" && visiblesDocuments.map((d) => <CarteDocument key={`${d._id}-${version}`} document={d} version={version} />)}
                {visiblesEquipe.map((a) => (
                  <CarteEquipe key={`${a._id}-${version}`} artefact={a} session={session} version={version} />
                ))}
              </ul>
            ) : (
              <p className="m-0 p-4 text-ui-s text-texte-secondaire">
                {documents.documents.length || equipe.artefacts.length
                  ? "Aucun artefact ne correspond."
                  : lieu
                    ? "Rien de partagé pour l’instant : dans Mes artefacts de ce serveur, « Partager à l’équipe » envoie une page HTML."
                    : "Rien de partagé pour l’instant : dans Mes artefacts, « Partager à l’équipe » envoie une page HTML, ou partage un lien claude.ai."}
              </p>
            )
          ) : elements.length ? (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
              {elements.map((e) =>
                e.type === "rendu" ? (
                  <CarteRendu key={`${e.rendu.id}-${version}`} rendu={e.rendu} version={version} />
                ) : (
                  <CarteArtefact key={`${e.artefact.id}-${version}`} artefact={e.artefact} session={session} version={version} />
                ),
              )}
            </ul>
          ) : (
            <p className="m-0 p-4 text-ui-s text-texte-secondaire">
              {totalMiens ? "Aucun artefact ne correspond." : "Rien pour l’instant : quand un agent livre une page, une maquette, une capture ou une vidéo, elle arrive ici."}
            </p>
          )}

          {vue === "miens" && lieu === null && bridge && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-fond-surface-grise px-4 py-3">
              <Icon name="link" size={16} className="text-icone-secondaire" />
              <span className="flex-1 text-ui-s text-texte-secondaire">
                {claude ? "Tes artefacts claude.ai sont dans cette liste." : "Tu publies aussi des artefacts sur claude.ai ? Ajoute-les à cette liste."}
              </span>
              <Bouton variant={claude ? "blanc" : "sombre"} taille="compact" onClick={() => activerClaude(!claude)}>
                {claude ? "Ne plus les montrer" : "Ajouter mes artefacts claude.ai"}
              </Bouton>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
