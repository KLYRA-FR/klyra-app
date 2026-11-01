"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Bouton } from "@/components/ui/Bouton";
import { messageErreur } from "@/lib/compte";
import { attenteEnvoi, bandeauComposeur } from "@/lib/poste-texte";
import { EnteteTelephone } from "./EnteteTelephone";
import { usePostes } from "./poste";

/** T-02. L'envoi passe par le compte. La barre du bas est cachée par la coque. */
export function FilTelephone() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const fil = useQuery(api.conversationsCompte.messages, id ? { origine: id } : "skip");
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const attente = useQuery(api.conversationsCompte.enAttente, {});
  const laisser = useMutation(api.conversationsCompte.laisser);
  const annuler = useMutation(api.conversationsCompte.annuler);
  const { principal, ouvert } = usePostes();
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const titre = conversations?.find((c) => c.origine === id)?.titre ?? "Conversation";
  const bandeau = ouvert ? null : bandeauComposeur(principal);
  const enAttente = (attente ?? []).filter((m) => m.conversationOrigine === id);

  const envoyer = async (e: FormEvent) => {
    e.preventDefault();
    const propre = texte.trim();
    if (!propre || !id) return;
    setOccupe(true);
    setErreur(null);
    try {
      await laisser({ conversationOrigine: id, texte: propre });
      setTexte("");
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={titre} retour={() => router.push("/chats")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {fil === undefined ? (
          <div className="h-16 rounded-md bg-fond-surface-grise" />
        ) : (
          <ul className="flex flex-col gap-3">
            {fil.messages.map((message) => (
              <li key={message.origine} className={message.auteurKind === "user" ? "self-end" : "self-start"}>
                <p className="max-w-[85vw] rounded-md bg-fond-surface px-3 py-2 text-body-s whitespace-pre-wrap text-texte-principal">{message.texte}</p>
              </li>
            ))}
            {enAttente.map((message) => (
              <li key={message._id} className="self-end">
                <p className="max-w-[85vw] rounded-md bg-fond-surface px-3 py-2 text-body-s text-texte-principal">{message.texte}</p>
                <div className="mt-1 text-ui-xs text-texte-secondaire">
                  {attenteEnvoi(principal)}
                  {" · "}
                  <button type="button" className="min-h-11 text-texte-principal" onClick={() => void annuler({ id: message._id })}>
                    Annuler l’envoi
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={(e) => void envoyer(e)} className="shrink-0 border-t border-bordure-subtile bg-fond-surface px-3 py-2 pb-[calc(8px+env(safe-area-inset-bottom))]">
        {bandeau ? <p className="mb-2 text-ui-xs text-texte-secondaire">{bandeau}</p> : null}
        {erreur ? (
          <p role="alert" className="mb-2 text-ui text-texte-principal">
            {erreur}
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            aria-label="Message"
            rows={1}
            className="max-h-40 min-h-12 flex-1 resize-none rounded-md border border-bordure-champ bg-fond-page px-3 py-3 text-body-s text-texte-principal"
          />
          <Bouton type="submit" variant="sombre" disabled={occupe || !texte.trim()} className="h-12">
            Envoyer
          </Bouton>
        </div>
      </form>
    </div>
  );
}
