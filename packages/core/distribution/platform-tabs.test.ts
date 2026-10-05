import { afterEach, describe, expect, it, vi } from "vitest";
import { DISTRIBUTION_TAB_GROUP_TITLE, preparePlatformTabs } from "./platform-tabs";

afterEach(() => vi.unstubAllGlobals());

describe("distribution platform tab groups", () => {
  it("reuses open tabs, creates missing tabs in the background, and groups them", async () => {
    const create = vi.fn().mockResolvedValue({ id: 12 });
    const group = vi.fn().mockResolvedValue(7);
    const update = vi.fn().mockResolvedValue(undefined);
    const tabs = [
      { id: 1, windowId: 4 },
      { id: 11, windowId: 4, url: "https://juejin.cn/editor/drafts/new", lastAccessed: 2 },
    ];
    vi.stubGlobal("browser", {
      tabs: {
        query: vi.fn().mockResolvedValue(tabs),
        get: vi.fn((id: number) =>
          Promise.resolve(tabs.find((tab) => tab.id === id) ?? { id, windowId: 4 }),
        ),
        move: vi.fn(),
        create,
        group,
      },
      tabGroups: { update },
    });

    await expect(preparePlatformTabs(["juejin", "zhihu"])).resolves.toEqual([
      { platform: "zhihu", tabId: 12, created: true },
      { platform: "juejin", tabId: 11, created: false },
    ]);
    expect(create).toHaveBeenCalledWith({
      url: "https://zhuanlan.zhihu.com/write",
      active: false,
      windowId: 4,
    });
    expect(group).toHaveBeenCalledWith({ tabIds: [12, 11], createProperties: { windowId: 4 } });
    expect(update).toHaveBeenCalledWith(7, {
      title: DISTRIBUTION_TAB_GROUP_TITLE,
      color: "blue",
      collapsed: false,
    });
  });

  it("does nothing when no platform is selected", async () => {
    const query = vi.fn();
    vi.stubGlobal("browser", { tabs: { query } });
    await expect(preparePlatformTabs([])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
