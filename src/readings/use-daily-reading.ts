'use client';
import { useEffect, useRef, useState } from 'react';
import { dailyReadingSchema, type DailyReading } from './model';
import {
  readingDate,
  readingTimeZone,
  READING_TIME_ZONE_COOKIE
} from './calendar';
import { requestJson } from '../shares/http-client';

/** Resolve browser timezone explicitly and refresh at date rollover without polling the database. */
export function useDailyReading(initial: DailyReading) {
  const [daily, setDaily] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const loadedDate = useRef(initial.date);
  const requestId = useRef(0);
  const requestedDate = useRef<string | null>(null);
  const refresh = useRef<(force?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    const timeZone = readingTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
    document.cookie = `${READING_TIME_ZONE_COOKIE}=${encodeURIComponent(timeZone)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    refresh.current = async (force = false) => {
      const date = readingDate(timeZone);
      if (
        (!force && date === loadedDate.current) ||
        requestedDate.current === date
      )
        return;
      const id = ++requestId.current;
      requestedDate.current = date;
      setLoading(true);
      try {
        const next = dailyReadingSchema.parse(
          await requestJson(
            `/api/readings/today?timeZone=${encodeURIComponent(timeZone)}`
          )
        );
        if (!active || requestId.current !== id) return;
        loadedDate.current = next.date;
        setDaily(next);
        setFailed(false);
      } catch {
        if (active && requestId.current === id) setFailed(true);
      } finally {
        if (active && requestId.current === id) {
          requestedDate.current = null;
          setLoading(false);
        }
      }
    };
    const check = () => {
      void refresh.current();
    };
    check();
    window.addEventListener('focus', check);
    const timer = window.setInterval(check, 60_000);
    return () => {
      active = false;
      requestedDate.current = null;
      window.removeEventListener('focus', check);
      clearInterval(timer);
    };
  }, []);
  return {
    daily,
    loading,
    failed,
    retry: () => {
      void refresh.current(true);
    }
  };
}
