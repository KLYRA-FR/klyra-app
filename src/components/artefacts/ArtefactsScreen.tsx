"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import type { IconName } from "@/components/icons/icon-data";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { Onglets } from "@/components/ui/Onglets";
import { ArtefactsEquipeProvider, useArtefactsEquipe, type ArtefactEquipe } from "@/lib/artefacts-equipe";
import { useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { poste } from "@/lib/plateforme";
import { idDirect, useProjects, useRole, useWorkspace } from "@/lib/workspace";
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
function Apercu({ titre, image, sansImage, icone = "layers-01", onOuvrir }: {
  titre: string;
  image: string | null | undefined;
  /** Ce que dit la carte sans vignette (sinon « Aperçu… » puis « Aperçu indisponible »). */
  sansImage?: string;
  icone?: IconName;
  onOuvrir: () => void;
}) {
  return (
    <button
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
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-fond-page p-2.5">
      <span className="flex-1 text-ui-xs text-texte-principal">{texte}</span>
      <Bouton variant="sombre" taille="compact" onClick={onConfirmer} disabled={enCours}>
        {action}
      </Bouton>
      <Bouton variant="blanc" taille="compact" onClick={onAnnuler}>
        Annuler
      </Bouton>
      {erreur && <span className="w-full text-ui-xs text-texte-erreur">{erreur}</span>}
    </div>
  );
}

/* ─── Une carte ────────────────────────────────────────────────── */

function CarteArtefact({ artefact, session, version }: { artefact: Artefact; session: boolean; version: number }) {
  const router = useRouter();
  const projects = useProjects();
  const projet = projects.find((p) => p.id === artefact.projectId);
  const { modifierArtefact, supprimerArtefact } = useWorkspace();
  const { image, carte } = useVignette({ type: "claude", url: artefact.url }, session, version);
  const [edition, setEdition] = useState(false);
  const [titre, setTitre] = useState(artefact.titre);
  const [description, setDescription] = useState(artefact.description);
  const [projectId, setProjectId] = useState(artefact.projectId ?? "");
  const [retirer, setRetirer] = useState(false);
  const equipe = useArtefactsEquipe();
  const lien = lienArtefact(artefact.url);
  const partage = equipe.artefacts.find((a) => a.url === lien);
  const [partager, setPartager] = useState<{ enCours: boolean; erreur: string | null } | null>(null);

  const ouvrir = () => ouvrirArtefact(artefact.url, artefact.titre);
  const confirmerPartage = async () => {
    setPartager({ enCours: true, erreur: null });
    try {
      await equipe.partager({ url: artefact.url, titre: artefact.titre, description: artefact.description.slice(0, DESCRIPTION_MAX) });
      setPartager(null);
    } catch (e) {
      setPartager({ enCours: false, erreur: e instanceof Error ? e.message : String(e) });
    }
  };
  const modifierAvecAgent = () => {
    const brouillon = `Modifie l’artefact « ${artefact.titre} » (${artefact.url}) : `;
    router.push(`/chat?id=${idDirect("principal")}&brouillon=${encodeURIComponent(brouillon)}`);
  };

  return (
    /* Comme les cartes d'agents : un bloc gris, l'aperçu en haut, les infos dans un bloc blanc en dessous. */
    <li
      ref={carte}
      className="group/artefact flex flex-col gap-2 rounded-2xl bg-fond-surface-grise p-2 transition-[box-shadow,translate] duration-[300ms] ease-sortie hover:-translate-y-0.5 hover:shadow-ombre-ambiante"
    >
      <Apercu titre={artefact.titre} image={image} sansImage={session ? undefined : "Connecte claude.ai pour voir l’aperçu"} onOuvrir={ouvrir} />

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
                <BoutonIcone taille="mini" icone={<Icon name="users-profiles-plus" size={16} />} libelle="Partager avec l’équipe" onClick={() => setPartager({ enCours: false, erreur: null })} className="text-icone-secondaire" />
              )}
              <BoutonIcone taille="mini" icone={<Icon name="file-code" size={16} />} libelle="Modifier le titre et la description" onClick={() => setEdition(true)} className="text-icone-secondaire" />
              <BoutonIcone taille="mini" icone={<Icon name="trash-01" size={16} />} libelle="Retirer de la liste" onClick={() => setRetirer(true)} className="text-icone-secondaire" />
            </span>
          </div>
          {artefact.description && <p className="m-0 line-clamp-2 text-ui-s leading-[1.45] text-texte-secondaire">{artefact.description}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-ui-2xs text-texte-tertiaire">
            {projet && <span className="rounded-2xs bg-fond-surface-grise px-1.5 py-px font-medium text-texte-secondaire">{projet.name}</span>}
            {partage && (
              <span title={partage.deMoi ? "Tu l’as partagé avec l’équipe" : `Partagé par ${partage.auteur.nom}`} className="rounded-2xs bg-fond-surface-grise px-1.5 py-px font-medium text-texte-secondaire">
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
          {partager && (
            <Confirmation
              texte="Partager avec l’équipe ? Chacun verra ce lien dans l’onglet Équipe ; pour l’ouvrir, il faut aussi que l’artefact soit partagé sur claude.ai."
              action="Partager"
              enCours={partager.enCours}
              erreur={partager.erreur}
              onConfirmer={() => void confirmerPartage()}
              onAnnuler={() => setPartager(null)}
            />
          )}
        </div>
      )}
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
  const { image, carte } = useVignette({ type: "rendu", chemin: rendu.chemin }, true, version);
  const [retirer, setRetirer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const type = RENDUS[rendu.type];

  const agir = (action: "ouvrir" | "montrer") => {
    if (!bridge) return;
    setErreur(null);
    void bridge.rendus[action](rendu.chemin).then((r) => !r.ok && setErreur(r.message));
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
        sansImage={rendu.type === "page" || rendu.type === "image" ? undefined : type.libelle}
        onOuvrir={() => agir("ouvrir")}
      />
      <div className="flex flex-1 flex-col gap-1.5 rounded-lg border border-white bg-fond-surface px-4 py-3 shadow-ombre-sm">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-ui font-semibold text-texte-principal">{rendu.titre}</span>
          <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover/artefact:opacity-100 focus-within:opacity-100">
            <BoutonIcone taille="mini" icone={<Icon name="folder-open-01" size={16} />} libelle={`Montrer ${poste.dansExplorateur}`} onClick={() => agir("montrer")} className="text-icone-secondaire" />
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
          <span className="ml-auto">{date.format(new Date(rendu.misAJour))}</span>
        </div>
        {erreur && <p className="m-0 text-ui-xs text-texte-erreur">{erreur}</p>}
        {retirer && (
          <Confirmation texte="Retirer de la liste ? Le fichier reste où il est." action="Retirer" onConfirmer={() => retirerRendu(rendu.id)} onAnnuler={() => setRetirer(false)} />
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

/** Ce que l'onglet Équipe dit quand la liste n'est pas là. */
function EtatEquipe() {
  const router = useRouter();
  const equipe = useArtefactsEquipe();
  const textes: Record<string, string> = {
    indisponible: "Le compte d’équipe n’est pas disponible sur ce poste.",
    deconnecte: "Connecte-toi à ton compte d’équipe pour voir les artefacts partagés.",
    retire: "Ce compte ne fait plus partie de l’équipe.",
    chargement: "Lecture des artefacts de l’équipe…",
    "hors-ligne": "Hors ligne : les artefacts de l’équipe reviendront avec le réseau.",
    erreur: equipe.message ?? "Le serveur de l’équipe ne répond pas.",
  };
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <p className="m-0 text-ui-s text-texte-secondaire">{textes[equipe.etat]}</p>
      {equipe.etat === "deconnecte" && (
        <Bouton variant="sombre" taille="compact" onClick={() => router.push("/reglages?section=equipe")}>
          Me connecter
        </Bouton>
      )}
      {equipe.etat === "erreur" && (
        <Bouton variant="blanc" taille="compact" onClick={equipe.reessayer}>
          Réessayer
        </Bouton>
      )}
    </div>
  );
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

/** Artefacts : les pages publiées par Claude, en blocs avec leur aperçu ; les siennes (synchronisées avec
 *  le compte Claude) et celles que l'équipe a partagées. */
export function ArtefactsScreen() {
  return (
    <ArtefactsEquipeProvider>
      <Ecran />
    </ArtefactsEquipeProvider>
  );
}

/** Une carte de Mes artefacts : un rendu d'agent ou un artefact claude.ai. */
type Element = { type: "rendu"; rendu: Rendu; date: string } | { type: "claude"; artefact: Artefact; date: string };

function Ecran() {
  const bridge = getBridge();
  const equipe = useArtefactsEquipe();
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
  const elements = useMemo<Element[]>(() => {
    const q = recherche.trim().toLowerCase();
    const rendus = state.rendus
      .filter((r) => !filtreAgent || r.roleId === filtreAgent)
      .map((r): Element => ({ type: "rendu", rendu: r, date: r.misAJour }));
    const liens = claude && !filtreAgent ? state.artefacts.map((a): Element => ({ type: "claude", artefact: a, date: a.misAJour ?? a.ajouteLe })) : [];
    return [...rendus, ...liens]
      .filter((e) => !filtreProjet || (e.type === "rendu" ? e.rendu.projectId : e.artefact.projectId) === filtreProjet)
      .filter((e) => {
        if (!q) return true;
        const texte = e.type === "rendu" ? `${e.rendu.titre} ${e.rendu.description} ${nomAgent(e.rendu.roleId)}` : `${e.artefact.titre} ${e.artefact.description} claude.ai`;
        return texte.toLowerCase().includes(q);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rendus, state.artefacts, claude, recherche, filtreProjet, filtreAgent, roles, tous]);
  const totalMiens = state.rendus.length + (claude ? state.artefacts.length : 0);
  const agentsDesRendus = [...new Set(state.rendus.map((r) => r.roleId))];

  const visiblesEquipe = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return equipe.artefacts.filter((a) => !q || `${a.titre} ${a.description} ${a.auteur.nom}`.toLowerCase().includes(q));
  }, [equipe.artefacts, recherche]);
  const nombre = vue === "miens" ? elements.length : visiblesEquipe.length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
              <span className="font-semibold">Artefacts</span> <span className="font-normal">du studio</span>
            </h1>
            <p className="m-0 text-ui-s text-texte-secondaire">
              {vue === "miens" ? "Ce que tes agents ont produit : pages, maquettes, captures, vidéos, documents." : "Les liens que l’équipe partage : chacun y ajoute les siens depuis Mes artefacts."}
            </p>
          </div>
          {claude && vue === "miens" && (
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

        {claude && vue === "miens" && (sync.message || (bridge && !session)) && (
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
                { id: "equipe", label: "Équipe", icone: <Icon name="users-profiles-01" size={16} />, nombre: equipe.etat === "pret" ? equipe.artefacts.length : undefined },
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
            equipe.etat !== "pret" ? (
              <EtatEquipe />
            ) : visiblesEquipe.length ? (
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
                {visiblesEquipe.map((a) => (
                  <CarteEquipe key={`${a._id}-${version}`} artefact={a} session={session} version={version} />
                ))}
              </ul>
            ) : (
              <p className="m-0 p-4 text-ui-s text-texte-secondaire">
                {equipe.artefacts.length ? "Aucun artefact ne correspond." : "Rien de partagé pour l’instant : dans Mes artefacts, partage un lien claude.ai avec l’équipe."}
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

          {vue === "miens" && bridge && (
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
