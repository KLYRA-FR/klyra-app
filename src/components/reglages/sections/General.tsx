"use client";

import { useEffect, useState } from "react";
import { Kbd } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge, unwrap, type DossierApp, type InfosApp, type Lancement } from "@/lib/bridge";
import { estMac } from "@/lib/raccourcis";
import { Erreur, Groupe, Interrupteur, Ligne, SeulementBureau, Valeur } from "../ui";

const NOMS_PLATEFORME: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/** Les raccourcis qui existent dans l'app, groupés par écran. */
function useRaccourcis() {
  const mod = estMac() ? "⌘" : "Ctrl";
  return [
    {
      ecran: "Partout",
      touches: [
        { keys: [mod, ","], action: "Ouvrir les Réglages" },
        { keys: [mod, "K"], action: "Rechercher dans les conversations" },
      ],
    },
    {
      ecran: "Réglages",
      touches: [
        { keys: [mod, "F"], action: "Rechercher dans les réglages" },
        { keys: ["↑", "↓"], action: "Passer d’une section à l’autre" },
      ],
    },
    {
      ecran: "Conversation",
      touches: [
        { keys: ["Entrée"], action: "Envoyer le message" },
        { keys: ["Maj", "Entrée"], action: "Aller à la ligne" },
        { keys: ["@"], action: "Mentionner un agent" },
      ],
    },
    {
      ecran: "Workflows",
      touches: [
        { keys: [mod, "Z"], action: "Annuler" },
        { keys: [mod, "Y"], action: "Rétablir" },
        { keys: [mod, "D"], action: "Dupliquer la sélection" },
        { keys: [mod, "F"], action: "Chercher dans le canevas" },
        { keys: ["A"], action: "Ajouter un nœud" },
        { keys: ["V"], action: "Sélection" },
        { keys: ["H"], action: "Main (se déplacer)" },
        { keys: ["+", "−", "0"], action: "Zoomer, dézoomer, 100 %" },
        { keys: ["Suppr"], action: "Supprimer la sélection" },
      ],
    },
  ];
}

function Raccourcis() {
  const groupes = useRaccourcis();
  return (
    <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 @2xl:grid-cols-2">
      {groupes.map((g) => (
        <div key={g.ecran} className="flex flex-col gap-1.5">
          <span className="text-ui-2xs font-medium text-texte-tertiaire">{g.ecran}</span>
          <dl className="m-0 flex flex-col gap-1">
            {g.touches.map((t) => (
              <div key={t.action} className="flex items-center justify-between gap-3 text-ui-xs">
                <dt className="text-texte-secondaire">{t.action}</dt>
                <dd className="m-0 flex shrink-0 gap-1">
                  {t.keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function BoutonOuvrir({ dossier }: { dossier: DossierApp }) {
  const [erreur, setErreur] = useState<string | null>(null);
  const pont = getBridge()?.reglages;
  if (!pont) return null;
  return (
    <>
      <Bouton
        variant="blanc"
        taille="compact"
        iconeGauche={<Icon name="folder-open-01" size={16} />}
        onClick={() => void pont.ouvrirDossier(dossier).then((r) => setErreur(r.ok ? null : r.message))}
      >
        Ouvrir
      </Bouton>
      {erreur && <Erreur>{erreur}</Erreur>}
    </>
  );
}

export function General() {
  const pont = getBridge()?.reglages;
  const [lancement, setLancement] = useState<Lancement | null>(null);
  const [infos, setInfos] = useState<InfosApp | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!pont) return;
    void pont.lancement().then((r) => r.ok && setLancement(r.data));
    void pont.infos().then((r) => r.ok && setInfos(r.data));
  }, [pont]);

  const changer = async (actif: boolean) => {
    if (!pont) return;
    setErreur(null);
    try {
      setLancement(unwrap(await pont.changerLancement(actif)));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Groupe titre="Démarrage">
        <Ligne
          id="lancement"
          libelle="Ouvrir KLYRA au démarrage"
          description="L’app s’ouvre quand tu allumes ton ordinateur : les agents et les rappels sont prêts."
        >
          {!pont ? (
            <SeulementBureau />
          ) : lancement && !lancement.possible ? (
            <SeulementBureau>Se règle dans l’app installée (Mac ou Windows).</SeulementBureau>
          ) : (
            <Interrupteur libelle="Ouvrir KLYRA au démarrage" actif={!!lancement?.actif} disabled={!lancement} onChange={(a) => void changer(a)} />
          )}
        </Ligne>
        {erreur && <Erreur>{erreur}</Erreur>}
      </Groupe>

      <Groupe>
        <Ligne id="raccourcis" libelle="Raccourcis clavier" description="Les raccourcis de l’app. Ils ne se modifient pas encore." pile>
          <Raccourcis />
        </Ligne>
      </Groupe>

      <Groupe titre="Dossiers" description="Où l’app range ce qu’elle garde sur cet ordinateur.">
        <Ligne
          id="dossier-donnees"
          libelle="Données de l’app"
          description={infos ? <span className="klyra-mono">{infos.dossiers.donnees}</span> : "Conversations, projets, réglages."}
        >
          {pont ? <BoutonOuvrir dossier="donnees" /> : <SeulementBureau />}
        </Ligne>
        <Ligne
          id="dossier-klyra"
          libelle="Atelier, planning et dictée"
          description={infos ? <span className="klyra-mono">{infos.dossiers.klyra}</span> : "Le dossier ~/.klyra."}
        >
          {pont ? <BoutonOuvrir dossier="klyra" /> : <SeulementBureau />}
        </Ligne>
      </Groupe>

      <Groupe titre="À propos">
        <Ligne id="version" libelle="KLYRA" description={infos ? `${NOMS_PLATEFORME[infos.plateforme] ?? infos.plateforme} · Electron ${infos.electron}` : undefined}>
          <Valeur>{infos ? `Version ${infos.version}${infos.installee ? "" : " (développement)"}` : "Version de développement"}</Valeur>
        </Ligne>
      </Groupe>
    </>
  );
}
