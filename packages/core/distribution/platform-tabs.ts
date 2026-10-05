import {
  DISTRIBUTION_PLATFORMS,
  findPlatformTab,
  getDistributionPlatform,
  type PlatformId,
} from "./platforms";

export const DISTRIBUTION_TAB_GROUP_TITLE = "一键分发 · 待填稿";

export interface PreparedPlatformTab {
  platform: PlatformId;
  tabId: number;
  created: boolean;
}

export async function preparePlatformTabs(
  platforms: PlatformId[],
  storedTabIds: Partial<Record<PlatformId, number>> = {},
): Promise<PreparedPlatformTab[]> {
  const uniquePlatforms = DISTRIBUTION_PLATFORMS.map((item) => item.id).filter((id) =>
    platforms.includes(id),
  );
  if (!uniquePlatforms.length) return [];

  const currentTab = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  const prepared: PreparedPlatformTab[] = [];
  for (const platform of uniquePlatforms) {
    let tabId = await findPlatformTab(platform, storedTabIds[platform]);
    let created = false;
    if (tabId === undefined) {
      const opened = await browser.tabs.create({
        url: getDistributionPlatform(platform).editorUrl,
        active: false,
        ...(currentTab?.windowId !== undefined ? { windowId: currentTab.windowId } : {}),
      });
      tabId = opened.id;
      created = true;
    }
    if (tabId !== undefined) {
      const tab = await browser.tabs.get(tabId);
      if (
        currentTab?.windowId !== undefined &&
        tab.windowId !== undefined &&
        tab.windowId !== currentTab.windowId
      ) {
        const moved = await browser.tabs.move(tabId, { windowId: currentTab.windowId, index: -1 });
        tabId = Array.isArray(moved) ? moved[0]?.id : moved.id;
      }
      if (tabId !== undefined) prepared.push({ platform, tabId, created });
    }
  }

  const tabIds = prepared.map((item) => item.tabId);
  if (tabIds.length) {
    const [firstTabId, ...remainingTabIds] = tabIds;
    const groupId = await browser.tabs.group({
      tabIds: [firstTabId, ...remainingTabIds],
      ...(currentTab?.windowId !== undefined
        ? { createProperties: { windowId: currentTab.windowId } }
        : {}),
    } as Parameters<typeof browser.tabs.group>[0]);
    await browser.tabGroups.update(groupId, {
      title: DISTRIBUTION_TAB_GROUP_TITLE,
      color: "blue",
      collapsed: false,
    });
  }

  return prepared;
}
