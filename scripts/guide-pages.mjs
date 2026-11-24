import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shell } from './build-template-gallery.mjs';

/**
 * Acquisition guides: a small set of indexable pages that answer a specific
 * search intent MagNotes really serves, each with a direct link to the demo.
 * Everything stated here is checked against the code (see
 * src/utils/trelloImport.ts, notionImport.ts, markdownImport.ts,
 * importLimits.ts and the demo mode) — keep them in sync.
 *
 * `blocks` use trusted, authored HTML (links, <strong>); nothing user-supplied.
 */

const ORIGIN = 'https://magnotes.adrianguichard.dev';

export const GUIDES = [
    {
        id: 'import-trello',
        fr: {
            path: '/importer-trello/',
            nav: 'Importer depuis Trello',
            title: 'Importer un tableau Trello en post-its | MagNotes',
            description:
                'Exportez votre tableau Trello en JSON et retrouvez chaque carte en post-it : description, étiquettes, échéance et checklists conservées. Gratuit, essai sans compte.',
            h1: 'Importer un tableau Trello en post-its',
            lead: 'Vous avez un tableau Trello et vous voulez le voir autrement, sur un grand plateau libre ? Exportez-le en JSON : chaque carte devient un post-it, rangé en colonnes comme dans Trello.',
            cta: 'Essayer MagNotes sans compte',
            ctaNote:
                'Aucune inscription : la démo s’ouvre tout de suite, vos notes restent dans votre navigateur.',
            blocks: [
                { h2: 'En trois étapes' },
                {
                    ol: [
                        'Dans Trello, ouvrez le menu du tableau, puis « Imprimer, exporter et partager » et « Exporter au format JSON » (l’intitulé peut varier selon la version). Enregistrez le fichier.',
                        'Ouvrez MagNotes (la démo suffit pour voir le résultat), puis le menu de la marque en haut à gauche et « Importer ».',
                        'Choisissez le fichier JSON. Le tableau apparaît, une colonne par liste Trello, prêt à être déplacé, empilé ou regroupé.',
                    ],
                },
                { h2: 'Ce qui est repris' },
                {
                    ul: [
                        '<strong>Titre et description</strong> de chaque carte ouverte.',
                        '<strong>Étiquettes</strong> : elles deviennent des tags.',
                        '<strong>Date d’échéance</strong> : conservée au jour près (dans votre fuseau horaire).',
                        '<strong>Checklists</strong> : les éléments sont fusionnés dans la carte, avec leur état coché ou non.',
                        '<strong>Listes</strong> : une colonne par liste ouverte, dans le même ordre. Une liste nommée « À faire », « En cours » ou « Terminé » (ou To do, Doing, Done) donne aussi son statut aux cartes.',
                    ],
                },
                { h2: 'Ce qui ne l’est pas' },
                {
                    ul: [
                        'Les cartes et listes <strong>archivées</strong> sont ignorées.',
                        'Pas de pièces jointes, de commentaires ni d’historique d’activité : l’import reprend le contenu des cartes.',
                        'Limites par import : <strong>1 Mo</strong> par fichier et <strong>100 cartes</strong>. Au-delà, l’import est refusé avec un message clair : découpez le tableau en plusieurs fichiers.',
                    ],
                },
                { h2: 'Et depuis Notion ou un fichier Markdown ?' },
                {
                    p: 'Le même menu accepte un export <strong>CSV de Notion</strong> (colonnes nom ou titre, description, statut, échéance, tags reconnues, en français ou en anglais) et des fichiers <strong>Markdown</strong> (.md, .txt) : chaque titre devient une carte, les lignes <code>- [ ]</code> deviennent une checklist.',
                },
                { h2: 'Questions fréquentes' },
                {
                    faq: [
                        [
                            'Mon tableau Trello est-il modifié ?',
                            'Non. MagNotes lit le fichier que vous lui donnez ; rien n’est envoyé à Trello et rien n’y est changé.',
                        ],
                        [
                            'Dois-je créer un compte pour essayer ?',
                            'Non. La démo fonctionne sans compte, dans votre navigateur. Si vous créez un compte ensuite, vos notes de la démo peuvent être conservées.',
                        ],
                        [
                            'Puis-je récupérer mes notes si je pars ?',
                            'Oui : export en Markdown ou en JSON complet depuis l’application, et suppression du compte avec toutes vos données, sans demande à faire.',
                        ],
                    ],
                },
            ],
        },
        en: {
            path: '/en/import-trello/',
            nav: 'Import from Trello',
            title: 'Import a Trello board as sticky notes | MagNotes',
            description:
                'Export your Trello board as JSON and get every card back as a sticky note: description, labels, due date and checklists kept. Free, try without an account.',
            h1: 'Import a Trello board as sticky notes',
            lead: 'Want to see your Trello board differently, on a large free canvas? Export it as JSON: every card becomes a sticky note, laid out in columns just like in Trello.',
            cta: 'Try MagNotes without an account',
            ctaNote:
                'No sign-up: the demo opens right away and your notes stay in your browser.',
            blocks: [
                { h2: 'Three steps' },
                {
                    ol: [
                        'In Trello, open the board menu, then “Print, export, and share” and “Export as JSON” (the wording can vary by version). Save the file.',
                        'Open MagNotes (the demo is enough to see the result), then the brand menu at the top left and “Import”.',
                        'Pick the JSON file. The board appears, one column per Trello list, ready to move, stack or group.',
                    ],
                },
                { h2: 'What comes across' },
                {
                    ul: [
                        '<strong>Title and description</strong> of every open card.',
                        '<strong>Labels</strong>: they become tags.',
                        '<strong>Due date</strong>: kept to the day (in your time zone).',
                        '<strong>Checklists</strong>: items are merged into the card, with their checked state.',
                        '<strong>Lists</strong>: one column per open list, in the same order. A list named “To do”, “Doing” or “Done” (or the French equivalents) also sets the card status.',
                    ],
                },
                { h2: 'What does not' },
                {
                    ul: [
                        '<strong>Archived</strong> cards and lists are skipped.',
                        'No attachments, comments or activity history: the import brings the content of the cards.',
                        'Limits per import: <strong>1 MB</strong> per file and <strong>100 cards</strong>. Above that the import is refused with a clear message: split the board into several files.',
                    ],
                },
                { h2: 'What about Notion or Markdown files?' },
                {
                    p: 'The same menu accepts a <strong>Notion CSV</strong> export (name or title, description, status, due date and tags columns are recognised, in English or French) and <strong>Markdown</strong> files (.md, .txt): each heading becomes a card and <code>- [ ]</code> lines become a checklist.',
                },
                { h2: 'Frequently asked questions' },
                {
                    faq: [
                        [
                            'Is my Trello board changed?',
                            'No. MagNotes reads the file you give it; nothing is sent to Trello and nothing is changed there.',
                        ],
                        [
                            'Do I need an account to try it?',
                            'No. The demo works without an account, in your browser. If you create an account afterwards, your demo notes can be kept.',
                        ],
                        [
                            'Can I take my notes with me if I leave?',
                            'Yes: export to Markdown or full JSON from the app, and delete your account with all your data, no request needed.',
                        ],
                    ],
                },
            ],
        },
    },
    {
        id: 'online-sticky-notes',
        fr: {
            path: '/post-it-en-ligne/',
            nav: 'Post-it en ligne',
            title: 'Post-it en ligne gratuit, sans compte | MagNotes',
            description:
                'Un plateau infini de post-its dans votre navigateur : piles, checklists, échéances, vues Kanban et Timeline. Essai immédiat sans inscription, gratuit.',
            h1: 'Post-it en ligne gratuit, sans compte',
            lead: 'Posez vos idées comme des post-its sur un grand plateau libre, regroupez-les, puis passez en vue Kanban ou calendrier quand elles deviennent des tâches. Ça s’ouvre en une seconde, sans inscription.',
            cta: 'Ouvrir le plateau de démo',
            ctaNote:
                'Gratuit, sans compte. La démo reste dans votre navigateur.',
            blocks: [
                { h2: 'Essayez en 30 secondes' },
                {
                    ol: [
                        'Ouvrez la démo : un tableau d’exemple vous attend.',
                        'Créez un post-it, glissez-le où vous voulez, changez sa couleur.',
                        'Empilez-en plusieurs, ajoutez une checklist ou une échéance, puis changez de vue.',
                    ],
                },
                { h2: 'Ce que vous pouvez faire' },
                {
                    ul: [
                        '<strong>Plateau infini</strong> : déplacez, zoomez, rangez par piles.',
                        '<strong>Quatre vues</strong> du même contenu, dont Kanban et Timeline.',
                        '<strong>Cartes riches</strong> : Markdown, checklists, échéances, tags, images.',
                        '<strong>Liens entre notes</strong> : tapez <code>[[</code> pour relier une carte à une autre.',
                        '<strong>Modèles prêts à l’emploi</strong> : <a href="/templates/">projet client, calendrier éditorial, revue hebdomadaire, pipeline commercial</a>.',
                        '<strong>Import</strong> depuis <a href="/importer-trello/">Trello, Notion ou Markdown</a>.',
                    ],
                },
                { h2: 'Où vont vos notes ?' },
                {
                    p: 'En démo, vos notes restent dans votre navigateur : elles ne sont pas envoyées à un serveur. Si vous videz les données du site, la démo est effacée. Pour retrouver vos notes sur tous vos appareils, créez un compte gratuit : les notes de la démo peuvent alors être conservées. Vous pouvez exporter en Markdown ou JSON et supprimer votre compte à tout moment.',
                },
                { h2: 'Questions fréquentes' },
                {
                    faq: [
                        [
                            'Faut-il s’inscrire ?',
                            'Non pour essayer. Un compte n’est utile que pour retrouver vos notes sur plusieurs appareils.',
                        ],
                        [
                            'Est-ce adapté au téléphone ?',
                            'Oui, l’interface est conçue pour le tactile : déplacement au doigt, panneaux de style en bas d’écran.',
                        ],
                        [
                            'En quoi est-ce différent d’un tableau blanc collaboratif ?',
                            'MagNotes vise le travail individuel d’un freelance ou d’un pro : peu de réglages, des vues de planification intégrées (Kanban, Timeline) et aucune collaboration à gérer.',
                        ],
                    ],
                },
            ],
        },
        en: {
            path: '/en/online-sticky-notes/',
            nav: 'Online sticky notes',
            title: 'Free online sticky notes, no account | MagNotes',
            description:
                'An infinite board of sticky notes in your browser: stacks, checklists, due dates, Kanban and Timeline views. Try instantly without signing up, free.',
            h1: 'Free online sticky notes, no account needed',
            lead: 'Drop your ideas as sticky notes on a large free canvas, group them, then switch to a Kanban or calendar view when they turn into tasks. It opens in a second, with no sign-up.',
            cta: 'Open the demo board',
            ctaNote: 'Free, no account. The demo stays in your browser.',
            blocks: [
                { h2: 'Try it in 30 seconds' },
                {
                    ol: [
                        'Open the demo: a sample board is waiting.',
                        'Create a sticky note, drag it anywhere, change its colour.',
                        'Stack a few, add a checklist or a due date, then switch view.',
                    ],
                },
                { h2: 'What you can do' },
                {
                    ul: [
                        '<strong>Infinite canvas</strong>: pan, zoom, tidy into stacks.',
                        '<strong>Four views</strong> of the same content, including Kanban and Timeline.',
                        '<strong>Rich cards</strong>: Markdown, checklists, due dates, tags, images.',
                        '<strong>Links between notes</strong>: type <code>[[</code> to connect one card to another.',
                        '<strong>Ready-made templates</strong>: <a href="/en/templates/">client project, content calendar, weekly review, sales pipeline</a>.',
                        '<strong>Import</strong> from <a href="/en/import-trello/">Trello, Notion or Markdown</a>.',
                    ],
                },
                { h2: 'Where do your notes go?' },
                {
                    p: 'In the demo your notes stay in your browser: they are not sent to a server. If you clear the site data, the demo is erased. To get your notes on all your devices, create a free account: your demo notes can then be kept. You can export to Markdown or JSON and delete your account at any time.',
                },
                { h2: 'Frequently asked questions' },
                {
                    faq: [
                        [
                            'Do I have to sign up?',
                            'Not to try it. An account only matters if you want your notes on several devices.',
                        ],
                        [
                            'Does it work on a phone?',
                            'Yes, the interface is built for touch: drag with your finger, style panels at the bottom of the screen.',
                        ],
                        [
                            'How is it different from a collaborative whiteboard?',
                            'MagNotes is aimed at the individual work of a freelancer or professional: few settings, built-in planning views (Kanban, Timeline) and no collaboration to manage.',
                        ],
                    ],
                },
            ],
        },
    },
];

export const guidePath = (lang, guide) => guide[lang].path;

const escapeHtml = (value = '') =>
    String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');

const stripTags = (value) => value.replace(/<[^>]+>/g, '');

const guideCss = `
.guide{max-width:760px;margin:auto;padding:46px 0 72px}.guide .eyebrow{margin-bottom:6px}.guide h1{font-size:clamp(32px,5vw,48px);line-height:1.08;margin:6px 0 14px}.guide .lead{font-size:19px;line-height:1.6;color:var(--gallery-muted)}.guide h2{font-size:24px;margin:40px 0 10px}.guide p,.guide li{line-height:1.7;font-size:17px}.guide ul,.guide ol{padding-left:22px}.guide li{margin:6px 0}.guide code{background:#6757e81f;padding:1px 6px;border-radius:5px}.guide .cta-box{margin:26px 0 8px}.guide .cta-box .btn{font-size:17px;padding:14px 22px}.guide .cta-note{margin:10px 0 0;font-size:15px;color:var(--gallery-muted)}.guide a:not(.btn){color:var(--gallery-accent);text-underline-offset:3px}.faq details{border:1px solid var(--gallery-line);border-radius:12px;padding:12px 16px;margin:10px 0;background:var(--gallery-panel)}.faq summary{cursor:pointer;font-weight:800;min-height:24px}.faq details p{margin:10px 0 2px}.related{margin-top:40px;padding-top:20px;border-top:1px solid var(--gallery-line)}.related a{display:inline-block;margin:6px 14px 0 0}
`;

function renderBlocks(blocks) {
    return blocks
        .map((block) => {
            if (block.h2) return `<h2>${escapeHtml(block.h2)}</h2>`;
            if (block.p) return `<p>${block.p}</p>`;
            if (block.ul)
                return `<ul>${block.ul.map((i) => `<li>${i}</li>`).join('')}</ul>`;
            if (block.ol)
                return `<ol>${block.ol.map((i) => `<li>${i}</li>`).join('')}</ol>`;
            if (block.faq)
                return `<div class="faq">${block.faq
                    .map(
                        ([q, a]) =>
                            `<details><summary>${escapeHtml(q)}</summary><p>${a}</p></details>`
                    )
                    .join('')}</div>`;
            return '';
        })
        .join('');
}

function guidePage(lang, guide, analytics) {
    const page = guide[lang];
    const otherLang = lang === 'fr' ? 'en' : 'fr';
    const other =
        guide.id === 'import-trello' ? 'online-sticky-notes' : 'import-trello';
    const sibling = GUIDES.find((g) => g.id === other);
    const templatesPath = lang === 'en' ? '/en/templates/' : '/templates/';
    const eyebrow = lang === 'en' ? 'MagNotes guide' : 'Guide MagNotes';
    const related = lang === 'en' ? 'Keep exploring' : 'Pour aller plus loin';
    const templatesLabel =
        lang === 'en' ? 'Free board templates' : 'Modèles de tableaux gratuits';
    const faqBlock = page.blocks.find((b) => b.faq);
    const faqSchema = faqBlock && {
        '@type': 'FAQPage',
        mainEntity: faqBlock.faq.map(([q, a]) => ({
            '@type': 'Question',
            name: q,
            acceptedAnswer: { '@type': 'Answer', text: stripTags(a) },
        })),
    };
    const cta = `<div class="cta-box"><a class="btn btn-primary" href="/app/?demo=1&amp;lang=${lang}" data-umami-event="guide_demo_started" data-umami-event-guide="${guide.id}">${escapeHtml(page.cta)}</a><p class="cta-note">${escapeHtml(page.ctaNote)}</p></div>`;
    const body = `<article class="wrap guide"><div class="eyebrow">${eyebrow}</div><h1>${escapeHtml(page.h1)}</h1><p class="lead">${escapeHtml(page.lead)}</p>${cta}${renderBlocks(page.blocks)}${cta}<nav class="related" aria-label="${related}"><strong>${related}</strong><br><a href="${sibling[lang].path}">${escapeHtml(sibling[lang].nav)}</a><a href="${templatesPath}">${templatesLabel}</a></nav></article>`;
    return shell({
        lang,
        title: page.title,
        description: page.description,
        canonical: page.path,
        alternate: { lang: otherLang, path: guide[otherLang].path },
        body,
        analytics,
        extraCss: guideCss,
        schema: {
            '@context': 'https://schema.org',
            '@graph': [
                {
                    '@type': 'WebPage',
                    name: page.h1,
                    description: page.description,
                    url: `${ORIGIN}${page.path}`,
                    inLanguage: lang,
                },
                ...(faqSchema ? [faqSchema] : []),
            ],
        },
    });
}

export async function buildGuidePages(out, analytics = {}) {
    for (const guide of GUIDES) {
        for (const lang of ['fr', 'en']) {
            const directory = resolve(out, `.${guide[lang].path}`);
            mkdirSync(directory, { recursive: true });
            writeFileSync(
                resolve(directory, 'index.html'),
                guidePage(lang, guide, analytics)
            );
        }
    }
}
