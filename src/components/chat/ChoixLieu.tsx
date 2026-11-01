"use client";

import { Icon } from "@/components/icons/Icon";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useConfirmation } from "@/components/ui/Modale";
import { nomLieu, useServeursRelies } from "@/lib/lieux";
import { useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";

const PC = "pc";

/**
 * Où tournent les agents de cette conversation : ce PC ou un VPS relié (écran Serveurs).
 * Absent tant qu'aucun VPS n'est relié. Changer de machine repart d'une session neuve :
 * l'historique reste affiché, mais l'agent de l'autre machine ne s'en souvient pas.
 */
export function ChoixLieu({ chat }: { chat: Chat }) {
  const { choisirLieu } = useWorkspace();
  const travail = useTravail(chat.id);
  const serveurs = useServeursRelies();
  const [demander, fenetre] = useConfirmation();
  const lieu = chat.lieu ?? null;
  if (!serveurs.length && !lieu) return null;

  const options = [
    { value: PC, label: "Ce PC" },
    ...serveurs.map((s) => ({ value: s.adresse, label: s.nom })),
    ...(lieu && !serveurs.some((s) => s.adresse === lieu) ? [{ value: lieu, label: `${nomLieu(lieu, serveurs)} (plus relié)`, disabled: true }] : []),
  ];

  const changer = async (valeur: string) => {
    const suivant = valeur === PC ? null : valeur;
    if (suivant === lieu) return;
    if (Object.keys(chat.sessions).length) {
      const ok = await demander({
        titre: `Passer sur ${nomLieu(suivant, serveurs)} ?`,
        texte: "La conversation reste affichée, mais l’agent de l’autre machine repart de zéro : il ne se souvient pas de ce qui a été dit ici.",
        confirmer: "Changer de machine",
      });
      if (!ok) return;
    }
    choisirLieu(chat.id, suivant);
  };

  return (
    <>
      <div title={travail ? "Attends la fin du travail en cours pour changer de machine." : `Les agents de cette conversation tournent sur ${nomLieu(lieu, serveurs)}.`}>
        <ListeDeroulante
          libelle="Machine de la conversation"
          variante="compact"
          value={lieu ?? PC}
          options={options}
          icone={<Icon name="globe-01" size={14} />}
          disabled={!!travail}
          onChange={(valeur) => void changer(valeur)}
        />
      </div>
      {fenetre}
    </>
  );
}
