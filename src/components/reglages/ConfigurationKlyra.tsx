"use client";

import { useEffect, useState } from "react";
import { Textarea } from "klyra-ui";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge, unwrap } from "@/lib/bridge";
import { useReglages } from "@/lib/reglages";
import {
  CONFIGURATION_RECOMMANDEE,
  estRecommandee,
  MODELE_CONSIGNES,
  nouveauModeleDisponible,
  TAILLE_MAX_CONSIGNES,
  type ConfigurationKlyra,
} from "../../../electron/configuration-klyra";
import type { DiagnosticPoste } from "../../../electron/diagnostic-poste";
import { Erreur, Groupe, Interrupteur, Ligne, Pastille } from "./ui";

/** Ce que la carte adopte : les consignes déjà modifiées par la personne restent les siennes. */
export const adopter = (actuelle: ConfigurationKlyra): ConfigurationKlyra => ({
  ...actuelle,
  ...CONFIGURATION_RECOMMANDEE,
  consignes: actuelle.consignes?.texte.trim() ? actuelle.consignes : { ...MODELE_CONSIGNES },
});

/** Les consignes KLYRA : on les ajoute ou les retire, on les modifie, on revient au modèle. */
function Consignes({ configuration, changer }: { configuration: ConfigurationKlyra; changer: (patch: Partial<ConfigurationKlyra>) => Promise<void> }) {
  const consignes = configuration.consignes;
  // Le brouillon de la personne ; sans brouillon, le texte enregistré.
  const [brouillon, setBrouillon] = useState<string | null>(null);
  const texte = brouillon ?? consignes?.texte ?? "";
  const modifie = !!consignes && texte !== consignes.texte;
  const enregistrer = (patch: Partial<ConfigurationKlyra>) => {
    setBrouillon(null);
    void changer(patch);
  };

  return (
    <Ligne
      id="consignes-klyra"
      libelle="Consignes KLYRA"
      description="Ajoutées à chaque session de tes agents, sur Claude comme sur ChatGPT : chercher avant de lire, ne pas afficher de sortie entière, répondre court. Sur nos essais, 13 à 19 % de coût en moins à résultat égal. Elles valent pour les conversations qui commencent ensuite."
      pile
    >
      <div className="flex w-full flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <Interrupteur
            libelle="Ajouter les consignes KLYRA"
            actif={!!consignes}
            onChange={(actif) => enregistrer({ consignes: actif ? { ...MODELE_CONSIGNES } : null })}
          />
          <span className="text-ui-xs text-texte-secondaire">{consignes ? "Ajoutées" : "Non ajoutées"}</span>
        </div>
        {consignes && (
          <>
            {nouveauModeleDisponible(consignes) && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-fond-surface-grise px-3 py-2">
                <span className="min-w-0 flex-1 text-ui-xs text-texte-secondaire">Une nouvelle version des consignes KLYRA existe. Tes modifications restent tant que tu ne la prends pas.</span>
                <Bouton variant="blanc" taille="mini" onClick={() => enregistrer({ consignes: { ...MODELE_CONSIGNES } })}>
                  Prendre la nouvelle version
                </Bouton>
              </div>
            )}
            <Textarea
              size="sm"
              autoGrow
              aria-label="Texte des consignes KLYRA"
              value={texte}
              maxLength={TAILLE_MAX_CONSIGNES}
              onChange={(e) => setBrouillon(e.target.value)}
              className="min-h-[140px] w-full"
            />
            <div className="flex flex-wrap gap-2">
              <Bouton variant="blanc" taille="compact" disabled={!modifie} onClick={() => enregistrer({ consignes: { texte, version: consignes.version } })}>
                Enregistrer
              </Bouton>
              {texte !== MODELE_CONSIGNES.texte && (
                <Bouton variant="discret" taille="compact" onClick={() => enregistrer({ consignes: { ...MODELE_CONSIGNES } })}>
                  Rétablir le modèle KLYRA
                </Bouton>
              )}
            </div>
          </>
        )}
      </div>
    </Ligne>
  );
}

/**
 * Ce que le poste ajoute à chaque appel des agents (electron/diagnostic-poste.ts) : lecture seule, avec un
 * conseil et le fichier à ouvrir. Lu à l'ouverture des Réglages ; app de bureau seulement.
 */
function DiagnosticDuPoste() {
  const pont = getBridge()?.reglages;
  const [diagnostic, setDiagnostic] = useState<DiagnosticPoste | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    if (!pont?.diagnosticPoste) return;
    let actif = true;
    pont
      .diagnosticPoste()
      .then((r) => actif && setDiagnostic(unwrap(r)))
      .catch((e: unknown) => actif && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      actif = false;
    };
  }, [pont]);
  if (!pont?.diagnosticPoste) return null;

  return (
    <Ligne
      id="diagnostic-poste"
      libelle="Ce que ton poste ajoute"
      description={
        diagnostic
          ? `Ta configuration personnelle de Claude Code s’ajoute à chaque appel de tes agents : environ ${diagnostic.total.toLocaleString("fr-FR")} jetons, estimés d’après la taille des fichiers. Elle ne se coupe pas sans retirer aussi tes agents ou les consignes de tes projets : allège-la à la source.`
          : "Lecture de ta configuration personnelle de Claude Code…"
      }
      pile
    >
      {diagnostic && (
        <ul data-diagnostic-poste className="m-0 flex w-full list-none flex-col divide-y divide-bordure-subtile p-0">
          {diagnostic.elements.map((e) => (
            <li key={e.cle} data-element={e.cle} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 py-2.5">
              <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
                <span className="text-ui-s font-medium text-texte-principal">
                  {e.libelle}
                  {e.jetons !== null && e.jetons > 0 && <span className="font-normal text-texte-tertiaire"> · environ {e.jetons.toLocaleString("fr-FR")} jetons</span>}
                </span>
                <span className="text-ui-xs leading-[1.45] text-texte-secondaire">{e.detail}</span>
                {e.conseil && <span className="text-ui-xs leading-[1.45] text-texte-principal">{e.conseil}</span>}
              </div>
              {e.chemin && pont.montrerDiagnostic && (
                <Bouton variant="blanc" taille="mini" onClick={() => void pont.montrerDiagnostic!(e.chemin!).then(unwrap).catch((x: unknown) => setErreur(x instanceof Error ? x.message : String(x)))}>
                  Montrer
                </Bouton>
              )}
            </li>
          ))}
        </ul>
      )}
      {erreur && <Erreur>{erreur}</Erreur>}
    </Ligne>
  );
}

/**
 * Réglages › Agents : la configuration KLYRA. La configuration recommandée en un clic, puis chaque
 * réglage à part (configuration-klyra.ts). Rien n'est appliqué sans la personne.
 */
export function GroupeConfigurationKlyra() {
  const { reglages, erreur, changerConfiguration } = useReglages();
  if (!reglages) return null;
  const configuration = reglages.configuration;
  const recommandee = estRecommandee(configuration);

  return (
    <Groupe
      titre="Configuration KLYRA"
      description="Ce que KLYRA te propose pour que tes agents consomment moins de jetons, sans rien perdre en qualité. Elle ne vaut que pour les sessions lancées par l’app, et chaque réglage reste modifiable."
    >
      <Ligne
        id="configuration-klyra"
        libelle="Configuration recommandée"
        description={
          recommandee
            ? "Adoptée : les consignes KLYRA sont ajoutées à tes agents, et leur mémoire est coupée."
            : "Les consignes KLYRA ajoutées à tes agents, et leur mémoire coupée."
        }
      >
        {recommandee ? (
          <Pastille texte="Adoptée" ton="ok" />
        ) : (
          <Bouton variant="sombre" taille="compact" onClick={() => void changerConfiguration(adopter(configuration))}>
            Adopter
          </Bouton>
        )}
      </Ligne>
      <Ligne
        id="memoire-agents"
        libelle="Mémoire des agents"
        description="Ce que la fiche d’un agent lui fait retenir d’une session à l’autre. Elle coûte environ 4 000 jetons à chaque appel de cet agent, même vide. Les fichiers du projet (AGENTS.md, notes) peuvent la remplacer."
      >
        <Interrupteur libelle="Mémoire des agents" actif={configuration.memoireAgents} onChange={(actif) => void changerConfiguration({ memoireAgents: actif })} />
      </Ligne>
      <Consignes configuration={configuration} changer={changerConfiguration} />
      <Ligne
        id="resume-auto"
        libelle="Résumé automatique"
        description="Une conversation lourde est résumée sans que tu le demandes : avant ton message quand elle pèse plus de 80 000 jetons d’échanges, ou après 25 minutes de pause, tant que c’est encore bon marché. Jamais pendant qu’un agent travaille ; une note le dit dans la conversation. Pas encore mesuré : hors de la configuration recommandée."
      >
        <Interrupteur libelle="Résumé automatique" actif={configuration.resumeAuto} onChange={(actif) => void changerConfiguration({ resumeAuto: actif })} />
      </Ligne>
      <DiagnosticDuPoste />
      {erreur && <Erreur>{erreur}</Erreur>}
    </Groupe>
  );
}
