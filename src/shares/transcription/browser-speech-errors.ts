/** Browser error descriptions contain only app-authored text, never vendor event messages. */
export function browserSpeechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'Speech recognition is not allowed. Check this website’s permissions in Safari’s website settings or your browser’s site settings, then try again.';
    case 'service-not-allowed':
      return 'The speech recognition service is unavailable or not allowed. Check device speech recognition settings, or type your share.';
    case 'language-not-supported':
      return 'Speech recognition does not support this language. Try another browser or type your share.';
    case 'audio-capture':
      return 'Microphone audio is unavailable. Check your microphone and browser settings, then try again.';
    default:
      return 'Speech recognition could not continue. Check your connection and try again.';
  }
}
