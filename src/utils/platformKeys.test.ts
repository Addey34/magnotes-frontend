import { isApplePlatform, paletteShortcutLabel } from './platformKeys';

describe('paletteShortcutLabel', () => {
    it('shows ⌘K on Apple platforms', () => {
        expect(paletteShortcutLabel({ platform: 'MacIntel' })).toBe('⌘K');
        expect(
            paletteShortcutLabel({ userAgentData: { platform: 'macOS' } })
        ).toBe('⌘K');
        expect(paletteShortcutLabel({ platform: 'iPhone' })).toBe('⌘K');
    });

    it('shows Ctrl K everywhere else', () => {
        expect(paletteShortcutLabel({ platform: 'Win32' })).toBe('Ctrl K');
        expect(
            paletteShortcutLabel({ userAgentData: { platform: 'Windows' } })
        ).toBe('Ctrl K');
        expect(paletteShortcutLabel({ platform: 'Linux x86_64' })).toBe(
            'Ctrl K'
        );
        expect(paletteShortcutLabel({})).toBe('Ctrl K');
    });

    it('prefers userAgentData over the legacy platform string', () => {
        expect(
            isApplePlatform({
                platform: 'MacIntel',
                userAgentData: { platform: 'Windows' },
            })
        ).toBe(false);
    });
});
