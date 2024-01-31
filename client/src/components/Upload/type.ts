import type { UploadUserFile } from "element-plus";

export interface ChunkFile {
  chunk: Blob;
  hash: string;
}

export type ChunkFileList = ChunkFile[];

interface XMLHttpRequest {
  loaded: number;
  total: number;
}

export interface OnProgress {
  (e: XMLHttpRequest): any;
}

export interface RequestType {
  url: string;
  data: any;
  headers?: {
    [key: string]: any;
  };
  method?: "post";
  onProgress?: OnProgress;
}

export interface UploadCustomFile extends UploadUserFile {
  loaded: number;
}

export interface ResponseType<T = any> {
  code: number;
  message: string;
  data: T;
  success: boolean;
}

export interface RequestHandler<T = any> {
  (options: RequestType): Promise<ResponseType<T>>;
}
