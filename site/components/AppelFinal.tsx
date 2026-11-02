import type { ReactNode } from "react";

/** Carte d’appel en bas de page : titre, phrase, actions, sur un écran de points bleu qui s’efface. */
export function AppelFinal({ titre, texte, children }: { titre: string; texte: string; children: ReactNode }) {
  return (
    <section
      aria-label={titre}
      className="relative isolate overflow-hidden rounded-2xl border border-bordure-subtile bg-fond-surface px-6 py-14 text-center shadow-ombre-ambiante sm:px-12 sm:py-20"
    >
      <div className="klyra-site-points-bleus absolute inset-0 -z-10" aria-hidden />
      <h2 className="mx-auto max-w-[18ch] text-[clamp(30px,4vw,48px)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance">
        {titre}
      </h2>
      <p className="mx-auto mt-4 max-w-[46ch] text-body-s leading-[1.55] text-texte-secondaire">{texte}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{children}</div>
    </section>
  );
}
