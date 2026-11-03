"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { cn } from "@/lib/cn";
import { useLecturePoste } from "@/lib/poste/client";
import { LIEN_ARTEFACT, type ArtefactLu, type ListeArtefacts } from "@/lib/telephone/gestes-artefacts";
import { useGesteTelephone } from "@/lib/telephone/geste";
import { BoutonMenu, CHAMP_TELEPHONE, ChampTelephone, ErreurGeste } from "./CommunAgentsTelephone";
import { EnteteTelephone } from "./EnteteTelephone";
import { ConfirmationFeuille, Feuille, MenuFeuille, useAppuiLong, type ActionMenu } from "./Feuille";
import { NotePoste, PosteFerme, VueLecture } from "./etats";
import { usePostes } from "./poste";

/**
 * Artefacts sur le téléphone (spec mobile T-20) : la liste est sur l'ordinateur (Poste). Une fois
 * lue, elle reste en mémoire le temps de la session : « Ouvrir dans le navigateur » n'a plus besoin de
 * l'ordinateur (§ 10). Elle n'est jamais gardée ailleurs (M-7).
 */

let derniereListe: ListeArtefacts | null = null;

const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** Ouvre claude.ai dans le navigateur du téléphone. */
function ouvrir(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ArtefactsTelephone() {
  const router = useRouter();
  const { ouvert } = usePostes();
  const lecture = useLecturePoste<ListeArtefacts>("artefacts.liste", {});
  const { agir, occupe, bandeau, erreur } = useGesteTelephone();
  const [recherche, setRecherche] = useState("");
  const [projet, setProjet] = useState("");
  const [menu, setMenu] = useState(false);
  const [lien, setLien] = useState(false);
  const [sync, setSync] = useState(false);
  const lue = lecture.etat === "ok" ? lecture.data : null;
  useEffect(() => {
    if (lue) derniereListe = lue;
  }, [lue]);
  const memoire = lecture.etat === "ok" ? lecture.data : derniereListe;

  const apres = (ok: unknown) => {
    if (ok) lecture.relancer();
  };
  const synchroniser = async () => {
    setSync(true);
    const r = await agir<{ total: number; nouveaux: number }>("artefacts.synchroniser", {}, (x) => `${x.total} artefacts sur ton compte · ${x.nouveaux} nouveau${x.nouveaux > 1 ? "x" : ""}.`, { delai: 60_000 });
    setSync(false);
    apres(r);
  };
  const poste = { desactivee: !ouvert || occupe, note: ouvert ? undefined : <NotePoste /> };
  const actions: ActionMenu[] = [
    { libelle: "Relire claude.ai", onChoisir: () => void synchroniser(), ...poste },
    {
      libelle: "Refaire les aperçus",
      onChoisir: () => void agir<{ lances: number }>("artefacts.apercus", {}, (x) => `Aperçus en cours sur l’ordinateur (${x.lances}).`),
      ...poste,
    },
    { libelle: "Coller un lien claude.ai/artifact/…", onChoisir: () => setLien(true), ...poste },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Artefacts" retour={() => router.push("/plus")} droite={<BoutonMenu libelle="Plus d’options" onClick={() => setMenu(true)} />} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {sync ? (
          <p role="status" className="px-4 pb-2 text-ui text-texte-secondaire">
            Lecture du compte…
          </p>
        ) : null}
        <ErreurGeste message={erreur?.message} className="px-4 pb-2" />
        {lecture.etat === "ferme" && memoire ? (
          <>
            <PosteFerme phrase={(sur) => `la liste des artefacts est sur ${sur}. Elle s’affiche quand KLYRA y est ouverte.`} />
            <p className="px-4 pt-3 pb-2 text-ui text-texte-secondaire">Lue tout à l’heure : tu peux encore ouvrir ces artefacts dans le navigateur.</p>
            <ListeArtefactsTelephone liste={memoire} recherche={recherche} setRecherche={setRecherche} projet={projet} setProjet={setProjet} onChange={apres} />
          </>
        ) : (
          <VueLecture lecture={lecture} lignes={5} ferme={(sur) => `la liste des artefacts est sur ${sur}. Elle s’affiche quand KLYRA y est ouverte.`}>
            {(liste) => <ListeArtefactsTelephone liste={liste} recherche={recherche} setRecherche={setRecherche} projet={projet} setProjet={setProjet} onChange={apres} />}
          </VueLecture>
        )}
      </div>
      {menu ? <MenuFeuille titre="Artefacts" actions={actions} onFermer={() => setMenu(false)} /> : null}
      {lien ? <FeuilleLien projets={memoire?.projets ?? []} onFermer={() => setLien(false)} onFait={() => lecture.relancer()} /> : null}
      {bandeau}
    </div>
  );
}

function ListeArtefactsTelephone({
  liste,
  recherche,
  setRecherche,
  projet,
  setProjet,
  onChange,
}: {
  liste: ListeArtefacts;
  recherche: string;
  setRecherche: (v: string) => void;
  projet: string;
  setProjet: (v: string) => void;
  onChange: (ok: unknown) => void;
}) {
  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return liste.artefacts.filter((a) => (!projet || a.projetId === projet) && (!q || `${a.titre} ${a.description}`.toLowerCase().includes(q)));
  }, [liste, recherche, projet]);
  return (
    <div className="flex flex-col gap-3 px-4">
      <Input size="lg" type="search" placeholder="Chercher un artefact…" aria-label="Chercher un artefact" value={recherche} onChange={(e) => setRecherche(e.target.value)} className={CHAMP_TELEPHONE} />
      {liste.projets.length ? (
        <ListeDeroulante
          libelle="Filtrer par projet"
          value={projet}
          options={[{ value: "", label: "Tous les projets" }, ...liste.projets.map((p) => ({ value: p.id, label: p.nom }))]}
          onChange={setProjet}
          className="min-h-11 text-body-s"
        />
      ) : null}
      <p className="text-ui-xs text-texte-secondaire">
        {visibles.length} artefact{visibles.length > 1 ? "s" : ""}
      </p>
      {visibles.length ? (
        <ul>
          {visibles.map((a) => (
            <LigneArtefact key={a.id} artefact={a} projets={liste.projets} onChange={onChange} />
          ))}
        </ul>
      ) : (
        <p className="py-4 text-ui text-texte-secondaire">{liste.artefacts.length ? "Aucun artefact ne correspond." : "Aucun artefact pour l’instant."}</p>
      )}
    </div>
  );
}

/** Une ligne : titre, « À quoi il sert », projet. Toucher l'ouvre dans le navigateur ; « ⋯ » et l'appui long, le menu. */
function LigneArtefact({ artefact, projets, onChange }: { artefact: ArtefactLu; projets: ListeArtefacts["projets"]; onChange: (ok: unknown) => void }) {
  const { ouvert } = usePostes();
  const { agir, occupe, bandeau, erreur } = useGesteTelephone();
  const [menu, setMenu] = useState(false);
  const [edition, setEdition] = useState(false);
  const [retirer, setRetirer] = useState(false);
  const appui = useAppuiLong(() => setMenu(true));
  const poste = { desactivee: !ouvert || occupe, note: ouvert ? undefined : <NotePoste /> };
  return (
    <li className="border-b border-bordure-subtile" {...appui}>
      <div className="flex min-h-16 items-center gap-2">
        <a href={artefact.url} target="_blank" rel="noopener noreferrer" className="flex min-h-16 min-w-0 flex-1 flex-col justify-center py-2 active:bg-fond-survol">
          <span className="truncate text-body-s text-texte-principal">{artefact.titre}</span>
          {artefact.description ? <span className="line-clamp-2 text-ui-xs text-texte-secondaire">{artefact.description}</span> : null}
          <span className="text-ui-xs text-texte-secondaire">{[artefact.projet, date.format(new Date(artefact.date))].filter(Boolean).join(" · ")}</span>
        </a>
        <BoutonMenu libelle={`Options de ${artefact.titre}`} onClick={() => setMenu(true)} />
      </div>
      <ErreurGeste message={erreur?.message} className="pb-2" />
      {menu ? (
        <MenuFeuille
          titre={artefact.titre}
          onFermer={() => setMenu(false)}
          actions={[
            { libelle: "Ouvrir dans le navigateur", onChoisir: () => ouvrir(artefact.url) },
            { libelle: "Modifier le titre et la description", onChoisir: () => setEdition(true), ...poste },
            { libelle: "Retirer de la liste", onChoisir: () => setRetirer(true), danger: true, ...poste },
          ]}
        />
      ) : null}
      {edition ? <FeuilleModifier artefact={artefact} projets={projets} onFermer={() => setEdition(false)} onFait={() => onChange(true)} /> : null}
      {retirer ? (
        <ConfirmationFeuille
          titre="Retirer de la liste ?"
          texte="L’artefact reste sur claude.ai."
          confirmer="Retirer"
          danger
          onConfirmer={() => void agir("artefacts.retirer", { id: artefact.id }, "Retiré de la liste.").then(onChange)}
          onFermer={() => setRetirer(false)}
        />
      ) : null}
      {bandeau}
    </li>
  );
}

function FeuilleModifier({ artefact, projets, onFermer, onFait }: { artefact: ArtefactLu; projets: ListeArtefacts["projets"]; onFermer: () => void; onFait: () => void }) {
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  const [titre, setTitre] = useState(artefact.titre);
  const [description, setDescription] = useState(artefact.description);
  const [projet, setProjet] = useState(artefact.projetId ?? "");
  const enregistrer = async () => {
    const ok = await agir("artefacts.modifier", { id: artefact.id, titre, description, projetId: projet || null });
    if (!ok) return;
    onFermer();
    onFait();
  };
  return (
    <Feuille
      titre="Modifier le titre et la description"
      onFermer={onFermer}
      pied={
        <>
          <Bouton variant="sombre" taille="md" className="w-full" disabled={!ouvert || occupe || !titre.trim()} onClick={() => void enregistrer()}>
            {occupe ? "Enregistrement…" : "Enregistrer"}
          </Bouton>
          {ouvert ? null : <NotePoste />}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ChampTelephone label="Titre" erreur={titre.trim() ? null : "Donne-lui un titre."}>
          <Input size="lg" value={titre} maxLength={200} onChange={(e) => setTitre(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        <ChampTelephone label="À quoi il sert">
          <Input size="lg" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        <ChampTelephone label="Projet">
          <ListeDeroulante value={projet} options={[{ value: "", label: "Aucun" }, ...projets.map((p) => ({ value: p.id, label: p.nom }))]} onChange={setProjet} className="min-h-11 text-body-s" />
        </ChampTelephone>
        <ErreurGeste message={erreur?.message} />
      </div>
    </Feuille>
  );
}

/** « Coller un lien claude.ai/artifact/… » : l'artefact rejoint la liste de l'ordinateur. */
function FeuilleLien({ projets, onFermer, onFait }: { projets: ListeArtefacts["projets"]; onFermer: () => void; onFait: () => void }) {
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
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
      pied={
        <>
          <Bouton variant="sombre" taille="md" className="w-full" disabled={!ouvert || occupe} onClick={() => void ajouter()}>
            {occupe ? "Ajout…" : "Ajouter"}
          </Bouton>
          {ouvert ? null : <NotePoste />}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ChampTelephone label="Lien" erreur={essai ? erreurs.url : null}>
          <span className="flex gap-2">
            <Input
              size="lg"
              value={url}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://claude.ai/artifact/…"
              onChange={(e) => setUrl(e.target.value)}
              className={cn(CHAMP_TELEPHONE, "min-w-0 flex-1")}
            />
            <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="copy-left" size={20} />} onClick={() => void coller()}>
              Coller
            </Bouton>
          </span>
        </ChampTelephone>
        <ChampTelephone label="Titre" erreur={essai ? erreurs.titre : null}>
          <Input size="lg" value={titre} maxLength={200} onChange={(e) => setTitre(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        <ChampTelephone label="Projet">
          <ListeDeroulante value={projet} options={[{ value: "", label: "Aucun" }, ...projets.map((p) => ({ value: p.id, label: p.nom }))]} onChange={setProjet} className="min-h-11 text-body-s" />
        </ChampTelephone>
        <ErreurGeste message={erreur?.message} />
      </div>
    </Feuille>
  );
}
