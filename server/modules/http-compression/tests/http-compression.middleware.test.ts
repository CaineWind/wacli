import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import http, { type Server } from 'node:http';
import test from 'node:test';

import express from 'express';

import { createHttpCompressionMiddleware } from '../index.js';

type RawResponse = {
    body: Buffer;
    headers: http.IncomingHttpHeaders;
    statusCode: number | undefined;
};

function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('HTTP compression test server has no TCP address'));
                return;
            }
            resolve(address.port);
        });
    });
}

function close(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

function request(port: number, pathname: string): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
        const outgoing = http.request({
            hostname: '127.0.0.1',
            port,
            path: pathname,
            headers: { 'Accept-Encoding': 'gzip' },
        }, (incoming) => {
            const chunks: Buffer[] = [];
            incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
            incoming.once('end', () => resolve({
                body: Buffer.concat(chunks),
                headers: incoming.headers,
                statusCode: incoming.statusCode,
            }));
        });
        outgoing.once('error', reject);
        outgoing.end();
    });
}

test('compresses eligible responses with gzip', async () => {
    const source = 'const answer = 42;\n'.repeat(1000);
    const app = express();
    app.use(createHttpCompressionMiddleware());
    app.get('/asset.js', (_request, response) => {
        response.type('application/javascript').send(source);
    });
    const server = http.createServer(app);
    const port = await listen(server);

    try {
        const response = await request(port, '/asset.js');

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['content-encoding'], 'gzip');
        assert.match(response.headers.vary ?? '', /Accept-Encoding/i);
        assert.equal(gunzipSync(response.body).toString('utf8'), source);
    } finally {
        await close(server);
    }
});

test('does not recompress WOFF2 font responses', async () => {
    const source = Buffer.alloc(4096, 1);
    const app = express();
    app.use(createHttpCompressionMiddleware());
    app.get('/font.woff2', (_request, response) => {
        response.type('font/woff2').send(source);
    });
    const server = http.createServer(app);
    const port = await listen(server);

    try {
        const response = await request(port, '/font.woff2');

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['content-encoding'], undefined);
        assert.deepEqual(response.body, source);
    } finally {
        await close(server);
    }
});
