import { useCallback, useReducer } from 'react';
import type { DailyReading } from '../readings/model';

type Draft = {
  text: string;
  pinned: DailyReading | null;
  recording: boolean;
  needsReview: boolean;
};
type Action =
  | { type: 'edit'; text: string; daily: DailyReading }
  | { type: 'recording'; active: boolean; daily: DailyReading }
  | { type: 'review'; daily: DailyReading }
  | { type: 'conflict' | 'reset' };
const emptyDraft: Draft = {
  text: '',
  pinned: null,
  recording: false,
  needsReview: false
};
function pin(draft: Draft, daily: DailyReading): Draft {
  return {
    ...draft,
    pinned:
      draft.text.trim() || draft.recording
        ? (draft.pinned ?? (daily.reading ? daily : null))
        : null
  };
}
function reduceDraft(draft: Draft, action: Action): Draft {
  switch (action.type) {
    case 'edit':
      return pin(
        {
          ...draft,
          text: action.text,
          needsReview: !!action.text.trim() && draft.needsReview
        },
        action.daily
      );
    case 'recording':
      return draft.recording === action.active
        ? draft
        : pin({ ...draft, recording: action.active }, action.daily);
    case 'conflict':
      return { ...draft, needsReview: true };
    case 'review':
      return action.daily.reading &&
        action.daily.reading.id !== draft.pinned?.reading?.id
        ? { ...draft, pinned: action.daily, needsReview: false }
        : draft;
    case 'reset':
      return emptyDraft;
  }
}
/** Own draft transitions and preserve the reading seen when typing or recording began. */
export function useShareDraft(daily: DailyReading) {
  const [draft, dispatch] = useReducer(reduceDraft, emptyDraft);
  const displayedReading = draft.pinned ?? daily;
  return {
    ...draft,
    displayedReading,
    canReview:
      !!daily.reading && daily.reading.id !== displayedReading.reading?.id,
    edit: useCallback(
      (text: string) => dispatch({ type: 'edit', text, daily }),
      [daily]
    ),
    recordingChanged: useCallback(
      (active: boolean) => dispatch({ type: 'recording', active, daily }),
      [daily]
    ),
    conflict: () => dispatch({ type: 'conflict' }),
    review: () => dispatch({ type: 'review', daily }),
    reset: () => dispatch({ type: 'reset' })
  };
}
