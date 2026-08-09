/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import React, { useRef } from 'react';
import { useFocusTrap } from './useFocusTrap';

const Trap = () => {
    const dialogRef = useRef<HTMLDivElement | null>(null);
    useFocusTrap(true, dialogRef);
    return (
        <div ref={dialogRef} role="dialog">
            <button type="button">First</button>
            <button type="button">Last</button>
        </div>
    );
};

describe('useFocusTrap', () => {
    it('wraps focus at both ends and restores the opener', () => {
        const opener = document.createElement('button');
        opener.textContent = 'Open';
        document.body.appendChild(opener);
        opener.focus();

        const { unmount } = render(<Trap />);
        const first = screen.getByRole('button', { name: 'First' });
        const last = screen.getByRole('button', { name: 'Last' });

        last.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(first).toHaveFocus();

        first.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(last).toHaveFocus();

        unmount();
        expect(opener).toHaveFocus();
        opener.remove();
    });
});
