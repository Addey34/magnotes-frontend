/**
 * Keyboard hint for the command palette. The palette opens with Ctrl+K and
 * ⌘K, but the top bar always printed "⌘K", which reads as a Mac-only shortcut
 * on Windows, Linux and ChromeOS.
 */
type NavigatorLike = {
    platform?: string;
    userAgent?: string;
    userAgentData?: { platform?: string };
};

export function isApplePlatform(nav?: NavigatorLike): boolean {
    const source =
        nav ?? (typeof navigator === 'undefined' ? undefined : navigator);
    if (!source) return false;
    const platform =
        (source as NavigatorLike).userAgentData?.platform ||
        source.platform ||
        source.userAgent ||
        '';
    return /mac|iphone|ipad|ipod|ios/i.test(platform);
}

export function paletteShortcutLabel(nav?: NavigatorLike): string {
    return isApplePlatform(nav) ? '⌘K' : 'Ctrl K';
}
