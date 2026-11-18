import { getTokenUserId } from '../utils/tokenUtils';
import { currentGeneration } from './sessionCoordinator';
import type { OperationContext } from './mutationProtocol';

/** The account and session generation the client is in RIGHT NOW. */
export const contextNow = (): OperationContext => ({
    userId: getTokenUserId(),
    generation: currentGeneration(),
});
