"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";
import { idDirect, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat, RoleId } from "@/types/domain";

const MENU =
  "fixed z-50 flex w-max min-w-[240px] flex-col gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-flottante";
const SEPARATEUR = <span aria-hidden="true" className="my-1 h-px bg-bordure-subtile" />;

function Ligne({ icone, children, onClick, danger }: { icone: IconName; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-2 text-left text-ui-s whitespace-nowrap hover:bg-fond-survol",
        danger ? "text-texte-erreur" : "text-texte-principal",
      )}
    >
      <Icon name={icone} size={16} className={cn("shrink-0", danger ? "text-texte-erreur" : "text-icone-secondaire")} />
      {children}
    </button>
  );
}

const ONGLET = "group/onglet flex h-7 max-w-[220px] min-w-0 shrink-0 items-center gap-1.5 rounded-sm pr-1 pl-2 text-ui-xs font-medium transition-colors duration-[120ms]";

function Onglet({
  chat,
  libelle,
  actif,
  enEdition,
  onOuvrir,
  onFermer,
  onMenu,
  onRenommer,
}: {
  chat: Chat;
  libelle: string;
  actif: boolean;
  enEdition: boolean;
  onOuvrir: () => void;
  /** Absent : l'onglet ne se ferme pas (le chat principal). */
  onFermer?: () => void;
  onMenu?: (x: number, y: number) => void;
  onRenommer: (titre: string | null) => void;
}) {
  const travail = useTravail(chat.id);
  const [titre, setTitre] = useState(libelle);
  return (
    <div
      onContextMenu={(e) => {
        if (!onMenu) return;
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      className={cn(ONGLET, actif ? "bg-fond-surface-grise text-texte-principal" : "text-texte-secondaire hover:bg-fond-survol", !onFermer && "pr-2")}
    >
      {/* Un agent y travaille : le point respire, comme dans la barre latérale. */}
      {travail && <span aria-label="En cours" className="klyra-respire size-1.5 shrink-0 rounded-full bg-bleu-k1-500" />}
      {enEdition ? (
        <input
          autoFocus
          value={titre}
          aria-label="Nom du fil"
          onChange={(e) => setTitre(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => onRenommer(titre)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRenommer(titre);
            if (e.key === "Escape") onRenommer(null);
          }}
          className="w-36 min-w-0 rounded-2xs border border-bordure-champ bg-fond-surface px-1 text-ui-xs text-texte-principal outline-none"
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={actif}
          title={chat.fil ? `${libelle} (${chat.id})` : libelle}
          onClick={onOuvrir}
          onAuxClick={(e) => e.button === 1 && onFermer?.()}
          className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-inherit"
        >
          {libelle}
        </button>
      )}
      {onFermer && !enEdition && (
        <button
          type="button"
          onClick={onFermer}
          aria-label={`Fermer le fil ${libelle}`}
          title="Fermer (archiver)"
          className={cn(
            "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-2xs border-0 bg-transparent p-0 text-icone-secondaire hover:bg-fond-survol hover:text-texte-principal",
            !actif && "invisible group-hover/onglet:visible",
          )}
        >
          <Icon name="x-01" size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * Les onglets du chat d'un agent : son chat principal, puis ses fils. Un fil est
 * une tâche, une conversation à part du même agent qui tourne sans bloquer le
 * chat. Le « + » en ouvre un ; clic droit : renommer, fermer, archiver. Fermer
 * un fil, c'est clore la tâche : il s'arrête et part dans les archivés, d'où on
 * peut le rouvrir. Rien n'est jamais effacé.
 */
export function OngletsFils({ roleId, chatId }: { roleId: RoleId; chatId: string }) {
  const router = useRouter();
  const { state, creerFil, renommerChat, archiverFil, rouvrirFil } = useWorkspace();
  const principal = idDirect(roleId);
  const fils = state.chats.filter((c) => c.fil?.roleId === roleId).sort((a, b) => a.fil!.creeLe.localeCompare(b.fil!.creeLe));
  const ouverts = fils.filter((c) => c.fil!.statut === "ouvert");
  const archives = fils.filter((c) => c.fil!.statut === "archive" && !c.fil!.supprime).reverse();
  const chatPrincipal = state.chats.find((c) => c.id === principal) ?? ({ id: principal, roleIds: [roleId] } as Chat);

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [edition, setEdition] = useState<string | null>(null);
  const [listeArchives, setListeArchives] = useState(false);
  const boiteArchives = useRef<HTMLDivElement>(null);

  /* Clic ailleurs ou Échap : les menus se ferment. */
  useEffect(() => {
    if (!menu && !listeArchives) return;
    const fermer = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-menu-fils]")) return;
      setMenu(null);
      setListeArchives(false);
    };
    const echap = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      setListeArchives(false);
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", echap);
    };
  }, [menu, listeArchives]);

  const aller = (id: string) => router.push(`/chat?id=${encodeURIComponent(id)}`);

  /** Ferme (archive) des fils ; si l'onglet affiché en fait partie, on revient au chat principal. */
  const clore = (ids: string[], supprime = false) => {
    for (const id of ids) archiverFil(id, supprime);
    setMenu(null);
    if (ids.includes(chatId)) aller(principal);
  };

  const nouveau = () => aller(creerFil(roleId));

  const choisi = menu ? ouverts.find((c) => c.id === menu.id) : undefined;
  const rang = choisi ? ouverts.indexOf(choisi) : -1;
  // Les fermetures groupées épargnent les fils où un agent travaille encore.
  const libres = (liste: Chat[]) => liste.filter((c) => !state.travail[c.id]).map((c) => c.id);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-bordure-subtile px-2">
      <div role="tablist" aria-label="Chat et fils" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        <Onglet chat={chatPrincipal} libelle="Chat" actif={chatId === principal} enEdition={false} onOuvrir={() => aller(principal)} onRenommer={() => {}} />
        {ouverts.length > 0 && <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-bordure-subtile" />}
        {ouverts.map((c) => (
          <Onglet
            key={c.id}
            chat={c}
            libelle={c.title}
            actif={c.id === chatId}
            enEdition={edition === c.id}
            onOuvrir={() => aller(c.id)}
            onFermer={() => clore([c.id])}
            onMenu={(x, y) => setMenu({ id: c.id, x, y })}
            onRenommer={(titre) => {
              if (titre !== null) renommerChat(c.id, titre);
              setEdition(null);
            }}
          />
        ))}
      </div>

      {archives.length > 0 && (
        <div ref={boiteArchives} data-menu-fils className="relative">
          <BoutonIcone
            taille="mini"
            actif={listeArchives}
            icone={<Icon name="folder" size={16} />}
            libelle={`Fils archivés (${archives.length})`}
            aria-expanded={listeArchives}
            onClick={() => setListeArchives((v) => !v)}
            className="text-icone-secondaire"
          />
          {listeArchives && (
            <div ref={apparition} role="menu" aria-label="Fils archivés" className={cn(MENU, "absolute top-full right-0 mt-1 max-h-80 w-[300px] overflow-y-auto")}>
              <span className="px-2 pt-1 pb-1 text-ui-2xs font-medium text-texte-tertiaire">Fils archivés · un clic les rouvre</span>
              {archives.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    rouvrirFil(c.id);
                    setListeArchives(false);
                    aller(c.id);
                  }}
                  className="flex cursor-pointer flex-col items-start gap-0.5 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left hover:bg-fond-survol"
                >
                  <span className="w-full truncate text-ui-s text-texte-principal">{c.title}</span>
                  <span className="klyra-mono text-ui-2xs text-texte-tertiaire">{c.id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <BoutonIcone taille="mini" icone={<Icon name="plus-01" size={16} />} libelle="Nouveau fil" onClick={nouveau} className="text-icone-secondaire" />

      {menu && choisi && (
        <div ref={apparition} data-menu-fils role="menu" aria-label={`Fil ${choisi.title}`} className={MENU} style={{ left: menu.x, top: menu.y }}>
          <Ligne
            icone="pencil-01"
            onClick={() => {
              setEdition(choisi.id);
              setMenu(null);
            }}
          >
            Renommer
          </Ligne>
          {SEPARATEUR}
          <Ligne icone="x-01" onClick={() => clore([choisi.id])}>
            Fermer l’onglet
          </Ligne>
          <Ligne icone="layers-01" onClick={() => clore(libres(ouverts.filter((c) => c.id !== choisi.id)))}>
            Fermer les autres onglets
          </Ligne>
          <Ligne icone="chevron-right" onClick={() => clore(libres(ouverts.slice(rang + 1)))}>
            Fermer les onglets à droite
          </Ligne>
          {SEPARATEUR}
          <Ligne icone="folder" onClick={() => clore([choisi.id])}>
            Archiver
          </Ligne>
          <Ligne icone="trash-01" danger onClick={() => clore([choisi.id], true)}>
            Supprimer
          </Ligne>
        </div>
      )}
    </div>
  );
}
