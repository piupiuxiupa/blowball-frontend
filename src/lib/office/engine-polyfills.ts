/**
 * Runtime polyfills the vendored engines expect from Node.
 *
 * The upstream engines call the Node `Buffer` global at function-call time
 * (PNG chunk assembly, base64 part transfer, UTF-8 XML encoding). Importing
 * this module FIRST from every office adapter entry point installs the
 * official `buffer` browser implementation on globalThis before any engine
 * function runs. Keep it as the first import of each adapter.
 */
import { Buffer } from 'buffer'

;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
