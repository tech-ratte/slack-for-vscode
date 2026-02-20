import * as vscode from 'vscode';
import { SlackApiClient, SlackMessage, SlackReaction } from './slackApiClient';
import { SlackAuthManager } from './slackAuthManager';

export type ConversationKind = 'channel' | 'dm';

export interface ConversationTarget {
  id: string;
  label: string;
  kind: ConversationKind;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSlackTs(ts: string): string {
  const seconds = Number.parseFloat(ts);
  if (!Number.isFinite(seconds)) {
    return ts;
  }
  return new Date(seconds * 1000).toLocaleString();
}

function getNonce(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return nonce;
}

export class SlackConversationView {
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly userNameCache = new Map<string, string>();

  constructor(private readonly authManager: SlackAuthManager) {}

  async open(target: ConversationTarget): Promise<void> {
    const existing = this.panels.get(target.id);
    if (existing) {
      existing.reveal(existing.viewColumn);
      await this.render(existing, target);
      return;
    }

    const titlePrefix = target.kind === 'dm' ? 'Slack: DM' : 'Slack: #';
    const panel = vscode.window.createWebviewPanel(
      'slackConversation',
      `${titlePrefix}${target.label}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.panels.set(target.id, panel);

    panel.onDidDispose(() => {
      this.panels.delete(target.id);
    });

    panel.webview.onDidReceiveMessage(async (msg: unknown) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }
      const type = (msg as { type?: unknown }).type;
      if (type === 'refresh') {
        await this.render(panel, target);
      }
    });

    await this.render(panel, target);
  }

  private async render(panel: vscode.WebviewPanel, target: ConversationTarget): Promise<void> {
    const token = await this.authManager.getToken();
    if (!token) {
      panel.webview.html = this.getHtml(panel.webview, target, [], 'Slack token not set. Run "Slack: Set Token".');
      return;
    }

    try {
      const client = new SlackApiClient(token);
      const messages = await client.getConversationHistory(target.id, 50);
      const enriched = await this.enrichMessages(client, messages);
      panel.webview.html = this.getHtml(panel.webview, target, enriched);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      panel.webview.html = this.getHtml(panel.webview, target, [], msg);
    }
  }

  private async enrichMessages(client: SlackApiClient, messages: SlackMessage[]): Promise<SlackMessage[]> {
    const userIds: string[] = [];
    const seen = new Set<string>();

    for (const m of messages) {
      if (!m.user) {
        continue;
      }
      if (seen.has(m.user)) {
        continue;
      }
      seen.add(m.user);
      userIds.push(m.user);
      if (userIds.length >= 20) {
        break; // avoid rate limits
      }
    }

    for (const userId of userIds) {
      if (this.userNameCache.has(userId)) {
        continue;
      }
      try {
        const name = await client.getUserName(userId);
        this.userNameCache.set(userId, name);
      } catch {
        this.userNameCache.set(userId, userId);
      }
    }

    return messages;
  }

  private getHtml(
    webview: vscode.Webview,
    target: ConversationTarget,
    messages: SlackMessage[],
    error?: string,
  ): string {
    const nonce = getNonce();
    const csp = [
      `default-src 'none';`,
      `img-src ${webview.cspSource} https: data:;`,
      `style-src ${webview.cspSource} 'unsafe-inline';`,
      `script-src 'nonce-${nonce}';`,
    ].join(' ');

    const header = target.kind === 'dm' ? `DM: ${target.label}` : `#${target.label}`;

    const content = error
      ? `<div class="error">${escapeHtml(error)}</div>`
      : this.renderMessages(messages);

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(header)}</title>
    <style>
      :root {
        --bg: var(--vscode-editor-background);
        --fg: var(--vscode-editor-foreground);
        --muted: var(--vscode-descriptionForeground);
        --border: var(--vscode-editorWidget-border);
        --accent: var(--vscode-button-background);
        --accent-fg: var(--vscode-button-foreground);
        --error: var(--vscode-errorForeground);
      }

      body {
        margin: 0;
        padding: 0;
        color: var(--fg);
        background: var(--bg);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .topbar {
        position: sticky;
        top: 0;
        background: color-mix(in srgb, var(--bg) 88%, black);
        border-bottom: 1px solid var(--border);
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      button {
        border: 0;
        background: var(--accent);
        color: var(--accent-fg);
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
      }

      .container {
        padding: 12px;
      }

      .msg {
        padding: 10px 0;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
      }

      .meta {
        color: var(--muted);
        margin-bottom: 4px;
        font-size: 12px;
      }

      .text {
        white-space: pre-wrap;
        word-break: break-word;
      }

      .reactions {
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .reaction {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
        color: var(--muted);
        background: color-mix(in srgb, var(--bg) 90%, black);
      }

      .error {
        color: var(--error);
        padding: 12px;
        border: 1px solid color-mix(in srgb, var(--error) 35%, transparent);
        border-radius: 8px;
        background: color-mix(in srgb, var(--bg) 92%, red);
      }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="title">${escapeHtml(header)}</div>
      <button id="refresh">Refresh</button>
    </div>
    <div class="container">
      ${content}
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.getElementById('refresh')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh' });
      });
      function scrollToBottom() {
        window.scrollTo(0, document.body.scrollHeight);
      }
      window.onload = scrollToBottom;
    </script>
  </body>
</html>`;
  }

  private renderMessages(messages: SlackMessage[]): string {
    const ordered = [...messages].reverse(); // Slack returns newest first

    if (ordered.length === 0) {
      return `<div class="meta">No messages.</div>`;
    }

    return ordered
      .map((m) => {
        const who = this.getDisplayName(m);
        const when = formatSlackTs(m.ts);
        const text = m.text ?? '';
        const reactions = this.renderReactions(m.reactions);
        return `<div class="msg">
  <div class="meta">${escapeHtml(who)} · ${escapeHtml(when)}</div>
  <div class="text">${escapeHtml(text)}</div>
  ${reactions}
</div>`;
      })
      .join('\n');
  }

  private renderReactions(reactions: SlackReaction[] | undefined): string {
    const list = (reactions ?? []).filter((r) => r?.name && typeof r.count === 'number' && r.count > 0);
    if (list.length === 0) {
      return '';
    }

    const nodes = list
      .slice(0, 24)
      .map((r) => `<span class="reaction">:${escapeHtml(r.name)}: ${r.count}</span>`)
      .join('');

    return `<div class="reactions">${nodes}</div>`;
  }

  private getDisplayName(m: SlackMessage): string {
    if (m.user) {
      return this.userNameCache.get(m.user) ?? m.user;
    }
    if (m.username) {
      return m.username;
    }
    if (m.bot_id) {
      return `bot:${m.bot_id}`;
    }
    return 'unknown';
  }
}
