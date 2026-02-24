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

  constructor(
    private readonly authManager: SlackAuthManager,
    private readonly onMessageSent?: () => void,
  ) { }

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
        return;
      }

      if (type === 'sendMessage') {
        const text = (msg as { text?: unknown }).text;
        if (typeof text !== 'string') {
          await panel.webview.postMessage({
            type: 'sendMessageResult',
            ok: false,
            error: 'Invalid message text.',
          });
          return;
        }

        const trimmed = text.trim();
        if (!trimmed) {
          await panel.webview.postMessage({
            type: 'sendMessageResult',
            ok: false,
            error: 'Message is empty.',
          });
          return;
        }

        const token = await this.authManager.getToken();
        if (!token) {
          await panel.webview.postMessage({
            type: 'sendMessageResult',
            ok: false,
            error: 'Slack token not set. Run "Slack: Set Token".',
          });
          return;
        }

        try {
          const client = new SlackApiClient(token);
          const ts = await client.postMessage(target.id, trimmed);
          await client.markAsRead(target.id, ts);
          await panel.webview.postMessage({ type: 'sendMessageResult', ok: true });
          if (this.onMessageSent) {
            this.onMessageSent();
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          await panel.webview.postMessage({ type: 'sendMessageResult', ok: false, error: errorMessage });
        }
      }
    });

    await this.render(panel, target);
  }

  private async render(panel: vscode.WebviewPanel, target: ConversationTarget): Promise<void> {
    const token = await this.authManager.getToken();
    if (!token) {
      panel.webview.html = this.getHtml(panel.webview, target, [], {
        banner: { kind: 'error', message: 'Slack token not set. Run "Slack: Set Token".' },
        canSend: false,
      });
      return;
    }

    try {
      const client = new SlackApiClient(token);
      const messages = await client.getConversationHistory(target.id, 50);
      const enriched = await this.enrichMessages(client, messages);
      panel.webview.html = this.getHtml(panel.webview, target, enriched, { canSend: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      panel.webview.html = this.getHtml(panel.webview, target, [], {
        banner: { kind: 'error', message: msg },
        canSend: true,
      });
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
    options?: { banner?: { kind: 'error' | 'info'; message: string }; canSend: boolean },
  ): string {
    const nonce = getNonce();
    const csp = [
      `default-src 'none';`,
      `img-src ${webview.cspSource} https: data:;`,
      `style-src ${webview.cspSource} 'unsafe-inline';`,
      `script-src 'nonce-${nonce}';`,
    ].join(' ');

    const header = target.kind === 'dm' ? `DM: ${target.label}` : `#${target.label}`;

    const banner =
      options?.banner?.message
        ? options.banner.kind === 'error'
          ? `<div class="banner banner-error">${escapeHtml(options.banner.message)}</div>`
          : `<div class="banner banner-info">${escapeHtml(options.banner.message)}</div>`
        : '';

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

      html, body {
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
      }

      body {
        color: var(--fg);
        background: var(--bg);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
      }

      * {
        box-sizing: border-box;
      }

      .topbar {
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

      button.secondary {
        background: color-mix(in srgb, var(--bg) 70%, var(--accent));
        color: var(--fg);
      }

      button:disabled {
        opacity: 0.6;
        cursor: default;
      }

      .main {
        flex: 1;
        overflow: auto;
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

      .banner {
        padding: 10px 12px;
        border-radius: 8px;
        margin-bottom: 10px;
      }

      .banner-error {
        color: var(--error);
        border: 1px solid color-mix(in srgb, var(--error) 35%, transparent);
        background: color-mix(in srgb, var(--bg) 92%, red);
      }

      .banner-info {
        color: var(--fg);
        border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
        background: color-mix(in srgb, var(--bg) 92%, black);
      }

      .composer {
        flex-shrink: 0;
        border-top: 1px solid var(--border);
        padding: 10px 12px;
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto;
        gap: 8px;
        align-items: center;
        background: color-mix(in srgb, var(--bg) 96%, black);
        min-height: 80px;
      }

      textarea {
        width: 100%;
        min-height: 56px;
        max-height: 180px;
        resize: vertical;
        padding: 8px 10px;
        color: var(--fg);
        background: color-mix(in srgb, var(--bg) 94%, black);
        border: 1px solid var(--border);
        border-radius: 8px;
        font: inherit;
        box-sizing: border-box;
      }

      textarea:disabled {
        opacity: 0.7;
      }

      .composer-meta {
        grid-column: 1 / -1;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        color: var(--muted);
        font-size: 12px;
        min-height: 16px;
      }

      .compose-error {
        color: var(--error);
      }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="title">${escapeHtml(header)}</div>
      <button id="refresh">Refresh</button>
    </div>
    <div class="main" id="main">
      ${banner}
      <div id="messages">
        ${this.renderMessages(messages)}
      </div>
    </div>
    <div class="composer">
      <textarea id="compose" placeholder="Message" ${options?.canSend ? '' : 'disabled'}></textarea>
      <button id="send" ${options?.canSend ? '' : 'disabled'}>Send</button>
      <div class="composer-meta">
        <div class="compose-error" id="composeError"></div>
        <div id="composeHint">${options?.canSend ? '【newline】Enter /【send】Ctrl + Enter' : ''}</div>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.getElementById('refresh')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh' });
      });

      const main = document.getElementById('main');
      const textarea = document.getElementById('compose');
      const sendBtn = document.getElementById('send');
      const errorEl = document.getElementById('composeError');

      function scrollMessagesToBottom() {
        if (!main) return;
        main.scrollTop = main.scrollHeight;
      }

      function setSending(isSending) {
        if (sendBtn) sendBtn.disabled = isSending || sendBtn.dataset.disabled === 'true';
        if (textarea) textarea.disabled = isSending || textarea.dataset.disabled === 'true';
      }

      function clearComposeError() {
        if (errorEl) errorEl.textContent = '';
      }

      function setComposeError(message) {
        if (errorEl) errorEl.textContent = message || '';
        if (message) console.error('[SlackView] Compose error:', message);
      }

      console.log('[SlackView] Initializing webview...');
      console.log('[SlackView] Composer element:', !!document.querySelector('.composer'));
      console.log('[SlackView] Can send:', ${!!options?.canSend});

      function sendCurrent() {
        if (!textarea || textarea.disabled) return;
        const text = textarea.value.trim();
        if (!text) return;
        clearComposeError();
        setSending(true);
        vscode.postMessage({ type: 'sendMessage', text });
      }

      sendBtn?.addEventListener('click', sendCurrent);
      textarea?.addEventListener('keydown', (e) => {
        const isModifierPressed = e.ctrlKey || e.metaKey;
        if (e.key === 'Enter' && isModifierPressed) {
          e.preventDefault();
          sendCurrent();
        }
      });

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'sendMessageResult') {
          setSending(false);
          if (msg.ok) {
            if (textarea) textarea.value = '';
            vscode.postMessage({ type: 'refresh' });
          } else {
            setComposeError(msg.error || 'Failed to send message.');
          }
        }
      });

      window.onload = () => {
        // Send should reflect initial disabled state from HTML attributes.
        if (sendBtn && sendBtn.hasAttribute('disabled')) sendBtn.dataset.disabled = 'true';
        if (textarea && textarea.hasAttribute('disabled')) textarea.dataset.disabled = 'true';
        scrollMessagesToBottom();
      };
    </script>
  </body>
</html>`;
  }

  private renderMessages(messages: SlackMessage[]): string {
    // Exclude system messages (channel_join, etc.) to match unread count logic
    const filtered = messages.filter((m) => !m.subtype);
    const ordered = [...filtered].reverse(); // Slack returns newest first

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
