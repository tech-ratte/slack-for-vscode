import * as https from 'https';

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Custom error class for Slack API failures to keep error codes and messages together. */
export class SlackError extends Error {
  constructor(
    public readonly code: string,
    public readonly needed?: string,
    message?: string,
  ) {
    super(message || explainError(code, needed));
    this.name = 'SlackError';
  }
}

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members?: number;
  unread_count?: number;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  is_bot: boolean;
  deleted: boolean;
  profile: {
    display_name: string;
    real_name: string;
  };
}

export interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  reactions?: SlackReaction[];
  ts: string;
}

export interface SlackReaction {
  name: string;
  count: number;
  users?: string[];
}

// ─── Internal API Response Shape ─────────────────────────────────────────────

interface SlackApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  needed?: string;
  channels?: T[];
  ims?: { id: string; user: string }[];
  members?: SlackUser[];
  messages?: T[];
  channel?: { id: string; last_read?: string; unread_count?: number };
  message?: { ts: string };
  user?: {
    id: string;
    name: string;
    real_name: string;
    profile: { display_name: string; real_name: string };
  };
  response_metadata?: { next_cursor?: string };
  team?: string;
  user_id?: string;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function httpsPost(url: string, body: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });

    req.on('error', (err) => {
      console.error('[httpsPost] Connection error:', err);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

function explainError(error: string, needed?: string): string {
  switch (error) {
    case 'invalid_auth':
      return 'Token is invalid. Please check your Slack token.';
    case 'not_authed':
      return 'No token provided. Please set your token via "Slack: Set Token".';
    case 'missing_scope':
      return `Missing required OAuth scope: ${needed ?? '(unknown)'}. Please add it to your Slack App settings.`;
    case 'ratelimited':
      return 'Rate limited by Slack. Please wait a moment and refresh.';
    case 'channel_not_found':
      return 'Channel or DM not found. It might have been deleted or you lack permission.';
    case 'is_archived':
      return 'This channel is archived.';
    default:
      return `Slack API error: ${error}`;
  }
}

async function withConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        console.error('[withConcurrencyLimit] Task failed:', err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─── API Client ───────────────────────────────────────────────────────────────

export class SlackApiClient {
  private readonly baseUrl = 'https://slack.com/api';
  private myUserId: string | undefined;

  constructor(private readonly token: string) {}

  private async call<T = unknown>(
    method: string,
    params: Record<string, string> = {},
  ): Promise<SlackApiResponse<T>> {
    const body = new URLSearchParams(params).toString();
    const raw = await httpsPost(`${this.baseUrl}/${method}`, body, this.token);
    const res = JSON.parse(raw) as SlackApiResponse<T>;
    if (!res.ok && res.error) {
      throw new SlackError(res.error, res.needed);
    }
    return res;
  }

  async testAuth(): Promise<{
    ok: boolean;
    team?: string;
    user?: string;
    error?: string;
    errorMessage?: string;
  }> {
    try {
      const res = await this.call('auth.test');
      this.myUserId = res.user_id;
      return { ok: true, team: res.team, user: res.user_id };
    } catch (err) {
      if (err instanceof SlackError) {
        return { ok: false, error: err.code, errorMessage: err.message };
      }
      return { ok: false, error: 'unknown', errorMessage: String(err) };
    }
  }

  async getChannels(): Promise<SlackChannel[]> {
    const channels = await this._listAllChannels();
    await withConcurrencyLimit(channels, 5, async (ch) => {
      ch.unread_count = await this._fetchUnreadCount(ch.id);
    });
    return channels;
  }

  private async _listAllChannels(): Promise<SlackChannel[]> {
    const results: SlackChannel[] = [];
    let cursor = '';
    do {
      const params: Record<string, string> = {
        types: 'public_channel,private_channel',
        exclude_archived: 'true',
        limit: '200',
      };
      if (cursor) { params.cursor = cursor; }
      const res = await this.call<SlackChannel>('conversations.list', params);
      results.push(...(res.channels ?? []).filter((ch) => ch.is_member));
      cursor = res.response_metadata?.next_cursor ?? '';
    } while (cursor);
    return results;
  }

  /**
   * Tries to find or open a DM conversation with a user.
   * IMPROVEMENT: First check existing IM list to avoid scope-intensive `conversations.open`.
   */
  async openDMConversation(userId: string): Promise<string> {
    // Stage 1: Check existing DMs (requires im:read or similar, much safer)
    try {
      const existingDmId = await this._findExistingDM(userId);
      if (existingDmId) { return existingDmId; }
    } catch (err) {
      console.warn('[SlackApiClient] Failed to check existing DMs, falling back to open:', err);
    }

    // Stage 2: Try to open (requires im:write)
    const res = await this.call('conversations.open', { users: userId });
    const dmId = res.channel?.id;
    if (!dmId) { throw new Error('Failed to obtain DM channel ID.'); }
    return dmId;
  }

  private async _findExistingDM(userId: string): Promise<string | undefined> {
    let cursor = '';
    do {
      const params: Record<string, string> = {
        types: 'im',
        limit: '200',
      };
      if (cursor) { params.cursor = cursor; }
      const res = await this.call('conversations.list', params);
      const items = (res.channels || res.ims || []) as any[];
      const im = items.find((i) => i.user === userId);
      if (im) { return im.id; }
      cursor = res.response_metadata?.next_cursor ?? '';
    } while (cursor);
    return undefined;
  }

  async listUsers(): Promise<SlackUser[]> {
    const results: SlackUser[] = [];
    let cursor = '';
    do {
      const params: Record<string, string> = { limit: '200' };
      if (cursor) { params.cursor = cursor; }
      const res = await this.call('users.list', params);
      results.push(...(res.members ?? []).filter((u) => !u.is_bot && !u.deleted));
      cursor = res.response_metadata?.next_cursor ?? '';
    } while (cursor);
    return results;
  }

  async getUserName(userId: string): Promise<string> {
    const res = await this.call('users.info', { user: userId });
    if (!res.user) { return userId; }
    const { profile, name } = res.user;
    return profile.display_name || profile.real_name || name || userId;
  }

  async getConversationHistory(conversationId: string, limit = 50): Promise<SlackMessage[]> {
    const res = await this.call<SlackMessage>('conversations.history', {
      channel: conversationId,
      limit: String(limit),
    });
    return res.messages ?? [];
  }

  async postMessage(conversationId: string, text: string): Promise<string> {
    const res = await this.call('chat.postMessage', { channel: conversationId, text });
    return res.message?.ts ?? '';
  }

  async markAsRead(conversationId: string, ts: string): Promise<void> {
    try {
      await this.call('conversations.mark', { channel: conversationId, ts });
    } catch (err) {
      console.error(`[SlackApiClient] conversations.mark failed for ${conversationId}:`, err);
    }
  }

  private async _fetchUnreadCount(channelId: string): Promise<number> {
    try {
      const infoRes = await this.call('conversations.info', { channel: channelId });
      const lastRead = infoRes.channel?.last_read;
      if (!lastRead || lastRead === '0') { return 0; }

      const histRes = await this.call<SlackMessage>('conversations.history', {
        channel: channelId,
        oldest: lastRead,
        limit: '100',
        inclusive: 'false',
      });

      return (histRes.messages ?? []).filter((m) => {
        if (m.subtype) { return false; }
        if (this.myUserId && m.user === this.myUserId) { return false; }
        return true;
      }).length;
    } catch {
      return 0;
    }
  }
}
