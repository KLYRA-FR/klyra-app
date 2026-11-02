/* global self, caches, URL, Response */
/**
 * Service worker de l'app web KLYRA (spec mobile M-1 et § 8), enregistré par la coque du
 * téléphone, jamais dans l'app de bureau.
 * - La coque s'ouvre sans réseau : chaque fichier de l'app passe d'abord par le réseau, puis sa
 *   copie sert quand le réseau manque. Les données (Convex) ne sont jamais gardées ici : sans
 *   réseau, l'app dit « Hors ligne » (P-12).
 * - Les notifications du téléphone : affichées à leur arrivée ; touchées, elles ouvrent l'écran visé.
 */

const CACHE = "klyra-coque-v1";
/** Au-delà, les plus anciennes copies partent (chaque version de l'app apporte ses fichiers). */
const COPIES_MAX = 400;
const COQUE = ["/", "/chats", "/manifest.webmanifest", "/brand/logo-icone.svg", "/icons/icone-192.png", "/icons/icone-512.png"];

/** Un chemin de l'app (`/chat?id=…`), jamais une adresse : sinon les Chats. */
function chemin(lien) {
  return typeof lien === "string" && /^\/[a-z-]*(\?[^\s#]*)?$/.test(lien) ? lien : "/chats";
}

/** Une copie par chemin, sans ses paramètres : `/chat?id=…` se rend par la même page que `/chat`. */
const cleDe = (url) => `${url.origin}${url.pathname}`;

async function garder(cle, reponse) {
  if (!reponse || reponse.status !== 200 || reponse.type !== "basic") return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(cle, reponse);
    const cles = await cache.keys();
    for (const ancienne of cles.slice(0, Math.max(0, cles.length - COPIES_MAX))) await cache.delete(ancienne);
  } catch {
    /* Stockage plein ou refusé : l'app marche, sans copie. */
  }
}

/** La coque et les fichiers qu'elle charge (scripts, styles, police), lus dans ses pages. */
async function copierCoque() {
  const cache = await caches.open(CACHE);
  const fichiers = new Set(COQUE);
  for (const page of ["/", "/chats"]) {
    try {
      const reponse = await fetch(page, { cache: "no-cache" });
      if (!reponse.ok) continue;
      const html = await reponse.clone().text();
      await cache.put(cleDe(new URL(page, self.location.origin)), reponse);
      for (const [, src] of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) fichiers.add(src);
    } catch {
      /* Sans réseau à l'installation : les copies se font à l'usage. */
    }
  }
  await Promise.all(
    [...fichiers].map(async (f) => {
      try {
        const reponse = await fetch(f);
        if (reponse.status === 200) await cache.put(cleDe(new URL(f, self.location.origin)), reponse);
      } catch {
        /* idem */
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(copierCoque().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const nom of await caches.keys()) if (nom.startsWith("klyra-coque-") && nom !== CACHE) await caches.delete(nom);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const requete = event.request;
  if (requete.method !== "GET") return;
  const url = new URL(requete.url);
  /* Convex, les polices de Google et le reste du monde : pas d'intermédiaire. */
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      try {
        const reponse = await fetch(requete);
        event.waitUntil(garder(cleDe(url), reponse.clone()));
        return reponse;
      } catch (erreur) {
        const copie = await caches.match(cleDe(url), { ignoreVary: true });
        if (copie) return copie;
        /* Une page jamais ouverte : la coque la rend quand même, d'après l'adresse. */
        if (requete.mode === "navigate") {
          const coque = (await caches.match(`${self.location.origin}/chats`)) ?? (await caches.match(`${self.location.origin}/`));
          if (coque) return coque;
        }
        if (requete.mode === "navigate") return new Response("Hors ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        throw erreur;
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let message = null;
  try {
    message = event.data ? event.data.json() : null;
  } catch {
    message = null;
  }
  const titre = message && typeof message.titre === "string" && message.titre ? message.titre : "KLYRA";
  event.waitUntil(
    self.registration.showNotification(titre, {
      body: message && typeof message.corps === "string" ? message.corps : "",
      icon: "/icons/icone-192.png",
      badge: "/icons/badge-96.png",
      tag: message && typeof message.tag === "string" && message.tag ? message.tag : undefined,
      data: { lien: chemin(message && message.lien) },
      lang: "fr",
    }),
  );
});

/* Touchée : l'écran visé, dans la fenêtre de l'app si elle est ouverte, sinon dans une nouvelle. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const lien = chemin(event.notification.data && event.notification.data.lien);
  event.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const fenetre = fenetres.find((f) => new URL(f.url).origin === self.location.origin);
      if (fenetre) {
        try {
          await fenetre.focus();
        } catch {
          /* Le système garde la main sur le focus. */
        }
        fenetre.postMessage({ type: "klyra:ouvrir", lien });
        return;
      }
      await self.clients.openWindow(lien);
    })(),
  );
});
