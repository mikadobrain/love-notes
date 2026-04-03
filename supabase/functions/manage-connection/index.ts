// Supabase Edge Function: manage-connection
// Handles connection request actions: send, accept, reject.
// Writes audit log entries for each action.
//
// Input:  { action: 'send' | 'accept' | 'reject'; connection_id?: string; target_id?: string }
// Output: { success: boolean; connection_id?: string }

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
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { action, connection_id, target_id } = await req.json();

  if (action === 'send') {
    if (!target_id) {
      return new Response(JSON.stringify({ error: 'Missing target_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await adminClient
      .from('connections')
      .insert({ requester_id: user.id, target_id, status: 'pending' })
      .select('id')
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await adminClient.from('audit_log').insert({
      event_type: 'connection_requested',
      actor_id: user.id,
      target_id,
      resource_id: data.id,
    });

    return new Response(JSON.stringify({ success: true, connection_id: data.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'accept' || action === 'reject') {
    if (!connection_id) {
      return new Response(JSON.stringify({ error: 'Missing connection_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';
    const { error } = await adminClient
      .from('connections')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', connection_id)
      .eq('target_id', user.id); // Only the target can accept/reject

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await adminClient.from('audit_log').insert({
      event_type: action === 'accept' ? 'connection_accepted' : 'connection_rejected',
      actor_id: user.id,
      resource_id: connection_id,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
