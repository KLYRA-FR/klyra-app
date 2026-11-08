"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Input, Textarea } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { Onglets } from "@/components/ui/Onglets";
import { getBridge } from "@/lib/bridge";
import { lieuParDefaut, nomLieu, useLieuActif, useServeursRelies } from "@/lib/lieux";
import { cn } from "@/lib/cn";
import { emplacementProjet } from "@/lib/depot-projet";
import { formatListDate } from "@/lib/format";
import { identifiantProjet } from "@/lib/projet-depuis-depot";
import { poste } from "@/lib/plateforme";
import { useProjects, useWorkspace } from "@/lib/workspace";
import type { Project, ProjectStatus } from "@/types/domain";

import { useMenuProjet } from "./MenuProjet";
import { SelecteurDepotGithub } from "./SelecteurDepotGithub";

const STATUTS: { value: ProjectStatus; label: string }[] = [
  { value: "en-cours", label: "En cours" },
  { value: "en-revue", label: "En revue" },
  { value: "livre", label: "Livré" },
];

/** Les projets d'un VPS vivent sous le dossier de l'utilisateur klyra (serveur/lancer.sh, serveur/fichiers.mjs). */
const RACINE_VPS = "/var/lib/klyra/projets";

/** D'où vient un nouveau projet : un dépôt GitHub que l'app clone, ou un dossier déjà là. */
type Source = "github" | "dossier";

/**
 * Ajouter un projet. Depuis GitHub (par défaut quand l'app de bureau le permet) : la liste des dépôts, un clic
 * et le projet s'ouvre, rien à remplir. Depuis un dossier : le dossier et son nom, rien d'autre.
 * Statut, épingle, brief et aperçu se règlent ensuite (clic droit, « Modifier »).
 */
function NouveauProjet({ onFini }: { onFini: (id: string | null) => void }) {
  // Tous les projets, de toutes les machines : un identifiant reste unique (le même dépôt sur le PC et un VPS).
  const { enregistrerProjet, state } = useWorkspace();
  const projects = state.projects;
  const bridge = getBridge();
  // Un nouveau projet va dans l'espace affiché, celui du serveur choisi.
  const [lieu] = useState<string | null>(() => lieuParDefaut());
  const serveurs = useServeursRelies();
  const clonable = !!bridge?.github;
  const [source, setSource] = useState<Source>(clonable ? "github" : "dossier");

  const ouvert = (projet: Project, existant: boolean) => {
    if (!existant) enregistrerProjet(projet);
    onFini(projet.id);
  };

  return (
    <section aria-label="Nouveau projet" data-nouveau-projet className="klyra-carte-flottante @container flex flex-col gap-5 rounded-lg p-5">
      <div className="flex flex-wrap items-center gap-3">
        {clonable && (
          <Onglets<Source>
            libelle="D’où vient le projet"
            onglets={[
              { id: "github", label: "Dépôt GitHub", icone: <Icon name="git-branch-01" size={16} /> },
              { id: "dossier", label: lieu ? "Dossier du VPS" : `Dossier de ${poste.ce}`, icone: <Icon name="folder-open-01" size={16} /> },
            ]}
            valeur={source}
            onChange={setSource}
          />
        )}
        {(serveurs.length > 0 || lieu) && (
          <span className="text-ui-xs text-texte-tertiaire">Sur {nomLieu(lieu, serveurs)} : ses conversations y tournent, ses fichiers y vivent.</span>
        )}
        <Bouton variant="discret" taille="compact" className="ml-auto" onClick={() => onFini(null)}>
          Annuler
        </Bouton>
      </div>
      {source === "github" && clonable ? (
        <SelecteurDepotGithub lieu={lieu} projets={projects} onOuvert={ouvert} />
      ) : (
        <FormulaireDossier lieu={lieu} onFini={onFini} />
      )}
    </section>
  );
}

/** Un dossier déjà sur la machine : le choisir (ou son chemin sur le VPS), son nom tiré du dossier. */
function FormulaireDossier({ lieu, onFini }: { lieu: string | null; onFini: (id: string | null) => void }) {
  const { enregistrerProjet, state } = useWorkspace();
  const projects = state.projects;
  const bridge = getBridge();
  const surVps = !!lieu;
  const [folder, setFolder] = useState(() => (lieu ? `${RACINE_VPS}/projet` : ""));
  const [name, setName] = useState("");
  const [essai, setEssai] = useState(false);
  const [erreurVps, setErreurVps] = useState<string | null>(null);

  const choisir = async () => {
    if (!bridge) return;
    const r = await bridge.projets.choisirDossier();
    if (!r.ok || !r.data) return;
    setFolder(r.data);
    // Le nom du dossier en guise de nom, s'il n'y en a pas encore (chemin Windows compris).
    if (!name.trim()) setName(r.data.split(/[\\/]/).filter(Boolean).pop() ?? "");
  };

  const erreurs = {
    folder: surVps
      ? folder.startsWith(`${RACINE_VPS}/`)
        ? undefined
        : `Sur le VPS, un projet vit sous ${RACINE_VPS}/.`
      : folder
        ? undefined
        : `Choisis le dossier du projet sur ${poste.ton}.`,
    name: name.trim() || (surVps && folder.split("/").filter(Boolean).pop()) ? undefined : "Donne-lui un nom.",
  };

  const ajouter = async (e: FormEvent) => {
    e.preventDefault();
    setEssai(true);
    if (erreurs.folder || erreurs.name) return;
    if (lieu && bridge?.projets.creerDossierVps) {
      setErreurVps(null);
      const r = await bridge.projets.creerDossierVps(lieu, folder);
      if (!r.ok) return setErreurVps(r.message);
    }
    const nom = name.trim() || folder.split("/").filter(Boolean).pop() || "Projet";
    const project: Project = {
      id: identifiantProjet(nom, projects),
      name: nom,
      subtitle: "",
      brief: "",
      previewUrl: "",
      status: "en-cours",
      pinned: false,
      folder,
      ...(lieu ? { lieu } : {}),
      roleIds: ["principal"],
      files: [],
      updatedAt: new Date().toISOString(),
    };
    enregistrerProjet(project);
    onFini(project.id);
  };

  return (
    <form onSubmit={(e) => void ajouter(e)} className="flex flex-col gap-4">
      {surVps ? (
        <Champ label="Dossier sur le VPS" erreur={essai ? (erreurs.folder ?? erreurVps ?? undefined) : undefined} aide="Créé s’il n’existe pas. Les agents du VPS y travaillent.">
          <Input size="sm" value={folder} onChange={(e) => setFolder(e.target.value.trim())} className={cn(CHAMP, "klyra-mono")} />
        </Champ>
      ) : (
        <Champ label="Dossier" erreur={essai ? erreurs.folder : undefined} aide={bridge ? "Les agents travaillent dans ce dossier : ils y lisent et y modifient les fichiers." : "Choisir un dossier marche dans l’app de bureau."}>
          <div className="flex flex-wrap items-center gap-2">
            <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="folder-open-01" size={20} />} onClick={() => void choisir()} disabled={!bridge}>
              {folder ? "Changer de dossier" : "Choisir le dossier…"}
            </Bouton>
            {folder && <span className="klyra-mono min-w-0 text-ui-xs text-texte-secondaire [overflow-wrap:anywhere]">{emplacementProjet(folder, null, "")}</span>}
          </div>
        </Champ>
      )}
      <Champ label="Nom" erreur={essai ? erreurs.name : undefined} aide={surVps ? undefined : "Repris du dossier ; modifiable plus tard."}>
        <Input size="sm" value={name} placeholder="Nom du projet" onChange={(e) => setName(e.target.value)} className={CHAMP} />
      </Champ>
      <BoutonPrincipal type="submit" className="self-start">
        Ajouter le projet
      </BoutonPrincipal>
    </form>
  );
}

/** Modifier un projet : son nom, ce qu'il est, l'adresse de son aperçu, son statut. Le dossier ne change pas. */
function FormulaireProjet({ initial, onFini }: { initial: Project; onFini: (id: string | null) => void }) {
  const { enregistrerProjet } = useWorkspace();
  const serveurs = useServeursRelies();
  const [name, setName] = useState(initial.name);
  const [subtitle, setSubtitle] = useState(initial.subtitle);
  const [brief, setBrief] = useState(initial.brief);
  const [previewUrl, setPreviewUrl] = useState(initial.previewUrl);
  const [status, setStatus] = useState<ProjectStatus>(initial.status);
  const [pinned, setPinned] = useState(initial.pinned);
  const [essai, setEssai] = useState(false);
  const erreurNom = name.trim() ? undefined : "Donne-lui un nom.";

  const enregistrer = (e: FormEvent) => {
    e.preventDefault();
    setEssai(true);
    if (erreurNom) return;
    enregistrerProjet({
      ...initial,
      name: name.trim(),
      subtitle: subtitle.trim(),
      brief: brief.trim(),
      // http:// se lit sans schéma (serveur de dev) ; https:// reste, sinon l'aperçu repartirait en http.
      previewUrl: previewUrl.trim().replace(/^http:\/\//, ""),
      status,
      pinned,
      updatedAt: new Date().toISOString(),
    });
    onFini(initial.id);
  };

  return (
    <form onSubmit={enregistrer} className="klyra-carte-flottante @container flex flex-col gap-5 rounded-lg p-5">
      <Champ label="Emplacement" aide={initial.depot ? `Dépôt GitHub ${initial.depot}. Un projet reste sur sa machine et dans son dossier.` : "Un projet reste sur sa machine et dans son dossier."}>
        <p title={initial.folder} className={cn("m-0 text-ui-s text-texte-principal [overflow-wrap:anywhere]", !initial.lieu && "klyra-mono")}>
          {emplacementProjet(initial.folder, initial.lieu, nomLieu(initial.lieu, serveurs))}
        </p>
      </Champ>
      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <Champ label="Nom" erreur={essai ? erreurNom : undefined}>
          <Input size="sm" value={name} placeholder="Nom du projet" onChange={(e) => setName(e.target.value)} className={CHAMP} />
        </Champ>
        <Champ label="En une ligne">
          <Input size="sm" value={subtitle} placeholder="Refonte du site" onChange={(e) => setSubtitle(e.target.value)} className={CHAMP} />
        </Champ>
        <Champ label="Brief" aide="Ce que les agents doivent savoir du projet : le client, l’objectif, l’échéance. Pour le code, préfère l’AGENTS.md du projet." className="@2xl:col-span-2">
          <Textarea
            size="sm"
            autoGrow
            value={brief}
            placeholder="Refonte du site : hero plus aérée, nouvelle page offres. Mise en ligne prévue le 24 octobre."
            onChange={(e) => setBrief(e.target.value)}
            className={cn(CHAMP, "min-h-[72px]")}
          />
        </Champ>
        <Champ label="Aperçu" aide="L’adresse du site, ou de son serveur de dev.">
          <Input size="sm" value={previewUrl} placeholder="localhost:3002" onChange={(e) => setPreviewUrl(e.target.value)} className={cn(CHAMP, "klyra-mono")} />
        </Champ>
        <Champ label="Statut">
          <ListeDeroulante value={status} options={STATUTS} onChange={setStatus} />
        </Champ>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 self-start text-ui-s text-texte-principal">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-4 accent-bleu-k1-500" />
        Épingler : la marque du projet est pleine dans le menu
      </label>

      <div className="flex flex-wrap gap-2">
        <BoutonPrincipal type="submit">Enregistrer</BoutonPrincipal>
        <Bouton variant="blanc" taille="md" onClick={() => onFini(null)}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

/** Projets : ceux de cette personne, chacun lié à un dossier de son Mac. */
export function ProjetsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const projects = useProjects();
  const { state } = useWorkspace();
  const lieu = useLieuActif();
  const serveurs = useServeursRelies();
  const aModifier = projects.find((p) => p.id === params.get("modifier")) ?? null;
  const formulaire = params.has("nouveau") || !!aModifier;
  const { ouvrirMenu, menuProjet } = useMenuProjet();

  const fermer = (id: string | null) => router.push(id ? `/projet?id=${id}` : "/projets");

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
              <span className="font-semibold">{aModifier ? aModifier.name : "Projets"}</span>{" "}
              <span className="font-normal">{aModifier ? "· modifier" : `sur ${lieu ? nomLieu(lieu, serveurs) : poste.ce}`}</span>
            </h1>
            <p className="m-0 text-ui-s text-texte-secondaire">
              Ouvre un dépôt GitHub ou un dossier de {poste.ton} pour parcourir ton code et laisser les agents y travailler.
            </p>
          </div>
          {!formulaire && <BoutonPrincipal href="/projets?nouveau=1">Nouveau projet</BoutonPrincipal>}
        </header>

        {aModifier ? <FormulaireProjet key={aModifier.id} initial={aModifier} onFini={fermer} /> : formulaire && <NouveauProjet onFini={fermer} />}

        {!aModifier && (
          <section aria-label="Projets" className="rounded-3xl border border-bordure-subtile bg-fond-page p-3">
            {projects.length ? (
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2 p-0">
                {projects.map((p) => {
                  const chats = state.chats.filter((c) => c.projectId === p.id).length;
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/projet?id=${p.id}`}
                        onContextMenu={(e) => ouvrirMenu(e, p)}
                        className="klyra-carte-flottante flex h-full flex-col gap-2 rounded-lg p-4 no-underline"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={cn("size-2 shrink-0 rounded-[1px]", p.pinned ? "bg-bleu-k1-500" : "border-[1.25px] border-gris-k1-300")}
                          />
                          <span className="truncate text-ui font-semibold text-texte-principal">{p.name}</span>
                        </span>
                        {p.subtitle && <span className="text-ui-s text-texte-secondaire">{p.subtitle}</span>}
                        <span title={p.folder} className={cn("truncate text-ui-2xs text-texte-tertiaire", !p.depot && !p.lieu && "klyra-mono")}>
                          {p.depot ?? emplacementProjet(p.folder, p.lieu, nomLieu(p.lieu, serveurs))}
                        </span>
                        <span className="mt-auto pt-1 text-ui-2xs text-texte-tertiaire">
                          {chats} chat{chats > 1 ? "s" : ""} · modifié {formatListDate(p.updatedAt).toLowerCase()}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              !formulaire && (
                <div className="flex flex-col items-start gap-4 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="m-0 text-ui font-semibold text-texte-principal">Ajoute ton premier projet</p>
                    <p className="m-0 text-ui-s text-texte-secondaire">Choisis un de tes dépôts GitHub, ou le dossier d’un site ou d’une app : là où est ton code.</p>
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0 text-ui-s text-texte-secondaire">
                    <li className="flex items-center gap-2">
                      <Icon name="folder-open-01" size={16} className="text-texte-principal" />
                      <span>
                        <span className="font-semibold text-texte-principal">Parcours tes fichiers</span>, comme dans un éditeur de code
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Icon name="message-square" size={16} className="text-texte-principal" />
                      <span>
                        <span className="font-semibold text-texte-principal">Écris à un agent</span> depuis le projet : il lit et modifie ton code pour toi
                      </span>
                    </li>
                  </ul>
                  <p className="m-0 text-ui-xs text-texte-tertiaire">
                    Un dossier de {poste.ton} reste où il est : rien n’est déplacé ni copié. Un dépôt GitHub est cloné sur {poste.ton}.
                  </p>
                  <BoutonPrincipal href="/projets?nouveau=1">Ajouter un projet</BoutonPrincipal>
                </div>
              )
            )}
          </section>
        )}
        {menuProjet}
      </div>
    </div>
  );
}
