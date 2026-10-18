import { ShareApp } from '../shares/share-app';
import { ReflectionReading } from '../shares/components/reflection-reading';

/** Keeps the route entry separate from the browser-only reflection experience. */
export default function Home() {
  return <ShareApp reading={<ReflectionReading />} />;
}
