import { Suggestion } from './filter-suggest';
import { clear, h } from './lib';

export function attachFilterComplete(input: HTMLInputElement, suggest: (text: string, caret: number) => Promise<Suggestion[]>): void {
  let list: Suggestion[] = [];
  let active = 0;
  let request = 0;
  const box = h('div.menu.filter-suggest', { role: 'listbox', id: `filter-suggest-${Math.random().toString(36).slice(2)}` });
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', box.id);

  const close = () => {
    request++;
    list = [];
    box.remove();
    input.removeAttribute('aria-expanded');
    input.removeAttribute('aria-activedescendant');
  };

  const render = () => {
    clear(
      box,
      list.map((s, i) =>
        h(
          'div.mi',
          {
            id: `${box.id}-${i}`,
            role: 'option',
            class: i === active ? 'active' : '',
            'aria-selected': i === active ? 'true' : 'false',
            onMouseDown: (e: MouseEvent) => {
              e.preventDefault();
              accept(i);
            },
          },
          h('span.filter-suggest-label', null, s.label),
          h('span.filter-suggest-type', null, s.detail),
        ),
      ),
    );
    input.setAttribute('aria-activedescendant', `${box.id}-${active}`);
    box.children[active]?.scrollIntoView({ block: 'nearest' });
  };

  const show = async () => {
    const seq = ++request;
    const next = await suggest(input.value, input.selectionStart ?? input.value.length).catch(() => []);
    if (seq !== request || document.activeElement !== input) return;
    list = next;
    if (!list.length) return close();
    active = 0;
    render();
    if (!box.isConnected) input.parentElement?.append(box);
    input.setAttribute('aria-expanded', 'true');
  };

  const accept = (i: number) => {
    const s = list[i];
    if (!s) return;
    input.value = s.text;
    input.setSelectionRange(s.caret, s.caret);
    close();
  };

  input.addEventListener('input', () => void show());
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      void show();
      return;
    }
    if (!list.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      active = (active + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
      render();
    } else if (e.key === 'Enter' || e.key === 'Tab') accept(active);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  });
}
