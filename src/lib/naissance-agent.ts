/**
 * La naissance d'un agent créé depuis l'atelier (cf. CarteAtelier) : un éclat de points, comme
 * l'écran du bouton Principal, puis son visuel qui s'envole jusqu'à sa place dans la barre
 * latérale. En Web Animations, sans rien ajouter à globals.css ; rien ne bouge si le poste demande
 * moins d'animations.
 */

const COURBE = "cubic-bezier(0.22, 1, 0.36, 1)";

const reduit = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Des points carrés qui jaillissent du centre de l'élément et retombent, sur la grille de 4 px. */
export function eclatDePoints(source: Element, teintes: string[]): void {
  if (reduit()) return;
  const r = source.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < 44; i++) {
    const point = document.createElement("span");
    Object.assign(point.style, {
      position: "fixed",
      left: `${cx}px`,
      top: `${cy}px`,
      width: "4px",
      height: "4px",
      borderRadius: "1px",
      background: teintes[i % teintes.length],
      pointerEvents: "none",
      zIndex: "80",
    });
    point.setAttribute("aria-hidden", "true");
    document.body.append(point);
    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 160;
    const dx = Math.round((Math.cos(angle) * distance) / 4) * 4;
    const dy = Math.round((Math.sin(angle) * distance) / 4) * 4 - 40;
    point
      .animate(
        [
          { transform: "translate(0, 0)", opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 1, offset: 0.7 },
          { transform: `translate(${dx}px, ${dy + 28}px)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 500, easing: COURBE },
      )
      .finished.catch(() => {})
      .finally(() => point.remove());
  }
}

/**
 * Sa place dans la barre latérale : un avatar de cet agent hors du fil de la conversation, visible.
 * L'agent vient d'être créé : sa ligne peut mettre un instant à paraître.
 */
function attendrePlace(agentId: string, delaiMs: number): Promise<HTMLElement | null> {
  const chercher = () =>
    [...document.querySelectorAll<HTMLElement>(`[data-avatar-agent="${CSS.escape(agentId)}"]`)].find((el) => {
      if (el.closest("[data-message]")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    }) ?? null;
  const debut = performance.now();
  return new Promise((resolve) => {
    const tour = () => {
      const place = chercher();
      if (place || performance.now() - debut > delaiMs) resolve(place);
      else requestAnimationFrame(tour);
    };
    tour();
  });
}

const accueillir = (place: HTMLElement) => {
  if (!reduit()) place.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 520, easing: COURBE });
};

/** Le visuel (sur son fond `fond`) s'envole en arc jusqu'à sa place ; `false` s'il n'en a pas de visible (barre repliée…). */
export async function envoler(visuel: HTMLElement, agentId: string, fond: string): Promise<boolean> {
  const place = await attendrePlace(agentId, 2000);
  if (!place) return false;
  if (reduit()) {
    accueillir(place);
    return true;
  }
  const a = visuel.getBoundingClientRect();
  const b = place.getBoundingClientRect();
  const vol = visuel.cloneNode(true) as HTMLElement;
  vol.setAttribute("aria-hidden", "true");
  vol.querySelectorAll("[data-avatar-agent]").forEach((el) => el.removeAttribute("data-avatar-agent"));
  Object.assign(vol.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${a.width}px`,
    height: `${a.height}px`,
    margin: "0",
    zIndex: "80",
    pointerEvents: "none",
    transformOrigin: "0 0",
    overflow: "hidden",
    borderRadius: "24px",
    boxShadow: "var(--shadow-ombre-levee)",
    backgroundImage: fond,
  });
  document.body.append(vol);
  const sx = b.width / a.width;
  const sy = b.height / a.height;
  const milieuX = (a.left + b.left) / 2 - 40;
  const milieuY = Math.min(a.top, b.top) - 80;
  try {
    await vol.animate(
      [
        { transform: `translate(${a.left}px, ${a.top}px) scale(1)`, borderRadius: "24px" },
        { transform: `translate(${milieuX}px, ${milieuY}px) scale(${(1 + sx) / 2}, ${(1 + sy) / 2})`, offset: 0.45 },
        { transform: `translate(${b.left}px, ${b.top}px) scale(${sx}, ${sy})`, borderRadius: `${Math.round(24 / Math.min(sx, sy) / 3)}px` },
      ],
      { duration: 1100, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "forwards" },
    ).finished;
  } catch {
    /* animation interrompue (la page change) */
  } finally {
    vol.remove();
  }
  accueillir(place);
  return true;
}
