import axios from 'axios';
import {
    BoardTab,
    CardLink,
    CardLinkUpdate,
    PostIt,
    PostItStack,
    PostItStackUpdate,
    PostItUpdate,
    PublicBoard,
} from '../types/boardTypes';
import { getToken } from '../utils/tokenUtils';
import * as demoBoard from './demoBoard';
import { isDemoActive } from './demoMode';

const baseUrl = import.meta.env.VITE_API_URL || '';

const getAuthHeaders = () => {
    const token = getToken();
    if (!token) {
        throw new Error('No token found');
    }

    return { Authorization: `Bearer ${token}` };
};

const handleError = (error: unknown) => {
    console.error(error);
    throw error;
};

export const fetchTabs = async (): Promise<BoardTab[]> => {
    if (isDemoActive()) return demoBoard.fetchTabs();
    try {
        const response = await axios.get<BoardTab[]>(`${baseUrl}/api/tabs`, {
            headers: getAuthHeaders(),
        });
        return response.data;
    } catch (error) {
        handleError(error);
        return [];
    }
};

export const createTab = async (
    name: string,
    color: string,
    icon = '📝',
    backgroundColor?: string
): Promise<BoardTab> => {
    if (isDemoActive())
        return demoBoard.createTab(name, color, icon, backgroundColor);
    try {
        const response = await axios.post<BoardTab>(
            `${baseUrl}/api/tabs`,
            { name, color, icon, backgroundColor },
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return {} as BoardTab;
    }
};

export const updateTab = async (
    tabId: string,
    updates: Partial<
        Pick<
            BoardTab,
            'name' | 'color' | 'theme' | 'icon' | 'order' | 'viewport'
        > & { backgroundColor?: string | null }
    >
): Promise<void> => {
    if (isDemoActive()) return demoBoard.updateTab(tabId, updates);
    try {
        await axios.patch(`${baseUrl}/api/tabs/${tabId}`, updates, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

export const reorderTabs = async (tabIds: string[]): Promise<void> => {
    if (isDemoActive()) return demoBoard.reorderTabs(tabIds);
    try {
        await axios.put(
            `${baseUrl}/api/tabs/reorder`,
            { tabIds },
            { headers: getAuthHeaders() }
        );
    } catch (error) {
        handleError(error);
    }
};

// Enable/disable public read-only sharing; returns the share token (null once
// revoked). The token builds the public URL `${origin}/app/b/<token>`.
export const setBoardShare = async (
    tabId: string,
    enabled: boolean
): Promise<string | null> => {
    try {
        const url = `${baseUrl}/api/tabs/${tabId}/share`;
        const response = enabled
            ? await axios.post<{ shareToken: string | null }>(
                  url,
                  {},
                  {
                      headers: getAuthHeaders(),
                  }
              )
            : await axios.delete<{ shareToken: string | null }>(url, {
                  headers: getAuthHeaders(),
              });
        return response.data.shareToken;
    } catch (error) {
        handleError(error);
        return null;
    }
};

// Public, unauthenticated fetch of a shared board by token.
export const fetchPublicBoard = async (
    token: string
): Promise<PublicBoard | null> => {
    try {
        const response = await axios.get<PublicBoard>(
            `${baseUrl}/api/public/boards/${token}`
        );
        return response.data;
    } catch {
        return null;
    }
};

export const deleteTab = async (tabId: string): Promise<void> => {
    if (isDemoActive()) return demoBoard.deleteTab(tabId);
    try {
        await axios.delete(`${baseUrl}/api/tabs/${tabId}`, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

export const fetchPostIts = async (tabId: string): Promise<PostIt[]> => {
    if (isDemoActive()) return demoBoard.fetchPostIts(tabId);
    try {
        const response = await axios.get<PostIt[]>(`${baseUrl}/api/postits`, {
            params: { tabId },
            headers: getAuthHeaders(),
        });
        return response.data;
    } catch (error) {
        handleError(error);
        return [];
    }
};

// (client) Global search across every board of the current user.
export const searchPostIts = async (query: string): Promise<PostIt[]> => {
    if (isDemoActive()) return demoBoard.searchPostIts(query);
    try {
        const response = await axios.get<PostIt[]>(
            `${baseUrl}/api/postits/search`,
            { params: { q: query }, headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return [];
    }
};

export const createPostIt = async (
    input: Pick<
        PostIt,
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
        | 'height'
        | 'rotation'
    >
): Promise<PostIt> => {
    if (isDemoActive()) return demoBoard.createPostIt(input);
    try {
        const response = await axios.post<PostIt>(
            `${baseUrl}/api/postits`,
            input,
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return {} as PostIt;
    }
};

export const updatePostIt = async (
    postItId: string,
    updates: PostItUpdate
): Promise<void> => {
    if (isDemoActive()) return demoBoard.updatePostIt(postItId, updates);
    try {
        await axios.patch(`${baseUrl}/api/postits/${postItId}`, updates, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

export const duplicatePostIt = async (postItId: string): Promise<PostIt> => {
    if (isDemoActive()) return demoBoard.duplicatePostIt(postItId);
    try {
        const response = await axios.post<PostIt>(
            `${baseUrl}/api/postits/${postItId}/duplicate`,
            {},
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return {} as PostIt;
    }
};

export const deletePostIt = async (postItId: string): Promise<void> => {
    if (isDemoActive()) return demoBoard.deletePostIt(postItId);
    try {
        await axios.delete(`${baseUrl}/api/postits/${postItId}`, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

// Re-insert a previously deleted card, preserving its original id so undo keeps
// links/mentions pointing at the same card. Returns the restored card, or null
// when the server rejects it (e.g. the id already exists).
export const restorePostIt = async (card: PostIt): Promise<PostIt | null> => {
    if (isDemoActive()) return demoBoard.restorePostIt(card);
    try {
        const response = await axios.post<PostIt>(
            `${baseUrl}/api/postits/restore`,
            card,
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return null;
    }
};

export const fetchStacks = async (tabId: string): Promise<PostItStack[]> => {
    if (isDemoActive()) return demoBoard.fetchStacks(tabId);
    try {
        const response = await axios.get<PostItStack[]>(
            `${baseUrl}/api/stacks`,
            {
                params: { tabId },
                headers: getAuthHeaders(),
            }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return [];
    }
};

export const createStack = async (
    input: Pick<PostItStack, 'tabId' | 'x' | 'y'> & { name?: string }
): Promise<PostItStack> => {
    if (isDemoActive()) return demoBoard.createStack(input);
    try {
        const response = await axios.post<PostItStack>(
            `${baseUrl}/api/stacks`,
            input,
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return {} as PostItStack;
    }
};

export const updateStack = async (
    stackId: string,
    updates: PostItStackUpdate
): Promise<void> => {
    if (isDemoActive()) return demoBoard.updateStack(stackId, updates);
    try {
        await axios.patch(`${baseUrl}/api/stacks/${stackId}`, updates, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

export const deleteStack = async (stackId: string): Promise<void> => {
    if (isDemoActive()) return demoBoard.deleteStack(stackId);
    try {
        await axios.delete(`${baseUrl}/api/stacks/${stackId}`, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

// Connections (Pillar 3): arrows/links between two cards of the same tab.
export const fetchConnections = async (tabId: string): Promise<CardLink[]> => {
    if (isDemoActive()) return demoBoard.fetchConnections(tabId);
    try {
        const response = await axios.get<CardLink[]>(
            `${baseUrl}/api/connections`,
            {
                params: { tabId },
                headers: getAuthHeaders(),
            }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return [];
    }
};

export const createConnection = async (
    input: Pick<CardLink, 'tabId' | 'sourceId' | 'targetId'> &
        Partial<Pick<CardLink, 'label' | 'kind'>>
): Promise<CardLink> => {
    if (isDemoActive()) return demoBoard.createConnection(input);
    try {
        const response = await axios.post<CardLink>(
            `${baseUrl}/api/connections`,
            input,
            { headers: getAuthHeaders() }
        );
        return response.data;
    } catch (error) {
        handleError(error);
        return {} as CardLink;
    }
};

export const updateConnection = async (
    linkId: string,
    updates: CardLinkUpdate
): Promise<void> => {
    if (isDemoActive()) return demoBoard.updateConnection(linkId, updates);
    try {
        await axios.patch(`${baseUrl}/api/connections/${linkId}`, updates, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};

export const deleteConnection = async (linkId: string): Promise<void> => {
    if (isDemoActive()) return demoBoard.deleteConnection(linkId);
    try {
        await axios.delete(`${baseUrl}/api/connections/${linkId}`, {
            headers: getAuthHeaders(),
        });
    } catch (error) {
        handleError(error);
    }
};
