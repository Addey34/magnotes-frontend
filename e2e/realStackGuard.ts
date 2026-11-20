// Isolation guard for the real-stack focus regression. Pure functions so the
// refusals can be proven by unit tests (tests/realStackGuard.test.ts).
//
// A loopback frontend does not prove that the API behind it is the isolated
// one (vite proxies /api to VITE_API_URL). The chain is therefore verified end
// to end: Vite is started by the config with VITE_API_URL = E2E_API_URL, the
// process listening on that API port must hold an established connection to
// the published port of the isolated MongoDB container, and to no other
// MongoDB instance.

export type Connection = {
    localAddress: string;
    localPort: number;
    remoteAddress: string;
    remotePort: number;
    state: string;
    pid: number;
};

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const MONGO_DEFAULT_PORTS = [27017, 27018, 27019];

export const isLoopbackHost = (host: string): boolean =>
    LOOPBACK.includes(host);

export function parseApiUrl(raw: string): { host: string; port: number } {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('E2E_API_URL is not a valid URL.');
    }
    if (!isLoopbackHost(url.hostname))
        throw new Error('E2E_API_URL must target a loopback host.');
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (!Number.isInteger(port) || port <= 0)
        throw new Error('E2E_API_URL must carry an explicit port.');
    return { host: url.hostname, port };
}

/** Parse `netstat -ano` output (Windows) into TCP connections. */
export function parseNetstat(output: string): Connection[] {
    const split = (endpoint: string) => {
        const at = endpoint.lastIndexOf(':');
        return {
            address: endpoint.slice(0, at),
            port: Number(endpoint.slice(at + 1)),
        };
    };
    const connections: Connection[] = [];
    for (const line of output.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        if (cols[0] !== 'TCP' || cols.length < 5) continue;
        const local = split(cols[1]);
        const remote = split(cols[2]);
        connections.push({
            localAddress: local.address,
            localPort: local.port,
            remoteAddress: remote.address,
            remotePort: remote.port,
            state: cols[3],
            pid: Number(cols[4]),
        });
    }
    return connections;
}

/** Throws unless the process behind the API port is wired to the isolated MongoDB only. */
export function assertBackendBoundToIsolatedMongo(
    connections: Connection[],
    apiPort: number,
    isolatedMongoHostPort: number
): number {
    const listeners = new Set(
        connections
            .filter((c) => c.state === 'LISTENING' && c.localPort === apiPort)
            .map((c) => c.pid)
    );
    if (listeners.size !== 1)
        throw new Error(
            `Expected exactly one process listening on API port ${apiPort}, found ${listeners.size}.`
        );
    const [pid] = [...listeners];
    const established = connections.filter(
        (c) => c.pid === pid && c.state === 'ESTABLISHED'
    );
    const toIsolated = established.filter(
        (c) =>
            isLoopbackHost(c.remoteAddress) &&
            c.remotePort === isolatedMongoHostPort
    );
    if (!toIsolated.length)
        throw new Error(
            'The backend on the API port has no connection to the isolated MongoDB.'
        );
    const foreign = established.filter(
        (c) =>
            c.remotePort !== isolatedMongoHostPort &&
            (MONGO_DEFAULT_PORTS.includes(c.remotePort) ||
                !isLoopbackHost(c.remoteAddress))
    );
    if (foreign.length)
        throw new Error(
            'The backend on the API port also talks to another MongoDB instance or to a remote host.'
        );
    return pid;
}
