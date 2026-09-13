import { useState, useEffect } from 'react';

export interface UsePaginationReturn {
  currentPage: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  totalPages: number;
  nextPage: () => void;
  prevPage: () => void;
}

export function usePagination(totalItems: number, pageSize = 10): UsePaginationReturn {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  return {
    currentPage,
    setCurrentPage,
    totalPages,
    nextPage: () => setCurrentPage((page) => Math.min(page + 1, totalPages)),
    prevPage: () => setCurrentPage((page) => Math.max(page - 1, 1)),
  };
}
