import * as vscode from 'vscode';

type ChannelType = 'channels' | 'dms' | 'public' | 'private' | 'dm';

export class SlackItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly type: ChannelType,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly unreadCount: number = 0,
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
        break;
      case 'private':
        this.iconPath = new vscode.ThemeIcon('lock');
        this.description = unreadCount > 0 ? `${unreadCount}` : '';
        this.tooltip = `🔒 ${label}${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`;
        break;
      case 'dm':
        this.iconPath = new vscode.ThemeIcon('account');
        this.description = unreadCount > 0 ? `${unreadCount}` : '';
        this.tooltip = `DM: ${label}${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`;
        break;
    }
  }
}

interface MockChannel {
  name: string;
  type: ChannelType;
  unread: number;
}

interface MockDM {
  name: string;
  unread: number;
}

const MOCK_CHANNELS: MockChannel[] = [
  { name: 'general', type: 'public', unread: 3 },
  { name: 'random', type: 'public', unread: 0 },
  { name: 'dev-team', type: 'private', unread: 12 },
  { name: 'design', type: 'private', unread: 0 },
  { name: 'announcements', type: 'private', unread: 1 },
  { name: 'help-desk', type: 'private', unread: 0 },
];

const MOCK_DMS: MockDM[] = [
  { name: 'Alice Johnson', unread: 2 },
  { name: 'Bob Smith', unread: 0 },
  { name: 'Carol White', unread: 5 },
  { name: 'Dave Brown', unread: 0 },
];

export class SlackTreeDataProvider implements vscode.TreeDataProvider<SlackItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SlackItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SlackItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SlackItem): SlackItem[] {
    if (!element) {
      // Root level: return section headers
      return [
        new SlackItem('Channels', 'channels', vscode.TreeItemCollapsibleState.Expanded),
        new SlackItem('Direct Messages', 'dms', vscode.TreeItemCollapsibleState.Expanded),
      ];
    }

    if (element.label === 'Channels') {
      return MOCK_CHANNELS.map(
        (ch) =>
          new SlackItem(
            `${ch.name}`,
            ch.type,
            vscode.TreeItemCollapsibleState.None,
            ch.unread,
          ),
      );
    }

    if (element.label === 'Direct Messages') {
      return MOCK_DMS.map(
        (dm) =>
          new SlackItem(
            dm.name,
            'dm',
            vscode.TreeItemCollapsibleState.None,
            dm.unread,
          ),
      );
    }

    return [];
  }
}
