"use client";

import { useState } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { messageErreur, useCompte, useMonIdentite } from "@/lib/compte";
import { Erreur, Groupe, Ligne } from "./ui";

const decrire = ({ nom, intitule }: { nom: string; intitule: string }) => `« ${nom.trim() || "sans nom"} · ${intitule.trim() || "sans rôle"} »`;

/**
 * Connecté, si le nom ou le rôle de cet ordinateur diffère de celui du compte
 * d'équipe : rien n'est recopié tout seul. On choisit lequel garder, et on peut
 * annuler juste après. La photo et les préférences ne sont pas concernées.
 */
export function AccordProfils() {
  const { ecart, enregistrer, garderIci } = useMonIdentite();
  const { modifierMonProfil } = useCompte();
  const [fait, setFait] = useState<{ message: string; annuler: () => Promise<void> } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const agir = async (action: () => Promise<void>) => {
    setErreur(null);
    setEnCours(true);
    try {
      await action();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };

  if (!ecart && !fait) return null;

  return (
    <Groupe>
      {ecart ? (
        <Ligne
          libelle="Ton profil sur cet ordinateur diffère de ton profil d’équipe"
          description={`Ici : ${decrire(ecart.localBrut)}. Équipe : ${decrire(ecart.compte)}. Tant que tu es connecté, l’app et les agents utilisent celui de l’équipe. Rien n’est effacé : choisis lequel garder.`}
          pile
        >
          <div className="flex flex-wrap gap-2">
            <Bouton
              variant="blanc"
              taille="compact"
              disabled={enCours || !ecart.local}
              title={ecart.local ? undefined : "Le nom de cet ordinateur est vide ou trop long pour l’équipe."}
              onClick={() =>
                void agir(async () => {
                  const avant = ecart.compte;
                  await enregistrer(ecart.local!.nom, ecart.local!.intitule);
                  setFait({
                    message: "Ton profil d’équipe reprend celui de cet ordinateur.",
                    annuler: () => modifierMonProfil(avant).catch((e: unknown) => Promise.reject(new Error(messageErreur(e)))),
                  });
                })
              }
            >
              Utiliser celui de cet ordinateur
            </Bouton>
            <Bouton
              variant="blanc"
              taille="compact"
              disabled={enCours}
              onClick={() =>
                void agir(async () => {
                  const avant = ecart.localBrut;
                  garderIci(ecart.compte.nom, ecart.compte.intitule);
                  setFait({ message: "Cet ordinateur reprend ton profil d’équipe.", annuler: async () => garderIci(avant.nom, avant.intitule) });
                })
              }
            >
              Garder celui de l’équipe
            </Bouton>
          </div>
        </Ligne>
      ) : (
        fait && (
          <Ligne libelle={fait.message} description="La photo et les préférences de cet ordinateur n’ont pas changé.">
            <Bouton
              variant="discret"
              taille="compact"
              disabled={enCours}
              onClick={() =>
                void agir(async () => {
                  await fait.annuler();
                  setFait(null);
                })
              }
            >
              Annuler
            </Bouton>
            <Bouton variant="discret" taille="compact" disabled={enCours} onClick={() => setFait(null)}>
              OK
            </Bouton>
          </Ligne>
        )
      )}
      {erreur && <Erreur>{erreur}</Erreur>}
    </Groupe>
  );
}
