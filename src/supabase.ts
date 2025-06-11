import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { debugLog } from './debug';

interface SupabaseSettings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

let supabase: SupabaseClient | null = null;
let initializationAttempts = 0;
const MAX_INITIALIZATION_ATTEMPTS = 3;
const INITIALIZATION_RETRY_DELAY = 5000; // 5 seconds

function getSettings(): SupabaseSettings {
  const settingsPath = app.isPackaged
    ? path.join(app.getPath('userData'), 'settings.json')
    : path.join(__dirname, '../settings.json');

  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return {
        SUPABASE_URL: settings.SUPABASE_URL || '',
        SUPABASE_SERVICE_ROLE_KEY: settings.SUPABASE_SERVICE_ROLE_KEY || ''
      };
    }
  } catch (error) {
    debugLog('Error loading Supabase settings:', error);
  }
  return { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' };
}

function validateSettings(settings: SupabaseSettings): boolean {
  if (!settings.SUPABASE_URL || !settings.SUPABASE_SERVICE_ROLE_KEY) {
    debugLog('Invalid Supabase settings: Missing URL or service role key');
    return false;
  }

  try {
    new URL(settings.SUPABASE_URL);
    return true;
  } catch (error) {
    debugLog('Invalid Supabase URL:', error);
    return false;
  }
}

export async function initializeSupabase(): Promise<SupabaseClient | null> {
  if (supabase) {
    return supabase;
  }

  const settings = getSettings();
  
  if (!validateSettings(settings)) {
    debugLog('Invalid Supabase settings, cannot initialize client');
    return null;
  }

  try {
    supabase = createClient(
      settings.SUPABASE_URL,
      settings.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Test the connection
    const { error } = await supabase.from('print_jobs').select('count').limit(1);
    if (error) {
      throw error;
    }

    debugLog('Supabase client initialized successfully');
    initializationAttempts = 0;
    return supabase;
  } catch (error) {
    debugLog('Error initializing Supabase client:', error);
    supabase = null;
    
    if (initializationAttempts < MAX_INITIALIZATION_ATTEMPTS) {
      initializationAttempts++;
      debugLog(`Retrying initialization in ${INITIALIZATION_RETRY_DELAY/1000} seconds... (Attempt ${initializationAttempts}/${MAX_INITIALIZATION_ATTEMPTS})`);
      
      return new Promise((resolve) => {
        setTimeout(async () => {
          resolve(await initializeSupabase());
        }, INITIALIZATION_RETRY_DELAY);
      });
    }
    
    return null;
  }
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!supabase) {
    debugLog('Supabase client not initialized, attempting initialization...');
    return null;
  }
  return supabase;
}

export function resetSupabaseClient(): void {
  if (supabase) {
    supabase = null;
    initializationAttempts = 0;
    debugLog('Supabase client reset');
  }
}
