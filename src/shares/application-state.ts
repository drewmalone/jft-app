import type { Share } from './model';

export type Screen =
  { view: 'today' | 'past' } | { view: 'saved' | 'detail'; share: Share };
type SaveState =
  { status: 'editing' | 'saving' } | { status: 'failed'; message: string };
type DetailState =
  { status: 'idle' | 'loading' } | { status: 'failed'; message: string };
export type ApplicationState = {
  screen: Screen;
  save: SaveState;
  detail: DetailState;
};
export const initialApplicationState: ApplicationState = {
  screen: { view: 'today' },
  save: { status: 'editing' },
  detail: { status: 'idle' }
};
type Action =
  | { type: 'navigate'; screen: Screen }
  | { type: 'saveStarted' }
  | { type: 'saveSucceeded'; share: Share }
  | { type: 'saveFailed'; message: string }
  | { type: 'clearSaveError' }
  | { type: 'detailStarted' }
  | { type: 'detailFailed'; message: string };
/** Keep visible transitions atomic; async request identity belongs to the controller hook. */
export function reduceApplication(
  state: ApplicationState,
  action: Action
): ApplicationState {
  switch (action.type) {
    case 'navigate':
      return { ...state, screen: action.screen, detail: { status: 'idle' } };
    case 'saveStarted':
      return { ...state, save: { status: 'saving' } };
    case 'saveSucceeded':
      return {
        screen: { view: 'saved', share: action.share },
        save: { status: 'editing' },
        detail: { status: 'idle' }
      };
    case 'saveFailed':
      return { ...state, save: { status: 'failed', message: action.message } };
    case 'clearSaveError':
      return state.save.status === 'failed'
        ? { ...state, save: { status: 'editing' } }
        : state;
    case 'detailStarted':
      return { ...state, detail: { status: 'loading' } };
    case 'detailFailed':
      return {
        ...state,
        detail: { status: 'failed', message: action.message }
      };
  }
}
