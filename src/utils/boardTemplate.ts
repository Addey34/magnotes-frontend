import { DEFAULT_POST_IT } from '../constants/boardDefaults';
import { BoardTemplate, BoardTemplateCard } from '../constants/boardTemplates';
import { PostIt } from '../types/boardTypes';

const TEMPLATE_POSITION_OFFSET = 48;

type RequiredCreatePostItFields =
    | 'tabId'
    | 'title'
    | 'content'
    | 'color'
    | 'textColor'
    | 'textSize'
    | 'fontFamily'
    | 'x'
    | 'y'
    | 'width'
    | 'height';

export type TemplateCardPayload = Required<
    Pick<PostIt, RequiredCreatePostItFields>
> &
    Partial<Pick<PostIt, 'status' | 'checklist' | 'tags' | 'dueDate'>>;

function buildTaskFields(
    card: BoardTemplateCard
): Partial<Pick<PostIt, 'status' | 'checklist' | 'tags'>> {
    return {
        ...(card.status !== undefined ? { status: card.status } : {}),
        ...(card.checklist !== undefined
            ? {
                  checklist: card.checklist.map((item) => ({ ...item })),
              }
            : {}),
        ...(card.tags !== undefined ? { tags: [...card.tags] } : {}),
    };
}

// When `center` is given, the template's bounding box is centered on that board
// point (used to drop a template into the current viewport). Otherwise the cards
// keep the legacy fixed offset near the board origin.
export function buildTemplateCards(
    template: BoardTemplate,
    tabId: string,
    center?: { x: number; y: number }
): TemplateCardPayload[] {
    let offsetX = TEMPLATE_POSITION_OFFSET;
    let offsetY = TEMPLATE_POSITION_OFFSET;

    if (center && template.cards.length > 0) {
        const minX = Math.min(...template.cards.map((card) => card.x));
        const minY = Math.min(...template.cards.map((card) => card.y));
        const maxX =
            Math.max(...template.cards.map((card) => card.x)) +
            DEFAULT_POST_IT.width;
        const maxY =
            Math.max(...template.cards.map((card) => card.y)) +
            DEFAULT_POST_IT.height;
        offsetX = center.x - (minX + maxX) / 2;
        offsetY = center.y - (minY + maxY) / 2;
    }

    return template.cards.map((card) => ({
        tabId,
        title: card.title,
        content: card.content,
        color: card.color ?? DEFAULT_POST_IT.color,
        textColor: DEFAULT_POST_IT.textColor,
        textSize: DEFAULT_POST_IT.textSize,
        fontFamily: DEFAULT_POST_IT.fontFamily,
        x: card.x + offsetX,
        y: card.y + offsetY,
        width: DEFAULT_POST_IT.width,
        height: DEFAULT_POST_IT.height,
        rotation: DEFAULT_POST_IT.rotation,
        ...buildTaskFields(card),
    }));
}
