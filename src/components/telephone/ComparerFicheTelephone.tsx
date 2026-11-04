"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { cn } from "@/lib/cn";
import { consigne } from "@/lib/lien-bibliotheque";
import { comparerAuModele, fusionnerAvecModele, remplacerParModele, versionsDuModele, type Changement, type Choix, type Conflit } from "@/lib/maj-modele";
import { useLecturePoste } from "@/lib/poste/client";
import type { FicheLue } from "@/lib/telephone/gestes-agents";
import { useGesteTelephone } from "@/lib/telephone/geste";
import { AvantApresFiche } from "./AvantApresFiche";
import { ErreurGeste, useCartesAgents } from "./CommunAgentsTelephone";
import { EnteteTelephone } from "./EnteteTelephone";
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
    <li className="flex flex-col gap-2 border-b border-bordure-subtile py-3 last:border-b-0">
      <span className="text-body-s font-medium text-texte-principal">{conflit.titre}</span>
      <div role="radiogroup" aria-label={`Version de « ${conflit.titre} » à garder`} className="flex flex-col gap-2">
        {options.map(([valeur, libelle]) => (
          <button
            key={valeur}
            type="button"
            role="radio"
            aria-checked={choix === valeur}
            onClick={() => onChoisir(valeur)}
            className={cn("min-h-11 rounded-xs border px-3 text-left text-ui", choix === valeur ? "border-focus bg-fond-surface text-texte-principal" : "border-bordure-subtile text-texte-secondaire")}
          >
            {libelle}
          </button>
        ))}
      </div>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-ui text-texte-secondaire">Voir les deux versions</summary>
        <AvantApresFiche avant={conflit.mienne ?? ""} apres={conflit.modele ?? ""} titreAvant="La mienne" titreApres="Celle du modèle" />
      </details>
    </li>
  );
}

export function ComparerFicheTelephone({ id }: { id: string }) {
  const router = useRouter();
  const { carte } = useCartesAgents();
  const fiche = useLecturePoste<FicheLue>("agents.fiche", { id });
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  const [choix, setChoix] = useState<Record<string, Choix>>({});
  const nom = carte(id)?.nom ?? id;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={`Modèle KLYRA de ${nom}`} parent={retour} />
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
            const bloque = !ouvert || occupe;
            const contenuBase = versionsDuModele(f.modeleKlyra).find((v) => v.version === base)?.content ?? "";
            return (
              <div className="flex flex-col gap-4 px-4">
                <p className="text-ui text-texte-secondaire">
                  {!nouvelle
                    ? "Ta fiche diffère du modèle KLYRA de cette version de l’app : ce sont tes modifications. Compare, puis choisis."
                    : intacte
                      ? `Ta fiche est la version ${base} du modèle, sans modification. Rien ne change tant que tu ne choisis pas.`
                      : `Ta fiche a été modifiée depuis la version ${base} du modèle. La mise à jour reprend ce que tu n’as pas touché et garde tes modifications.`}
                </p>
                {nouvelle && !intacte ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-bordure-subtile bg-fond-surface p-4 text-ui text-texte-principal">
                    {fusion.reprises.length ? (
                      <p>
                        <span className="font-medium">Repris du modèle</span>, là où tu n’avais rien changé : {liste(fusion.reprises)}.
                      </p>
                    ) : null}
                    {fusion.gardees.length ? (
                      <p>
                        <span className="font-medium">Tes modifications gardées</span> : {liste(fusion.gardees)}.
                      </p>
                    ) : null}
                    {fusion.conflits.length ? (
                      <>
                        <p>
                          <span className="font-medium">Modifiées des deux côtés</span> : choisis pour chacune. Par défaut, ta version est gardée.
                        </p>
                        <ul>
                          {fusion.conflits.map((c) => (
                            <ChoixConflit key={c.cle} conflit={c} choix={choix[c.cle] ?? "mienne"} onChoisir={(v) => setChoix((x) => ({ ...x, [c.cle]: v }))} />
                          ))}
                        </ul>
                      </>
                    ) : null}
                    <details>
                      <summary className="flex min-h-11 cursor-pointer items-center text-ui text-texte-secondaire">Mes changements depuis la version {base}</summary>
                      <AvantApresFiche avant={consigne(contenuBase)} apres={consigne(f.contenu)} />
                    </details>
                  </div>
                ) : null}
                <AvantApresFiche avant={consigne(f.contenu)} apres={consigne(apres)} titreAvant="Ta fiche" titreApres={nouvelle ? "Après la mise à jour" : "Le modèle KLYRA"} />
                <p className="text-ui-xs text-texte-secondaire">
                  Tu gardes son nom ({nom}), sa couleur, son rôle court, le reste de son en-tête et ses conversations. Ta version actuelle va dans l’historique.
                </p>
                <div className="flex flex-col gap-2">
                  {nouvelle ? (
                    <BoutonPrincipal className="w-full" disabled={bloque} onClick={() => void faire("mettreAJour", f.empreinte)}>
                      Mettre à jour
                    </BoutonPrincipal>
                  ) : null}
                  {nouvelle && intacte ? (
                    <Bouton variant="blanc" taille="md" onClick={() => router.push(retour)}>
                      Plus tard
                    </Bouton>
                  ) : (
                    <>
                      <Bouton variant="blanc" taille="md" disabled={bloque} onClick={() => void faire("garder", f.empreinte)}>
                        Garder ma version
                      </Bouton>
                      <Bouton variant="blanc" taille="md" disabled={bloque} onClick={() => void faire("copier", f.empreinte)}>
                        Copier en privé
                      </Bouton>
                      <Bouton variant={nouvelle ? "blanc" : "sombre"} taille="md" disabled={bloque} onClick={() => void faire("remplacer", f.empreinte)}>
                        Remplacer par le modèle
                      </Bouton>
                      <p className="text-ui-xs text-texte-secondaire">« Remplacer » : tes modifications vont dans l’historique.</p>
                    </>
                  )}
                  {ouvert ? null : <NotePoste />}
                  <ErreurGeste message={erreur?.message} />
                </div>
              </div>
            );
          }}
        </VueLecture>
      </div>
    </div>
  );
}
