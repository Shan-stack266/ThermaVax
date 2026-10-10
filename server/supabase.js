const path = require('node:path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const projectId = process.env.SUPABASE_PROJECT_ID;
const url = process.env.SUPABASE_URL || (projectId ? `https://${projectId}.supabase.co` : '');
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('SUPABASE_URL (or SUPABASE_PROJECT_ID) and SUPABASE_ANON_KEY are required in .env');
}

const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false
};

function createAnonymousClient() {
  return createClient(url, anonKey, { auth: authOptions });
}

function createUserClient(accessToken) {
  return createClient(url, anonKey, {
    auth: authOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}

function createServiceClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return secretKey ? createClient(url, secretKey, { auth: authOptions }) : null;
}

function statusForError(error) {
  if (error?.code === '23505') return 409;
  if (error?.code === '23503' || error?.code === '23514' || error?.code === 'P0001') return 409;
  if (error?.code === 'P0002' || error?.code === 'PGRST116') return 404;
  if (error?.code === '42501') return 403;
  return Number(error?.status) || 500;
}

function unwrap(result, fallbackStatus) {
  if (!result.error) return result.data;
  const error = new Error(result.error.message || 'Supabase request failed');
  error.status = fallbackStatus || statusForError(result.error);
  error.code = result.error.code;
  throw error;
}

module.exports = { createAnonymousClient, createUserClient, createServiceClient, unwrap };
