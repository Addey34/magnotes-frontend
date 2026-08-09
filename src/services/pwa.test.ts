import { registerServiceWorker } from './pwa';

describe('registerServiceWorker', () => {
    it('is a no-op when disabled', () => {
        const register = jest.fn();
        const result = registerServiceWorker({
            enabled: false,
            nav: { serviceWorker: { register } },
        });
        expect(result).toBeNull();
        expect(register).not.toHaveBeenCalled();
    });

    it('is a no-op when the browser lacks serviceWorker support', () => {
        const result = registerServiceWorker({ enabled: true, nav: {} });
        expect(result).toBeNull();
    });

    it('registers the scoped worker when enabled and supported', async () => {
        const register = jest.fn().mockResolvedValue({});
        await registerServiceWorker({
            enabled: true,
            nav: { serviceWorker: { register } },
        });
        expect(register).toHaveBeenCalledWith('/app/service-worker.js', {
            scope: '/app/',
        });
    });

    it('never throws when registration rejects', async () => {
        const register = jest.fn().mockRejectedValue(new Error('boom'));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(
            registerServiceWorker({
                enabled: true,
                nav: { serviceWorker: { register } },
            })
        ).resolves.toBeNull();
        warn.mockRestore();
    });
});
