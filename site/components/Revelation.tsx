"use client";

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";

/** Fait apparaître son bloc (fondu, montée de 8 px) quand il entre à l’écran, une fois. */
export function Revelation({ children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observateur = new IntersectionObserver(
      ([entree]) => {
        if (!entree?.isIntersecting) return;
        el.dataset.revealed = "true";
        observateur.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observateur.observe(el);
    return () => observateur.disconnect();
  }, []);

  return (
    <div ref={ref} data-revealed="false" {...rest}>
      {children}
    </div>
  );
}
