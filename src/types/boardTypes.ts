export interface BoardTab {
    _id: string;
    userId: string;
    name: string;
    color: string;
    backgroundColor?: string;
    theme?: string;
    icon: string;
    order: number;
    viewport?: {
        x: number;
        y: number;
        zoom: number;
    };
    shareToken?: string;
    createdAt: string;
    updatedAt: string;
}

// Read-only board payload returned by the public share endpoint (no auth).
export interface PublicBoard {
    tab: Omit<BoardTab, 'userId' | 'shareToken'>;
    postIts: PostIt[];
    stacks: PostItStack[];
    connections: CardLink[];
}

export type PostItStatus = 'todo' | 'doing' | 'done';
export type PostItPriority = 'low' | 'medium' | 'high';
export type CardFinish = 'flat' | 'matte' | 'metallic' | 'glass' | 'paper';

export interface ChecklistItem {
    id: string;
    text: string;
    done: boolean;
}

export interface PostIt {
    _id: string;
    userId: string;
    tabId: string;
    title: string;
    content: string;
    color: string;
    textColor?: string;
    textSize?: number;
    fontFamily?: string;
    finish?: CardFinish;
    x: number;
    y: number;
    rotation?: number;
    width: number;
    height: number;
    zIndex: number;
    stackId?: string | null;
    stackOrder?: number | null;
    status?: PostItStatus | null;
    dueDate?: string | null;
    priority?: PostItPriority | null;
    tags?: string[];
    checklist?: ChecklistItem[];
    mediaUrl?: string | null;
    createdAt: string;
    updatedAt: string;
}

export type PostItUpdate = Partial<
    Pick<
        PostIt,
        | 'tabId'
        | 'title'
        | 'content'
        | 'color'
        | 'textColor'
        | 'textSize'
        | 'fontFamily'
        | 'finish'
        | 'x'
        | 'y'
        | 'rotation'
        | 'width'
        | 'height'
        | 'zIndex'
        | 'stackId'
        | 'stackOrder'
        | 'status'
        | 'dueDate'
        | 'priority'
        | 'tags'
        | 'checklist'
        | 'mediaUrl'
    >
>;

/** A patch guarded by the card state that was last loaded by this client. */
export type PostItSaveUpdate = PostItUpdate & {
    expectedUpdatedAt?: string;
};

export interface PostItStack {
    _id: string;
    userId: string;
    tabId: string;
    name?: string;
    x: number;
    y: number;
    collapsed: boolean;
    createdAt: string;
    updatedAt: string;
}

export type PostItStackUpdate = Partial<
    Pick<PostItStack, 'name' | 'x' | 'y' | 'collapsed'>
>;

export type CardLinkKind = 'arrow' | 'line';

export interface CardLink {
    _id: string;
    userId: string;
    tabId: string;
    sourceId: string;
    targetId: string;
    label?: string;
    kind?: CardLinkKind;
    createdAt: string;
    updatedAt: string;
}

export type CardLinkUpdate = Partial<Pick<CardLink, 'label' | 'kind'>>;

export interface SaveState {
    status: 'idle' | 'saving' | 'saved' | 'error';
    postItId?: string;
}
