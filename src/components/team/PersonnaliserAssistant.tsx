"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { Input } from "klyra-ui";
import { RondApercu } from "@/components/roles/AgentRond";
import { ChoixTeinte } from "@/components/roles/ChoixTeinte";
import { Bouton } from "@/components/ui/Bouton";
import { CHAMP } from "@/components/ui/Champ";
import { Modale } from "@/components/ui/Modale";
import { useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { erreurNomAssistant, nomPropre } from "@/lib/noms-agents";
import { useRole } from "@/lib/workspace";
import type { RoleTeinte } from "@/types/domain";

/**
 * Le champ du nom de l'assistant (premier lancement, fenêtre « Ton assistant ») :
 * l'aide dessous, ou l'erreur, reliée au champ par `aria-describedby`.
 */
export function ChampNomAssistant({
  libelle,
  valeur,
  onChange,
  erreur,
  aide,
  champRef,
  onEntree,
  autoFocus,
}: {
  libelle: string;
  valeur: string;
  onChange: (valeur: string) => void;
  /** L'erreur à montrer (null : l'aide). */
  erreur: string | null;
  aide?: string;
  champRef?: Ref<HTMLInputElement>;
  /** Entrée dans le champ : la même chose que le bouton qui valide, même s'il est grisé. */
  onEntree: () => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const message = erreur ?? aide;
  const toucher = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    onEntree();
  };
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-champ`} className="text-ui-s font-medium text-texte-principal">
        {libelle}
      </label>
      <Input
        ref={champRef}
        id={`${id}-champ`}
        size="sm"
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={toucher}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        maxLength={64}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={message ? `${id}-message` : undefined}
        className={CHAMP}
      />
      {erreur ? (
        <span id={`${id}-message`} role="alert" className="text-ui-xs text-texte-erreur">
          {erreur}
        </span>
      ) : (
        aide && (
          <span id={`${id}-message`} className="text-ui-xs leading-[1.45] text-texte-tertiaire">
            {aide}
          </span>
        )
      )}
    </div>
  );
}

/**
 * L'erreur du nom à montrer : une règle enfreinte dès qu'un nom est écrit (le
 * bouton est grisé, on dit pourquoi), le champ vide seulement après un essai.
 */
export function erreurVisible(nom: string, erreur: string | null, essai: boolean): string | null {
  return essai || nom.trim() ? erreur : null;
}

/**
 * « Ton assistant » : son nom (mêmes règles qu'au premier lancement) et sa
 * couleur, avec l'aperçu de l'avatar. Gardés sur l'ordinateur, appliqués
 * partout tout de suite ; l'identifiant `principal` et ses conversations ne
 * bougent pas. Ouverte depuis sa fiche et depuis Réglages › Agents.
 */
export function ModalePersonnaliserAssistant({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  if (!ouvert) return null;
  return <FenetreAssistant onFermer={onFermer} />;
}

function FenetreAssistant({ onFermer }: { onFermer: () => void }) {
  const { roles, nommerAssistant, canEdit } = useAgents();
  const assistant = useRole("principal");
  const formulaire = useId();
  const champ = useRef<HTMLInputElement>(null);
  const [nom, setNom] = useState(assistant.name);
  const [teinte, setTeinte] = useState<RoleTeinte>(assistant.teinte);
  const [essai, setEssai] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const erreur = erreurNomAssistant(nom, roles);

  /* Après la fenêtre (qui donne le focus au premier champ) : le nom, sélectionné, prêt à être remplacé. */
  useEffect(() => {
    champ.current?.focus();
    champ.current?.select();
  }, []);

  const enregistrer = async () => {
    setEssai(true);
    if (erreur || enCours) return;
    const propre = nomPropre(nom);
    setEnCours(true);
    setEchec(null);
    try {
      await nommerAssistant(propre, teinte);
      annoncer(`Assistant enregistré : ${propre}.`);
      onFermer();
    } catch (e) {
      setEchec(`L’enregistrement a échoué : ${e instanceof Error ? e.message : String(e)}`);
      setEnCours(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void enregistrer();
  };

  return (
    <Modale
      titre="Ton assistant"
      onFermer={onFermer}
      className="w-[440px]"
      actions={
        <>
          <Bouton variant="blanc" taille="md" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton type="submit" form={formulaire} variant="sombre" taille="md" disabled={!!erreur || enCours || !canEdit}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </Bouton>
        </>
      }
    >
      <form id={formulaire} onSubmit={onSubmit} className="flex flex-col gap-5 pt-2">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <ChampNomAssistant
              libelle="Nom"
              valeur={nom}
              onChange={setNom}
              erreur={echec ?? erreurVisible(nom, erreur, essai)}
              aide="Son nom dans les conversations, les mentions @ et Mes agents."
              champRef={champ}
              onEntree={() => void enregistrer()}
            />
          </div>
          <RondApercu nom={nomPropre(nom) || assistant.name} teinte={teinte} taille={56} libelle="Aperçu de son avatar" className="mt-7" />
        </div>
        <div className="flex flex-col gap-2">
          <span id={`${formulaire}-couleur`} className="text-ui-s font-medium text-texte-principal">
            Couleur
          </span>
          <ChoixTeinte valeur={teinte} onChange={setTeinte} libelleId={`${formulaire}-couleur`} />
        </div>
        {!canEdit && <p className="m-0 text-ui-xs text-texte-tertiaire">Le nom et la couleur se changent dans l’app de bureau.</p>}
      </form>
    </Modale>
  );
}
