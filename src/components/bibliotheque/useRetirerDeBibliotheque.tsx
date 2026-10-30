"use client";

import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bouton } from "@/components/ui/Bouton";
import { Modale } from "@/components/ui/Modale";
import { useAgents, type AgentLocal } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { useBibliotheque } from "@/lib/bibliotheque";
import { raison } from "@/lib/bibliotheque-ui";
import { lienDe } from "@/lib/lien-bibliotheque";
import { useSession } from "./commun";

interface Retrait {
  nom: string;
  retirer: () => Promise<void>;
}

/** La confirmation du retrait (spec §12) ; un échec laisse la fenêtre ouverte, avec sa raison. */
function FenetreRetrait({ nom, retirer, onFermer }: Retrait & { onFermer: (fait: boolean) => void }) {
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const confirmer = async () => {
    setOccupe(true);
    setMessage(null);
    try {
      await retirer();
      annoncer(`${nom} retiré de la bibliothèque.`);
      onFermer(true);
    } catch (e) {
      setOccupe(false);
      setMessage(`Le retrait n’a pas abouti : ${raison(e)}. ${nom} est toujours dans la bibliothèque.`);
    }
  };

  return (
    <Modale
      role="alertdialog"
      titre={`Retirer ${nom} de la bibliothèque ?`}
      onFermer={() => onFermer(false)}
      actions={
        <>
          <Bouton variant="blanc" taille="md" data-autofocus onClick={() => onFermer(false)}>
            Annuler
          </Bouton>
          <Bouton variant="sombre" taille="md" disabled={occupe} onClick={() => void confirmer()}>
            {message ? "Réessayer" : "Retirer"}
          </Bouton>
        </>
      }
    >
      <p className="m-0">Ceux qui l’ont ajouté le gardent, en copie privée. Ta fiche ne change pas.</p>
      {message && (
        <p role="alert" className="m-0 mt-3 rounded-md border border-bordure-erreur bg-fond-surface p-3 text-ui-s text-texte-erreur">
          {message}
        </p>
      )}
    </Modale>
  );
}

/**
 * Ouvre la confirmation hors de l'arbre de l'écran (racine à part, retirée à la fermeture) :
 * l'appelant n'a rien à rendre. Vrai si la définition a été retirée.
 */
export function ouvrirRetrait(retrait: Retrait): Promise<boolean> {
  return new Promise((resoudre) => {
    const hote = document.createElement("div");
    document.body.appendChild(hote);
    const racine = createRoot(hote);
    const fermer = (fait: boolean) => {
      // Démontée après l'événement qui la ferme : pas pendant le rendu de sa propre racine.
      setTimeout(() => {
        racine.unmount();
        hote.remove();
      }, 0);
      resoudre(fait);
    };
    racine.render(<FenetreRetrait {...retrait} onFermer={fermer} />);
  });
}

/**
 * « Retirer de la bibliothèque » depuis la fiche d'un agent (auteur seulement, d'après le serveur) :
 * confirmation, retrait, puis l'agent redevient « à moi, non partagé ». Ne rend rien.
 */
export function useRetirerDeBibliotheque(): (agent: AgentLocal) => Promise<void> {
  const session = useSession();
  const { retirer } = useBibliotheque();
  const { changerOrigine } = useAgents();

  return useCallback(
    async (agent: AgentLocal) => {
      const lien = lienDe(agent, session);
      if (lien.type !== "publie") return;
      await ouvrirRetrait({
        nom: agent.role.name,
        retirer: async () => {
          await retirer(lien.definitionId);
          if (agent.entree?.origine.type === "local") {
            // Sans effet visible si cela échoue : le serveur dit déjà qu'elle est retirée.
            await changerOrigine(agent.role.id, { type: "local" }).catch(() => undefined);
          }
        },
      });
    },
    [session, retirer, changerOrigine],
  );
}
