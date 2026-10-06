const CACHE_NAME = "edunexa-offline-attendance-v1";
const OFFLINE_PAGE = "/offline-attendance.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(OFFLINE_PAGE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("edunexa-offline-attendance-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.mode !== "navigate" ||
    requestUrl.origin !== self.location.origin ||
    ![
      "/dashboard/staff/attendance",
      OFFLINE_PAGE,
    ].includes(requestUrl.pathname)
  ) {
    return;
  }

  event.respondWith(
    requestUrl.pathname === OFFLINE_PAGE
      ? caches.match(OFFLINE_PAGE).then((cached) =>
          cached || fetch(event.request),
        )
      : fetch(event.request).catch(async () => {
          const cached = await caches.match(OFFLINE_PAGE);
          return cached || Response.error();
        }),
  );
});
