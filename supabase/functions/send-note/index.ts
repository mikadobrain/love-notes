// Supabase Edge Function: send-note
// Validates connection, rate limits, and relays encrypted note to recipient.
// This is the ONLY way to write to message_queue – no direct client access.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Authenticate the request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's auth token
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service role client for writing to message_queue and audit_log
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get authenticated user
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Parse and validate request body
    const { recipient_id, encrypted_payload } = await req.json();

    if (!recipient_id || !encrypted_payload) {
      return new Response(
        JSON.stringify({ error: 'Missing recipient_id or encrypted_payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (typeof encrypted_payload !== 'string' || encrypted_payload.length > 10000) {
      return new Response(
        JSON.stringify({ error: 'Payload too large (max ~1000 chars message)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (recipient_id === user.id) {
      return new Response(
        JSON.stringify({ error: 'Cannot send notes to yourself' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Check if an accepted connection exists
    const { data: connection, error: connError } = await adminClient
      .from('connections')
      .select('id, status')
      .or(
        `and(requester_id.eq.${user.id},target_id.eq.${recipient_id}),and(requester_id.eq.${recipient_id},target_id.eq.${user.id})`
      )
      .eq('status', 'accepted')
      .maybeSingle();

    if (connError || !connection) {
      // Log the attempt
      await adminClient.from('audit_log').insert({
        event_type: 'note_rejected_no_connection',
        actor_id: user.id,
        target_id: recipient_id,
        metadata: {},
      });

      return new Response(
        JSON.stringify({ error: 'No accepted connection with this user' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Rate limiting: max 20 notes per hour, max 5 to same recipient per day
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: hourlyCount } = await adminClient
      .from('audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'note_sent')
      .eq('actor_id', user.id)
      .gte('created_at', oneHourAgo);

    if ((hourlyCount ?? 0) >= 20) {
      await adminClient.from('audit_log').insert({
        event_type: 'rate_limit_hit',
        actor_id: user.id,
        metadata: { rate_limit_window: 'hourly', count: hourlyCount },
      });

      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded (max 20/hour)' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dailyToRecipient } = await adminClient
      .from('audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'note_sent')
      .eq('actor_id', user.id)
      .eq('target_id', recipient_id)
      .gte('created_at', oneDayAgo);

    if ((dailyToRecipient ?? 0) >= 5) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded (max 5/day per recipient)' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Insert into message_queue (only service_role can do this)
    const { data: message, error: insertError } = await adminClient
      .from('message_queue')
      .insert({
        recipient_id,
        encrypted_payload,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Error inserting message:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to send note' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Log the event
    const ipHash = req.headers.get('x-forwarded-for') ?? 'unknown';
    await adminClient.from('audit_log').insert({
      event_type: 'note_sent',
      actor_id: user.id,
      target_id: recipient_id,
      resource_id: message.id,
      ip_hash: ipHash, // TODO: Hash this properly in production
    });

    // 7. (Optional) Trigger push notification to recipient
    const { data: recipientProfile } = await adminClient
      .from('profiles')
      .select('fcm_token')
      .eq('id', recipient_id)
      .single();

    // Push notification would be sent here via FCM/Expo Push API
    // For now, the client polls via Realtime subscription

    return new Response(
      JSON.stringify({ success: true, message_id: message.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
