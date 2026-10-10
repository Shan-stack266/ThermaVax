import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';

export default function useApiData(path, refreshKey = 0, options = {}) {
  const { refreshIntervalMs = 0 } = options;
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState(current => ({ ...current, error: '', loading: true }));
    try {
      const data = await api(path);
      setState({ data, error: '', loading: false });
    } catch (error) {
      setState(current => ({ data: silent ? current.data : null, error: error.message, loading: false }));
    }
  }, [path]);

  useEffect(() => {
    load();
    if (!refreshIntervalMs) return undefined;
    const intervalId = window.setInterval(() => load({ silent: true }), refreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [load, refreshKey, refreshIntervalMs]);

  return { ...state, reload: load };
}
