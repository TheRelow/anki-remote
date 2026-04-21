/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANKI_API_BASE?: string;
  readonly VITE_ANKI_DEV_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
