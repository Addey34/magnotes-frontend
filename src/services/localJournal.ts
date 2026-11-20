/**
 * MGN-DATA-01 / D2-S1 — local durable journal of the user's unsynchronised work.
 *
 * Four kinds of records, kept apart, all namespaced by the authenticated
 * OWNER (the durable account id carried by the access token, never a volatile
 * session generation), the resource (card) and the writer (the tab that wrote
 * it):
 *   draft     typed / dropped content that has not left yet
 *   op        a frozen network operation: opaque base, mutation id, exact body
 *   conflict  content that was refused or displaced and must be recovered
 *
 * Nothing here ever holds a credential: no JWT, no refresh token, no
 * Authorization header, no Axios object. The `base` of a record is the card's
 * opaque concurrency token (`etag`), kept for provenance, never decoded.
 *
 * The storage is an abstraction (`JournalStore`) so that the logic is tested
 * against a faulty in-memory store and the IndexedDB adapter against a real
 * browser. Nothing is announced as saved before the store confirmed the
 * transaction.
 */

import { canonical } from './mutationProtocol';

export const JOURNAL_DB_NAME = 'magnotes-journal';
export const JOURNAL_SCHEMA_VERSION = 1;

export type RecordKind = 'draft' | 'op' | 'conflict';

export interface RecordHeader {
    /** storage key: owner, resource, kind, id */
    key: string;
    kind: RecordKind;
    schema: number;
    owner: string;
    resource: string;
    /** the tab that wrote it (a lock proves whether it is still alive) */
    writer: string;
    at: number;
}

export interface DraftRecord extends RecordHeader {
    kind: 'draft';
    base: string | null;
    fields: Record<string, unknown>;
    order: number;
}

export interface OpRecord extends RecordHeader {
    kind: 'op';
    method: string;
    mutationId: string;
    base: string | null;
    body: Record<string, unknown>;
    regime: 'd1' | 'historical';
    state: 'frozen' | 'ambiguous';
    /** the operation was handed back to the user, not replayable any more */
    covered: string[];
}

export type ConflictReason =
    | 'precondition-failed'
    | 'not-found'
    | 'refused'
    | 'receipt-unavailable'
    | 'session-ended'
    | 'unknown';

export interface ConflictRecord extends RecordHeader {
    kind: 'conflict';
    base: string | null;
    fields: Record<string, unknown>;
    reason: ConflictReason;
    mutationId: string | null;
}

export type JournalRecord = DraftRecord | OpRecord | ConflictRecord;

// ---- errors ------------------------------------------------------------------

export class JournalUnavailableError extends Error {
    constructor(message = 'The local storage is unavailable') {
        super(message);
        this.name = 'JournalUnavailableError';
    }
}
export class JournalQuotaError extends Error {
    constructor(message = 'The local storage quota is exceeded') {
        super(message);
        this.name = 'JournalQuotaError';
    }
}

// ---- store abstraction ---------------------------------------------------------

/**
 * `expect` is a precondition checked INSIDE the transaction: the row under
 * `key` must still be written by `writer` (and, when given, at `at`); `writer:
 * null` means the row must be absent. When it does not hold, the whole
 * transaction is rolled back (`JournalConflictError`): this is the
 * compare-and-set that makes a take-over exclusive between two successors.
 */
export type StoreOperation =
    | { type: 'put'; record: JournalRecord }
    | { type: 'delete'; key: string }
    | { type: 'expect'; key: string; writer: string | null; sig?: string };

/** A precondition of the transaction did not hold: nothing was written. */
export class JournalConflictError extends Error {
    constructor(message = 'The record was changed by another page') {
        super(message);
        this.name = 'JournalConflictError';
    }
}

/**
 * The signature of a row: what makes it THIS version of itself (writer,
 * instant, order and content). Two writes of the same millisecond still differ
 * through their content or order, so a compare-and-set cannot be fooled.
 */
export const rowSignature = (row: unknown): string => {
    const r = (row ?? {}) as Record<string, unknown>;
    return canonical({
        writer: r.writer,
        at: r.at,
        order: r.order,
        state: r.state,
        base: r.base,
        fields: r.fields,
        body: r.body,
        mutationId: r.mutationId,
    });
};

export const expectationHolds = (
    row: unknown,
    expectation: { writer: string | null; sig?: string }
): boolean => {
    if (expectation.writer === null) return row === undefined || row === null;
    if (!row || typeof row !== 'object') return false;
    const found = row as { writer?: unknown };
    return (
        found.writer === expectation.writer &&
        (expectation.sig === undefined || rowSignature(row) === expectation.sig)
    );
};

export interface JournalStore {
    /** all-or-nothing; resolves only once the transaction is durable */
    transact(operations: StoreOperation[]): Promise<void>;
    /** raw rows whose key starts with `prefix` (validated by the caller) */
    list(prefix: string): Promise<unknown[]>;
    /** removes every row whose key starts with `prefix` ('' = everything) */
    clear(prefix: string): Promise<void>;
    close(): void;
}

const SEP = '\u0001';
export const keyOf = (
    owner: string,
    resource: string,
    kind: RecordKind,
    id: string
): string => [owner, resource, kind, id].join(SEP);
export const prefixOf = (owner: string, resource?: string): string =>
    resource === undefined ? owner + SEP : [owner, resource, ''].join(SEP);

// ---- validation: the content of the storage is never trusted --------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const isNullableString = (value: unknown): boolean =>
    value === null || typeof value === 'string';

// A JSON-safe object: refuses functions, symbols, cycles and prototypes tricks.
const isPlainJson = (value: unknown, depth = 0): boolean => {
    if (depth > 12) return false;
    if (value === null) return true;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return true;
    if (Array.isArray(value))
        return value.every((v) => isPlainJson(v, depth + 1));
    if (isRecord(value)) {
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) return false;
        return Object.values(value).every((v) => isPlainJson(v, depth + 1));
    }
    return false;
};

/** Secret-looking keys are never accepted into the journal. */
const FORBIDDEN_KEY =
    /^(authorization|token|accessToken|refreshToken|password|cookie|jwt)$/i;
const hasForbiddenKey = (value: unknown, depth = 0): boolean => {
    if (depth > 12 || !value || typeof value !== 'object') return false;
    return Object.entries(value as Record<string, unknown>).some(
        ([key, inner]) =>
            FORBIDDEN_KEY.test(key) || hasForbiddenKey(inner, depth + 1)
    );
};

export function validateRecord(raw: unknown): JournalRecord | null {
    if (!isRecord(raw)) return null;
    if (raw.schema !== JOURNAL_SCHEMA_VERSION) return null;
    if (
        typeof raw.key !== 'string' ||
        typeof raw.owner !== 'string' ||
        raw.owner === '' ||
        typeof raw.resource !== 'string' ||
        typeof raw.writer !== 'string' ||
        typeof raw.at !== 'number'
    ) {
        return null;
    }
    if (hasForbiddenKey(raw)) return null;
    switch (raw.kind) {
        case 'draft':
            return isNullableString(raw.base) &&
                isRecord(raw.fields) &&
                isPlainJson(raw.fields) &&
                typeof raw.order === 'number'
                ? (raw as unknown as DraftRecord)
                : null;
        case 'op':
            return typeof raw.method === 'string' &&
                typeof raw.mutationId === 'string' &&
                isNullableString(raw.base) &&
                isRecord(raw.body) &&
                isPlainJson(raw.body) &&
                (raw.regime === 'd1' || raw.regime === 'historical') &&
                (raw.state === 'frozen' || raw.state === 'ambiguous') &&
                Array.isArray(raw.covered)
                ? (raw as unknown as OpRecord)
                : null;
        case 'conflict':
            return isNullableString(raw.base) &&
                isRecord(raw.fields) &&
                isPlainJson(raw.fields) &&
                typeof raw.reason === 'string' &&
                isNullableString(raw.mutationId)
                ? (raw as unknown as ConflictRecord)
                : null;
        default:
            return null;
    }
}

// ---- in-memory store (tests; also the fallback that never persists) --------------

export interface MemoryStoreFaults {
    /** the next `n` transactions fail with this error */
    failNext?: { count: number; error: Error };
    /** the transaction reports success only when it is explicitly released */
    holdCommit?: boolean;
}

export class MemoryStore implements JournalStore {
    rows = new Map<string, unknown>();
    faults: MemoryStoreFaults = {};
    private held: Array<() => void> = [];

    private fail(): Error | undefined {
        const f = this.faults.failNext;
        if (f && f.count > 0) {
            f.count -= 1;
            return f.error;
        }
        return undefined;
    }

    async transact(operations: StoreOperation[]): Promise<void> {
        const error = this.fail();
        if (error) throw error;
        if (this.faults.holdCommit) {
            await new Promise<void>((resolve) => this.held.push(resolve));
        }
        // all-or-nothing: preconditions first, then everything together
        for (const operation of operations) {
            if (
                operation.type === 'expect' &&
                !expectationHolds(this.rows.get(operation.key), operation)
            ) {
                throw new JournalConflictError();
            }
        }
        for (const operation of operations) {
            if (operation.type === 'expect') continue;
            if (operation.type === 'put') {
                this.rows.set(
                    operation.record.key,
                    JSON.parse(JSON.stringify(operation.record))
                );
            } else this.rows.delete(operation.key);
        }
    }
    releaseCommits(): void {
        this.faults.holdCommit = false;
        this.held.splice(0).forEach((resolve) => resolve());
    }
    async list(prefix: string): Promise<unknown[]> {
        const error = this.fail();
        if (error) throw error;
        return [...this.rows.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([, value]) => JSON.parse(JSON.stringify(value)));
    }
    async clear(prefix: string): Promise<void> {
        for (const key of [...this.rows.keys()]) {
            if (key.startsWith(prefix)) this.rows.delete(key);
        }
    }
    close(): void {
        /* nothing to release */
    }
}

// ---- IndexedDB adapter -----------------------------------------------------------

const STORE = 'records';

const classify = (error: unknown): Error => {
    const name = (error as { name?: string } | undefined)?.name;
    if (name === 'QuotaExceededError') return new JournalQuotaError();
    return new JournalUnavailableError(
        typeof name === 'string' ? `IndexedDB: ${name}` : undefined
    );
};

/**
 * Opens (and upgrades) the database. Rejects with `JournalUnavailableError`
 * when IndexedDB is missing, blocked, private or fails to open: the caller
 * degrades to "local storage unavailable", never to a crash.
 */
export function openIndexedDbStore(
    factory: IDBFactory | undefined = globalThis.indexedDB,
    name = JOURNAL_DB_NAME
): Promise<JournalStore> {
    return new Promise((resolve, reject) => {
        if (!factory) {
            reject(new JournalUnavailableError());
            return;
        }
        let request: IDBOpenDBRequest;
        try {
            request = factory.open(name, JOURNAL_SCHEMA_VERSION);
        } catch (error) {
            reject(classify(error));
            return;
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            // Version 1: one store keyed by the namespaced key. A later
            // version migrates here, never by dropping the records.
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'key' });
            }
        };
        request.onerror = () => reject(classify(request.error));
        request.onblocked = () => reject(new JournalUnavailableError());
        request.onsuccess = () => {
            const db = request.result;
            // another tab upgrades the schema: release the connection
            db.onversionchange = () => db.close();
            resolve({
                transact: (operations) =>
                    new Promise<void>((done, fail) => {
                        let tx: IDBTransaction;
                        let conflict = false;
                        try {
                            tx = db.transaction(STORE, 'readwrite', {
                                durability: 'strict',
                            } as IDBTransactionOptions);
                            const store = tx.objectStore(STORE);
                            const checks = operations.filter(
                                (operation) => operation.type === 'expect'
                            ) as Array<
                                Extract<StoreOperation, { type: 'expect' }>
                            >;
                            const apply = () => {
                                for (const operation of operations) {
                                    if (operation.type === 'put') {
                                        store.put(operation.record);
                                    } else if (operation.type === 'delete') {
                                        store.delete(operation.key);
                                    }
                                }
                            };
                            if (checks.length === 0) apply();
                            else {
                                let waiting = checks.length;
                                let holds = true;
                                for (const check of checks) {
                                    const read = store.get(check.key);
                                    read.onsuccess = () => {
                                        if (
                                            !expectationHolds(
                                                read.result,
                                                check
                                            )
                                        ) {
                                            holds = false;
                                        }
                                        waiting -= 1;
                                        if (waiting > 0) return;
                                        if (holds) apply();
                                        else {
                                            conflict = true;
                                            tx.abort();
                                        }
                                    };
                                }
                            }
                        } catch (error) {
                            fail(classify(error));
                            return;
                        }
                        // success is only reported by the COMMIT of the tx
                        tx.oncomplete = () => done();
                        tx.onerror = () => fail(classify(tx.error));
                        tx.onabort = () =>
                            fail(
                                conflict
                                    ? new JournalConflictError()
                                    : classify(tx.error)
                            );
                    }),
                list: (prefix) =>
                    new Promise<unknown[]>((done, fail) => {
                        try {
                            const tx = db.transaction(STORE, 'readonly');
                            const range = IDBKeyRange.bound(
                                prefix,
                                prefix + '￿'
                            );
                            const query = tx.objectStore(STORE).getAll(range);
                            query.onsuccess = () => done(query.result);
                            query.onerror = () => fail(classify(query.error));
                        } catch (error) {
                            fail(classify(error));
                        }
                    }),
                clear: (prefix) =>
                    new Promise<void>((done, fail) => {
                        try {
                            const tx = db.transaction(STORE, 'readwrite');
                            const store = tx.objectStore(STORE);
                            if (prefix === '') store.clear();
                            else {
                                store.delete(
                                    IDBKeyRange.bound(prefix, prefix + '￿')
                                );
                            }
                            tx.oncomplete = () => done();
                            tx.onerror = () => fail(classify(tx.error));
                            tx.onabort = () => fail(classify(tx.error));
                        } catch (error) {
                            fail(classify(error));
                        }
                    }),
                close: () => db.close(),
            });
        };
    });
}

// ---- the journal -------------------------------------------------------------------

export type JournalStatus = 'unknown' | 'ready' | 'unavailable' | 'quota';

export interface JournalSnapshot {
    drafts: DraftRecord[];
    ops: OpRecord[];
    conflicts: ConflictRecord[];
    /** rows that failed validation (kept in storage, never used) */
    invalid: number;
}

const randomId = (): string => {
    const bytes = new Uint8Array(12);
    (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export class LocalJournal {
    readonly writer: string;
    private store: JournalStore | null;
    private opening: Promise<void> | null = null;
    private status: JournalStatus = 'unknown';
    private listeners = new Set<() => void>();
    private clock = 0;

    constructor(store: JournalStore | null, writer = `t${randomId()}`) {
        this.writer = writer;
        this.store = store;
        this.status = store ? 'ready' : 'unavailable';
    }

    /**
     * A journal whose storage is still opening: every operation waits for the
     * outcome, so what is typed during the opening is not lost, and a storage
     * that cannot be opened degrades to "unavailable".
     */
    static opening(open: () => Promise<JournalStore>): LocalJournal {
        const journal = new LocalJournal(null);
        journal.status = 'unknown';
        journal.opening = open().then(
            (store) => {
                journal.store = store;
                journal.setStatus('ready');
            },
            (error) =>
                journal.setStatus(
                    error instanceof JournalQuotaError ? 'quota' : 'unavailable'
                )
        );
        return journal;
    }

    /** Resolves once the storage is open (or known to be unavailable). */
    ready = (): Promise<void> => this.opening ?? Promise.resolve();

    getStatus = (): JournalStatus => this.status;
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };
    private setStatus(next: JournalStatus): void {
        if (this.status !== next) {
            this.status = next;
            this.listeners.forEach((listener) => listener());
        }
    }

    /** Applies the operations; the status follows what the storage really did. */
    private async commit(operations: StoreOperation[]): Promise<boolean> {
        await this.ready();
        if (!this.store) return false;
        try {
            await this.store.transact(operations);
            this.setStatus('ready');
            return true;
        } catch (error) {
            // another page won the row: the storage itself is fine
            if (error instanceof JournalConflictError) return false;
            this.setStatus(
                error instanceof JournalQuotaError ? 'quota' : 'unavailable'
            );
            return false;
        }
    }

    private header(
        kind: RecordKind,
        owner: string,
        resource: string,
        id: string
    ): RecordHeader {
        return {
            key: keyOf(owner, resource, kind, id),
            kind,
            schema: JOURNAL_SCHEMA_VERSION,
            owner,
            resource,
            writer: this.writer,
            at: Date.now(),
        };
    }

    /** Draft: content typed, not sent yet. One row per (writer, base). */
    saveDraft(
        owner: string,
        resource: string,
        base: string | undefined,
        fields: Record<string, unknown>
    ): Promise<boolean> {
        const id = `${this.writer}|${base ?? ''}`;
        const record: DraftRecord = {
            ...this.header('draft', owner, resource, id),
            kind: 'draft',
            base: base ?? null,
            fields,
            order: ++this.clock,
        };
        return this.commit([{ type: 'put', record }]);
    }

    /**
     * Freezes the operation durably BEFORE its first emission and, in the same
     * transaction, removes exactly the draft fields it carries (a newer draft
     * value of the same field stays).
     */
    async freeze(
        owner: string,
        operation: {
            resource: string;
            method: string;
            mutationId: string;
            base: string | undefined;
            body: Record<string, unknown>;
            regime: 'd1' | 'historical';
            /** a replay of an operation already marked ambiguous stays so */
            state?: 'frozen' | 'ambiguous';
        },
        draftAfter: Record<string, unknown> | null,
        draftBase: string | undefined,
        // draft rows of the same card written on other bases that also held
        // fields this operation carries
        others: Array<{
            base: string | undefined;
            fields: Record<string, unknown> | null;
        }> = []
    ): Promise<boolean> {
        const record: OpRecord = {
            ...this.header(
                'op',
                owner,
                operation.resource,
                operation.mutationId
            ),
            kind: 'op',
            method: operation.method,
            mutationId: operation.mutationId,
            base: operation.base ?? null,
            body: operation.body,
            regime: operation.regime,
            state: operation.state ?? 'frozen',
            covered: Object.keys(operation.body),
        };
        const draftKey = keyOf(
            owner,
            operation.resource,
            'draft',
            `${this.writer}|${draftBase ?? ''}`
        );
        const ops: StoreOperation[] = [{ type: 'put', record }];
        if (draftAfter && Object.keys(draftAfter).length > 0) {
            ops.push({
                type: 'put',
                record: {
                    ...this.header(
                        'draft',
                        owner,
                        operation.resource,
                        `${this.writer}|${draftBase ?? ''}`
                    ),
                    kind: 'draft',
                    base: draftBase ?? null,
                    fields: draftAfter,
                    order: ++this.clock,
                } as DraftRecord,
            });
        } else ops.push({ type: 'delete', key: draftKey });
        for (const other of others) {
            const id = `${this.writer}|${other.base ?? ''}`;
            if (other.fields && Object.keys(other.fields).length > 0) {
                ops.push({
                    type: 'put',
                    record: {
                        ...this.header('draft', owner, operation.resource, id),
                        kind: 'draft',
                        base: other.base ?? null,
                        fields: other.fields,
                        order: ++this.clock,
                    } as DraftRecord,
                });
            } else {
                ops.push({
                    type: 'delete',
                    key: keyOf(owner, operation.resource, 'draft', id),
                });
            }
        }
        return this.commit(ops);
    }

    /** Records an operation durably (no draft is touched): a deletion. */
    recordOperation(
        owner: string,
        operation: {
            resource: string;
            method: string;
            mutationId: string;
            base: string | undefined;
            body: Record<string, unknown>;
            regime: 'd1' | 'historical';
        }
    ): Promise<OpRecord | false> {
        const record: OpRecord = {
            ...this.header(
                'op',
                owner,
                operation.resource,
                operation.mutationId
            ),
            kind: 'op',
            method: operation.method,
            mutationId: operation.mutationId,
            base: operation.base ?? null,
            body: operation.body,
            regime: operation.regime,
            state: 'frozen',
            covered: Object.keys(operation.body),
        };
        return this.commit([{ type: 'put', record }]).then((ok) =>
            ok ? record : false
        );
    }

    markAmbiguous(
        owner: string,
        resource: string,
        record: OpRecord
    ): Promise<boolean> {
        return this.commit([
            {
                type: 'put',
                record: { ...record, state: 'ambiguous', at: Date.now() },
            },
        ]);
    }

    /** Acknowledged: closes ONLY this operation. */
    closeOp(
        owner: string,
        resource: string,
        mutationId: string
    ): Promise<boolean> {
        return this.commit([
            { type: 'delete', key: keyOf(owner, resource, 'op', mutationId) },
        ]);
    }

    /**
     * A certain failure that is not final (the request never reached the
     * server): the content goes back to a draft and the operation is dropped,
     * atomically.
     */
    thaw(
        owner: string,
        op: OpRecord,
        draftFields: Record<string, unknown>
    ): Promise<boolean> {
        const draft: DraftRecord = {
            ...this.header(
                'draft',
                owner,
                op.resource,
                `${this.writer}|${op.base ?? ''}`
            ),
            kind: 'draft',
            base: op.base,
            fields: draftFields,
            order: ++this.clock,
        };
        return this.commit([
            { type: 'delete', key: op.key },
            { type: 'put', record: draft },
        ]);
    }

    /** Final refusal / displaced content: kept for an explicit resolution. */
    recordConflict(
        owner: string,
        resource: string,
        base: string | undefined,
        fields: Record<string, unknown>,
        reason: ConflictReason,
        mutationId: string | null,
        alsoDelete: string[] = []
    ): Promise<boolean> {
        const id = mutationId ?? `${this.writer}|${base ?? ''}|${++this.clock}`;
        const record: ConflictRecord = {
            ...this.header('conflict', owner, resource, id),
            kind: 'conflict',
            base: base ?? null,
            fields,
            reason,
            mutationId,
        };
        return this.commit([
            { type: 'put', record },
            ...alsoDelete.map(
                (key) => ({ type: 'delete', key }) as StoreOperation
            ),
        ]);
    }

    /**
     * EXCLUSIVE take-over of a record another page wrote: one transaction with
     * a compare-and-set on its previous writer and instant. Two successors
     * racing for the same record cannot both win; an interruption leaves
     * either the old row (nothing happened) or the new one (fully moved).
     *
     *  - operation: keeps its key, changes writer (same id, base, body, regime);
     *  - draft / conflict taken `as: 'draft'`: becomes a draft row of THIS page,
     *    merged with `own` (what this page already holds for the same base,
     *    which is newer and wins).
     *
     * Returns the record as it now stands, or false when another page won, the
     * record is gone, or the storage failed (nothing was written then).
     */
    async take(
        owner: string,
        record: DraftRecord | OpRecord | ConflictRecord,
        options: {
            as?: 'draft';
            /**
             * What this page already holds for the same base (newer than the
             * taken record, so it wins). A function is evaluated for every
             * attempt, right before the transaction: what was typed while an
             * earlier attempt was lost is never replaced by an older snapshot.
             */
            own?:
                | Record<string, unknown>
                | (() => Record<string, unknown> | undefined);
            base?: string | null;
        } = {}
    ): Promise<DraftRecord | OpRecord | false> {
        // The record must belong to the owner this take-over acts for, before
        // anything of it is read, moved or handed on.
        if (!owner || record.owner !== owner) return false;
        if (!record.key.startsWith(prefixOf(owner))) return false;
        const guard: StoreOperation = {
            type: 'expect',
            key: record.key,
            writer: record.writer,
            sig: rowSignature(record),
        };
        if (record.kind === 'op' && options.as !== 'draft') {
            const moved: OpRecord = {
                ...record,
                writer: this.writer,
                at: Date.now(),
            };
            const ok = await this.commit([
                guard,
                { type: 'put', record: moved },
            ]);
            return ok ? moved : false;
        }
        const fields =
            record.kind === 'op'
                ? (record as OpRecord).body
                : (record as DraftRecord | ConflictRecord).fields;
        const base = options.base !== undefined ? options.base : record.base;
        const destKey = keyOf(
            owner,
            record.resource,
            'draft',
            `${this.writer}|${base ?? ''}`
        );
        // The destination is guarded as well as the source: a newer draft
        // this page wrote there while the transaction was being prepared is
        // read again and merged (it wins), never replaced by an older
        // snapshot of the memory mirror. A change of either row aborts the
        // transaction; the source decides whether it is worth another try.
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const dest =
                destKey === record.key
                    ? undefined
                    : await this.currentDraft(destKey);
            if (dest === null) return false; // unreadable: nothing is taken
            const moved: DraftRecord = {
                ...this.header(
                    'draft',
                    owner,
                    record.resource,
                    `${this.writer}|${base ?? ''}`
                ),
                kind: 'draft',
                base,
                fields: {
                    ...fields,
                    ...(dest?.fields ?? {}),
                    ...((typeof options.own === 'function'
                        ? options.own()
                        : options.own) ?? {}),
                },
                order: ++this.clock,
            };
            const ops: StoreOperation[] = [guard];
            if (destKey !== record.key) {
                ops.push(
                    dest
                        ? {
                              type: 'expect',
                              key: destKey,
                              writer: dest.writer,
                              sig: rowSignature(dest),
                          }
                        : { type: 'expect', key: destKey, writer: null }
                );
                ops.push({ type: 'delete', key: record.key });
            }
            ops.push({ type: 'put', record: moved });
            if (await this.commit(ops)) return moved;
            // lost: retry only while the source is untouched (the destination
            // moved), otherwise another page won the record
            const source = await this.currentDraft(record.key);
            if (
                !source ||
                source.writer !== record.writer ||
                rowSignature(source) !== rowSignature(record)
            ) {
                return false;
            }
        }
        return false;
    }

    /** The validated row under `key`: undefined when absent, null when unreadable. */
    private async currentDraft(
        key: string
    ): Promise<DraftRecord | undefined | null> {
        await this.ready();
        if (!this.store) return null;
        try {
            const rows = await this.store.list(key);
            for (const raw of rows) {
                const row = validateRecord(raw);
                if (row && row.key === key) {
                    return row.kind === 'op' ? undefined : (row as DraftRecord);
                }
            }
            return undefined;
        } catch {
            return null;
        }
    }

    /** An explicit abandon of one record, by the user. */
    discard(keys: string[]): Promise<boolean> {
        return this.commit(keys.map((key) => ({ type: 'delete', key })));
    }

    /** Everything the owner has, validated; invalid rows are counted, not used. */
    async read(owner: string, resource?: string): Promise<JournalSnapshot> {
        const out: JournalSnapshot = {
            drafts: [],
            ops: [],
            conflicts: [],
            invalid: 0,
        };
        await this.ready();
        if (!this.store || !owner) return out;
        let rows: unknown[];
        try {
            rows = await this.store.list(prefixOf(owner, resource));
            this.setStatus('ready');
        } catch (error) {
            this.setStatus(
                error instanceof JournalQuotaError ? 'quota' : 'unavailable'
            );
            return out;
        }
        for (const raw of rows) {
            const record = validateRecord(raw);
            // a row that claims another owner than its key's namespace is hostile
            if (!record || !record.key.startsWith(prefixOf(owner))) {
                out.invalid += 1;
                continue;
            }
            if (record.owner !== owner) {
                out.invalid += 1;
                continue;
            }
            if (record.kind === 'draft') out.drafts.push(record);
            else if (record.kind === 'op') out.ops.push(record);
            else out.conflicts.push(record);
        }
        out.drafts.sort((a, b) => a.order - b.order);
        return out;
    }

    /** Explicit "delete the local storage" (all owners when `owner` is omitted). */
    async purge(owner?: string): Promise<boolean> {
        await this.ready();
        if (!this.store) return false;
        try {
            await this.store.clear(owner === undefined ? '' : prefixOf(owner));
            this.setStatus('ready');
            return true;
        } catch {
            this.setStatus('unavailable');
            return false;
        }
    }

    close(): void {
        this.store?.close();
    }
}

/** The journal of the page: opened once, shared by every consumer. */
let shared: LocalJournal | null = null;
export const sharedJournal = (): LocalJournal =>
    (shared ||= LocalJournal.opening(() => openIndexedDbStore()));
export const resetSharedJournalForTests = (next: LocalJournal | null): void => {
    shared = next;
};
