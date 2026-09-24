import { z } from 'zod';

/**
 * Workbench layout remembered across restarts (machine-local, stored in
 * `<config>/state/ui-layout.json`). Unknown or invalid values fall back to defaults.
 */
export const SIDEBAR_MIN_WIDTH = 170;
export const PANEL_MIN_HEIGHT = 77;

export const LayoutStateSchema = z.object({
  sidebar: z.object({
    visible: z.boolean(),
    width: z.number().int().min(SIDEBAR_MIN_WIDTH).max(2000),
    activeView: z.string().max(100),
  }),
  panel: z.object({
    visible: z.boolean(),
    height: z.number().int().min(PANEL_MIN_HEIGHT).max(3000),
    maximized: z.boolean(),
    activeTab: z.string().max(100),
  }),
});
export type LayoutState = z.infer<typeof LayoutStateSchema>;

export const DEFAULT_LAYOUT_STATE: LayoutState = {
  sidebar: { visible: true, width: 300, activeView: 'workbench.view.targets' },
  panel: { visible: true, height: 280, maximized: false, activeTab: 'results' },
};
