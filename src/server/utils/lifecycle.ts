import { Response } from 'express';

/**
 * Attaches robust server request lifecycle event handlers for cancellation ownership.
 * 
 * Remediation R12: Normal request completion (req.on('close')) incorrectly aborted execution 
 * budgets because it fires when the request body is fully consumed, not when the client 
 * disconnects before response completion.
 * 
 * We now strictly bind to `res.on('close')` and verify `!res.writableEnded` to determine 
 * if the client actually disconnected early (cancellation).
 */
export function bindCancellationLifecycle(res: Response, controller: AbortController, deadlineTimer: NodeJS.Timeout): void {
  // Clear the deadline timer when the response finishes normally.
  res.on('finish', () => {
    clearTimeout(deadlineTimer);
  });

  // If the response stream closes but wasn't finished, the client disconnected prematurely.
  res.on('close', () => {
    if (!res.writableEnded) {
      clearTimeout(deadlineTimer);
      controller.abort();
    }
  });
}
