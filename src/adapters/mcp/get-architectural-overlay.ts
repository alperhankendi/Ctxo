import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { ArchitecturalOverlay } from '../../core/overlay/architectural-overlay.js';

const InputSchema = z.object({
  layer: z.string().optional(),
});

export function handleGetArchitecturalOverlay(
  storage: IStoragePort,
  masking: IMaskingPort,
) {
  const overlay = new ArchitecturalOverlay();

  return (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const files = storage.listIndexedFiles();
      const result = overlay.classify(files);

      // Filter by layer if specified
      if (parsed.data.layer) {
        const filtered = result.layers[parsed.data.layer];
        const payload = masking.mask(JSON.stringify({ layer: parsed.data.layer, files: filtered ?? [] }));
        return {
          content: [{ type: 'text' as const, text: payload }],
        };
      }

      const payload = masking.mask(JSON.stringify(result));
      return {
        content: [{ type: 'text' as const, text: payload }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: (err as Error).message }) }],
      };
    }
  };
}
