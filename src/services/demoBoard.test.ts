import * as demo from './demoBoard';
import { PostIt } from '../types/boardTypes';

const baseCardInput = (tabId: string, overrides = {}) => ({
    tabId,
    title: 'Card',
    content: '',
    color: '#fef08a',
    textColor: '#172033',
    textSize: 13,
    fontFamily: 'Inter',
    x: 0,
    y: 0,
    width: 220,
    height: 150,
    ...overrides,
});

describe('demoBoard store', () => {
    beforeEach(() => demo.resetDemoBoard());

    it('creates tabs with incrementing order and returns them sorted', async () => {
        await demo.createTab('A', '#111');
        await demo.createTab('B', '#222');
        const tabs = await demo.fetchTabs();
        expect(tabs.map((tab) => tab.name)).toEqual(['A', 'B']);
        expect(tabs.map((tab) => tab.order)).toEqual([1, 2]);
        expect(tabs[0]._id).not.toBe(tabs[1]._id);
    });

    it('bumps zIndex per tab and isolates cards by tab', async () => {
        const tabA = await demo.createTab('A', '#111');
        const tabB = await demo.createTab('B', '#222');
        const a1 = await demo.createPostIt(baseCardInput(tabA._id));
        const a2 = await demo.createPostIt(baseCardInput(tabA._id));
        const b1 = await demo.createPostIt(baseCardInput(tabB._id));
        expect(a1.zIndex).toBe(1);
        expect(a2.zIndex).toBe(2);
        expect(b1.zIndex).toBe(1);
        expect(await demo.fetchPostIts(tabA._id)).toHaveLength(2);
        expect(await demo.fetchPostIts(tabB._id)).toHaveLength(1);
    });

    it('applies patches and clears fields set to null', async () => {
        const tab = await demo.createTab('A', '#111');
        const card = await demo.createPostIt(baseCardInput(tab._id));
        await demo.updatePostIt(card._id, { status: 'doing', title: 'Renamed' });
        let stored = (await demo.fetchPostIts(tab._id))[0];
        expect(stored.status).toBe('doing');
        expect(stored.title).toBe('Renamed');

        await demo.updatePostIt(card._id, { status: null });
        stored = (await demo.fetchPostIts(tab._id))[0];
        expect(stored.status).toBeUndefined();
    });

    it('duplicates a card offset by 24px with a fresh id', async () => {
        const tab = await demo.createTab('A', '#111');
        const card = await demo.createPostIt(
            baseCardInput(tab._id, { x: 100, y: 50 })
        );
        await demo.updatePostIt(card._id, { tags: ['keep'] });
        const copy = await demo.duplicatePostIt(card._id);
        expect(copy._id).not.toBe(card._id);
        expect(copy.x).toBe(124);
        expect(copy.y).toBe(74);
        expect(copy.tags).toEqual(['keep']);
    });

    it('deletes a card and its connections', async () => {
        const tab = await demo.createTab('A', '#111');
        const a = await demo.createPostIt(baseCardInput(tab._id));
        const b = await demo.createPostIt(baseCardInput(tab._id));
        await demo.createConnection({
            tabId: tab._id,
            sourceId: a._id,
            targetId: b._id,
        });
        await demo.deletePostIt(a._id);
        expect(await demo.fetchPostIts(tab._id)).toHaveLength(1);
        expect(await demo.fetchConnections(tab._id)).toHaveLength(0);
    });

    it('cascades a tab delete to cards, stacks, and connections', async () => {
        const tabA = await demo.createTab('A', '#111');
        const tabB = await demo.createTab('B', '#222');
        const a = await demo.createPostIt(baseCardInput(tabA._id));
        const b = await demo.createPostIt(baseCardInput(tabA._id));
        await demo.createStack({ tabId: tabA._id, x: 0, y: 0 });
        await demo.createConnection({
            tabId: tabA._id,
            sourceId: a._id,
            targetId: b._id,
        });
        await demo.deleteTab(tabA._id);

        const tabs = await demo.fetchTabs();
        expect(tabs.map((tab) => tab._id)).toEqual([tabB._id]);
        expect(tabs[0].order).toBe(1);
        expect(await demo.fetchPostIts(tabA._id)).toHaveLength(0);
        expect(await demo.fetchStacks(tabA._id)).toHaveLength(0);
        expect(await demo.fetchConnections(tabA._id)).toHaveLength(0);
    });

    it('refuses to delete the last remaining tab', async () => {
        const tab = await demo.createTab('Only', '#111');
        await demo.deleteTab(tab._id);
        expect(await demo.fetchTabs()).toHaveLength(1);
    });

    it('restores a card but rejects a duplicate id', async () => {
        const tab = await demo.createTab('A', '#111');
        const card = await demo.createPostIt(baseCardInput(tab._id));
        await demo.deletePostIt(card._id);
        const restored = await demo.restorePostIt(card as PostIt);
        expect(restored?._id).toBe(card._id);
        expect(await demo.restorePostIt(card as PostIt)).toBeNull();
    });

    it('detaches cards when their stack is deleted', async () => {
        const tab = await demo.createTab('A', '#111');
        const stack = await demo.createStack({ tabId: tab._id, x: 0, y: 0 });
        const card = await demo.createPostIt(baseCardInput(tab._id));
        await demo.updatePostIt(card._id, { stackId: stack._id, stackOrder: 0 });
        await demo.deleteStack(stack._id);
        const stored = (await demo.fetchPostIts(tab._id))[0];
        expect(stored.stackId).toBeUndefined();
        expect(stored.stackOrder).toBeUndefined();
    });

    it('searches title, content, and tags case-insensitively', async () => {
        const tab = await demo.createTab('A', '#111');
        await demo.createPostIt(
            baseCardInput(tab._id, { title: 'Roadmap Q3' })
        );
        const withTag = await demo.createPostIt(baseCardInput(tab._id));
        await demo.updatePostIt(withTag._id, { tags: ['urgent'] });

        expect(await demo.searchPostIts('roadmap')).toHaveLength(1);
        expect(await demo.searchPostIts('URGENT')).toHaveLength(1);
        expect(await demo.searchPostIts('nomatch')).toHaveLength(0);
    });

    it('reports and resets demo data', async () => {
        expect(demo.hasDemoData()).toBe(false);
        await demo.createTab('A', '#111');
        expect(demo.hasDemoData()).toBe(true);
        demo.resetDemoBoard();
        expect(demo.hasDemoData()).toBe(false);
    });
});
