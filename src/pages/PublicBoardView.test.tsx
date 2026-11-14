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

describe('PublicBoardView card fidelity', () => {
    it('keeps the finish, rotation and font the owner chose', async () => {
        mockedFetchPublicBoard.mockReset();
        mockedFetchPublicBoard.mockResolvedValue({
            tab: { _id: 't', name: 'Shared' },
            postIts: [
                {
                    _id: 'c1',
                    x: 0,
                    y: 0,
                    width: 200,
                    height: 100,
                    title: 'Styled',
                    content: '',
                    color: '#fde68a',
                    finish: 'glass',
                    rotation: 12,
                    fontFamily: 'Georgia',
                },
                {
                    _id: 'c2',
                    x: 300,
                    y: 0,
                    width: 200,
                    height: 100,
                    title: 'Plain',
                    content: '',
                    color: '#fde68a',
                },
            ],
            stacks: [],
            connections: [],
        } as never);

        const { container } = renderView();
        await screen.findByText('Styled');

        const [styled, plain] = Array.from(
            container.querySelectorAll<HTMLElement>('.public-card')
        );
        expect(styled.classList.contains('finish-glass')).toBe(true);
        expect(styled.style.transform).toBe('rotate(12deg)');
        expect(styled.style.fontFamily).toContain('Georgia');
        expect(plain.classList.contains('finish-flat')).toBe(true);
        expect(plain.style.transform).toBe('');
    });
});
