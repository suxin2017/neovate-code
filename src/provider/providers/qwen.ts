import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import assert from 'assert';
import { QwenProvider } from 'oauth-providers';
import type { Provider } from './types';

export const qwenProvider: Provider = {
  id: 'qwen',
  source: 'built-in',
  env: [],
  name: 'Qwen',
  doc: 'https://portal.qwen.ai/',
  models: {
    'coder-model': {},
  },
  async createModel(name, provider, options) {
    const apiKey = provider.options?.apiKey;
    assert(apiKey, 'Failed to get Qwen token, use /login to login first');
    let account = JSON.parse(apiKey);
    const qwenProvider = new QwenProvider();
    qwenProvider.setState(account);
    if (qwenProvider.isTokenExpired()) {
      await qwenProvider.refresh();
      account = qwenProvider.getState();
      provider.options = {
        ...provider.options,
        apiKey: JSON.stringify(account),
      };
      options.setGlobalConfig(
        'provider.qwen.options.apiKey',
        JSON.stringify(account),
        true,
      );
    }
    return createOpenAICompatible({
      name: 'qwen',
      baseURL: 'https://portal.qwen.ai/v1/',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
      },
      fetch: options.customFetch as typeof fetch,
    }).chatModel(name);
  },
};
