// pattern: Functional Core

import type { ToolRegistry } from '../runtime/tool-registry.ts';

export type ImageResult = {
  readonly type: 'image_result';
  readonly text: string;
  readonly image: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function viewImage(url: string): Promise<ImageResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Not an image: content-type is ${contentType}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${contentLength} bytes (max 10MB)`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${buffer.byteLength} bytes (max 10MB)`);
  }

  const base64 = Buffer.from(buffer).toString('base64');
  const mediaType = contentType.split(';')[0]!.trim();

  return {
    type: 'image_result',
    text: `Image from ${url}`,
    image: { type: 'base64', media_type: mediaType, data: base64 },
  };
}

export function registerImageTools(registry: ToolRegistry): void {
  registry.register(
    'view_image',
    {
      name: 'view_image',
      description:
        'Fetch and view an image from a URL. Returns the image as a base64-encoded content block that you can see and analyze. Supports JPEG, PNG, GIF, and WebP. Max size: 10MB.',
      input_schema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Image URL to fetch and view',
          },
        },
        required: ['url'],
      },
    },
    async (params) => {
      const url = params['url'];
      if (typeof url !== 'string') {
        throw new Error('missing required param: url');
      }
      return viewImage(url);
    },
    'native',
  );
}
