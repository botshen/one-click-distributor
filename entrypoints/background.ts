export default defineBackground(() => {
  browser.action.onClicked.addListener(async () => {
    const url = browser.runtime.getURL("/workbench.html");
    const existing = (await browser.tabs.query({ url })).find((tab) => tab.id !== undefined);
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined)
        await browser.windows.update(existing.windowId, { focused: true });
      return;
    }
    await browser.tabs.create({ url, active: true });
  });
});
