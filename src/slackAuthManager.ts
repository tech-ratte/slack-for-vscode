import * as vscode from 'vscode';

const TOKEN_KEY = 'slack-for-vscode.userToken';

export class SlackAuthManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getToken(): Promise<string | undefined> {
    return this.secrets.get(TOKEN_KEY);
  }

  async setToken(token: string): Promise<void> {
    await this.secrets.store(TOKEN_KEY, token);
  }

  async clearToken(): Promise<void> {
    await this.secrets.delete(TOKEN_KEY);
  }

  async hasToken(): Promise<boolean> {
    const token = await this.secrets.get(TOKEN_KEY);
    return token !== undefined && token.trim().length > 0;
  }
}
