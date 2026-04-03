// Supabase Edge Function: check-contacts
// Receives a list of hashed phone numbers / emails from the client
// and returns which of them are registered LoveNotes users.
// This preserves privacy: the server only sees hashes, not plain contact data.
//
// TODO: Implement full logic
// Input:  { hashes: string[] }
// Output: { matches: { hash: string; display_name: string; user_id: string }[] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  const { hashes } = await req.json();
  if (!Array.isArray(hashes) || hashes.length === 0) {
    return new Response(JSON.stringify({ matches: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Look up profiles by phone_hash or email_hash
  const { data, error } = await adminClient
    .from('profiles')
    .select('id, display_name, email_hash, phone_hash')
    .or(hashes.map((h: string) => `email_hash.eq.${h},phone_hash.eq.${h}`).join(','));

  if (error) {
    return new Response(JSON.stringify({ error: 'DB error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const matches = (data ?? []).map((p: { id: string; display_name: string; email_hash: string | null; phone_hash: string | null }) => ({
    user_id: p.id,
    display_name: p.display_name,
    hash: p.email_hash ?? p.phone_hash,
  }));

  return new Response(JSON.stringify({ matches }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
