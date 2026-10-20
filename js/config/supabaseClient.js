// Creates the one Supabase client. Use the anon key only. Never put the service role key in this project.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://vphksdvpyjqlidtvdvws.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4W-dtTaeuzivlzSEvzInXQ_V23xHLxu';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
