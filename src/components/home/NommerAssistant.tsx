"use client";

import { useState, type FormEvent } from "react";
import { ChampNomAssistant, erreurVisible } from "@/components/team/PersonnaliserAssistant";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { useAgents } from "@/lib/agents";
import { erreurNomAssistant, nomPropre } from "@/lib/noms-agents";
import { jouer } from "@/lib/sons/sons";
import { useWorkspace } from "@/lib/workspace";

/** Le nom gardé si la personne ne veut pas choisir. */
const NOM_PAR_DEFAUT = "Assistant";

/**
 * Premier lancement d'un nouveau profil : à la place de l'Accueil, un seul
 * champ, le nom de l'assistant. Rien n'est écrit dans `~/.claude/agents` : le
 * nom va dans les choix de l'app (`mes-agents.json`), et l'Accueil normal
 * revient, prêt à lui écrire. L'app quittée avant : l'écran revient.
 */
export function NommerAssistant() {
  const { moi } = useWorkspace();
  const { roles, nommerAssistant } = useAgents();
  const [nom, setNom] = useState("");
  const [essai, setEssai] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const erreur = erreurNomAssistant(nom, roles);
  const prenom = moi.name.trim().split(/\s+/)[0] ?? "";

  const enregistrer = async (choisi: string) => {
    if (enCours) return;
    setEnCours(true);
    setEchec(null);
    try {
      await nommerAssistant(choisi);
      jouer("validation");
    } catch (e) {
      setEchec(`Le nom n’a pas pu être enregistré : ${e instanceof Error ? e.message : String(e)}`);
      setEnCours(false);
    }
  };

  const commencer = () => {
    setEssai(true);
    if (erreur) return;
    void enregistrer(nomPropre(nom));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    commencer();
  };

  return (
    <div className="flex h-full overflow-y-auto p-12">
      <form onSubmit={onSubmit} className="m-auto flex w-full max-w-[480px] flex-col gap-5">
        {/* Titre KLYRA : une partie en semi-gras, l'autre en regular, même couleur. */}
        <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
          <span className="font-semibold">{prenom ? `Bonjour ${prenom},` : "Bonjour,"}</span>{" "}
          <span className="font-normal">donne un nom à ton assistant.</span>
        </h1>
        <p className="m-0 text-body-s leading-[1.5] text-texte-secondaire">
          Il répond à tes demandes, travaille dans tes projets et t’aide à créer d’autres agents quand un besoin revient.
        </p>
        <ChampNomAssistant
          libelle="Nom de ton assistant"
          valeur={nom}
          onChange={setNom}
          erreur={echec ?? erreurVisible(nom, erreur, essai)}
          aide="Tu pourras le changer quand tu veux."
          onEntree={commencer}
          autoFocus
        />
        <div className="flex flex-wrap items-center gap-2">
          <BoutonPrincipal type="submit" disabled={!!erreur || enCours}>
            Commencer
          </BoutonPrincipal>
          <Bouton variant="discret" taille="md" disabled={enCours} onClick={() => void enregistrer(NOM_PAR_DEFAUT)}>
            Garder « {NOM_PAR_DEFAUT} »
          </Bouton>
        </div>
      </form>
    </div>
  );
}
