// Supabase Edge Function: send-push
// Sends an Expo push notification to a specific user.
//
// Input:  { recipient_id: string; title: string; body: string; data?: object }
// Output: { success: boolean }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Verify the caller is authenticated
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { recipient_id, title, body, data } = await req.json();

    if (!recipient_id || !title || !body) {
      return json({ error: 'Missing recipient_id, title, or body' }, 400);
    }

    // Look up the recipient's push token
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('fcm_token')
      .eq('id', recipient_id)
      .single();

    if (profileError || !profile?.fcm_token) {
      // No token = user has no push enabled, not an error
      return json({ success: true, skipped: true, reason: 'no_push_token' });
    }

    // Send via Expo Push API
    const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: profile.fcm_token,
        title,
        body,
        sound: 'default',
        data: data ?? {},
      }),
    });

    const pushResult = await pushResponse.json();

    if (pushResult.data?.status === 'error') {
      console.error('[send-push] Expo push error:', pushResult.data.message);
      return json({ success: false, error: pushResult.data.message }, 500);
    }

    return json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[send-push] Unhandled error:', err);
    return json({ error: 'Internal server error', detail: message }, 500);
  }
});
