/// <reference types="vite/client" />

declare module '*.png' {
	const value: string;
	export default value;
}

interface ImportMetaEnv {
	readonly VITE_WS_URL: string;
	readonly VITE_API_KEY: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
