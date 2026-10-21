"use client";

import { useState, type FormEvent } from "react";
import { Input, Select } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { cn } from "@/lib/cn";
import { useProjects, useWorkspace } from "@/lib/workspace";
import type { Artefact } from "@/types/domain";

const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** Un lien d'artefact Claude : claude.ai/artifact/… ou claude.ai/code/artifact/… */
const LIEN_ARTEFACT = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+\/?$/;

/** Ajouter un artefact : son lien, un titre, à quoi il sert, son projet. */
function AjoutArtefact({ onFermer }: { onFermer: () => void }) {
  const projects = useProjects();
  const { ajouterArtefact } = useWorkspace();
  const [url, setUrl] = useState("");
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [essai, setEssai] = useState(false);

  const erreurs = {
    url: LIEN_ARTEFACT.test(url.trim()) ? undefined : "Colle un lien claude.ai/artifact/…",
    titre: titre.trim() ? undefined : "Donne-lui un titre.",
  };

  const ajouter = (e: FormEvent) => {
    e.preventDefault();
    setEssai(true);
    if (erreurs.url || erreurs.titre) return;
    ajouterArtefact({ url: url.trim(), titre: titre.trim(), description: description.trim(), projectId: projectId || null });
    onFermer();
  };

  return (
    <form onSubmit={ajouter} className="klyra-carte-flottante @container flex flex-col gap-4 rounded-lg p-5">
      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <Champ label="Lien" erreur={essai ? erreurs.url : undefined} className="@2xl:col-span-2">
          <Input
            size="sm"
            value={url}
            placeholder="https://claude.ai/artifact/…"
            onChange={(e) => setUrl(e.target.value)}
            className={cn(CHAMP, "klyra-mono")}
          />
        </Champ>
        <Champ label="Titre" erreur={essai ? erreurs.titre : undefined}>
          <Input size="sm" value={titre} placeholder="Propale Bizwhoo" onChange={(e) => setTitre(e.target.value)} className={CHAMP} />
        </Champ>
        <Champ label="Projet">
          <Select
            size="sm"
            value={projectId}
            options={[{ value: "", label: "Aucun" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={(e) => setProjectId(e.target.value)}
            className={CHAMP}
          />
        </Champ>
        <Champ label="À quoi il sert" className="@2xl:col-span-2">
          <Input
            size="sm"
            value={description}
            placeholder="La présentation envoyée au client le 20 octobre."
            onChange={(e) => setDescription(e.target.value)}
            className={CHAMP}
          />
        </Champ>
      </div>
      <div className="flex gap-2">
        <BoutonPrincipal type="submit">Ajouter</BoutonPrincipal>
        <Bouton variant="blanc" taille="md" onClick={onFermer}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

/** La carte d'un artefact : un clic l'ouvre dans le navigateur. */
function CarteArtefact({ artefact }: { artefact: Artefact }) {
  const projet = useProjects().find((p) => p.id === artefact.projectId);
  const { supprimerArtefact } = useWorkspace();
  const [confirmer, setConfirmer] = useState(false);

  return (
    <li className="klyra-carte-flottante group/artefact relative flex flex-col gap-3 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="klyra-orbe flex size-9 shrink-0 items-center justify-center rounded-full">
          <Icon name="layers-01" size={18} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Les liens externes s'ouvrent dans le navigateur (cf. electron/main.ts). */}
          <a
            href={artefact.url}
            target="_blank"
            rel="noreferrer"
            className="text-ui font-semibold text-texte-principal no-underline after:absolute after:inset-0 after:rounded-lg hover:text-texte-accent"
          >
            {artefact.titre}
          </a>
          {artefact.description && <p className="m-0 line-clamp-2 text-ui-s leading-[1.45] text-texte-secondaire">{artefact.description}</p>}
        </div>
        <BoutonIcone
          taille="mini"
          icone={<Icon name="trash-01" size={16} />}
          libelle={`Retirer ${artefact.titre}`}
          onClick={() => setConfirmer(true)}
          className="relative z-10 text-icone-secondaire opacity-0 transition-opacity duration-[120ms] group-hover/artefact:opacity-100 focus-visible:opacity-100"
        />
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-2xs text-texte-tertiaire">
        <Icon name="link-external" size={14} />
        <span className="klyra-mono truncate">{artefact.url.replace("https://", "")}</span>
        {projet && <span className="rounded-2xs bg-fond-surface-grise px-1.5 py-px font-medium text-texte-secondaire">{projet.name}</span>}
        <span className="ml-auto">{date.format(new Date(artefact.ajouteLe))}</span>
      </div>
      {confirmer && (
        <div className="relative z-10 flex flex-wrap items-center gap-2 rounded-md bg-fond-page p-2.5">
          <span className="flex-1 text-ui-xs text-texte-principal">Retirer de la liste ? L’artefact reste en ligne.</span>
          <Bouton variant="sombre" taille="compact" onClick={() => supprimerArtefact(artefact.id)}>
            Retirer
          </Bouton>
          <Bouton variant="blanc" taille="compact" onClick={() => setConfirmer(false)}>
            Annuler
          </Bouton>
        </div>
      )}
    </li>
  );
}

/** Artefacts : les pages publiées par Claude (design system, propales, présentations), au même endroit. */
export function ArtefactsScreen() {
  const { state } = useWorkspace();
  const [ajout, setAjout] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
              <span className="font-semibold">Artefacts</span> <span className="font-normal">du studio</span>
            </h1>
            <p className="m-0 text-ui-s text-texte-secondaire">Les pages publiées par Claude : design system, propales, présentations, outils.</p>
          </div>
          {!ajout && <BoutonPrincipal onClick={() => setAjout(true)}>Ajouter un artefact</BoutonPrincipal>}
        </header>

        {ajout && <AjoutArtefact onFermer={() => setAjout(false)} />}

        <section aria-label="Artefacts" className="rounded-3xl border border-bordure-subtile bg-fond-page p-3">
          {state.artefacts.length ? (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2 p-0">
              {state.artefacts.map((a) => (
                <CarteArtefact key={a.id} artefact={a} />
              ))}
            </ul>
          ) : (
            <p className="m-0 p-4 text-ui-s text-texte-secondaire">Aucun artefact pour l’instant. Ajoute le lien d’une page publiée par Claude.</p>
          )}
        </section>
      </div>
    </div>
  );
}
