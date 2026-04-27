// pattern: Functional Core

export type ImageResult = {
  readonly type: 'image_result';
  readonly text: string;
  readonly image: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
};
