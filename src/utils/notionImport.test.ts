import { parseCsvRows, parseNotionCsv } from './notionImport';

describe('Notion CSV import', () => {
    it('parses quoted commas, escaped quotes and multiline cells', () => {
        expect(parseCsvRows('Name,Notes\n"A, B","Line 1\nLine ""2"""')).toEqual(
            [
                ['Name', 'Notes'],
                ['A, B', 'Line 1\nLine "2"'],
            ]
        );
    });

    it('maps common Notion database properties to card fields', () => {
        const cards = parseNotionCsv(
            '\uFEFFName,Description,Status,Due date,Tags\n' +
                'Prepare launch,"Copy, screenshots",In progress,2026-09-04,"marketing, urgent"\n' +
                'Published,Done,Complete,2026-09-01,release'
        );
        expect(cards).toEqual([
            {
                title: 'Prepare launch',
                content: 'Copy, screenshots',
                status: 'doing',
                dueDate: '2026-09-04',
                tags: ['marketing', 'urgent'],
                checklist: [],
            },
            {
                title: 'Published',
                content: 'Done',
                status: 'done',
                dueDate: '2026-09-01',
                tags: ['release'],
                checklist: [],
            },
        ]);
    });

    it('supports French headers and ignores unsafe date formats', () => {
        expect(
            parseNotionCsv(
                'Titre,Contenu,Statut,Échéance,Étiquettes\nTâche,Texte,À faire,04/09/2026,"client; important"'
            )
        ).toEqual([
            {
                title: 'Tâche',
                content: 'Texte',
                status: 'todo',
                tags: ['client', 'important'],
                checklist: [],
            },
        ]);
    });

    it('uses the first column as title and drops empty records', () => {
        expect(parseNotionCsv('Custom property,Other\nAlpha,x\n,')).toEqual([
            {
                title: 'Alpha',
                content: '',
                tags: [],
                checklist: [],
            },
        ]);
    });
});
