"use client";

import { useState } from "react";
import { ListeCoffre } from "@/components/chat/navigateur/Coffre";
import { Bouton } from "@/components/ui/Bouton";
import { useConfirmation } from "@/components/ui/Modale";
import { getBridge } from "@/lib/bridge";
import { useReglages } from "@/lib/reglages";
import { Erreur, Groupe, Interrupteur, Ligne, SeulementBureau } from "../ui";

/**
 * Le navigateur de KLYRA (electron/navigateur/) : les pages que les agents
 * utilisent pour toi, visibles dans le panneau de chaque conversation.
 */
export function Navigateur() {
  const { reglages, erreur, changerNavigateur } = useReglages();
  const pont = getBridge()?.navigateur;
  const [demander, fenetre] = useConfirmation();
  const [efface, setEfface] = useState<"non" | "en-cours" | "fait">("non");
  const [erreurEffacer, setErreurEffacer] = useState<string | null>(null);

  const effacer = async () => {
    if (!pont) return;
    const oui = await demander({
      titre: "Effacer les données de navigation ?",
      texte: "Les connexions, cookies et fichiers gardés par les sites dans le navigateur de KLYRA sont effacés. Tes onglets restent ouverts ; il faudra te reconnecter aux sites.",
      confirmer: "Effacer",
    });
    if (!oui) return;
    setEfface("en-cours");
    const r = await pont.effacer();
    setErreurEffacer(r.ok ? null : r.message);
    setEfface(r.ok ? "fait" : "non");
  };

  return (
    <>
      <Groupe>
        <Ligne
          id="navigateur-agents"
          libelle="Laisser les agents utiliser le navigateur"
          description="Tes agents ouvrent des pages, les lisent, cliquent et remplissent des formulaires dans le navigateur de KLYRA. Tu vois chaque onglet dans le panneau de la conversation et tu peux reprendre la main à tout moment. En accès « Projet », ils lisent librement et demandent ton accord avant d’agir. Jamais de mot de passe, de code ni de carte : ils te passent la main."
        >
          <Interrupteur
            libelle="Laisser les agents utiliser le navigateur"
            actif={reglages?.navigateur.agents ?? true}
            disabled={!reglages}
            onChange={(v) => void changerNavigateur(v)}
          />
        </Ligne>
        {erreur && <Erreur>{erreur}</Erreur>}
      </Groupe>

      <Groupe
        titre="Données de navigation"
        description="Le navigateur a sa propre session, séparée de ton navigateur habituel et du reste de l’app : une connexion faite dans un onglet sert à tes agents dans toutes les conversations."
      >
        <Ligne id="navigateur-donnees" libelle="Connexions et cookies" description="Efface ce que les sites ont gardé : connexions, cookies, cache.">
          {!pont ? (
            <SeulementBureau />
          ) : (
            <Bouton variant="blanc" taille="compact" disabled={efface === "en-cours"} onClick={() => void effacer()}>
              {efface === "en-cours" ? "Effacement…" : efface === "fait" ? "Effacé" : "Effacer"}
            </Bouton>
          )}
        </Ligne>
        {erreurEffacer && <Erreur>{erreurEffacer}</Erreur>}
        <Ligne
          id="navigateur-telechargements"
          libelle="Téléchargements"
          description="Les fichiers téléchargés dans le navigateur vont dans ton dossier Téléchargements ; l’onglet les montre, et l’agent sait où ils sont."
        />
      </Groupe>

      <Groupe
        titre="Mots de passe"
        description="Le coffre du navigateur : chiffré par le trousseau de ton ordinateur, jamais montré à un agent. « Remplir » est aussi dans la barre de chaque onglet ; un agent que tu y autorises remplit la page de connexion sans voir le mot de passe."
      >
        <Ligne id="navigateur-coffre" libelle="Connexions enregistrées" pile>
          {pont ? <ListeCoffre /> : <SeulementBureau />}
        </Ligne>
      </Groupe>
      {fenetre}
    </>
  );
}
