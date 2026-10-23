import { useEffect, useLayoutEffect, useRef } from 'react';

type LiveTranscriptProps = {
  text: string;
  interim: string;
  onTextChange: (text: string) => void;
  readOnly: boolean;
  errorId?: string;
};

/** Follow new words inside the prompter, without moving the page or overriding scrollback. */
export function LiveTranscript({
  text,
  interim,
  onTextChange,
  readOnly,
  errorId
}: LiveTranscriptProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!field.current) return;
    const scrollTop = viewport.current?.scrollTop ?? 0;
    field.current.style.height = '0px';
    field.current.style.height = `${field.current.scrollHeight}px`;
    if (viewport.current) viewport.current.scrollTop = scrollTop;
  }, [text]);
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
        <textarea
          ref={field}
          aria-label="Your share"
          aria-describedby={errorId}
          value={text}
          readOnly={readOnly}
          onChange={(event) => onTextChange(event.target.value)}
          className="transcript-input"
          placeholder="Your words will appear here. Speak or type to begin…"
          rows={1}
        />
        {interim && (
          <p className="transcript-interim">
            <span className="sr-only">Still recognizing: </span>
            {interim}
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
