// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],
  vite: {
    server: {
      // Vite+ core (rolldown) attaches its own HMR WebSocket `upgrade` listener
      // on the shared HTTP server, which collides with Nuxt's HMR socket and
      // throws "handleUpgrade() was called more than once". Nuxt forces
      // `server.ws = { server }` (overriding `ws: false`), so we instead give
      // Vite+ core a dedicated WS port. Its createWebSocketServer then spins up
      // a SEPARATE WebSocket server (the `else` branch) and does NOT attach a
      // listener to the main HTTP server, eliminating the clash.
      ws: { port: 24999 },
    },
    plugins: [
      {
        name: "docs:separate-vite-ws",
        configResolved(config) {
          // Runs after Nuxt's own `config` hook, so this wins for createServer.
          config.server.ws = { port: 24999 };
        },
      },
      tailwindcss(),
    ],
  },
  app: {
    head: {
      link: [
        {
          rel: "preconnect",
          href: "https://fonts.googleapis.com",
        },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossorigin: "",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&display=swap",
        },
      ],
    },
  },
});
