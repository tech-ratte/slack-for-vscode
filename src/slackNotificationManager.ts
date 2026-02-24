import * as vscode from 'vscode';
import { SlackApiClient } from './slackApiClient';
import { SlackAuthManager } from './slackAuthManager';

const POLLING_INTERVAL = 60000; // 60 seconds

export class SlackNotificationManager {
  private timer: NodeJS.Timeout | undefined;
  // Map of conversationId -> last known unread count
  private unreadCache: Map<string, number> = new Map();
  private isFirstRun = true;

  constructor(
    private readonly authManager: SlackAuthManager,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /** Start background polling for new messages. */
  async start(): Promise<void> {
    if (this.timer) { return; }
    
    // Initial check
    await this.checkNewMessages();
    
    this.timer = setInterval(() => {
      this.checkNewMessages();
    }, POLLING_INTERVAL);
  }

  /** Stop background polling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async checkNewMessages(): Promise<void> {
    const token = await this.authManager.getToken();
    if (!token) { return; }

    try {
      const client = new SlackApiClient(token);
      
      // We need to know which DMs are pinned to check them
      const pinnedDMs = this.context.globalState.get<{ dmId: string; userName: string }[]>('slack-for-vscode.pinnedDMs', []);
      const channels = await client.getChannels();
      
      const newCache: Map<string, number> = new Map();
      const news: { id: string; name: string; count: number }[] = [];

      // Check channels
      for (const ch of channels) {
        const count = ch.unread_count ?? 0;
        newCache.set(ch.id, count);
        
        if (!this.isFirstRun) {
          const prev = this.unreadCache.get(ch.id) ?? 0;
          if (count > prev) {
            news.push({ id: ch.id, name: `#${ch.name}`, count: count - prev });
          }
        }
      }

      // Check pinned DMs
      for (const dm of pinnedDMs) {
        const count = await client.getUnreadCount(dm.dmId);
        newCache.set(dm.dmId, count);

        if (!this.isFirstRun) {
          const prev = this.unreadCache.get(dm.dmId) ?? 0;
          if (count > prev) {
            news.push({ id: dm.dmId, name: dm.userName, count: count - prev });
          }
        }
      }

      this.unreadCache = newCache;
      this.isFirstRun = false;

      // Show notifications for each conversation with new unread messages
      for (const item of news) {
        this.showNotification(item.id, item.name, item.count);
      }
    } catch (err) {
      console.error('[SlackNotificationManager] Polling failed:', err);
    }
  }

  private async showNotification(id: string, name: string, count: number): Promise<void> {
    const message = count === 1 
      ? `New message in ${name}` 
      : `${count} new messages in ${name}`;

    const action = await vscode.window.showInformationMessage(message, 'Open');
    
    if (action === 'Open') {
      vscode.commands.executeCommand('slack-for-vscode.openConversation', {
        id,
        label: name.startsWith('#') ? name.slice(1) : name,
        kind: name.startsWith('#') ? 'channel' : 'dm'
      });
    }
  }
}
