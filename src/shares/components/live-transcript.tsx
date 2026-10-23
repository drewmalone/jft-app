import { useEffect, useRef } from 'react';

type LiveTranscriptProps = { text: string; interim: string };

/** Follow new words inside the prompter, without moving the page or overriding scrollback. */
export function LiveTranscript({ text, interim }: LiveTranscriptProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const element = viewport.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [text, interim]);
  return (
    <div className="transcript-wrap">
      <div
        ref={viewport}
        role="region"
        aria-label="Live share transcript"
        tabIndex={0}
        className="live-transcript"
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            32;
        }}
      >
        {text || interim ? (
          <p>
            {text}
            {interim && (
              <>
                <span aria-hidden="true">{text ? ' ' : ''}</span>
                <span className="transcript-interim">
                  <span className="sr-only">Still recognizing: </span>
                  {interim}
                </span>
              </>
            )}
          </p>
        ) : (
          <p className="transcript-placeholder">
            Your words will appear here.
            <br />
            Take your time. Start wherever you are.
          </p>
        )}
      </div>
      <button
        type="button"
        className="transcript-follow"
        onClick={() => {
          following.current = true;
          if (viewport.current)
            viewport.current.scrollTop = viewport.current.scrollHeight;
        }}
      >
        Latest words <span aria-hidden="true">↓</span>
      </button>
    </div>
  );
}
