import axios from 'axios';
import {
    changePassword,
    listSessions,
    revokeOtherSessions,
    revokeSession,
} from './accountApi';

jest.mock('axios');
jest.mock('./apiBase', () => ({ baseUrl: '' }));
jest.mock('../utils/tokenUtils', () => ({ getToken: () => 'tok' }));

const mocked = jest.mocked(axios);
const auth = { Authorization: 'Bearer tok' };

beforeEach(() => jest.resetAllMocks());

it('lists sessions', async () => {
    mocked.get.mockResolvedValue({ data: { sessions: [{ id: 'a' }] } });
    await expect(listSessions()).resolves.toEqual([{ id: 'a' }]);
    expect(mocked.get).toHaveBeenCalledWith('/api/account/sessions', {
        headers: auth,
    });
});

it('revokes one session', async () => {
    mocked.delete.mockResolvedValue({ data: { message: 'ok' } });
    await revokeSession('a b');
    expect(mocked.delete).toHaveBeenCalledWith('/api/account/sessions/a%20b', {
        headers: auth,
    });
});

it('revokes the other sessions', async () => {
    mocked.post.mockResolvedValue({ data: { revoked: 4 } });
    await expect(revokeOtherSessions()).resolves.toBe(4);
    expect(mocked.post).toHaveBeenCalledWith(
        '/api/account/sessions/revoke-others',
        {},
        { headers: auth }
    );
});

it('changes the password, skipping the interceptor retry', async () => {
    mocked.post.mockResolvedValue({ data: { message: 'ok', revoked: 1 } });
    const input = {
        currentPassword: 'old',
        newPassword: 'newnewnew',
        signOutOthers: true,
    };
    await expect(changePassword(input)).resolves.toEqual({
        message: 'ok',
        revoked: 1,
    });
    expect(mocked.post).toHaveBeenCalledWith('/api/account/password', input, {
        headers: auth,
        _retry: true,
    });
});
