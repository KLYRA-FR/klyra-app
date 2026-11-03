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
import { getBridge } from "@/lib/bridge";
import { lieuParDefaut, nomLieu, useServeursRelies } from "@/lib/lieux";
import { cn } from "@/lib/cn";
import { formatListDate } from "@/lib/format";
import { poste } from "@/lib/plateforme";
import { useProjects, useWorkspace } from "@/lib/workspace";
import type { Project, ProjectStatus } from "@/types/domain";

const STATUTS: { value: ProjectStatus; label: string }[] = [
  { value: "en-cours", label: "En cours" },
  { value: "en-revue", label: "En revue" },
  { value: "livre", label: "Livré" },
];

/** « /Users/x/Documents/site » → « ~/Documents/site ». */
const court = (chemin: string) => chemin.replace(/^\/Users\/[^/]+/, "~");

/** Un identifiant lisible tiré du nom (« klyra-fr »), unique parmi les projets. */
function identifiant(nom: string, existants: Project[]): string {
  const base =
    nom
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "projet";
  let id = base;
  for (let i = 2; existants.some((p) => p.id === id); i++) id = `${base}-${i}`;
  return id;
}

/** Les projets d'un VPS vivent sous le dossier de l'utilisateur klyra (serveur/lancer.sh, serveur/fichiers.mjs). */
const RACINE_VPS = "/var/lib/klyra/projets";

/** Ajouter ou modifier un projet : son dossier sur ce Mac (ou sur un VPS relié), son nom, à quoi il sert. */
function FormulaireProjet({ initial, onFini }: { initial: Project | null; onFini: (id: string | null) => void }) {
  const projects = useProjects();
  const { enregistrerProjet } = useWorkspace();
  const bridge = getBridge();
  // Un nouveau projet va dans l'espace affiché, celui du serveur choisi.
  const [lieu] = useState<string | null>(() => (initial ? (initial.lieu ?? null) : lieuParDefaut()));
  const [folder, setFolder] = useState(() => initial?.folder ?? (lieu ? `${RACINE_VPS}/projet` : ""));
  const [name, setName] = useState(initial?.name ?? "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? "");
  const [brief, setBrief] = useState(initial?.brief ?? "");
  const [previewUrl, setPreviewUrl] = useState(initial?.previewUrl ?? "");
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? "en-cours");
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [essai, setEssai] = useState(false);
  // Un projet vit sur ce PC ou sur un VPS relié ; on ne le déplace pas après coup (ses chemins en dépendent).
  const serveurs = useServeursRelies();
  const [erreurVps, setErreurVps] = useState<string | null>(null);
  const surVps = !!lieu;

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
    name: name.trim() ? undefined : "Donne-lui un nom.",
  };

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    setEssai(true);
    if (erreurs.folder || erreurs.name) return;
    if (lieu && !initial && bridge?.projets.creerDossierVps) {
      setErreurVps(null);
      const r = await bridge.projets.creerDossierVps(lieu, folder);
      if (!r.ok) return setErreurVps(r.message);
    }
    const project: Project = {
      id: initial?.id ?? identifiant(name, projects),
      name: name.trim(),
      subtitle: subtitle.trim(),
      brief: brief.trim(),
      previewUrl: previewUrl.trim().replace(/^https?:\/\//, ""),
      status,
      pinned,
      folder,
      ...(lieu ? { lieu } : {}),
      roleIds: initial?.roleIds ?? ["principal"],
      files: [],
      updatedAt: new Date().toISOString(),
    };
    enregistrerProjet(project);
    onFini(project.id);
  };

  return (
    <form onSubmit={(e) => void enregistrer(e)} className="klyra-carte-flottante @container flex flex-col gap-5 rounded-lg p-5">
      {(serveurs.length > 0 || surVps) && (
        <Champ label="Serveur" aide={initial ? "Un projet reste sur son serveur." : "Celui du menu Serveurs. Ses conversations y tournent, et ses fichiers y vivent."}>
          <p className="m-0 text-ui text-texte-principal">{nomLieu(lieu, serveurs)}</p>
        </Champ>
      )}
      {surVps ? (
        <Champ label="Dossier sur le VPS" erreur={essai ? (erreurs.folder ?? erreurVps ?? undefined) : undefined} aide="Créé s’il n’existe pas. Les agents du VPS y travaillent.">
          <Input size="sm" value={folder} disabled={!!initial} onChange={(e) => setFolder(e.target.value.trim())} className={cn(CHAMP, "klyra-mono")} />
        </Champ>
      ) : (
      <Champ label="Dossier" erreur={essai ? erreurs.folder : undefined} aide={bridge ? "Les agents travaillent dans ce dossier : ils y lisent et y modifient les fichiers." : "Choisir un dossier marche dans l’app de bureau."}>
        <div className="flex flex-wrap items-center gap-2">
          <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="folder-open-01" size={20} />} onClick={() => void choisir()} disabled={!bridge}>
            {folder ? "Changer de dossier" : "Choisir le dossier…"}
          </Bouton>
          {folder && <span className="klyra-mono min-w-0 text-ui-xs text-texte-secondaire [overflow-wrap:anywhere]">{court(folder)}</span>}
        </div>
      </Champ>
      )}

      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <Champ label="Nom" erreur={essai ? erreurs.name : undefined}>
          <Input size="sm" value={name} placeholder="Bizwhoo" onChange={(e) => setName(e.target.value)} className={CHAMP} />
        </Champ>
        <Champ label="En une ligne">
          <Input size="sm" value={subtitle} placeholder="Refonte du site" onChange={(e) => setSubtitle(e.target.value)} className={CHAMP} />
        </Champ>
        <Champ label="Brief" aide="Ce que les agents doivent savoir du projet : le client, l’objectif, l’échéance." className="@2xl:col-span-2">
          <Textarea
            size="sm"
            autoGrow
            value={brief}
            placeholder="Refonte du site : hero plus aérée, nouvelle page offres. Mise en ligne prévue le 24 octobre."
            onChange={(e) => setBrief(e.target.value)}
            className={cn(CHAMP, "min-h-[72px]")}
          />
        </Champ>
        <Champ label="Aperçu" aide="L’adresse du serveur de dev, si le projet en a un.">
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
        <BoutonPrincipal type="submit">{initial ? "Enregistrer" : "Ajouter le projet"}</BoutonPrincipal>
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
  const aModifier = projects.find((p) => p.id === params.get("modifier")) ?? null;
  const formulaire = params.has("nouveau") || !!aModifier;

  const fermer = (id: string | null) => router.push(id ? `/projet?id=${id}` : "/projets");

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
              <span className="font-semibold">{aModifier ? aModifier.name : "Projets"}</span>{" "}
              <span className="font-normal">{aModifier ? "· modifier" : `sur ${poste.ce}`}</span>
            </h1>
            <p className="m-0 text-ui-s text-texte-secondaire">
              Ouvre un dossier de {poste.ton} pour parcourir ton code et laisser les agents y travailler.
            </p>
          </div>
          {!formulaire && <BoutonPrincipal href="/projets?nouveau=1">Nouveau projet</BoutonPrincipal>}
        </header>

        {formulaire && <FormulaireProjet key={aModifier?.id ?? "nouveau"} initial={aModifier} onFini={fermer} />}

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
                        <span className="klyra-mono truncate text-ui-2xs text-texte-tertiaire">{court(p.folder)}</span>
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
                    <p className="m-0 text-ui-s text-texte-secondaire">Choisis le dossier d’un site ou d’une app : celui qui contient ton code.</p>
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
                  <p className="m-0 text-ui-xs text-texte-tertiaire">Tes fichiers restent sur {poste.ton}. Rien n’est déplacé ni copié.</p>
                  <BoutonPrincipal href="/projets?nouveau=1">Ajouter un projet</BoutonPrincipal>
                </div>
              )
            )}
          </section>
        )}
      </div>
    </div>
  );
}
