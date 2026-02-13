import { ApiFormat, type Provider } from './types';

export const openaiProvider: Provider = {
  id: 'openai',
  source: 'built-in',
  env: ['OPENAI_API_KEY'],
  apiEnv: ['OPENAI_API_BASE'],
  name: 'OpenAI',
  api: 'https://api.openai.com/v1',
  doc: 'https://platform.openai.com/docs/models',
  models: {
    'gpt-4.1': {
      apiFormat: ApiFormat.OpenAI,
    },
    'gpt-4': {
      apiFormat: ApiFormat.OpenAI,
    },
    'gpt-4o': {
      apiFormat: ApiFormat.OpenAI,
    },
    o3: {
      apiFormat: ApiFormat.OpenAI,
    },
    'o3-mini': {
      apiFormat: ApiFormat.OpenAI,
    },
    'o4-mini': {
      apiFormat: ApiFormat.OpenAI,
    },
    'gpt-5.1': {},
    'gpt-5.1-codex': {},
    'gpt-5.1-codex-mini': {},
    'gpt-5.1-codex-max': {},
    'gpt-5': {},
    'gpt-5-mini': {},
    'gpt-5-codex': {},
    'gpt-5.2': {},
    'gpt-5.2-pro': {},
    'gpt-5.2-codex': {},
    'gpt-5.3-codex': {},
    'gpt-5.3-codex-spark': {},
  },
  apiFormat: ApiFormat.Responses,
};
