'use client';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

let supabaseInstance: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  // Only create the client if we have valid credentials
  if (!supabaseInstance && supabaseUrl && supabaseUrl !== 'https://placeholder.supabase.co') {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  } else if (!supabaseInstance) {
    // Return a dummy client for build-time that won't be used
    supabaseInstance = createClient('https://placeholder.supabase.co', 'placeholder-key');
  }
  return supabaseInstance;
}

export const supabase = getSupabase();
