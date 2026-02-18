import * as vscode from 'vscode';

type ChannelType = 'section' | 'channel' | 'dm';

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
      case 'section':
        this.iconPath = new vscode.ThemeIcon('chevron-down');
        break;
      case 'channel':
        this.iconPath = new vscode.ThemeIcon(
          unreadCount > 0 ? 'comment-unresolved' : 'comment',
        );
        this.description = unreadCount > 0 ? `${unreadCount}` : '';
        this.tooltip = `#${label}${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`;
        break;
      case 'dm':
        this.iconPath = new vscode.ThemeIcon(
          unreadCount > 0 ? 'person' : 'person-outline',
        );
        this.description = unreadCount > 0 ? `${unreadCount}` : '';
        this.tooltip = `DM: ${label}${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`;
        break;
    }
  }
}

interface MockChannel {
  name: string;
  unread: number;
}

interface MockDM {
  name: string;
  unread: number;
}

const MOCK_CHANNELS: MockChannel[] = [
  { name: 'general', unread: 3 },
  { name: 'random', unread: 0 },
  { name: 'dev-team', unread: 12 },
  { name: 'design', unread: 0 },
  { name: 'announcements', unread: 1 },
  { name: 'help-desk', unread: 0 },
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
        new SlackItem('Channels', 'section', vscode.TreeItemCollapsibleState.Expanded),
        new SlackItem('Direct Messages', 'section', vscode.TreeItemCollapsibleState.Expanded),
      ];
    }

    if (element.label === 'Channels') {
      return MOCK_CHANNELS.map(
        (ch) =>
          new SlackItem(
            `#${ch.name}`,
            'channel',
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
