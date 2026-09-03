import type { ChecklistItem, PostItStatus } from '../types/boardTypes';
import type { Lang } from '../i18n/i18n';

export interface BoardTemplateCard {
    title: string;
    content: string;
    color?: string;
    x: number;
    y: number;
    status?: PostItStatus;
    checklist?: ChecklistItem[];
    tags?: string[];
}

export interface BoardTemplate {
    id: string;
    label: string;
    description: string;
    background?: string;
    cards: BoardTemplateCard[];
}

// Seeded on a brand-new account's first board (see the onboarding effect in
// BoardApp); also available from the palette like any other template.
export const WELCOME_TEMPLATE_ID = 'welcome';

export const BOARD_TEMPLATES: BoardTemplate[] = [
    {
        id: WELCOME_TEMPLATE_ID,
        label: 'Bienvenue',
        description:
            'Le tableau de démarrage : apprenez MagNotes par l’exemple en manipulant ces cartes.',
        cards: [
            {
                title: 'Bienvenue sur MagNotes 👋',
                content:
                    'Ce tableau est à vous. **Double-cliquez** sur le fond pour créer un post-it, glissez-le pour le déplacer, attrapez un coin pour le redimensionner.',
                color: '#fef08a',
                x: 0,
                y: 0,
            },
            {
                title: 'Empilez et accolez',
                content:
                    'Déposez une carte **au centre** d’une autre pour créer une pile. Déposez-la **sur un bord** pour les accoler proprement.',
                color: '#bae6fd',
                x: 284,
                y: 0,
            },
            {
                title: 'Ctrl+K ouvre la palette',
                content:
                    'Recherche sur tous vos tableaux, capture rapide d’une note, changement de vue, insertion de modèles : tout est à un raccourci.',
                color: '#e9d5ff',
                x: 568,
                y: 0,
            },
            {
                title: 'Une vraie carte de travail',
                content:
                    'Statut, priorité, échéance, tags et checklist : chaque post-it peut devenir une tâche. Cochez la case ci-dessous 👇',
                color: '#bbf7d0',
                x: 0,
                y: 214,
                status: 'doing',
                tags: ['exemple'],
                checklist: [
                    {
                        id: 'welcome-try',
                        text: 'Découvrir MagNotes',
                        done: true,
                    },
                    {
                        id: 'welcome-check',
                        text: 'Cocher cette case',
                        done: false,
                    },
                ],
            },
            {
                title: 'Reliez vos idées',
                content:
                    'Citez une carte avec [[Bienvenue sur MagNotes 👋]]. Elle devient cliquable sous cette carte. Le bouton lien crée aussi des flèches entre cartes.',
                color: '#fbcfe8',
                x: 284,
                y: 214,
            },
            {
                title: 'Changez de vue',
                content:
                    'En haut : **Kanban** (colonnes par statut), **Agenda** (par échéance) et **Planning** (frise). Les mêmes cartes, projetées autrement.',
                color: '#fed7aa',
                x: 568,
                y: 214,
            },
        ],
    },
    {
        id: 'client-project',
        label: 'Projet client',
        description:
            'Cadrez une mission, suivez les livrables et centralisez les retours du client.',
        background: '#f8fafc',
        cards: [
            {
                title: 'Brief et objectifs',
                content:
                    'Résultat attendu, public cible, contraintes et critères de réussite.',
                color: '#bae6fd',
                x: 0,
                y: 0,
                status: 'doing',
                tags: ['client', 'cadrage'],
                checklist: [
                    {
                        id: 'brief-scope',
                        text: 'Valider le périmètre',
                        done: false,
                    },
                    {
                        id: 'brief-stakeholders',
                        text: 'Identifier les décideurs',
                        done: false,
                    },
                ],
            },
            {
                title: 'Prochaines étapes',
                content:
                    'Les trois actions qui débloquent le projet cette semaine.',
                color: '#fef08a',
                x: 284,
                y: 0,
                status: 'todo',
                tags: ['priorité'],
            },
            {
                title: 'Livrables',
                content: 'Liste des éléments à produire et à faire valider.',
                color: '#e9d5ff',
                x: 568,
                y: 0,
                status: 'todo',
                tags: ['production'],
                checklist: [
                    {
                        id: 'deliverable-v1',
                        text: 'Envoyer la version 1',
                        done: false,
                    },
                    {
                        id: 'deliverable-final',
                        text: 'Livrer les fichiers finaux',
                        done: false,
                    },
                ],
            },
            {
                title: 'Retours client',
                content:
                    'Décisions, demandes de modification et points à clarifier.',
                color: '#fecdd3',
                x: 0,
                y: 214,
                tags: ['feedback'],
            },
            {
                title: 'Budget et temps',
                content:
                    'Budget prévu, temps consommé et éventuels changements de périmètre.',
                color: '#fdba74',
                x: 284,
                y: 214,
                tags: ['pilotage'],
            },
            {
                title: 'Validé',
                content: 'Déplacez ici les éléments approuvés par le client.',
                color: '#bbf7d0',
                x: 568,
                y: 214,
                status: 'done',
                tags: ['validé'],
            },
        ],
    },
    {
        id: 'content-calendar',
        label: 'Calendrier de contenu',
        description:
            'Transformez vos idées en contenus publiés avec un flux éditorial simple.',
        background: '#fffaf0',
        cards: [
            {
                title: 'Piliers éditoriaux',
                content:
                    'Expertise, coulisses, cas client et point de vue personnel.',
                color: '#e9d5ff',
                x: 0,
                y: 0,
                tags: ['stratégie'],
            },
            {
                title: 'Idées à explorer',
                content:
                    'Questions fréquentes, objections clients et sujets observés cette semaine.',
                color: '#fef08a',
                x: 284,
                y: 0,
                status: 'todo',
                tags: ['idée'],
                checklist: [
                    {
                        id: 'idea-angle',
                        text: 'Choisir un angle précis',
                        done: false,
                    },
                    {
                        id: 'idea-format',
                        text: 'Choisir le format',
                        done: false,
                    },
                ],
            },
            {
                title: 'En rédaction',
                content:
                    'Accroche, message principal, preuve et appel à l’action.',
                color: '#bae6fd',
                x: 568,
                y: 0,
                status: 'doing',
                tags: ['rédaction'],
            },
            {
                title: 'À programmer',
                content:
                    'Contenus relus qui attendent une date et un canal de publication.',
                color: '#fdba74',
                x: 284,
                y: 214,
                status: 'todo',
                tags: ['planning'],
            },
            {
                title: 'Publié',
                content:
                    'Archivez ici les contenus en ligne et notez leurs résultats.',
                color: '#bbf7d0',
                x: 568,
                y: 214,
                status: 'done',
                tags: ['publié', 'mesure'],
            },
        ],
    },
    {
        id: 'weekly-review',
        label: 'Revue hebdo',
        description:
            'Faites le point sur les résultats, les blocages et les priorités de la semaine suivante.',
        background: '#f5f3ff',
        cards: [
            {
                title: 'Victoires de la semaine',
                content:
                    'Résultats obtenus, retours positifs et progrès à célébrer.',
                color: '#bbf7d0',
                x: 0,
                y: 0,
                status: 'done',
                tags: ['bilan'],
            },
            {
                title: 'Chiffres clés',
                content:
                    'Revenus, prospects, temps facturé et indicateur métier principal.',
                color: '#bae6fd',
                x: 284,
                y: 0,
                tags: ['mesure'],
            },
            {
                title: 'Blocages et leçons',
                content:
                    'Ce qui a ralenti le travail et ce que vous changerez la prochaine fois.',
                color: '#fecdd3',
                x: 568,
                y: 0,
                tags: ['amélioration'],
            },
            {
                title: 'À clôturer',
                content:
                    'Petites tâches à terminer avant de changer de semaine.',
                color: '#fdba74',
                x: 0,
                y: 214,
                status: 'doing',
                checklist: [
                    {
                        id: 'review-inbox',
                        text: 'Vider la boîte de réception',
                        done: false,
                    },
                    {
                        id: 'review-invoices',
                        text: 'Vérifier les factures à envoyer',
                        done: false,
                    },
                ],
            },
            {
                title: 'Top 3 semaine prochaine',
                content:
                    'Trois résultats concrets à protéger dans votre agenda.',
                color: '#fef08a',
                x: 284,
                y: 214,
                status: 'todo',
                tags: ['priorité'],
                checklist: [
                    {
                        id: 'next-first',
                        text: 'Priorité 1',
                        done: false,
                    },
                    {
                        id: 'next-second',
                        text: 'Priorité 2',
                        done: false,
                    },
                    {
                        id: 'next-third',
                        text: 'Priorité 3',
                        done: false,
                    },
                ],
            },
            {
                title: 'À déléguer ou supprimer',
                content: 'Travail qui ne mérite plus votre attention directe.',
                color: '#e9d5ff',
                x: 568,
                y: 214,
                status: 'todo',
                tags: ['focus'],
            },
        ],
    },
    {
        id: 'pipeline-commercial',
        label: 'Pipeline commercial',
        description:
            'Suivez chaque opportunité, du premier contact à la signature ou à la clôture.',
        background: '#f0f9ff',
        cards: [
            {
                title: 'Prospects à qualifier',
                content:
                    'Nouveaux contacts à évaluer selon le besoin, le budget et le calendrier.',
                color: '#bae6fd',
                x: 0,
                y: 0,
                status: 'todo',
                tags: ['prospection'],
                checklist: [
                    {
                        id: 'pipeline-need',
                        text: 'Confirmer le besoin',
                        done: false,
                    },
                    {
                        id: 'pipeline-budget',
                        text: 'Vérifier le budget',
                        done: false,
                    },
                ],
            },
            {
                title: 'Premier contact',
                content:
                    'Personnes contactées et prochain échange à planifier.',
                color: '#fef08a',
                x: 284,
                y: 0,
                status: 'doing',
                tags: ['contact'],
            },
            {
                title: 'Proposition envoyée',
                content:
                    'Offres transmises avec montant, périmètre et date de décision attendue.',
                color: '#e9d5ff',
                x: 568,
                y: 0,
                status: 'doing',
                tags: ['devis'],
            },
            {
                title: 'Relances',
                content:
                    'Opportunités sans réponse et message de suivi à envoyer.',
                color: '#fdba74',
                x: 0,
                y: 214,
                status: 'todo',
                tags: ['suivi'],
            },
            {
                title: 'Négociation',
                content:
                    'Points à arbitrer avant accord : prix, délais et conditions.',
                color: '#fecdd3',
                x: 284,
                y: 214,
                status: 'doing',
                tags: ['négociation'],
            },
            {
                title: 'Gagné ou perdu',
                content:
                    'Décision finale, valeur signée et enseignements à conserver.',
                color: '#bbf7d0',
                x: 568,
                y: 214,
                status: 'done',
                tags: ['bilan'],
            },
        ],
    },
    {
        id: 'onboarding-client',
        label: 'Onboarding client',
        description:
            'Organisez un démarrage fluide, des accès initiaux au premier point de suivi.',
        background: '#fff7ed',
        cards: [
            {
                title: 'Bienvenue et accès',
                content:
                    'Message de bienvenue, contacts utiles et outils à ouvrir au client.',
                color: '#fef08a',
                x: 0,
                y: 0,
                status: 'doing',
                tags: ['accueil'],
                checklist: [
                    {
                        id: 'onboarding-welcome',
                        text: 'Envoyer le message de bienvenue',
                        done: false,
                    },
                    {
                        id: 'onboarding-access',
                        text: 'Créer les accès partagés',
                        done: false,
                    },
                ],
            },
            {
                title: 'Réunion de cadrage',
                content:
                    'Objectifs, responsabilités, jalons et rythme de communication.',
                color: '#bae6fd',
                x: 284,
                y: 0,
                status: 'todo',
                tags: ['cadrage'],
            },
            {
                title: 'Ressources reçues',
                content:
                    'Documents, contenus, identifiants et éléments de marque nécessaires.',
                color: '#e9d5ff',
                x: 568,
                y: 0,
                status: 'todo',
                tags: ['ressources'],
                checklist: [
                    {
                        id: 'onboarding-assets',
                        text: 'Centraliser les fichiers',
                        done: false,
                    },
                    {
                        id: 'onboarding-credentials',
                        text: 'Vérifier les identifiants',
                        done: false,
                    },
                ],
            },
            {
                title: 'Première production',
                content:
                    'Premier livrable destiné à valider la méthode et le niveau attendu.',
                color: '#fdba74',
                x: 0,
                y: 214,
                status: 'doing',
                tags: ['production'],
            },
            {
                title: 'Validation client',
                content:
                    'Retours consolidés, décisions prises et ajustements approuvés.',
                color: '#fecdd3',
                x: 284,
                y: 214,
                status: 'todo',
                tags: ['validation'],
            },
            {
                title: 'Passage en suivi',
                content:
                    'Prochaines échéances, indicateurs et rendez-vous récurrent.',
                color: '#bbf7d0',
                x: 568,
                y: 214,
                status: 'done',
                tags: ['suivi'],
            },
        ],
    },
];

interface LocalizedTemplateText {
    label: string;
    description: string;
    cards: Array<{
        title: string;
        content: string;
        tags?: string[];
        checklist?: string[];
    }>;
}

const ENGLISH_TEMPLATE_TEXT: Record<string, LocalizedTemplateText> = {
    welcome: {
        label: 'Welcome',
        description:
            'The starter board: learn MagNotes by experimenting with these cards.',
        cards: [
            {
                title: 'Welcome to MagNotes 👋',
                content:
                    'This board is yours. **Double-click** the background to create a sticky note, drag it to move it, and grab a corner to resize it.',
            },
            {
                title: 'Stack and snap',
                content:
                    'Drop a card **in the center** of another to create a stack. Drop it **on an edge** to snap them neatly together.',
            },
            {
                title: 'Ctrl+K opens the command palette',
                content:
                    'Search across all your boards, quickly capture a note, switch views, and insert templates — everything is one shortcut away.',
            },
            {
                title: 'A real task card',
                content:
                    'Status, priority, due date, tags, and checklist: every sticky note can become a task. Tick the box below 👇',
                tags: ['example'],
                checklist: ['Explore MagNotes', 'Tick this box'],
            },
            {
                title: 'Connect your ideas',
                content:
                    'Mention a card with [[Welcome to MagNotes 👋]] — it becomes clickable below this card. The link button can also draw arrows between cards.',
            },
            {
                title: 'Switch views',
                content:
                    'At the top: **Kanban** (columns by status), **Agenda** (by due date), and **Timeline**. The same cards, seen from different angles.',
            },
        ],
    },
    'client-project': {
        label: 'Client project',
        description:
            'Define a project, track deliverables, and keep client feedback in one place.',
        cards: [
            {
                title: 'Brief and objectives',
                content:
                    'Expected outcome, target audience, constraints, and success criteria.',
                tags: ['client', 'scope'],
                checklist: ['Confirm the scope', 'Identify decision-makers'],
            },
            {
                title: 'Next steps',
                content:
                    'The three actions that will unblock the project this week.',
                tags: ['priority'],
            },
            {
                title: 'Deliverables',
                content: 'Items to produce and submit for approval.',
                tags: ['production'],
                checklist: ['Send version 1', 'Deliver the final files'],
            },
            {
                title: 'Client feedback',
                content: 'Decisions, change requests, and points to clarify.',
                tags: ['feedback'],
            },
            {
                title: 'Budget and time',
                content: 'Planned budget, time spent, and any scope changes.',
                tags: ['management'],
            },
            {
                title: 'Approved',
                content: 'Move items approved by the client here.',
                tags: ['approved'],
            },
        ],
    },
    'content-calendar': {
        label: 'Content calendar',
        description:
            'Turn your ideas into published content with a simple editorial workflow.',
        cards: [
            {
                title: 'Content pillars',
                content:
                    'Expertise, behind the scenes, client stories, and personal insights.',
                tags: ['strategy'],
            },
            {
                title: 'Ideas to explore',
                content:
                    'Frequently asked questions, client objections, and topics spotted this week.',
                tags: ['idea'],
                checklist: ['Choose a specific angle', 'Choose the format'],
            },
            {
                title: 'Drafting',
                content: 'Hook, key message, proof, and call to action.',
                tags: ['writing'],
            },
            {
                title: 'To schedule',
                content:
                    'Reviewed content waiting for a publication date and channel.',
                tags: ['planning'],
            },
            {
                title: 'Published',
                content:
                    'Archive published content here and record its results.',
                tags: ['published', 'metrics'],
            },
        ],
    },
    'weekly-review': {
        label: 'Weekly review',
        description:
            'Review results, blockers, and priorities for the coming week.',
        cards: [
            {
                title: "This week's wins",
                content:
                    'Results achieved, positive feedback, and progress worth celebrating.',
                tags: ['review'],
            },
            {
                title: 'Key figures',
                content:
                    'Revenue, leads, billable time, and your main business metric.',
                tags: ['metrics'],
            },
            {
                title: 'Blockers and lessons',
                content:
                    'What slowed down the work and what you will change next time.',
                tags: ['improvement'],
            },
            {
                title: 'To wrap up',
                content: 'Small tasks to finish before starting a new week.',
                checklist: ['Clear the inbox', 'Check invoices to send'],
            },
            {
                title: "Next week's top 3",
                content: 'Three concrete outcomes to protect in your schedule.',
                tags: ['priority'],
                checklist: ['Priority 1', 'Priority 2', 'Priority 3'],
            },
            {
                title: 'Delegate or remove',
                content: 'Work that no longer deserves your direct attention.',
                tags: ['focus'],
            },
        ],
    },
    'pipeline-commercial': {
        label: 'Sales pipeline',
        description:
            'Track every opportunity from first contact to signature or closure.',
        cards: [
            {
                title: 'Leads to qualify',
                content:
                    'New contacts to assess by need, budget, and timeline.',
                tags: ['prospecting'],
                checklist: ['Confirm the need', 'Check the budget'],
            },
            {
                title: 'First contact',
                content:
                    'People contacted and the next conversation to schedule.',
                tags: ['contact'],
            },
            {
                title: 'Proposal sent',
                content:
                    'Offers sent with price, scope, and expected decision date.',
                tags: ['proposal'],
            },
            {
                title: 'Follow-ups',
                content:
                    'Opportunities awaiting a reply and follow-up messages to send.',
                tags: ['follow-up'],
            },
            {
                title: 'Negotiation',
                content:
                    'Points to settle before agreement: price, schedule, and terms.',
                tags: ['negotiation'],
            },
            {
                title: 'Won or lost',
                content:
                    'Final decision, signed value, and lessons worth keeping.',
                tags: ['review'],
            },
        ],
    },
    'onboarding-client': {
        label: 'Client onboarding',
        description:
            'Organize a smooth start, from initial access to the first review.',
        cards: [
            {
                title: 'Welcome and access',
                content:
                    'Welcome message, useful contacts, and tools to open for the client.',
                tags: ['welcome'],
                checklist: ['Send the welcome message', 'Create shared access'],
            },
            {
                title: 'Kickoff meeting',
                content:
                    'Objectives, responsibilities, milestones, and communication rhythm.',
                tags: ['scope'],
            },
            {
                title: 'Resources received',
                content:
                    'Required documents, content, credentials, and brand assets.',
                tags: ['resources'],
                checklist: ['Centralize the files', 'Check the credentials'],
            },
            {
                title: 'First deliverable',
                content:
                    'An initial delivery to confirm the method and expected quality.',
                tags: ['production'],
            },
            {
                title: 'Client approval',
                content:
                    'Consolidated feedback, recorded decisions, and approved adjustments.',
                tags: ['approval'],
            },
            {
                title: 'Ongoing follow-up',
                content: 'Upcoming deadlines, metrics, and recurring meetings.',
                tags: ['follow-up'],
            },
        ],
    },
};

/**
 * Returns localized copies for future insertions. Existing board data is never
 * translated or mutated when the user changes language.
 */
export const getBoardTemplates = (lang: Lang): BoardTemplate[] => {
    if (lang === 'fr') return BOARD_TEMPLATES;

    return BOARD_TEMPLATES.map((template) => {
        const localized = ENGLISH_TEMPLATE_TEXT[template.id];
        if (!localized || localized.cards.length !== template.cards.length) {
            return template;
        }

        return {
            ...template,
            label: localized.label,
            description: localized.description,
            cards: template.cards.map((card, cardIndex) => {
                const localizedCard = localized.cards[cardIndex];
                return {
                    ...card,
                    title: localizedCard.title,
                    content: localizedCard.content,
                    ...(localizedCard.tags
                        ? { tags: [...localizedCard.tags] }
                        : {}),
                    ...(localizedCard.checklist && card.checklist
                        ? {
                              checklist: card.checklist.map(
                                  (item, checklistIndex) => ({
                                      ...item,
                                      text:
                                          localizedCard.checklist?.[
                                              checklistIndex
                                          ] ?? item.text,
                                  })
                              ),
                          }
                        : {}),
                };
            }),
        };
    });
};
