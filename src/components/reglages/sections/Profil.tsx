"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { useMonIdentite } from "@/lib/compte";
import { useWorkspace } from "@/lib/workspace";
import { AccordProfils } from "../AccordProfils";
import { Recadrage } from "../Recadrage";
import { Erreur, Groupe, Ligne } from "../ui";
import { Consommation } from "./Consommation";

/** Ta photo : elle remplace tes initiales en bas du menu. Choisie, puis recadrée dans un rond. Elle reste sur cet ordinateur. */
function Photo() {
  const { moi, modifierProfil } = useWorkspace();
  const choix = useRef<HTMLInputElement>(null);
  const [aRecadrer, setARecadrer] = useState<string | null>(null);
  const { photo, initial } = moi;
  const fermer = useCallback(() => {
    setARecadrer((url) => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
      return null;
    });
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Un clic sur la photo : la recadrer (ou en choisir une, s'il n'y en a pas). */}
      <button
        type="button"
        title={photo ? "Recadrer ta photo" : "Ajouter une photo"}
        aria-label={photo ? "Recadrer ta photo" : "Ajouter une photo"}
        onClick={() => (photo ? setARecadrer(photo) : choix.current?.click())}
        className="cursor-pointer rounded-full border-0 bg-transparent p-0 transition-opacity duration-[120ms] hover:opacity-80"
      >
        <Avatar shape="circle" size="lg" src={photo ?? undefined} initials={initial} alt="" gradient={false} />
      </button>
      <input
        ref={choix}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const fichier = e.target.files?.[0];
          e.target.value = "";
          if (fichier) setARecadrer(URL.createObjectURL(fichier));
        }}
      />
      <Bouton type="button" variant="blanc" taille="compact" onClick={() => choix.current?.click()}>
        {photo ? "Changer la photo" : "Ajouter une photo"}
      </Bouton>
      {photo && (
        <>
          <Bouton type="button" variant="blanc" taille="compact" onClick={() => setARecadrer(photo)}>
            Recadrer
          </Bouton>
          <Bouton type="button" variant="discret" taille="compact" onClick={() => modifierProfil({ photo: null })}>
            Retirer
          </Bouton>
        </>
      )}
      {aRecadrer && (
        <Recadrage
          src={aRecadrer}
          onAnnuler={fermer}
          onValider={(p) => {
            modifierProfil({ photo: p });
            fermer();
          }}
        />
      )}
    </div>
  );
}

/**
 * Prénom et rôle : ce que les agents lisent au début de chaque échange.
 * Connecté, c'est aussi ton profil d'équipe (cf. `useMonIdentite`).
 */
function Identite() {
  const { moi, enregistrer } = useMonIdentite();
  const [name, setName] = useState(moi.name);
  const [title, setTitle] = useState(moi.title);
  const [enregistre, setEnregistre] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const change = name.trim() !== moi.name || title.trim() !== moi.title;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setErreur(null);
        setEnCours(true);
        enregistrer(name, title)
          .then(() => setEnregistre(true))
          .catch((x: unknown) => setErreur(x instanceof Error ? x.message : String(x)))
          .finally(() => setEnCours(false));
      }}
      className="@container flex w-full flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
        <Champ label="Prénom" erreur={!name.trim() ? "Ton prénom ne peut pas être vide." : undefined}>
          <Input
            size="sm"
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              setEnregistre(false);
            }}
            className={CHAMP}
          />
        </Champ>
        <Champ label="Rôle" aide="Par exemple « Design · KLYRA ».">
          <Input
            size="sm"
            value={title}
            maxLength={80}
            onChange={(e) => {
              setTitle(e.target.value);
              setEnregistre(false);
            }}
            className={CHAMP}
          />
        </Champ>
      </div>
      <div className="flex items-center gap-3">
        <Bouton type="submit" variant="sombre" taille="compact" disabled={!change || !name.trim() || enCours}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </Bouton>
        {enregistre && !change && !enCours && (
          <span role="status" className="text-ui-xs text-texte-tertiaire">
            Enregistré.
          </span>
        )}
      </div>
      {erreur && <Erreur>{erreur}</Erreur>}
    </form>
  );
}

/**
 * Le Profil : qui tu es (photo, prénom, rôle, à modifier d'un clic), puis ta
 * consommation sur cet ordinateur, comme le Profil d'OpenBot.
 */
export function Profil() {
  const { moi, connecte } = useMonIdentite();
  const { photo, initial, name, title } = moi;
  /* Ouvert d'office si la recherche mène à la photo ou au prénom. */
  const [edition, setEdition] = useState(false);
  useEffect(() => {
    const ouvrir = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id === "photo" || id === "nom") setEdition(true);
    };
    window.addEventListener("klyra:reglage", ouvrir);
    return () => window.removeEventListener("klyra:reglage", ouvrir);
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar shape="circle" size="lg" src={photo ?? undefined} initials={initial} alt="" gradient={false} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-semibold text-texte-principal">{name || "Sans nom"}</span>
          {title && <span className="truncate text-ui-xs text-texte-tertiaire">{title}</span>}
        </div>
        <Bouton variant="blanc" taille="compact" iconeGauche={<Icon name="pencil-01" size={16} />} aria-expanded={edition} onClick={() => setEdition((v) => !v)}>
          {edition ? "Fermer" : "Modifier le profil"}
        </Bouton>
      </div>

      <AccordProfils />

      {edition && (
        <Groupe>
          <Ligne id="photo" libelle="Photo" description="Elle remplace tes initiales en bas du menu. Elle reste sur cet ordinateur.">
            <Photo />
          </Ligne>
          <Ligne
            id="nom"
            libelle="Prénom et rôle"
            description={
              connecte
                ? "Ceux de ton compte d’équipe : l’équipe et les agents voient les mêmes. Ils sont aussi gardés sur cet ordinateur, pour quand tu n’es pas connecté."
                : "Chaque personne de l’équipe a le sien, sur son poste. Les agents le lisent au début de chaque échange."
            }
            pile
          >
            {/* Le profil peut arriver après coup (nom de la session, compte connecté) : le formulaire repart de lui. */}
            <Identite key={`${moi.source}|${name}|${title}`} />
          </Ligne>
        </Groupe>
      )}

      <Consommation />
    </>
  );
}
