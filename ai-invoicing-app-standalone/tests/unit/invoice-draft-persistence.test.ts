import { describe, expect, it } from "vitest";
import {
  applyInvoiceDraftSnapshot,
  buildInvoiceDraftSnapshot,
  clearInvoiceDraftSnapshot,
  INVOICE_DRAFT_STORAGE_KEY,
  readInvoiceDraftSnapshot,
  snapshotLooksRecoverable,
  writeInvoiceDraftSnapshot,
} from "../../public/invoice-draft-persistence.js";

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

function createFakeForm(values: {
  recordId?: string;
  customerId?: string;
  title?: string;
  issueDate?: string;
  endDate?: string;
  notes?: string;
  paymentTerms?: string;
  lineItems?: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    gstApplicable?: string;
  }>;
}) {
  const fields: Record<string, { value: string }> = {
    customerId: { value: values.customerId ?? "" },
    title: { value: values.title ?? "" },
    issueDate: { value: values.issueDate ?? "" },
    endDate: { value: values.endDate ?? "" },
    notes: { value: values.notes ?? "" },
    paymentTerms: { value: values.paymentTerms ?? "" },
  };
  const lines = (values.lineItems ?? []).map((item) => ({
    querySelector(nameSelector: string) {
      const name = nameSelector.match(/name="([^"]+)"/)?.[1];
      if (name === "description") return { value: item.description };
      if (name === "quantity") return { value: item.quantity };
      if (name === "unitPrice") return { value: item.unitPrice };
      if (name === "gstApplicable") return { value: item.gstApplicable ?? "true" };
      return null;
    },
  }));
  const activeDescription = { value: "typing..." };
  const linesBody = {
    innerHTML: "",
    contains(node: unknown) {
      return node === activeDescription;
    },
  };
  const form = {
    dataset: { recordId: values.recordId } as Record<string, string | undefined>,
    ownerDocument: {
      activeElement: null as unknown,
    },
    contains(node: unknown) {
      return node === form.ownerDocument.activeElement || node === activeDescription;
    },
    querySelector(selector: string) {
      if (selector === "[data-invoice-lines]") return linesBody;
      const name = selector.match(/name="([^"]+)"/)?.[1];
      if (name && fields[name]) return fields[name];
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === "[data-invoice-line]") return lines;
      return [];
    },
    __activeDescription: activeDescription,
    __linesBody: linesBody,
  };
  return form;
}

describe("invoice draft persistence helpers", () => {
  it("round-trips draft snapshots through localStorage (browser restart / refresh)", () => {
    const storage = createMemoryStorage();
    const form = createFakeForm({
      recordId: "inv_draft_1",
      customerId: "cus_1",
      title: "Workshop labour",
      issueDate: "2026-07-18",
      endDate: "2026-08-17",
      notes: "Thanks",
      paymentTerms: "Net 14",
      lineItems: [
        {
          description: "Labour",
          quantity: "2",
          unitPrice: "100",
          gstApplicable: "true",
        },
      ],
    });

    const written = writeInvoiceDraftSnapshot(form, {}, storage);
    expect(written?.recordId).toBe("inv_draft_1");
    expect(storage.getItem(INVOICE_DRAFT_STORAGE_KEY)).toBeTruthy();

    const restored = readInvoiceDraftSnapshot(storage);
    expect(restored).toMatchObject({
      recordId: "inv_draft_1",
      customerId: "cus_1",
      title: "Workshop labour",
      dueDate: "2026-08-17",
      lineItems: [
        {
          description: "Labour",
          quantity: "2",
          unitPrice: "100",
          gstApplicable: "true",
        },
      ],
    });
    expect(snapshotLooksRecoverable(restored)).toBe(true);

    clearInvoiceDraftSnapshot(storage);
    expect(readInvoiceDraftSnapshot(storage)).toBeNull();
  });

  it("builds and applies a snapshot from invoice workspace form values", () => {
    const form = createFakeForm({
      customerId: "cus_9",
      title: "From form",
      issueDate: "2026-07-01",
      endDate: "2026-07-31",
      notes: "Note",
      lineItems: [{ description: "Part", quantity: "1", unitPrice: "50" }],
    });

    const snapshot = buildInvoiceDraftSnapshot(form, { recordId: null });
    expect(snapshot?.customerId).toBe("cus_9");
    expect(snapshot?.title).toBe("From form");
    expect(snapshot?.lineItems).toHaveLength(1);
    expect(snapshot?.recordId).toBeNull();

    const target = createFakeForm({
      customerId: "",
      title: "",
      issueDate: "",
      endDate: "",
      lineItems: [],
    });
    expect(applyInvoiceDraftSnapshot(target, snapshot)).toBe(true);
    const titleField = target.querySelector('[name="title"]') as { value?: string } | null;
    const customerField = target.querySelector('[name="customerId"]') as {
      value?: string;
    } | null;
    const linesBody = target.querySelector("[data-invoice-lines]") as {
      innerHTML?: string;
    } | null;
    expect(titleField?.value).toBe("From form");
    expect(customerField?.value).toBe("cus_9");
    expect(String(linesBody?.innerHTML)).toContain("Part");
  });

  it("does not rewrite line-item markup while a description field is focused", () => {
    const target = createFakeForm({
      customerId: "",
      title: "",
      issueDate: "",
      endDate: "",
      lineItems: [{ description: "Original", quantity: "1", unitPrice: "10" }],
    }) as ReturnType<typeof createFakeForm> & {
      __activeDescription: { value: string };
      __linesBody: { innerHTML: string };
    };
    target.__linesBody.innerHTML = "KEEP_ME";
    target.ownerDocument.activeElement = target.__activeDescription;

    applyInvoiceDraftSnapshot(target, {
      version: 1,
      savedAt: new Date().toISOString(),
      recordId: null,
      pathname: "/workspace/invoices/new",
      customerId: "cus_9",
      title: "Recovered",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      notes: "",
      paymentTerms: "",
      lineItems: [{ description: "Replaced", quantity: "2", unitPrice: "20" }],
    });

    expect(target.__linesBody.innerHTML).toBe("KEEP_ME");
    expect((target.querySelector('[name="title"]') as { value: string }).value).toBe("Recovered");
  });

  it("does not treat empty snapshots as recoverable", () => {
    expect(snapshotLooksRecoverable(null)).toBe(false);
    expect(
      snapshotLooksRecoverable({
        version: 1,
        savedAt: new Date().toISOString(),
        recordId: null,
        pathname: "/workspace/invoices/new",
        customerId: "",
        title: "",
        issueDate: "",
        dueDate: "",
        notes: "",
        paymentTerms: "",
        lineItems: [{ description: "", quantity: "1", unitPrice: "0" }],
      }),
    ).toBe(false);
  });

  it("does not clear a previously saved title when the form title is empty", () => {
    const storage = createMemoryStorage();
    const filled = createFakeForm({
      customerId: "cus_1",
      title: "Keep this title",
      issueDate: "2026-07-20",
      endDate: "2026-08-03",
      lineItems: [{ description: "Labour", quantity: "1", unitPrice: "100" }],
    });
    writeInvoiceDraftSnapshot(filled, {}, storage);

    const emptied = createFakeForm({
      customerId: "cus_1",
      title: "",
      issueDate: "2026-07-20",
      endDate: "2026-08-03",
      lineItems: [{ description: "Labour", quantity: "1", unitPrice: "100" }],
    });
    const written = writeInvoiceDraftSnapshot(emptied, {}, storage);
    expect(written?.title).toBe("Keep this title");
    expect(readInvoiceDraftSnapshot(storage)?.title).toBe("Keep this title");
  });

  it("preserves line items when a remounted form writes an empty line list", () => {
    const storage = createMemoryStorage();
    writeInvoiceDraftSnapshot(
      createFakeForm({
        customerId: "cus_2",
        title: "Title",
        lineItems: [{ description: "Part", quantity: "2", unitPrice: "40" }],
      }),
      {},
      storage,
    );
    const written = writeInvoiceDraftSnapshot(
      createFakeForm({
        customerId: "cus_2",
        title: "Title",
        lineItems: [],
      }),
      {},
      storage,
    );
    expect(written?.lineItems).toEqual([
      { description: "Part", quantity: "2", unitPrice: "40", gstApplicable: "true" },
    ]);
  });
});
