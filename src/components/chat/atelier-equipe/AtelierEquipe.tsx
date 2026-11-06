"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import {
  equipeAffichee,
  etapeEquipe,
  membresTouches,
  pretAValider,
  texteGroupesValides,
  texteTachesValidees,
  type EtapeEquipe,
  type EtatEquipe,
} from "@/lib/atelier-equipe";
import { ajouterAuBrouillon } from "@/lib/brouillons";
import { cn } from "@/lib/cn";
import { useChatMessages, useRole, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";
import { DansAtelierEquipe } from "./ouvrir";
import { TableTaches } from "./TableTaches";
import { CartesMembres, DetailMembre, QuiSenCharge } from "./TableMembres";
import { useEquipe } from "./useEquipe";

/**
 * L'atelier d'une équipe en grand : la table prend la place de la conversation, la conversation avec
 * l'assistant passe dans une colonne à droite (son fil et son composeur, ceux de ChatScreen). Trois
 * temps : ses tâches, les regrouper, son équipe. Ce qu'elle valide part à l'assistant comme un
 * message ; ce qu'elle choisit sur la table est noté sur la carte (cf. electron/atelier-equipe.ts).
 */

const ETAPES: { cle: EtapeEquipe; titre: string; sousTitre: string }[] = [
  { cle: "taches", titre: "Tes tâches", sousTitre: "Ce qui revient dans ta semaine, avec tes mots. Garde, retire ou ajoute : rien n’est créé à ce stade." },
  { cle: "groupes", titre: "Les regrouper", sousTitre: "Des groupes proposés. Glisse une tâche d’un groupe à l’autre : chaque groupe deviendra un agent." },
  { cle: "equipe", titre: "Ton équipe", sousTitre: "" },
];
const rang = (e: EtapeEquipe) => ETAPES.findIndex((x) => x.cle === e);

export function AtelierEquipe({
  chat,
  fil,
  composeur,
  demande,
  onFermer,
}: {
  chat: Chat;
  /** Le fil de la conversation, ses cartes d'équipe repliées en une ligne. */
  fil: ReactNode;
  /** Le composeur de la conversation (et ce qui l'accompagne). */
  composeur: ReactNode;
  /** Le membre à montrer, demandé depuis le fil (n : pour la redemander). */
  demande: { membre?: string; n: number };
  onFermer: () => void;
}) {
  const messages = useChatMessages(chat.id);
  const affichee = useMemo(() => equipeAffichee(messages), [messages]);
  const assistant = useRole("principal");
  /** Le prénom (ou le rôle) de l'agent montré, pour les débuts de message. */
  const [montre, setMontre] = useState<string | null>(null);

  /* Échap revient à la conversation, sauf dans un champ ou un menu ouvert. */
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const cible = e.target as HTMLElement | null;
      if (cible?.closest("input, textarea, [contenteditable]") || document.querySelector('[role="menu"], [role="listbox"], [role="dialog"]')) return;
      onFermer();
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [onFermer]);

  return (
    <div data-atelier-equipe className="flex h-full min-h-0 w-full">
      <section aria-label={`Atelier de l’équipe${affichee?.etat.apres.nom ? ` ${affichee.etat.apres.nom}` : ""}`} className="flex min-w-0 flex-1 flex-col bg-fond-page">
        {affichee ? (
          <Plateau
            key={affichee.etat.serie}
            chat={chat}
            etat={affichee.etat}
            messageId={affichee.messageId}
            etapeId={affichee.etapeId}
            demande={demande}
            assistant={assistant.name}
            onFermer={onFermer}
            onMontre={setMontre}
          />
        ) : (
          <>
            <BarreHaut onFermer={onFermer}>{null}</BarreHaut>
            <div className="klyra-tablee flex flex-1 items-center justify-center text-ui-s text-texte-tertiaire">Aucune équipe en préparation dans cette conversation.</div>
          </>
        )}
      </section>
      <aside aria-label={`Conversation avec ${assistant.name}`} className="flex w-[404px] shrink-0 flex-col border-l border-bordure-subtile bg-fond-surface max-[1100px]:w-[340px]">
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-bordure-subtile px-4">
          <AgentRond roleId="principal" taille={26} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ui-s font-semibold text-texte-principal">{assistant.name}</span>
            <span className="truncate text-ui-2xs text-texte-tertiaire">Ce que tu lui dis change la table</span>
          </span>
        </div>
        <DansAtelierEquipe.Provider value={true}>
          <div className="flex min-h-0 flex-1 flex-col bg-fond-page">{fil}</div>
        </DansAtelierEquipe.Provider>
        <Suggestions chatId={chat.id} etat={affichee?.etat ?? null} montre={montre} />
        {composeur}
      </aside>
    </div>
  );
}

function BarreHaut({ onFermer, children }: { onFermer: () => void; children: ReactNode }) {
  return (
    <header className="@container flex h-16 shrink-0 items-center gap-3 border-b border-bordure-subtile bg-fond-surface px-5">
      <Bouton variant="discret" iconeGauche={<Icon name="chevron-left" size={16} />} onClick={onFermer} title="Revenir à la conversation (Échap)" className="shrink-0">
        Conversation
      </Bouton>
      <span aria-hidden="true" className="h-6 w-px bg-bordure-defaut" />
      {children}
    </header>
  );
}

/* ─── La table ─────────────────────────────────────────────────── */

function Plateau({
  chat,
  etat,
  messageId,
  etapeId,
  demande,
  assistant,
  onFermer,
  onMontre,
}: {
  chat: Chat;
  etat: EtatEquipe;
  messageId: string;
  etapeId: string;
  demande: { membre?: string; n: number };
  assistant: string;
  onFermer: () => void;
  onMontre: (nom: string | null) => void;
}) {
  const router = useRouter();
  const { sendMessage } = useWorkspace();
  const travail = useTravail(chat.id);
  const equipe = useEquipe(etat, messageId, etapeId);
  const b = etat.apres;
  const courante = etapeEquipe(b);

  /* L'étape montrée suit celle de la carte ; une étape passée se relit. */
  const [vue, setVue] = useState<EtapeEquipe>(courante);
  const [vueDe, setVueDe] = useState(courante);
  if (vueDe !== courante) {
    setVueDe(courante);
    setVue(courante);
  }

  /* L'agent montré : celui que le fil demande, sinon celui que l'assistant vient de changer. */
  const [choisi, setChoisi] = useState<string | null>(demande.membre ?? null);
  const [demandeVue, setDemandeVue] = useState(demande.n);
  if (demandeVue !== demande.n) {
    setDemandeVue(demande.n);
    if (demande.membre) {
      setChoisi(demande.membre);
      setVue("equipe");
    }
  }
  const touches = useMemo(() => (etat.avant.membres.length ? new Set(membresTouches(etat)) : new Set<string>()), [etat]);
  const [suivi, setSuivi] = useState(etapeId);
  if (suivi !== etapeId) {
    setSuivi(etapeId);
    const premier = [...touches][0];
    if (premier && (!choisi || !touches.has(choisi))) setChoisi(premier);
  }
  const selection = equipe.liste.find((x) => x.m.cle === choisi) ?? equipe.liste[0] ?? null;
  const nomMontre = selection ? selection.nom || (selection.fiche.role ? `l’agent « ${selection.fiche.role} »` : null) : null;
  useEffect(() => onMontre(vue === "equipe" ? nomMontre : null), [vue, nomMontre, onMontre]);

  /* ← / → passe d'un agent à l'autre (hors d'un champ). */
  useEffect(() => {
    if (vue !== "equipe") return;
    const touche = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.metaKey || e.ctrlKey) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable], [role='menu'], [data-tache]")) return;
      const l = equipe.liste;
      const i = l.findIndex((x) => x.m.cle === selection?.m.cle);
      if (!l.length) return;
      e.preventDefault();
      setChoisi(l[(i + (e.key === "ArrowRight" ? 1 : l.length - 1)) % l.length].m.cle);
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [vue, equipe.liste, selection?.m.cle]);

  /* Ce qu'elle valide part à l'assistant ; le bouton attend sa réponse (un nouvel appel). */
  const [envoye, setEnvoye] = useState<string | null>(null);
  const attend = envoye === etapeId || !!travail || etat.provisoire;
  const envoyer = (texte: string) => sendMessage(chat.id, texte, "principal");
  const valider = (texte: string) => {
    envoyer(texte);
    setEnvoye(etapeId);
  };

  const { bilan, creation, aCreer, nes } = equipe;
  const raison = courante === "equipe" ? (bilan.manques.length ? `Il manque ${bilan.manques.join(" ; ")}.` : null) : pretAValider(b, courante);
  const note = equipe.remplacee
    ? "Remplacée par une autre équipe, plus bas dans la conversation."
    : creation.type === "erreur"
      ? creation.message
      : bilan.nee
        ? `${nes.length} agent${nes.length > 1 ? "s" : ""} actif${nes.length > 1 ? "s" : ""} dans Mes agents, leurs fiches écrites sur ton poste.`
        : attend && courante !== "equipe"
          ? `${assistant} prépare la suite…`
          : (raison ?? (courante === "equipe" ? "Rien n’est écrit sur ton poste avant « Créer l’équipe »." : ""));

  const principal =
    equipe.remplacee || bilan.nee ? null : courante === "taches" ? (
      <BoutonPrincipal onClick={() => valider(texteTachesValidees(b))} disabled={attend || !equipe.modifiable || !!raison}>
        Valider mes tâches
      </BoutonPrincipal>
    ) : courante === "groupes" ? (
      <BoutonPrincipal onClick={() => valider(texteGroupesValides(b))} disabled={attend || !equipe.modifiable || !!raison}>
        Valider les groupes
      </BoutonPrincipal>
    ) : (
      <BoutonPrincipal onClick={() => void equipe.creer()} disabled={!equipe.modifiable || !!bilan.manques.length || !aCreer.length}>
        {creation.type === "creation" ? `Création… ${creation.faits}/${creation.total}` : nes.length ? `Créer les ${aCreer.length} autres` : aCreer.length > 1 ? "Créer l’équipe" : "Créer l’agent"}
      </BoutonPrincipal>
    );

  const etape = ETAPES[rang(vue)];
  const sansPrenom = equipe.liste.filter((x) => !x.nom && !x.ecarte).length;
  const sousTitre =
    vue === "equipe"
      ? bilan.nee
        ? "Ton équipe est née."
        : `${equipe.liste.length} agent${equipe.liste.length > 1 ? "s" : ""}${b.groupes.length ? ", un par groupe" : ""}.${sansPrenom ? ` ${sansPrenom > 1 ? `${sansPrenom} attendent leur prénom.` : "Un attend son prénom."}` : ""}`
      : etape.sousTitre;

  return (
    <>
      <BarreHaut onFermer={onFermer}>
        <nav aria-label="Étapes de l’atelier" className="mx-auto flex min-w-0 items-center gap-1.5">
          {ETAPES.map((e, i) => {
            const faite = i < rang(courante);
            const accessible = i <= rang(courante);
            return (
              <span key={e.cle} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true" className="h-px w-[18px] bg-bordure-forte" />}
                <button
                  type="button"
                  disabled={!accessible}
                  aria-current={vue === e.cle ? "step" : undefined}
                  onClick={() => setVue(e.cle)}
                  className={cn(
                    "flex h-8 cursor-pointer items-center gap-2 rounded-pill border-0 bg-transparent py-0 pr-3 pl-1.5 text-ui-s font-medium whitespace-nowrap transition-colors duration-[220ms] ease-sortie disabled:cursor-default",
                    vue === e.cle ? "bg-fond-teinte-bleue text-texte-accent" : faite ? "text-texte-principal hover:bg-fond-survol" : "text-texte-tertiaire",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-ui-3xs font-semibold",
                      vue === e.cle ? "bg-fond-accent text-texte-inverse" : faite ? "bg-fond-inverse text-texte-inverse" : "bg-fond-survol text-texte-tertiaire",
                    )}
                  >
                    {faite && vue !== e.cle ? <Icon name="check-01" size={11} /> : i + 1}
                  </span>
                  {/* Fenêtre étroite : le nom de l'étape montrée seulement. */}
                  <span className={cn(vue !== e.cle && "@max-[860px]:sr-only")}>{e.titre}</span>
                </button>
              </span>
            );
          })}
        </nav>
        {courante === "equipe" && !bilan.nee && (
          <span className="shrink-0 text-ui-xs whitespace-nowrap text-texte-secondaire @max-[1040px]:hidden">
            {aCreer.length} agent{aCreer.length > 1 ? "s" : ""} à créer · <span className="klyra-mono">~{bilan.jetons.toLocaleString("fr-FR")} jetons</span>
          </span>
        )}
        {bilan.nee && (
          <Bouton variant="blanc" iconeGauche={<Icon name="users-profiles-01" size={16} />} onClick={() => router.push("/equipe")}>
            Voir Mes agents
          </Bouton>
        )}
        {principal && <span className="flex shrink-0">{principal}</span>}
      </BarreHaut>

      <div className="@container min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <div className={cn("klyra-tablee relative flex flex-col", vue === "equipe" ? "min-h-[340px] border-b border-bordure-subtile" : "min-h-full")}>
          <div className="flex items-start justify-between gap-6 px-8 pt-6 pb-5">
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-ui-2xs text-texte-tertiaire">{b.nom || "Ton équipe"}</span>
              <h2 className="m-0 text-h3 leading-[1] font-semibold tracking-[-0.05em] text-texte-principal">{etape.titre}</h2>
              {sousTitre && <p className="m-0 max-w-[560px] text-ui-s leading-[1.45] text-texte-secondaire">{sousTitre}</p>}
            </div>
            {vue !== "equipe" && (
              <span className="flex shrink-0 items-center gap-3 pt-1 text-ui-2xs text-texte-tertiaire">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-3 w-[18px] rounded-[3px] bg-fond-surface shadow-ombre-sm" />
                  Tu l’as dit
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-3 w-[18px] rounded-[3px] border-[1.5px] border-dashed border-bleu-k1-200" />
                  Proposé par {assistant}
                </span>
              </span>
            )}
          </div>
          {vue === "equipe" ? (
            <div className="mt-auto flex justify-center px-8 pt-4 pb-8">
              <CartesMembres b={b} equipe={equipe} choisi={selection?.m.cle ?? null} touches={touches} onChoisir={setChoisi} />
            </div>
          ) : (
            <TableTaches b={b} vue={vue} modifiable={equipe.modifiable && vue === courante && !etat.provisoire} chatId={chat.id} assistant={assistant} onChoisir={equipe.choisir} />
          )}
        </div>
        {vue === "equipe" && (
          <>
            {selection && <DetailMembre key={selection.m.cle} x={selection} equipe={equipe} assistant={assistant} onEnvoyer={etat.courante && !etat.provisoire && creation.type === "repos" && !selection.idCree ? envoyer : null} />}
            <QuiSenCharge etat={etat} equipe={equipe} choisi={selection?.m.cle ?? null} confier={bilan.nee && etat.courante ? envoyer : null} />
          </>
        )}
      </div>
      {note && (
        <p
          role={creation.type === "erreur" ? "alert" : undefined}
          aria-live="polite"
          className={cn(
            "m-0 shrink-0 border-t border-bordure-subtile bg-fond-surface px-8 py-2.5 text-ui-xs [overflow-wrap:anywhere]",
            creation.type === "erreur" ? "text-texte-erreur" : "text-texte-tertiaire",
            attend && courante !== "equipe" && "klyra-respire",
          )}
        >
          {note}
        </p>
      )}
    </>
  );
}

/* ─── Des débuts de message, selon l'étape ─────────────────────── */

function Suggestions({ chatId, etat, montre }: { chatId: string; etat: EtatEquipe | null; montre: string | null }) {
  if (!etat) return null;
  const etape = etapeEquipe(etat.apres);
  const puces: [string, string][] =
    etape === "taches"
      ? [
          ["Une tâche de plus", "J’oublie : je fais aussi "],
          ["Ça change selon les semaines", "Ça dépend des semaines : "],
          ["Je ne sais pas trop", "Je ne sais pas trop ce que je pourrais confier."],
        ]
      : etape === "groupes"
        ? [
            ["Un seul agent pour tout", "Un seul agent pour tout."],
            ["Séparer un groupe", "Sépare "],
            ["Je garde aussi…", "Je garde aussi "],
          ]
        : [
            ["Ses limites", `${montre ? `Pour ${montre} : il` : "Il"} ne doit jamais `],
            ["Ce qu’il livre", `${montre ? `Pour ${montre} : il` : "Il"} devrait livrer `],
            ["Son ton", `${montre ? `Pour ${montre} : il` : "Il"} écrit plutôt `],
            [montre ? "Le retirer" : "Un agent de moins", montre ? `Je n’ai pas besoin de ${montre}.` : "Je n’ai pas besoin de "],
          ];
  return (
    <div className="flex flex-col gap-2 border-t border-bordure-subtile px-4 pt-2.5">
      <span className="flex items-center gap-1.5 text-ui-2xs text-texte-tertiaire">
        <Icon name="stars" size={12} />
        {etape === "equipe" && montre ? `Pour ${montre}` : "Pour l’aider"}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {puces.map(([libelle, texte]) => (
          <Bouton key={libelle} variant="blanc" taille="mini" onClick={() => ajouterAuBrouillon(chatId, texte)}>
            {libelle}
          </Bouton>
        ))}
      </div>
    </div>
  );
}
