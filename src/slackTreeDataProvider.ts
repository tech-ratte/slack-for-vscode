import * as vscode from 'vscode';
import { SlackApiClient, SlackChannel, SlackDM } from './slackApiClient';
import { SlackAuthManager } from './slackAuthManager';

type ChannelType = 'channels' | 'dms' | 'public' | 'private' | 'dm' | 'info';

export class SlackItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly type: ChannelType,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly unreadCount: number = 0,
    public readonly conversationId?: string,
  ) {
    super(label, collapsibleState);

    this.contextValue = type;

    switch (type) {
      case 'channels':
        this.iconPath = new vscode.ThemeIcon('organization');
        break;
      case 'dms':
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        break;
      case 'public':
        this.iconPath = new vscode.ThemeIcon('comment');
        this.description = unreadCount > 0 ? `${unreadCount}` : '';
        this.tooltip = `＃ ${label}${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`;
        if (conversationId) {
          this.command = {
            command: 'slack-for-vscode.openConversation',
            title: 'Open Conversation',
            arguments: [{ id: conversationId, label, kind: 'channel' as const }],
          };
        }
        break;
      case 'private':
        this.iconPath = new vscode.ThemeIcon('lock');
        this.description = unreadCount > 0 ? `${unreadCount}` : '';
        this.tooltip = `🔒 ${label}${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`;
        if (conversationId) {
          this.command = {
            command: 'slack-for-vscode.openConversation',
            title: 'Open Conversation',
            arguments: [{ id: conversationId, label, kind: 'channel' as const }],
          };
        }
        break;
      case 'dm':
        this.iconPath = new vscode.ThemeIcon('account');
        this.description = unreadCount > 0 ? `${unreadCount}` : '';
        this.tooltip = `DM: ${label}${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`;
        if (conversationId) {
          this.command = {
            command: 'slack-for-vscode.openConversation',
            title: 'Open Conversation',
            arguments: [{ id: conversationId, label, kind: 'dm' as const }],
          };
        }
        break;
      case 'info':
        this.iconPath = new vscode.ThemeIcon('info');
        break;
    }
  }
}

export class SlackTreeDataProvider implements vscode.TreeDataProvider<SlackItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SlackItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Cached data
  private _channels: SlackChannel[] = [];
  private _dms: SlackDM[] = [];
  private _loaded = false;
  private _loading = false;
  private _error: string | undefined;

  constructor(private readonly authManager: SlackAuthManager) { }

  refresh(): void {
    this._loaded = false;
    this._channels = [];
    this._dms = [];
    this._error = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SlackItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SlackItem): Promise<SlackItem[]> {
    if (!element) {
      // Root level: load data if needed, then return section headers
      if (!this._loaded && !this._loading) {
        await this._loadData();
      }

      if (this._loading) {
        return [new SlackItem('Loading...', 'info', vscode.TreeItemCollapsibleState.None)];
      }

      if (this._error) {
        const errorItem = new SlackItem(this._error, 'info', vscode.TreeItemCollapsibleState.None);
        errorItem.iconPath = new vscode.ThemeIcon('error');

        const fixItem = new SlackItem('Run "Slack: Set Token" to fix', 'info', vscode.TreeItemCollapsibleState.None);
        fixItem.iconPath = new vscode.ThemeIcon('key');
        fixItem.command = {
          command: 'slack-for-vscode.setToken',
          title: 'Set Token',
        };

        return [errorItem, fixItem];
      }

      if (this._channels.length === 0 && this._dms.length === 0) {
        return [new SlackItem('No channels found.', 'info', vscode.TreeItemCollapsibleState.None)];
      }

      return [
        new SlackItem('Channels', 'channels', vscode.TreeItemCollapsibleState.Expanded),
        new SlackItem('Direct Messages', 'dms', vscode.TreeItemCollapsibleState.Expanded),
      ];
    }

    if (element.label === 'Channels') {
      return this._channels.map((ch) => {
        const item = new SlackItem(
          ch.name,
          ch.is_private ? 'private' : 'public',
          vscode.TreeItemCollapsibleState.None,
          ch.unread_count ?? 0,
          ch.id,
        );
        return item;
      });
    }

    if (element.label === 'Direct Messages') {
      return this._dms.map((dm) => {
        const item = new SlackItem(
          dm.userName ?? dm.user,
          'dm',
          vscode.TreeItemCollapsibleState.None,
          dm.unread_count ?? 0,
          dm.id,
        );
        return item;
      });
    }

    return [];
  }

  private async _loadData(): Promise<void> {
    const token = await this.authManager.getToken();
    if (!token) {
      this._error = 'Slack token not set. Use "Slack: Set Token" to configure.';
      this._loaded = true;
      return;
    }

    this._loading = true;
    this._onDidChangeTreeData.fire();

    try {
      const client = new SlackApiClient(token);

      // Verify token first
      const auth = await client.testAuth();
      if (!auth.ok) {
        this._error = auth.errorMessage ?? `Token error: ${auth.error ?? 'unknown'}`;
        return;
      }

      // Fetch channels and DMs in parallel
      const [channels, dms] = await Promise.all([
        client.getChannels(),
        client.getDMs(),
      ]);

      this._channels = channels.sort((a, b) => a.name.localeCompare(b.name));

      // Resolve DM user names in parallel (limit to 20 to avoid rate limits)
      const resolvedDMs = await Promise.all(
        dms.slice(0, 20).map(async (dm) => {
          try {
            dm.userName = await client.getUserName(dm.user);
          } catch {
            dm.userName = dm.user;
          }
          return dm;
        }),
      );

      this._dms = resolvedDMs.sort((a, b) =>
        (a.userName ?? a.user).localeCompare(b.userName ?? b.user),
      );

      this._error = undefined;
    } catch (err) {
      this._error = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this._loading = false;
      this._loaded = true;
      this._onDidChangeTreeData.fire();
    }
  }
}
