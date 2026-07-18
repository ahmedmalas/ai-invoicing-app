import { describe, expect, it } from 'vitest';

import {
  hasActiveTextSelection,
  isDrawerFormDirty,
  isEditableTarget,
  markDrawerFormPristine,
  serializeFormState,
  shouldCloseDrawerOnBackdropClick,
  shouldIgnoreGlobalShortcut,
} from '../../public/form-interaction-guards.js';

type FakeNode = {
  nodeType: number;
  parentElement: FakeNode | null;
  matches: (selector: string) => boolean;
  closest: (selector: string) => FakeNode | null;
};

function fakeElement(options: {
  tag: string;
  attrs?: Record<string, string>;
  parent?: FakeNode | null;
}): FakeNode {
  const attrs = options.attrs || {};
  const node: FakeNode = {
    nodeType: 1,
    parentElement: options.parent || null,
    matches(selector: string) {
      const tags = selector.split(',').map((part) => part.trim());
      return tags.some((part) => {
        if (part.startsWith('[') && part.endsWith(']')) {
          const body = part.slice(1, -1);
          const [name, raw] = body.split('=');
          if (!name) return false;
          if (raw === undefined) return name in attrs;
          return attrs[name] === raw.replaceAll('"', '');
        }
        return options.tag === part;
      });
    },
    closest(selector: string) {
      let current: FakeNode | null = node;
      while (current) {
        if (current.matches(selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
  };
  return node;
}

describe('form interaction guards', () => {
  it('treats input, textarea, select and contenteditable as editable targets', () => {
    expect(isEditableTarget(fakeElement({ tag: 'input' }))).toBe(true);
    expect(isEditableTarget(fakeElement({ tag: 'textarea' }))).toBe(true);
    expect(isEditableTarget(fakeElement({ tag: 'select' }))).toBe(true);
    expect(
      isEditableTarget(fakeElement({ tag: 'div', attrs: { contenteditable: 'true' } })),
    ).toBe(true);
    expect(isEditableTarget(fakeElement({ tag: 'button' }))).toBe(false);
  });

  it('ignores global shortcuts that originate from editable fields', () => {
    expect(
      shouldIgnoreGlobalShortcut({
        target: fakeElement({ tag: 'input' }),
        key: 'c',
        ctrlKey: true,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreGlobalShortcut({
        target: fakeElement({ tag: 'button' }),
        key: 'c',
        ctrlKey: true,
      }),
    ).toBe(false);
  });

  it('does not close the drawer when a click on the backdrop came from a drag starting in the description field', () => {
    const backdrop = fakeElement({ tag: 'div', attrs: { 'data-drawer-backdrop': '' } });
    backdrop.matches = (selector: string) => selector === '[data-drawer-backdrop]';
    const input = fakeElement({ tag: 'input', parent: backdrop });

    expect(
      shouldCloseDrawerOnBackdropClick({
        clickTarget: backdrop,
        pointerDownTarget: input,
        hasTextSelection: false,
      }),
    ).toBe(false);

    expect(
      shouldCloseDrawerOnBackdropClick({
        clickTarget: backdrop,
        pointerDownTarget: input,
        hasTextSelection: true,
      }),
    ).toBe(false);
  });

  it('still closes the drawer for a genuine backdrop click gesture', () => {
    const backdrop = fakeElement({ tag: 'div', attrs: { 'data-drawer-backdrop': '' } });
    backdrop.matches = (selector: string) => selector === '[data-drawer-backdrop]';

    expect(
      shouldCloseDrawerOnBackdropClick({
        clickTarget: backdrop,
        pointerDownTarget: backdrop,
        hasTextSelection: false,
      }),
    ).toBe(true);
  });

  it('detects active text selections used during copy flows', () => {
    expect(
      hasActiveTextSelection({
        toString: () => 'Roof repair',
        isCollapsed: false,
      }),
    ).toBe(true);
    expect(
      hasActiveTextSelection({
        toString: () => '',
        isCollapsed: true,
      }),
    ).toBe(false);
  });

  it('tracks dirty invoice form state so unsaved work can be protected', () => {
    const values = {
      title: 'Job A',
      description: 'Line one',
    };
    const form = {
      dataset: {} as Record<string, string>,
    };

    const FormDataStub = class {
      entries() {
        return Object.entries(values)[Symbol.iterator]();
      }
    };
    const previousFormData = globalThis.FormData;
    globalThis.FormData = FormDataStub as unknown as typeof FormData;

    try {
      markDrawerFormPristine(form);
      expect(isDrawerFormDirty(form)).toBe(false);

      values.description = 'Line one updated';
      expect(isDrawerFormDirty(form)).toBe(true);
      expect(serializeFormState(form)).toContain('description=Line one updated');
    } finally {
      globalThis.FormData = previousFormData;
    }
  });
});
