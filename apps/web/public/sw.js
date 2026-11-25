/* Lighthouse 이용자 화면 서비스 워커(A13 웹 푸시). 알림을 띄우고, 누르면 리뷰 화면(/?request=<id>)을 연다.
   화면 캐시는 하지 않는다(늘 서버의 최신 화면). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Lighthouse";
  const options = {
    body: data.body || "리뷰가 도착했어요.",
    icon: "/brand/app-icon-192.png",
    badge: "/brand/app-icon-192.png",
    lang: "ko",
    tag: data.url || "lighthouse-review",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "navigate" in client) {
          await client.focus();
          return client.navigate(target);
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
