// Tab/panel id builders, kept out of tabs.tsx: a component file must only export components
// (Fast Refresh rule enforced by react-refresh/only-export-components).
export function tabId(idPrefix: string, id: string) {
  return `${idPrefix}-tab-${id}`;
}

export function panelId(idPrefix: string, id: string) {
  return `${idPrefix}-panel-${id}`;
}
