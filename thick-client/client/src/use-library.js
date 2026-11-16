import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export function useLibrary() {
  const [books, setBooks] = useState([]);
  const [stats, setStats] = useState(null);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState('loading');
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const inFlight = useRef(null);
  const refresh = useCallback(function refresh(force = false) {
    if (inFlight.current) return force ? inFlight.current.then(() => refresh()) : inFlight.current;
    inFlight.current = Promise.all([api('/books'), api('/statistics'), api('/auth/session')])
      .then(([nextBooks, nextStats, session]) => {
        if (!mounted.current) return;
        setBooks(previous => JSON.stringify(previous) === JSON.stringify(nextBooks) ? previous : nextBooks);
        setStats(nextStats); setUser(session.user); setConnection('online'); setLastSync(new Date()); setError('');
      }).catch(error => {
        if (!mounted.current) return;
        setConnection('offline'); setError(error.message || 'Немає зв’язку із сервером.');
      }).finally(() => { if (mounted.current) setReady(true); inFlight.current = null; });
    return inFlight.current;
  }, []);
  useEffect(() => {
    mounted.current = true;
    let stopped = false, timer;
    // Наступний цикл починається після завершення запитів: без їх накопичення.
    async function tick() { await refresh(); if (!stopped) timer = setTimeout(tick, 2000); }
    tick();
    const expired = () => setUser(null);
    window.addEventListener('session-expired', expired);
    return () => { mounted.current = false; stopped = true; clearTimeout(timer); window.removeEventListener('session-expired', expired); };
  }, [refresh]);
  return { books, stats, user, setUser, ready, connection, lastSync, error, refresh };
}
