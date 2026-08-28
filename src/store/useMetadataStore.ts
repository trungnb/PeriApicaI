import { create } from 'zustand';
import { SystemMetadata } from '../types/dental';

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

  // Selectors / helper getters
  getTotalReports: () => number;
  getTotalBugs: () => number;
  getTotalPathology: () => number;
  getAccuracyMetrics: () => {
    exactMatchCount: number;
    mostlyAccurateCount: number;
    partiallyAccurateCount: number;
    inaccurateCount: number;
    exactMatchRate: number;
    completedCount: number;
    totalSessions: number;
  };
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
    set({ isLoading: true, error: null, lastAuthHeader: getAuthHeader, lastFilter: filter || null });
    try {
      const params = new URLSearchParams();
      if (filter?.preset) params.append('preset', filter.preset);
      if (filter?.startDate) params.append('startDate', filter.startDate);
      if (filter?.endDate) params.append('endDate', filter.endDate);

      const res = await fetch(`/api/admin/metadata?${params.toString()}`, {
        headers: getAuthHeader(),
      });
      const data = await res.json();
      if (data.success && data.systemMetrics) {
        set({ systemMetrics: data.systemMetrics, isLoading: false });
        return data.systemMetrics;
      } else {
        set({ error: data.error || 'Failed to fetch metadata', isLoading: false });
        return null;
      }
    } catch (err: any) {
      set({ error: err?.message || 'Error fetching metadata', isLoading: false });
      return null;
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

  getTotalReports: () => {
    const { systemMetrics } = get();
    return systemMetrics?.reports?.totalSessions ?? 0;
  },

  getTotalBugs: () => {
    const { systemMetrics } = get();
    return systemMetrics?.bugs?.totalBugs ?? 0;
  },

  getTotalPathology: () => {
    const { systemMetrics } = get();
    return systemMetrics?.pathology?.totalPathologyLogs ?? 0;
  },

  getAccuracyMetrics: () => {
    const { systemMetrics } = get();
    const rep = systemMetrics?.reports;
    const totalSessions = rep?.totalSessions ?? 0;
    const completedCount = rep?.completedCount ?? 0;
    const exactMatchCount = rep?.accuracyCounts?.EXACT_MATCH ?? 0;
    const mostlyAccurateCount = rep?.accuracyCounts?.MOSTLY_ACCURATE ?? 0;
    const partiallyAccurateCount = rep?.accuracyCounts?.PARTIALLY_ACCURATE ?? 0;
    const inaccurateCount = rep?.accuracyCounts?.INACCURATE ?? 0;
    const exactMatchRate = completedCount > 0 ? Math.round((exactMatchCount / completedCount) * 100) : 0;

    return {
      exactMatchCount,
      mostlyAccurateCount,
      partiallyAccurateCount,
      inaccurateCount,
      exactMatchRate,
      completedCount,
      totalSessions,
    };
  },
}));
