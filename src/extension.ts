import * as vscode from 'vscode';
import { SlackAuthManager } from './slackAuthManager';
import { ConversationTarget, SlackConversationView } from './slackConversationView';
import { SlackTreeDataProvider } from './slackTreeDataProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Slack for VSCode is now active!');

  const authManager = new SlackAuthManager(context.secrets);
  const slackProvider = new SlackTreeDataProvider(authManager);
  const conversationView = new SlackConversationView(authManager);

  const treeView = vscode.window.createTreeView('slackChannels', {
    treeDataProvider: slackProvider,
    showCollapseAll: true,
  });

  // Command: Set Slack token
  const setTokenCommand = vscode.commands.registerCommand(
    'slack-for-vscode.setToken',
    async () => {
      const token = await vscode.window.showInputBox({
        title: 'Slack: Set User Token',
        prompt: 'Enter your Slack User Token (xoxp-...)',
        placeHolder: 'xoxp-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Token cannot be empty.';
          }
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

  // Command: Clear Slack token
  const clearTokenCommand = vscode.commands.registerCommand(
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

  // Command: Refresh channels
  const refreshCommand = vscode.commands.registerCommand(
    'slack-for-vscode.refreshChannels',
    () => {
      slackProvider.refresh();
    },
  );

  const openConversationCommand = vscode.commands.registerCommand(
    'slack-for-vscode.openConversation',
    async (target: ConversationTarget | undefined) => {
      if (!target?.id) {
        return;
      }
      await conversationView.open(target);
    },
  );

  context.subscriptions.push(
    treeView,
    setTokenCommand,
    clearTokenCommand,
    refreshCommand,
    openConversationCommand,
  );
}

export function deactivate() {}
