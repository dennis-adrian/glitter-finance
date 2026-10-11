import assert from "node:assert/strict";
import test from "node:test";
import {
  currentRouteHash,
  goBack,
  guardHistoryBack,
  navigateTo,
} from "@/lib/hooks/use-app-route";

type Entry = { state: unknown; url: string };

/** Same-document history: traversals fire popstate in a later task. */
class FakeWindow extends EventTarget {
  entries: Entry[] = [{ state: null, url: "/" }];
  index = 0;
  location = {
    pathname: "/",
    search: "",
    get hash() {
      return "";
    },
  };
  history = {
    state: null as unknown,
    pushState: (state: unknown, _unused: string, url: string) => {
      this.entries.splice(this.index + 1);
      this.entries.push({ state, url });
      this.index += 1;
    },
    replaceState: (state: unknown, _unused: string, url: string) => {
      this.entries[this.index] = { state, url };
    },
    back: () => {
      setTimeout(() => this.traverse(-1));
    },
    go: (delta: number) => {
      setTimeout(() => this.traverse(delta));
    },
  };

  constructor() {
    super();
    Object.defineProperty(this.location, "hash", {
      get: () => {
        const url = this.entries[this.index].url;
        const at = url.indexOf("#");
        return at === -1 ? "" : url.slice(at);
      },
    });
    Object.defineProperty(this.history, "state", {
      get: () => this.entries[this.index].state,
    });
  }

  /** The browser's or the phone's Back/Forward, before popstate fires. */
  commit(delta: number) {
    this.index += delta;
  }

  traverse(delta: number) {
    this.commit(delta);
    this.dispatchEvent(new Event("popstate"));
  }
}

function withWindow(run: (win: FakeWindow) => Promise<void>) {
  return async () => {
    const win = new FakeWindow();
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: win,
    });
    try {
      await run(win);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "window", original);
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
    }
  };
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve));

test(
  "a held Back keeps the screen and leave() goes where the vendor went",
  withWindow(async (win) => {
    navigateTo({ view: "products" });
    navigateTo({ view: "editor", id: "prod-1" });
    const leaves: Array<() => void> = [];
    const stop = guardHistoryBack(() => (leave) => leaves.push(leave));

    win.commit(-1);
    // A render before popstate fires still shows the editor.
    assert.equal(currentRouteHash(), "#/catalogo/prod-1");
    win.dispatchEvent(new Event("popstate"));

    assert.equal(leaves.length, 1);
    assert.equal(win.location.hash, "#/catalogo/prod-1");
    assert.deepEqual(win.history.state, { glitterDepth: 2 });
    assert.deepEqual(
      win.entries.map((entry) => entry.url),
      ["/", "/#/catalogo", "/#/catalogo/prod-1"]
    );

    leaves[0]();
    await nextTask();

    assert.equal(leaves.length, 1, "leaving isn't held again");
    assert.equal(win.location.hash, "#/catalogo");
    assert.equal(currentRouteHash(), "#/catalogo");
    stop();
  })
);

test(
  "Back passes without unsaved work, and the app's own navigation drops the hold",
  withWindow(async (win) => {
    let asks = 0;
    const confirm = () => {
      asks += 1;
    };

    navigateTo({ view: "products" });
    navigateTo({ view: "editor", id: "prod-1" });
    let stop = guardHistoryBack(() => null);
    win.traverse(-1);
    assert.equal(win.location.hash, "#/catalogo");
    assert.equal(currentRouteHash(), "#/catalogo");
    stop();

    navigateTo({ view: "editor", id: "prod-1" });
    stop = guardHistoryBack(() => confirm);
    goBack({ view: "products" });
    assert.equal(currentRouteHash(), "#/catalogo/prod-1");
    await nextTask();
    assert.equal(win.location.hash, "#/catalogo");
    assert.equal(currentRouteHash(), "#/catalogo");
    stop();

    navigateTo({ view: "editor", id: "prod-1" });
    stop = guardHistoryBack(() => confirm);
    navigateTo({ view: "sell" });
    assert.equal(currentRouteHash(), "");
    win.traverse(-1);
    assert.equal(currentRouteHash(), "#/catalogo/prod-1");
    stop();

    assert.equal(asks, 0);
  })
);

test(
  "a second back() while one is on its way doesn't go further",
  withWindow(async (win) => {
    navigateTo({ view: "checkout" });
    navigateTo({ view: "saleComplete" }, { replace: true });

    goBack({ view: "sell" });
    goBack({ view: "sell" });
    await nextTask();
    await nextTask();

    assert.equal(win.index, 0);
    assert.equal(win.location.hash, "");
    // The traversal ended, so the next back() works again.
    navigateTo({ view: "sales" });
    goBack({ view: "sell" });
    await nextTask();
    assert.equal(win.location.hash, "");
  })
);

test(
  "a back() that left the document doesn't block back() after a bfcache restore",
  withWindow(async (win) => {
    navigateTo({ view: "sales" });
    navigateTo({ view: "saleDetail", id: "sale-1" });
    // history.back() loads another document: no popstate reaches this one.
    win.history.back = () => {};
    goBack({ view: "sales" });
    // The page comes back from the back/forward cache.
    win.dispatchEvent(new Event("pageshow"));

    win.history.back = () => {
      setTimeout(() => win.traverse(-1));
    };
    goBack({ view: "sales" });
    await nextTask();
    assert.equal(win.location.hash, "#/ventas");
  })
);

test(
  "Back from a deep-linked seller sale walks up to the seller, then Reports, without leaving the app",
  withWindow(async (win) => {
    win.entries[0] = { state: null, url: "/#/reportes/vendedor/u1/s1" };

    goBack({ view: "sellerSales", sellerId: "u1" });
    assert.equal(win.location.hash, "#/reportes/vendedor/u1");
    assert.equal(win.index, 0);
    assert.equal(win.entries.length, 1);

    goBack({ view: "reports" });
    assert.equal(win.location.hash, "#/reportes");
    assert.equal(win.entries.length, 1);
  })
);

test(
  "Reports, a seller, a sale, another sale: Back returns to the seller, then Reports",
  withWindow(async (win) => {
    navigateTo({ view: "reports" });
    navigateTo({ view: "sellerSales", sellerId: "u1" });
    navigateTo({ view: "sellerSaleDetail", sellerId: "u1", id: "s1" });
    // Switching between sales replaces the entry.
    navigateTo(
      { view: "sellerSaleDetail", sellerId: "u1", id: "s2" },
      { replace: true }
    );
    assert.deepEqual(
      win.entries.map((entry) => entry.url),
      [
        "/",
        "/#/reportes",
        "/#/reportes/vendedor/u1",
        "/#/reportes/vendedor/u1/s2",
      ]
    );

    goBack({ view: "sellerSales", sellerId: "u1" });
    await nextTask();
    assert.equal(win.location.hash, "#/reportes/vendedor/u1");

    goBack({ view: "reports" });
    await nextTask();
    assert.equal(win.location.hash, "#/reportes");
  })
);

test(
  "the seller list's back beside an open sale leaves both, to Reports",
  withWindow(async (win) => {
    navigateTo({ view: "reports" });
    navigateTo({ view: "sellerSales", sellerId: "u1" });
    navigateTo({ view: "sellerSaleDetail", sellerId: "u1", id: "s1" });

    goBack({ view: "reports" }, { steps: 2 });
    await nextTask();
    assert.equal(win.location.hash, "#/reportes");
    assert.equal(win.index, 1);

    // From a deep-linked seller list, there are not two entries to leave:
    // the sale's entry becomes Reports.
    win.entries.splice(0, win.entries.length, {
      state: null,
      url: "/#/reportes/vendedor/u1",
    });
    win.index = 0;
    navigateTo({ view: "sellerSaleDetail", sellerId: "u1", id: "s1" });
    goBack({ view: "reports" }, { steps: 2 });
    assert.equal(win.location.hash, "#/reportes");
    assert.deepEqual(
      win.entries.map((entry) => entry.url),
      ["/#/reportes/vendedor/u1", "/#/reportes"]
    );
  })
);
