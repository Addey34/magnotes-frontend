import axios from 'axios';
import { installAuthInterceptor } from './authInterceptor';

describe('installAuthInterceptor', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns a disposer that ejects the installed response interceptor', () => {
        const useSpy = jest
            .spyOn(axios.interceptors.response, 'use')
            .mockReturnValue(17);
        const ejectSpy = jest
            .spyOn(axios.interceptors.response, 'eject')
            .mockImplementation(() => undefined);

        const dispose = installAuthInterceptor(
            jest.fn().mockResolvedValue(null),
            jest.fn()
        );

        expect(useSpy).toHaveBeenCalledTimes(1);
        dispose();
        expect(ejectSpy).toHaveBeenCalledWith(17);
    });

    it('keeps the session when the refresh outcome is unknown (network/server failure)', async () => {
        let handler: ((e: unknown) => Promise<unknown>) | undefined;
        jest.spyOn(axios.interceptors.response, 'use').mockImplementation(((
            _ok: unknown,
            fail: (e: unknown) => Promise<unknown>
        ) => {
            handler = fail;
            return 1;
        }) as never);
        const onSessionLost = jest.fn();
        installAuthInterceptor(
            jest.fn().mockRejectedValue(new Error('offline')),
            onSessionLost
        );
        const error = {
            response: { status: 401 },
            config: { url: '/api/boards', headers: {} },
        };
        await expect(handler!(error)).rejects.toBe(error);
        expect(onSessionLost).not.toHaveBeenCalled();
    });

    it('signs out when the refresh is definitively rejected, and never retries twice', async () => {
        let handler: ((e: unknown) => Promise<unknown>) | undefined;
        jest.spyOn(axios.interceptors.response, 'use').mockImplementation(((
            _ok: unknown,
            fail: (e: unknown) => Promise<unknown>
        ) => {
            handler = fail;
            return 1;
        }) as never);
        const onSessionLost = jest.fn();
        const refresh = jest.fn().mockResolvedValue(null);
        installAuthInterceptor(refresh, onSessionLost);
        const error = {
            response: { status: 401 },
            config: { url: '/api/boards', headers: {} },
        };
        await expect(handler!(error)).rejects.toBe(error);
        await expect(handler!(error)).rejects.toBe(error); // already _retry
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(onSessionLost).toHaveBeenCalledTimes(1);
    });
});
