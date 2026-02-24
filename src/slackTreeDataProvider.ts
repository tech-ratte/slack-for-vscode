import * as vscode from 'vscode';
import { SlackApiClient, SlackChannel } from './slackApiClient';
import { SlackAuthManager } from './slackAuthManager';

// ─── Types ────────────────────────────────────────────────────────────────────

type ChannelType = 'channels' | 'dms' | 'public' | 'private' | 'dm' | 'add-dm' | 'info';

const PINNED_DMS_KEY = 'slack-for-vscode.pinnedDMs';

export interface PinnedDM {
  userId: string;
  userName: string;
  dmId: string;
  unread_count?: number;
}

// ─── Tree Item ────────────────────────────────────────────────────────────────

export class SlackItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly type: ChannelType,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly unreadCount: number = 0,
    public readonly conversationId?: string,
    /** User ID — set for `dm` items to support remove-DM command. */
    public readonly userId?: string,
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
        this.tooltip = `# ${label}${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`;
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

      case 'add-dm':
        this.iconPath = new vscode.ThemeIcon('person-add');
        this.tooltip = 'Search and add a direct message';
        this.command = { command: 'slack-for-vscode.addDm', title: 'Add DM' };
        break;

      case 'info':
        this.iconPath = new vscode.ThemeIcon('info');
        break;
    }
  }
}

// ─── Tree Data Provider ───────────────────────────────────────────────────────

export class SlackTreeDataProvider implements vscode.TreeDataProvider<SlackItem> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<SlackItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _channels: SlackChannel[] = [];
  private _pinnedDMs: PinnedDM[] = [];
  private _loaded = false;
  private _loading = false;
  private _error: string | undefined;

  constructor(
    private readonly authManager: SlackAuthManager,
    private readonly context: vscode.ExtensionContext,
  ) {
    // Restore persisted DM list from previous session
    this._pinnedDMs = this.context.globalState.get<PinnedDM[]>(PINNED_DMS_KEY, []);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Clear cached data and re-trigger the tree load. */
  refresh(): void {
    this._loaded = false;
    this._channels = [];
    this._error = undefined;
    this._onDidChangeTreeData.fire();
  }

  /** Add a user to the pinned DM list. Silently ignores duplicates. */
  async addDM(userId: string, userName: string, dmId: string): Promise<void> {
    if (this._pinnedDMs.some((d) => d.userId === userId)) { return; }
    this._pinnedDMs = [...this._pinnedDMs, { userId, userName, dmId }];
    await this.context.globalState.update(PINNED_DMS_KEY, this._pinnedDMs);
    this._onDidChangeTreeData.fire();
  }

  /** Remove a user from the pinned DM list by user ID. */
  async removeDM(userId: string): Promise<void> {
    this._pinnedDMs = this._pinnedDMs.filter((d) => d.userId !== userId);
    await this.context.globalState.update(PINNED_DMS_KEY, this._pinnedDMs);
    this._onDidChangeTreeData.fire();
  }

  // ── TreeDataProvider ───────────────────────────────────────────────────────

  getTreeItem(element: SlackItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SlackItem): Promise<SlackItem[]> {
    if (!element) {
      return this._getRootItems();
    }
    switch (element.type) {
      case 'channels': return this._getChannelItems();
      case 'dms':      return this._getDMItems();
      default:         return [];
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _getRootItems(): Promise<SlackItem[]> {
    if (!this._loaded && !this._loading) {
      await this._loadData();
    }

    if (this._loading) {
      return [new SlackItem('Loading...', 'info', vscode.TreeItemCollapsibleState.None)];
    }

    if (this._error) {
      const errorItem = new SlackItem(this._error, 'info', vscode.TreeItemCollapsibleState.None);
      errorItem.iconPath = new vscode.ThemeIcon('error');

      const fixItem = new SlackItem(
        'Run "Slack: Set Token" to fix',
        'info',
        vscode.TreeItemCollapsibleState.None,
      );
      fixItem.iconPath = new vscode.ThemeIcon('key');
      fixItem.command = { command: 'slack-for-vscode.setToken', title: 'Set Token' };

      return [errorItem, fixItem];
    }

    return [
      new SlackItem('Channels', 'channels', vscode.TreeItemCollapsibleState.Expanded),
      new SlackItem('Direct Messages', 'dms', vscode.TreeItemCollapsibleState.Expanded),
    ];
  }

  private _getChannelItems(): SlackItem[] {
    if (this._channels.length === 0) {
      return [new SlackItem('No channels found.', 'info', vscode.TreeItemCollapsibleState.None)];
    }
    return this._channels.map(
      (ch) => new SlackItem(
        ch.name,
        ch.is_private ? 'private' : 'public',
        vscode.TreeItemCollapsibleState.None,
        ch.unread_count ?? 0,
        ch.id,
      ),
    );
  }

  private _getDMItems(): SlackItem[] {
    const dmItems = this._pinnedDMs.map(
      (dm) => new SlackItem(
        dm.userName,
        'dm',
        vscode.TreeItemCollapsibleState.None,
        dm.unread_count ?? 0,
        dm.dmId,
        dm.userId,
      ),
    );
    // Always show "Add DM" as the last item in the section
    const addButton = new SlackItem('Add DM', 'add-dm', vscode.TreeItemCollapsibleState.None);
    return [...dmItems, addButton];
  }

  /** Load channel data from the Slack API. DMs come from globalState, not the API. */
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

      const auth = await client.testAuth();
      if (!auth.ok) {
        this._error = auth.errorMessage ?? `Token error: ${auth.error ?? 'unknown'}`;
        return;
      }

      const channels = await client.getChannels();
      this._channels = channels.sort((a, b) => a.name.localeCompare(b.name));
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
