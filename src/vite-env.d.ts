/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Pekar om Hubbens inloggningsadress vid utveckling. Sätts i .env.local. */
  readonly VITE_HUB_EPOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
