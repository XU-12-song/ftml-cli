export interface FtmlErrorOptions{

  code?: string;
  offset?: number | null;
  file?: string | null;
  cause?: Error | null;
}

