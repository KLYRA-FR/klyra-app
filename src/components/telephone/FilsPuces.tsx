"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { messageErreur } from "@/lib/compte";
import { activiteDe, idDirect, libelleArchive, nouvelIdFil, parentDe, type ConversationLue } from "@/lib/telephone/chats";
import { prevoirSuppression, type SuppressionPrevue } from "@/lib/telephone/suppression-fil";
import { useAnnonce } from "./Annonce";
import { useHorsLigne } from "./BandeauReseau";
import { Feuille, MenuFeuille, type ActionMenu } from "./Feuille";
import { useCartes } from "./AgentsChat";
import { GroupeListe, LigneListe, TuileIcone } from "./Liste";
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
      className={cn(PUCE, sansMenuSysteme, actif ? "klyra-surface-sombre text-texte-inverse" : "border border-bordure-subtile bg-fond-surface text-texte-principal active:bg-fond-survol")}
    >
      {enCours ? <span aria-label="En cours" className="klyra-respire size-1.5 shrink-0 rounded-full bg-bleu-k1-500" /> : null}
      <span className="truncate">{libelle}</span>
    </button>
  );
}

/**
 * Les fils d'un agent, en puces sous l'en-tête (T-02) : « Chat », puis ses fils ouverts. « + » ouvre un
 * fil ; appui long sur une puce ou « ⋯ » : « Renommer », « Archiver », « Supprimer », « Fils archivés (N) ».
 * Gestes Compte : tout de suite dans le compte, puis sur l'ordinateur à son ouverture. « Supprimer »
 * attend 8 s avant d'envoyer quoi que ce soit (E2-51, `prevoirSuppression`).
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
  const { nom } = useCartes();
  const nomAgent = nom(agentId);
  const annoncer = useAnnonce();
  const horsLigne = useHorsLigne();
  const creer = useMutation(api.operationsFile.creerFil);
  const archiver = useMutation(api.operationsFile.archiverFil);
  const rouvrir = useMutation(api.operationsFile.rouvrirFil);
  const renommer = useMutation(api.operationsFile.renommer);
  const [menu, setMenu] = useState<ConversationLue | "general" | null>(null);
  const [renommage, setRenommage] = useState<ConversationLue | null>(null);
  const [archivesOuvertes, setArchivesOuvertes] = useState(false);
  const [menuAvant, setMenuAvant] = useState<ConversationLue | "general" | null>(null);
  /* Les fils retirés en attendant leur suppression (E2-51) : cachés ici, toujours dans le compte. */
  const [caches, setCaches] = useState<ReadonlySet<string>>(() => new Set());
  const [prevues] = useState(() => new Set<SuppressionPrevue>());
  const principal = idDirect(agentId);
  const fils = conversations.filter((c) => parentDe(c) === principal);
  const ouverts = fils.filter((c) => !c.archiveLe && !caches.has(c.origine)).sort((a, b) => a.misAJour.localeCompare(b.misAJour));
  const archives = fils.filter((c) => c.archiveLe).sort((a, b) => (b.archiveLe ?? "").localeCompare(a.archiveLe ?? ""));
  const aller = (id: string) => router.replace(`/chat?id=${encodeURIComponent(id)}`);
  const agir = (geste: Promise<unknown>) => geste.catch((err: unknown) => onBandeau(messageErreur(err)));

  /* Quitter le fil avant l'échéance abandonne les suppressions prévues : rien ne part à l'insu de la personne. */
  useEffect(() => {
    const enCours = prevues;
    return () => {
      const abandonnees = [...enCours].filter((s) => s.etat === "prevue");
      for (const s of abandonnees) s.abandonner();
      if (abandonnees.length) annoncer("Suppression du fil abandonnée");
    };
  }, [annoncer, prevues]);

  const nouveau = () => {
    const id = nouvelIdFil();
    void agir(creer({ origine: id, roleId: agentId }).then(() => aller(id)));
  };
  /* Archiver le fil ouvert ramène au Chat ; un échec y revient. Le succès s'annonce après le compte. */
  const archiverFil = (fil: ConversationLue) => {
    const etaitCourant = fil.origine === courant;
    if (etaitCourant) aller(principal);
    archiver({ conversationOrigine: fil.origine, supprime: false }).then(
      () => annoncer(`Fil archivé : ${fil.titre}`),
      (err: unknown) => {
        if (etaitCourant) aller(fil.origine);
        annoncer({ texte: messageErreur(err), erreur: true });
      },
    );
  };
  const cacher = (origine: string, cache: boolean) =>
    setCaches((avant) => {
      const apres = new Set(avant);
      if (cache) apres.add(origine);
      else apres.delete(origine);
      return apres;
    });
  const supprimerFil = (fil: ConversationLue) => {
    const etaitCourant = fil.origine === courant;
    if (etaitCourant) aller(principal);
    cacher(fil.origine, true);
    const s = prevoirSuppression({
      supprimer: () => archiver({ conversationOrigine: fil.origine, supprime: true }),
      suivre: (etat, err) => {
        if (etat === "en-cours") return annoncer("Suppression en cours…");
        prevues.delete(s);
        if (etat === "abandonnee") return;
        cacher(fil.origine, false);
        if (etat === "faite") annoncer("Fil supprimé du compte · synchronisation avec l’ordinateur en attente");
        else if (err) annoncer({ texte: messageErreur(err), erreur: true });
        else if (etaitCourant) aller(fil.origine);
      },
    });
    prevues.add(s);
    annoncer({ texte: "Suppression du fil prévue", action: { libelle: "Annuler", onChoisir: s.annuler }, onFin: s.echeance });
  };

  const actionsDe = (fil: ConversationLue | null): ActionMenu[] => [
    ...(fil
      ? [
          { libelle: "Renommer le fil…", icone: "pencil-01" as const, onChoisir: () => setRenommage(fil) },
          { libelle: "Archiver", icone: "folder" as const, onChoisir: () => archiverFil(fil) },
          { libelle: "Supprimer", icone: "trash-01" as const, danger: true, onChoisir: () => supprimerFil(fil) },
        ]
      : []),
    { libelle: "Nouveau fil", icone: "message-plus-01", separateurAvant: !!fil, onChoisir: nouveau },
    ...(archives.length ? [{ libelle: `Fils archivés (${archives.length})`, icone: "clock-backward" as const, sousPage: true, onChoisir: () => { setMenuAvant(fil ?? "general"); setMenu(null); setArchivesOuvertes(true); } }] : []),
  ];
  const filCourant = ouverts.find((c) => c.origine === courant) ?? null;

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-1 px-2">
      <div role="tablist" aria-label="Chat et fils" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        <PuceFil libelle="Chat" actif={courant === principal} enCours={false} onOuvrir={() => aller(principal)} />
        {ouverts.map((c) => (
          <PuceFil key={c.origine} libelle={c.titre} actif={c.origine === courant} enCours={!!activiteDe(c)} onOuvrir={() => aller(c.origine)} onMenu={() => setMenu(c)} />
        ))}
      </div>
      <BoutonIcone variant="discret" className="size-11 shrink-0" libelle="Nouveau fil" icone={<Icon name="plus-01" size={20} />} onClick={nouveau} />
      <BoutonIcone variant="discret" className="size-11 shrink-0" libelle="Options des fils" aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => setMenu(filCourant ?? "general")} />

      {menu ? <MenuFeuille titre={menu === "general" ? "Fils" : menu.titre} objet={menu === "general" ? undefined : { visuel: <TuileIcone icone="git-branch-02" />, sous: `${activiteDe(menu) ? "en cours · " : ""}Fil de ${nomAgent}` }} onFermer={() => setMenu(null)} actions={actionsDe(menu === "general" ? null : menu)} /> : null}
      {renommage ? (
        <FeuilleRenommer titre="Renommer le fil" valeur={renommage.titre} onFermer={() => setRenommage(null)} onValider={(titre) => renommer({ conversationOrigine: renommage.origine, titre }).then(() => annoncer(`Fil renommé : ${titre}`))} />
      ) : null}
      {archivesOuvertes ? (
        <Feuille
          titre="Fils archivés"
          sousTitre={horsLigne ? "Possible quand ce téléphone est en ligne" : "Toucher un fil le rouvre"}
          retour={() => {
            setArchivesOuvertes(false);
            setMenu(menuAvant);
          }}
          onFermer={() => setArchivesOuvertes(false)}
        >
          <GroupeListe>
            {archives.map((c) => (
              <LigneListe
                key={c.origine}
                retrait="tuile"
                debut={<TuileIcone icone="git-branch-02" />}
                nom={c.titre}
                ligne2={libelleArchive(c.archiveLe ?? c.misAJour)}
                uneLigne
                inactive={horsLigne}
                fin="chevron"
                onClick={
                  horsLigne
                    ? undefined
                    : () => {
                        setArchivesOuvertes(false);
                        void agir(
                          rouvrir({ conversationOrigine: c.origine }).then(() => {
                            aller(c.origine);
                            annoncer(`Fil rouvert : ${c.titre}`);
                          }),
                        );
                      }
                }
              />
            ))}
          </GroupeListe>
        </Feuille>
      ) : null}
    </div>
  );
}
