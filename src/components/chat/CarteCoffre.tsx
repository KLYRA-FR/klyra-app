"use client";

import { useChat } from "@/lib/workspace";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/icons/Icon";
import { ChampSecret } from "@/components/reglages/sections/Coffre";
import { Bouton } from "@/components/ui/Bouton";
import { GENRES_SECRET, messageReponseCoffre, secretDe, useCoffreKlyra } from "@/lib/coffre";
import { formatTime } from "@/lib/format";
import type { MessagePart } from "@/types/domain";

/**
 * La carte sécurisée d'une demande de secret (outil `coffre_demander`) : la personne colle la clé
 * ou le mot de passe dans un champ masqué, la valeur part droit au Coffre (electron/coffre.ts),
 * chiffrée aussitôt, sans entrer dans la conversation ; l'agent reçoit un message qui ne dit que le
 * nom de la variable. Le champ est vidé dès que la valeur est partie.
 */

type Part = Extract<MessagePart, { type: "coffre-demande" }>;
type Etat = "rangee" | "permise" | "refusee";

const FIGEE: Record<Etat, { icone: "check-01" | "x-01"; texte: string }> = {
  rangee: { icone: "check-01", texte: "Rangé dans le coffre" },
  permise: { icone: "check-01", texte: "Permis depuis le coffre" },
  refusee: { icone: "x-01", texte: "Refusé" },
};

export function CarteCoffre({
  part,
  nomAgent,
  onRepondre,
}: {
  part: Part;
  nomAgent: string;
  /** Note la réponse sur la carte et l'écrit à l'agent (jamais la valeur). */
  onRepondre: (etat: Etat, message: string) => void;
}) {
  if (part.reponse) {
    const f = FIGEE[part.reponse.etat];
    return (
      <div className="flex max-w-[680px] items-center gap-1.5 px-1 text-ui-xs text-texte-tertiaire">
        <Icon name={f.icone} size={14} />
        <Icon name="lock-01" size={14} />
        <span className="truncate">
          {f.texte} : {part.nom} ({part.variable}) · {formatTime(part.reponse.le)}
        </span>
      </div>
    );
  }
  return <CarteOuverte part={part} nomAgent={nomAgent} onRepondre={onRepondre} />;
}

function CarteOuverte({ part, nomAgent, onRepondre }: { part: Part; nomAgent: string; onRepondre: (etat: Etat, message: string) => void }) {
  /* Le coffre du serveur de cette conversation, quel que soit le serveur affiché. */
  const chat = useChat(useSearchParams().get("id"));
  const coffre = useCoffreKlyra(chat ? (chat.lieu ?? null) : undefined);
  const [valeur, setValeur] = useState("");
  const [remplacer, setRemplacer] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const existant = secretDe(coffre.etat, part.variable);
  const demanderValeur = !existant || remplacer;

  const repondre = (etat: Etat) => onRepondre(etat, messageReponseCoffre(etat, part));

  const ranger = async (e: FormEvent) => {
    e.preventDefault();
    if (!valeur || envoi) return;
    setEnvoi(true);
    const r = await coffre.ajouter({ variable: part.variable, nom: part.nom, genre: part.genre, service: part.service, valeur, agents: true }, !!existant);
    // La valeur ne reste pas dans l'écran, réussite ou non : en cas d'erreur, on la recolle.
    setValeur("");
    setEnvoi(false);
    if (r) repondre("rangee");
  };

  const permettre = async () => {
    if (!existant) return;
    if (!existant.agents && !(await coffre.modifier(existant.id, { agents: true }))) return;
    repondre("permise");
  };

  return (
    <section
      aria-label={`${nomAgent} demande ${part.nom}`}
      className="flex w-full max-w-[680px] flex-col gap-3 rounded-lg border border-bordure-defaut bg-fond-surface p-4 shadow-ombre-xs"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-fond-surface-grise text-icone-defaut">
          <Icon name="lock-01" size={18} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-ui-s font-semibold text-texte-principal">
            {nomAgent} te demande {part.genre === "mot-de-passe" ? "un mot de passe" : part.genre === "jeton" ? "un jeton" : part.genre === "cle-api" ? "une clé API" : "un secret"}
          </span>
          <span className="flex flex-wrap items-baseline gap-x-2 text-ui-s text-texte-principal">
            {part.nom}
            <span className="text-ui-2xs font-medium text-texte-secondaire">{part.variable}</span>
          </span>
          {part.raison && <span className="text-ui-xs leading-[1.45] text-texte-secondaire">{part.raison}</span>}
          {(part.service || part.ouTrouver) && (
            <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">
              {[part.service, part.ouTrouver].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      </div>

      {!coffre.disponible ? (
        <span className="text-ui-xs text-texte-tertiaire">Le coffre est dans l’app de bureau : ouvre cette conversation sur ton ordinateur pour la lui donner.</span>
      ) : !coffre.etat ? (
        <span className="text-ui-xs text-texte-tertiaire">Lecture du coffre…</span>
      ) : demanderValeur ? (
        <form onSubmit={ranger} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <ChampSecret valeur={valeur} onChange={setValeur} libelle={`${GENRES_SECRET[part.genre]} ${part.variable}`} autoFocus={remplacer} />
            <Bouton type="submit" variant="sombre" taille="compact" disabled={!valeur || envoi || !coffre.etat.chiffrement}>
              {envoi ? "Chiffrement…" : remplacer ? "Remplacer dans le coffre" : "Ranger dans le coffre"}
            </Bouton>
          </div>
          <span className="flex items-start gap-1.5 text-ui-2xs leading-[1.45] text-texte-tertiaire">
            <Icon name="shield-check" size={14} className="mt-px shrink-0 text-icone-secondaire" />
            Ce que tu colles ici ne passe pas par la conversation : c’est chiffré par le trousseau de ton ordinateur et rangé dans le coffre. {nomAgent} ne voit jamais la valeur ; il peut l’écrire dans un fichier hors de Git, avec ton accord.
          </span>
        </form>
      ) : (
        <span className="text-ui-xs leading-[1.45] text-texte-secondaire">
          {existant!.agents ? "Déjà dans ton coffre." : "Déjà dans ton coffre, mais pas encore permis à tes agents."} Rangé {formatTime(new Date(existant!.modifieLe).toISOString())}.
        </span>
      )}

      {coffre.erreur && (
        <p role="alert" className="m-0 text-ui-xs text-texte-erreur">
          {coffre.erreur}
        </p>
      )}
      {!coffre.etat?.chiffrement && coffre.etat && <span className="text-ui-xs text-texte-erreur">Le trousseau de cet ordinateur est indisponible : rien ne peut être rangé.</span>}

      {coffre.disponible && coffre.etat && (
        <div className="flex flex-wrap gap-2">
          {existant && !remplacer && (
            <>
              <Bouton variant="sombre" taille="compact" onClick={() => void permettre()}>
                {existant.agents ? "C’est bon, à toi" : "Le lui permettre"}
              </Bouton>
              <Bouton variant="blanc" taille="compact" onClick={() => setRemplacer(true)}>
                Remplacer la valeur
              </Bouton>
            </>
          )}
          {existant && remplacer && (
            <Bouton variant="discret" taille="compact" onClick={() => setRemplacer(false)}>
              Garder la valeur actuelle
            </Bouton>
          )}
          <Bouton variant="discret" taille="compact" onClick={() => repondre("refusee")}>
            Refuser
          </Bouton>
        </div>
      )}
    </section>
  );
}
