import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { getRealtimeClient } from '../services/supabaseRealtime';

function newestFirst(readings) {
  return [...readings].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
}

export default function useSensorReadings(refreshKey) {
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState('Connecting');

  useEffect(() => {
    let active = true;
    let channel = null;
    let fallbackTimer = null;

    async function loadLatest({ quiet = false } = {}) {
      if (!quiet) setLoading(true);
      try {
        const latest = await api('/api/sensor-readings/latest?limit=10');
        if (!active) return;
        setReadings(Array.isArray(latest) ? latest : []);
        setError('');
      } catch (loadError) {
        if (active) setError(loadError.message);
      } finally {
        if (active && !quiet) setLoading(false);
      }
    }

    loadLatest();
    const client = getRealtimeClient();
    if (!client) {
      setRealtimeStatus('Polling');
      fallbackTimer = window.setInterval(() => loadLatest({ quiet: true }), 5000);
      return () => {
        active = false;
        window.clearInterval(fallbackTimer);
      };
    }

    channel = client.channel('thermavax-sensor-readings')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'sensor_readings'
      }, payload => {
        setReadings(current => newestFirst([payload.new, ...current.filter(item => item.id !== payload.new.id)]));
        setError('');
      })
      .subscribe(status => {
        if (!active) return;
        setRealtimeStatus(status === 'SUBSCRIBED' ? 'Live' : status === 'CHANNEL_ERROR' ? 'Reconnecting' : 'Connecting');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') loadLatest({ quiet: true });
      });

    fallbackTimer = window.setInterval(() => {
      getRealtimeClient();
      loadLatest({ quiet: true });
    }, 30000);
    return () => {
      active = false;
      window.clearInterval(fallbackTimer);
      if (channel) client.removeChannel(channel);
    };
  }, [refreshKey]);

  return useMemo(() => ({
    readings,
    latest: readings[0] || null,
    loading,
    error,
    realtimeStatus
  }), [readings, loading, error, realtimeStatus]);
}
