import { useState, useMemo, useEffect } from 'react';

export interface UsePaginationReturn<T> {
  currentPage: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  totalPages: number;
  paginatedItems: T[];
  totalItems: number;
  pageSize: number;
}

export function usePagination<T>(items: T[], pageSize = 10, overrideTotalItems?: number): UsePaginationReturn<T> {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const totalItems = overrideTotalItems !== undefined ? overrideTotalItems : items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedItems = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return items.slice(startIdx, startIdx + pageSize);
  }, [items, currentPage, pageSize]);

  return {
    currentPage,
    setCurrentPage,
    totalPages,
    paginatedItems,
    totalItems,
    pageSize,
  };
}
