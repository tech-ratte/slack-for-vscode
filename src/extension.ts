import * as vscode from 'vscode';
import { SlackApiClient } from './slackApiClient';
import { SlackAuthManager } from './slackAuthManager';
import { ConversationTarget, SlackConversationView } from './slackConversationView';
import { SlackItem, SlackTreeDataProvider } from './slackTreeDataProvider';

export function activate(context: vscode.ExtensionContext): void {
  console.log('Slack for VSCode is now active!');

  const authManager = new SlackAuthManager(context.secrets);
  const slackProvider = new SlackTreeDataProvider(authManager, context);
  const conversationView = new SlackConversationView(authManager, () => {
    // Brief delay to let any UI transitions settle before refreshing unread counts.
    setTimeout(() => slackProvider.refresh(), 100);
  });

  const treeView = vscode.window.createTreeView('slackChannels', {
    treeDataProvider: slackProvider,
    showCollapseAll: true,
  });

  // ── Commands ───────────────────────────────────────────────────────────────

  const setTokenCmd = vscode.commands.registerCommand(
    'slack-for-vscode.setToken',
    async () => {
      const token = await vscode.window.showInputBox({
        title: 'Slack: Set User Token',
        prompt: 'Enter your Slack User Token (xoxp-...)',
        placeHolder: 'xoxp-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value.trim()) { return 'Token cannot be empty.'; }
          if (!value.trim().startsWith('xoxp-') && !value.trim().startsWith('xoxb-')) {
            return 'Token should start with xoxp- (user token) or xoxb- (bot token).';
          }
          return undefined;
        },
      });

      if (token) {
        await authManager.setToken(token.trim());
        vscode.window.showInformationMessage('Slack token saved. Loading channels...');
        slackProvider.refresh();
      }
    },
  );

  const clearTokenCmd = vscode.commands.registerCommand(
    'slack-for-vscode.clearToken',
    async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to remove the Slack token?',
        { modal: true },
        'Remove',
      );
      if (confirm === 'Remove') {
        await authManager.clearToken();
        vscode.window.showInformationMessage('Slack token removed.');
        slackProvider.refresh();
      }
    },
  );

  const refreshCmd = vscode.commands.registerCommand(
    'slack-for-vscode.refreshChannels',
    () => slackProvider.refresh(),
  );

  const openConversationCmd = vscode.commands.registerCommand(
    'slack-for-vscode.openConversation',
    async (target: ConversationTarget | undefined) => {
      if (!target?.id) { return; }
      await conversationView.open(target);
    },
  );

  /**
   * Add DM command: shows a searchable QuickPick of workspace users,
   * opens/retrieves the DM conversation, and persists the choice.
   */
  const addDmCmd = vscode.commands.registerCommand(
    'slack-for-vscode.addDm',
    async () => {
      const token = await authManager.getToken();
      if (!token) {
        vscode.window.showErrorMessage('Slack token not set. Use "Slack: Set Token" first.');
        return;
      }

      const client = new SlackApiClient(token);

      // Create a QuickPick so we can show a loading spinner while fetching
      type UserPickItem = vscode.QuickPickItem & { userId: string };
      const qp = vscode.window.createQuickPick<UserPickItem>();
      qp.placeholder = 'Type a name to search users…';
      qp.busy = true;
      qp.ignoreFocusOut = true;
      qp.matchOnDescription = true;
      qp.show();

      try {
        const users = await client.listUsers();
        qp.items = users.map((u) => ({
          label: u.profile.display_name || u.real_name || u.name,
          description: u.name,
          userId: u.id,
        }));
      } catch (err) {
        qp.hide();
        vscode.window.showErrorMessage(
          `Failed to load users: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      } finally {
        qp.busy = false;
      }

      qp.onDidAccept(async () => {
        const selected = qp.selectedItems[0] as UserPickItem | undefined;
        qp.hide();
        if (!selected) { return; }

        try {
          const dmId = await client.openDMConversation(selected.userId);
          await slackProvider.addDM(selected.userId, selected.label, dmId);
        } catch (err) {
          let message = err instanceof Error ? err.message : String(err);
          
          // Specific guidance for im:write scope error
          if (message.includes('im:write')) {
            message = 'Failed to add DM: The "im:write" scope is missing.\n\nTo fix this:\n1. Open your Slack App settings.\n2. Add "im:write" to User Token Scopes.\n3. Reinstall the app to your workspace.';
          }
          
          vscode.window.showErrorMessage(message, { modal: true });
        }
      });

      qp.onDidHide(() => qp.dispose());
    },
  );

  /** Remove DM command: called from a tree item's inline/context menu button. */
  const removeDmCmd = vscode.commands.registerCommand(
    'slack-for-vscode.removeDm',
    async (item: SlackItem | undefined) => {
      if (!item?.userId) { return; }

      const confirm = await vscode.window.showWarningMessage(
        `Remove "${item.label}" from Direct Messages?`,
        { modal: true },
        'Remove',
      );
      if (confirm === 'Remove') {
        await slackProvider.removeDM(item.userId);
      }
    },
  );

  context.subscriptions.push(
    treeView,
    setTokenCmd,
    clearTokenCmd,
    refreshCmd,
    openConversationCmd,
    addDmCmd,
    removeDmCmd,
  );
}

export function deactivate(): void {}
