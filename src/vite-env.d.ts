/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_USE_MOCK?: string;
  readonly VITE_PUBLIC_URL?: string;
  readonly VITE_SHOP_PASSWORD?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
