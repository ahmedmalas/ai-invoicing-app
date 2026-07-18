import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey && !url.includes('YOUR_PROJECT') && anonKey !== 'your-anon-key');
}

export function getSupabaseUrl(): string {
  if (!url) throw new Error('Missing VITE_SUPABASE_URL');
  return url.replace(/\/$/, '');
}

export function getAnonKey(): string {
  if (!anonKey) throw new Error('Missing VITE_SUPABASE_ANON_KEY');
  return anonKey;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase env vars are not configured. Copy .env.example to .env and set keys.');
  }
  if (!client) {
    client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
