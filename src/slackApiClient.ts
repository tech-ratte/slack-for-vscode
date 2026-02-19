import * as https from 'https';

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members?: number;
  unread_count?: number;
}

export interface SlackDM {
  id: string;
  user: string;       // user ID
  userName?: string;  // resolved display name
  unread_count?: number;
}

export interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  ts: string;
}

interface SlackApiResponse<T> {
  ok: boolean;
  error?: string;
  needed?: string;
  provided?: string;
  channels?: T[];
  ims?: T[];
  messages?: T[];
  user?: { id: string; name: string; real_name: string; profile: { display_name: string; real_name: string } };
  members?: string[];
  response_metadata?: { next_cursor?: string };
  // auth.test fields
  team?: string;
  bot_id?: string;
}

function httpsPost(url: string, body: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
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

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Human-readable explanation for common Slack API errors */
function explainError(error: string, needed?: string): string {
  switch (error) {
    case 'invalid_auth':
      return 'Token is invalid. Make sure you copied the full token (xoxp-... or xoxb-...) correctly.';
    case 'not_authed':
      return 'No token provided. Please set your Slack token via "Slack: Set Token".';
    case 'account_inactive':
      return 'The Slack account associated with this token is deactivated.';
    case 'token_revoked':
      return 'This token has been revoked. Please generate a new token.';
    case 'token_expired':
      return 'This token has expired. Please generate a new token.';
    case 'missing_scope':
      return `Missing required OAuth scope: ${needed ?? '(unknown)'}. Add this scope to your Slack app and reinstall it.`;
    case 'no_permission':
      return 'The token does not have permission to perform this action.';
    case 'ratelimited':
      return 'Rate limited by Slack API. Please wait a moment and refresh.';
    default:
      return `Slack API error: ${error}`;
  }
}

export class SlackApiClient {
  private readonly baseUrl = 'https://slack.com/api';

  constructor(private readonly token: string) {}

  private async call<T>(method: string, params: Record<string, string> = {}): Promise<SlackApiResponse<T>> {
    const body = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/${method}`;
    const raw = await httpsPost(url, body, this.token);
    return JSON.parse(raw) as SlackApiResponse<T>;
  }

  /** Verify the token is valid. Returns the workspace name on success. */
  async testAuth(): Promise<{ ok: boolean; team?: string; user?: string; error?: string; errorMessage?: string }> {
    const res = await this.call<never>('auth.test');
    return {
      ok: res.ok,
      team: res.team,
      user: (res as unknown as { user_id?: string }).user_id,
      error: res.error,
      errorMessage: res.error ? explainError(res.error, res.needed) : undefined,
    };
  }

  /** Fetch all public + private channels the user is a member of. */
  async getChannels(): Promise<SlackChannel[]> {
    const results: SlackChannel[] = [];
    let cursor = '';

    do {
      const params: Record<string, string> = {
        types: 'public_channel,private_channel',
        exclude_archived: 'true',
        limit: '200',
      };
      if (cursor) {
        params['cursor'] = cursor;
      }

      const res = await this.call<SlackChannel>('conversations.list', params);
      if (!res.ok) {
        throw new Error(explainError(res.error ?? 'unknown', res.needed));
      }

      const channels = (res.channels ?? []).filter((ch) => ch.is_member);
      results.push(...channels);
      cursor = res.response_metadata?.next_cursor ?? '';
    } while (cursor);

    return results;
  }

  /** Fetch all DM conversations. */
  async getDMs(): Promise<SlackDM[]> {
    const results: SlackDM[] = [];
    let cursor = '';

    do {
      const params: Record<string, string> = {
        types: 'im',
        exclude_archived: 'true',
        limit: '200',
      };
      if (cursor) {
        params['cursor'] = cursor;
      }

      const res = await this.call<{ id: string; user: string; unread_count?: number }>('conversations.list', params);
      if (!res.ok) {
        throw new Error(explainError(res.error ?? 'unknown', res.needed));
      }

      for (const im of res.channels ?? []) {
        results.push({ id: im.id, user: im.user, unread_count: im.unread_count });
      }

      cursor = res.response_metadata?.next_cursor ?? '';
    } while (cursor);

    return results;
  }

  /** Resolve a user ID to a display name. */
  async getUserName(userId: string): Promise<string> {
    const res = await this.call<never>('users.info', { user: userId });
    if (!res.ok || !res.user) {
      return userId;
    }
    const profile = res.user.profile;
    return profile.display_name || profile.real_name || res.user.name || userId;
  }

  /** Fetch recent messages for a channel/DM by conversation ID. */
  async getConversationHistory(conversationId: string, limit: number = 50): Promise<SlackMessage[]> {
    const res = await this.call<SlackMessage>('conversations.history', {
      channel: conversationId,
      limit: String(limit),
    });
    if (!res.ok) {
      throw new Error(explainError(res.error ?? 'unknown', res.needed));
    }
    return res.messages ?? [];
  }
}
