"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { ElementContextuel, MenuContextuel, SeparateurContextuel } from "@/components/ui/MenuContextuel";
import { getBridge, type ActionMenuNavigateur, type MenuNavigateur, type OngletNavigateur } from "@/lib/bridge";
import { raccourciDuSysteme } from "@/lib/plateforme";
import { ModaleCoffre } from "./Coffre";
import { cn } from "@/lib/cn";
import { siteDe, useOngletsChat, useOngletVu, usePlacementOnglet } from "@/lib/navigateur";
import { useRole, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";

/**
 * L'onglet « Navigateur » du panneau d'une conversation : les pages que
 * l'agent ouvre pour travailler (et celles que la personne ouvre pour lui),
 * en vignettes. Un clic sur une vignette ouvre la page en plein écran dans
 * la fenêtre de l'app (pas dans le tiroir) : Échap ou « Retour » ramène aux
 * vignettes. La page est une vue native posée par le process principal
 * (electron/navigateur/) : rien de l'écran ne peut passer par-dessus, donc
 * elle s'efface derrière sa vignette dès qu'une fenêtre ou un menu s'ouvre.
 */

/** Une fenêtre ou un menu de l'app est ouvert : Échap le ferme, il ne quitte pas le plein écran. */
const RECOUVRE_ECHAP = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';

const pont = () => getBridge()?.navigateur;

function Vide({ titre, children }: { titre: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-md bg-fond-surface-grise text-icone-secondaire">
        <Icon name="globe-01" size={20} />
      </span>
      <span className="mt-1.5 text-ui-s font-medium text-texte-principal">{titre}</span>
      {children}
    </div>
  );
}

/** La barre d'adresse : l'adresse de la page, ou ce qu'on tape (adresse, domaine, mots à chercher). */
function BarreAdresse({ onglet, focusAuDepart }: { onglet: OngletNavigateur; focusAuDepart: boolean }) {
  const [saisie, setSaisie] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);
  const affichee = onglet.url === "about:blank" ? "" : onglet.url;
  useEffect(() => {
    if (focusAuDepart) champ.current?.focus();
  }, [focusAuDepart, onglet.id]);
  const valider = (e: FormEvent) => {
    e.preventDefault();
    const texte = (saisie ?? "").trim();
    if (!texte) return;
    void pont()?.aller(onglet.id, texte);
    setSaisie(null);
    champ.current?.blur();
  };
  const securise = onglet.url.startsWith("https://");
  return (
    <form onSubmit={valider} className="relative min-w-0 flex-1">
      <Icon
        name={securise ? "lock-01" : "globe-01"}
        size={14}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-icone-secondaire"
      />
      <input
        ref={champ}
        value={saisie ?? affichee}
        onChange={(e) => setSaisie(e.target.value)}
        onFocus={(e) => {
          setSaisie(affichee);
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => setSaisie(null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setSaisie(null);
            e.currentTarget.blur();
          }
        }}
        placeholder="Adresse ou recherche"
        aria-label="Adresse de la page"
        spellCheck={false}
        autoComplete="off"
        className="h-8 w-full rounded-xs border border-bordure-champ bg-fond-surface pr-2.5 pl-8 text-ui-s text-texte-principal outline-none placeholder:text-texte-tertiaire focus:border-bordure-forte"
      />
    </form>
  );
}

/** Ce qui se passe sur l'onglet : un agent l'utilise, il passe la main, ou la personne l'a prise. */
function Bandeau({ onglet, chat }: { onglet: OngletNavigateur; chat: Chat }) {
  const { sendMessage, arreter } = useWorkspace();
  const travail = useTravail(chat.id);
  const roleId = onglet.main?.type === "demandee" ? onglet.main.roleId : (onglet.pilote?.roleId ?? chat.roleIds[0] ?? "principal");
  const agent = useRole(roleId);

  if (onglet.main?.type === "demandee") {
    const reprendre = () => {
      void pont()?.main(onglet.id, false);
      sendMessage(chat.id, `C’est fait dans l’onglet « ${onglet.titre} » : tu peux continuer.`, chat.kind === "direct" ? null : roleId);
    };
    return (
      <div className="flex flex-col gap-2 border-b border-bordure-subtile bg-fond-surface-grise px-3 py-2.5">
        <span className="flex items-start gap-2 text-ui-xs leading-[1.45] text-texte-principal">
          <AgentRond roleId={roleId} taille={20} />
          <span>
            <span className="font-semibold">{agent.name} te passe la main</span> : {onglet.main.raison}. Fais-le dans la page ci-dessous, puis dis-le-lui.
          </span>
        </span>
        <div className="flex gap-1.5">
          <Bouton variant="sombre" taille="mini" onClick={reprendre}>
            C’est fait, à toi
          </Bouton>
          <Bouton variant="discret" taille="mini" onClick={() => void pont()?.main(onglet.id, false)}>
            Rendre sans message
          </Bouton>
        </div>
      </div>
    );
  }
  if (onglet.main?.type === "personne") {
    return (
      <div className="flex items-center gap-2 border-b border-bordure-subtile bg-fond-surface-grise px-3 py-2">
        <Icon name="cursor-01" size={14} className="shrink-0 text-icone-secondaire" />
        <span className="min-w-0 flex-1 text-ui-xs leading-[1.45] text-texte-secondaire">Tu as la main : les agents lisent cet onglet sans y agir.</span>
        <Bouton variant="blanc" taille="mini" onClick={() => void pont()?.main(onglet.id, false)}>
          Rendre la main
        </Bouton>
      </div>
    );
  }
  if (!onglet.pilote) return null;
  return (
    <div className="flex items-center gap-2 border-b border-bordure-subtile px-3 py-2" aria-live="polite">
      <AgentRond roleId={roleId} taille={20} statut={{ type: "travaille" }} />
      <span className="min-w-0 flex-1 truncate text-ui-xs text-texte-secondaire">
        <span className="font-medium text-texte-principal">{agent.name}</span> · {onglet.pilote.action}
      </span>
      <Bouton variant="blanc" taille="mini" onClick={() => void pont()?.main(onglet.id, true)}>
        Prendre la main
      </Bouton>
      {travail && (
        <BoutonIcone taille="mini" icone={<Icon name="stop-01" size={14} />} libelle={`Arrêter ${agent.name}`} onClick={() => arreter(chat.id)} />
      )}
    </div>
  );
}

function octets(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** Le menu du clic droit dans une page : celui de l'app, posé là où la personne a cliqué. */
function MenuPage({ onglet, menu, x, y, onFermer }: { onglet: OngletNavigateur; menu: MenuNavigateur; x: number; y: number; onFermer: () => void }) {
  const faire = (action: ActionMenuNavigateur) => void pont()?.actionMenu?.(onglet.id, action);
  const extrait = menu.selection.length > 28 ? `${menu.selection.slice(0, 27)}…` : menu.selection;
  return (
    <MenuContextuel x={x} y={y} libelle="Menu de la page" onFermer={onFermer}>
      {menu.lien && (
        <>
          <ElementContextuel icone="plus-01" onChoisir={() => faire("lien-onglet")}>Ouvrir le lien dans un nouvel onglet</ElementContextuel>
          <ElementContextuel icone="link-external" onChoisir={() => faire("lien-ailleurs")}>Ouvrir le lien dans ton navigateur</ElementContextuel>
          <ElementContextuel icone="link" onChoisir={() => faire("copier-lien")}>Copier le lien</ElementContextuel>
          <SeparateurContextuel />
        </>
      )}
      {menu.image && (
        <>
          <ElementContextuel icone="image-01" onChoisir={() => faire("image-onglet")}>Ouvrir l’image dans un nouvel onglet</ElementContextuel>
          <ElementContextuel icone="copy-left" onChoisir={() => faire("copier-image")}>Copier l’adresse de l’image</ElementContextuel>
          <SeparateurContextuel />
        </>
      )}
      {menu.editable ? (
        <>
          <ElementContextuel icone="eraser-01" desactive={!menu.peut.couper} raccourci={raccourciDuSysteme("⌘X")} onChoisir={() => faire("couper")}>Couper</ElementContextuel>
          <ElementContextuel icone="copy-left" desactive={!menu.peut.copier} raccourci={raccourciDuSysteme("⌘C")} onChoisir={() => faire("copier")}>Copier</ElementContextuel>
          <ElementContextuel icone="copy-right" desactive={!menu.peut.coller} raccourci={raccourciDuSysteme("⌘V")} onChoisir={() => faire("coller")}>Coller</ElementContextuel>
          <ElementContextuel icone="text-input-01" raccourci={raccourciDuSysteme("⌘A")} onChoisir={() => faire("tout")}>Tout sélectionner</ElementContextuel>
          <SeparateurContextuel />
        </>
      ) : (
        menu.selection && (
          <>
            <ElementContextuel icone="copy-left" raccourci={raccourciDuSysteme("⌘C")} onChoisir={() => faire("copier")}>Copier</ElementContextuel>
            <ElementContextuel icone="search-01" onChoisir={() => faire("chercher")}>Chercher « {extrait} »</ElementContextuel>
            <SeparateurContextuel />
          </>
        )
      )}
      <ElementContextuel icone="arrow-rotate-left-01" desactive={!menu.peutReculer} onChoisir={() => faire("retour")}>Page précédente</ElementContextuel>
      <ElementContextuel icone="arrow-rotate-right-01" desactive={!menu.peutAvancer} onChoisir={() => faire("suivant")}>Page suivante</ElementContextuel>
      <ElementContextuel icone="refresh-01" onChoisir={() => faire("recharger")}>Recharger</ElementContextuel>
    </MenuContextuel>
  );
}

/**
 * La page ouverte, en plein écran sur la fenêtre. La barre reste au-dessus de
 * la vue native (elle ne peut rien laisser passer par-dessus). Échap quitte,
 * sauf si une fenêtre ou un menu de l'app l'utilise déjà.
 */
function PleinEcran({ ongletId, onFermer, children }: { ongletId: string; onFermer: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (document.querySelector(RECOUVRE_ECHAP)) return;
      e.preventDefault();
      e.stopPropagation();
      onFermer();
    };
    window.addEventListener("keydown", onKey, true);
    const off = pont()?.onEchap?.((id) => {
      if (id === ongletId && !document.querySelector(RECOUVRE_ECHAP)) onFermer();
    });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      off?.();
    };
  }, [ongletId, onFermer]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div data-plein-ecran-navigateur className="fixed inset-0 z-40 flex min-h-0 flex-col bg-fond-surface">
      {children}
    </div>,
    document.body,
  );
}

/** Une page ouverte : sa barre, ce qui s'y passe, la page elle-même, ses téléchargements. */
function Page({ onglet, chat, nombre, retour, nouveau }: { onglet: OngletNavigateur; chat: Chat; nombre: number; retour: () => void; nouveau: boolean }) {
  const zone = useRef<HTMLDivElement>(null);
  const recouvert = usePlacementOnglet(onglet.id, zone);
  const p = pont();
  const [menu, setMenu] = useState<{ menu: MenuNavigateur; x: number; y: number } | null>(null);
  const [coffre, setCoffre] = useState(false);
  /* Clic droit dans la page : le main l'annonce, le menu se pose au point du clic (page + zone). */
  useEffect(
    () =>
      p?.onMenu?.((id, m) => {
        if (id !== onglet.id || !zone.current) return;
        const r = zone.current.getBoundingClientRect();
        setMenu({ menu: m, x: r.left + m.x, y: r.top + m.y });
      }),
    [p, onglet.id],
  );
  const site = /^https?:/.test(onglet.url) ? siteDe(onglet.url) : null;
  const fermer = () => {
    retour();
    void p?.fermer(onglet.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex shrink-0 flex-col gap-1.5 border-b border-bordure-subtile px-2 py-2">
        {/* Au bord de la barre : la page native couvre toute la zone en dessous. */}
        {onglet.chargement && <span className="klyra-chargement-navigateur absolute inset-x-0 -bottom-px h-0.5" aria-hidden />}
        <div className="flex items-center gap-0.5">
          <Bouton variant="sombre" taille="mini" iconeGauche={<Icon name="chevron-left" size={14} />} onClick={retour} aria-keyshortcuts="Escape" aria-label="Retour au panneau">
            Retour
          </Bouton>
          <span className="px-1 text-ui-2xs text-texte-tertiaire">Échap</span>
          <span className="klyra-mono text-ui-2xs text-texte-tertiaire">{nombre}</span>
          <span className="mx-1 h-4 w-px bg-bordure-subtile" />
          <BoutonIcone taille="mini" cote="haut" icone={<Icon name="arrow-rotate-left-01" size={14} />} libelle="Page précédente" disabled={!onglet.peutReculer} onClick={() => void p?.historique(onglet.id, "retour")} />
          <BoutonIcone taille="mini" cote="haut" icone={<Icon name="arrow-rotate-right-01" size={14} />} libelle="Page suivante" disabled={!onglet.peutAvancer} onClick={() => void p?.historique(onglet.id, "suivant")} />
          <BoutonIcone
            taille="mini"
            cote="haut"
            icone={<Icon name={onglet.chargement ? "x-01" : "refresh-01"} size={14} />}
            libelle={onglet.chargement ? "Arrêter le chargement" : "Recharger"}
            onClick={() => void p?.historique(onglet.id, onglet.chargement ? "arreter" : "recharger")}
          />
          <span className="flex-1" />
          {!onglet.main && (
            <BoutonIcone taille="mini" cote="haut" icone={<Icon name="cursor-01" size={14} />} libelle="Prendre la main sur cet onglet" onClick={() => void p?.main(onglet.id, true)} />
          )}
          {site && p?.coffre && (
            <BoutonIcone taille="mini" cote="haut" icone={<Icon name="lock-01" size={14} />} libelle="Mots de passe de ce site" aria-haspopup="dialog" onClick={() => setCoffre(true)} />
          )}
          <BoutonIcone taille="mini" cote="haut" icone={<Icon name="link-external" size={14} />} libelle="Ouvrir dans ton navigateur" disabled={!/^https?:/.test(onglet.url)} onClick={() => void p?.ailleurs(onglet.id)} />
          <BoutonIcone taille="mini" cote="haut" icone={<Icon name="trash-01" size={14} />} libelle="Fermer l’onglet" data-son="fermer" onClick={fermer} />
        </div>
        <BarreAdresse onglet={onglet} focusAuDepart={nouveau} />
        {onglet.erreur && <span className="px-1 text-ui-2xs text-texte-erreur">{onglet.erreur}</span>}
      </div>

      <Bandeau onglet={onglet} chat={chat} />

      <div ref={zone} data-zone-navigateur className="relative min-h-0 flex-1 overflow-hidden bg-fond-surface">
        {/* Sous la page native : sa vignette, visible quand la page s'efface (fenêtre ou menu par-dessus) ou charge. */}
        {onglet.vignette && (
          // eslint-disable-next-line @next/next/no-img-element -- une capture en data:, pas une image du site
          <img src={onglet.vignette} alt="" className={cn("absolute inset-x-0 top-0 w-full object-cover object-top", !recouvert && "opacity-60")} />
        )}
      </div>

      {menu && <MenuPage onglet={onglet} menu={menu.menu} x={menu.x} y={menu.y} onFermer={() => setMenu(null)} />}
      {coffre && site && <ModaleCoffre hote={site.replace(/:\d+$/, "")} ongletId={onglet.id} onFermer={() => setCoffre(false)} />}

      {onglet.telechargements.length > 0 && (
        <ul aria-label="Téléchargements" className="m-0 flex shrink-0 list-none flex-col gap-0.5 border-t border-bordure-subtile p-1.5">
          {onglet.telechargements.slice(0, 3).map((t) => (
            <li key={t.chemin}>
              <button
                type="button"
                disabled={t.etat !== "fini"}
                onClick={() => void p?.montrerTelechargement(t.chemin)}
                title={t.chemin}
                className="flex w-full cursor-pointer items-center gap-2 rounded-2xs border-0 bg-transparent px-1.5 py-1 text-left hover:bg-fond-survol disabled:cursor-default"
              >
                <Icon name={t.etat === "en-cours" ? "loader-01" : "download-02"} size={14} className={cn("shrink-0 text-icone-secondaire", t.etat === "en-cours" && "animate-spin")} />
                <span className="min-w-0 flex-1 truncate text-ui-xs text-texte-principal">{t.nom}</span>
                <span className="text-ui-2xs text-texte-tertiaire">
                  {t.etat === "fini" ? "Montrer" : t.etat === "en-cours" ? (t.total ? `${Math.round((t.recus / t.total) * 100)} %` : octets(t.recus)) : t.etat === "annule" ? "Annulé" : "Échec"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Une carte d'onglet : sa vignette, son titre, son site, et qui l'utilise. */
function Carte({ onglet, ouvrir }: { onglet: OngletNavigateur; ouvrir: () => void }) {
  const roleId = onglet.main?.type === "demandee" ? onglet.main.roleId : onglet.pilote?.roleId;
  const agent = useRole(roleId ?? "principal");
  return (
    <li className="group/carte relative">
      <button
        type="button"
        onClick={ouvrir}
        className="flex w-full cursor-pointer flex-col gap-1.5 rounded-md border-0 bg-transparent p-1.5 text-left hover:bg-fond-survol"
      >
        <span className="relative block aspect-[16/10] w-full overflow-hidden rounded-sm border border-bordure-subtile bg-fond-surface-grise">
          {onglet.vignette ? (
            // eslint-disable-next-line @next/next/no-img-element -- une capture en data:, pas une image du site
            <img src={onglet.vignette} alt="" className="size-full object-cover object-top" />
          ) : (
            <span className="flex size-full items-center justify-center text-icone-secondaire">
              <Icon name="globe-01" size={20} />
            </span>
          )}
          {roleId && (
            <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 rounded-pill bg-fond-surface py-0.5 pr-2 pl-0.5 text-ui-2xs font-medium text-texte-principal shadow-ombre-xs">
              <AgentRond roleId={roleId} taille={16} />
              {onglet.main?.type === "demandee" ? `${agent.name} t’attend` : agent.name}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 px-0.5">
          <span className="truncate text-ui-s font-medium text-texte-principal">{onglet.titre || siteDe(onglet.url)}</span>
          <span className="truncate text-ui-2xs text-texte-tertiaire">
            {onglet.url === "about:blank" ? "Page vide" : siteDe(onglet.url)}
            {onglet.chargement ? " · chargement…" : ""}
          </span>
        </span>
      </button>
      <BoutonIcone
        taille="mini"
        variant="blanc"
        icone={<Icon name="x-01" size={12} />}
        libelle="Fermer l’onglet"
        data-son="fermer"
        onClick={() => void pont()?.fermer(onglet.id)}
        className="absolute top-3 right-3 size-6 opacity-0 shadow-ombre-xs transition-opacity duration-[120ms] group-hover/carte:opacity-100 focus-visible:opacity-100"
      />
    </li>
  );
}

export function PanneauNavigateur({ chat }: { chat: Chat }) {
  const onglets = useOngletsChat(chat.id);
  const [vu, setVu] = useOngletVu(chat.id);
  const [nouveau, setNouveau] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const agent = useRole(chat.roleIds[0] ?? "principal");
  const p = pont();
  const retour = useCallback(() => setVu(null), [setVu]);
  /* Un agent attend la personne sur une page : elle s'ouvre (une fois par demande). */
  const enAttente = onglets.find((o) => o.main?.type === "demandee");
  const demande = enAttente?.main?.type === "demandee" ? `${enAttente.id}:${enAttente.main.raison}` : null;
  const [demandeVue, setDemandeVue] = useState<string | null>(null);
  if (demande && enAttente && demande !== demandeVue) {
    setDemandeVue(demande);
    if (vu !== enAttente.id) setVu(enAttente.id);
  }

  if (!p) {
    return (
      <Vide titre="Le navigateur est dans l’app de bureau">
        <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">Ouvre KLYRA sur ton ordinateur pour voir les pages que tes agents utilisent.</span>
      </Vide>
    );
  }

  const ouvrir = async (url?: string) => {
    setErreur(null);
    const r = await p.ouvrir(chat.id, url);
    if (!r.ok) return setErreur(r.message);
    setNouveau(url ? null : r.data);
    setVu(r.data);
  };

  const ongletVu = onglets.find((o) => o.id === vu);
  const surServeur = !!chat.lieu;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
      {ongletVu && (
        <PleinEcran ongletId={ongletVu.id} onFermer={retour}>
          <Page key={ongletVu.id} onglet={ongletVu} chat={chat} nombre={onglets.length} retour={retour} nouveau={nouveau === ongletVu.id} />
        </PleinEcran>
      )}
      <div className="flex items-center justify-between gap-2 px-1.5 pt-1">
        <span className="text-ui-xs font-semibold text-texte-principal">
          {onglets.length ? `${onglets.length} onglet${onglets.length > 1 ? "s" : ""}` : "Navigateur"}
        </span>
        <Bouton variant="gris" taille="mini" iconeGauche={<Icon name="plus-01" size={14} />} onClick={() => void ouvrir()}>
          Nouvel onglet
        </Bouton>
      </div>
      {erreur && <span className="px-1.5 text-ui-xs text-texte-erreur">{erreur}</span>}
      {surServeur && (
        <span className="mx-1.5 rounded-sm bg-fond-surface-grise px-2.5 py-2 text-ui-xs leading-[1.45] text-texte-secondaire">
          Cette conversation tourne sur un serveur : ses agents utilisent ce navigateur, sur cet ordinateur, tant que KLYRA y est ouvert.
        </span>
      )}
      {onglets.length ? (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-1 p-0">
          {onglets.map((o) => (
            <Carte key={o.id} onglet={o} ouvrir={() => setVu(o.id)} />
          ))}
        </ul>
      ) : (
        <Vide titre="Aucun onglet dans cette conversation">
          <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">
            {`Quand ${agent.name} utilise un site pour toi, ses onglets s’affichent ici et tu le vois faire. Tu peux aussi ouvrir une page, t’y connecter, puis lui demander de continuer.`}
          </span>
        </Vide>
      )}
    </div>
  );
}
