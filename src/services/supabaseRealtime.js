import { createClient } from '@supabase/supabase-js';
import { getAccessToken } from './api';

let realtimeClient = null;

function supabaseUrl() {
  return import.meta.env.VITE_SUPABASE_URL
    || (import.meta.env.VITE_SUPABASE_PROJECT_ID ? `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
}

export function getRealtimeClient() {
  const url = supabaseUrl();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  if (!realtimeClient) {
    realtimeClient = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      realtime: {
        params: { eventsPerSecond: 5 }
      }
    });
  }
  const accessToken = getAccessToken();
  if (accessToken) realtimeClient.realtime.setAuth(accessToken);
  return realtimeClient;
}
