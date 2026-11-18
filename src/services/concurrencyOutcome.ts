import { hasAmbiguousHistory, headerValue } from './mutationProtocol';

/**
 * How the client understands the answers of the server's concurrency contract
 * (backend B1-REV1). Nothing here ever decodes, builds or orders an `etag`:
 * a token is an opaque string that is only compared for identity.
 */

/** A write was refused locally because the card's version is not known. */
export class MissingVersionError extends Error {
    constructor(message = 'No concurrency version is known for this card') {
        super(message);
        this.name = 'MissingVersionError';
    }
}

/**
 * The write family a failure belongs to:
 *  - precondition-failed  412  the card changed (or is another life): conflict
 *  - malformed-precondition 400 IF_MATCH_MALFORMED: invalid token or key
 *                              rotation; stop and read again
 *  - precondition-required 428  client defect: a precondition was missing
 *  - unavailable          503  server cannot judge concurrency right now
 *  - not-found            404  card absent or inaccessible
 *  - legacy-conflict      409 POST_IT_CONFLICT: the historical contract
 *                              answered; never expected, treated as conflict
 *  - network              no HTTP answer: the outcome may be either
 *  - other                anything else (including other 409 meanings)
 */
export type WriteFailure =
    | 'precondition-failed'
    | 'malformed-precondition'
    | 'precondition-required'
    | 'unavailable'
    | 'not-found'
    | 'legacy-conflict'
    | 'network'
    | 'other';

interface HttpLikeError {
    response?: {
        status?: number;
        data?: { code?: string };
        headers?: unknown;
    };
}

/**
 * A log-safe description of a failure: never the Axios error itself, whose
 * `config` carries the request body and the Authorization header.
 */
export function describeError(error: unknown): {
    name: string;
    message: string;
    status?: number;
    code?: string;
} {
    const e = error as
        (HttpLikeError & { name?: string; message?: string }) | undefined;
    return {
        name: typeof e?.name === 'string' ? e.name : 'Error',
        message: typeof e?.message === 'string' ? e.message : 'unknown error',
        status: e?.response?.status,
        code:
            typeof e?.response?.data?.code === 'string'
                ? e.response.data.code
                : undefined,
    };
}

export function classifyWriteError(error: unknown): WriteFailure {
    if (error instanceof MissingVersionError) return 'precondition-required';
    const response = (error as HttpLikeError | undefined)?.response;
    if (!response) {
        // An axios error without a response is a network failure.
        return (error as { isAxiosError?: boolean } | undefined)?.isAxiosError
            ? 'network'
            : 'other';
    }
    const code = response.data?.code;
    switch (response.status) {
        case 412:
            return 'precondition-failed';
        case 400:
            return code === 'IF_MATCH_MALFORMED'
                ? 'malformed-precondition'
                : 'other';
        case 428:
            return 'precondition-required';
        case 503:
            return 'unavailable';
        case 404:
            return 'not-found';
        case 409:
            return code === 'POST_IT_CONFLICT' ? 'legacy-conflict' : 'other';
        default:
            return 'other';
    }
}

/**
 * Failures that are final for the intention that met them: kept (never lost),
 * never replayed on their own, never answered by an unconditional rewrite.
 */
export function isFinalRefusal(error: unknown): boolean {
    // A refusal that follows an ambiguous attempt of the same operation is not
    // final for it: the earlier attempt may have been applied.
    if (hasAmbiguousHistory(error)) return false;
    switch (classifyWriteError(error)) {
        case 'precondition-failed':
        case 'malformed-precondition':
        case 'precondition-required':
        case 'not-found':
        case 'legacy-conflict':
            return true;
        default:
            return false;
    }
}

// ---- 200 answers -----------------------------------------------------------

/** Exact value of the `X-Concurrency-Superseded` header the server sets. */
export const SUPERSEDED_HEADER = 'x-concurrency-superseded';
export const SUPERSEDED_STACK_REMOVED = 'stack-removed';

const superseded = new WeakSet<object>();

/**
 * Mark a successful answer as "applied, but already outdated": the body is the
 * client's own write, its `etag` may already be stale, and the card must be
 * read again before anything depends on it.
 */
export function markSuperseded<T>(result: T): T {
    if (result && typeof result === 'object') superseded.add(result);
    return result;
}

export function isSupersededResult(result: unknown): boolean {
    return (
        !!result &&
        typeof result === 'object' &&
        superseded.has(result as object)
    );
}

/** Mark `result` when the response headers carry the superseded contract. */
export function markIfSuperseded<T>(
    result: T,
    headers: Record<string, unknown> | undefined
): T {
    const value = headers?.[SUPERSEDED_HEADER];
    return value === SUPERSEDED_STACK_REMOVED ? markSuperseded(result) : result;
}

// ---- B3: lifecycle outcomes -------------------------------------------------

/**
 * The operation belongs to a life of the card (or to an account/session
 * context) that no longer exists: the card was deleted, restored under a new
 * life, or the owner changed. It is NOT a business success and NOT a business
 * failure: nothing may be adopted, rolled back, notified or recorded in the
 * history on behalf of the current life of the card.
 */
export class StaleLifecycleError extends Error {
    constructor(message = 'The operation belongs to a previous lifecycle') {
        super(message);
        this.name = 'StaleLifecycleError';
    }
}

export function isStaleLifecycle(error: unknown): boolean {
    return error instanceof StaleLifecycleError;
}

/**
 * A deletion that cannot be sent on a demonstrated base: a write of the card
 * whose outcome is still unknown (hung, or answer lost) could have moved its
 * token. The card and its intentions are kept; nothing is sent.
 */
export class DeletionDeferredError extends Error {
    constructor(
        message = 'A write of the card has an uncertain outcome: deletion deferred'
    ) {
        super(message);
        this.name = 'DeletionDeferredError';
    }
}

const outdated = new WeakSet<object>();

/**
 * Mark an answer as older than a read of the card that was adopted while the
 * request was in flight: its token and fields must not overwrite that read.
 */
export function markOutdated<T>(result: T): T {
    if (result && typeof result === 'object') outdated.add(result);
    return result;
}

export function isOutdatedResult(result: unknown): boolean {
    return (
        !!result && typeof result === 'object' && outdated.has(result as object)
    );
}

/**
 * Could the server have applied the write although the client got no usable
 * answer? True for a lost answer / timeout (no HTTP response) and for every
 * 5xx that does not state the write was not applied: a gateway or proxy 502 /
 * 503 / 504 sits BETWEEN the client and the API, so the request may well have
 * been applied behind it. Only an answer of the API itself proves the
 * opposite: 503 `CONCURRENCY_UNAVAILABLE` (the server refused to judge), and
 * every 4xx (412, 400, 428, 404, 409, 429...) as well as local refusals.
 */
export function isUncertainOutcome(error: unknown): boolean {
    if (error instanceof MissingVersionError || isStaleLifecycle(error)) {
        return false;
    }
    const response = (error as HttpLikeError | undefined)?.response;
    if (!response) return true;
    // An answer to a LATER attempt never closes the uncertainty of an earlier
    // ambiguous one: only a receipt (a replay answer) does, and a replay is not
    // an error. A refusal that follows an ambiguous attempt stays uncertain.
    if (hasAmbiguousHistory(error)) return true;
    const status = response.status ?? 0;
    if (status === 503) {
        // D1A-F1: a coded 503 can follow an applied write (the answer was being
        // built). Only the server's explicit proof that nothing was applied
        // makes it a certain refusal.
        return !(
            response.data?.code === 'CONCURRENCY_UNAVAILABLE' &&
            headerValue(response.headers, 'x-mutation-applied') === 'false'
        );
    }
    return status >= 500;
}

// ---- C: one result per card for the operations that touch several cards -----

/**
 * What became of ONE card's write inside an operation that writes several
 * cards (a pile moved, a dissolve, an undo...). The server applies each write
 * on its own: there is no atomicity, so an operation is described by its
 * individual results, never by a single success / failure.
 *
 *  - acked       the server applied the write and its answer is current
 *  - superseded  applied, but the card was already overtaken (read again)
 *  - refused     the server certainly did NOT apply it (412, 400, 428, 404,
 *                503 with `X-Mutation-Applied: false`, local refusal...)
 *  - uncertain   no usable answer: it may or may not have been applied
 *                (reconciliation is LOT D1; nothing destructive is derived)
 *  - stale       it belongs to a life / context that no longer exists
 */
export type CardOutcomeKind =
    'acked' | 'superseded' | 'refused' | 'uncertain' | 'stale';

export interface CardOutcome {
    id: string;
    kind: CardOutcomeKind;
    error?: unknown;
}

export const isAppliedOutcome = (outcome: CardOutcome): boolean =>
    outcome.kind === 'acked' || outcome.kind === 'superseded';

/** Classify the failure of one card's write. */
export function outcomeOfError(id: string, error: unknown): CardOutcome {
    if (isStaleLifecycle(error)) return { id, kind: 'stale', error };
    return {
        id,
        kind: isUncertainOutcome(error) ? 'uncertain' : 'refused',
        error,
    };
}
