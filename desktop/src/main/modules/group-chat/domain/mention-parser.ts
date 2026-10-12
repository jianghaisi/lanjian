// Adapted from Clowder AI 3e70e1d6 (MIT). See licenses/group-chat-NOTICES.txt.
import type { MemberId as CatId } from '../../../../contracts/group-chat/group-chat';
import { AppError } from '../../../../contracts/core/app-error';

export interface ParsedMention {
  targetCatId: CatId;
  matched: boolean;
}

// ASCII + CJK full-width punctuation + brackets that can follow a mention
const MENTION_BOUNDARY_RIGHT = '[\\s,.:;!?，。！？；：、)\\]）】」』]';
// Left boundary: @ must not be preceded by word chars or dots (rejects email/domain)
const MENTION_BOUNDARY_LEFT = '(?<!\\w)';

/**
 * #969: Strip zero-width Unicode characters that LLMs may insert around mentions.
 * Also strips markdown bold/italic markers (`**`, `*`, `__`, `_`) immediately before `@`.
 */
const ZERO_WIDTH_RE = /(?:​|‌|‍|﻿|­|⁠)/g;
const MD_BEFORE_MENTION_RE = /(?:\*{1,2}|_{1,2})(?=@)/g;
const MD_AFTER_MENTION_RE = /(@\S+?)(?:\*{1,2}|_{1,2})(?=\s|$|[,.:;!?，。！？])/g;

function normalizeMentionNoise(text: string): string {
  return text.replace(ZERO_WIDTH_RE, '').replace(MD_BEFORE_MENTION_RE, '').replace(MD_AFTER_MENTION_RE, '$1');
}

/**
 * Parse @-mentions from external platform message text.
 * Returns the **first-in-text** matched cat or defaultCatId.
 *
 * @param text — inbound message text
 * @param allPatterns — Map<CatId, mentionPatterns[]> from catRegistry
 * @param defaultCatId — fallback when no mention found
 */
export function parseMentions(text: string, allPatterns: Map<string, string[]>, defaultCatId: CatId): ParsedMention {
  // #969: normalize invisible chars and markdown around mentions before matching
  const normalizedText = normalizeMentionNoise(text);
  let bestIndex = Infinity;
  const matched = new Set<string>(), identifiers = new Set<string>();

  for (const [catId, patterns] of allPatterns) {
    for (const pattern of patterns) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`${MENTION_BOUNDARY_LEFT}${escaped}(?=${MENTION_BOUNDARY_RIGHT}|$)`, 'i');
      const match = regex.exec(normalizedText);
      if (match && match.index <= bestIndex) {
        if (match.index < bestIndex) { matched.clear(); identifiers.clear(); bestIndex = match.index; }
        matched.add(catId);
        if (pattern.toLowerCase() === `@${catId}`.toLowerCase()) identifiers.add(catId);
      }
    }
  }

  const choices = identifiers.size ? identifiers : matched;
  if (choices.size > 1) throw new AppError('VALIDATION_ERROR', '提及名称对应多位成员，请选择成员或使用唯一 @成员ID。', { recoverable: true });
  return { targetCatId: choices.values().next().value ?? defaultCatId, matched: choices.size > 0 };
}
