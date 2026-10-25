import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { mergeUploaded, queryKeys } from '../api/cache';
import { api } from '../api/client';
import type { DocumentListResponse } from '../api/types';
import { isTerminal } from '../lib/format';

/** Intervalo del polling de respaldo cuando el SSE no está conectado. */
export const FALLBACK_POLL_MS = 5000;

export function useDocumentList(live: boolean) {
  return useQuery({
    queryKey: queryKeys.list(),
    queryFn: ({ signal }) => api.listDocuments(50, signal),
    refetchInterval: live ? false : FALLBACK_POLL_MS,
  });
}

export function useDocumentDetail(id: string | null, live: boolean) {
  return useQuery({
    queryKey: queryKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.getDocument(id as string, signal),
    enabled: id !== null,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return !live && status !== undefined && !isTerminal(status) ? FALLBACK_POLL_MS : false;
    },
  });
}

export function useDocumentTypes() {
  const query = useQuery({
    queryKey: queryKeys.documentTypes,
    queryFn: ({ signal }) => api.listDocumentTypes(signal),
    staleTime: 10 * 60_000,
  });
  const labels = useMemo(
    () => Object.fromEntries((query.data?.items ?? []).map((t) => [t.id, t.label])),
    [query.data],
  );
  return { ...query, labels };
}

export interface UploadVariables {
  files: File[];
  expectedType: string | null;
  onProgress: (fraction: number) => void;
}

export function useUploadDocuments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ files, expectedType, onProgress }: UploadVariables) =>
      api.uploadDocuments(files, { expectedType, onProgress }),
    onSuccess: (response) => {
      queryClient.setQueryData<DocumentListResponse>(queryKeys.list(), (prev) =>
        mergeUploaded(prev, response.documents),
      );
    },
  });
}
