import { randomUUID } from 'node:crypto';
import { SendMessageRequest } from '@a2a-js/sdk';
import { ClientFactory } from '@a2a-js/sdk/client';

export async function connect(baseUrl, token) {
  const client = await new ClientFactory().createFromUrl(baseUrl);
  return async input => {
    const result = await client.sendMessage(SendMessageRequest.fromJSON({
      message: {
        messageId: randomUUID(), role: 'ROLE_USER',
        parts: [{ data: input }],
      },
    }), {
      serviceParameters: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(180_000),
    });
    if (!result.parts) throw new Error('Expected an A2A message');
    const part = result.parts[0];
    if (part?.content?.$case === 'raw' && part.mediaType === 'image/png') return { png: Buffer.from(part.content.value) };
    const data = part?.content?.value;
    if (!data?.ok) {
      const error = new Error(data?.error?.message ?? 'A2A operation failed');
      error.code = data?.error?.code;
      throw error;
    }
    return data.result;
  };
}
