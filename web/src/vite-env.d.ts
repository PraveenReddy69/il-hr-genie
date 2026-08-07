/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Unset means the console runs on mock data; set it to point at the backend. */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
