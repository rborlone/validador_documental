import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { API_URL } from './api/client';
import { Dropzone } from './components/Dropzone';
import { DocumentDetail, NoSelection } from './components/DocumentDetail';
import { DocumentList } from './components/DocumentList';
import { LiveIndicator } from './components/LiveIndicator';
import { useDocumentDetail, useDocumentList, useDocumentTypes } from './hooks/useDocuments';
import { useLiveUpdates } from './hooks/useLiveUpdates';

function readSelectedFromHash(): string | null {
  const match = /^#\/?doc\/([\w-]+)$/.exec(window.location.hash);
  return match?.[1] ?? null;
}

export function App() {
  const liveStatus = useLiveUpdates();
  const live = liveStatus === 'open';
  const list = useDocumentList(live);
  const types = useDocumentTypes();
  const [selectedId, setSelectedId] = useState<string | null>(readSelectedFromHash);
  const detail = useDocumentDetail(selectedId, live);

  useEffect(() => {
    const onHash = () => setSelectedId(readSelectedFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const select = (id: string) => {
    setSelectedId(id);
    window.history.replaceState(null, '', `#/doc/${id}`);
    if (window.matchMedia('(max-width: 1023px)').matches) {
      document.getElementById('detalle')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const items = list.data?.items;
  const count = items?.length ?? 0;
  const pending = items?.filter((d) => d.status === 'QUEUED' || d.status === 'PROCESSING').length ?? 0;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6">
          <img src="/favicon.svg" alt="" className="size-7" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base leading-tight font-semibold">Validador Documental</h1>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">Playground de validación de documentos</p>
          </div>
          <LiveIndicator status={liveStatus} />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1600px] flex-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] lg:gap-6">
        <div className="space-y-4 lg:sticky lg:top-[72px] lg:max-h-[calc(100vh-96px)] lg:self-start lg:overflow-hidden">
          <section aria-labelledby="subir-title" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 id="subir-title" className="mb-3 text-sm font-semibold">
              Subir documentos
            </h2>
            <Dropzone
              documentTypes={types.data?.items ?? []}
              documentTypesLoading={types.isLoading}
              onUploaded={(docs) => {
                const first = docs[0];
                if (first) select(first.id);
              }}
            />
          </section>

          <section
            aria-labelledby="lista-title"
            className="flex flex-col rounded-xl border border-slate-200 bg-white lg:max-h-[calc(100vh-440px)] lg:min-h-64 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h2 id="lista-title" className="text-sm font-semibold">
                Documentos {count > 0 && <span className="font-normal text-slate-500">({count})</span>}
              </h2>
              {pending > 0 && (
                <span className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
                  {pending} en proceso
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DocumentList
                documents={items}
                isLoading={list.isLoading}
                error={list.error}
                onRetry={() => void list.refetch()}
                selectedId={selectedId}
                onSelect={select}
                typeLabels={types.labels}
              />
            </div>
          </section>
        </div>

        <section id="detalle" aria-label="Detalle del documento" className="min-w-0 scroll-mt-20">
          {selectedId ? (
            <DocumentDetail
              document={detail.data?.id === selectedId ? detail.data : undefined}
              isLoading={detail.isLoading || (detail.isFetching && detail.data?.id !== selectedId)}
              error={detail.error}
              onRetry={() => void detail.refetch()}
              typeLabels={types.labels}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
              <NoSelection />
            </div>
          )}
        </section>
      </main>

      <footer className="px-4 pb-4 text-center text-xs text-slate-400 sm:px-6">API: {API_URL}</footer>
      <Toaster richColors closeButton position="bottom-right" theme="system" />
    </div>
  );
}
