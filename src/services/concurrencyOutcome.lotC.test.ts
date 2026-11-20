// MGN-DATA-01-LOT-C — what a failure proves about the write (H: B3-R5 limits).
// Only an answer of the API itself establishes that a write was NOT applied.

import {
    MissingVersionError,
    StaleLifecycleError,
    isAppliedOutcome,
    isUncertainOutcome,
    outcomeOfError,
} from './concurrencyOutcome';

const http = (
    status: number,
    code?: string,
    headers: Record<string, string> = {}
) =>
    Object.assign(new Error(`http ${status}`), {
        response: { status, data: code ? { code } : {}, headers },
    });

describe('isUncertainOutcome', () => {
    it.each([
        ['no HTTP answer (lost / timeout)', new Error('Network Error')],
        ['bare 503 (a gateway may sit in front of the API)', http(503)],
        ['503 with another code', http(503, 'SERVICE_UNAVAILABLE')],
        ['502', http(502)],
        ['504', http(504)],
        ['500', http(500)],
        // D1A-F1: a coded 503 can follow an applied write (adapted in D1B)
        [
            '503 CONCURRENCY_UNAVAILABLE without proof',
            http(503, 'CONCURRENCY_UNAVAILABLE'),
        ],
    ])('%s: the write may have been applied', (_label, error) => {
        expect(isUncertainOutcome(error)).toBe(true);
    });

    it.each([
        [
            '503 CONCURRENCY_UNAVAILABLE + X-Mutation-Applied: false',
            http(503, 'CONCURRENCY_UNAVAILABLE', {
                'x-mutation-applied': 'false',
            }),
        ],
        ['412', http(412, 'PRECONDITION_FAILED')],
        ['428', http(428)],
        ['400 IF_MATCH_MALFORMED', http(400, 'IF_MATCH_MALFORMED')],
        ['404', http(404)],
        ['409', http(409, 'POST_IT_CONFLICT')],
        ['429', http(429)],
        ['a local refusal (no version)', new MissingVersionError()],
        ['a stale lifecycle', new StaleLifecycleError()],
    ])('%s: the write was certainly not applied', (_label, error) => {
        expect(isUncertainOutcome(error)).toBe(false);
    });
});

describe('outcomeOfError', () => {
    it('maps each failure to one result for its card', () => {
        expect(outcomeOfError('a', http(412)).kind).toBe('refused');
        expect(outcomeOfError('a', new Error('Network Error')).kind).toBe(
            'uncertain'
        );
        expect(outcomeOfError('a', http(503)).kind).toBe('uncertain');
        expect(outcomeOfError('a', new StaleLifecycleError()).kind).toBe(
            'stale'
        );
        expect(outcomeOfError('a', new MissingVersionError()).kind).toBe(
            'refused'
        );
    });

    it('only acknowledged results count as applied', () => {
        expect(isAppliedOutcome({ id: 'a', kind: 'acked' })).toBe(true);
        expect(isAppliedOutcome({ id: 'a', kind: 'superseded' })).toBe(true);
        (['refused', 'uncertain', 'stale'] as const).forEach((kind) =>
            expect(isAppliedOutcome({ id: 'a', kind })).toBe(false)
        );
    });
});
