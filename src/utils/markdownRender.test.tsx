/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react';
import React from 'react';
import { renderMarkdown } from './markdownRender';

const html = (text: string): string => {
    const { container } = render(<div>{renderMarkdown(text)}</div>);
    return container.innerHTML;
};

describe('renderMarkdown', () => {
    it('renders inline bold, italic and code', () => {
        const out = html('a **b** c *d* e `f`');
        expect(out).toContain('<strong>b</strong>');
        expect(out).toContain('<em>d</em>');
        expect(out).toContain('<code>f</code>');
    });

    it('renders safe links and leaves unsafe ones as text', () => {
        const safe = html('see [site](https://example.com)');
        expect(safe).toContain(
            '<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>'
        );

        const unsafe = html('bad [x](javascript:alert(1))');
        expect(unsafe).not.toContain('<a ');
        expect(unsafe).toContain('[x](javascript:alert(1))');
    });

    it('maps #/##/### to h3/h4/h5', () => {
        const out = html('# Titre\n## Sous\n### Petit');
        expect(out).toContain('<h3>Titre</h3>');
        expect(out).toContain('<h4>Sous</h4>');
        expect(out).toContain('<h5>Petit</h5>');
    });

    it('builds unordered and ordered lists', () => {
        const ul = html('- un\n- deux');
        expect(ul).toContain('<ul><li>un</li><li>deux</li></ul>');

        const ol = html('1. un\n2. deux');
        expect(ol).toContain('<ol><li>un</li><li>deux</li></ol>');
    });

    it('groups consecutive lines into a paragraph with line breaks', () => {
        const out = html('ligne un\nligne deux\n\nautre para');
        expect(out).toContain('<p>ligne un<br>ligne deux</p>');
        expect(out).toContain('<p>autre para</p>');
    });

    it('leaves [[mentions]] as plain text', () => {
        const out = html('voir [[Projet]]');
        expect(out).not.toContain('<a ');
        expect(out).toContain('[[Projet]]');
    });
});
