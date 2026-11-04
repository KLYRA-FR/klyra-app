"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { messageErreur } from "@/lib/compte";
import { activiteDe, idDirect, libelleArchive, nouvelIdFil, parentDe, type ConversationLue } from "@/lib/telephone/chats";
import { Feuille, MenuFeuille, type ActionMenu } from "./Feuille";
import { FeuilleRenommer, useAppuiMenu } from "./MenuChat";

const PUCE = "flex h-11 max-w-[200px] shrink-0 items-center gap-1.5 rounded-xs px-3 text-ui font-medium no-underline";

function PuceFil({ libelle, actif, enCours, onOuvrir, onMenu }: { libelle: string; actif: boolean; enCours: boolean; onOuvrir: () => void; onMenu?: () => void }) {
  const { className: sansMenuSysteme, onClick: apresAppui, ...appui } = useAppuiMenu(() => onMenu?.());
  return (
    <button
      type="button"
      role="tab"
      aria-selected={actif}
      onClick={(e) => {
        apresAppui(e);
        if (!e.defaultPrevented) onOuvrir();
      }}
      {...(onMenu ? appui : {})}
      className={cn(PUCE, sansMenuSysteme, actif ? "bg-fond-surface-grise text-texte-principal" : "text-texte-secondaire active:bg-fond-survol")}
    >
      {enCours ? <span aria-label="En cours" className="klyra-respire size-1.5 shrink-0 rounded-full bg-bleu-k1-500" /> : null}
      <span className="truncate">{libelle}</span>
    </button>
  );
}

/**
 * Les fils d'un agent, en puces sous l'en-tête (T-02) : « Chat », puis ses fils ouverts. « + » ouvre un
 * fil ; appui long sur une puce ou « ⋯ » : « Renommer », « Archiver », « Supprimer », « Fils archivés (N) ».
 * Gestes Compte : tout de suite dans le compte, puis sur l'ordinateur à son ouverture.
 */
export function FilsPuces({
  agentId,
  courant,
  conversations,
  onBandeau,
}: {
  agentId: string;
  courant: string;
  conversations: ConversationLue[];
  onBandeau: (texte: string) => void;
}) {
  const router = useRouter();
  const creer = useMutation(api.operationsFile.creerFil);
  const archiver = useMutation(api.operationsFile.archiverFil);
  const rouvrir = useMutation(api.operationsFile.rouvrirFil);
  const renommer = useMutation(api.operationsFile.renommer);
  const [menu, setMenu] = useState<ConversationLue | "general" | null>(null);
  const [renommage, setRenommage] = useState<ConversationLue | null>(null);
  const [archivesOuvertes, setArchivesOuvertes] = useState(false);
  const principal = idDirect(agentId);
  const fils = conversations.filter((c) => parentDe(c) === principal);
  const ouverts = fils.filter((c) => !c.archiveLe).sort((a, b) => a.misAJour.localeCompare(b.misAJour));
  const archives = fils.filter((c) => c.archiveLe).sort((a, b) => (b.archiveLe ?? "").localeCompare(a.archiveLe ?? ""));
  const aller = (id: string) => router.replace(`/chat?id=${encodeURIComponent(id)}`);
  const agir = (geste: Promise<unknown>) => geste.catch((err: unknown) => onBandeau(messageErreur(err)));

  const nouveau = () => {
    const id = nouvelIdFil();
    void agir(creer({ origine: id, roleId: agentId }).then(() => aller(id)));
  };
  const clore = (fil: ConversationLue, supprime: boolean) => {
    if (fil.origine === courant) aller(principal);
    void agir(archiver({ conversationOrigine: fil.origine, supprime }));
  };

  const actionsDe = (fil: ConversationLue | null): ActionMenu[] => [
    ...(fil
      ? [
          { libelle: "Renommer", onChoisir: () => setRenommage(fil) },
          { libelle: "Archiver", onChoisir: () => clore(fil, false) },
          { libelle: "Supprimer", danger: true, onChoisir: () => clore(fil, true) },
        ]
      : []),
    { libelle: "Nouveau fil", onChoisir: nouveau },
    ...(archives.length ? [{ libelle: `Fils archivés (${archives.length})`, onChoisir: () => setArchivesOuvertes(true) }] : []),
  ];
  const filCourant = ouverts.find((c) => c.origine === courant) ?? null;

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-bordure-subtile px-2">
      <div role="tablist" aria-label="Chat et fils" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        <PuceFil libelle="Chat" actif={courant === principal} enCours={false} onOuvrir={() => aller(principal)} />
        {ouverts.map((c) => (
          <PuceFil key={c.origine} libelle={c.titre} actif={c.origine === courant} enCours={!!activiteDe(c)} onOuvrir={() => aller(c.origine)} onMenu={() => setMenu(c)} />
        ))}
      </div>
      <BoutonIcone variant="discret" className="size-11 shrink-0" libelle="Nouveau fil" icone={<Icon name="plus-01" size={20} />} onClick={nouveau} />
      <BoutonIcone variant="discret" className="size-11 shrink-0" libelle="Options des fils" aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => setMenu(filCourant ?? "general")} />

      {menu ? <MenuFeuille titre={menu === "general" ? "Fils" : menu.titre} onFermer={() => setMenu(null)} actions={actionsDe(menu === "general" ? null : menu)} /> : null}
      {renommage ? (
        <FeuilleRenommer titre="Renommer le fil" valeur={renommage.titre} onFermer={() => setRenommage(null)} onValider={(titre) => void agir(renommer({ conversationOrigine: renommage.origine, titre }))} />
      ) : null}
      {archivesOuvertes ? (
        <Feuille titre={`Fils archivés (${archives.length})`} onFermer={() => setArchivesOuvertes(false)}>
          <p className="pb-2 text-ui text-texte-secondaire">Toucher un fil le rouvre.</p>
          <ul>
            {archives.map((c) => (
              <li key={c.origine}>
                <button
                  type="button"
                  className="flex min-h-12 w-full flex-col justify-center border-b border-bordure-subtile py-2 text-left last:border-b-0"
                  onClick={() => {
                    setArchivesOuvertes(false);
                    void agir(rouvrir({ conversationOrigine: c.origine }).then(() => aller(c.origine)));
                  }}
                >
                  <span className="truncate text-body-s text-texte-principal">{c.titre}</span>
                  <span className="truncate text-ui-xs text-texte-secondaire">{c.archiveLe ? libelleArchive(c.archiveLe) : "Archivé"}</span>
                </button>
              </li>
            ))}
          </ul>
        </Feuille>
      ) : null}
    </div>
  );
}
