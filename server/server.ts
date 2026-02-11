import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { Duplex } from 'stream';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, type WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';

// Node 18 compat: import.meta.dirname was added in Node 20.11
const __serverDir = typeof import.meta.dirname === 'string'
	? import.meta.dirname
	: path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration
// ============================================================================

interface ServerConfig {
	port: number;
	host?: string;
	allowedOrigins: string[];
	allowSameHostDifferentPort?: boolean;
	stateFilePath: string;
	pollIntervalMs: number;
	maxConnectionsPerIp: number;
	maxTotalConnections: number;
	trustProxy: boolean;
	idleTimeoutMs: number;
	sessionTokenTtlMs?: number;
}

// ============================================================================
// Types (matching game server output)
// ============================================================================

interface BroadcastPayload {
	type: 'state';
	timestamp: number;
	mapDimensions?: { width: number; height: number };
	instances: unknown[];
	bracket?: unknown | null;
}

interface WelcomePayload {
	type: 'welcome';
	message: string;
	mapDimensions: { width: number; height: number };
	updateIntervalMs: number;
}

interface ClientConnection {
	ws: WebSocket;
	ip: string;
	connectedAt: number;
	lastPongAt: number;
}

interface SessionTokenPayload {
	token: string;
	expiresAt: number;
}

interface SessionTokenState {
	ip: string;
	origin: string;
	expiresAt: number;
}

interface ErrorPayload {
	error: string;
}

// ============================================================================
// Load Config
// ============================================================================

const configPath = path.join(__serverDir, 'server.config.json');
if (!fs.existsSync(configPath)) {
	console.error(`Config file not found: ${configPath}`);
	process.exit(1);
}

const config: ServerConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const sessionTokenTtlMs = Math.max(5000, config.sessionTokenTtlMs ?? 30_000);
const listenHost = config.host ?? '0.0.0.0';

// ============================================================================
// State Management
// ============================================================================

const stateFilePath = path.resolve(__serverDir, config.stateFilePath);
const clients = new Map<WebSocket, ClientConnection>();
const ipConnectionCounts = new Map<string, number>();
const sessionTokens = new Map<string, SessionTokenState>();

let lastState: string = JSON.stringify({
	type: 'state',
	timestamp: Date.now(),
	mapDimensions: { width: 4800, height: 3000 },
	instances: [],
});
let lastTimestamp = 0;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isValidBroadcastPayload(value: unknown): value is BroadcastPayload {
	if (!isObject(value)) return false;
	if (value.type !== 'state') return false;
	if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
	if (!Array.isArray(value.instances)) return false;
	if ('mapDimensions' in value && value.mapDimensions !== undefined) {
		const mapDimensions = value.mapDimensions;
		if (!isObject(mapDimensions)) return false;
		if (typeof mapDimensions.width !== 'number' || typeof mapDimensions.height !== 'number') {
			return false;
		}
	}
	return true;
}

function isOriginAllowed(originHeader: string | undefined): boolean {
	if (config.allowedOrigins.length === 0) return true;
	if (!originHeader) return false;
	if (config.allowedOrigins.includes(originHeader)) return true;
	if (!config.allowSameHostDifferentPort) return false;

	let originUrl: URL;
	try {
		originUrl = new URL(originHeader);
	} catch {
		return false;
	}

	// Optional dev mode: allow same scheme+host entries even when port differs.
	for (const allowedOrigin of config.allowedOrigins) {
		try {
			const allowedUrl = new URL(allowedOrigin);
			if (allowedUrl.protocol === originUrl.protocol && allowedUrl.hostname === originUrl.hostname) {
				return true;
			}
		} catch {
			// Ignore malformed allow-list entries
		}
	}

	return false;
}

function extractHostname(value: string): string | null {
	try {
		// Parse host-like values (e.g. "live.osmw.net:443") safely.
		const parsed = new URL(`http://${value}`);
		return parsed.hostname.toLowerCase();
	} catch {
		return null;
	}
}

function isHostAllowed(hostHeader: string | undefined): boolean {
	if (config.allowedOrigins.length === 0) return true;
	if (!hostHeader) return false;

	const requestHost = extractHostname(hostHeader);
	if (!requestHost) return false;

	for (const allowedOrigin of config.allowedOrigins) {
		try {
			const allowedHost = new URL(allowedOrigin).hostname.toLowerCase();
			if (allowedHost === requestHost) {
				return true;
			}
		} catch {
			// Ignore malformed allow-list entries
		}
	}

	return false;
}

function isSessionRequestAllowed(req: IncomingMessage, originHeader: string | undefined): boolean {
	if (isOriginAllowed(originHeader)) return true;
	// Browsers may omit `Origin` for same-origin GET requests.
	if (!originHeader) {
		const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : undefined;
		return isHostAllowed(hostHeader);
	}
	return false;
}

function setCorsHeaders(res: ServerResponse, originHeader: string | undefined): void {
	if (!originHeader || !isOriginAllowed(originHeader)) return;
	res.setHeader('Access-Control-Allow-Origin', originHeader);
	res.setHeader('Vary', 'Origin');
	res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
	res.statusCode = statusCode;
	res.setHeader('Content-Type', 'application/json');
	res.setHeader('Cache-Control', 'no-store');
	res.end(JSON.stringify(payload));
}

function cleanExpiredSessionTokens(): void {
	const now = Date.now();
	for (const [token, value] of sessionTokens) {
		if (value.expiresAt <= now) {
			sessionTokens.delete(token);
		}
	}
}

// ============================================================================
// File Watcher
// ============================================================================

function pollStateFile(): void {
	try {
		if (!fs.existsSync(stateFilePath)) return;

		const content = fs.readFileSync(stateFilePath, 'utf-8');
		const parsed: unknown = JSON.parse(content);
		if (!isValidBroadcastPayload(parsed)) {
			console.warn('Ignoring invalid broadcast payload shape from state file');
			return;
		}

		// Only broadcast if state has changed
		if (parsed.timestamp !== lastTimestamp) {
			lastTimestamp = parsed.timestamp;
			lastState = content;
			broadcastToClients(content);
		}
	} catch {
		// File may be mid-write, skip this poll
	}
}

// ============================================================================
// Client IP Detection
// ============================================================================

function getClientIp(req: IncomingMessage): string {
	if (config.trustProxy) {
		const cfConnectingIp = req.headers['cf-connecting-ip'];
		if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim() !== '') {
			return cfConnectingIp.trim();
		}

		const xRealIp = req.headers['x-real-ip'];
		if (typeof xRealIp === 'string' && xRealIp.trim() !== '') {
			return xRealIp.trim();
		}

		const forwarded = req.headers['x-forwarded-for'];
		if (typeof forwarded === 'string') {
			return forwarded.split(',')[0].trim();
		}
	}
	return req.socket.remoteAddress ?? 'unknown';
}

// ============================================================================
// HTTP + WebSocket Server
// ============================================================================

const httpServer = createServer((req, res) => {
	const method = req.method ?? 'GET';
	const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
	setCorsHeaders(res, originHeader);

	if (method === 'OPTIONS') {
		res.statusCode = 204;
		res.end();
		return;
	}

	const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	if (method === 'GET' && requestUrl.pathname === '/session-token') {
		if (!isSessionRequestAllowed(req, originHeader)) {
			const response: ErrorPayload = { error: 'Origin not allowed' };
			sendJson(res, 403, response);
			return;
		}

		const ip = getClientIp(req);
		const token = randomBytes(24).toString('hex');
		const expiresAt = Date.now() + sessionTokenTtlMs;
		sessionTokens.set(token, {
			ip,
			origin: originHeader ?? '',
			expiresAt,
		});
		cleanExpiredSessionTokens();

		const response: SessionTokenPayload = { token, expiresAt };
		sendJson(res, 200, response);
		return;
	}

	const response: ErrorPayload = { error: 'Not Found' };
	sendJson(res, 404, response);
});

const wss = new WebSocketServer({ noServer: true });

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
	socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
	socket.destroy();
}

httpServer.on('upgrade', (req, socket, head) => {
	const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
	const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : 'unknown';
	const requestPath = req.url ?? '/';
	const ip = getClientIp(req);
	if (!isOriginAllowed(originHeader)) {
		console.warn(
			`Rejected websocket origin: origin=${originHeader ?? 'none'} host=${hostHeader} path=${requestPath} ip=${ip}`
		);
		rejectUpgrade(socket, 403, 'Origin not allowed');
		return;
	}

	if (clients.size >= config.maxTotalConnections) {
		console.warn(
			`Rejected websocket (capacity): host=${hostHeader} path=${requestPath} ip=${ip} total=${clients.size}/${config.maxTotalConnections}`
		);
		rejectUpgrade(socket, 503, 'Server at capacity');
		return;
	}

	const currentCount = ipConnectionCounts.get(ip) ?? 0;
	if (currentCount >= config.maxConnectionsPerIp) {
		console.warn(
			`Rejected websocket (ip limit): host=${hostHeader} path=${requestPath} ip=${ip} count=${currentCount}/${config.maxConnectionsPerIp}`
		);
		rejectUpgrade(socket, 429, 'Too many connections');
		return;
	}

	let requestUrl: URL;
	try {
		requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	} catch {
		console.warn(`Rejected websocket (bad request URL): host=${hostHeader} path=${requestPath} ip=${ip}`);
		rejectUpgrade(socket, 400, 'Bad request');
		return;
	}

	const sessionToken = requestUrl.searchParams.get('sessionToken');
	if (!sessionToken) {
		console.warn(`Rejected websocket (missing token): host=${hostHeader} path=${requestPath} ip=${ip}`);
		rejectUpgrade(socket, 401, 'Missing session token');
		return;
	}

	const session = sessionTokens.get(sessionToken);
	if (!session) {
		console.warn(`Rejected websocket (invalid token): host=${hostHeader} path=${requestPath} ip=${ip}`);
		rejectUpgrade(socket, 401, 'Invalid session token');
		return;
	}
	if (session.expiresAt <= Date.now()) {
		sessionTokens.delete(sessionToken);
		console.warn(`Rejected websocket (expired token): host=${hostHeader} path=${requestPath} ip=${ip}`);
		rejectUpgrade(socket, 401, 'Session token expired');
		return;
	}
	if (session.ip !== ip) {
		sessionTokens.delete(sessionToken);
		console.warn(
			`Rejected websocket (ip mismatch): host=${hostHeader} path=${requestPath} tokenIp=${session.ip} requestIp=${ip}`
		);
		rejectUpgrade(socket, 401, 'Session token mismatch');
		return;
	}
	if (session.origin && originHeader && session.origin !== originHeader) {
		sessionTokens.delete(sessionToken);
		console.warn(
			`Rejected websocket (origin mismatch): host=${hostHeader} path=${requestPath} tokenOrigin=${session.origin} requestOrigin=${originHeader}`
		);
		rejectUpgrade(socket, 401, 'Session token origin mismatch');
		return;
	}

	// Keep token valid until TTL expiry.
	// Some proxies/browsers may perform retry behavior around websocket handshakes,
	// and strict one-time consumption can invalidate legitimate follow-up attempts.

	wss.handleUpgrade(req, socket, head, ws => {
		wss.emit('connection', ws, req);
	});
});

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
	const ip = getClientIp(req);
	const now = Date.now();

	// Track connection
	clients.set(ws, { ws, ip, connectedAt: now, lastPongAt: now });
	ipConnectionCounts.set(ip, (ipConnectionCounts.get(ip) ?? 0) + 1);

	console.log(`Client connected: ${ip} (total: ${clients.size})`);

	// Send welcome
	const welcome: WelcomePayload = {
		type: 'welcome',
		message: 'Connected to Guild War Broadcast',
		mapDimensions: { width: 4800, height: 3000 },
		updateIntervalMs: config.pollIntervalMs,
	};
	ws.send(JSON.stringify(welcome));

	// Send current state immediately
	ws.send(lastState);

	// Track pong responses for idle detection
	ws.on('pong', () => {
		const client = clients.get(ws);
		if (client) client.lastPongAt = Date.now();
	});

	// Handle disconnect
	ws.on('close', () => {
		clients.delete(ws);
		const newCount = (ipConnectionCounts.get(ip) ?? 1) - 1;
		if (newCount <= 0) {
			ipConnectionCounts.delete(ip);
		} else {
			ipConnectionCounts.set(ip, newCount);
		}
		console.log(`Client disconnected: ${ip} (total: ${clients.size})`);
	});

	// Ignore client messages (read-only broadcast)
	ws.on('message', () => {});

	ws.on('error', error => {
		console.error(`Client error (${ip}):`, error.message);
	});
});

wss.on('error', error => {
	console.error('WebSocket server error:', error);
});

// ============================================================================
// Broadcast & Ping
// ============================================================================

function broadcastToClients(json: string): void {
	for (const [ws, client] of clients) {
		if (ws.readyState === ws.OPEN) {
			try {
				ws.send(json);
			} catch (error) {
				console.error(`Failed to send to ${client.ip}:`, error);
			}
		}
	}
}

function pingClients(): void {
	const now = Date.now();
	for (const [ws, client] of clients) {
		if (now - client.lastPongAt > config.idleTimeoutMs) {
			console.log(`Disconnecting idle client: ${client.ip}`);
			ws.terminate();
			continue;
		}
		if (ws.readyState === ws.OPEN) {
			try {
				ws.ping();
			} catch {
				// Will be cleaned up on close
			}
		}
	}
}

// ============================================================================
// Start
// ============================================================================

// Poll state file for changes
setInterval(pollStateFile, config.pollIntervalMs);

// Ping clients for idle detection every 30 seconds
setInterval(pingClients, 30000);
setInterval(cleanExpiredSessionTokens, Math.min(60_000, sessionTokenTtlMs));

httpServer.listen(config.port, listenHost);

console.log(`Guild War Broadcast Server started on port ${config.port}`);
console.log(`Listening host: ${listenHost}`);
console.log(`Reading state from: ${stateFilePath}`);
console.log(`Poll interval: ${config.pollIntervalMs}ms`);
console.log(`Session token TTL: ${sessionTokenTtlMs}ms`);
