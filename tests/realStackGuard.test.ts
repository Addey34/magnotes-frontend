import {
    assertBackendBoundToIsolatedMongo,
    parseApiUrl,
    parseNetstat,
} from '../e2e/realStackGuard';

const row = (
    local: string,
    remote: string,
    state: string,
    pid: number
): string => `  TCP    ${local}    ${remote}    ${state}    ${pid}`;

const netstat = (...rows: string[]) =>
    parseNetstat(
        [
            'Connexions actives',
            '',
            ...rows,
            '  UDP    0.0.0.0:5353    *:*    99',
        ].join('\n')
    );

describe('real-stack isolation guard', () => {
    it('parses loopback, wildcard and IPv6 API URLs and refuses the rest', () => {
        expect(parseApiUrl('http://127.0.0.1:5500')).toEqual({
            host: '127.0.0.1',
            port: 5500,
        });
        expect(parseApiUrl('http://localhost:5611').port).toBe(5611);
        expect(() =>
            parseApiUrl('https://api-magnotes.adrianguichard.dev')
        ).toThrow(/loopback/);
        expect(() => parseApiUrl('http://10.0.0.5:5500')).toThrow(/loopback/);
        expect(() => parseApiUrl('not a url')).toThrow(/valid URL/);
    });

    it('accepts a backend listening on the API port and connected to the isolated MongoDB', () => {
        const pid = assertBackendBoundToIsolatedMongo(
            netstat(
                row('0.0.0.0:5500', '0.0.0.0:0', 'LISTENING', 4242),
                row('127.0.0.1:50321', '127.0.0.1:27231', 'ESTABLISHED', 4242),
                row('127.0.0.1:50400', '127.0.0.1:1025', 'TIME_WAIT', 4242)
            ),
            5500,
            27231
        );
        expect(pid).toBe(4242);
    });

    it('refuses when nothing, or several processes, listen on the API port', () => {
        expect(() =>
            assertBackendBoundToIsolatedMongo(netstat(), 5500, 27231)
        ).toThrow(/exactly one process/);
        expect(() =>
            assertBackendBoundToIsolatedMongo(
                netstat(
                    row('0.0.0.0:5500', '0.0.0.0:0', 'LISTENING', 1),
                    row('[::]:5500', '[::]:0', 'LISTENING', 2)
                ),
                5500,
                27231
            )
        ).toThrow(/exactly one process/);
    });

    it('refuses a backend wired to the default MongoDB instead of the isolated one', () => {
        expect(() =>
            assertBackendBoundToIsolatedMongo(
                netstat(
                    row('0.0.0.0:5500', '0.0.0.0:0', 'LISTENING', 4242),
                    row(
                        '127.0.0.1:50321',
                        '127.0.0.1:27017',
                        'ESTABLISHED',
                        4242
                    )
                ),
                5500,
                27231
            )
        ).toThrow(/no connection to the isolated MongoDB/);
    });

    it('refuses a backend that also reaches another MongoDB or a remote host', () => {
        const base = [
            row('0.0.0.0:5500', '0.0.0.0:0', 'LISTENING', 4242),
            row('127.0.0.1:50321', '127.0.0.1:27231', 'ESTABLISHED', 4242),
        ];
        expect(() =>
            assertBackendBoundToIsolatedMongo(
                netstat(
                    ...base,
                    row(
                        '127.0.0.1:50330',
                        '127.0.0.1:27017',
                        'ESTABLISHED',
                        4242
                    )
                ),
                5500,
                27231
            )
        ).toThrow(/another MongoDB/);
        expect(() =>
            assertBackendBoundToIsolatedMongo(
                netstat(
                    ...base,
                    row(
                        '192.168.1.10:50331',
                        '203.0.113.9:27017',
                        'ESTABLISHED',
                        4242
                    )
                ),
                5500,
                27231
            )
        ).toThrow(/another MongoDB instance or to a remote host/);
    });

    it('ignores connections of unrelated processes', () => {
        expect(
            assertBackendBoundToIsolatedMongo(
                netstat(
                    row('0.0.0.0:5500', '0.0.0.0:0', 'LISTENING', 4242),
                    row(
                        '127.0.0.1:50321',
                        '127.0.0.1:27231',
                        'ESTABLISHED',
                        4242
                    ),
                    row(
                        '127.0.0.1:50999',
                        '127.0.0.1:27017',
                        'ESTABLISHED',
                        7777
                    )
                ),
                5500,
                27231
            )
        ).toBe(4242);
    });
});
