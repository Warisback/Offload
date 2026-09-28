// One shared Supabase client (service key, server-side only). Null when not configured.
import { createClient } from '@supabase/supabase-js';
import { config, has } from './config.js';

export const supabase = has.supabase()
  ? createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
