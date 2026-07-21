/**
 * Translation-key helpers for the shared card enums (status, priority). The
 * runtime labels in `constants/boardDefaults.ts` stay as fallbacks; components
 * resolve the localized label via `t(statusKey(id))`.
 */

import { PostItPriority, PostItStatus } from '../types/boardTypes';
import { TranslationKey } from './dictionary';

export const statusKey = (id: PostItStatus): TranslationKey =>
    `status.${id}` as TranslationKey;

export const priorityKey = (id: PostItPriority): TranslationKey =>
    `priority.${id}` as TranslationKey;
