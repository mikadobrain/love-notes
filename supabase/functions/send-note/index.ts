// Supabase Edge Function: send-note
// Validates connection, rate limits, and relays encrypted note to recipient.
// This is the ONLY way to write to message_queue – no direct client access.

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

async function writeLog(
  adminClient: ReturnType<typeof createClient>,
  level: 'debug' | 'info' | 'warn' | 'error',
  module: string,
  message: string,
  userId: string | null,
  meta?: object
) {
  try {
    await adminClient.from('app_logs').insert({
      user_id: userId,
      level,
      module,
      message,
      metadata: meta ?? null,
    });
  } catch {
    // Logging must never crash the function
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  let userId: string | null = null;

  try {
    // ── 1. Authenticate ──────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      await writeLog(adminClient, 'warn', 'send-note', 'Request missing Authorization header', null);
      return json({ error: 'Missing authorization header' }, 401);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      await writeLog(adminClient, 'warn', 'send-note', 'Auth failed', null, { authError });
      return json({ error: 'Unauthorized' }, 401);
    }
    userId = user.id;

    // ── 2. Parse body ────────────────────────────────────────────────────────
    let body: { recipient_id?: string; encrypted_payload?: string };
    try {
      body = await req.json();
    } catch {
      await writeLog(adminClient, 'warn', 'send-note', 'Invalid JSON body', userId);
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { recipient_id, encrypted_payload } = body;

    if (!recipient_id || !encrypted_payload) {
      await writeLog(adminClient, 'warn', 'send-note', 'Missing fields', userId, {
        has_recipient: !!recipient_id,
        has_payload: !!encrypted_payload,
      });
      return json({ error: 'Missing recipient_id or encrypted_payload' }, 400);
    }

    if (typeof encrypted_payload !== 'string' || encrypted_payload.length > 10000) {
      await writeLog(adminClient, 'warn', 'send-note', 'Payload too large', userId, {
        length: encrypted_payload?.length,
      });
      return json({ error: 'Payload too large (max ~1000 chars message)' }, 400);
    }

    if (recipient_id === userId) {
      return json({ error: 'Cannot send notes to yourself' }, 400);
    }

    // ── 3. Verify accepted connection ────────────────────────────────────────
    const { data: connection, error: connError } = await adminClient
      .from('connections')
      .select('id, status')
      .or(
        `and(requester_id.eq.${userId},target_id.eq.${recipient_id}),` +
        `and(requester_id.eq.${recipient_id},target_id.eq.${userId})`
      )
      .eq('status', 'accepted')
      .maybeSingle();

    if (connError) {
      await writeLog(adminClient, 'error', 'send-note', 'Connection query failed', userId, {
        recipient_id,
        error: connError.message,
        code: connError.code,
      });
      return json({ error: 'Failed to verify connection' }, 500);
    }

    if (!connection) {
      await writeLog(adminClient, 'warn', 'send-note', 'No accepted connection', userId, {
        recipient_id,
      });
      await adminClient.from('audit_log').insert({
        event_type: 'note_rejected_no_connection',
        actor_id: userId,
        target_id: recipient_id,
        metadata: {},
      });
      return json({ error: 'No accepted connection with this user' }, 403);
    }

    // ── 4. Rate limiting ─────────────────────────────────────────────────────
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: hourlyCount } = await adminClient
      .from('audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'note_sent')
      .eq('actor_id', userId)
      .gte('created_at', oneHourAgo);

    if ((hourlyCount ?? 0) >= 20) {
      await writeLog(adminClient, 'warn', 'send-note', 'Rate limit: hourly', userId, {
        count: hourlyCount,
      });
      await adminClient.from('audit_log').insert({
        event_type: 'rate_limit_hit',
        actor_id: userId,
        metadata: { window: 'hourly', count: hourlyCount },
      });
      return json({ error: 'Rate limit exceeded (max 20/hour)' }, 429);
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dailyCount } = await adminClient
      .from('audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'note_sent')
      .eq('actor_id', userId)
      .eq('target_id', recipient_id)
      .gte('created_at', oneDayAgo);

    if ((dailyCount ?? 0) >= 5) {
      await writeLog(adminClient, 'warn', 'send-note', 'Rate limit: daily per recipient', userId, {
        recipient_id,
        count: dailyCount,
      });
      return json({ error: 'Rate limit exceeded (max 5/day per recipient)' }, 429);
    }

    // ── 5. Insert message ────────────────────────────────────────────────────
    const { data: message, error: insertError } = await adminClient
      .from('message_queue')
      .insert({ recipient_id, encrypted_payload })
      .select('id')
      .single();

    if (insertError) {
      await writeLog(adminClient, 'error', 'send-note', 'message_queue insert failed', userId, {
        error: insertError.message,
        code: insertError.code,
        recipient_id,
      });
      return json({ error: 'Failed to queue note' }, 500);
    }

    // ── 6. Audit log ─────────────────────────────────────────────────────────
    await adminClient.from('audit_log').insert({
      event_type: 'note_sent',
      actor_id: userId,
      target_id: recipient_id,
      resource_id: message.id,
    });

    await writeLog(adminClient, 'info', 'send-note', 'Note sent successfully', userId, {
      recipient_id,
      message_id: message.id,
    });

    return json({ success: true, message_id: message.id });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeLog(adminClient, 'error', 'send-note', 'Unhandled exception', userId, {
      error: message,
    });
    console.error('[send-note] Unhandled error:', err);
    return json({ error: 'Internal server error', detail: message }, 500);
  }
});
