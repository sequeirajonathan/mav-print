import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { debugLog } from './debug';

/**
 * The print agent holds no credentials of its own. The MAV web app, after a
 * print-agent account signs in, hands over its Supabase URL, publishable key
 * and a short-lived access token (and every refreshed token after that).
 * Row level security limits that token to reading and updating print jobs.
 */
export interface AgentSession {
  accessToken: string;
  expiresAt: number;
  userId: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

let supabase: SupabaseClient | null = null;
let clientKey = '';
let accessToken: string | null = null;

export function isValidSession(value: unknown): value is AgentSession {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  if (typeof s.accessToken !== 'string' || typeof s.userId !== 'string') return false;
  if (typeof s.supabaseUrl !== 'string' || typeof s.supabasePublishableKey !== 'string') return false;
  try {
    const url = new URL(s.supabaseUrl);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.protocol === 'https:' || (isLocal && url.protocol === 'http:');
  } catch {
    return false;
  }
}

/** Applies a session from the web app (null = signed out). Returns the client, if any. */
export function setAgentSession(session: AgentSession | null): SupabaseClient | null {
  if (!session) {
    accessToken = null;
    if (supabase) {
      void supabase.removeAllChannels();
      supabase = null;
      clientKey = '';
    }
    debugLog('Print agent signed out; Supabase client cleared');
    return null;
  }

  accessToken = session.accessToken;
  const key = `${session.supabaseUrl}|${session.supabasePublishableKey}`;
  if (!supabase || key !== clientKey) {
    if (supabase) void supabase.removeAllChannels();
    supabase = createClient(session.supabaseUrl, session.supabasePublishableKey, {
      // Requests and Realtime use the token handed over by the web app.
      accessToken: async () => accessToken,
    });
    clientKey = key;
    debugLog('Supabase client created for', session.supabaseUrl);
  }
  // Push the fresh token to open Realtime channels.
  void supabase.realtime.setAuth(session.accessToken);
  return supabase;
}

export function getSupabaseClient(): SupabaseClient | null {
  return accessToken ? supabase : null;
}
