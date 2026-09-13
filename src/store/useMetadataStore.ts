import { create } from 'zustand';
import { SystemMetadata } from '../types/dental';

const inFlightMetadataReads = new Map<string, Promise<SystemMetadata | null>>();

export interface MetadataStoreState {
  systemMetrics: SystemMetadata | null;
  isLoading: boolean;
  error: string | null;
  lastAuthHeader: (() => Record<string, string>) | null;
  lastFilter: { preset?: string; startDate?: string; endDate?: string } | null;

  // Actions
  setSystemMetrics: (
    metrics: SystemMetadata | null,
    getAuthHeader?: () => Record<string, string>,
    filter?: { preset?: string; startDate?: string; endDate?: string }
  ) => void;
  fetchMetadata: (
    getAuthHeader: () => Record<string, string>,
    filter?: { preset?: string; startDate?: string; endDate?: string }
  ) => Promise<SystemMetadata | null>;
  refreshMetadata: (
    getAuthHeader?: () => Record<string, string>,
    filter?: { preset?: string; startDate?: string; endDate?: string }
  ) => Promise<SystemMetadata | null>;

}

export const useMetadataStore = create<MetadataStoreState>((set, get) => ({
  systemMetrics: null,
  isLoading: false,
  error: null,
  lastAuthHeader: null,
  lastFilter: null,

  setSystemMetrics: (metrics, getAuthHeader, filter) => set((state) => ({
    systemMetrics: metrics,
    lastAuthHeader: getAuthHeader !== undefined ? getAuthHeader : state.lastAuthHeader,
    lastFilter: filter !== undefined ? (filter || null) : state.lastFilter
  })),

  fetchMetadata: async (getAuthHeader, filter) => {
    const params = new URLSearchParams();
    if (filter?.preset) params.append('preset', filter.preset);
    if (filter?.startDate) params.append('startDate', filter.startDate);
    if (filter?.endDate) params.append('endDate', filter.endDate);
    const requestKey = params.toString();
    const pending = inFlightMetadataReads.get(requestKey);
    if (pending) return pending;

    const read = (async () => {
      set({ isLoading: true, error: null, lastAuthHeader: getAuthHeader, lastFilter: filter || null });
      try {
        const res = await fetch(`/api/admin/metadata?${requestKey}`, {
          headers: getAuthHeader(),
        });
        const data = await res.json();
        if (data.success && data.systemMetrics) {
          set({ systemMetrics: data.systemMetrics, isLoading: false });
          return data.systemMetrics;
        }
        set({ error: data.error || 'Failed to fetch metadata', isLoading: false });
        return null;
      } catch (err: any) {
        set({ error: err?.message || 'Error fetching metadata', isLoading: false });
        return null;
      }
    })();

    inFlightMetadataReads.set(requestKey, read);
    try {
      return await read;
    } finally {
      inFlightMetadataReads.delete(requestKey);
    }
  },

  refreshMetadata: async (getAuthHeader, filter) => {
    const activeAuthHeader = getAuthHeader || get().lastAuthHeader;
    const activeFilter = filter || get().lastFilter;
    if (!activeAuthHeader) {
      console.warn('[MetadataStore] Missing admin authorization context for metadata sync.');
      return null;
    }
    return get().fetchMetadata(activeAuthHeader, activeFilter || undefined);
  },

}));
