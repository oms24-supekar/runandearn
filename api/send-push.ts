import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface Payload {
  title: string;
  body: string;
  url?: string;
  target_user_id?: string;
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:noreply@example.com';
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      res.status(500).json({ error: 'VAPID keys not configured' });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: user, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user?.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const callerId = user.user.id;

    const payload: Payload = req.body;
    if (!payload?.title || !payload?.body) {
      res.status(400).json({ error: 'title and body required' });
      return;
    }

    // Use service role to read subscriptions
    const admin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const targetUser = payload.target_user_id ?? callerId;
    const { data: subs, error: subsErr } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', targetUser);

    if (subsErr) {
      res.status(500).json({ error: subsErr.message });
      return;
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const notification = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url ?? '/',
    });

    const results = await Promise.allSettled(
      (subs ?? []).map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          notification
        )
      )
    );

    const dead: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const status = (r.reason as any)?.statusCode;
        if (status === 404 || status === 410) {
          dead.push(subs![i].id);
        }
      }
    });
    if (dead.length > 0) {
      await admin.from('push_subscriptions').delete().in('id', dead);
    }

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    res.status(200).json({ sent, total: results.length });
  } catch (e) {
    console.error('send-push error:', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
}