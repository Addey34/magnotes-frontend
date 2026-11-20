import axios, { AxiosResponse } from 'axios';
import {
    BoardTab,
    CardLink,
    CardLinkUpdate,
    PostIt,
    PostItSaveUpdate,
    PostItStack,
    PostItStackUpdate,
    PostItUpdate,
    PublicBoard,
} from '../types/boardTypes';
import { getToken } from '../utils/tokenUtils';
import { contextNow } from './operationContext';
import * as demoBoard from './demoBoard';
import { isDemoActive } from './demoMode';
import { baseUrl } from './apiBase';
import {
    MissingVersionError,
    StaleLifecycleError,
    describeError,
    isUncertainOutcome,
    markIfSuperseded,
    markSuperseded,
} from './concurrencyOutcome';
import {
    Capability,
    OperationIdentity,
    closeIdentity,
    getCapability,
    setCapability,
    getReplayPolicy,
    headerValue,
    identityOf,
    markAmbiguous,
    markAmbiguousHistory,
    sameContext,
    tagOperation,
    tagAcknowledged,
    noteProtocolHeaders,
    noteDeletedUnderD1,
    stampRegime,
    wasDeletedUnderD1,
    wait,
} from './mutationProtocol';

const getAuthHeaders = () => {
    const token = getToken();
    if (!token) {
        throw new Error('No token found');
    }

    return { Authorization: `Bearer ${token}` };
};

const handleError = (error: unknown) => {
    // Never the Axios error itself: its config holds the body and the token.
    console.error('[api] request failed', describeError(error));
    throw error;
};

/** Proof that a DELETE left the client: the base it carried and its id. */
export interface DeleteProof {
    /** the If-Match token of the DELETE actually transmitted */
    etag: string;
    mutationId?: string;
}

/**
 * Send one logical request. The SAME request (same identity) is replayed on an
 * ambiguous outcome only when the server has proven the D1 protocol; a
 * finalisation still in progress is waited for under the same id. Whatever
 * follows an ambiguous attempt keeps the ambiguity (a refusal without a receipt
 * does not close it).
 */
/** Extra conditions every (re)transmission of a request must meet. */
export interface SendGuard {
    /** The card's current life / the caller's context still wants this write. */
    canSend?: () => boolean;
}

/** A 2xx answer that carries no usable card: not an acknowledgement. */
class UnusableAnswerError extends Error {
    constructor() {
        super('The answer cannot be used');
        this.name = 'UnusableAnswerError';
    }
}

const isObject = (data: unknown): data is Record<string, unknown> =>
    !!data && typeof data === 'object' && !Array.isArray(data);

/**
 * The answer of a write on ONE card is an acknowledgement only when it names
 * that very card and carries the version token the next write needs (in the
 * body or as ETag). A receipt of a write overtaken since carries neither, and
 * says so (`X-Mutation-Current: live-superseded`).
 */
const isCardAnswerFor =
    (resource: string) =>
    (data: unknown, headers?: unknown): boolean => {
        // a receipt of an operation whose card has since moved on: no card
        // is expected (the caller turns it into a typed outcome)
        if (
            headerValue(headers, 'x-mutation-replayed') === 'true' &&
            headerValue(headers, 'x-mutation-current') !== 'exact'
        ) {
            return isObject(data);
        }
        if (!isObject(data) || data._id !== resource) return false;
        const token =
            typeof data.etag === 'string' && data.etag !== ''
                ? data.etag
                : headerValue(headers, 'etag');
        return typeof token === 'string' && token !== '';
    };

async function sendLogical<T>(
    run: () => Promise<AxiosResponse<T>>,
    identity: OperationIdentity | undefined,
    waitForFinalisation = false,
    guard: SendGuard = {},
    usable?: (data: unknown, headers?: unknown) => boolean
): Promise<AxiosResponse<T>> {
    const { delaysMs, maxRetryAfterMs } = getReplayPolicy();
    // The context the request was issued under. Whatever is waited for (a
    // replay delay, a Retry-After), nothing leaves once it is gone: the intent
    // stays unresolved and recoverable, it is NOT presumed unapplied.
    const issuedUnder = identity?.context ?? contextNow();
    let replays = 0;
    let pendingWaits = 0;
    for (;;) {
        // The context AND the relevant life of the card guard every attempt,
        // the first one and each replay (also after a wait).
        if (
            !sameContext(issuedUnder, contextNow()) ||
            (guard.canSend && !guard.canSend())
        ) {
            throw new StaleLifecycleError();
        }
        stampRegime(identity);
        try {
            const response = await run();
            noteProtocolHeaders(response?.headers as Record<string, unknown>);
            const proven =
                headerValue(response?.headers, 'x-mutation-protocol') === '1';
            // An answer without the protocol header from a server that proved
            // it before: the regime changed, the proof no longer stands.
            if (getCapability() === 'd1' && !proven) {
                setCapability('unknown');
            }
            if (usable && !usable(response?.data, response?.headers)) {
                throw new UnusableAnswerError();
            }
            // A success of an operation sent under D1 whose outcome was
            // ambiguous, WITHOUT the protocol's proof, is not the receipt of
            // that request: no equivalent guarantee, it stays unresolved.
            if (!(
                identity &&
                identity.ambiguous &&
                identity.regime === 'd1' &&
                !proven
            )) {
                closeIdentity(identity);
            }
            return response;
        } catch (error) {
            const response = (
                error as {
                    response?: {
                        status?: number;
                        data?: { code?: string };
                        headers?: unknown;
                    };
                }
            )?.response;
            noteProtocolHeaders(
                response?.headers as Record<string, unknown> | undefined
            );
            if (
                waitForFinalisation &&
                response?.status === 409 &&
                response.data?.code === 'DELETE_FINALIZATION_PENDING' &&
                pendingWaits < 5
            ) {
                pendingWaits += 1;
                const asked = Number(
                    headerValue(response.headers, 'retry-after')
                );
                await wait(
                    Math.min(
                        Number.isFinite(asked) && asked > 0
                            ? asked * 1000
                            : 1000,
                        maxRetryAfterMs
                    )
                );
                continue;
            }
            const uncertain = isUncertainOutcome(error);
            if (uncertain) markAmbiguous(identity);
            if (
                uncertain &&
                identity &&
                getCapability() === 'd1' &&
                replays < delaysMs.length
            ) {
                await wait(delaysMs[replays]);
                replays += 1;
                continue;
            }
            // The state is the operation's, not the call's: an earlier
            // ambiguous attempt (this call or a previous one) survives every
            // later answer that carries no receipt.
            const unresolved = identity ? identity.ambiguous : uncertain;
            if (unresolved) markAmbiguousHistory(error);
            // A final answer of the API closes the identity; an unknown outcome
            // keeps it so that a later replay is still the same request.
            if (!unresolved) closeIdentity(identity);
            tagOperation(error, identity);
            throw error;
        }
    }
}

interface Replayed {
    replayed: boolean;
    current: string | undefined;
}

const replayOf = (headers: unknown): Replayed => ({
    replayed: headerValue(headers, 'x-mutation-replayed') === 'true',
    current: headerValue(headers, 'x-mutation-current'),
});

export const fetchTabs = async (): Promise<BoardTab[]> => {
    if (isDemoActive()) return demoBoard.fetchTabs();
    try {
        const response = await axios.get<BoardTab[]>(`${baseUrl}/api/tabs`, {
            headers: getAuthHeaders(),
        });
        return response.data;
    } catch (error) {
        handleError(error);
        return [];
    }
};

export const createTab = async (
    name: string,
    color: string,
    icon = '📝',
    backgroundColor?: string
): Promise<BoardTab> => {
    if (isDemoActive())
        return demoBoard.createTab(name, color, icon, backgroundColor);
    try {
        const response = await axios.post<BoardTab>(
            `${baseUrl}/api/tabs`,
            { name, color, icon, backgroundColor },
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return {} as BoardTab;
    }
};

export const updateTab = async (
    tabId: string,
    updates: Partial<
        Pick<
            BoardTab,
            'name' | 'color' | 'theme' | 'icon' | 'order' | 'viewport'
        > & { backgroundColor?: string | null }
    >
): Promise<void> => {
    if (isDemoActive()) return demoBoard.updateTab(tabId, updates);
    try {
        await axios.patch(`${baseUrl}/api/tabs/${tabId}`, updates, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

export const reorderTabs = async (tabIds: string[]): Promise<void> => {
    if (isDemoActive()) return demoBoard.reorderTabs(tabIds);
    try {
        await axios.put(
            `${baseUrl}/api/tabs/reorder`,
            { tabIds },
            { headers: getAuthHeaders() }
        );
    } catch (error) {
        handleError(error);
    }
};

// Enable/disable public read-only sharing; returns the share token (null once
// revoked). The token builds the public URL `${origin}/app/b/<token>`.
export const setBoardShare = async (
    tabId: string,
    enabled: boolean
): Promise<string | null> => {
    try {
        const url = `${baseUrl}/api/tabs/${tabId}/share`;
        const response = enabled
            ? await axios.post<{ shareToken: string | null }>(
                  url,
                  {},
                  {
                      headers: getAuthHeaders(),
                  }
              )
            : await axios.delete<{ shareToken: string | null }>(url, {
                  headers: getAuthHeaders(),
              });
        return response.data.shareToken;
    } catch (error) {
        handleError(error);
        return null;
    }
};

// Public, unauthenticated fetch of a shared board by token.
export const fetchPublicBoard = async (
    token: string
): Promise<PublicBoard | null> => {
    try {
        const response = await axios.get<PublicBoard>(
            `${baseUrl}/api/public/boards/${token}`
        );
        return response.data;
    } catch (error) {
        // A missing/revoked share is a real "not found". Network failures and
        // server errors are different states and must remain observable by the
        // caller instead of being misreported as an invalid link.
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            return null;
        }
        throw error;
    }
};

export const deleteTab = async (tabId: string): Promise<void> => {
    if (isDemoActive()) return demoBoard.deleteTab(tabId);
    try {
        await axios.delete(`${baseUrl}/api/tabs/${tabId}`, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

export const fetchPostIts = async (tabId: string): Promise<PostIt[]> => {
    if (isDemoActive()) return demoBoard.fetchPostIts(tabId);
    try {
        const response = await axios.get<PostIt[]>(`${baseUrl}/api/postits`, {
            params: { tabId },
            headers: getAuthHeaders(),
        });
        noteProtocolHeaders(response.headers as Record<string, unknown>);
        return response.data;
    } catch (error) {
        handleError(error);
        return [];
    }
};

/**
 * Re-proves the capability of the server (the replay guarantees depend on it).
 * A header SENT proves nothing: only the answer of the capability probe does.
 * An unreachable or unclear answer leaves the capability as it was.
 */
export const probeCapability = async (): Promise<Capability> => {
    if (isDemoActive()) return getCapability();
    const issuedUnder = contextNow();
    try {
        const response = await axios.get(
            `${baseUrl}/api/postits/capabilities`,
            {
                headers: getAuthHeaders(),
            }
        );
        // the answer belongs to the context it was asked under
        if (!sameContext(issuedUnder, contextNow())) return getCapability();
        if (
            response?.status === 200 &&
            (response.data as { mutationProtocol?: number } | undefined)
                ?.mutationProtocol === 1
        ) {
            setCapability('d1');
        }
    } catch (error) {
        const status = (error as { response?: { status?: number } })?.response
            ?.status;
        if (status === 404 && sameContext(issuedUnder, contextNow())) {
            setCapability('absent');
        }
    }
    return getCapability();
};

export type ServerCardView =
    | { state: 'found'; card: PostIt }
    | { state: 'absent' }
    | { state: 'unavailable' };

/**
 * A READ-ONLY, authenticated look at what the server holds for one card (the
 * list of its board is the only read the API offers). It never touches the
 * optimistic state of the screen and never writes: the result is for
 * comparison only. 'absent' is claimed only when the board answered and does
 * not list the card; any failure is 'unavailable', not 'absent'.
 */
export const readServerCard = async (
    tabId: string,
    cardId: string,
    hint?: string
): Promise<ServerCardView> => {
    if (isDemoActive()) return { state: 'unavailable' };
    const issuedUnder = contextNow();
    try {
        const response = await axios.get<PostIt[]>(`${baseUrl}/api/postits`, {
            params: { tabId },
            headers: getAuthHeaders(),
        });
        if (!sameContext(issuedUnder, contextNow())) {
            return { state: 'unavailable' };
        }
        noteProtocolHeaders(response.headers as Record<string, unknown>);
        if (!Array.isArray(response.data)) return { state: 'unavailable' };
        const card = response.data.find((item) => item._id === cardId);
        if (card) return { state: 'found', card };
        // Absent from THIS board's list is not a global disappearance: the
        // card may have moved to another board. When the caller can describe
        // the card, a search across the boards may find it elsewhere (best
        // effort: a miss proves nothing, a hit proves it exists).
        const text = (hint ?? '').trim().slice(0, 60);
        if (text) {
            const moved = await axios.get<PostIt[]>(
                `${baseUrl}/api/postits/search`,
                { params: { q: text }, headers: getAuthHeaders() }
            );
            if (!sameContext(issuedUnder, contextNow())) {
                return { state: 'unavailable' };
            }
            const there = Array.isArray(moved.data)
                ? moved.data.find((item) => item._id === cardId)
                : undefined;
            if (there) return { state: 'found', card: there };
        }
        return { state: 'absent' };
    } catch {
        return { state: 'unavailable' };
    }
};

// (client) Global search across every board of the current user.
export const searchPostIts = async (query: string): Promise<PostIt[]> => {
    if (isDemoActive()) return demoBoard.searchPostIts(query);
    try {
        const response = await axios.get<PostIt[]>(
            `${baseUrl}/api/postits/search`,
            { params: { q: query }, headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return [];
    }
};

export const createPostIt = async (
    input: Pick<
        PostIt,
        | 'tabId'
        | 'title'
        | 'content'
        | 'color'
        | 'textColor'
        | 'textSize'
        | 'fontFamily'
        | 'x'
        | 'y'
        | 'width'
        | 'height'
        | 'rotation'
    >
): Promise<PostIt> => {
    if (isDemoActive()) return demoBoard.createPostIt(input);
    try {
        const response = await axios.post<PostIt>(
            `${baseUrl}/api/postits`,
            input,
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return {} as PostIt;
    }
};

export const updatePostIt = async (
    postItId: string,
    updates: PostItSaveUpdate,
    guard?: SendGuard
): Promise<PostIt | undefined> => {
    const { etag, ...patch } = updates;
    if (isDemoActive()) {
        await demoBoard.updatePostIt(postItId, patch);
        return undefined;
    }
    // No token, no request: the server would refuse it (428) and nothing may
    // ever fall back to a historical or unconditional contract.
    if (!etag) throw new MissingVersionError();
    try {
        const identity = identityOf(
            'PATCH',
            postItId,
            etag,
            patch,
            contextNow()
        );
        const response = await sendLogical(
            () =>
                axios.patch<PostIt>(
                    `${baseUrl}/api/postits/${postItId}`,
                    // the body frozen with the identity: every attempt sends it
                    identity ? identity.body : patch,
                    {
                        headers: {
                            ...getAuthHeaders(),
                            'If-Match': `"${etag}"`,
                            ...(identity
                                ? { 'X-Mutation-Id': identity.id }
                                : {}),
                        },
                    }
                ),
            identity,
            false,
            guard,
            isCardAnswerFor(postItId)
        );
        const replay = replayOf(response.headers);
        if (replay.replayed) {
            // A receipt proves the ORIGINAL write, never the present state.
            if (replay.current === 'exact') {
                return tagAcknowledged(
                    markIfSuperseded(response.data, response.headers),
                    identity
                );
            }
            if (replay.current === 'live-superseded') {
                // Applied, then overtaken: the client's own write, token unknown.
                return tagAcknowledged(
                    markSuperseded({
                        _id: postItId,
                        ...patch,
                    } as unknown as PostIt),
                    identity
                );
            }
            throw new StaleLifecycleError();
        }
        return tagAcknowledged(
            markIfSuperseded(response.data, response.headers),
            identity
        );
    } catch (error) {
        // A context that is gone is not a failure to report.
        if (error instanceof StaleLifecycleError) throw error;
        handleError(error);
        return undefined;
    }
};

export const duplicatePostIt = async (postItId: string): Promise<PostIt> => {
    if (isDemoActive()) return demoBoard.duplicatePostIt(postItId);
    try {
        const response = await axios.post<PostIt>(
            `${baseUrl}/api/postits/${postItId}/duplicate`,
            {},
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return {} as PostIt;
    }
};

export const deletePostIt = async (
    postItId: string,
    etag?: string,
    guard?: SendGuard
): Promise<DeleteProof | void> => {
    if (isDemoActive()) return demoBoard.deletePostIt(postItId);
    if (!etag) throw new MissingVersionError();
    try {
        const identity = identityOf(
            'DELETE',
            postItId,
            etag,
            null,
            contextNow()
        );
        const response = await sendLogical(
            () =>
                axios.delete(`${baseUrl}/api/postits/${postItId}`, {
                    headers: {
                        ...getAuthHeaders(),
                        'If-Match': `"${etag}"`,
                        ...(identity ? { 'X-Mutation-Id': identity.id } : {}),
                    },
                }),
            identity,
            false,
            guard
        );
        const replay = replayOf(response?.headers);
        if (headerValue(response?.headers, 'x-mutation-protocol') === '1') {
            noteDeletedUnderD1(postItId);
        }
        // The original deletion belongs to a life that is not the current one.
        if (replay.replayed && replay.current !== 'exact') {
            throw new StaleLifecycleError();
        }
        return { etag, mutationId: identity?.id };
    } catch (error) {
        if (error instanceof StaleLifecycleError) throw error;
        handleError(error);
    }
};

// Re-insert a previously deleted card, preserving its original id so undo keeps
// links/mentions pointing at the same card. Returns the restored card, or null
// when the server rejects it (e.g. the id already exists).
export const restorePostIt = async (
    card: PostIt,
    proof?: DeleteProof,
    guard?: SendGuard
): Promise<PostIt | null> => {
    if (isDemoActive()) return demoBoard.restorePostIt(card);
    // Once the server has proven the D1 protocol, a restore without the proof
    // of the deletion is never sent (the server would refuse it, 428).
    if (!proof && (getCapability() === 'd1' || wasDeletedUnderD1(card._id))) {
        throw new MissingVersionError(
            'No proof of the deletion is known for this card'
        );
    }
    try {
        // The snapshot's token and dates are history: the server mints a new
        // life for the card and answers with it.
        const { etag: _snapshotEtag, ...snapshot } = card;
        void _snapshotEtag;
        const body = proof ? { ...snapshot, restoreOf: proof.etag } : snapshot;
        const identity = proof
            ? identityOf(
                  'RESTORE',
                  card._id,
                  proof.etag,
                  snapshot,
                  contextNow(),
                  body
              )
            : undefined;
        const response = await sendLogical(
            () =>
                axios.post<PostIt>(
                    `${baseUrl}/api/postits/restore`,
                    identity ? identity.body : body,
                    {
                        headers: {
                            ...getAuthHeaders(),
                            ...(identity
                                ? { 'X-Mutation-Id': identity.id }
                                : {}),
                        },
                    }
                ),
            identity,
            true,
            guard,
            isCardAnswerFor(card._id)
        );
        const replay = replayOf(response.headers);
        if (replay.replayed && replay.current !== 'exact') {
            // Restored once, but the card is not in that life anymore.
            throw new StaleLifecycleError();
        }
        return tagOperation(
            markIfSuperseded(response.data, response.headers),
            identity
        );
    } catch (error) {
        if (error instanceof StaleLifecycleError) throw error;
        handleError(error);
        return null;
    }
};

export const fetchStacks = async (tabId: string): Promise<PostItStack[]> => {
    if (isDemoActive()) return demoBoard.fetchStacks(tabId);
    try {
        const response = await axios.get<PostItStack[]>(
            `${baseUrl}/api/stacks`,
            {
                params: { tabId },
                headers: getAuthHeaders(),
            }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return [];
    }
};

export const createStack = async (
    input: Pick<PostItStack, 'tabId' | 'x' | 'y'> & { name?: string }
): Promise<PostItStack> => {
    if (isDemoActive()) return demoBoard.createStack(input);
    try {
        const response = await axios.post<PostItStack>(
            `${baseUrl}/api/stacks`,
            input,
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return {} as PostItStack;
    }
};

export const updateStack = async (
    stackId: string,
    updates: PostItStackUpdate
): Promise<void> => {
    if (isDemoActive()) return demoBoard.updateStack(stackId, updates);
    try {
        await axios.patch(`${baseUrl}/api/stacks/${stackId}`, updates, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

export const deleteStack = async (stackId: string): Promise<void> => {
    if (isDemoActive()) return demoBoard.deleteStack(stackId);
    try {
        await axios.delete(`${baseUrl}/api/stacks/${stackId}`, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

// Connections (Pillar 3): arrows/links between two cards of the same tab.
export const fetchConnections = async (tabId: string): Promise<CardLink[]> => {
    if (isDemoActive()) return demoBoard.fetchConnections(tabId);
    try {
        const response = await axios.get<CardLink[]>(
            `${baseUrl}/api/connections`,
            {
                params: { tabId },
                headers: getAuthHeaders(),
            }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return [];
    }
};

export const createConnection = async (
    input: Pick<CardLink, 'tabId' | 'sourceId' | 'targetId'> &
        Partial<Pick<CardLink, 'label' | 'kind'>>
): Promise<CardLink> => {
    if (isDemoActive()) return demoBoard.createConnection(input);
    try {
        const response = await axios.post<CardLink>(
            `${baseUrl}/api/connections`,
            input,
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return {} as CardLink;
    }
};

export const updateConnection = async (
    linkId: string,
    updates: CardLinkUpdate
): Promise<void> => {
    if (isDemoActive()) return demoBoard.updateConnection(linkId, updates);
    try {
        await axios.patch(`${baseUrl}/api/connections/${linkId}`, updates, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

export const deleteConnection = async (linkId: string): Promise<void> => {
    if (isDemoActive()) return demoBoard.deleteConnection(linkId);
    try {
        await axios.delete(`${baseUrl}/api/connections/${linkId}`, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};
