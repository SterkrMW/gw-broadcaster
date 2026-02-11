import { useState, useEffect, useCallback, useRef } from 'react';
import type { ServerMessage, BroadcastPayload, WelcomePayload } from '../types';

interface WebSocketState {
	isConnected: boolean;
	lastState: BroadcastPayload | null;
	welcome: WelcomePayload | null;
	error: string | null;
}

interface UseWebSocketOptions {
	url: string;
	reconnectIntervalMs?: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isWelcomePayload(value: unknown): value is WelcomePayload {
	if (!isObject(value)) return false;
	if (value.type !== 'welcome') return false;
	if (typeof value.message !== 'string') return false;
	if (typeof value.updateIntervalMs !== 'number') return false;

	const mapDimensions = value.mapDimensions;
	if (!isObject(mapDimensions)) return false;
	if (typeof mapDimensions.width !== 'number') return false;
	if (typeof mapDimensions.height !== 'number') return false;

	return true;
}

function isBroadcastPayload(value: unknown): value is BroadcastPayload {
	if (!isObject(value)) return false;
	if (value.type !== 'state') return false;
	if (typeof value.timestamp !== 'number') return false;
	if (!Array.isArray(value.instances)) return false;
	if ('bracket' in value && !(value.bracket === null || isObject(value.bracket))) return false;
	return true;
}

function isSessionTokenPayload(value: unknown): value is { token: string; expiresAt: number } {
	if (!isObject(value)) return false;
	if (typeof value.token !== 'string') return false;
	if (typeof value.expiresAt !== 'number') return false;
	return true;
}

async function parseJsonResponse(response: Response, endpoint: string): Promise<unknown> {
	const rawBody = await response.text();
	try {
		return JSON.parse(rawBody) as unknown;
	} catch {
		const contentType = response.headers.get('content-type') ?? 'unknown';
		const snippet = rawBody.slice(0, 120).replace(/\s+/g, ' ');
		throw new Error(
			`Session endpoint returned non-JSON (status ${response.status}, content-type: ${contentType}, body: "${snippet}") at ${endpoint}`
		);
	}
}

function buildSessionTokenUrl(wsUrl: URL): URL {
	const sessionUrl = new URL(wsUrl.toString());
	sessionUrl.protocol = sessionUrl.protocol === 'wss:' ? 'https:' : 'http:';
	sessionUrl.pathname = '/session-token';
	sessionUrl.search = '';
	return sessionUrl;
}

function normalizeWsUrlForClient(wsUrl: URL): URL {
	const normalized = new URL(wsUrl.toString());
	const pageHost = window.location.hostname;
	const isLoopbackHost =
		normalized.hostname === 'localhost' ||
		normalized.hostname === '127.0.0.1' ||
		normalized.hostname === '[::1]';

	if (isLoopbackHost && pageHost !== 'localhost' && pageHost !== '127.0.0.1') {
		normalized.hostname = pageHost;
	}

	return normalized;
}

export function useWebSocket({ url, reconnectIntervalMs = 5000 }: UseWebSocketOptions) {
	const [state, setState] = useState<WebSocketState>({
		isConnected: false,
		lastState: null,
		welcome: null,
		error: null,
	});

	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const connectRef = useRef<() => void>(() => {});
	const tokenRequestAbortRef = useRef<AbortController | null>(null);

	const connect = useCallback(() => {
		// Clear any pending reconnect
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}

		// Close existing connection
		if (wsRef.current) {
			wsRef.current.close();
		}
		if (tokenRequestAbortRef.current) {
			tokenRequestAbortRef.current.abort();
			tokenRequestAbortRef.current = null;
		}

		let wsUrl: URL;
		try {
			wsUrl = new URL(url);
		} catch {
			setState(prev => ({
				...prev,
				isConnected: false,
				error: `Invalid WebSocket URL: ${url}`,
			}));
			return;
		}
		wsUrl = normalizeWsUrlForClient(wsUrl);

		if (window.location.protocol === 'https:' && wsUrl.protocol !== 'wss:') {
			setState(prev => ({
				...prev,
				isConnected: false,
				error: 'Insecure ws:// URL blocked on HTTPS page. Use wss://.',
			}));
			return;
		}

		const abortController = new AbortController();
		tokenRequestAbortRef.current = abortController;
		const sessionTokenUrl = buildSessionTokenUrl(wsUrl);

		void fetch(sessionTokenUrl, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
			},
			signal: abortController.signal,
		})
			.then(async response => {
				const parsedBody = await parseJsonResponse(response, sessionTokenUrl.toString());
				if (!response.ok) {
					if (isObject(parsedBody) && typeof parsedBody.error === 'string') {
						throw new Error(
							`Session token request failed (${response.status}): ${parsedBody.error}`
						);
					}
					throw new Error(`Session token request failed (${response.status})`);
				}
				return parsedBody;
			})
			.then(payload => {
				if (!isSessionTokenPayload(payload)) {
					throw new Error('Invalid session token payload');
				}
				wsUrl.searchParams.set('sessionToken', payload.token);
				const ws = new WebSocket(wsUrl.toString());
				wsRef.current = ws;

				ws.onopen = () => {
					setState(prev => ({ ...prev, isConnected: true, error: null }));
				};

				ws.onmessage = event => {
					try {
						const parsed: unknown = JSON.parse(event.data);
						if (isWelcomePayload(parsed)) {
							const message: ServerMessage = parsed;
							setState(prev => {
								if (prev.welcome?.updateIntervalMs === message.updateIntervalMs) {
									return prev;
								}
								return { ...prev, welcome: message };
							});
						} else if (isBroadcastPayload(parsed)) {
							const message: ServerMessage = parsed;
							setState(prev => {
								if (prev.lastState?.timestamp === message.timestamp) {
									return prev;
								}
								return { ...prev, lastState: message };
							});
						} else {
							console.warn('Ignoring invalid WebSocket payload shape');
						}
					} catch (err) {
						console.error('Failed to parse WebSocket message:', err);
					}
				};

				ws.onclose = () => {
					setState(prev => ({ ...prev, isConnected: false }));
					wsRef.current = null;

					// Schedule reconnect using ref to avoid closure issues
					reconnectTimeoutRef.current = setTimeout(() => {
						connectRef.current();
					}, reconnectIntervalMs);
				};

				ws.onerror = () => {
					setState(prev => ({
						...prev,
						error: 'Connection error. Attempting to reconnect...',
					}));
				};
			})
			.catch(error => {
				if (abortController.signal.aborted) {
					return;
				}
				const sessionEndpoint = sessionTokenUrl.toString();
				const baseMessage =
					error instanceof Error ? error.message : 'Failed to establish session';
				setState(prev => ({
					...prev,
					isConnected: false,
					error: `${baseMessage} (session endpoint: ${sessionEndpoint})`,
				}));
				reconnectTimeoutRef.current = setTimeout(() => {
					connectRef.current();
				}, reconnectIntervalMs);
			})
			.finally(() => {
				if (tokenRequestAbortRef.current === abortController) {
					tokenRequestAbortRef.current = null;
				}
			});
	}, [url, reconnectIntervalMs]);

	// Keep ref updated with latest connect function
	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	// Connect on mount
	useEffect(() => {
		// Defer connection startup to avoid synchronous state updates during effect execution.
		const connectTimer = setTimeout(() => {
			connectRef.current();
		}, 0);

		return () => {
			clearTimeout(connectTimer);
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
			if (tokenRequestAbortRef.current) {
				tokenRequestAbortRef.current.abort();
			}
			if (wsRef.current) {
				wsRef.current.close();
			}
		};
	}, [connect]);

	return {
		...state,
		reconnect: connect,
	};
}
