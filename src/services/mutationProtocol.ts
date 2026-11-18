/**
 * LOT-D1B client side of the mutation protocol (backend `X-Mutation-Id`,
 * receipts, tombstones). Nothing here decodes, builds or orders an `etag`: a
 * token is an opaque string compared for identity only.
 *
 * What this module guarantees:
 *  - one logical request keeps ONE mutation id for as long as its identity
 *    (method, resource, base token, applied payload) does not change; a request
 *    with other values never reuses an id (the id is derived from a frozen
 *    identity, not from a counter);
 *  - an id is renewed only when the intention is legitimately new (the
 *    previous attempt was finally refused or acknowledged);
 *  - automatic replay of an ambiguous attempt exists only once the D1 protocol
 *    has been PROVEN by the server (never because a header was sent).
 */

export type Capability = 'unknown' | 'd1' | 'absent';

let capability: Capability = 'unknown';

export const getCapability = (): Capability => capability;

/** Learn the protocol from the headers of ANY answer of the API. */
export function noteProtocolHeaders(
    headers: Record<string, unknown> | undefined
): void {
    if (!headers) return;
    if (headerValue(headers, 'x-mutation-protocol') === '1') capability = 'd1';
}

/** Case-insensitive header read that tolerates plain objects and AxiosHeaders. */
export function headerValue(
    headers: unknown,
    name: string
): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined;
    const maybe = headers as {
        get?: (key: string) => unknown;
        [key: string]: unknown;
    };
    const raw =
        typeof maybe.get === 'function'
            ? maybe.get(name)
            : (maybe[name] ?? maybe[name.toLowerCase()]);
    return typeof raw === 'string' ? raw : undefined;
}

/** The server answered the capability probe (or a mutation answer proved it). */
export function setCapability(next: Capability): void {
    capability = next;
}

// ---- mutation identities -----------------------------------------------------

export function newMutationId(): string | undefined {
    const crypto = (globalThis as { crypto?: Crypto }).crypto;
    if (!crypto?.getRandomValues) return undefined;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = '';
    bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/** Canonical JSON: sorted keys, undefined == absent, null distinct, exact text. */
export function canonical(value: unknown): string {
    if (value === undefined) return 'u';
    if (value === null) return 'n';
    // Byte-exact: the server stores what it receives and fingerprints it the
    // same way, so canonically equivalent but different texts are different
    // requests (no Unicode normalisation on either side).
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
            .join(',')}}`;
    }
    return JSON.stringify(String(value));
}

/**
 * The context a request was issued under: the account and the session
 * generation (a logout / new login starts another one; a token refresh inside
 * the same session does not). No credential is part of it.
 */
export interface OperationContext {
    readonly userId: string | null;
    readonly generation: number;
}

export const sameContext = (
    a: OperationContext,
    b: OperationContext
): boolean => a.userId === b.userId && a.generation === b.generation;

export interface OperationIdentity {
    /** the frozen request identity */
    readonly key: string;
    readonly id: string;
    readonly method: string;
    readonly resource: string;
    /** the opaque base token the request carries (if any) */
    readonly base: string | undefined;
    readonly context: OperationContext;
    /**
     * The JSON body of the request, frozen when the identity was minted: every
     * attempt sends exactly this value, whatever the caller does to its own
     * object afterwards.
     */
    readonly body: unknown;
    /**
     * At least one attempt ended without a usable answer: the server may have
     * applied it. Only an answer carrying the receipt (or an acknowledgement of
     * this very request) lifts it; a later refusal without a receipt never does.
     */
    ambiguous: boolean;
    closed: boolean;
    /**
     * The regime the operation was sent under: its guarantees belong to IT, not
     * to the capability the page holds at the moment. `d1` once the request left
     * while the protocol was proven (receipts exist for it); it never reverts.
     */
    regime: 'd1' | 'historical';
}

const operations = new Map<string, OperationIdentity>();

const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const inner of Object.values(value as object)) deepFreeze(inner);
    }
    return value;
};

const frozenCopy = (value: unknown): unknown =>
    value === undefined
        ? undefined
        : deepFreeze(JSON.parse(JSON.stringify(value)));

/**
 * The identity of a logical request. The first call for a given identity mints
 * the id (the request really leaves now); every later call with the very same
 * identity (same account/session, method, resource, base and EXACT payload)
 * returns the same object, and any other value yields another identity.
 * Holds no auth token. An unresolved identity is never evicted.
 */
/** The key of a logical request (no id, no registry access). */
export const requestKeyOf = (
    method: string,
    resource: string,
    base: string | undefined,
    payload: unknown,
    context: OperationContext
): string =>
    `${context.userId ?? ''}|${context.generation}|${method}|${resource}|${base ?? ''}|${canonical(payload)}`;

export function identityOf(
    method: string,
    resource: string,
    base: string | undefined,
    payload: unknown,
    context: OperationContext = { userId: null, generation: 0 },
    body: unknown = payload
): OperationIdentity | undefined {
    const key = requestKeyOf(method, resource, base, payload, context);
    const known = operations.get(key);
    if (known) return known;
    const id = newMutationId();
    if (!id) return undefined;
    const created: OperationIdentity = {
        key,
        id,
        method,
        resource,
        base,
        context,
        body: frozenCopy(body),
        ambiguous: false,
        closed: false,
        regime: capability === 'd1' ? 'd1' : 'historical',
    };
    operations.set(key, created);
    return created;
}

/**
 * Re-creates, from the durable journal, the identity of an operation that left
 * before the page was closed: SAME id, resource, base and exact body, bound to
 * the context it is recovered under (the owner was confirmed by the caller). A
 * live identity of the very same request wins: there is one reference only.
 */
export function restoreIdentity(
    spec: {
        id: string;
        method: string;
        resource: string;
        base: string | undefined;
        body: unknown;
        regime: 'd1' | 'historical';
        ambiguous: boolean;
    },
    context: OperationContext
): OperationIdentity | null {
    const key = requestKeyOf(
        spec.method,
        spec.resource,
        spec.base,
        spec.body,
        context
    );
    const known = operations.get(key);
    // One reference only: a live identity of the very same request wins, but
    // only when it IS the operation to replay. A different id for the same
    // request is never substituted silently (null: the caller keeps the record
    // and hands it to the user).
    if (known) return known.id === spec.id ? known : null;
    const created: OperationIdentity = {
        key,
        id: spec.id,
        method: spec.method,
        resource: spec.resource,
        base: spec.base,
        context,
        body: frozenCopy(spec.body),
        ambiguous: spec.ambiguous,
        closed: false,
        regime: spec.regime,
    };
    operations.set(key, created);
    return created;
}

/** The regime of an operation about to leave: once D1 was proven, it stays D1. */
export function stampRegime(identity: OperationIdentity | undefined): void {
    if (identity && capability === 'd1') identity.regime = 'd1';
}

/** The live identity of a request, if one exists (never mints). */
export function findIdentity(
    method: string,
    resource: string,
    base: string | undefined,
    payload: unknown,
    context: OperationContext
): OperationIdentity | undefined {
    return operations.get(
        requestKeyOf(method, resource, base, payload, context)
    );
}

/**
 * The attempt is closed (acknowledged or finally refused): its id is spent.
 * Only THIS identity is removed: a late or repeated close of an old identity
 * never touches a newer identity of the same request.
 */
export function closeIdentity(identity: OperationIdentity | undefined): void {
    if (!identity) return;
    identity.closed = true;
    identity.ambiguous = false;
    if (operations.get(identity.key) === identity) {
        operations.delete(identity.key);
    }
}

export function markAmbiguous(identity: OperationIdentity | undefined): void {
    if (identity && !identity.closed) identity.ambiguous = true;
}

/** Operations of one resource whose outcome is still unknown. */
export function unresolvedOperations(resource: string): OperationIdentity[] {
    return [...operations.values()].filter(
        (operation) => operation.resource === resource && operation.ambiguous
    );
}

/** Every operation whose outcome is still unknown, whatever the resource. */
export function allUnresolvedOperations(): OperationIdentity[] {
    return [...operations.values()].filter((operation) => operation.ambiguous);
}

// Cards whose deletion left under the D1 protocol: a historical (unproven)
// restore is never sent for them, whatever the page currently holds.
const deletedUnderD1 = new Set<string>();
export const noteDeletedUnderD1 = (resource: string): void => {
    deletedUnderD1.add(resource);
};
export const wasDeletedUnderD1 = (resource: string): boolean =>
    deletedUnderD1.has(resource);

/**
 * Operations sent under the HISTORICAL regime only (no receipts exist for
 * them): a read adopted by the board replaces the unproven token, so these
 * attempts no longer matter. An operation sent under D1 is never closed this
 * way, whatever the page holds now: only its own receipt closes it.
 */
export function forgetUnresolved(resource: string): void {
    for (const operation of unresolvedOperations(resource)) {
        if (operation.regime === 'historical') closeIdentity(operation);
    }
}

export interface SerializedOperation {
    id: string;
    method: string;
    resource: string;
    base: string | null;
    context: OperationContext;
    ambiguous: boolean;
    regime: 'd1' | 'historical';
    body: unknown;
}

/**
 * Serialisable state of the operations still alive (for D2, which persists the
 * recoverable intentions). Contains the request body (the user's own content)
 * and the context, never a token.
 */
export function snapshotOperations(): SerializedOperation[] {
    return [...operations.values()].map((operation) => ({
        id: operation.id,
        method: operation.method,
        resource: operation.resource,
        base: operation.base ?? null,
        context: operation.context,
        ambiguous: operation.ambiguous,
        regime: operation.regime,
        body: operation.body ?? null,
    }));
}

/** Account change / logout / tests: no identity survives the context. */
export function resetMutationProtocol(): void {
    for (const operation of operations.values()) operation.closed = true;
    operations.clear();
    deletedUnderD1.clear();
    capability = 'unknown';
}

// Which logical request produced an outcome (an error or a returned card), so
// that the coordinator can close ONLY the operation concerned.
const producedBy = new WeakMap<object, string>();
export function tagOperation<T>(outcome: T, identity?: OperationIdentity): T {
    if (identity && outcome && typeof outcome === 'object') {
        producedBy.set(outcome as object, identity.key);
    }
    return outcome;
}

// A result that carries the PROOF of its operation: the identity was closed by
// the protocol layer for it (a proven answer for exactly this request). The
// journal closes a durable intention on this and on nothing else.
const acknowledgedBy = new WeakMap<object, string>();
export function tagAcknowledged<T>(
    outcome: T,
    identity?: OperationIdentity
): T {
    tagOperation(outcome, identity);
    if (identity && identity.closed && outcome && typeof outcome === 'object') {
        acknowledgedBy.set(outcome as object, identity.id);
    }
    return outcome;
}
/** The mutation id whose acknowledgement this result is (undefined: none). */
export const acknowledgedIdOf = (outcome: unknown): string | undefined =>
    outcome && typeof outcome === 'object'
        ? acknowledgedBy.get(outcome as object)
        : undefined;
export const operationKeyOf = (outcome: unknown): string | undefined =>
    outcome && typeof outcome === 'object'
        ? producedBy.get(outcome as object)
        : undefined;

// ---- bounded replay -----------------------------------------------------------

export interface ReplayPolicy {
    /** waits before each automatic replay of the SAME request */
    delaysMs: number[];
    /** upper bound for a server-asked wait (Retry-After) */
    maxRetryAfterMs: number;
}

let policy: ReplayPolicy = { delaysMs: [400, 1500], maxRetryAfterMs: 3000 };

export const getReplayPolicy = (): ReplayPolicy => policy;
export const setReplayPolicy = (next: Partial<ReplayPolicy>): void => {
    policy = { ...policy, ...next };
};

const ambiguousBefore = new WeakSet<object>();

/** The error ends a request after at least one ambiguous attempt. */
export function markAmbiguousHistory<T>(error: T): T {
    if (error && typeof error === 'object') ambiguousBefore.add(error);
    return error;
}

export function hasAmbiguousHistory(error: unknown): boolean {
    return !!error && typeof error === 'object' && ambiguousBefore.has(error);
}

export const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
