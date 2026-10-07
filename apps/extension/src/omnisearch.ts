import * as vscode from 'vscode';
import { DatabaseSearchSource, searchDatabaseValues } from './database-search';
import { DbNode } from './types';
import { errorMessage } from './util';

interface SearchItem extends vscode.QuickPickItem {
  node?: DbNode;
  search?: string;
}

// QuickPick labels interpret codicon markup. Values remain plain display text.
const preview = (text: string) => text.replace(/\s/g, ' ').replace(/\$\(/g, '＄(').slice(0, 160);

export async function showOmnisearch(root: DbNode, location: string, source: DatabaseSearchSource, open: (node: DbNode, search: string) => Promise<void>): Promise<void> {
  const picker = vscode.window.createQuickPick<SearchItem>();
  const title = `Omnisearch · ${location}`;
  picker.title = title;
  picker.placeholder = 'Search all values… e.g. JUREK';
  picker.ignoreFocusOut = true;
  let closed = false;
  let revision = 0;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const status = (label: string): SearchItem => ({ label, alwaysShow: true });
  picker.items = [status('Type to search tables, views and columns in this scope')];

  const run = async () => {
    if (running || closed) return;
    running = true;
    try {
      // A new phrase waits for the previous request to finish. Never fan out
      // database scans when someone types faster than their database responds.
      while (pending && !closed) {
        pending = false;
        const current = revision;
        const search = picker.value.trim();
        if (!search) continue;
        const cancelled = () => closed || current !== revision;
        const items: SearchItem[] = [];
        let matches = 0;
        let warnings = 0;
        picker.busy = true;
        try {
          for await (const event of searchDatabaseValues(root, search, source, cancelled)) {
            if (cancelled()) break;
            if (event.kind === 'progress') {
              picker.title = `${title} · Searching ${preview(event.node.label)}…`;
            } else if (event.kind === 'match') {
              matches++;
              items.push({
                label: `${preview(event.node.label)}: ${preview(event.match.value)} (${preview(event.match.column)})`,
                description: [event.node.database, event.node.schema]
                  .filter((part): part is string => !!part)
                  .map(preview)
                  .join(' › '),
                alwaysShow: true,
                node: event.node,
                search,
              });
              picker.items = [...items];
            } else if (event.kind === 'warning') {
              warnings++;
              items.push(status(`Skipped ${preview(event.node.label)}: ${preview(event.message)}`));
              picker.items = [...items];
            } else {
              const limits = event.limitReached
                ? ' · Result limit reached; refine your search'
                : event.limitedTables
                  ? ` · Preview limited in ${event.limitedTables} table(s)`
                  : '';
              picker.title = `${title} · ${matches} result(s)${warnings ? ` · ${warnings} skipped` : ''}${limits}`;
              if (!matches) picker.items = [status(warnings ? 'No matches in the objects searched; some objects could not be searched' : 'No matching values'), ...items];
              else if (limits) picker.items = [...items, status(limits.replace(/^ · /, ''))];
            }
          }
        } catch (error) {
          if (!cancelled()) picker.items = [status(`Search failed: ${preview(errorMessage(error))}`)];
        } finally {
          if (!cancelled()) picker.busy = false;
        }
      }
    } finally {
      running = false;
    }
  };

  const changed = picker.onDidChangeValue(() => {
    revision++;
    pending = false;
    clearTimeout(timer);
    picker.title = title;
    picker.items = [status(picker.value.trim() ? 'Searching…' : 'Type to search tables, views and columns in this scope')];
    picker.busy = !!picker.value.trim();
    if (picker.value.trim()) {
      timer = setTimeout(() => {
        pending = true;
        void run();
      }, 350);
    }
  });
  const accepted = picker.onDidAccept(() => {
    const item = picker.selectedItems[0];
    if (!item?.node || !item.search || item.search !== picker.value.trim()) return;
    picker.hide();
    void open(item.node, item.search).catch((error) => vscode.window.showErrorMessage(errorMessage(error)));
  });
  try {
    await new Promise<void>((resolve) => {
      const hidden = picker.onDidHide(() => {
        closed = true;
        revision++;
        clearTimeout(timer);
        hidden.dispose();
        resolve();
      });
      picker.show();
    });
  } finally {
    changed.dispose();
    accepted.dispose();
    picker.dispose();
  }
}
