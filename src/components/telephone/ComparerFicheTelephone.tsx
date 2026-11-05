"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { consigne } from "@/lib/lien-bibliotheque";
import { comparerAuModele, fusionnerAvecModele, remplacerParModele, versionsDuModele, type Changement, type Choix, type Conflit } from "@/lib/maj-modele";
import { useLecturePoste } from "@/lib/poste/client";
import type { FicheLue } from "@/lib/telephone/gestes-agents";
import { useGesteTelephone } from "@/lib/telephone/geste";
import { AvantApresFiche } from "./AvantApresFiche";
import { ErreurGeste, PagePleine, useCartesAgents, EntetePagePleine } from "./CommunAgentsTelephone";
import { ConfirmationFeuille, MenuFeuille } from "./Feuille";
import { GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { NotePoste, VueLecture } from "./etats";

/**
 * « Comparer au modèle KLYRA » sur le téléphone (spec T-09, § 10) : la comparaison se calcule ici
 * sur la fiche lue (les modèles sont dans l'app), l'écriture se fait sur l'ordinateur, qui refait le
 * calcul sur sa fiche et refuse si elle a changé depuis la lecture. Mêmes choix qu'au bureau.
 */

const liste = (changements: Changement[]) =>
  changements.map((c) => (c.etat === "ajoutee" ? `${c.titre} (nouvelle)` : c.etat === "retiree" ? `${c.titre} (retirée)` : c.titre)).join(", ");

function ChoixConflit({ conflit, choix, onChoisir }: { conflit: Conflit; choix: Choix; onChoisir: (choix: Choix) => void }) {
  const options: [Choix, string][] = [
    ["mienne", conflit.mienne === null ? "La laisser retirée" : "Garder la mienne"],
    ["modele", conflit.modele === null ? "La retirer, comme le modèle" : "Prendre celle du modèle"],
  ];
  return (
    <SectionListe titre={conflit.titre}>
      <div role="radiogroup" aria-label={`Version de « ${conflit.titre} » à garder`}>
        <GroupeListe>
          {options.map(([valeur, libelle]) => (
            <LigneListe key={valeur} nom={libelle} onClick={() => onChoisir(valeur)} fin={choix === valeur ? <Icon name="check-01" size={24} className="shrink-0 text-icone-accent" /> : undefined} />
          ))}
        </GroupeListe>
      </div>
      <details className="mt-1 px-1">
        <summary className="flex min-h-11 cursor-pointer items-center text-ui text-texte-secondaire">Voir les deux versions</summary>
        <AvantApresFiche avant={conflit.mienne ?? ""} apres={conflit.modele ?? ""} titreAvant="La mienne" titreApres="Celle du modèle" />
      </details>
    </SectionListe>
  );
}

export function ComparerFicheTelephone({ id }: { id: string }) {
  const router = useRouter();
  const { carte } = useCartesAgents();
  const fiche = useLecturePoste<FicheLue>("agents.fiche", { id });
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  const [choix, setChoix] = useState<Record<string, Choix>>({});
  const [autres, setAutres] = useState(false);
  const [remplacer, setRemplacer] = useState(false);
  const nom = carte(id)?.nom ?? "Cet agent";
  const retour = `/equipe?agent=${encodeURIComponent(id)}`;
  /* La fiche a changé sur l'ordinateur : rien n'a été écrit, la comparaison se refait sur la nouvelle version. */
  const conflit = erreur?.code === "conflit";
  const relire = fiche.relancer;
  useEffect(() => {
    if (conflit) relire();
  }, [conflit, relire]);

  const faire = async (action: "mettreAJour" | "remplacer" | "garder" | "copier", empreinte: string) => {
    const ok = await agir("agents.majModele", { id, action, choix, empreinte });
    if (ok) router.push(`${retour}&enregistre=1`);
  };

  /* Le pied ne vaut que pour une fiche à comparer : un modèle disparu ou identique n'offre aucun geste (E5-33). */
  const lue = fiche.etat === "ok" ? fiche.data : null;
  const comparee = lue?.type === "agent" && lue.modeleKlyra ? comparerAuModele(lue.modeleKlyra, lue.contenu) : null;
  const aComparer = lue?.type === "agent" && comparee && comparee.identiqueA !== comparee.version ? lue : null;
  const nouvelleVersion = comparee ? comparee.base < comparee.version : false;
  const ficheIntacte = comparee ? comparee.identiqueA !== null : false;
  const bloque = !ouvert || occupe;
  const pied = aComparer ? (
    <>
      <div className="flex gap-2">
        {nouvelleVersion && ficheIntacte ? (
          <Bouton variant="blanc" taille="md" className="flex-1" onClick={() => router.push(retour)}>
            Plus tard
          </Bouton>
        ) : (
          <Bouton variant="blanc" taille="md" className="flex-1" disabled={bloque} onClick={() => setAutres(true)}>
            Autres choix…
          </Bouton>
        )}
        {nouvelleVersion ? (
          <Bouton variant="sombre" taille="md" className="flex-1" disabled={bloque} onClick={() => void faire("mettreAJour", aComparer.empreinte)}>
            Mettre à jour
          </Bouton>
        ) : null}
      </div>
      {ouvert ? null : <NotePoste />}
    </>
  ) : undefined;

  return (
    <PagePleine pied={pied}>
      <EntetePagePleine titre={`Modèle KLYRA de ${nom}`} onFermer={() => router.push(retour)} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <VueLecture lecture={fiche} ferme={(sur) => `la fiche de ${nom} est sur ${sur}. Elle s’affiche quand KLYRA y est ouverte.`}>
          {(f) => {
            if (f.type !== "agent" || !f.modeleKlyra) return <p className="px-4 pt-6 text-ui text-texte-secondaire">{nom} ne vient pas d’un modèle KLYRA.</p>;
            const comparaison = comparerAuModele(f.modeleKlyra, f.contenu);
            const fusion = comparaison ? fusionnerAvecModele(f.modeleKlyra, id, f.contenu, choix) : null;
            const remplacement = comparaison ? remplacerParModele(f.modeleKlyra, id, f.contenu) : null;
            if (!comparaison || !fusion || !remplacement) return <p className="px-4 pt-6 text-ui text-texte-secondaire">Ce modèle KLYRA n’existe plus dans cette version de l’app.</p>;
            if (comparaison.identiqueA === comparaison.version) return <p className="px-4 pt-6 text-ui text-texte-secondaire">{nom} est identique au modèle KLYRA de cette version de l’app.</p>;
            const { version, base } = comparaison;
            const nouvelle = base < version;
            const intacte = comparaison.identiqueA !== null;
            const apres = nouvelle ? fusion.contenu : remplacement;
            const contenuBase = versionsDuModele(f.modeleKlyra).find((v) => v.version === base)?.content ?? "";
            return (
              <div className="flex flex-col gap-4 px-4">
                <p className="px-1 text-ui text-texte-secondaire">
                  {!nouvelle
                    ? "Ta fiche diffère du modèle KLYRA de cette version de l’app : ce sont tes modifications. Compare, puis choisis."
                    : intacte
                      ? `Ta fiche est la version ${base} du modèle, sans modification. Rien ne change tant que tu ne choisis pas.`
                      : `Ta fiche a été modifiée depuis la version ${base} du modèle. La mise à jour reprend ce que tu n’as pas touché et garde tes modifications.`}
                </p>
                {nouvelle && !intacte && (fusion.reprises.length || fusion.gardees.length) ? (
                  <GroupeListe>
                    {fusion.reprises.length ? <LigneListe debut={<TuileIcone icone="refresh-01" />} retrait="tuile" nom="Repris du modèle" ligne2={liste(fusion.reprises)} /> : null}
                    {fusion.gardees.length ? <LigneListe debut={<TuileIcone icone="check-01" />} retrait="tuile" nom="Tes modifications gardées" ligne2={liste(fusion.gardees)} /> : null}
                  </GroupeListe>
                ) : null}
                {nouvelle && !intacte && fusion.conflits.length ? (
                  <div className="flex flex-col gap-3">
                    <p className="px-1 text-ui text-texte-secondaire">
                      <span className="font-semibold text-texte-principal">Modifiées des deux côtés · {fusion.conflits.length}.</span> Choisis la version à garder. Par défaut, la tienne.
                    </p>
                    {fusion.conflits.map((c) => (
                      <ChoixConflit key={c.cle} conflit={c} choix={choix[c.cle] ?? "mienne"} onChoisir={(v) => setChoix((x) => ({ ...x, [c.cle]: v }))} />
                    ))}
                  </div>
                ) : null}
                {nouvelle && !intacte ? (
                  <details className="px-1">
                    <summary className="flex min-h-11 cursor-pointer items-center text-ui text-texte-secondaire">Mes changements depuis la version {base}</summary>
                    <AvantApresFiche avant={consigne(contenuBase)} apres={consigne(f.contenu)} />
                  </details>
                ) : null}
                <AvantApresFiche avant={consigne(f.contenu)} apres={consigne(apres)} titreAvant="Ta fiche" titreApres={nouvelle ? "Après la mise à jour" : "Le modèle KLYRA"} />
                <p className="px-1 text-ui-xs text-texte-secondaire">Tu gardes son nom, sa couleur, son rôle court, le reste de son en-tête et ses conversations. Ta version actuelle va dans l’historique.</p>
                <ErreurGeste message={erreur?.message} />
              </div>
            );
          }}
        </VueLecture>
      </div>
      {autres && aComparer ? (
        <MenuFeuille
          titre="Autres choix"
          objet={{ visuel: <TuileIcone icone="refresh-01" />, sous: `Modèle KLYRA de ${nom}` }}
          onFermer={() => setAutres(false)}
          actions={[
            { libelle: "Garder ma version", icone: "shield-check", note: "Le modèle ne te proposera plus cette version.", desactivee: bloque, onChoisir: () => void faire("garder", aComparer.empreinte) },
            { libelle: "Copier en privé", icone: "copy-left", note: "Sa fiche ne suivra plus le modèle KLYRA.", desactivee: bloque, onChoisir: () => void faire("copier", aComparer.empreinte) },
            { libelle: "Remplacer par le modèle", icone: "arrow-rotate-left-01", note: "Tes modifications vont dans l’historique.", desactivee: bloque, onChoisir: () => setRemplacer(true) },
          ]}
        />
      ) : null}
      {remplacer && aComparer ? (
        <ConfirmationFeuille
          titre="Remplacer par le modèle ?"
          texte="Sa fiche reprend le texte du modèle KLYRA. Tes modifications vont dans l’historique."
          confirmer="Remplacer"
          onConfirmer={() => void faire("remplacer", aComparer.empreinte)}
          onFermer={() => setRemplacer(false)}
        />
      ) : null}
    </PagePleine>
  );
}
