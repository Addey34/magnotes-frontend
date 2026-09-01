import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    BOARD_TEMPLATES,
    getBoardTemplates,
    WELCOME_TEMPLATE_ID,
} from '../src/constants/boardTemplates.ts';

const ORIGIN = 'https://magnotes.adrianguichard.dev';

const escapeHtml = (value = '') =>
    String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

const plainText = (value = '') => value.replace(/\[\[|\]\]|[*_`#]/g, '').trim();

const copy = {
    fr: {
        galleryTitle: 'Modèles de tableaux gratuits',
        galleryDescription:
            'Démarrez plus vite avec des tableaux MagNotes prêts à utiliser pour vos projets, contenus, ventes et clients.',
        eyebrow: 'Modèles MagNotes',
        cards: 'cartes',
        preview: 'Voir le modèle',
        use: 'Utiliser ce modèle gratuitement',
        try: 'Essayer MagNotes sans compte',
        back: 'Tous les modèles',
        included: 'Ce tableau contient',
        login: 'Se connecter',
        lang: 'English',
        locale: 'fr_FR',
        suffix: 'modèle de tableau gratuit',
    },
    en: {
        galleryTitle: 'Free board templates',
        galleryDescription:
            'Start faster with ready-to-use MagNotes boards for projects, content, sales and client work.',
        eyebrow: 'MagNotes templates',
        cards: 'cards',
        preview: 'View template',
        use: 'Use this template for free',
        try: 'Try MagNotes without an account',
        back: 'All templates',
        included: 'This board includes',
        login: 'Sign in',
        lang: 'Français',
        locale: 'en_US',
        suffix: 'free board template',
    },
};

const css = `
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#172033;background:#f6f7fb}*{box-sizing:border-box}body{margin:0}a{color:inherit}.wrap{width:min(1120px,calc(100% - 32px));margin:auto}.nav{height:72px;display:flex;align-items:center;justify-content:space-between}.brand{text-decoration:none;font-weight:900;font-size:21px}.brand span{margin-right:8px}.nav-links{display:flex;gap:10px;align-items:center}.btn{display:inline-flex;align-items:center;justify-content:center;padding:11px 17px;border-radius:12px;text-decoration:none;font-weight:800;border:1px solid #d9ddec;background:#fff}.btn-primary{color:#fff;background:#6757e8;border-color:#6757e8;box-shadow:0 8px 24px #6757e833}.hero{text-align:center;padding:64px 0 34px}.eyebrow{color:#6757e8;font-weight:900;text-transform:uppercase;letter-spacing:.12em;font-size:12px}.hero h1{font-size:clamp(36px,6vw,64px);line-height:1.02;max-width:850px;margin:15px auto}.hero p{font-size:18px;color:#5e6578;max-width:720px;margin:0 auto}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding:30px 0 72px}.template-card{background:#fff;border:1px solid #e2e5ef;border-radius:20px;padding:20px;text-decoration:none;box-shadow:0 8px 28px #2e36500d;transition:.2s transform,.2s box-shadow}.template-card:hover{transform:translateY(-3px);box-shadow:0 15px 35px #2e365018}.mini-board{height:210px;border-radius:14px;padding:12px;display:grid;grid-template-columns:repeat(2,1fr);gap:9px;overflow:hidden}.mini-note{padding:10px;border-radius:7px;box-shadow:0 3px 8px #26304c1b;font-size:11px;font-weight:800;overflow:hidden}.template-card h2{font-size:21px;margin:18px 0 7px}.template-card p{color:#646b7e;line-height:1.5;margin:0 0 14px}.meta{font-size:13px;font-weight:800;color:#6757e8}.detail{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:34px;align-items:start;padding:36px 0 80px}.board-preview{position:relative;min-height:620px;border-radius:24px;background:var(--board-bg,#fff);border:1px solid #dde1ec;box-shadow:0 20px 50px #252c4615;overflow:hidden}.note{position:absolute;width:220px;min-height:145px;padding:15px;border-radius:5px;box-shadow:0 7px 16px #26304c20;transform:translate(calc(var(--x) * .72px + 22px),calc(var(--y) * .72px + 22px));font-size:13px}.note h3{font-size:15px;margin:0 0 9px}.note p{margin:0;color:#30364a;line-height:1.4}.tags{margin-top:10px;font-size:11px;font-weight:800}.detail-copy{position:sticky;top:24px}.detail-copy h1{font-size:clamp(32px,4vw,50px);line-height:1.04;margin:14px 0}.lead{font-size:18px;line-height:1.6;color:#5e6578}.actions{display:grid;gap:10px;margin:25px 0}.actions .btn{width:100%}.detail-copy ul{padding-left:20px;color:#51586a;line-height:1.7}footer{border-top:1px solid #e0e3ed;padding:28px 0;color:#73798a;text-align:center}@media(max-width:850px){.grid{grid-template-columns:1fr 1fr}.detail{grid-template-columns:1fr}.detail-copy{position:static;order:-1}.board-preview{min-height:560px}.note{transform:translate(calc(var(--x) * .55px + 14px),calc(var(--y) * .7px + 18px));width:190px}}@media(max-width:560px){.grid{grid-template-columns:1fr}.nav .btn:not(.btn-primary){display:none}.hero{padding-top:38px}.board-preview{min-height:760px}.note{position:relative;transform:none!important;width:auto;min-height:0;margin:12px}.detail{padding-top:12px}}
`;

function pathFor(lang, suffix = '') {
    const prefix = lang === 'en' ? '/en' : '';
    return `${prefix}/templates/${suffix}`;
}

function shell({
    lang,
    title,
    description,
    canonical,
    alternate,
    body,
    schema,
    analytics,
}) {
    const c = copy[lang];
    const tracker =
        analytics?.src && analytics?.websiteId
            ? `<script defer src="${escapeHtml(analytics.src)}" data-website-id="${escapeHtml(analytics.websiteId)}"></script>`
            : '';
    return `<!doctype html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="index, follow"><link rel="canonical" href="${ORIGIN}${canonical}"><link rel="alternate" hreflang="${alternate.lang}" href="${ORIGIN}${alternate.path}"><meta property="og:type" content="website"><meta property="og:locale" content="${c.locale}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${ORIGIN}${canonical}"><meta property="og:image" content="${ORIGIN}/og-image.png"><style>${css}</style>${schema ? `<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>` : ''}${tracker}</head><body><header><div class="wrap nav"><a class="brand" href="/"><span>🧲</span>MagNotes</a><nav class="nav-links"><a class="btn" href="${alternate.path}">${c.lang}</a><a class="btn btn-primary" href="/app/">${c.login}</a></nav></div></header><main>${body}</main><footer>© 2026 MagNotes · ${c.galleryTitle}</footer></body></html>`;
}

function miniBoard(template) {
    return `<div class="mini-board" style="background:${escapeHtml(template.background || '#f4f6f9')}">${template.cards
        .slice(0, 6)
        .map(
            (card) =>
                `<div class="mini-note" style="background:${escapeHtml(card.color || '#fef08a')}">${escapeHtml(card.title)}</div>`
        )
        .join('')}</div>`;
}

function galleryPage(lang, templates, analytics) {
    const c = copy[lang];
    const canonical = pathFor(lang);
    const otherLang = lang === 'fr' ? 'en' : 'fr';
    const cards = templates
        .map(
            (template) =>
                `<a class="template-card" href="${pathFor(lang, `${template.id}/`)}">${miniBoard(template)}<h2>${escapeHtml(template.label)}</h2><p>${escapeHtml(template.description)}</p><span class="meta">${template.cards.length} ${c.cards} · ${c.preview} →</span></a>`
        )
        .join('');
    const body = `<section class="wrap hero"><div class="eyebrow">${c.eyebrow}</div><h1>${c.galleryTitle}</h1><p>${c.galleryDescription}</p></section><section class="wrap grid">${cards}</section>`;
    return shell({
        lang,
        title: `${c.galleryTitle} | MagNotes`,
        description: c.galleryDescription,
        canonical,
        alternate: { lang: otherLang, path: pathFor(otherLang) },
        body,
        analytics,
        schema: {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: c.galleryTitle,
            url: `${ORIGIN}${canonical}`,
        },
    });
}

function detailPage(lang, template, analytics) {
    const c = copy[lang];
    const otherLang = lang === 'fr' ? 'en' : 'fr';
    const canonical = pathFor(lang, `${template.id}/`);
    const preview = template.cards
        .map(
            (card) =>
                `<article class="note" style="--x:${card.x};--y:${card.y};background:${escapeHtml(card.color || '#fef08a')}"><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(plainText(card.content))}</p>${card.tags?.length ? `<div class="tags">${card.tags.map((tag) => `#${escapeHtml(tag)}`).join(' ')}</div>` : ''}</article>`
        )
        .join('');
    const list = template.cards
        .map((card) => `<li>${escapeHtml(card.title)}</li>`)
        .join('');
    const body = `<div class="wrap"><a href="${pathFor(lang)}">← ${c.back}</a><section class="detail"><div class="board-preview" style="--board-bg:${escapeHtml(template.background || '#f4f6f9')}">${preview}</div><div class="detail-copy"><div class="eyebrow">${c.eyebrow}</div><h1>${escapeHtml(template.label)}</h1><p class="lead">${escapeHtml(template.description)}</p><div class="actions"><a class="btn btn-primary" href="/app/?demo=1&amp;template=${encodeURIComponent(template.id)}">${c.use}</a><a class="btn" href="/app/?demo=1">${c.try}</a></div><h2>${c.included}</h2><ul>${list}</ul></div></section></div>`;
    const title = `${template.label} — ${c.suffix} | MagNotes`;
    return shell({
        lang,
        title,
        description: template.description,
        canonical,
        alternate: {
            lang: otherLang,
            path: pathFor(otherLang, `${template.id}/`),
        },
        body,
        analytics,
        schema: {
            '@context': 'https://schema.org',
            '@type': 'CreativeWork',
            name: template.label,
            description: template.description,
            url: `${ORIGIN}${canonical}`,
            isAccessibleForFree: true,
        },
    });
}

function writePage(out, urlPath, html) {
    const directory = resolve(out, `.${urlPath}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'index.html'), html);
}

export async function buildTemplateGallery(out, analytics = {}) {
    const localized = {
        fr: BOARD_TEMPLATES.filter(
            (template) => template.id !== WELCOME_TEMPLATE_ID
        ),
        en: getBoardTemplates('en').filter(
            (template) => template.id !== WELCOME_TEMPLATE_ID
        ),
    };
    for (const lang of ['fr', 'en']) {
        writePage(
            out,
            pathFor(lang),
            galleryPage(lang, localized[lang], analytics)
        );
        for (const template of localized[lang]) {
            writePage(
                out,
                pathFor(lang, `${template.id}/`),
                detailPage(lang, template, analytics)
            );
        }
    }
    const urls = ['/', '/en/', '/templates/', '/en/templates/'];
    for (const lang of ['fr', 'en']) {
        for (const template of localized[lang]) {
            urls.push(pathFor(lang, `${template.id}/`));
        }
    }
    // Home pages (FR/EN) rank highest, gallery indexes next, template detail
    // pages last — based on URL shape rather than array position, so adding
    // more localized entries above can't silently mis-rank later ones.
    const priorityFor = (url) => {
        if (url === '/' || url === '/en/') return '1.0';
        if (url.endsWith('/templates/')) return '0.9';
        return '0.8';
    };
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map(
            (url) =>
                `  <url><loc>${ORIGIN}${url}</loc><changefreq>weekly</changefreq><priority>${priorityFor(url)}</priority></url>`
        )
        .join('\n')}\n</urlset>\n`;
    writeFileSync(resolve(out, 'sitemap.xml'), sitemap);
}
