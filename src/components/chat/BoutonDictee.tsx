"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";

type Etat = "repos" | "ecoute" | "transcription";

/** Au-delà, l'enregistrement s'arrête de lui-même. */
const DUREE_MAX_MS = 5 * 60 * 1000;

/**
 * Le micro de la zone de saisie : un clic pour parler, un clic pour arrêter.
 * L'audio est transcrit sur le Mac (Whisper) et le texte s'ajoute au message.
 * Rien ne s'enregistre tant qu'on n'a pas cliqué.
 */
export function BoutonDictee({ onTexte }: { onTexte: (texte: string) => void }) {
  const [etat, setEtat] = useState<Etat>("repos");
  const [erreur, setErreur] = useState<string | null>(null);
  const [secondes, setSecondes] = useState(0);
  const enregistreur = useRef<MediaRecorder | null>(null);
  const morceaux = useRef<Blob[]>([]);
  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null);
  const limite = useRef<ReturnType<typeof setTimeout> | null>(null);

  const libererMicro = () => {
    enregistreur.current?.stream.getTracks().forEach((t) => t.stop());
    enregistreur.current = null;
    if (minuteur.current) clearInterval(minuteur.current);
    if (limite.current) clearTimeout(limite.current);
  };
  // On quitte l'écran en pleine dictée : le micro se coupe.
  useEffect(() => libererMicro, []);

  /* Un échec s'affiche à côté du micro quelques secondes. */
  const onErreur = (message: string) => {
    setErreur(message);
    setTimeout(() => setErreur(null), 6000);
  };
  const echec = (message: string) => {
    libererMicro();
    setEtat("repos");
    onErreur(message);
  };

  const commencer = async () => {
    const bridge = getBridge();
    if (!bridge?.systeme.transcrire) return echec("La dictée marche dans l’app de bureau.");
    const acces = await bridge.systeme.micro?.();
    if (acces && (!acces.ok || !acces.data)) {
      return echec("L’app n’a pas accès au micro : Réglages Système > Confidentialité > Micro.");
    }
    let flux: MediaStream;
    try {
      flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return echec("Micro introuvable ou refusé.");
    }
    const rec = new MediaRecorder(flux, { mimeType: "audio/webm;codecs=opus" });
    morceaux.current = [];
    rec.ondataavailable = (e) => e.data.size && morceaux.current.push(e.data);
    rec.onstop = async () => {
      libererMicro();
      setEtat("transcription");
      const audio = new Uint8Array(await new Blob(morceaux.current, { type: "audio/webm" }).arrayBuffer());
      const r = await bridge.systeme.transcrire!(audio);
      setEtat("repos");
      if (!r.ok) return onErreur(r.message);
      if (r.data) onTexte(r.data);
    };
    enregistreur.current = rec;
    rec.start();
    setSecondes(0);
    setEtat("ecoute");
    minuteur.current = setInterval(() => setSecondes((s) => s + 1), 1000);
    limite.current = setTimeout(() => rec.state === "recording" && rec.stop(), DUREE_MAX_MS);
  };

  const basculer = () => {
    setErreur(null);
    if (etat === "repos") void commencer();
    else if (etat === "ecoute") enregistreur.current?.stop();
  };

  const duree = `${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, "0")}`;

  return (
    <span className="ml-auto flex items-center gap-1.5">
      {etat === "ecoute" && (
        <span aria-live="polite" className="flex items-center gap-1.5 text-ui-xs text-texte-secondaire tabular-nums">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-texte-erreur motion-reduce:animate-none" />
          {duree}
        </span>
      )}
      {etat === "transcription" && <span className="text-ui-xs text-texte-tertiaire">Transcription…</span>}
      {erreur && etat === "repos" && <span role="alert" className="max-w-[260px] truncate text-ui-xs text-texte-erreur" title={erreur}>{erreur}</span>}
      <BoutonIcone
        taille="compact"
        variant={etat === "ecoute" ? "blanc" : undefined}
        icone={
          <Icon
            name={etat === "ecoute" ? "stop-01" : etat === "transcription" ? "loader-01" : "microphone-01"}
            size={etat === "ecoute" ? 16 : 20}
            className={cn(etat === "transcription" && "animate-spin motion-reduce:animate-none")}
          />
        }
        libelle={etat === "ecoute" ? "Arrêter la dictée" : etat === "transcription" ? "Transcription en cours" : "Dicter"}
        aria-pressed={etat === "ecoute"}
        disabled={etat === "transcription"}
        onClick={basculer}
        className={cn(etat === "repos" && "text-icone-secondaire hover:text-icone-defaut")}
      />
    </span>
  );
}
