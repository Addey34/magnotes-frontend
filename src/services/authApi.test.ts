import axios from 'axios';
import { setupAuthInterceptor } from './authApi';

describe('setupAuthInterceptor', () => {
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

        const dispose = setupAuthInterceptor(jest.fn());

        expect(useSpy).toHaveBeenCalledTimes(1);
        dispose();
        expect(ejectSpy).toHaveBeenCalledWith(17);
    });
});
