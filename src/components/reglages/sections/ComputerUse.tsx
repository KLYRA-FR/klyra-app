"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge, type AutorisationsComputerUse, type EtatAutorisation } from "@/lib/bridge";
import { useReglages } from "@/lib/reglages";
import { Erreur, Groupe, Interrupteur, Ligne, SeulementBureau, Pastille } from "../ui";

const ETATS: Record<EtatAutorisation, { texte: string; ton: "ok" | "attente" | "neutre" }> = {
  accordee: { texte: "Accordée", ton: "ok" },
  refusee: { texte: "Pas encore accordée", ton: "attente" },
  "a-demander": { texte: "Pas encore demandée", ton: "attente" },
  "sans-objet": { texte: "Rien à autoriser", ton: "neutre" },
  inconnue: { texte: "Inconnue sur ce système", ton: "neutre" },
};

/**
 * Computer Use : l'interrupteur qui autorise les agents à piloter
 * l'ordinateur, et les autorisations que le système doit donner à l'app. Le
 * pilotage lui-même est un chantier à part (docs/COMPUTER-USE-PLAN.md) ; il ne
 * fera rien tant que cet interrupteur est coupé.
 */
export function ComputerUse() {
  const { reglages, erreur, changerComputerUse, systeme } = useReglages();
  const pont = getBridge()?.reglages;
  const [autorisations, setAutorisations] = useState<AutorisationsComputerUse | null>(null);
  const [erreurOuverture, setErreurOuverture] = useState<string | null>(null);

  const lire = useCallback(() => {
    if (!pont) return;
    void pont.autorisationsComputerUse().then((r) => r.ok && setAutorisations(r.data));
  }, [pont]);

  /* Relues au retour dans l'app : la personne vient peut-être de les accorder dans le système. */
  useEffect(() => {
    lire();
    window.addEventListener("focus", lire);
    return () => window.removeEventListener("focus", lire);
  }, [lire]);

  const ouvrir = async (type: "accessibilite" | "ecran") => {
    if (!pont) return;
    const r = await pont.ouvrirAutorisation(type);
    setErreurOuverture(r.ok ? null : r.message);
  };

  const mac = autorisations?.plateforme === "darwin";

  return (
    <>
      <Groupe>
        <Ligne
          id="computer-use-actif"
          libelle="Laisser les agents piloter l’ordinateur"
          description="Captures d’écran, clics et clavier, avec ton accord avant chaque action. Le pilotage arrive dans une prochaine version : tant que ce réglage est coupé, aucun agent ne touchera à ton écran."
        >
          <Interrupteur
            libelle="Laisser les agents piloter l’ordinateur"
            actif={!!reglages?.computerUse.actif}
            disabled={!reglages}
            onChange={(v) => void changerComputerUse(v)}
          />
        </Ligne>
        {erreur && <Erreur>{erreur}</Erreur>}
      </Groupe>

      <Groupe
        titre="Autorisations du système"
        description={
          !systeme
            ? undefined
            : mac
              ? "macOS doit autoriser KLYRA à piloter les autres apps et à voir l’écran. Accorde-les dans les réglages du système, puis reviens ici."
              : autorisations?.plateforme === "win32"
                ? "Windows ne demande pas d’autorisation pour ça."
                : undefined
        }
      >
        <Ligne id="autorisation-accessibilite" libelle="Accessibilité" description="Pour cliquer et taper au clavier dans les autres apps.">
          {!pont ? (
            <SeulementBureau />
          ) : (
            <>
              {autorisations && <Pastille {...ETATS[autorisations.accessibilite]} />}
              {mac && autorisations?.accessibilite !== "accordee" && (
                <Bouton variant="blanc" taille="compact" iconeDroite={<Icon name="link-external" size={16} />} onClick={() => void ouvrir("accessibilite")}>
                  Ouvrir les réglages
                </Bouton>
              )}
            </>
          )}
        </Ligne>
        <Ligne id="autorisation-ecran" libelle="Enregistrement de l’écran" description="Pour que l’agent voie ce qu’il fait (captures).">
          {!pont ? (
            <SeulementBureau />
          ) : (
            <>
              {autorisations && <Pastille {...ETATS[autorisations.ecran]} />}
              {mac && autorisations?.ecran !== "accordee" && (
                <Bouton variant="blanc" taille="compact" iconeDroite={<Icon name="link-external" size={16} />} onClick={() => void ouvrir("ecran")}>
                  Ouvrir les réglages
                </Bouton>
              )}
            </>
          )}
        </Ligne>
        {erreurOuverture && <Erreur>{erreurOuverture}</Erreur>}
      </Groupe>
    </>
  );
}
