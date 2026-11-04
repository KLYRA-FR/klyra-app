"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { EFFORTS, MODELES } from "@/components/chat/ChoixModele";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { garderBrouillon, lireBrouillons, surBrouillon } from "@/lib/brouillons";
import { cn } from "@/lib/cn";
import { messageErreur } from "@/lib/compte";
import type { Activite } from "@/lib/copie-compte";
import { useGestePoste } from "@/lib/poste/client";
import { bandeauComposeur, majuscule, support, supportOuOrdinateur } from "@/lib/poste-texte";
import { nomLieu, useServeursRelies } from "@/lib/lieux";
import { jetonAppareil } from "@/lib/serveur-vps";
import { ASSISTANT, mentionDans, mentionEnCours, type ConversationLue } from "@/lib/telephone/chats";
import { useEnvoyerMessage } from "@/lib/telephone/envoi";
import { lireModele, type OptionsMessage } from "@/lib/telephone/options";
import { ajouterPieces, MAX_PIECES, nomCapture, taillePiece, texteParDefaut } from "@/lib/telephone/pieces";
import { Feuille, MenuFeuille } from "./Feuille";
import { usePostes, useSupport } from "./poste";
import { RondAgent, useCartes } from "./AgentsChat";

const PUCE = "flex h-11 shrink-0 items-center gap-1.5 rounded-xs border border-bordure-subtile bg-fond-surface px-3 text-ui text-texte-principal";

type Choix = { modele: string | null; effort: string | null };

function libelleModele(choix: Choix | null): string {
  if (!choix?.modele) return "Modèle de la fiche";
  const nom = MODELES.find((m) => m.id === choix.modele)?.nom.replace("Claude ", "") ?? choix.modele;
  const effort = choix.modele !== "haiku" ? EFFORTS.find((e) => e.id === choix.effort)?.nom : undefined;
  return effort ? `${nom} · ${effort}` : nom;
}

/** « Modèle et effort » en feuille : ils partent avec le prochain message (File). */
function FeuilleModele({ actuel, onChoisir, onFermer }: { actuel: Choix | null; onChoisir: (choix: Choix) => void; onFermer: () => void }) {
  const [choix, setChoix] = useState<Choix>(actuel ?? { modele: null, effort: null });
  const radio = (choisi: boolean) =>
    cn("flex min-h-12 w-full items-center gap-3 border-b border-bordure-subtile text-left text-body-s last:border-b-0", choisi ? "font-medium text-texte-principal" : "text-texte-principal");
  const rond = (choisi: boolean) => (
    <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", choisi ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte")}>
      {choisi ? <Icon name="check-01" size={14} /> : null}
    </span>
  );
  return (
    <Feuille
      titre="Modèle et effort"
      onFermer={onFermer}
      pied={
        <button
          type="button"
          className="klyra-surface-sombre h-11 w-full rounded-xs text-body-s text-texte-inverse"
          onClick={() => {
            onFermer();
            onChoisir(choix);
          }}
        >
          Choisir
        </button>
      }
    >
      <div role="radiogroup" aria-label="Modèle">
        <button type="button" role="radio" aria-checked={!choix.modele} className={radio(!choix.modele)} onClick={() => setChoix({ modele: null, effort: null })}>
          {rond(!choix.modele)}
          Celui de la fiche
        </button>
        {MODELES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={choix.modele === m.id}
            className={radio(choix.modele === m.id)}
            onClick={() => setChoix((c) => ({ modele: m.id, effort: m.id === "haiku" ? null : (c.effort ?? "high") }))}
          >
            {rond(choix.modele === m.id)}
            {m.nom}
          </button>
        ))}
      </div>
      {choix.modele && choix.modele !== "haiku" ? (
        <>
          <p className="mt-4 text-ui font-medium text-texte-secondaire">Effort de réflexion</p>
          <div role="radiogroup" aria-label="Effort" className="mt-2 grid grid-cols-3 gap-2">
            {EFFORTS.map((e) => (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={choix.effort === e.id}
                onClick={() => setChoix((c) => ({ ...c, effort: e.id }))}
                className={cn("h-11 rounded-xs text-ui font-medium", choix.effort === e.id ? "klyra-surface-sombre text-texte-inverse" : "bg-fond-surface-grise text-texte-secondaire")}
              >
                {e.nom}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <p className="mt-4 text-ui-xs text-texte-secondaire">Le choix part avec ton prochain message.</p>
    </Feuille>
  );
}

/**
 * Le composeur du fil (T-02), collé en bas (le fil suit le clavier) : joindre, écrire (texte 16 px),
 * mentionner, destinataire, modèle, et Envoyer — ou « Mettre en attente » pendant que l'agent travaille,
 * avec Arrêter à côté (Poste). L'envoi passe par `useEnvoyerMessage` (File) ; le brouillon reste sur ce téléphone.
 */
export function ComposeurFil({
  origine,
  conversation,
  equipe,
  nouveauProjet,
  agentId,
  activite,
}: {
  origine: string;
  conversation: ConversationLue | undefined;
  equipe: boolean;
  nouveauProjet: string | null;
  agentId: string | null;
  activite: Activite | null;
}) {
  const envoyer = useEnvoyerMessage();
  const { postes, principal, ouvert } = usePostes();
  const sur = useSupport();
  const { cartes, nom } = useCartes();
  const arret = useGestePoste();
  const [texte, setTexte] = useState(() => (typeof window === "undefined" ? "" : (lireBrouillons()[origine]?.text ?? "")));
  const [pieces, setPieces] = useState<File[]>([]);
  const [alerte, setAlerte] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [destinataire, setDestinataire] = useState<string | null>(null);
  const [choix, setChoix] = useState<Choix | null>(null);
  const [posteChoisi, setPosteChoisi] = useState<string | null>(null);
  const [feuille, setFeuille] = useState<"joindre" | "mention" | "destinataire" | "modele" | "poste" | null>(null);
  const champ = useRef<HTMLTextAreaElement>(null);
  const curseur = useRef(0);
  const photo = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const fichier = useRef<HTMLInputElement>(null);

  /* Le brouillon, gardé par conversation sur ce téléphone (pas partagé entre appareils). */
  useEffect(() => {
    garderBrouillon(origine, { text: texte, fichiers: [] });
  }, [origine, texte]);
  /* Une suggestion de l'accueil s'ajoute au brouillon : focus, curseur à la fin, rien n'est envoyé. */
  useEffect(
    () =>
      surBrouillon(origine, (suite) => {
        setTexte(suite);
        requestAnimationFrame(() => {
          const el = champ.current;
          el?.focus();
          el?.setSelectionRange(suite.length, suite.length);
        });
      }),
    [origine],
  );
  /* Le champ grandit avec le texte, jusqu'à six lignes environ. */
  useEffect(() => {
    const el = champ.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [texte]);

  const occupe = ouvert && !!activite && activite.etat !== "question";
  const peutEnvoyer = (texte.trim().length > 0 || pieces.length > 0) && !envoi;
  const actifs = (cartes ?? []).filter((c) => c.actif || c.origine === ASSISTANT);
  const modeleActuel = choix ?? lireModele(conversation?.modele);
  const postesOuverts = [...(postes ?? [])].sort((a, b) => b.dernierSignal - a.dernierSignal);
  const posteVise = postesOuverts.find((p) => p.cle === posteChoisi) ?? postesOuverts[0];
  /* Conversation d'un VPS relié à ce téléphone : ordinateur fermé, le message part directement au VPS (`envoi.ts`). */
  const serveurs = useServeursRelies();
  const lieu = conversation?.lieu ?? null;
  const directVps = !ouvert && !!lieu && origine.startsWith("dm-") && !!jetonAppareil(lieu);
  const bandeau = ouvert
    ? null
    : directVps && principal
      ? `${majuscule(supportOuOrdinateur(principal))} est fermé : ton message part directement à ${nomLieu(lieu, serveurs)}.`
      : bandeauComposeur(principal);

  const joindre = (liste: FileList | File[] | null) => {
    if (!liste?.length) return;
    const { pieces: suite, alerte: refus } = ajouterPieces(pieces, [...liste]);
    setPieces(suite);
    setAlerte(refus);
  };

  const choisis = (e: ChangeEvent<HTMLInputElement>) => {
    joindre(e.target.files ? [...e.target.files] : null);
    e.target.value = "";
  };

  /* Une capture collée devient une pièce jointe, comme au bureau ; du texte se colle normalement. */
  const coller = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (!images.length || e.clipboardData.getData("text/plain").trim()) return;
    e.preventDefault();
    joindre(images.map((f) => (/^image\.\w+$/.test(f.name) || !f.name ? new File([f], nomCapture(f.type, new Date()), { type: f.type }) : f)));
  };

  const inserer = (mot: string) => {
    const position = curseur.current;
    const enCours = mentionEnCours(texte, position);
    const debut = enCours ? enCours.debut : position;
    const avant = texte.slice(0, debut);
    const apres = texte.slice(position);
    const suite = `${avant}${avant && !/\s$/.test(avant) ? " " : ""}@${mot} ${apres}`;
    setTexte(suite);
    const fin = suite.length - apres.length;
    requestAnimationFrame(() => {
      champ.current?.focus();
      champ.current?.setSelectionRange(fin, fin);
    });
  };

  const soumettre = async () => {
    if (!peutEnvoyer) return;
    const options: OptionsMessage = {};
    if (equipe) {
      const a = destinataire ?? mentionDans(texte, cartes ?? []);
      if (a && a !== ASSISTANT) options.a = a;
    }
    if (choix) {
      options.modele = choix.modele;
      options.effort = choix.effort;
    }
    if (nouveauProjet && !conversation) options.nouveau = { projetId: nouveauProjet };
    if (postesOuverts.length >= 2 && posteVise) options.poste = posteVise.cle;
    setEnvoi(true);
    setAlerte(null);
    try {
      await envoyer({ conversationOrigine: origine, texte: texteParDefaut(texte, pieces.length), options, pieces });
      setTexte("");
      setPieces([]);
    } catch (err) {
      setAlerte(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  };

  const arreter = async () => {
    const r = await arret.faire("fil.arreter", { conversation: origine });
    if (!r.ok) setAlerte(r.code === "delai" ? `${majuscule(sur)} ne répond pas.` : r.message || "L’agent n’a pas pu être arrêté.");
  };

  const placeholder = agentId ? `Écris à ${nom(agentId)}…` : equipe ? "Écris à l’équipe, ou @mentionne un agent…" : "Écris ton message…";

  return (
    <div className="shrink-0 border-t border-bordure-subtile bg-fond-surface px-3 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))]">
      {bandeau ? <p className="mb-2 text-ui text-texte-secondaire">{bandeau}</p> : null}
      {pieces.length ? (
        <ul aria-label="Pièces jointes" className="mb-2 flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {pieces.map((p, i) => (
            <li key={`${p.name}-${p.size}-${p.lastModified}`} className="flex h-12 max-w-[220px] shrink-0 items-center gap-2 rounded-md border border-bordure-subtile bg-fond-page pl-3">
              <Icon name={p.type.startsWith("image/") ? "image-01" : "file-01"} size={18} className="shrink-0 text-icone-secondaire" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-ui text-texte-principal">{p.name}</span>
                <span className="text-ui-xs text-texte-secondaire">{taillePiece(p.size)}</span>
              </span>
              <BoutonIcone variant="discret" className="size-11 shrink-0" libelle={`Retirer ${p.name}`} icone={<Icon name="x-01" size={16} />} onClick={() => setPieces((liste) => liste.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      ) : null}
      {alerte ? (
        <p role="alert" className="mb-2 text-ui text-texte-erreur">
          {alerte}
        </p>
      ) : null}
      {envoi && pieces.length ? (
        <p role="status" className="mb-2 text-ui text-texte-secondaire">
          Envoi des pièces jointes…
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void soumettre();
        }}
        className="flex items-end gap-1.5"
      >
        <BoutonIcone variant="discret" className="size-11 shrink-0" libelle="Joindre" aria-haspopup="dialog" icone={<Icon name="plus-01" size={22} />} onClick={() => setFeuille("joindre")} />
        <textarea
          ref={champ}
          rows={1}
          value={texte}
          aria-label="Message"
          placeholder={placeholder}
          enterKeyHint="send"
          onChange={(e) => {
            setTexte(e.target.value);
            curseur.current = e.target.selectionStart;
            /* « @ » tapé en début de mot : la liste des agents actifs, dans une feuille. */
            if (equipe && e.target.value.length > texte.length && mentionEnCours(e.target.value, e.target.selectionStart)?.requete === "") setFeuille("mention");
          }}
          onSelect={(e) => {
            curseur.current = e.currentTarget.selectionStart;
          }}
          onPaste={coller}
          className="max-h-[168px] min-h-11 min-w-0 flex-1 resize-none rounded-md border border-bordure-champ bg-fond-page px-3 py-2.5 text-body-s leading-[1.4] text-texte-principal"
        />
        {occupe ? (
          <BoutonIcone variant="blanc" className="size-11 shrink-0" libelle="Arrêter l’agent" disabled={arret.occupe} icone={<Icon name="stop-01" size={20} />} onClick={() => void arreter()} />
        ) : null}
        {!occupe || peutEnvoyer ? (
          <BoutonIcone type="submit" variant="sombre" className="size-11 shrink-0" libelle={occupe ? "Mettre en attente" : "Envoyer"} disabled={!peutEnvoyer} icone={<Icon name="arrow-up" size={20} />} />
        ) : null}
      </form>

      <div className="mt-2 flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {equipe ? (
          <>
            <button type="button" className={PUCE} aria-haspopup="dialog" onClick={() => setFeuille("destinataire")}>
              <Icon name="users-profiles-01" size={18} className="text-icone-secondaire" />
              {destinataire ? nom(destinataire) : nom(ASSISTANT)}
            </button>
            <button type="button" className={cn(PUCE, "min-w-11 justify-center")} aria-label="Mentionner un agent" aria-haspopup="dialog" onClick={() => setFeuille("mention")}>
              @
            </button>
          </>
        ) : null}
        <button type="button" className={PUCE} aria-haspopup="dialog" onClick={() => setFeuille("modele")}>
          {libelleModele(modeleActuel)}
          <Icon name="chevron-down" size={16} className="text-icone-secondaire" />
        </button>
        {postesOuverts.length >= 2 && posteVise ? (
          <button type="button" className={PUCE} aria-haspopup="dialog" onClick={() => setFeuille("poste")}>
            Sur {support(posteVise)}
            <Icon name="chevron-down" size={16} className="text-icone-secondaire" />
          </button>
        ) : null}
      </div>

      <input ref={photo} type="file" accept="image/*" multiple hidden onChange={choisis} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={choisis} />
      <input ref={fichier} type="file" multiple hidden onChange={choisis} />

      {feuille === "joindre" ? (
        <MenuFeuille
          titre={`Joindre · ${MAX_PIECES} fichiers au plus, 20 Mo chacun`}
          onFermer={() => setFeuille(null)}
          actions={[
            { libelle: "Photo", onChoisir: () => photo.current?.click() },
            { libelle: "Appareil photo", onChoisir: () => camera.current?.click() },
            { libelle: "Fichier", onChoisir: () => fichier.current?.click() },
          ]}
        />
      ) : null}
      {feuille === "mention" || feuille === "destinataire" ? (
        <Feuille titre={feuille === "mention" ? "Mentionner un agent" : "Destinataire"} onFermer={() => setFeuille(null)}>
          <ul>
            {actifs.map((c) => (
              <li key={c.origine}>
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-3 border-b border-bordure-subtile py-2 text-left last:border-b-0"
                  onClick={() => {
                    setFeuille(null);
                    if (feuille === "mention") inserer(c.nom);
                    else setDestinataire(c.origine === ASSISTANT ? null : c.origine);
                  }}
                >
                  <RondAgent id={c.origine} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body-s text-texte-principal">{c.nom}</span>
                    <span className="truncate text-ui text-texte-secondaire">{c.origine === ASSISTANT ? "Il répartit le travail" : c.roleCourt}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Feuille>
      ) : null}
      {feuille === "modele" ? <FeuilleModele actuel={modeleActuel} onChoisir={setChoix} onFermer={() => setFeuille(null)} /> : null}
      {feuille === "poste" ? (
        <MenuFeuille
          titre="Sur quel ordinateur ?"
          onFermer={() => setFeuille(null)}
          actions={postesOuverts.map((p) => ({ libelle: `${p.nom}${p.ouvert ? "" : " · fermé"}`, onChoisir: () => setPosteChoisi(p.cle) }))}
        />
      ) : null}
    </div>
  );
}
