import * as vscode from 'vscode';
import { SlackTreeDataProvider } from './slackTreeDataProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Slack for VSCode is now active!');

  // Register the Slack channel tree data provider
  const slackProvider = new SlackTreeDataProvider();
  const treeView = vscode.window.createTreeView('slackChannels', {
    treeDataProvider: slackProvider,
    showCollapseAll: true,
  });

  // Register the refresh command
  const refreshCommand = vscode.commands.registerCommand(
    'slack-for-vscode.refreshChannels',
    () => {
      slackProvider.refresh();
      vscode.window.showInformationMessage('Slack channels refreshed!');
    },
  );

  context.subscriptions.push(treeView, refreshCommand);
}

export function deactivate() {}
