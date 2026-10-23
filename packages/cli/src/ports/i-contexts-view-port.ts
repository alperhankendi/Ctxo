import type { ContextsView } from '../core/contexts-view/contexts-view-builder.js';

/**
 * Read access to the contexts view (`contexts-view.json`), the candidate bounded contexts of the project.
 *
 * Returns `undefined` when there is no usable view (the project was never indexed, or the file is
 * invalid); callers then say so and point at `ctxo index`. The view is shared between calls, so a caller
 * must treat it as read-only.
 */
export interface IContextsViewPort {
  readContextsView(): ContextsView | undefined;
}
