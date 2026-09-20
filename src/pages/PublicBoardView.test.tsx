/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LangProvider } from '../i18n/LangContext';
import { fetchPublicBoard } from '../services/boardApi';
import PublicBoardView from './PublicBoardView';

jest.mock('../services/boardApi', () => ({
    fetchPublicBoard: jest.fn(),
}));

const mockedFetchPublicBoard = fetchPublicBoard as jest.MockedFunction<
    typeof fetchPublicBoard
>;

function renderView() {
    return render(
        <LangProvider>
            <PublicBoardView token="test" />
        </LangProvider>
    );
}

describe('PublicBoardView loading failures', () => {
    beforeEach(() => {
        mockedFetchPublicBoard.mockReset();
    });

    it('does not report an API outage as an invalid share link', async () => {
        mockedFetchPublicBoard.mockRejectedValue(new Error('offline'));

        renderView();

        expect(
            await screen.findByRole('heading', {
                name: /Impossible de charger ce tableau|Unable to load this board/i,
            })
        ).toBeTruthy();
        expect(
            screen.queryByText(
                /Le lien de partage est invalide|The share link is invalid/i
            )
        ).toBeNull();
    });

    it('retries a failed request without reloading the page', async () => {
        mockedFetchPublicBoard
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(null);

        renderView();

        const retry = await screen.findByRole('button', {
            name: /Réessayer|Try again/i,
        });
        fireEvent.click(retry);

        await waitFor(() => {
            expect(mockedFetchPublicBoard).toHaveBeenCalledTimes(2);
        });
        expect(
            await screen.findByRole('heading', {
                name: /Ce tableau n’est pas disponible|This board is not available/i,
            })
        ).toBeTruthy();
    });
});
