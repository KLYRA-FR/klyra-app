"use client";

import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { getBridge, type TerminalAgent } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { etatTerminal, RELECTURE_FLUX_MS, terminalAffiche, useTerminauxChat } from "@/lib/terminal";
import { useRole } from "@/lib/workspace";
import type { Chat } from "@/types/domain";

/**
 * L'onglet « Terminal » du panneau d'une conversation : les terminaux interactifs que ses agents ouvrent
 * (`terminal_ouvrir`), en direct, et où la personne peut taper (un mot de passe qu'elle seule connaît, une URL
 * de retour d'OAuth, un « y »). Ce qu'elle tape va droit au terminal, sur ce PC ou sur le VPS de la conversation,
 * sans être noté nulle part. Plusieurs terminaux : une puce par terminal au-dessus.
 */

const pont = () => getBridge()?.terminal;

/** Les couleurs du terminal : les tokens du design system, lus sur la page (jamais une valeur en dur). */
function themeDesTokens(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const style = getComputedStyle(document.documentElement);
  const token = (nom: string) => style.getPropertyValue(nom).trim();
  return {
    background: token("--color-fond-surface"),
    foreground: token("--color-texte-principal"),
    cursor: token("--color-texte-principal"),
    selectionBackground: token("--color-fond-teinte-bleue"),
  };
}

function Vide({ titre, children }: { titre: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-md bg-fond-surface-grise text-icone-secondaire">
        <Icon name="code-01" size={20} />
      </span>
      <span className="mt-1.5 text-ui-s font-medium text-texte-principal">{titre}</span>
      {children}
    </div>
  );
}

/** Un terminal affiché : xterm.js, nourri par la sortie relue depuis sa position. */
function VueTerminal({ session, lieu }: { session: TerminalAgent; lieu: string | null }) {
  const cadre = useRef<HTMLDivElement>(null);
  const [ferme, setFerme] = useState(false);

  useEffect(() => {
    const p = pont();
    const element = cadre.current;
    if (!p || !element) return;
    let actif = true;
    let terminal: Terminal | null = null;
    let position = 0;
    let minuterie: ReturnType<typeof setTimeout> | null = null;
    let observateur: ResizeObserver | null = null;

    const relire = async () => {
      if (!actif || !terminal) return;
      const r = await p.flux(session.id, position, lieu);
      if (!actif || !terminal) return;
      if (r.ok && r.data) {
        if (r.data.reprise) terminal.reset();
        if (r.data.donnees) terminal.write(r.data.donnees);
        position = r.data.position;
        if (r.data.fini) return;
      } else if (r.ok && !r.data) {
        setFerme(true);
        return;
      }
      minuterie = setTimeout(() => void relire(), RELECTURE_FLUX_MS);
    };

    void import("@xterm/xterm").then(({ Terminal: Xterm }) => {
      if (!actif) return;
      const style = getComputedStyle(element);
      terminal = new Xterm({
        cols: 120,
        rows: 32,
        scrollback: 5000,
        cursorBlink: true,
        fontFamily: style.fontFamily,
        fontSize: parseFloat(style.fontSize) || 12,
        theme: themeDesTokens(),
      });
      terminal.open(element);
      terminal.onData((donnees) => void p.saisir(session.id, donnees, lieu));
      /* La taille suit le panneau quand le terminal sait changer la sienne (Linux), sinon 120 × 32. */
      const ajuster = () => {
        const t = terminal;
        const cellule = element.querySelector<HTMLElement>(".xterm-rows > div");
        if (!t || !cellule) return;
        const largeurCar = cellule.getBoundingClientRect().width / t.cols || 0;
        const hauteurLigne = cellule.getBoundingClientRect().height || 0;
        if (!largeurCar || !hauteurLigne) return;
        const cols = Math.max(20, Math.floor(element.clientWidth / largeurCar));
        const rows = Math.max(5, Math.floor(element.clientHeight / hauteurLigne));
        if (cols === t.cols && rows === t.rows) return;
        void p.taille(session.id, cols, rows, lieu).then((r) => {
          if (actif && r.ok && r.data) t.resize(cols, rows);
        });
      };
      observateur = new ResizeObserver(() => ajuster());
      observateur.observe(element);
      terminal.focus();
      void relire();
    });

    return () => {
      actif = false;
      if (minuterie) clearTimeout(minuterie);
      observateur?.disconnect();
      terminal?.dispose();
    };
  }, [session.id, lieu]);

  if (ferme) return <Vide titre="Ce terminal est fermé" />;
  return <div ref={cadre} className="klyra-terminal min-h-0 flex-1 overflow-auto px-2.5 py-2 text-ui-xs" data-terminal={session.id} aria-label={`Terminal : ${session.titre}`} />;
}

export function PanneauTerminal({ chat }: { chat: Chat }) {
  const lieu = chat.lieu ?? null;
  const liste = useTerminauxChat(chat.id, lieu);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const affiche = terminalAffiche(liste, choisi);
  const agent = useRole(affiche?.agent ?? "principal");

  if (!pont()) {
    return (
      <Vide titre="Le terminal est dans l’app de bureau">
        <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">Ouvre KLYRA sur ton ordinateur pour voir les terminaux de tes agents.</span>
      </Vide>
    );
  }
  if (!affiche) {
    return (
      <Vide titre="Aucun terminal dans cette conversation">
        <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">
          Quand un agent lance une commande qui attend une réponse (une connexion, une installation), son terminal s’affiche ici et tu peux y taper.
        </span>
      </Vide>
    );
  }

  const fermer = async () => {
    setErreur(null);
    const r = await pont()?.fermer(affiche.id, lieu);
    if (r && !r.ok) setErreur(r.message);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {liste.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-bordure-subtile px-2 py-1.5">
          {liste.map((s) => (
            <Bouton key={s.id} variant="discret" taille="mini" actif={s.id === affiche.id} onClick={() => setChoisi(s.id)}>
              {s.titre}
            </Bouton>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-bordure-subtile px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-ui-xs text-texte-secondaire">
          <span className="font-medium text-texte-principal">{affiche.titre}</span>
          {` · ${agent?.name ?? affiche.agent} · `}
          <span className={cn(!affiche.fini && "text-texte-accent")}>{etatTerminal(affiche)}</span>
        </span>
        <BoutonIcone variant="discret" taille="mini" libelle="Fermer ce terminal" icone={<Icon name="x-01" size={14} />} onClick={() => void fermer()} />
      </div>
      {erreur && <span className="px-3 py-1 text-ui-xs text-texte-erreur">{erreur}</span>}
      <VueTerminal key={affiche.id} session={affiche} lieu={lieu} />
    </div>
  );
}
