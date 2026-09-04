import type { RequestHandler } from 'express';
import compression from 'compression';

const HTTP_COMPRESSION_THRESHOLD_BYTES = 1024;

/** The server composition root uses this middleware to compress eligible HTTP responses. */
export function createHttpCompressionMiddleware(): RequestHandler {
    return compression({ threshold: HTTP_COMPRESSION_THRESHOLD_BYTES });
}
