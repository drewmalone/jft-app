import { ShareApp } from '../shares/share-app';
import { connection } from 'next/server';
import { transcriptionProvider } from '../shares/server/transcription-config';
import { TranscriptionBootstrap } from '../shares/transcription/provider-context';

/** Renders the interactive reflection/share client from the App Router entry. */
export default async function Home() {
  await connection();
  return (
    <TranscriptionBootstrap provider={transcriptionProvider()}>
      <ShareApp />
    </TranscriptionBootstrap>
  );
}
